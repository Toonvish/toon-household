/**
 * OWNER: auth agent.
 *
 * Thin wrapper around `arctic` for the two providers this app supports.
 *
 * Nothing here touches the database — src/services/auth/oauthAccounts.ts does
 * the login/link/create decision. Clients are built lazily per request so the
 * API boots fine without any OAuth credentials configured; the routes answer
 * 400 `oauth_not_configured` in that case (see docs/API.md).
 *
 * The `OAuthProviders` service (docs/EFFECT.md E6, E7; plan `docs/plans/e2-api-core-services.md` P1, P2) holds the
 * two operations that can fail: `requireProviderConfigured` and `exchangeCodeForProfile`. Every `fetch` and every
 * arctic call goes through `Effect.tryPromise`: a transport failure is an `OAuthTransportError` (outside the API
 * error family, so the callback logs it and redirects with `oauth_failed`, as it did for the raw `TypeError`), the
 * provider's own refusals are `ApiFailure` 400 `oauth_failed` with today's texts. The pure helpers
 * (`isProviderConfigured`, `callbackUrl`, the three parsers, `webUrl`, `safeNextPath`) stay plain functions
 * reading the process `env` (or the settings they are handed); `createAuthorization` is an `Effect.fnUntraced`
 * that fails with the same `oauth_not_configured` refusal for an unconfigured provider and is yielded by the two
 * OAuth start handlers. The service has no legacy bridge.
 */
import type { OAuthProvider } from "@toon/shared";
import { GitHub, Google, decodeIdToken, generateCodeVerifier, generateState } from "arctic";
import { Context, Effect, Layer, Option, Predicate, Schema } from "effect";
import { AppConfig, type Env } from "../config.ts";
import { env } from "../env.ts";
import { ApiFailure } from "./errors.ts";

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

/** The part of the environment this file reads: the process `env` by default, any `AppConfig` value in a service. */
export type OAuthSettings = Pick<
  Env,
  | "googleOAuthConfigured"
  | "githubOAuthConfigured"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
  | "OAUTH_REDIRECT_BASE"
>;

/** True when both client id and secret are present in the environment. */
export function isProviderConfigured(provider: OAuthProvider, settings: OAuthSettings = env): boolean {
  return provider === "google" ? settings.googleOAuthConfigured : settings.githubOAuthConfigured;
}

/** The `oauth_failed` refusal with one catalog text. */
function oauthFailed(text: ConstructorParameters<typeof ApiFailure>[0]["text"]): ApiFailure {
  return new ApiFailure({ status: 400, code: "oauth_failed", text });
}

/**
 * 400 `oauth_not_configured` instead of a boot crash when a provider is not set up.
 * INTEGRATION: docs/API.md is the referee and documents 400 here; it was 501 before,
 * which also made the global onError log a stack trace for a perfectly normal
 * "this server has no Google credentials" answer. Service-free (reads only `settings`).
 */
export const checkProviderConfigured = Effect.fnUntraced(function* (
  provider: OAuthProvider,
  settings: OAuthSettings = env,
): Effect.fn.Return<void, ApiFailure> {
  if (isProviderConfigured(provider, settings)) return;
  return yield* new ApiFailure({
    status: 400,
    code: "oauth_not_configured",
    text: provider === "google" ? "server.auth.googleNotConfigured" : "server.auth.githubNotConfigured",
  });
});

/** Redirect URI registered with the provider. */
export function callbackUrl(provider: OAuthProvider, settings: OAuthSettings = env): string {
  return `${settings.OAUTH_REDIRECT_BASE.replace(/\/+$/, "")}/api/auth/oauth/${provider}/callback`;
}

function googleClient(settings: OAuthSettings): Google {
  return new Google(settings.GOOGLE_CLIENT_ID ?? "", settings.GOOGLE_CLIENT_SECRET ?? "", callbackUrl("google", settings));
}

function githubClient(settings: OAuthSettings): GitHub {
  return new GitHub(settings.GITHUB_CLIENT_ID ?? "", settings.GITHUB_CLIENT_SECRET ?? "", callbackUrl("github", settings));
}

/** Builds the provider authorization URL plus the values to store in cookies. */
export const createAuthorization = Effect.fnUntraced(function* (
  provider: OAuthProvider,
  settings: OAuthSettings = env,
): Effect.fn.Return<OAuthStart, ApiFailure> {
  yield* checkProviderConfigured(provider, settings);
  const state = generateState();

  if (provider === "google") {
    const codeVerifier = generateCodeVerifier();
    const url = googleClient(settings).createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES);
    // Ask Google for a refresh-free, always-fresh id_token and let the user pick
    // an account instead of silently reusing the last one.
    url.searchParams.set("prompt", "select_account");
    return { url: url.toString(), state, codeVerifier };
  }

  const url = githubClient(settings).createAuthorizationURL(state, GITHUB_SCOPES);
  return { url: url.toString(), state };
});

/* --------------------------- provider responses --------------------------- */

const GoogleClaimsSchema = Schema.Struct({
  sub: Schema.String.check(Schema.isMinLength(1)),
  email: Schema.optional(Schema.String),
  email_verified: Schema.optional(Schema.Union([Schema.Boolean, Schema.String])),
  name: Schema.optional(Schema.String),
  given_name: Schema.optional(Schema.String),
  picture: Schema.optional(Schema.String),
});

const GitHubUserSchema = Schema.Struct({
  // Finite: JSON has no NaN or Infinity, and z.number() refused them too.
  id: Schema.Union([Schema.Finite, Schema.String]),
  login: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.optional(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
});

const GitHubEmailsSchema = Schema.Array(
  Schema.Struct({
    email: Schema.String,
    primary: Schema.optional(Schema.Boolean),
    verified: Schema.optional(Schema.Boolean),
  }),
);

const decodeGoogleClaims = Schema.decodeUnknownOption(GoogleClaimsSchema);
const decodeGitHubUser = Schema.decodeUnknownOption(GitHubUserSchema);
const decodeGitHubEmails = Schema.decodeUnknownOption(GitHubEmailsSchema);

/** The provider payloads, parsed once at the edge: the value, or `undefined` when it is not that shape. */
export function parseGoogleClaims(raw: unknown): typeof GoogleClaimsSchema.Type | undefined {
  return Option.getOrUndefined(decodeGoogleClaims(raw));
}

export function parseGitHubUser(raw: unknown): typeof GitHubUserSchema.Type | undefined {
  return Option.getOrUndefined(decodeGitHubUser(raw));
}

export function parseGitHubEmails(raw: unknown): typeof GitHubEmailsSchema.Type | undefined {
  return Option.getOrUndefined(decodeGitHubEmails(raw));
}

function truthy(value: boolean | string | undefined): boolean {
  return value === true || value === "true";
}

/**
 * A provider or network failure that is NOT one of the provider's own refusals: a rejected `fetch`, a body that is
 * not JSON. Outside the API error family on purpose (like `DatabaseError`): the OAuth callback logs it and redirects
 * with `oauth_failed`, exactly as it did for the raw rejection.
 */
export class OAuthTransportError extends Schema.TaggedError<OAuthTransportError>()("OAuthTransportError", {
  cause: Schema.Defect(),
}) {}

/** A promise (or a thunk that throws synchronously) as an effect whose failure is an `OAuthTransportError`. */
function attempt<A>(run: () => Promise<A>): Effect.Effect<A, OAuthTransportError> {
  return Effect.tryPromise({ try: run, catch: (cause) => new OAuthTransportError({ cause }) });
}

/** arctic's code exchange: any failure is logged (English, as before) and becomes 400 `oauth_failed`. */
function validateCode<A>(run: () => Promise<A>): Effect.Effect<A, ApiFailure> {
  return attempt(run).pipe(
    Effect.catchTag("OAuthTransportError", ({ cause }) =>
      Effect.sync(() =>
        console.warn("[auth] OAuth code exchange failed:", Predicate.isError(cause) ? cause.message : cause),
      ).pipe(Effect.andThen(Effect.fail(oauthFailed("server.auth.oauthLoginFailed")))),
    ),
  );
}

const googleProfile = Effect.fn("OAuthProviders.googleProfile")(function* (
  idToken: string | undefined,
  accessToken: string,
) {
  let claims: unknown;
  if (idToken) {
    claims = yield* Effect.try(() => decodeIdToken(idToken)).pipe(Effect.orElseSucceed((): unknown => undefined));
  }
  if (claims === undefined) {
    const response = yield* attempt(() =>
      fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
    if (!response.ok) {
      return yield* oauthFailed("server.auth.googleProfileUnavailable");
    }
    claims = yield* attempt((): Promise<unknown> => response.json());
  }

  const data = parseGoogleClaims(claims);
  if (data === undefined) {
    return yield* oauthFailed("server.auth.googleProfileIncomplete");
  }
  const profile: OAuthProfile = {
    provider: "google",
    providerUserId: data.sub,
    email: data.email?.trim().toLowerCase() ?? null,
    emailVerified: truthy(data.email_verified),
    name: data.name ?? data.given_name ?? null,
    avatarUrl: data.picture ?? null,
  };
  return profile;
});

const githubProfile = Effect.fn("OAuthProviders.githubProfile")(function* (accessToken: string) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "toon-recipe",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const userResponse = yield* attempt(() => fetch("https://api.github.com/user", { headers }));
  if (!userResponse.ok) {
    return yield* oauthFailed("server.auth.githubProfileUnavailable");
  }
  const user = parseGitHubUser(yield* attempt((): Promise<unknown> => userResponse.json()));
  if (user === undefined) {
    return yield* oauthFailed("server.auth.githubProfileIncomplete");
  }

  let email = user.email?.trim().toLowerCase() ?? null;
  let emailVerified = false;

  // The public profile e-mail may be hidden; /user/emails needs `user:email`.
  const emailsResponse = yield* attempt(() => fetch("https://api.github.com/user/emails", { headers }));
  if (emailsResponse.ok) {
    const emails = parseGitHubEmails(yield* attempt((): Promise<unknown> => emailsResponse.json()));
    if (emails !== undefined) {
      const primary =
        emails.find((entry) => entry.primary === true && entry.verified === true) ??
        emails.find((entry) => entry.verified === true);
      if (primary) {
        email = primary.email.trim().toLowerCase();
        emailVerified = true;
      }
    }
  }

  const profile: OAuthProfile = {
    provider: "github",
    providerUserId: String(user.id),
    email,
    emailVerified,
    name: user.name ?? user.login,
    avatarUrl: user.avatar_url ?? null,
  };
  return profile;
});

/** The provider operations that can fail: the configuration check and the code exchange. */
export class OAuthProviders extends Context.Service<
  OAuthProviders,
  {
    /** 400 `oauth_not_configured` unless the provider's client id and secret are set. */
    readonly requireProviderConfigured: (provider: OAuthProvider) => Effect.Effect<void, ApiFailure>;
    /**
     * Exchanges the authorization code and loads the user profile. A provider refusal is 400 `oauth_failed`; a
     * network failure is an `OAuthTransportError` (the callers turn both into a redirect back to the web app).
     */
    readonly exchangeCodeForProfile: (
      provider: OAuthProvider,
      code: string,
      codeVerifier: string | undefined,
    ) => Effect.Effect<OAuthProfile, ApiFailure | OAuthTransportError>;
  }
>()("toon/api/lib/oauth/OAuthProviders") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* AppConfig;

      const requireConfigured = Effect.fn("OAuthProviders.requireProviderConfigured")(function* (
        provider: OAuthProvider,
      ) {
        yield* checkProviderConfigured(provider, config);
      });

      const exchangeCodeForProfile = Effect.fn("OAuthProviders.exchangeCodeForProfile")(function* (
        provider: OAuthProvider,
        code: string,
        codeVerifier: string | undefined,
      ) {
        yield* checkProviderConfigured(provider, config);

        if (provider === "google") {
          if (!codeVerifier) {
            return yield* oauthFailed("server.auth.oauthSessionExpired");
          }
          const tokens = yield* validateCode(() => googleClient(config).validateAuthorizationCode(code, codeVerifier));
          // `idToken()` throws when the response carried none — then we fall back to
          // the userinfo endpoint inside googleProfile().
          const idToken = yield* Effect.try(() => tokens.idToken()).pipe(
            Effect.orElseSucceed((): string | undefined => undefined),
          );
          return yield* googleProfile(idToken, tokens.accessToken());
        }

        const tokens = yield* validateCode(() => githubClient(config).validateAuthorizationCode(code));
        return yield* githubProfile(tokens.accessToken());
      });

      return OAuthProviders.of({ requireProviderConfigured: requireConfigured, exchangeCodeForProfile });
    }),
  );
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
