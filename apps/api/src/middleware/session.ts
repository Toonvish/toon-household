/**
 * OWNER: auth agent — imported by every other router.
 *
 * `requireSession` / `optionalSession` read the opaque `toon_session` cookie,
 * validate it against the `sessions` table and put the user into the Hono
 * context (`c.get("user")`, `c.get("sessionId")`, see src/lib/types.ts).
 *
 * Both can be used either as a factory or directly as a handler, so all of these
 * work:
 *   router.use("*", requireSession());
 *   router.use("*", requireSession);
 *   router.get("/x", requireSession(), handler);
 *
 * The session lookup is ONE effect run through the runtime before `next()` (plan e2 P12): `next()` is never
 * called inside an effect, and a refusal fails the effect with `Unauthorized`, which reaches `onErrorHandler`
 * as the rejection of the run.
 */
import { Effect } from "effect";
import type { MiddlewareHandler, Next } from "hono";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "../lib/cookies.ts";
import { Unauthorized } from "../lib/errors.ts";
import type { AppContext, AppEnv } from "../lib/types.ts";
import { Sessions } from "../core/services/auth/sessions.ts";
import { userDto } from "../core/services/auth/users.ts";
import { runtime } from "../runtime.ts";

/**
 * Loads the session if the cookie is present and valid, as an effect over `Sessions.resolveSession` and `userDto`.
 * Succeeds with true when `c.var.user` was set; the cookie writes happen on `c`.
 */
export const loadSession = Effect.fn("Session.load")(function* (c: AppContext) {
  const sessionId = readSessionCookie(c);
  if (!sessionId) return false;

  const sessions = yield* Sessions;
  const resolved = yield* sessions.resolveSession(sessionId);
  if (!resolved) {
    // Stale cookie (expired/revoked/unknown): get rid of it right away.
    clearSessionCookie(c);
    return false;
  }

  if (resolved.renewed) setSessionCookie(c, sessionId, resolved.session.expiresAt);

  c.set("user", yield* userDto(resolved.user));
  c.set("sessionId", sessionId);
  return true;
});

/** `loadSession`, then 401 `unauthorized` when no valid session came out of it. */
const authenticate = Effect.fn("Session.authenticate")(function* (c: AppContext) {
  const authenticated = yield* loadSession(c);
  if (!authenticated) return yield* new Unauthorized();
});

/*
 * The two handlers are function DECLARATIONS on purpose (hoisted, initialised at module
 * instantiation), not `const` arrows. This module sits in an import cycle: `auth/users.ts` ->
 * `households/modules.ts` -> `modules/index.ts` -> the recipe manifest -> `routes/cards.ts`, which
 * calls `requireSession()` at module scope while this file is still evaluating. With `const` that
 * call hit the temporal dead zone ("Cannot access 'requireHandler' before initialization") whenever
 * the entry point reached this file before the manifest did (the real server did; the tests'
 * import order hid it). Since E2-T12 the same holds for `runtime.ts` and the effects above: the
 * handlers read them only when a request arrives.
 */
async function requireHandler(c: AppContext, next: Next): Promise<void> {
  await runtime.runPromise(authenticate(c));
  await next();
}

async function optionalHandler(c: AppContext, next: Next): Promise<void> {
  await runtime.runPromise(loadSession(c));
  await next();
}

/** 401 `unauthorized` unless a valid session cookie is present. */
export function requireSession(): MiddlewareHandler<AppEnv>;
export function requireSession(c: AppContext, next: Next): Promise<void | Response>;
export function requireSession(
  c?: AppContext,
  next?: Next,
): MiddlewareHandler<AppEnv> | Promise<void | Response> {
  if (c && next) return requireHandler(c, next) as Promise<void | Response>;
  return requireHandler;
}

/** Sets the user when a session exists, but never rejects the request. */
export function optionalSession(): MiddlewareHandler<AppEnv>;
export function optionalSession(c: AppContext, next: Next): Promise<void | Response>;
export function optionalSession(
  c?: AppContext,
  next?: Next,
): MiddlewareHandler<AppEnv> | Promise<void | Response> {
  if (c && next) return optionalHandler(c, next) as Promise<void | Response>;
  return optionalHandler;
}
