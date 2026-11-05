/**
 * The API's cookies in the Effect HTTP layer (docs/EFFECT.md E8; plan `docs/plans/e7-http-api.md` P8).
 *
 * Names, TTLs and attribute values come from `apps/api/src/lib/cookies.ts` (`SESSION_COOKIE`, the OAuth cookie names,
 * `OAUTH_COOKIE_TTL_SECONDS`, `baseCookieOptions`): `Path=/`, `HttpOnly`, `SameSite=Lax`, `Secure` only in production,
 * `Max-Age` in SECONDS (`Duration.seconds(n)`: a bare number would be milliseconds). Deleting writes the empty value
 * with `Max-Age=0` and NO `Expires` (never `expireCookie`), as Hono's `deleteCookie` did. Values are
 * `encodeURIComponent`-encoded on the way out and decoded by `request.cookies` on the way in.
 *
 * A setter registers a pre-response handler (`HttpEffect.appendPreResponseHandler`), applied to the FINAL response,
 * success or failure: a cookie a middleware sets reaches an error response too, as Hono's `c.header` did (the
 * stale-cookie `401`). On the Effect response a cookie is keyed by its name, so setting one twice in a request sends the
 * last value once (Hono appended two `Set-Cookie` headers; the browser ends in the same state).
 */
import { Clock, Duration, Effect } from "effect";
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/http";
import {
  baseCookieOptions,
  OAUTH_COOKIE_TTL_SECONDS,
  OAUTH_INTENT_COOKIE,
  OAUTH_NEXT_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  type OAuthIntent,
  SESSION_COOKIE,
} from "../lib/cookies.ts";

type ServerRequest = HttpServerRequest.HttpServerRequest;

/** `baseCookieOptions()` in Effect's attribute shape, with `Max-Age` in seconds. */
function attributes(maxAgeSeconds: number) {
  const base = baseCookieOptions();
  return {
    path: base.path,
    httpOnly: base.httpOnly,
    secure: base.secure,
    sameSite: "lax" as const,
    maxAge: Duration.seconds(maxAgeSeconds),
  };
}

/** Adds `name=value` with the base attributes to whatever response this request ends with. */
function appendCookie(name: string, value: string, maxAgeSeconds: number): Effect.Effect<void, never, ServerRequest> {
  return HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.orDie(HttpServerResponse.setCookie(response, name, value, attributes(maxAgeSeconds))),
  );
}

/** The raw session id of the request, `undefined` when the cookie is absent or empty. */
export const readSessionCookie: Effect.Effect<string | undefined, never, ServerRequest> =
  HttpServerRequest.HttpServerRequest.useSync((request) => {
    const value = request.cookies[SESSION_COOKIE];
    return value && value.length > 0 ? value : undefined;
  });

/** Sets or refreshes the session cookie so it expires with the row (`Max-Age` at least 1 s, time from the `Clock`). */
export const setSessionCookie = Effect.fnUntraced(function* (
  sessionId: string,
  expiresAt: number,
): Effect.fn.Return<void, never, ServerRequest> {
  const now = yield* Clock.currentTimeMillis;
  yield* appendCookie(SESSION_COOKIE, sessionId, Math.max(1, Math.floor((expiresAt - now) / 1000)));
});

/** Removes the session cookie (logout, a stale or expired session). */
export const clearSessionCookie: Effect.Effect<void, never, ServerRequest> = Effect.suspend(() =>
  appendCookie(SESSION_COOKIE, "", 0),
);

/** Stores state, PKCE verifier, next path and intent of a running OAuth flow (10 minutes). */
export const setOAuthCookies = Effect.fnUntraced(function* (values: {
  state: string;
  codeVerifier?: string;
  next?: string;
  intent?: OAuthIntent;
}): Effect.fn.Return<void, never, ServerRequest> {
  yield* appendCookie(OAUTH_STATE_COOKIE, values.state, OAUTH_COOKIE_TTL_SECONDS);
  if (values.codeVerifier) yield* appendCookie(OAUTH_VERIFIER_COOKIE, values.codeVerifier, OAUTH_COOKIE_TTL_SECONDS);
  if (values.next) yield* appendCookie(OAUTH_NEXT_COOKIE, values.next, OAUTH_COOKIE_TTL_SECONDS);
  if (values.intent) yield* appendCookie(OAUTH_INTENT_COOKIE, values.intent, OAUTH_COOKIE_TTL_SECONDS);
});

/** The OAuth handshake cookies written by the start route. */
export const readOAuthCookies: Effect.Effect<
  { state?: string; codeVerifier?: string; next?: string; intent?: OAuthIntent },
  never,
  ServerRequest
> = HttpServerRequest.HttpServerRequest.useSync((request) => {
  const intent = request.cookies[OAUTH_INTENT_COOKIE];
  return {
    state: request.cookies[OAUTH_STATE_COOKIE],
    codeVerifier: request.cookies[OAUTH_VERIFIER_COOKIE],
    next: request.cookies[OAUTH_NEXT_COOKIE],
    ...(intent === "link" ? { intent } : {}),
  };
});

/** Deletes the four OAuth handshake cookies (always before redirecting back to the web app). */
export const clearOAuthCookies: Effect.Effect<void, never, ServerRequest> = Effect.gen(function* () {
  yield* appendCookie(OAUTH_STATE_COOKIE, "", 0);
  yield* appendCookie(OAUTH_VERIFIER_COOKIE, "", 0);
  yield* appendCookie(OAUTH_NEXT_COOKIE, "", 0);
  yield* appendCookie(OAUTH_INTENT_COOKIE, "", 0);
});
