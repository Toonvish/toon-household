/**
 * OWNER: auth agent.
 *
 * Dead-simple in-memory sliding-window rate limiter for the unauthenticated auth
 * endpoints (login, register, OAuth callback). Single-process only — that is
 * fine for a self-hosted family app; a multi-instance deployment would move the
 * bucket into the DB or Redis.
 */
import type { Context } from "hono";
import { ApiError } from "../../../lib/errors.ts";
import { env } from "../../../env.ts";

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

const buckets = new Map<string, number[]>();
/** Guards against unbounded growth on a hostile/busy instance. */
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Records an attempt for `key` and reports whether it is allowed. */
export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
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
}

function pruneBuckets(cutoff: number): void {
  for (const [key, hits] of buckets) {
    const live = hits.filter((at) => at > cutoff);
    if (live.length === 0) buckets.delete(key);
    else buckets.set(key, live);
  }
}

/** Drops all buckets (tests, and after a successful login). */
export function resetRateLimits(key?: string): void {
  if (key === undefined) buckets.clear();
  else buckets.delete(key);
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
export function clientIp(c: Context): string {
  if (env.trustProxy) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first && first.length > 0) return first;
    }
    const direct = c.req.header("x-real-ip") ?? c.req.header("cf-connecting-ip");
    if (direct && direct.length > 0) return direct;
  }
  return socketAddress(c) ?? "unknown";
}

/** Peer address straight off the Bun socket, or undefined (e.g. in tests). */
function socketAddress(c: Context): string | undefined {
  const server = c.env as { requestIP?: (request: Request) => { address?: string } | null } | undefined;
  if (!server || typeof server.requestIP !== "function") return undefined;
  try {
    const address = server.requestIP(c.req.raw)?.address;
    return address && address.length > 0 ? address : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Throws 429 `rate_limited` when the bucket is exhausted.
 * Disabled under NODE_ENV=test so integration tests stay deterministic.
 */
export function enforceRateLimit(
  c: Context,
  scope: string,
  identifier: string,
  rule: RateLimitRule,
): string {
  const key = `${scope}:${identifier.toLowerCase()}`;
  if (env.isTest) return key;
  const result = checkRateLimit(key, rule);
  if (!result.allowed) {
    c.header("Retry-After", String(result.retryAfterSeconds));
    throw new ApiError(429, "rate_limited", {
      key: "server.error.tooManyAttempts",
      values: { seconds: result.retryAfterSeconds },
    });
  }
  return key;
}
