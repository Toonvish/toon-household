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
 * - Both layers share `lookupSession` (the cookie value to absent / stale / live). The session lookup is ONE effect per
 *   request (the pre-E7 Hono middlewares ran it once through the runtime before `next()`, plan e2 P12).
 *
 * Import cycle (CLAUDE.md "API import
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
 * happen on the response (a stale cookie is cleared, a renewed session re-sets it), in the order the pre-E7 Hono
 * middleware wrote them on `c`.
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
