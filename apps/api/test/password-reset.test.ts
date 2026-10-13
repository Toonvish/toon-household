/**
 * Password reset + e-mail confirmation, end to end through the HTTP routes.
 *
 * Runs against the SHARED in-memory database (NODE_ENV=test forces
 * DATABASE_URL="file::memory:"), like test/auth.test.ts. Nothing here touches a
 * transaction, so the libSQL `file::memory:` gotcha in CLAUDE.md does not apply.
 *
 * The mailer is replaced with a recording ConsoleMailer, so the link that a real
 * user would click is read out of the captured message — the tests exercise the
 * same path the mail does.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { emailVerificationTokens, passwordResetTokens, sessions, users } from "../src/db/schema.ts";
import { app } from "../src/index.ts";
import { SESSION_COOKIE } from "../src/lib/cookies.ts";
import {
  EMAIL_VERIFICATION_TTL_MS,
  createEmailVerificationToken,
} from "../src/core/services/auth/emailVerification.ts";
import {
  PASSWORD_RESET_TTL_MS,
  consumePasswordReset,
  createPasswordResetToken,
} from "../src/core/services/auth/passwordReset.ts";
import { hashToken } from "../src/core/services/auth/tokens.ts";
import { ConsoleMailer, type Mailer, setMailer } from "../src/core/services/mail/index.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };
const PASSWORD = "geheimes-passwort-123";
const NEW_PASSWORD = "ein-ganz-neues-passwort-456";

beforeAll(async () => {
  await runMigrations(db);
});

let mailer = new ConsoleMailer(() => undefined);
function useRecordingMailer(): ConsoleMailer {
  mailer = new ConsoleMailer(() => undefined);
  setMailer(mailer);
  return mailer;
}

/**
 * A mailer that is NOT the console one.
 *
 * `mailDelivery` is derived from the transport NAME, not just from whether `send()`
 * resolved — the ConsoleMailer resolves too — so telling "sent" from
 * "not_configured" apart needs a transport that claims to be real.
 */
class FakeRelay implements Mailer {
  readonly name = "smtp";
  constructor(private readonly rejects = false) {}
  async send(): Promise<void> {
    if (this.rejects) throw new Error("relay lehnt ab");
  }
}

afterEach(() => setMailer(null));

/* -------------------------------- helpers -------------------------------- */

function uniqueEmail(prefix = "reset"): string {
  return `${prefix}-${crypto.randomUUID()}@toon.test`;
}

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: cookie === undefined ? JSON_HEADERS : { ...JSON_HEADERS, Cookie: cookie },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  const header = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  if (!header) throw new Error(`no ${SESSION_COOKIE} cookie in response`);
  return header.split(";")[0] ?? "";
}

interface Account {
  email: string;
  userId: string;
  cookie: string;
}

async function register(email = uniqueEmail()): Promise<Account> {
  const response = await post("/api/auth/register", {
    email,
    name: "Test Nutzerin",
    password: PASSWORD,
  });
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { user: { id: string } };
  return { email, userId: payload.user.id, cookie: sessionCookie(response) };
}

/** The token out of the last mail — i.e. exactly what the user would click. */
function tokenFromLastMail(prefix: string): string {
  const last = mailer.sent.at(-1);
  if (!last) throw new Error("no mail was sent");
  const match = new RegExp(`${prefix}/([A-Za-z0-9_-]+)`).exec(last.text);
  if (!match?.[1]) throw new Error(`no ${prefix} link in mail:\n${last.text}`);
  return match[1];
}

async function login(email: string, password: string): Promise<Response> {
  return post("/api/auth/login", { email, password });
}

/* -------------------------------------------------------------------------- */
/* POST /api/auth/password/forgot                                             */
/* -------------------------------------------------------------------------- */

describe("POST /api/auth/password/forgot", () => {
  test("204 + a mail with a working link for a known address", async () => {
    // Registration mails its own confirmation link, so the recorder is installed
    // AFTER it — otherwise `sent` holds two messages and the indexes below shift.
    const account = await register();
    const recorder = useRecordingMailer();

    const response = await post("/api/auth/password/forgot", { email: account.email });

    expect(response.status).toBe(204);
    expect(recorder.sent).toHaveLength(1);
    expect(recorder.sent[0]?.to).toBe(account.email);
    expect(recorder.sent[0]?.text).toContain("/reset-password/");

    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, account.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usedAt).toBeNull();
    // The token itself is NEVER stored — only its digest.
    const token = tokenFromLastMail("reset-password");
    expect(rows[0]?.tokenHash).toBe(hashToken(token));
    expect(rows[0]?.tokenHash).not.toBe(token);
  });

  test("204 and NO mail for an unknown address — no user enumeration", async () => {
    const recorder = useRecordingMailer();

    const response = await post("/api/auth/password/forgot", { email: uniqueEmail("ghost") });

    expect(response.status).toBe(204);
    expect(response.headers.get("content-length")).not.toBe("1");
    expect(recorder.sent).toHaveLength(0);
  });

  test("the response is byte-identical for a known and an unknown address", async () => {
    useRecordingMailer();
    const account = await register();

    const known = await post("/api/auth/password/forgot", { email: account.email });
    const unknown = await post("/api/auth/password/forgot", { email: uniqueEmail("ghost") });

    expect(known.status).toBe(unknown.status);
    expect(await known.text()).toBe(await unknown.text());
  });

  test("a failed send still answers 204 (mail is never load-bearing)", async () => {
    setMailer({
      name: "broken",
      send: async () => {
        throw new Error("provider down");
      },
    });
    const account = await register();

    const response = await post("/api/auth/password/forgot", { email: account.email });
    expect(response.status).toBe(204);
  });

  test("a second request invalidates the first link", async () => {
    useRecordingMailer();
    const account = await register();

    await post("/api/auth/password/forgot", { email: account.email });
    const firstToken = tokenFromLastMail("reset-password");
    await post("/api/auth/password/forgot", { email: account.email });
    const secondToken = tokenFromLastMail("reset-password");
    expect(secondToken).not.toBe(firstToken);

    const stale = await post("/api/auth/password/reset", {
      token: firstToken,
      password: NEW_PASSWORD,
    });
    expect(stale.status).toBe(400);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe(
      "reset_token_invalid",
    );

    const fresh = await post("/api/auth/password/reset", {
      token: secondToken,
      password: NEW_PASSWORD,
    });
    expect(fresh.status).toBe(204);
  });

  test("422 for a malformed address", async () => {
    useRecordingMailer();
    const response = await post("/api/auth/password/forgot", { email: "kein-at-zeichen" });
    expect(response.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/password/reset                                              */
/* -------------------------------------------------------------------------- */

describe("POST /api/auth/password/reset", () => {
  test("happy path: new password works, old one does not", async () => {
    useRecordingMailer();
    const account = await register();
    await post("/api/auth/password/forgot", { email: account.email });
    const token = tokenFromLastMail("reset-password");

    const reset = await post("/api/auth/password/reset", { token, password: NEW_PASSWORD });
    expect(reset.status).toBe(204);

    expect((await login(account.email, PASSWORD)).status).toBe(401);
    expect((await login(account.email, NEW_PASSWORD)).status).toBe(200);
  });

  test("does NOT sign the user in — the client goes to /login", async () => {
    useRecordingMailer();
    const account = await register();
    await post("/api/auth/password/forgot", { email: account.email });

    const reset = await post("/api/auth/password/reset", {
      token: tokenFromLastMail("reset-password"),
      password: NEW_PASSWORD,
    });

    const issued = reset.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${SESSION_COOKIE}=`) && !value.includes("=;"));
    expect(issued).toBeUndefined();
  });

  test("KILLS every existing session — a stolen cookie must not survive", async () => {
    useRecordingMailer();
    const account = await register();

    // The cookie from registration is live before the reset …
    expect((await app.request("/api/auth/me", { headers: { Cookie: account.cookie } })).status).toBe(
      200,
    );

    await post("/api/auth/password/forgot", { email: account.email });
    await post("/api/auth/password/reset", {
      token: tokenFromLastMail("reset-password"),
      password: NEW_PASSWORD,
    });

    // … and dead after it.
    expect((await app.request("/api/auth/me", { headers: { Cookie: account.cookie } })).status).toBe(
      401,
    );
    const rows = await db.select().from(sessions).where(eq(sessions.userId, account.userId));
    expect(rows).toHaveLength(0);
  });

  test("a token cannot be used twice", async () => {
    useRecordingMailer();
    const account = await register();
    await post("/api/auth/password/forgot", { email: account.email });
    const token = tokenFromLastMail("reset-password");

    expect((await post("/api/auth/password/reset", { token, password: NEW_PASSWORD })).status).toBe(
      204,
    );

    const replay = await post("/api/auth/password/reset", { token, password: "noch-ein-passwort-9" });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe(
      "reset_token_invalid",
    );
    // The replay must not have changed anything.
    expect((await login(account.email, NEW_PASSWORD)).status).toBe(200);
  });

  test("an expired token is rejected", async () => {
    const account = await register();
    const { token } = await createPasswordResetToken(db, account.userId);
    await db
      .update(passwordResetTokens)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(passwordResetTokens.tokenHash, hashToken(token)));

    const response = await post("/api/auth/password/reset", { token, password: NEW_PASSWORD });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "reset_token_invalid",
    );
    expect((await login(account.email, PASSWORD)).status).toBe(200);
  });

  test("an unknown token gets the SAME error as an expired one", async () => {
    const account = await register();
    const { token: real } = await createPasswordResetToken(db, account.userId);
    await db
      .update(passwordResetTokens)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(passwordResetTokens.tokenHash, hashToken(real)));

    const expired = await post("/api/auth/password/reset", { token: real, password: NEW_PASSWORD });
    const unknown = await post("/api/auth/password/reset", {
      token: "A".repeat(43),
      password: NEW_PASSWORD,
    });

    expect(unknown.status).toBe(expired.status);
    expect(await unknown.text()).toBe(await expired.text());
  });

  test("422 when the new password is too short (the register rule is reused)", async () => {
    const account = await register();
    const { token } = await createPasswordResetToken(db, account.userId);

    const response = await post("/api/auth/password/reset", { token, password: "kurz" });
    expect(response.status).toBe(422);
    // Still spendable afterwards — a rejected body must not burn the token.
    expect((await post("/api/auth/password/reset", { token, password: NEW_PASSWORD })).status).toBe(
      204,
    );
  });

  test("TTL is one hour, not the invites' fourteen days", async () => {
    const account = await register();
    const before = Date.now();
    const { expiresAt } = await createPasswordResetToken(db, account.userId);
    expect(expiresAt).toBeGreaterThanOrEqual(before + PASSWORD_RESET_TTL_MS - 50);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + PASSWORD_RESET_TTL_MS);
  });

  test("works for an OAuth-only account (it gains a password)", async () => {
    // A row with no password_hash, as loginWithOAuthProfile() creates it.
    const account = await register();
    await db.update(users).set({ passwordHash: null }).where(eq(users.id, account.userId));
    expect((await login(account.email, PASSWORD)).status).toBe(401);

    const { token } = await createPasswordResetToken(db, account.userId);
    expect((await post("/api/auth/password/reset", { token, password: NEW_PASSWORD })).status).toBe(
      204,
    );
    expect((await login(account.email, NEW_PASSWORD)).status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* service-level guarantees                                                   */
/* -------------------------------------------------------------------------- */

describe("consumePasswordReset", () => {
  test("marks the row used, so nothing can be replayed at the service level", async () => {
    const account = await register();
    const { token } = await createPasswordResetToken(db, account.userId);

    await consumePasswordReset(db, token, NEW_PASSWORD);

    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, hashToken(token)));
    expect(rows[0]?.usedAt).not.toBeNull();
    await expect(consumePasswordReset(db, token, NEW_PASSWORD)).rejects.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* e-mail verification                                                        */
/* -------------------------------------------------------------------------- */

describe("e-mail verification", () => {
  test("registration leaves the address UNVERIFIED (this is the takeover fix)", async () => {
    const account = await register();
    const rows = await db.select().from(users).where(eq(users.id, account.userId));
    expect(rows[0]?.emailVerified).toBe(false);
    expect(rows[0]?.emailVerifiedAt).toBeNull();
  });

  /*
    Registration mails the link ITSELF. Without that, an account created on a
    deployment that holds unconfirmed users read-only
    (services/auth/verifiedEmail.ts) would land in an app where nothing can be
    saved and no mail ever explained why — the user would have to go and find the
    resend button on /settings. A gate has to arrive with its own way out.
  */
  test("registering mails a confirmation link without being asked", async () => {
    const recorder = useRecordingMailer();
    const account = await register();

    expect(recorder.sent).toHaveLength(1);
    expect(recorder.sent[0]?.to).toBe(account.email);
    expect(recorder.sent[0]?.text).toContain("/verify-email/");

    // And the link in it actually works — it is a real, spendable token.
    const confirmed = await post("/api/auth/email/verify/confirm", {
      token: tokenFromLastMail("verify-email"),
    });
    expect(confirmed.status).toBe(200);
  });

  test("a failed confirmation mail does not fail the registration", async () => {
    setMailer(new FakeRelay(true));
    const response = await post("/api/auth/register", {
      email: `bounce-${crypto.randomUUID()}@example.com`,
      name: "Unzustellbar",
      password: PASSWORD,
    });
    // 201, and a usable session: the account is committed, the mail is not part
    // of the deal (same rule as every other send — see trySendMail).
    expect(response.status).toBe(201);
    expect(sessionCookie(response).length).toBeGreaterThan(0);
  });

  test("request + confirm sets both the flag and its evidence timestamp", async () => {
    // Recorder AFTER registration: registering already mails a link (see below),
    // and this test is about the one the resend endpoint produces.
    const account = await register();
    const recorder = useRecordingMailer();

    const requested = await post("/api/auth/email/verify/request", {}, account.cookie);
    expect(requested.status).toBe(200);
    expect(recorder.sent).toHaveLength(1);
    expect(recorder.sent[0]?.to).toBe(account.email);

    const confirmed = await post("/api/auth/email/verify/confirm", {
      token: tokenFromLastMail("verify-email"),
    });
    expect(confirmed.status).toBe(200);
    const payload = (await confirmed.json()) as {
      user: { emailVerified: boolean; emailVerifiedAt: string | null };
    };
    expect(payload.user.emailVerified).toBe(true);
    expect(payload.user.emailVerifiedAt).not.toBeNull();

    const rows = await db.select().from(users).where(eq(users.id, account.userId));
    expect(rows[0]?.emailVerified).toBe(true);
    expect(typeof rows[0]?.emailVerifiedAt).toBe("number");
  });

  test("confirming works WITHOUT a session (the link is opened on another device)", async () => {
    useRecordingMailer();
    const account = await register();
    await post("/api/auth/email/verify/request", {}, account.cookie);

    const response = await post("/api/auth/email/verify/confirm", {
      token: tokenFromLastMail("verify-email"),
    });
    expect(response.status).toBe(200);
  });

  test("401 when requesting without a session", async () => {
    const response = await post("/api/auth/email/verify/request", {});
    expect(response.status).toBe(401);
  });

  test("409 when the address is already confirmed", async () => {
    useRecordingMailer();
    const account = await register();
    await post("/api/auth/email/verify/request", {}, account.cookie);
    await post("/api/auth/email/verify/confirm", { token: tokenFromLastMail("verify-email") });

    const again = await post("/api/auth/email/verify/request", {}, account.cookie);
    expect(again.status).toBe(409);
  });

  /*
    The three `mailDelivery` states. The point of the field is that the UI must not
    say "E-Mail unterwegs" when nothing left the machine — and the ConsoleMailer
    RESOLVES, so a plain `delivered` boolean reports exactly that case as a success.
  */
  test('mailDelivery is "not_configured" when no transport is set up', async () => {
    useRecordingMailer(); // a ConsoleMailer: it logs the link and sends nothing
    const account = await register();

    const response = await post("/api/auth/email/verify/request", {}, account.cookie);
    expect(response.status).toBe(200);
    expect((await response.json()) as { mailDelivery: string }).toEqual({
      mailDelivery: "not_configured",
    });
  });

  test('mailDelivery is "sent" when a real transport accepts the message', async () => {
    setMailer(new FakeRelay());
    const account = await register();

    const response = await post("/api/auth/email/verify/request", {}, account.cookie);
    expect(((await response.json()) as { mailDelivery: string }).mailDelivery).toBe("sent");
  });

  test('mailDelivery is "failed" when the transport refuses — and the request still succeeds', async () => {
    setMailer(new FakeRelay(true));
    const account = await register();

    const response = await post("/api/auth/email/verify/request", {}, account.cookie);
    // 200, not a 5xx: the token row is written and usable, so failing the request
    // would throw away a link the operator can still read out of the log.
    expect(response.status).toBe(200);
    expect(((await response.json()) as { mailDelivery: string }).mailDelivery).toBe("failed");

    // Two rows: the one registration minted (superseded, `usedAt` stamped) and the
    // one this request minted. Exactly ONE is still spendable — that is the point,
    // the refused mail must not have thrown the link away.
    const rows = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, account.userId));
    expect(rows.filter((row) => row.usedAt === null)).toHaveLength(1);
  });

  test("a token cannot be reused, and expired/unknown answer the same", async () => {
    const account = await register();
    const row = await db.select().from(users).where(eq(users.id, account.userId));
    const user = row[0];
    if (!user) throw new Error("user vanished");

    const { token } = await createEmailVerificationToken(db, user);
    expect((await post("/api/auth/email/verify/confirm", { token })).status).toBe(200);

    const replay = await post("/api/auth/email/verify/confirm", { token });
    const unknown = await post("/api/auth/email/verify/confirm", { token: "B".repeat(43) });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe(
      "verification_token_invalid",
    );
    expect(unknown.status).toBe(400);
  });

  test("a token minted for an older address cannot verify a new one", async () => {
    const account = await register();
    const row = (await db.select().from(users).where(eq(users.id, account.userId)))[0];
    if (!row) throw new Error("user vanished");
    const { token } = await createEmailVerificationToken(db, row);

    // The address changes after the token was issued.
    await db.update(users).set({ email: uniqueEmail("moved") }).where(eq(users.id, account.userId));

    const response = await post("/api/auth/email/verify/confirm", { token });
    expect(response.status).toBe(400);
    const after = (await db.select().from(users).where(eq(users.id, account.userId)))[0];
    expect(after?.emailVerifiedAt).toBeNull();
  });

  test("an expired token is rejected", async () => {
    const account = await register();
    const row = (await db.select().from(users).where(eq(users.id, account.userId)))[0];
    if (!row) throw new Error("user vanished");
    const { token, expiresAt } = await createEmailVerificationToken(db, row);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + EMAIL_VERIFICATION_TTL_MS);

    await db
      .update(emailVerificationTokens)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(emailVerificationTokens.tokenHash, hashToken(token)));

    expect((await post("/api/auth/email/verify/confirm", { token })).status).toBe(400);
  });

  test("a CONFIRMED address still does not enable OAuth auto-linking", async () => {
    // The whole point of the verification flow is that it does NOT quietly turn
    // auto-linking back on. A provider login on a taken address stays a 409.
    useRecordingMailer();
    const account = await register();
    await post("/api/auth/email/verify/request", {}, account.cookie);
    await post("/api/auth/email/verify/confirm", { token: tokenFromLastMail("verify-email") });

    const { loginWithOAuthProfile } = await import("../src/core/services/auth/oauthAccounts.ts");
    await expect(
      loginWithOAuthProfile(db, {
        provider: "google",
        providerUserId: `sub-${crypto.randomUUID()}`,
        email: account.email,
        emailVerified: true,
        name: "Test Nutzerin",
        avatarUrl: null,
      }),
    ).rejects.toMatchObject({ code: "email_taken" });
  });
});
