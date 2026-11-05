/**
 * Integration tests for authentication + authorization.
 *
 * Runs against the SHARED in-memory database (NODE_ENV=test forces
 * DATABASE_URL="file::memory:", see src/env.ts) because the routers import
 * `db` from src/db/client.ts. Migrations are applied once, here.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { householdInvites, householdMembers, oauthAccounts, sessions, users } from "../src/db/schema.ts";
import { app } from "../src/index.ts";
import { SESSION_COOKIE, SESSION_TTL_MS } from "../src/lib/cookies.ts";
import { CurrentMembership } from "../src/http/context.ts";
import {
  chain,
  coreApi,
  RequireHouseholdAdmin,
  RequireHouseholdMember,
  RequireHouseholdOwner,
  RequireSession,
  UNINTERRUPTIBLE,
} from "../src/http/middleware.ts";
import { json } from "../src/http/response.ts";
import { ApiError } from "../src/lib/errors.ts";
import {
  RequireHouseholdAdminLayer,
  RequireHouseholdMemberLayer,
  RequireHouseholdOwnerLayer,
} from "../src/middleware/household.ts";
import { type OAuthProfile, safeNextPath, webUrl } from "../src/lib/oauth.ts";
import { RequireSessionLayer } from "../src/middleware/session.ts";
import { AuthInvites, generateInviteToken } from "../src/core/services/auth/invites.ts";
import { OAuthAccounts } from "../src/core/services/auth/oauthAccounts.ts";
import { Passwords } from "../src/core/services/auth/passwords.ts";
import { LOGIN_RULE, checkRateLimit, resetRateLimits } from "../src/core/services/auth/rateLimit.ts";
import { sessionHandle } from "../src/core/services/auth/sessions.ts";
import { type CreateUserInput, Users } from "../src/core/services/auth/users.ts";
import { runTest } from "./support/effect.ts";
import { testHttpApp } from "./support/http.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };
const PASSWORD = "geheimes-passwort-123";

beforeAll(async () => {
  await runMigrations(db);
});

/* -------------------------------- helpers -------------------------------- */

function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${crypto.randomUUID()}@toon.test`;
}

/** Extracts the `toon_session=<id>` pair from a Set-Cookie response. */
function sessionCookie(response: Response): string {
  const all = response.headers.getSetCookie();
  const header = all.find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  if (!header) throw new Error(`no ${SESSION_COOKIE} cookie in response`);
  const pair = header.split(";")[0] ?? "";
  return pair;
}

function cookieValue(cookie: string): string {
  return cookie.slice(`${SESSION_COOKIE}=`.length);
}

interface RegisterOptions {
  email?: string;
  name?: string;
  password?: string;
  householdName?: string;
  inviteToken?: string;
}

async function register(options: RegisterOptions = {}): Promise<{
  response: Response;
  email: string;
  password: string;
}> {
  const email = options.email ?? uniqueEmail();
  const password = options.password ?? PASSWORD;
  const body: Record<string, unknown> = {
    email,
    name: options.name ?? "Test Nutzerin",
    password,
  };
  if (options.householdName) body.householdName = options.householdName;
  if (options.inviteToken) body.inviteToken = options.inviteToken;

  const response = await app.request("/api/auth/register", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  return { response, email, password };
}

async function login(email: string, password: string): Promise<Response> {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password }),
  });
}

/** Registers a user and returns their id + session cookie. */
async function registeredUser(): Promise<{ id: string; email: string; cookie: string }> {
  const { response, email } = await register();
  expect(response.status).toBe(201);
  const body = (await response.json()) as { user: { id: string } };
  return { id: body.user.id, email, cookie: sessionCookie(response) };
}

/**
 * Creates a user and a household they own through the `Users` service on the app runtime (plan e2 P14); the invite
 * part uses it since E2-T07.
 */
function userOwningHousehold(input: CreateUserInput, householdName: string) {
  return runTest(
    Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.createUser(input);
      const { householdId } = yield* users.createOwnedHousehold(user.id, householdName);
      return { user, householdId };
    }),
  );
}

/** The `OAuthAccounts` service on the app runtime (plan e2 P14): a typed failure rejects with the error itself. */
function oauthLogin(profile: OAuthProfile) {
  return runTest(OAuthAccounts.use((accounts) => accounts.loginWithOAuthProfile(profile)));
}

/* ------------------------------- register -------------------------------- */

describe("POST /api/auth/register", () => {
  test("creates the user, the first household and a session cookie", async () => {
    const { response, email } = await register({ householdName: "Familie" });
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      user: { id: string; email: string; hasPassword: boolean; activeHouseholdId: string | null };
      households: { id: string; name: string; role: string; memberCount: number; modules: string[] }[];
      activeHouseholdId: string | null;
    };

    expect(body.user.email).toBe(email);
    expect(body.user.hasPassword).toBe(true);
    expect(body.households).toHaveLength(1);
    expect(body.households[0]?.name).toBe("Familie");
    expect(body.households[0]?.role).toBe("owner");
    expect(body.households[0]?.memberCount).toBe(1);
    expect(body.households[0]?.modules).toEqual(["recipe"]);
    expect(body.activeHouseholdId).toBe(body.households[0]?.id ?? null);
    expect(body.user.activeHouseholdId).toBe(body.activeHouseholdId);

    const header = response.headers.getSetCookie().find((v) => v.startsWith(`${SESSION_COOKIE}=`));
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    // NODE_ENV=test -> no Secure flag, otherwise the cookie would be dropped.
    expect(header).not.toContain("Secure");

    // The stored hash is argon2id and never leaves the server.
    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows[0]?.passwordHash?.startsWith("$argon2id$")).toBe(true);
    expect(JSON.stringify(body)).not.toContain("$argon2id$");
  });

  test("normalises the e-mail and rejects a duplicate with 409 email_taken", async () => {
    const email = uniqueEmail("dup");
    const first = await register({ email: `  ${email.toUpperCase()} ` });
    expect(first.response.status).toBe(201);
    const created = (await first.response.json()) as { user: { email: string } };
    expect(created.user.email).toBe(email);

    const second = await register({ email });
    expect(second.response.status).toBe(409);
    const error = (await second.response.json()) as { error: { code: string } };
    expect(error.error.code).toBe("email_taken");
  });

  test("rejects a too short password with 422", async () => {
    const { response } = await register({ password: "kurz" });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_failed");
  });

  test("rejects a malformed body with 422 and a non-JSON body with 400", async () => {
    const missing = await app.request("/api/auth/register", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(missing.status).toBe(422);

    const broken = await app.request("/api/auth/register", {
      method: "POST",
      headers: JSON_HEADERS,
      body: "{",
    });
    expect(broken.status).toBe(400);
  });
});

/* --------------------------------- login --------------------------------- */

describe("POST /api/auth/login", () => {
  test("logs in with the right password", async () => {
    const { email, password } = await register();
    const response = await login(email, password);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { email: string }; households: unknown[] };
    expect(body.user.email).toBe(email);
    expect(body.households).toHaveLength(1);
    expect(sessionCookie(response)).toContain(`${SESSION_COOKIE}=`);
  });

  test("rejects a wrong password and an unknown e-mail identically", async () => {
    const { email } = await register();

    const wrong = await login(email, "falsches-passwort-123");
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_credentials",
    );

    const unknown = await login(uniqueEmail("ghost"), PASSWORD);
    expect(unknown.status).toBe(401);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_credentials",
    );
    expect(unknown.headers.getSetCookie().some((v) => v.startsWith(`${SESSION_COOKIE}=`))).toBe(
      false,
    );
  });

  test("an OAuth-only account gets a clear 401, not a 500", async () => {
    const email = uniqueEmail("oauthonly");
    await userOwningHousehold({ email, name: "Ohne Passwort", passwordHash: null }, "Meine Rezepte");

    const response = await login(email, PASSWORD);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_credentials");
  });
});

/* ------------------------------ me / logout ------------------------------ */

describe("GET /api/auth/me", () => {
  test("returns the bootstrap payload for a valid session", async () => {
    const { cookie, email } = await registeredUser();
    const response = await app.request("/api/auth/me", { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { email: string };
      households: unknown[];
      activeHouseholdId: string | null;
    };
    expect(body.user.email).toBe(email);
    expect(body.households).toHaveLength(1);
    expect(body.activeHouseholdId).not.toBeNull();
  });

  test("401 without a cookie and with a bogus cookie", async () => {
    const anonymous = await app.request("/api/auth/me");
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as { error: { code: string } }).error.code).toBe(
      "unauthorized",
    );

    const bogus = await app.request("/api/auth/me", {
      headers: { cookie: `${SESSION_COOKIE}=does-not-exist` },
    });
    expect(bogus.status).toBe(401);
    // The stale cookie is cleared right away.
    expect(bogus.headers.getSetCookie().some((v) => v.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
  });

  test("an expired session is rejected and deleted", async () => {
    const { id } = await registeredUser();
    const expiredId = "expired-session-id-for-tests";
    await db.insert(sessions).values({
      id: expiredId,
      userId: id,
      expiresAt: Date.now() - 1000,
      createdAt: Date.now() - SESSION_TTL_MS,
      lastUsedAt: Date.now() - 1000,
      ipAddress: null,
      userAgent: null,
    });

    const response = await app.request("/api/auth/me", {
      headers: { cookie: `${SESSION_COOKIE}=${expiredId}` },
    });
    expect(response.status).toBe(401);
    expect(await db.select().from(sessions).where(eq(sessions.id, expiredId))).toHaveLength(0);
  });

  test("a session with less than 15 days left is slid forward", async () => {
    const { id } = await registeredUser();
    const staleId = "sliding-session-id-for-tests";
    const soon = Date.now() + 10 * 24 * 60 * 60 * 1000;
    await db.insert(sessions).values({
      id: staleId,
      userId: id,
      expiresAt: soon,
      createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
      lastUsedAt: Date.now() - 60 * 60 * 1000,
      ipAddress: null,
      userAgent: null,
    });

    const response = await app.request("/api/auth/me", {
      headers: { cookie: `${SESSION_COOKIE}=${staleId}` },
    });
    expect(response.status).toBe(200);
    // Cookie is re-sent with the new expiry...
    expect(response.headers.getSetCookie().some((v) => v.includes(staleId))).toBe(true);
    // ...and the row moved ~30 days into the future.
    const rows = await db.select().from(sessions).where(eq(sessions.id, staleId));
    expect(rows[0]!.expiresAt).toBeGreaterThan(soon + 19 * 24 * 60 * 60 * 1000);
    expect(rows[0]!.lastUsedAt).toBeGreaterThan(Date.now() - 5000);
  });
});

describe("POST /api/auth/logout", () => {
  test("deletes the session row and clears the cookie", async () => {
    const { cookie } = await registeredUser();
    const sessionId = cookieValue(cookie);

    const response = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().some((v) => v.startsWith(`${SESSION_COOKIE}=;`))).toBe(
      true,
    );
    expect(await db.select().from(sessions).where(eq(sessions.id, sessionId))).toHaveLength(0);

    const after = await app.request("/api/auth/me", { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  test("401 without a session", async () => {
    const response = await app.request("/api/auth/logout", { method: "POST" });
    expect(response.status).toBe(401);
  });
});

/* ------------------------------ profile/patch ---------------------------- */

describe("PATCH /api/auth/me", () => {
  test("updates the name", async () => {
    const { cookie } = await registeredUser();
    const response = await app.request("/api/auth/me", {
      method: "PATCH",
      headers: { ...JSON_HEADERS, cookie },
      body: JSON.stringify({ name: "Neuer Name" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { name: string } };
    expect(body.user.name).toBe("Neuer Name");
  });

  test("refuses an activeHouseholdId the user is not a member of", async () => {
    const { cookie } = await registeredUser();
    const { householdId } = await userOwningHousehold(
      { email: uniqueEmail("stranger"), name: "Fremd" },
      "Fremde Gruppe",
    );

    const response = await app.request("/api/auth/me", {
      method: "PATCH",
      headers: { ...JSON_HEADERS, cookie },
      body: JSON.stringify({ activeHouseholdId: householdId }),
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "validation_failed",
    );
  });
});

/* ------------------------------- password -------------------------------- */

describe("POST /api/auth/password", () => {
  test("changes the password, revokes other sessions and keeps the current one", async () => {
    const { email, password } = await register();
    const first = await login(email, password);
    const firstCookie = sessionCookie(first);
    const second = await login(email, password);
    const secondCookie = sessionCookie(second);

    const wrongCurrent = await app.request("/api/auth/password", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: secondCookie },
      body: JSON.stringify({ currentPassword: "falsch-falsch-1", newPassword: "neues-passwort-1" }),
    });
    expect(wrongCurrent.status).toBe(401);

    const changed = await app.request("/api/auth/password", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: secondCookie },
      body: JSON.stringify({ currentPassword: password, newPassword: "neues-passwort-1" }),
    });
    expect(changed.status).toBe(204);

    // Current session still works, the other one is gone.
    expect((await app.request("/api/auth/me", { headers: { cookie: secondCookie } })).status).toBe(
      200,
    );
    expect((await app.request("/api/auth/me", { headers: { cookie: firstCookie } })).status).toBe(
      401,
    );

    expect((await login(email, password)).status).toBe(401);
    expect((await login(email, "neues-passwort-1")).status).toBe(200);
  });

  test("an OAuth-only account may set a password without currentPassword", async () => {
    const email = uniqueEmail("nopass");
    // The account MUST be born from the OAuth flow: a pre-existing local row with
    // the same address is refused on purpose (see the takeover test below).
    const { user, outcome } = await oauthLogin({
      provider: "github",
      providerUserId: `gh-${crypto.randomUUID()}`,
      email,
      emailVerified: true,
      name: "Ohne",
      avatarUrl: null,
    });
    expect(outcome).toBe("created");
    expect(user.passwordHash).toBeNull();

    // Log in through a session created directly (no password login possible).
    const session = await db
      .insert(sessions)
      .values({
        id: `oauth-session-${crypto.randomUUID()}`,
        userId: user.id,
        expiresAt: Date.now() + SESSION_TTL_MS,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        ipAddress: null,
        userAgent: null,
      })
      .returning();
    const cookie = `${SESSION_COOKIE}=${session[0]!.id}`;

    const response = await app.request("/api/auth/password", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie },
      body: JSON.stringify({ newPassword: "erstes-passwort-1" }),
    });
    expect(response.status).toBe(204);
    expect((await login(email, "erstes-passwort-1")).status).toBe(200);
  });
});

/* ------------------------------- sessions -------------------------------- */

describe("session management", () => {
  test("lists sessions with opaque handles and revokes one", async () => {
    const { email, password } = await register();
    const current = await login(email, password);
    const currentCookie = sessionCookie(current);
    const other = await login(email, password);
    const otherId = cookieValue(sessionCookie(other));

    const list = await app.request("/api/auth/sessions", { headers: { cookie: currentCookie } });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: { id: string; current: boolean }[] };
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    expect(body.items.filter((item) => item.current)).toHaveLength(1);
    // Never hand out cookie values.
    expect(body.items.some((item) => item.id === cookieValue(currentCookie))).toBe(false);

    const handle = sessionHandle(otherId);
    const revoked = await app.request(`/api/auth/sessions/${handle}`, {
      method: "DELETE",
      headers: { cookie: currentCookie },
    });
    expect(revoked.status).toBe(204);
    expect(await db.select().from(sessions).where(eq(sessions.id, otherId))).toHaveLength(0);

    const missing = await app.request("/api/auth/sessions/does-not-exist", {
      method: "DELETE",
      headers: { cookie: currentCookie },
    });
    expect(missing.status).toBe(404);
  });

  test("a session of another user cannot be revoked", async () => {
    const victim = await registeredUser();
    const attacker = await registeredUser();
    const handle = sessionHandle(cookieValue(victim.cookie));

    const response = await app.request(`/api/auth/sessions/${handle}`, {
      method: "DELETE",
      headers: { cookie: attacker.cookie },
    });
    expect(response.status).toBe(404);
    expect((await app.request("/api/auth/me", { headers: { cookie: victim.cookie } })).status).toBe(
      200,
    );
  });
});

/* --------------------------------- OAuth --------------------------------- */

describe("OAuth", () => {
  // docs/API.md documents 400 for a provider without credentials (was 501) — but
  // ONLY for ?json=1. A browser navigation must never dead-end on raw JSON on the
  // API origin, so it is bounced back to the login screen, which renders
  // ?error=oauth_not_configured as a German message.
  test("start route answers 400 oauth_not_configured for ?json=1", async () => {
    for (const provider of ["google", "github"]) {
      const response = await app.request(`/api/auth/oauth/${provider}?json=1`);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("oauth_not_configured");
    }
  });

  test("start route redirects a browser back to /login when not configured", async () => {
    for (const provider of ["google", "github"]) {
      const response = await app.request(`/api/auth/oauth/${provider}`);
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("error")).toBe("oauth_not_configured");
    }
  });

  /**
   * OPEN-REDIRECT REGRESSION. The WHATWG URL parser treats "\\" like "/" for
   * http(s) and strips control characters, so a leading-slash check alone let
   * `?next=/\evil.com` resolve to http://evil.com/ — a 302 to the attacker's site
   * immediately after a REAL, successful login.
   */
  test("safeNextPath rejects everything that can escape the origin", () => {
    expect(safeNextPath("/recipes/42")).toBe("/recipes/42");
    expect(safeNextPath("/ok?a=1#b")).toBe("/ok?a=1#b");
    expect(safeNextPath("/\\evil.com")).toBeUndefined();
    expect(safeNextPath("/\tevil.com")).toBeUndefined();
    expect(safeNextPath("/\t/evil.com")).toBeUndefined();
    expect(safeNextPath("/\n/evil.com")).toBeUndefined();
    expect(safeNextPath("//evil.com")).toBeUndefined();
    expect(safeNextPath("https://evil.com")).toBeUndefined();
    expect(safeNextPath("/a b")).toBeUndefined();
    expect(safeNextPath(`/${"x".repeat(300)}`)).toBeUndefined();
  });

  test("webUrl fails closed when a path would leave the configured origin", () => {
    const origin = new URL(webUrl("/")).origin;
    for (const path of ["/\\evil.com", "/\t/evil.com", "//evil.com"]) {
      expect(new URL(webUrl(path)).origin).toBe(origin);
    }
    expect(webUrl("/login", { error: "oauth_failed" })).toBe(
      `${origin}/login?error=oauth_failed`,
    );
  });

  test("an unknown provider is a 404, not a crash", async () => {
    const response = await app.request("/api/auth/oauth/facebook");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  /**
   * ACCOUNT-TAKEOVER REGRESSION.
   *
   * Registration itself cannot prove address ownership — the confirmation-mail
   * flow is a separate, later step — so `users.email_verified` is false for a
   * fresh password account and an OAuth login on a matching address must NOT be
   * linked into it. Otherwise:
   * attacker registers victim@example.com, victim signs in with Google, and the
   * provider identity lands in the attacker's account — who still holds the
   * password and now owns the victim's households.
   */
  test("refuses to link a verified provider e-mail into a pre-registered account", async () => {
    const { email } = await register();
    const existing = (await db.select().from(users).where(eq(users.email, email)))[0]!;
    expect(existing.emailVerified).toBe(false);

    const profile = {
      provider: "google" as const,
      providerUserId: `google-${crypto.randomUUID()}`,
      email,
      emailVerified: true,
      name: "Google Name",
      avatarUrl: "https://example.com/a.png",
    };

    const error = await runTest(Effect.flip(OAuthAccounts.use((accounts) => accounts.loginWithOAuthProfile(profile))));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).code).toBe("email_taken");
    // Nothing was attached to the existing account.
    expect(
      await db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, existing.id)),
    ).toHaveLength(0);
  });

  test("linkOAuthAccount attaches a provider to an authenticated account", async () => {
    const { email } = await register();
    const existing = (await db.select().from(users).where(eq(users.email, email)))[0]!;

    const profile = {
      provider: "google" as const,
      providerUserId: `google-${crypto.randomUUID()}`,
      email,
      emailVerified: true,
      name: "Google Name",
      avatarUrl: "https://example.com/a.png",
    };

    await runTest(OAuthAccounts.use((accounts) => accounts.linkOAuthAccount(existing.id, profile)));
    // Idempotent.
    await runTest(OAuthAccounts.use((accounts) => accounts.linkOAuthAccount(existing.id, profile)));
    expect(
      await db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, existing.id)),
    ).toHaveLength(1);

    // The password stays untouched, so both login paths now work.
    const login = await oauthLogin(profile);
    expect(login.outcome).toBe("login");
    expect(login.user.id).toBe(existing.id);
    expect(login.user.passwordHash).toBe(existing.passwordHash);
  });

  test("a provider identity cannot be linked to two accounts", async () => {
    const first = (await db.select().from(users).where(eq(users.email, (await register()).email)))[0]!;
    const second = (await db.select().from(users).where(eq(users.email, (await register()).email)))[0]!;

    const profile = {
      provider: "github" as const,
      providerUserId: `gh-${crypto.randomUUID()}`,
      email: uniqueEmail("shared"),
      emailVerified: true,
      name: null,
      avatarUrl: null,
    };

    await runTest(OAuthAccounts.use((accounts) => accounts.linkOAuthAccount(first.id, profile)));
    const error = await runTest(
      Effect.flip(OAuthAccounts.use((accounts) => accounts.linkOAuthAccount(second.id, profile))),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as { code: string }).code).toBe("oauth_already_linked");
  });

  test("unlink refuses to remove the only login method", async () => {
    const email = uniqueEmail("only-oauth");
    const { user } = await oauthLogin({
      provider: "google",
      providerUserId: `google-${crypto.randomUUID()}`,
      email,
      emailVerified: true,
      name: null,
      avatarUrl: null,
    });
    expect(user.passwordHash).toBeNull();

    const error = await runTest(
      Effect.flip(OAuthAccounts.use((accounts) => accounts.unlinkOAuthAccount(user, "google"))),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as { code: string }).code).toBe("last_login_method");

    // With a password set it is allowed.
    const withPassword = await runTest(Users.use((service) => service.updateUser(user.id, { passwordHash: "argon2-hash" })));
    await runTest(OAuthAccounts.use((accounts) => accounts.unlinkOAuthAccount(withPassword, "google")));
    expect(
      await db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, user.id)),
    ).toHaveLength(0);
  });

  test("creates a user plus first household for an unknown provider identity", async () => {
    const email = uniqueEmail("fresh-oauth");
    const result = await oauthLogin({
      provider: "github",
      providerUserId: `gh-${crypto.randomUUID()}`,
      email,
      emailVerified: true,
      name: null,
      avatarUrl: null,
    });
    expect(result.outcome).toBe("created");
    expect(result.user.passwordHash).toBeNull();
    expect(result.user.emailVerified).toBe(true);
    expect(result.user.activeHouseholdId).not.toBeNull();

    const memberships = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, result.user.id));
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe("owner");
  });

  test("refuses to take over an address the provider has not verified", async () => {
    const { email } = await register();
    const error = await runTest(
      Effect.flip(
        OAuthAccounts.use((accounts) =>
          accounts.loginWithOAuthProfile({
            provider: "github",
            providerUserId: `gh-${crypto.randomUUID()}`,
            email,
            emailVerified: false,
            name: null,
            avatarUrl: null,
          }),
        ),
      ),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("email_taken");
  });
});

/* -------------------------------- invites -------------------------------- */

describe("household invites", () => {
  async function createInvite(options: { role?: "admin" | "member"; expiresAt?: number } = {}) {
    const { user: inviter, householdId } = await userOwningHousehold(
      { email: uniqueEmail("inviter"), name: "Einladende" },
      "Einladungsgruppe",
    );
    const token = generateInviteToken();
    await db.insert(householdInvites).values({
      id: crypto.randomUUID(),
      householdId,
      email: uniqueEmail("invited"),
      role: options.role ?? "member",
      token,
      status: "pending",
      invitedBy: inviter.id,
      acceptedBy: null,
      expiresAt: options.expiresAt ?? Date.now() + 14 * 24 * 60 * 60 * 1000,
      acceptedAt: null,
      createdAt: Date.now(),
    });
    return { token, householdId, inviterId: inviter.id };
  }

  test("registering with an inviteToken joins that household instead of creating one", async () => {
    const { token, householdId } = await createInvite({ role: "admin" });
    const { response } = await register({ inviteToken: token });
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      user: { id: string };
      households: { id: string; role: string }[];
      activeHouseholdId: string | null;
    };
    expect(body.households).toHaveLength(1);
    expect(body.households[0]?.id).toBe(householdId);
    expect(body.households[0]?.role).toBe("admin");
    expect(body.activeHouseholdId).toBe(householdId);

    const invite = (await db.select().from(householdInvites).where(eq(householdInvites.token, token)))[0]!;
    expect(invite.status).toBe("accepted");
    expect(invite.acceptedBy).toBe(body.user.id);
    expect(invite.acceptedAt).not.toBeNull();
  });

  test("accepting twice is idempotent and keeps the role", async () => {
    const { token, householdId } = await createInvite({ role: "member" });
    const { user, first, second } = await runTest(
      Effect.gen(function* () {
        const user = yield* (yield* Users).createUser({ email: uniqueEmail("joiner"), name: "Beitreter" });
        const invites = yield* AuthInvites;
        const first = yield* invites.acceptInvite(token, user.id);
        const second = yield* invites.acceptInvite(token, user.id);
        return { user, first, second };
      }),
    );
    expect(first.alreadyMember).toBe(false);
    expect(first.householdId).toBe(householdId);

    expect(second.alreadyMember).toBe(true);
    expect(second.memberId).toBe(first.memberId);

    const memberships = await db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, user.id)));
    expect(memberships).toHaveLength(1);
  });

  test("an expired invite is 409 invite_expired, an unknown token 404 invite_invalid", async () => {
    const expired = await createInvite({ expiresAt: Date.now() - 1000 });
    const expiredAttempt = await register({ inviteToken: expired.token });
    expect(expiredAttempt.response.status).toBe(409);
    expect(
      ((await expiredAttempt.response.json()) as { error: { code: string } }).error.code,
    ).toBe("invite_expired");
    const row = (await db.select().from(householdInvites).where(eq(householdInvites.token, expired.token)))[0]!;
    expect(row.status).toBe("expired");

    const unknown = await register({ inviteToken: generateInviteToken() });
    expect(unknown.response.status).toBe(404);
    expect(((await unknown.response.json()) as { error: { code: string } }).error.code).toBe(
      "invite_invalid",
    );

    // The rejected registrations must not have created a user.
    expect(await db.select().from(users).where(eq(users.email, unknown.email))).toHaveLength(0);
  });

  test("a token already redeemed by somebody else is invalid", async () => {
    const { token } = await createInvite();
    const error = await runTest(
      Effect.gen(function* () {
        const users = yield* Users;
        const invites = yield* AuthInvites;
        const first = yield* users.createUser({ email: uniqueEmail("first"), name: "Erste" });
        yield* invites.acceptInvite(token, first.id);

        const second = yield* users.createUser({ email: uniqueEmail("second"), name: "Zweite" });
        return yield* Effect.flip(invites.acceptInvite(token, second.id));
      }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("invite_invalid");
  });
});

/* --------------------------- household authorization -------------------------- */

describe("requireHouseholdRole", () => {
  /** Minimal app that exercises the middleware in isolation. */
  const params = { householdId: Schema.String };
  const GuardedGroup = HttpApiGroup.make("guarded-test").add(
    HttpApiEndpoint.get("getMember", "/member/:householdId", { params }).pipe(
      chain(RequireSession, RequireHouseholdMember),
    ),
    HttpApiEndpoint.get("getAdmin", "/admin/:householdId", { params }).pipe(
      chain(RequireSession, RequireHouseholdAdmin),
    ),
    HttpApiEndpoint.get("getOwner", "/owner/:householdId", { params }).pipe(
      chain(RequireSession, RequireHouseholdOwner),
    ),
  );
  // Same error envelope as the real app (`coreApi` attaches the boundary, as the core APIs do).
  const GuardedApi = coreApi(HttpApi.make("guarded-test").add(GuardedGroup));
  const guardedHandlers = HttpApiBuilder.group(GuardedApi, "guarded-test", (handlers) =>
    handlers
      .handle(
        "getMember",
        Effect.fn("guarded-test.getMember")(function* () {
          return json({ role: (yield* CurrentMembership).role });
        }),
        UNINTERRUPTIBLE,
      )
      .handle(
        "getAdmin",
        Effect.fn("guarded-test.getAdmin")(function* () {
          return json({ ok: true });
        }),
        UNINTERRUPTIBLE,
      )
      .handle(
        "getOwner",
        Effect.fn("guarded-test.getOwner")(function* () {
          return json({ ok: true });
        }),
        UNINTERRUPTIBLE,
      ),
  );
  const guarded = testHttpApp(
    [GuardedApi],
    guardedHandlers,
    Layer.mergeAll(
      RequireSessionLayer,
      RequireHouseholdMemberLayer,
      RequireHouseholdAdminLayer,
      RequireHouseholdOwnerLayer,
    ),
  );

  test("allows a member and exposes the membership", async () => {
    const { cookie } = await registeredUser();
    const me = await app.request("/api/auth/me", { headers: { cookie } });
    const { activeHouseholdId } = (await me.json()) as { activeHouseholdId: string };

    const response = await guarded.request(`/member/${activeHouseholdId}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect((await response.json()) as { role: string }).toEqual({ role: "owner" });
  });

  test("rejects a non-member with 403 and an unknown household with 404", async () => {
    const outsider = await registeredUser();
    const { householdId } = await userOwningHousehold(
      { email: uniqueEmail("owner"), name: "Besitzer" },
      "Geheime Gruppe",
    );

    const forbidden = await guarded.request(`/member/${householdId}`, {
      headers: { cookie: outsider.cookie },
    });
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { error: { code: string } }).error.code).toBe("forbidden");

    const missing = await guarded.request(`/member/${crypto.randomUUID()}`, {
      headers: { cookie: outsider.cookie },
    });
    expect(missing.status).toBe(404);

    const anonymous = await guarded.request(`/member/${householdId}`);
    expect(anonymous.status).toBe(401);
  });

  test("ranks roles: a member may not use admin or owner routes", async () => {
    const { householdId } = await userOwningHousehold(
      { email: uniqueEmail("boss"), name: "Chefin" },
      "Rangfolge",
    );

    const joiner = await registeredUser();
    await db.insert(householdMembers).values({
      id: crypto.randomUUID(),
      householdId,
      userId: joiner.id,
      role: "member",
      createdAt: Date.now(),
    });

    expect(
      (await guarded.request(`/member/${householdId}`, { headers: { cookie: joiner.cookie } })).status,
    ).toBe(200);
    expect(
      (await guarded.request(`/admin/${householdId}`, { headers: { cookie: joiner.cookie } })).status,
    ).toBe(403);
    expect(
      (await guarded.request(`/owner/${householdId}`, { headers: { cookie: joiner.cookie } })).status,
    ).toBe(403);
  });
});

/* ------------------------------ small units ------------------------------ */

describe("primitives", () => {
  test("argon2id hashes verify and reject", async () => {
    await runTest(
      Effect.gen(function* () {
        const passwords = yield* Passwords;
        const hash = yield* passwords.hashPassword(PASSWORD);
        expect(hash.startsWith("$argon2id$")).toBe(true);
        expect(yield* passwords.verifyPassword(PASSWORD, hash)).toBe(true);
        expect(yield* passwords.verifyPassword("etwas-anderes-123", hash)).toBe(false);
        // Missing/garbage hashes must be false, never fail.
        expect(yield* passwords.verifyPassword(PASSWORD, null)).toBe(false);
        expect(yield* passwords.verifyPassword(PASSWORD, "not-a-hash")).toBe(false);
      }),
    );
  });

  test("session handles are stable, opaque and unique", () => {
    const a = sessionHandle("session-a");
    expect(a).toBe(sessionHandle("session-a"));
    expect(a).not.toBe(sessionHandle("session-b"));
    expect(a).not.toContain("session-a");
    expect(a).toHaveLength(32);
  });

  test("the sliding-window rate limiter blocks after the limit", () => {
    resetRateLimits();
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < LOGIN_RULE.limit; i += 1) {
      expect(checkRateLimit(key, LOGIN_RULE).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, LOGIN_RULE);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    resetRateLimits(key);
    expect(checkRateLimit(key, LOGIN_RULE).allowed).toBe(true);
  });
});
