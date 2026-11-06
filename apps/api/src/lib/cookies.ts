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
 *
 * The names, TTLs and attribute values above are what the Effect cookies of `apps/api/src/http/cookies.ts` (plan
 * `docs/plans/e7-http-api.md` P8) read; the pre-E7 Hono setters and getters that shared them are gone.
 */
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
export function baseCookieOptions(): {
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
