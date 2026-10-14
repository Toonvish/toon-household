/**
 * The finance test harness (toon-finance `apps/api/test/support/harness.ts`, plan M3
 * decision 18): a fake signed-in user (a `sessions` row inserted directly), a thin
 * `app.request()` wrapper, and households built through the real core routes.
 *
 * Decision 18 in three lines:
 * - F's `createHousehold(owner, name)` gave a one-member household that was already a valid
 *   ledger; here finance needs two participants, so the harness's `createHousehold` is
 *   finance-READY: it seats the owner in slot 1 and a hidden "Partner" in slot 2.
 * - The hidden partner never acts (every solo F test books only as the owner), and
 *   `joinAsSecondMember` replaces it in slot 2 by the test's real second person.
 * - `createSoloFinanceHousehold` seeds a ONE-participant ledger directly (unreachable through
 *   the API) for exactly one F regression test (transactions "…only one participant").
 *
 * Every helper uses the shared process `db` (the routes read it; `file::memory:` is per
 * client). Test files still call `runMigrations(db)` in their own `beforeAll`.
 */
import { db } from "../../src/db/client.ts";
import { householdModules, sessions, users } from "../../src/db/schema.ts";
import { nowMs } from "../../src/modules/finance/lib/clock.ts";
import { financeParticipants } from "../../src/modules/finance/schema.ts";
import { assignParticipants } from "../../src/modules/finance/services/participants/participants.service.ts";
import { ensureFinanceHousehold } from "../../src/modules/finance/setup.ts";

export interface TestUser {
  id: string;
  email: string;
  name: string;
  cookie: string;
}

/** Creates a user row (e-mail verified) plus a valid session cookie for it. */
export async function createUser(name: string): Promise<TestUser> {
  const id = crypto.randomUUID();
  const email = `${name.toLowerCase()}.${id.slice(0, 8)}@toon.test`;
  await db.insert(users).values({
    id,
    email,
    name,
    emailVerified: true,
    emailVerifiedAt: Date.now(),
  });
  const sessionId = crypto.randomUUID().replaceAll("-", "");
  await db.insert(sessions).values({ id: sessionId, userId: id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
  return { id, email, name, cookie: `toon_session=${sessionId}` };
}

export interface CallOptions {
  method?: string;
  cookie?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** `app.request()` wrapper: JSON in, `Response` out. No port is bound. */
export async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const { app } = await import("../../src/index.ts");
  const headers: Record<string, string> = { ...options.headers };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

export async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function expectStatus(response: Response, status: number, what: string): Promise<void> {
  if (response.status !== status) {
    throw new Error(`${what} failed: ${response.status} ${await response.text()}`);
  }
}

/** POST /api/households only: a household owned by `user` with the default modules (finance NOT enabled). */
export async function createPlainHousehold(user: TestUser, name: string): Promise<string> {
  const response = await call("/api/households", { method: "POST", cookie: user.cookie, body: { name } });
  await expectStatus(response, 201, "createPlainHousehold");
  const payload = await body<{ household: { id: string } }>(response);
  return payload.household.id;
}

/** `member` joins `householdId` through the core invite + accept (role "member"); no finance seat. */
export async function addMember(owner: TestUser, householdId: string, member: TestUser): Promise<void> {
  const invite = await call(`/api/households/${householdId}/invites`, {
    method: "POST",
    cookie: owner.cookie,
    body: { email: member.email, role: "member" },
  });
  await expectStatus(invite, 201, "addMember invite");
  const { inviteUrl } = await body<{ inviteUrl: string }>(invite);
  const token = inviteUrl.split("/").at(-1) ?? "";
  const accept = await call("/api/households/invites/accept", {
    method: "POST",
    cookie: member.cookie,
    body: { token },
  });
  await expectStatus(accept, 200, "addMember accept");
}

/** POST …/modules/finance with the participants body (slot1 → 1, slot2 → 2). Asserts nothing. */
export async function enableFinance(
  owner: TestUser,
  householdId: string,
  slot1: TestUser,
  slot2: TestUser,
): Promise<Response> {
  return call(`/api/households/${householdId}/modules/finance`, {
    method: "POST",
    cookie: owner.cookie,
    body: {
      settings: {
        participants: [
          { userId: slot1.id, memberSlot: 1 },
          { userId: slot2.id, memberSlot: 2 },
        ],
      },
    },
  });
}

/**
 * F's `createHousehold`, finance-ready (decision 18): POST /api/households (the core hook
 * seeds the 21 categories and `finance_settings`), a hidden "Partner" joins through invite +
 * accept, then finance is enabled with owner → slot 1 and partner → slot 2 (which writes the
 * plan row from the module clock: pin it with `setClockForTest` BEFORE this call). Returns
 * the household id, like F's.
 */
export async function createHousehold(owner: TestUser, name: string): Promise<string> {
  const householdId = await createPlainHousehold(owner, name);
  const partner = await createUser("Partner");
  await addMember(owner, householdId, partner);
  const enabled = await enableFinance(owner, householdId, owner, partner);
  await expectStatus(enabled, 200, "createHousehold enable finance");
  return householdId;
}

/**
 * F's `joinAsSecondMember`: `member` joins through invite + accept and takes slot 2 from the
 * hidden partner of {@link createHousehold} (which stays a plain household member). Call it
 * BEFORE the household books anything: the hidden partner may not leave its slot once a row
 * names it (`409 finance_participant_in_use`).
 */
export async function joinAsSecondMember(owner: TestUser, householdId: string, member: TestUser): Promise<void> {
  await addMember(owner, householdId, member);
  await assignParticipants(db, householdId, [
    { userId: owner.id, memberSlot: 1 },
    { userId: member.id, memberSlot: 2 },
  ]);
}

/**
 * A ONE-participant ledger, seeded directly (decision 18): one participant cannot be reached
 * through the API (onEnable needs two). Exists only for F's regression test "?kind=THEIRS_SPLIT/
 * TRANSFER match nothing while the ledger has only one participant"; use `createHousehold`
 * everywhere else.
 */
export async function createSoloFinanceHousehold(user: TestUser, name: string): Promise<string> {
  const householdId = await createPlainHousehold(user, name);
  await db.insert(financeParticipants).values({
    householdId,
    userId: user.id,
    memberSlot: 1,
    displayName: user.name,
    joinedAt: nowMs(),
  });
  await db.insert(householdModules).values({ householdId, moduleId: "finance", enabledAt: nowMs(), settings: null });
  await ensureFinanceHousehold(db, householdId);
  return householdId;
}
