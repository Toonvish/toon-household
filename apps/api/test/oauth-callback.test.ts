/**
 * The OAuth callback keeps catch-all semantics (docs/EFFECT.md E6, E7; plan e2 P2, P12; E2-T10).
 *
 * The old callback wrapped its whole body in `try { … } catch (error)`: an `ApiError` chose the redirect's `error` code,
 * ANYTHING else (a TypeError out of `fetch`, a rejected promise, a database failure) was logged
 * `[auth] OAuth callback failed:` and became `oauth_failed`. Its Effect form is `oauthCallbackFlow` recovered by
 * `Effect.catchCause(oauthCallbackRecovery(...))`: `Effect.catch` would see typed failures only and let a defect through as
 * `500 internal_error` JSON. These tests run that exact pair on the app runtime with a fake `OAuthProviders` whose code
 * exchange is the variable part, behind a tiny Hono app that has the API's `onErrorHandler`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { Hono } from "hono";
import { oauthCallbackFlow, oauthCallbackRecovery } from "../src/core/routes/auth.ts";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { clearOAuthCookies, readOAuthCookies } from "../src/lib/cookies.ts";
import { ApiFailure, Conflict, DatabaseError, onErrorHandler } from "../src/lib/errors.ts";
import { type OAuthProfile, OAuthProviders, safeNextPath } from "../src/lib/oauth.ts";
import type { AppEnv } from "../src/lib/types.ts";
import { runtime } from "../src/runtime.ts";

await runMigrations(db);

const STATE = "state-cookie-value";

/** What the fake `exchangeCodeForProfile` does; each test sets it. */
let exchange: () => Effect.Effect<OAuthProfile, ApiFailure | Conflict | DatabaseError>;
let exchangeCalls = 0;

const fakeProviders = OAuthProviders.of({
  requireProviderConfigured: () => Effect.void,
  exchangeCodeForProfile: () => {
    exchangeCalls += 1;
    return exchange() as Effect.Effect<OAuthProfile, ApiFailure>;
  },
});

/** The callback handler of `routes/auth.ts` after the steps before its `try`, with the fake provider service. */
const app = new Hono<AppEnv>();
app.onError(onErrorHandler);
app.get("/cb/:linking?", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const cookies = readOAuthCookies(c);
      clearOAuthCookies(c);
      const next = safeNextPath(cookies.next) ?? "/";
      const linking = cookies.intent === "link";
      return yield* oauthCallbackFlow(c, "google", cookies, next, linking).pipe(
        Effect.catchCause(oauthCallbackRecovery(c, next, linking)),
        Effect.provideService(OAuthProviders, fakeProviders),
      );
    }),
  ),
);

async function callback(query: string, cookie = `toon_oauth_state=${STATE}; toon_oauth_verify=verifier`) {
  const response = await app.request(`/cb${query}`, { headers: { cookie } });
  const location = new URL(response.headers.get("location") ?? "http://missing.invalid/");
  return { response, location };
}

const OK_QUERY = `?code=x&state=${STATE}`;
const LOG_PREFIX = "[auth] OAuth callback failed:";

let errorSpy: ReturnType<typeof spyOn<Console, "error">>;

beforeAll(async () => {
  await runMigrations(db);
});

beforeEach(() => {
  exchangeCalls = 0;
  errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

function loggedFailures(): unknown[][] {
  return errorSpy.mock.calls.filter((args) => args[0] === LOG_PREFIX);
}

describe("OAuth callback recovery (catch-all stays catch-all)", () => {
  test("(a) a plain Error thrown synchronously inside the exchange is a defect: oauth_failed redirect and the log", async () => {
    exchange = () =>
      Effect.sync(() => {
        throw new Error("boom");
      });
    const { response, location } = await callback(OK_QUERY);
    expect(response.status).toBe(302);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("oauth_failed");
    expect(exchangeCalls).toBe(1);
    const logged = loggedFailures();
    expect(logged).toHaveLength(1);
    expect((logged[0]?.[1] as Error).message).toBe("boom");
  });

  test("(b) a rejected promise is a defect too: the same redirect and log", async () => {
    exchange = () => Effect.promise(() => Promise.reject(new Error("x")));
    const { response, location } = await callback(OK_QUERY);
    expect(response.status).toBe(302);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("oauth_failed");
    const logged = loggedFailures();
    expect(logged).toHaveLength(1);
    expect((logged[0]?.[1] as Error).message).toBe("x");
  });

  test("(c) a DatabaseError is outside the family: oauth_failed, logged with its underlying cause", async () => {
    const cause = new Error("SQLITE_BUSY");
    exchange = () => Effect.fail(new DatabaseError({ cause }));
    const { response, location } = await callback(OK_QUERY);
    expect(response.status).toBe(302);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("oauth_failed");
    const logged = loggedFailures();
    expect(logged).toHaveLength(1);
    expect(logged[0]?.[1]).toBe(cause);
  });

  test("(d) a family member chooses the redirect's error code and is not logged", async () => {
    exchange = () =>
      Effect.fail(new ApiFailure({ status: 400, code: "oauth_failed", text: "server.auth.oauthSessionExpired" }));
    const { response, location } = await callback(OK_QUERY);
    expect(response.status).toBe(302);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("oauth_failed");
    expect(loggedFailures()).toHaveLength(0);

    exchange = () => Effect.fail(new Conflict({ code: "email_taken", text: "server.auth.emailTaken" }));
    const taken = await callback(OK_QUERY);
    expect(taken.location.pathname).toBe("/login");
    expect(taken.location.searchParams.get("error")).toBe("email_taken");
    expect(loggedFailures()).toHaveLength(0);
  });

  test("(e) a provider error without a code is oauth_failed, never reaches the exchange and is not logged", async () => {
    exchange = () => Effect.die(new Error("must not be called"));
    const { response, location } = await callback("?error=access_denied");
    expect(response.status).toBe(302);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("oauth_failed");
    expect(exchangeCalls).toBe(0);
    expect(loggedFailures()).toHaveLength(0);
  });

  test("a state that does not match the cookie is oauth_failed without an exchange", async () => {
    exchange = () => Effect.die(new Error("must not be called"));
    const { location } = await callback("?code=x&state=other");
    expect(location.searchParams.get("error")).toBe("oauth_failed");
    expect(exchangeCalls).toBe(0);
    expect(loggedFailures()).toHaveLength(0);
  });

  test("a failed link flow redirects to the cookie's next path with the error, and a link without a session is unauthorized", async () => {
    exchange = () =>
      Effect.sync(() => {
        throw new Error("boom");
      });
    const cookie = `toon_oauth_state=${STATE}; toon_oauth_next=/settings; toon_oauth_intent=link`;
    const failed = await callback(OK_QUERY, cookie);
    expect(failed.location.pathname).toBe("/settings");
    expect(failed.location.searchParams.get("error")).toBe("oauth_failed");
    expect(loggedFailures()).toHaveLength(1);

    errorSpy.mockClear();
    exchange = () =>
      Effect.succeed({
        provider: "google",
        providerUserId: "g-1",
        email: null,
        emailVerified: false,
        name: null,
        avatarUrl: null,
      });
    const anonymous = await callback(OK_QUERY, cookie);
    expect(anonymous.location.pathname).toBe("/settings");
    expect(anonymous.location.searchParams.get("error")).toBe("unauthorized");
    expect(loggedFailures()).toHaveLength(0);
  });
});
