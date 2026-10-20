/**
 * OWNER: auth agent.
 *
 * Dead-simple in-memory sliding-window rate limiter for the unauthenticated auth
 * endpoints (login, register, OAuth callback). Single-process only — that is
 * fine for a self-hosted family app; a multi-instance deployment would move the
 * bucket into the DB or Redis.
 *
 * The `RateLimiter` service (docs/EFFECT.md E7; plan e2 P9) and the three synchronous bridges
 * (`checkRateLimit`, `enforceRateLimit`, `resetRateLimits`, see the end of the file) share ONE
 * module-level store. The core is service-free: `checkIn` reads only the `Clock`, `enforceIn` takes
 * `enabled` as a plain value, so a bridge can run it with `Effect.runSync` and recipe's unawaited
 * `enforceRateLimit(...)` statements keep throwing synchronously.
 */
import { Clock, Context, Effect, Layer } from "effect";
import type { Context as HonoContext } from "hono";
import { AppConfig } from "../../../config.ts";
import { env } from "../../../env.ts";
import { RateLimited } from "../../../lib/errors.ts";

export interface RateLimitRule {
  /** Allowed attempts inside the window. */
  limit: number;
  windowMs: number;
}

/** 10 login attempts per minute and identity (IP + e-mail). */
export const LOGIN_RULE: RateLimitRule = { limit: 10, windowMs: 60_000 };
/**
 * Second, IP-INDEPENDENT login bucket per target address: 20 attempts / 15 min.
 * LOGIN_RULE alone can be reset by anyone who can change their apparent IP, so a
 * known e-mail also gets a ceiling that no header can move. Sized so a forgetful
 * family member is never locked out but a password spray is.
 */
export const LOGIN_EMAIL_RULE: RateLimitRule = { limit: 20, windowMs: 15 * 60_000 };
/** 5 new accounts per IP per 15 minutes. */
export const REGISTER_RULE: RateLimitRule = { limit: 5, windowMs: 15 * 60_000 };
/** 20 OAuth callbacks per IP per minute (a legitimate flow needs one). */
export const OAUTH_RULE: RateLimitRule = { limit: 20, windowMs: 60_000 };
/** 10 password changes per session-user per 5 minutes. */
export const PASSWORD_RULE: RateLimitRule = { limit: 10, windowMs: 5 * 60_000 };
/**
 * `POST /api/auth/password/forgot`, per IP: 5 per 15 minutes.
 *
 * This endpoint is unauthenticated and it SENDS MAIL, so without a ceiling it is
 * both a way to mail-bomb a member and a way to burn a provider quota. It answers
 * 204 either way, so the limit is the only feedback an abuser gets.
 */
export const FORGOT_PASSWORD_RULE: RateLimitRule = { limit: 5, windowMs: 15 * 60_000 };
/**
 * Second, IP-INDEPENDENT ceiling per target ADDRESS: 3 per 15 minutes.
 *
 * Same reasoning as LOGIN_EMAIL_RULE — without TRUST_PROXY the IP is the socket
 * address, and behind a NAT or a proxy that is shared, so one bucket per address
 * is what actually protects a specific person's inbox.
 */
export const FORGOT_PASSWORD_EMAIL_RULE: RateLimitRule = { limit: 3, windowMs: 15 * 60_000 };
/**
 * `POST /api/auth/password/reset`, per IP: 10 per 15 minutes. Guessing a 256-bit
 * token is hopeless, but an unmetered endpoint that runs argon2id on every call is
 * a cheap way to pin a CPU.
 */
export const PASSWORD_RESET_RULE: RateLimitRule = { limit: 10, windowMs: 15 * 60_000 };
/** E-mail confirmation request/confirm: 5 per user (or IP) per 15 minutes. */
export const EMAIL_VERIFY_RULE: RateLimitRule = { limit: 5, windowMs: 15 * 60_000 };
/**
 * 10 imports per user per minute. Keyed on the USER, not the IP: every import
 * endpoint is behind a session, and a single PDF/photo costs seconds of CPU
 * (sharp + tesseract) plus up to 15 MB of RAM, so without a ceiling one member
 * can flatten a self-hosted box. The OCR path additionally goes through a
 * process-wide concurrency gate (see services/ocr/index.ts).
 */
export const IMPORT_RULE: RateLimitRule = { limit: 10, windowMs: 60_000 };

/**
 * `POST /api/households/:householdId/invites` WITH an e-mail, per USER: 10 per hour
 * (toon-finance 1715207, gotcha 74). Authenticated, but it mails an arbitrary address
 * with the inviter's name in the body — an unmetered outbound-mail primitive for anyone
 * with an account (and claim invites can be re-issued without end). A link-only invite
 * sends nothing and is not metered.
 */
export const INVITE_RULE: RateLimitRule = { limit: 10, windowMs: 60 * 60_000 };
/**
 * `POST /api/households`, per USER: 5 per hour (toon-finance 1715207, gotcha 74). Each
 * one writes the default module rows and runs every module's `onHouseholdCreated`.
 */
export const HOUSEHOLD_CREATE_RULE: RateLimitRule = { limit: 5, windowMs: 60 * 60_000 };

const buckets = new Map<string, number[]>();
/** Guards against unbounded growth on a hostile/busy instance. */
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Records an attempt for `key` and reports whether it is allowed. Time comes from the `Clock`. */
const checkIn = Effect.fnUntraced(function* (key: string, rule: RateLimitRule): Effect.fn.Return<RateLimitResult> {
  const now = yield* Clock.currentTimeMillis;
  const cutoff = now - rule.windowMs;
  const hits = (buckets.get(key) ?? []).filter((at) => at > cutoff);

  if (hits.length >= rule.limit) {
    const oldest = hits[0] ?? now;
    buckets.set(key, hits);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
    };
  }

  hits.push(now);
  if (buckets.size > MAX_BUCKETS) pruneBuckets(cutoff);
  buckets.set(key, hits);
  return { allowed: true, remaining: rule.limit - hits.length, retryAfterSeconds: 0 };
});

function pruneBuckets(cutoff: number): void {
  for (const [key, hits] of buckets) {
    const live = hits.filter((at) => at > cutoff);
    if (live.length === 0) buckets.delete(key);
    else buckets.set(key, live);
  }
}

/** Drops one bucket, or all of them (tests, and after a successful login). */
function resetBuckets(key?: string): void {
  if (key === undefined) buckets.clear();
  else buckets.delete(key);
}

/**
 * Fails with `RateLimited` (429, `Retry-After`) when the bucket of `scope:identifier` (lower-cased) is exhausted and
 * returns the bucket key otherwise. `enabled = false` returns the key and records nothing (today's `NODE_ENV=test`
 * no-op, which keeps integration tests deterministic).
 */
const enforceIn = Effect.fnUntraced(function* (
  scope: string,
  identifier: string,
  rule: RateLimitRule,
  enabled: boolean,
): Effect.fn.Return<string, RateLimited> {
  const key = `${scope}:${identifier.toLowerCase()}`;
  if (!enabled) return key;
  const result = yield* checkIn(key, rule);
  if (!result.allowed) return yield* new RateLimited({ retryAfterSeconds: result.retryAfterSeconds });
  return key;
});

/**
 * The rate limiter as a service (plan e2 P9). `enforce` is on unless `NODE_ENV=test` (the `AppConfig` captured at
 * build); `check` and `reset` act on the same store as the bridges.
 */
export class RateLimiter extends Context.Service<
  RateLimiter,
  {
    /** Records an attempt for `key` and reports whether it is allowed. */
    readonly check: (key: string, rule: RateLimitRule) => Effect.Effect<RateLimitResult>;
    /** Returns the lower-cased `scope:identifier` key, or fails with `RateLimited`; a no-op under `NODE_ENV=test`. */
    readonly enforce: (scope: string, identifier: string, rule: RateLimitRule) => Effect.Effect<string, RateLimited>;
    /** Drops the bucket `key`, or every bucket. */
    readonly reset: (key?: string) => Effect.Effect<void>;
  }
>()("toon/api/core/services/auth/rateLimit/RateLimiter") {
  static readonly layer = Layer.effect(
    RateLimiter,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      return RateLimiter.of({
        check: checkIn,
        enforce: (scope, identifier, rule) => enforceIn(scope, identifier, rule, !config.isTest),
        reset: (key) => Effect.sync(() => resetBuckets(key)),
      });
    }),
  );
}

/**
 * The address a rate-limit bucket is keyed on.
 *
 * FORWARDING HEADERS ARE ONLY BELIEVED WHEN `TRUST_PROXY=1`. They are attacker
 * controlled on a directly exposed server, and this used to trust them
 * unconditionally — a fresh `X-Forwarded-For: 1.2.3.<n>` per request handed out a
 * brand-new bucket every time, which made login brute-forcing and mass
 * registration completely unmetered.
 *
 * Without TRUST_PROXY the connection address is used (`server.requestIP`), and
 * only if even that is unavailable do we fall back to "unknown" — a single shared
 * bucket, which throttles rather than opens up.
 */
export function clientIp(c: HonoContext): string {
  if (env.trustProxy) {
    // The LAST entry, not the first (toon-finance 1715207, gotchas 18 and 74). The
    // trusted proxy is the one hop we believe, and whatever it appended is the address
    // it saw; the first entry is whatever the client chose to send. With the stack's own Caddy
    // (docker/Caddyfile, SPEC D11) OVERWRITING the header (`header_up X-Forwarded-For {remote_host}`)
    // both are the same value — and if that line is ever dropped there, "last" still
    // yields the true peer while "first" would turn every rate limit into a
    // client-controlled no-op.
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      const last = forwarded.split(",").at(-1)?.trim();
      if (last && last.length > 0) return last;
    }
    const direct = c.req.header("x-real-ip") ?? c.req.header("cf-connecting-ip");
    if (direct && direct.length > 0) return direct;
  }
  return socketAddress(c) ?? "unknown";
}

/** Peer address straight off the Bun socket, or undefined (e.g. in tests). */
function socketAddress(c: HonoContext): string | undefined {
  const server = c.env as { requestIP?: (request: Request) => { address?: string } | null } | undefined;
  if (!server || typeof server.requestIP !== "function") return undefined;
  try {
    const address = server.requestIP(c.req.raw)?.address;
    return address && address.length > 0 ? address : undefined;
  } catch {
    return undefined;
  }
}


/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

// The three bridges stay SYNCHRONOUS with their old return types (plan e2 P1, P9): recipe's `imports.ts` calls
// `enforceRateLimit` as a plain unawaited statement, so a Promise would typecheck there, stay green under test (a
// no-op) and drop the import limit in production. Each runs a service-free effect with `Effect.runSync`.

/** Callers: `apps/api/test/auth.test.ts` (rate-limit block, pinned), core routes until E2-T10. */
export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  return Effect.runSync(checkIn(key, rule));
}

/** Callers: `apps/api/test/auth.test.ts` (pinned), modules.test.ts, finance-module.test.ts, core routes. */
export function resetRateLimits(key?: string): void {
  resetBuckets(key);
}

/**
 * Throws `RateLimited` (429 `rate_limited`) synchronously when the bucket is exhausted and sets `Retry-After` on `c`;
 * returns the bucket key otherwise. `enabled` defaults to "not under NODE_ENV=test"; a test passes `true` to switch the
 * limiter on. Callers: `apps/api/src/modules/recipe/routes/imports.ts` (unawaited), core routes until E2-T10.
 */
export function enforceRateLimit(
  c: HonoContext,
  scope: string,
  identifier: string,
  rule: RateLimitRule,
  enabled: boolean = !env.isTest,
): string {
  return Effect.runSync(
    enforceIn(scope, identifier, rule, enabled).pipe(
      Effect.tapError((error) => Effect.sync(() => c.header("Retry-After", String(error.retryAfterSeconds)))),
    ),
  );
}
