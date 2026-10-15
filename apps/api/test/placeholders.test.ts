/**
 * Placeholder members and claim invites in the core (ADR 0006, plan m3b decisions 2-4, task
 * T05): toon-finance's `apps/api/test/placeholders.test.ts` (b1b517d, 1715207), case by case
 * (plan m3b section 2). Where H's rule differs from F's the test asserts H's rule and its title
 * names F's case. The finance-seat cases (the placeholder in slot 2, a third seat, the bookings
 * veto) are `finance-participants.test.ts`'s (T07).
 *
 * Shared `file::memory:` DB through the real app (CLAUDE.md "`file::memory:` is per client");
 * sessions are inserted directly, like `households.test.ts`. Registration goes through
 * `POST /api/auth/register` (rate limits are off under `bun test`).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { serverText, type ServerKey } from "@toon/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { householdInvites, householdMembers, sessions, users } from "../src/db/schema.ts";
import { claimPlaceholderUser } from "../src/core/services/auth/users.ts";
import { type MailMessage, type Mailer, setMailer } from "../src/core/services/mail/index.ts";
import { ApiError } from "../src/lib/errors.ts";

await runMigrations(db);

const PASSWORD = "correct horse battery";

interface TestUser {
  id: string;
  email: string;
  name: string;
  cookie: string;
}

/** A verified account plus a session cookie (households.test.ts's harness). */
async function createUser(name: string): Promise<TestUser> {
  const id = crypto.randomUUID();
  const email = `${name.toLowerCase()}.${id.slice(0, 8)}@toon.test`;
  await db.insert(users).values({ id, email, name, emailVerified: true, emailVerifiedAt: Date.now() });
  const sessionId = crypto.randomUUID().replaceAll("-", "");
  await db.insert(sessions).values({ id: sessionId, userId: id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
  return { id, email, name, cookie: `toon_session=${sessionId}` };
}

interface RequestOptions {
  method?: string;
  cookie?: string;
  body?: unknown;
}

async function call(path: string, options: RequestOptions = {}): Promise<Response> {
  const { app } = await import("../src/index.ts");
  const headers: Record<string, string> = {};
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface ErrorPayload {
  error: { code: string; message: string };
}
interface Member {
  id: string;
  userId: string;
  role: string;
  hasAccount: boolean;
  user: { id: string; name: string; email: string | null };
}
interface InviteResponse {
  invite: { id: string; token: string; email: string | null; role: string; status: string; claimsUserId: string | null };
  inviteUrl: string;
  emailSent?: boolean;
  mailDelivery?: string;
}
interface Detail {
  household: { memberCount: number };
  members: Member[];
}

function expectServerText(payload: ErrorPayload, key: ServerKey): void {
  expect([serverText("de", key), serverText("en", key)]).toContain(payload.error.message);
}

async function createHousehold(owner: TestUser, name: string): Promise<string> {
  const response = await call("/api/households", { method: "POST", cookie: owner.cookie, body: { name } });
  expect(response.status).toBe(201);
  return (await body<{ household: { id: string } }>(response)).household.id;
}

/** Joins `user` to the household directly with `role` (no invite round trip needed here). */
async function addMember(householdId: string, user: TestUser, role: "admin" | "member"): Promise<void> {
  await db.insert(householdMembers).values({ id: crypto.randomUUID(), householdId, userId: user.id, role });
}

async function addPlaceholder(cookie: string, householdId: string, displayName = "Sandy"): Promise<Member> {
  const response = await call(`/api/households/${householdId}/members`, { method: "POST", cookie, body: { displayName } });
  expect(response.status).toBe(201);
  return (await body<{ member: Member }>(response)).member;
}

async function createClaimInvite(
  cookie: string,
  householdId: string,
  claimsUserId: string,
  extra: Record<string, unknown> = {},
): Promise<InviteResponse> {
  const response = await call(`/api/households/${householdId}/invites`, {
    method: "POST",
    cookie,
    body: { claimsUserId, ...extra },
  });
  expect(response.status).toBe(201);
  return body<InviteResponse>(response);
}

async function register(email: string, inviteToken: string, name = "Sandy"): Promise<Response> {
  return call("/api/auth/register", { method: "POST", body: { email, name, password: PASSWORD, inviteToken } });
}

function freshEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@toon.test`;
}

async function userRow(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

async function inviteRow(id: string) {
  const [row] = await db.select().from(householdInvites).where(eq(householdInvites.id, id));
  return row;
}

afterEach(() => setMailer(null));

describe("POST /api/households/:householdId/members (placeholder)", () => {
  test("F: seats a person without an account in slot 2 (H: an admin adds a placeholder member, 201, hasAccount false, email null)", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Platzhalter");

    const response = await call(`/api/households/${householdId}/members`, {
      method: "POST",
      cookie: owner.cookie,
      body: { displayName: "  Sandy " },
    });
    expect(response.status).toBe(201);
    const { member } = await body<{ member: Member }>(response);
    expect(response.headers.get("Location")).toBe(`/api/households/${householdId}/members/${member.userId}`);
    expect(member.role).toBe("member");
    expect(member.hasAccount).toBe(false);
    expect(member.user.email).toBeNull();
    expect(member.user.name).toBe("Sandy");

    const detail = await body<Detail>(await call(`/api/households/${householdId}`, { cookie: owner.cookie }));
    expect(detail.household.memberCount).toBe(2);
    expect(detail.members.map((m) => m.hasAccount)).toEqual([true, false]);

    // Decision 1: no e-mail, no password, nothing confirmed; lands in its household once claimed.
    const row = await userRow(member.userId);
    expect(row?.email).toBeNull();
    expect(row?.passwordHash).toBeNull();
    expect(row?.emailVerified).toBe(false);
    expect(row?.emailVerifiedAt).toBeNull();
    expect(row?.avatarUrl).toBeNull();
    expect(row?.activeHouseholdId).toBe(householdId);
  });

  test("a plain member cannot add a placeholder (403) and an empty name is 422", async () => {
    const owner = await createUser("Owner");
    const plain = await createUser("Plain");
    const householdId = await createHousehold(owner, "Rechte");
    await addMember(householdId, plain, "member");

    const forbidden = await call(`/api/households/${householdId}/members`, {
      method: "POST",
      cookie: plain.cookie,
      body: { displayName: "Sandy" },
    });
    expect(forbidden.status).toBe(403);

    const invalid = await call(`/api/households/${householdId}/members`, {
      method: "POST",
      cookie: owner.cookie,
      body: { displayName: "   " },
    });
    expect(invalid.status).toBe(422);
    expect((await body<ErrorPayload>(invalid)).error.code).toBe("validation_failed");
  });

  test("F: a third seat is still 409 household_full, and a plain invite is refused too (H: plain e-mail invite in a household with a placeholder is 201, D1)", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Viele");
    await addPlaceholder(owner.cookie, householdId, "Sandy");
    // D1: N members; the core has no "household full" (finance's two seats are T07's).
    await addPlaceholder(owner.cookie, householdId, "Dritte");

    const invite = await call(`/api/households/${householdId}/invites`, {
      method: "POST",
      cookie: owner.cookie,
      body: { email: freshEmail("plain") },
    });
    expect(invite.status).toBe(201);
    const payload = await body<InviteResponse>(invite);
    expect(payload.invite.claimsUserId).toBeNull();

    const detail = await body<Detail>(await call(`/api/households/${householdId}`, { cookie: owner.cookie }));
    expect(detail.household.memberCount).toBe(3);
  });

  test("F: the other member may rename and remove the placeholder, but never a real member (H: an admin renames and removes it; an account is 409 member_has_account; a plain member is 403)", async () => {
    const owner = await createUser("Owner");
    const admin = await createUser("Admin");
    const plain = await createUser("Plain");
    const householdId = await createHousehold(owner, "Pflege");
    await addMember(householdId, admin, "admin");
    await addMember(householdId, plain, "member");
    const placeholder = await addPlaceholder(owner.cookie, householdId);

    const renamed = await call(`/api/households/${householdId}/members/${placeholder.userId}/placeholder`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { name: "Sandra" },
    });
    expect(renamed.status).toBe(200);
    const { member } = await body<{ member: Member }>(renamed);
    expect(member.user.name).toBe("Sandra");
    expect(member.hasAccount).toBe(false);

    // A member with an account names themselves.
    const account = await call(`/api/households/${householdId}/members/${plain.id}/placeholder`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { name: "Umbenannt" },
    });
    expect(account.status).toBe(409);
    expect((await body<ErrorPayload>(account)).error.code).toBe("member_has_account");
    expect((await userRow(plain.id))?.name).toBe("Plain");

    const stranger = await call(`/api/households/${householdId}/members/${crypto.randomUUID()}/placeholder`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { name: "Niemand" },
    });
    expect(stranger.status).toBe(404);

    // A plain member manages nobody.
    const plainRename = await call(`/api/households/${householdId}/members/${placeholder.userId}/placeholder`, {
      method: "PATCH",
      cookie: plain.cookie,
      body: { name: "Nope" },
    });
    expect(plainRename.status).toBe(403);
    const plainRemove = await call(`/api/households/${householdId}/members/${placeholder.userId}`, {
      method: "DELETE",
      cookie: plain.cookie,
    });
    expect(plainRemove.status).toBe(403);

    // Removing it deletes the user row, and its claim invite goes with it (ON DELETE cascade).
    const claim = await createClaimInvite(owner.cookie, householdId, placeholder.userId);
    const removed = await call(`/api/households/${householdId}/members/${placeholder.userId}`, {
      method: "DELETE",
      cookie: admin.cookie,
    });
    expect(removed.status).toBe(204);
    expect(await userRow(placeholder.userId)).toBeUndefined();
    expect(await inviteRow(claim.invite.id)).toBeUndefined();

    // Removing a real member keeps their account (they may belong elsewhere).
    const removedPlain = await call(`/api/households/${householdId}/members/${plain.id}`, {
      method: "DELETE",
      cookie: admin.cookie,
    });
    expect(removedPlain.status).toBe(204);
    expect((await userRow(plain.id))?.id).toBe(plain.id);
  });

  test("a placeholder keeps the member role (409 server.household.placeholderRole)", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Rolle");
    const placeholder = await addPlaceholder(owner.cookie, householdId);

    for (const role of ["admin", "owner"] as const) {
      const response = await call(`/api/households/${householdId}/members/${placeholder.userId}`, {
        method: "PATCH",
        cookie: owner.cookie,
        body: { role },
      });
      expect(response.status).toBe(409);
      const payload = await body<ErrorPayload>(response);
      expect(payload.error.code).toBe("conflict");
      expectServerText(payload, "server.household.placeholderRole");
    }

    const [membership] = await db
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, placeholder.userId)));
    expect(membership?.role).toBe("member");
    const [ownerRow] = await db
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, owner.id)));
    expect(ownerRow?.role).toBe("owner");

    // The unchanged role is a no-op, not a refusal.
    const same = await call(`/api/households/${householdId}/members/${placeholder.userId}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { role: "member" },
    });
    expect(same.status).toBe(200);
  });

  test("deleting the household deletes its placeholder users, never its accounts", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Weg");
    const first = await addPlaceholder(owner.cookie, householdId, "Eins");
    const second = await addPlaceholder(owner.cookie, householdId, "Zwei");
    await createClaimInvite(owner.cookie, householdId, first.userId);

    const deleted = await call(`/api/households/${householdId}`, { method: "DELETE", cookie: owner.cookie });
    expect(deleted.status).toBe(204);
    expect(await userRow(first.userId)).toBeUndefined();
    expect(await userRow(second.userId)).toBeUndefined();
    expect((await userRow(owner.id))?.id).toBe(owner.id);
  });
});

describe("claim invites", () => {
  test("F: registering with a claim token turns the placeholder into the account — same user id", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Claim");
    const placeholder = await addPlaceholder(owner.cookie, householdId);

    const created = await createClaimInvite(owner.cookie, householdId, placeholder.userId, { role: "admin" });
    expect(created.invite.claimsUserId).toBe(placeholder.userId);
    expect(created.invite.email).toBeNull();
    // Always `member`, whatever the request said; nothing to mail without an address.
    expect(created.invite.role).toBe("member");
    expect(created.emailSent).toBe(false);
    expect(created.mailDelivery).toBeUndefined();

    const preview = await call(`/api/households/invites/${created.invite.token}`);
    expect(preview.status).toBe(200);
    const previewBody = await body<{ claimsDisplayName: string | null; email: string | null }>(preview);
    expect(previewBody.claimsDisplayName).toBe("Sandy");
    expect(previewBody.email).toBeNull();

    const email = freshEmail("Sandy");
    const registered = await register(email, created.invite.token, "Sandy Sommer");
    expect(registered.status).toBe(201);
    const session = await body<{
      user: { id: string; email: string; name: string; emailVerified: boolean };
      activeHouseholdId: string | null;
      households: Array<{ id: string; role: string }>;
    }>(registered);
    expect(session.user.id).toBe(placeholder.userId);
    expect(session.user.email).toBe(email.toLowerCase());
    expect(session.user.name).toBe("Sandy Sommer");
    expect(session.user.emailVerified).toBe(false);
    expect(session.activeHouseholdId).toBe(householdId);
    // No household of its own: the claimed account is a member of the inviting household only.
    expect(session.households.map((h) => [h.id, h.role])).toEqual([[householdId, "member"]]);

    const row = await userRow(placeholder.userId);
    expect(row?.emailVerifiedAt).toBeNull();
    expect(row?.passwordHash).not.toBeNull();
    const invite = await inviteRow(created.invite.id);
    expect(invite?.status).toBe("accepted");
    expect(invite?.acceptedBy).toBe(placeholder.userId);

    const login = await call("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
    expect(login.status).toBe(200);

    const detail = await body<Detail>(await call(`/api/households/${householdId}`, { cookie: owner.cookie }));
    expect(detail.members.find((m) => m.userId === placeholder.userId)?.hasAccount).toBe(true);

    // The link is spent: a second registration onto it must not touch the account (F gotcha 55).
    const again = await register(freshEmail("other"), created.invite.token, "X");
    expect(again.status).toBe(404);
    expect((await body<ErrorPayload>(again)).error.code).toBe("invite_invalid");
    expect((await userRow(placeholder.userId))?.email).toBe(email.toLowerCase());

    // The claimed account replaying the accept is the one caller let through (idempotent).
    const cookie = (registered.headers.getSetCookie().find((c) => c.startsWith("toon_session=")) ?? "").split(";")[0] ?? "";
    const replay = await call("/api/households/invites/accept", {
      method: "POST",
      cookie,
      body: { token: created.invite.token },
    });
    expect(replay.status).toBe(200);
    expect((await body<{ member: Member }>(replay)).member.userId).toBe(placeholder.userId);
  });

  test("a new claim invite revokes the older one, a plain invite never does, and an address is mailed", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Links");
    const placeholder = await addPlaceholder(owner.cookie, householdId);
    const address = freshEmail("sandy");

    const first = await createClaimInvite(owner.cookie, householdId, placeholder.userId, { email: address });
    const plain = await call(`/api/households/${householdId}/invites`, {
      method: "POST",
      cookie: owner.cookie,
      body: { email: address },
    });
    expect(plain.status).toBe(201);
    expect((await inviteRow(first.invite.id))?.status).toBe("pending");

    const sent: MailMessage[] = [];
    const relay: Mailer = {
      name: "smtp",
      async send(message: MailMessage) {
        sent.push(message);
      },
    };
    setMailer(relay);
    const second = await createClaimInvite(owner.cookie, householdId, placeholder.userId, { email: address });
    expect(second.invite.email).toBe(address.toLowerCase());
    expect(second.mailDelivery).toBe("sent");
    expect(sent.map((message) => message.to)).toEqual([address.toLowerCase()]);
    expect((await inviteRow(first.invite.id))?.status).toBe("revoked");
    expect((await inviteRow(second.invite.id))?.status).toBe("pending");

    const revoked = await register(freshEmail("late"), first.invite.token);
    expect(revoked.status).toBe(404);
  });

  test("a claim invite needs an e-mail or claimsUserId (422)", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Leer");
    const response = await call(`/api/households/${householdId}/invites`, { method: "POST", cookie: owner.cookie, body: {} });
    expect(response.status).toBe(422);
    expect((await body<ErrorPayload>(response)).error.code).toBe("validation_failed");
  });

  test("F: an existing account cannot accept a claim invite (409 invite_claim_requires_register)", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Fremd");
    const placeholder = await addPlaceholder(owner.cookie, householdId);
    const created = await createClaimInvite(owner.cookie, householdId, placeholder.userId);

    const stranger = await createUser("Stranger");
    const accept = await call("/api/households/invites/accept", {
      method: "POST",
      cookie: stranger.cookie,
      body: { token: created.invite.token },
    });
    expect(accept.status).toBe(409);
    const payload = await body<ErrorPayload>(accept);
    expect(payload.error.code).toBe("invite_claim_requires_register");
    expectServerText(payload, "server.invite.claimRequiresRegister");

    // Not even a member of the household may burn the link.
    const byOwner = await call("/api/households/invites/accept", {
      method: "POST",
      cookie: owner.cookie,
      body: { token: created.invite.token },
    });
    expect(byOwner.status).toBe(409);
    expect((await inviteRow(created.invite.id))?.status).toBe("pending");
    const [strangerMembership] = await db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, stranger.id)));
    expect(strangerMembership).toBeUndefined();
  });

  test("F: a claim invite for a member who already has an account is 409 member_has_account (+ a stranger's id is 404)", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Konto");
    const refused = await call(`/api/households/${householdId}/invites`, {
      method: "POST",
      cookie: owner.cookie,
      body: { claimsUserId: owner.id },
    });
    expect(refused.status).toBe(409);
    expect((await body<ErrorPayload>(refused)).error.code).toBe("member_has_account");

    // A placeholder of ANOTHER household is a stranger here.
    const other = await createUser("Other");
    const otherHousehold = await createHousehold(other, "Anderswo");
    const foreign = await addPlaceholder(other.cookie, otherHousehold);
    for (const claimsUserId of [crypto.randomUUID(), foreign.userId]) {
      const response = await call(`/api/households/${householdId}/invites`, {
        method: "POST",
        cookie: owner.cookie,
        body: { claimsUserId },
      });
      expect(response.status).toBe(404);
    }
  });

  test("F: a placeholder cannot log in and a taken address is 409 email_taken on claim", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Login");
    const placeholder = await addPlaceholder(owner.cookie, householdId);
    const created = await createClaimInvite(owner.cookie, householdId, placeholder.userId);

    // Nothing to log in with: no address to look up, no hash to verify (decision 1).
    const row = await userRow(placeholder.userId);
    expect(row?.email).toBeNull();
    expect(row?.passwordHash).toBeNull();
    const [sessionRow] = await db.select().from(sessions).where(eq(sessions.userId, placeholder.userId));
    expect(sessionRow).toBeUndefined();

    const taken = await register(owner.email, created.invite.token);
    expect(taken.status).toBe(409);
    expect((await body<ErrorPayload>(taken)).error.code).toBe("email_taken");
    const untouched = await userRow(placeholder.userId);
    expect(untouched?.email).toBeNull();
    expect(untouched?.passwordHash).toBeNull();
    expect((await inviteRow(created.invite.id))?.status).toBe("pending");

    // claimPlaceholderUser maps the unique index itself too (a race past the pre-check).
    const raced = await claimPlaceholderUser(db, placeholder.userId, {
      email: owner.email,
      name: "Sandy",
      passwordHash: "$argon2id$x",
    }).catch((error: unknown) => error);
    expect(raced).toBeInstanceOf(ApiError);
    expect((raced as ApiError).code).toBe("email_taken");
    expect((await userRow(placeholder.userId))?.passwordHash).toBeNull();
  });

  test("two claims of the same placeholder race: exactly one wins (F gotcha 72, one conditional UPDATE)", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Rennen");
    const placeholder = await addPlaceholder(owner.cookie, householdId);

    const emails = [freshEmail("a"), freshEmail("b")];
    const results = await Promise.allSettled(
      emails.map((email) => claimPlaceholderUser(db, placeholder.userId, { email, name: "Sandy", passwordHash: `$argon2id$${email}` })),
    );
    const winners = results.filter((result) => result.status === "fulfilled");
    const losers = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0]?.reason as ApiError).code).toBe("member_has_account");
    const winnerIndex = results.findIndex((result) => result.status === "fulfilled");
    const row = await userRow(placeholder.userId);
    expect(row?.email).toBe(emails[winnerIndex]?.toLowerCase());
    expect(row?.passwordHash).toBe(`$argon2id$${emails[winnerIndex]}`);

    // Through the route: two registrations onto one claim link, one 201, the other refused.
    const second = await addPlaceholder(owner.cookie, householdId, "Zweite");
    const created = await createClaimInvite(owner.cookie, householdId, second.userId);
    const responses = await Promise.all([
      register(freshEmail("c"), created.invite.token),
      register(freshEmail("d"), created.invite.token),
    ]);
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses[0]).toBe(201);
    expect([404, 409]).toContain(statuses[1] ?? 0);
  });
});
