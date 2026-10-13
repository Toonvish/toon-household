/**
 * OWNER: auth agent.
 *
 * Every cookie the API sets lives here so that flags (HttpOnly, SameSite, Secure,
 * Path, Max-Age) can never drift between the places that read and write them.
 *
 * - `toon_session`      opaque session id, 30-day sliding expiry
 * - `toon_oauth_state`  CSRF state of a running OAuth flow (10 min)
 * - `toon_oauth_verify` PKCE code verifier (10 min, Google)
 * - `toon_oauth_next`   relative path the web app wants to land on afterwards
 * - `toon_oauth_intent` "link" when the flow attaches a provider to the account
 *                       that is already signed in (instead of logging someone in)
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { env } from "../env.ts";

/** Name of the session cookie (documented in docs/API.md). */
export const SESSION_COOKIE = "toon_session";
export const OAUTH_STATE_COOKIE = "toon_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "toon_oauth_verify";
export const OAUTH_NEXT_COOKIE = "toon_oauth_next";
export const OAUTH_INTENT_COOKIE = "toon_oauth_intent";

/** What a running OAuth handshake is for. Absent = a plain login. */
export type OAuthIntent = "link";

/** 30 days — the lifetime of a fresh session. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sessions are renewed on use once less than 15 days remain (sliding expiry). */
export const SESSION_RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;
/** OAuth handshake cookies are short-lived. */
export const OAUTH_COOKIE_TTL_SECONDS = 10 * 60;

/**
 * Base attributes of every cookie we set.
 * SameSite=Lax keeps the session cookie on the OAuth redirect back from Google
 * or GitHub (a top-level GET), while still blocking cross-site POSTs.
 */
function baseOptions(): {
  path: string;
  httpOnly: true;
  sameSite: "Lax";
  secure: boolean;
} {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: env.isProduction,
  };
}

/** Sets/refreshes the session cookie so it expires with the DB row. */
export function setSessionCookie(c: Context, sessionId: string, expiresAt: number): void {
  const maxAge = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  setCookie(c, SESSION_COOKIE, sessionId, { ...baseOptions(), maxAge });
}

/** Reads the raw session id from the request (undefined when absent). */
export function readSessionCookie(c: Context): string | undefined {
  const value = getCookie(c, SESSION_COOKIE);
  return value && value.length > 0 ? value : undefined;
}

/** Removes the session cookie (logout, invalid/expired session). */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { ...baseOptions(), maxAge: 0 });
}

/** Stores state/PKCE/next for a running OAuth flow. */
export function setOAuthCookies(
  c: Context,
  values: { state: string; codeVerifier?: string; next?: string; intent?: OAuthIntent },
): void {
  const options = { ...baseOptions(), maxAge: OAUTH_COOKIE_TTL_SECONDS };
  setCookie(c, OAUTH_STATE_COOKIE, values.state, options);
  if (values.codeVerifier) setCookie(c, OAUTH_VERIFIER_COOKIE, values.codeVerifier, options);
  if (values.next) setCookie(c, OAUTH_NEXT_COOKIE, values.next, options);
  if (values.intent) setCookie(c, OAUTH_INTENT_COOKIE, values.intent, options);
}

/** Reads the OAuth handshake cookies written by the start route. */
export function readOAuthCookies(c: Context): {
  state?: string;
  codeVerifier?: string;
  next?: string;
  intent?: OAuthIntent;
} {
  const intent = getCookie(c, OAUTH_INTENT_COOKIE);
  return {
    state: getCookie(c, OAUTH_STATE_COOKIE),
    codeVerifier: getCookie(c, OAUTH_VERIFIER_COOKIE),
    next: getCookie(c, OAUTH_NEXT_COOKIE),
    ...(intent === "link" ? { intent } : {}),
  };
}

/** Always called before redirecting back to the web app. */
export function clearOAuthCookies(c: Context): void {
  const options = { ...baseOptions(), maxAge: 0 };
  deleteCookie(c, OAUTH_STATE_COOKIE, options);
  deleteCookie(c, OAUTH_VERIFIER_COOKIE, options);
  deleteCookie(c, OAUTH_NEXT_COOKIE, options);
  deleteCookie(c, OAUTH_INTENT_COOKIE, options);
}
