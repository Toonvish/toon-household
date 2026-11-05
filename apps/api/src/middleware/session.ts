/**
 * OWNER: auth agent — imported by every other router.
 *
 * The session middlewares read the opaque `toon_session` cookie, validate it against the `sessions` table and hand
 * the user and the session id to everything behind them. A stale cookie (expired, revoked, unknown) is cleared on the
 * response at once; a session close to its expiry is renewed and its cookie re-set (sliding expiry).
 *
 * - The Effect HTTP layer (docs/EFFECT.md E8; plan `docs/plans/e7-http-api.md` P5, P8): `RequireSessionLayer` and
 *   `OptionalSessionLayer` implement the tags `RequireSession` (401 `unauthorized` without a valid session; provides
 *   `CurrentUser` and `CurrentSession`) and `OptionalSession` (never refuses; provides `MaybeSession`) of
 *   `apps/api/src/http/middleware.ts`. The cookie writes go through `apps/api/src/http/cookies.ts`, i.e. pre-response
 *   handlers, so a cleared stale cookie reaches the 401 too.
 * - The Hono section at the end (until E7-T12 deletes it): `requireSession` / `optionalSession`, which can be used
 *   either as a factory or directly as a handler (`router.use("*", requireSession())`, `router.use("*",
 *   requireSession)`, `router.get("/x", requireSession(), handler)`), put the user into the Hono context. The session
 *   lookup is ONE effect run through the runtime before `next()` (plan e2 P12): `next()` is never called inside an
 *   effect, and a refusal fails the effect with `Unauthorized`, which reaches `onErrorHandler` as the rejection.
 *
 * Both sides share `lookupSession` (the cookie value to absent / stale / live). Import cycle (CLAUDE.md "API import
 * cycle"): the module scope reads only `effect` exports and the leaf tags; the services are yielded at layer build or
 * per request.
 */
import { Effect, Layer } from "effect";
import { Sessions, type ResolvedSession } from "../core/services/auth/sessions.ts";
import { userDto } from "../core/services/auth/users.ts";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "../http/cookies.ts";
import { CurrentSession, CurrentUser, MaybeSession } from "../http/context.ts";
import { OptionalSession, RequireSession } from "../http/middleware.ts";
import { type DatabaseError, Unauthorized } from "../lib/errors.ts";

/** What the `toon_session` cookie value of a request resolves to. */
export type SessionLookup =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Stale" }
  | { readonly _tag: "Live"; readonly sessionId: string; readonly resolved: ResolvedSession };

/**
 * The cookie value to its session: `Absent` without a cookie, `Stale` for an expired, revoked or unknown one (the
 * caller clears it), `Live` with the resolved row (`resolved.renewed`: the caller re-sets the cookie).
 */
export const lookupSession = Effect.fn("Session.lookup")(function* (
  sessionId: string | undefined,
): Effect.fn.Return<SessionLookup, DatabaseError, Sessions> {
  if (!sessionId) return { _tag: "Absent" };
  const sessions = yield* Sessions;
  const resolved = yield* sessions.resolveSession(sessionId);
  if (!resolved) return { _tag: "Stale" };
  return { _tag: "Live", sessionId, resolved };
});

/**
 * The session of the request in the Effect layer: the user and the session id, or `undefined`. The cookie writes
 * happen on the response (a stale cookie is cleared, a renewed session re-sets it), in the order the Hono side
 * wrote them on `c`.
 */
const loadSession = Effect.fn("Session.load")(function* () {
  const lookup = yield* lookupSession(yield* readSessionCookie);
  if (lookup._tag === "Absent") return undefined;
  if (lookup._tag === "Stale") {
    // Stale cookie (expired/revoked/unknown): get rid of it right away.
    yield* clearSessionCookie;
    return undefined;
  }
  if (lookup.resolved.renewed) yield* setSessionCookie(lookup.sessionId, lookup.resolved.session.expiresAt);
  return { user: yield* userDto(lookup.resolved.user), sessionId: lookup.sessionId };
});

/** `RequireSession` (P5): 401 `unauthorized` unless a valid session cookie is present. */
export const RequireSessionLayer = Layer.effect(
  RequireSession,
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    return RequireSession.of(
      Effect.fn("RequireSession")(function* (httpEffect) {
        const session = yield* Effect.provideService(loadSession(), Sessions, sessions);
        if (!session) return yield* new Unauthorized();
        return yield* httpEffect.pipe(
          Effect.provideService(CurrentUser, session.user),
          Effect.provideService(CurrentSession, { sessionId: session.sessionId }),
        );
      }),
    );
  }),
);

/** `OptionalSession` (P5): the user and the session id when a session exists, but never rejects the request. */
export const OptionalSessionLayer = Layer.effect(
  OptionalSession,
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    return OptionalSession.of(
      Effect.fn("OptionalSession")(function* (httpEffect) {
        const session = yield* Effect.provideService(loadSession(), Sessions, sessions);
        return yield* Effect.provideService(httpEffect, MaybeSession, {
          user: session?.user,
          sessionId: session?.sessionId,
        });
      }),
    );
  }),
);

/* Hono (E7 transition): E7-T12 deletes this section */
import type { MiddlewareHandler, Next } from "hono";
import {
  clearSessionCookie as clearHonoSessionCookie,
  readSessionCookie as readHonoSessionCookie,
  setSessionCookie as setHonoSessionCookie,
} from "../lib/cookies.ts";
import type { AppContext, AppEnv } from "../lib/types.ts";
import { runtime } from "../runtime.ts";

/**
 * Loads the session if the cookie is present and valid, as an effect over `lookupSession` and `userDto`.
 * Succeeds with true when `c.var.user` was set; the cookie writes happen on `c`.
 */
export const loadHonoSession = Effect.fn("Session.load")(function* (c: AppContext) {
  const lookup = yield* lookupSession(readHonoSessionCookie(c));
  if (lookup._tag === "Absent") return false;
  if (lookup._tag === "Stale") {
    // Stale cookie (expired/revoked/unknown): get rid of it right away.
    clearHonoSessionCookie(c);
    return false;
  }

  if (lookup.resolved.renewed) setHonoSessionCookie(c, lookup.sessionId, lookup.resolved.session.expiresAt);

  c.set("user", yield* userDto(lookup.resolved.user));
  c.set("sessionId", lookup.sessionId);
  return true;
});

/** `loadHonoSession`, then 401 `unauthorized` when no valid session came out of it. */
const authenticate = Effect.fn("Session.authenticate")(function* (c: AppContext) {
  const authenticated = yield* loadHonoSession(c);
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
  await runtime.runPromise(loadHonoSession(c));
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
