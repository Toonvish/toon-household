/**
 * OWNER: auth agent.
 *
 * Thin wrapper around `arctic` for the two providers this app supports.
 *
 * Nothing here touches the database — src/services/auth/oauthAccounts.ts does
 * the login/link/create decision. Clients are built lazily per request so the
 * API boots fine without any OAuth credentials configured; the routes answer
 * 400 `oauth_not_configured` in that case (see docs/API.md).
 */
import type { OAuthProvider } from "@toon/shared";
import { GitHub, Google, decodeIdToken, generateCodeVerifier, generateState } from "arctic";
import { z } from "zod";
import { env } from "../env.ts";
import { ApiError } from "./errors.ts";

export type { OAuthProvider };

/** Normalised profile we need from any provider. */
export interface OAuthProfile {
  provider: OAuthProvider;
  /** Stable provider-side id ("sub" / numeric GitHub id as string). */
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

export interface OAuthStart {
  url: string;
  state: string;
  /** Only Google (PKCE); GitHub has no code challenge. */
  codeVerifier?: string;
}

const GOOGLE_SCOPES = ["openid", "profile", "email"];
const GITHUB_SCOPES = ["read:user", "user:email"];

/** True when both client id and secret are present in the environment. */
export function isProviderConfigured(provider: OAuthProvider): boolean {
  return provider === "google" ? env.googleOAuthConfigured : env.githubOAuthConfigured;
}

/**
 * 400 `oauth_not_configured` instead of a boot crash when a provider is not set up.
 * INTEGRATION: docs/API.md is the referee and documents 400 here; it was 501 before,
 * which also made the global onError log a stack trace for a perfectly normal
 * "this server has no Google credentials" answer.
 */
export function requireProviderConfigured(provider: OAuthProvider): void {
  if (isProviderConfigured(provider)) return;
  throw new ApiError(
    400,
    "oauth_not_configured",
    provider === "google" ? "server.auth.googleNotConfigured" : "server.auth.githubNotConfigured",
  );
}

/** Redirect URI registered with the provider. */
export function callbackUrl(provider: OAuthProvider): string {
  return `${env.OAUTH_REDIRECT_BASE.replace(/\/+$/, "")}/api/auth/oauth/${provider}/callback`;
}

function googleClient(): Google {
  return new Google(env.GOOGLE_CLIENT_ID ?? "", env.GOOGLE_CLIENT_SECRET ?? "", callbackUrl("google"));
}

function githubClient(): GitHub {
  return new GitHub(env.GITHUB_CLIENT_ID ?? "", env.GITHUB_CLIENT_SECRET ?? "", callbackUrl("github"));
}

/** Builds the provider authorization URL plus the values to store in cookies. */
export function createAuthorization(provider: OAuthProvider): OAuthStart {
  requireProviderConfigured(provider);
  const state = generateState();

  if (provider === "google") {
    const codeVerifier = generateCodeVerifier();
    const url = googleClient().createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES);
    // Ask Google for a refresh-free, always-fresh id_token and let the user pick
    // an account instead of silently reusing the last one.
    url.searchParams.set("prompt", "select_account");
    return { url: url.toString(), state, codeVerifier };
  }

  const url = githubClient().createAuthorizationURL(state, GITHUB_SCOPES);
  return { url: url.toString(), state };
}

/* --------------------------- provider responses --------------------------- */

const GoogleClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().optional(),
  email_verified: z.union([z.boolean(), z.string()]).optional(),
  name: z.string().optional(),
  given_name: z.string().optional(),
  picture: z.string().optional(),
});

const GitHubUserSchema = z.object({
  id: z.union([z.number(), z.string()]),
  login: z.string(),
  name: z.string().nullish(),
  email: z.string().nullish(),
  avatar_url: z.string().nullish(),
});

const GitHubEmailsSchema = z.array(
  z.object({
    email: z.string(),
    primary: z.boolean().optional(),
    verified: z.boolean().optional(),
  }),
);

function truthy(value: boolean | string | undefined): boolean {
  return value === true || value === "true";
}

/**
 * Exchanges the authorization code and loads the user profile.
 * Any provider/network failure becomes 400 `oauth_failed` — the callers turn it
 * into a redirect back to the web app.
 */
export async function exchangeCodeForProfile(
  provider: OAuthProvider,
  code: string,
  codeVerifier: string | undefined,
): Promise<OAuthProfile> {
  requireProviderConfigured(provider);

  if (provider === "google") {
    if (!codeVerifier) {
      throw new ApiError(400, "oauth_failed", "server.auth.oauthSessionExpired");
    }
    const tokens = await validate(() => googleClient().validateAuthorizationCode(code, codeVerifier));
    // `idToken()` throws when the response carried none — then we fall back to
    // the userinfo endpoint inside googleProfile().
    let idToken: string | undefined;
    try {
      idToken = tokens.idToken();
    } catch {
      idToken = undefined;
    }
    return googleProfile(idToken, tokens.accessToken());
  }

  const tokens = await validate(() => githubClient().validateAuthorizationCode(code));
  return githubProfile(tokens.accessToken());
}

async function validate<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.warn("[auth] OAuth code exchange failed:", error instanceof Error ? error.message : error);
    throw new ApiError(400, "oauth_failed", "server.auth.oauthLoginFailed");
  }
}

async function googleProfile(idToken: string | undefined, accessToken: string): Promise<OAuthProfile> {
  let claims: unknown;
  if (idToken) {
    try {
      claims = decodeIdToken(idToken);
    } catch {
      claims = undefined;
    }
  }
  if (claims === undefined) {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new ApiError(400, "oauth_failed", "server.auth.googleProfileUnavailable");
    }
    claims = await response.json();
  }

  const parsed = GoogleClaimsSchema.safeParse(claims);
  if (!parsed.success) {
    throw new ApiError(400, "oauth_failed", "server.auth.googleProfileIncomplete");
  }
  const data = parsed.data;
  return {
    provider: "google",
    providerUserId: data.sub,
    email: data.email?.trim().toLowerCase() ?? null,
    emailVerified: truthy(data.email_verified),
    name: data.name ?? data.given_name ?? null,
    avatarUrl: data.picture ?? null,
  };
}

async function githubProfile(accessToken: string): Promise<OAuthProfile> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "toon-recipe",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const userResponse = await fetch("https://api.github.com/user", { headers });
  if (!userResponse.ok) {
    throw new ApiError(400, "oauth_failed", "server.auth.githubProfileUnavailable");
  }
  const user = GitHubUserSchema.safeParse(await userResponse.json());
  if (!user.success) {
    throw new ApiError(400, "oauth_failed", "server.auth.githubProfileIncomplete");
  }

  let email = user.data.email?.trim().toLowerCase() ?? null;
  let emailVerified = false;

  // The public profile e-mail may be hidden; /user/emails needs `user:email`.
  const emailsResponse = await fetch("https://api.github.com/user/emails", { headers });
  if (emailsResponse.ok) {
    const emails = GitHubEmailsSchema.safeParse(await emailsResponse.json());
    if (emails.success) {
      const primary =
        emails.data.find((entry) => entry.primary === true && entry.verified === true) ??
        emails.data.find((entry) => entry.verified === true);
      if (primary) {
        email = primary.email.trim().toLowerCase();
        emailVerified = true;
      }
    }
  }

  return {
    provider: "github",
    providerUserId: String(user.data.id),
    email,
    emailVerified,
    name: user.data.name ?? user.data.login,
    avatarUrl: user.data.avatar_url ?? null,
  };
}

/**
 * Absolute URL in the web app (first entry of WEB_ORIGIN).
 *
 * FAILS CLOSED: if `path` somehow resolves off the configured origin (see
 * {@link safeNextPath} for how that can happen), the bare origin is returned
 * instead — a successful OAuth login must never hand the browser to a third
 * party.
 */
export function webUrl(path: string, params?: Record<string, string>): string {
  const origin = (env.webOrigins[0] ?? "http://localhost:5173").replace(/\/+$/, "");
  const base = new URL(`${origin}/`);
  let url: URL;
  try {
    url = new URL(path.startsWith("/") ? path : `/${path}`, base);
  } catch {
    url = new URL(base);
  }
  if (url.origin !== base.origin) url = new URL(base);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * Only same-site, relative targets may come back from the client.
 *
 * The leading-slash test alone is NOT enough: the WHATWG URL parser treats a
 * backslash exactly like a slash for special schemes, so `/\evil.com` resolves
 * to `http://evil.com/`, and it strips leading/embedded C0 controls and spaces,
 * which makes `/%09/evil.com` (tab) do the same. Both used to turn the OAuth
 * callback into an open redirect right after a real login. So: no backslashes,
 * no control characters, no spaces.
 */
export function safeNextPath(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  if (value.length > 200) return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  if (/[\\\u0000-\u0020\u007f]/.test(value)) return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}
