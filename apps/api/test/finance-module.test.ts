/**
 * The finance module's API foundation (plan M3 task T03, decisions 2, 4, 16, 18): the 11
 * prefixed tables, the household hooks, the participants service, the cause-chain
 * `isUniqueViolation` and the finance test harness. The HTTP participants routes are
 * M3-T03b's (`finance-participants.test.ts`).
 *
 * Shared `db` + `runMigrations(db)` (the routes read it; `file::memory:` is per client).
 * DDL and constraint checks go through the shared `@libsql/client`, never `bun:sqlite`.
 * The module clock is pinned per test and handed back in `afterEach` (F gotcha 4).
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { isUniqueViolation } from "../src/core/services/auth/users.ts";
import { resetRateLimits } from "../src/core/services/auth/rateLimit.ts";
import { client, db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { householdMembers, householdModules, households } from "../src/db/schema.ts";
import { app } from "../src/index.ts";
import { ApiError } from "../src/lib/errors.ts";
import { API_MODULES } from "../src/modules/index.ts";
import { financeModule } from "../src/modules/finance/index.ts";
import { setClockForTest } from "../src/modules/finance/lib/clock.ts";
import {
  financeCategories,
  financeFixedCostPlans,
  financeParticipants,
  financeSettings,
  financeTables,
  financeTransactions,
} from "../src/modules/finance/schema.ts";
import {
  assignParticipants,
  type ParticipantAssignmentEntry,
  updateParticipantDisplayName,
} from "../src/modules/finance/services/participants/participants.service.ts";
import {
  addMember,
  body,
  call,
  createHousehold,
  createPlainHousehold,
  createSoloFinanceHousehold,
  createUser,
  enableFinance,
  joinAsSecondMember,
  type TestUser,
} from "./support/finance-harness.ts";

const FINANCE_TABLES = [
  "finance_accrual_runs",
  "finance_categories",
  "finance_fixed_cost_items",
  "finance_fixed_cost_plans",
  "finance_incomes",
  "finance_mutation_claims",
  "finance_participants",
  "finance_settings",
  "finance_tags",
  "finance_transaction_tags",
  "finance_transactions",
];

/** 2026-01-15 12:00 Europe/Berlin (CET = UTC+1). */
const JAN_15_NOON_BERLIN = Date.UTC(2026, 0, 15, 11, 0, 0);

beforeAll(async () => {
  await runMigrations(db);
});

afterEach(() => {
  setClockForTest(null);
});

async function tableNames(): Promise<string[]> {
  const result = await client.execute(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
  );
  return result.rows.map((row) => String(row.name));
}

async function participantsOf(householdId: string) {
  return db
    .select()
    .from(financeParticipants)
    .where(eq(financeParticipants.householdId, householdId))
    .orderBy(financeParticipants.memberSlot);
}

async function planOf(householdId: string) {
  const [row] = await db.select().from(financeFixedCostPlans).where(eq(financeFixedCostPlans.householdId, householdId));
  return row;
}

async function financeModuleRow(householdId: string) {
  const [row] = await db
    .select()
    .from(householdModules)
    .where(and(eq(householdModules.householdId, householdId), eq(householdModules.moduleId, "finance")));
  return row;
}

/** The ApiError a promise rejects with (fails the test when it resolves or throws something else). */
async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("expected a rejection");
}

async function insertTransaction(householdId: string, payerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(financeTransactions).values({
    id,
    householdId,
    payerId,
    splitMode: "SPLIT_EQUAL",
    amountCents: 1_000,
    description: "Einkauf",
    bookedAt: Date.now(),
    dateSource: "day",
    origin: "manual",
    categorySource: "manual",
  });
  return id;
}

describe("manifest", () => {
  test("is registered after recipe and declares its 11 tables", () => {
    expect(API_MODULES.map((module) => module.id)).toEqual(["recipe", "finance"]);
    expect(financeModule.id).toBe("finance");
    expect(financeModule.onHouseholdCreated).toBeDefined();
    expect(financeModule.onEnable).toBeDefined();
    expect(Object.keys(financeTables)).toHaveLength(11);
    expect(Object.keys(financeModule.schema)).toEqual(Object.keys(financeTables));
  });
});

describe("(a) migration", () => {
  test("creates the 11 finance_ tables and no unprefixed finance table", async () => {
    const tables = await tableNames();
    expect(tables.filter((name) => name.startsWith("finance_"))).toEqual(FINANCE_TABLES);
    for (const unprefixed of ["transactions", "categories", "incomes", "fixed_cost_plans", "accrual_runs", "mutation_claims"]) {
      expect(tables).not.toContain(unprefixed);
    }
  });
});

describe("(b) onHouseholdCreated", () => {
  test("registering seeds 21 categories (one fixkosten system row) and finance_settings; finance stays off", async () => {
    resetRateLimits();
    const response = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `fin-${crypto.randomUUID()}@toon.test`,
        name: "Finanz",
        password: "geheimes-passwort-123",
      }),
    });
    expect(response.status).toBe(201);
    const { activeHouseholdId } = (await response.json()) as { activeHouseholdId: string };

    const categories = await db
      .select()
      .from(financeCategories)
      .where(eq(financeCategories.householdId, activeHouseholdId));
    expect(categories).toHaveLength(21);
    const system = categories.filter((row) => row.isSystem);
    expect(system.map((row) => row.slug)).toEqual(["fixkosten"]);
    expect(new Set(categories.map((row) => row.position)).size).toBe(21);

    const settings = await db.select().from(financeSettings).where(eq(financeSettings.householdId, activeHouseholdId));
    expect(settings).toHaveLength(1);
    expect(["de", "en"]).toContain(settings[0]?.defaultLocale ?? "");

    expect(await financeModuleRow(activeHouseholdId)).toBeUndefined();
    expect(await participantsOf(activeHouseholdId)).toEqual([]);
    expect(await planOf(activeHouseholdId)).toBeUndefined();
  });
});

describe("(c) cascade", () => {
  test("deleting a household deletes its finance rows", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Kaskade");
    await insertTransaction(householdId, owner.id);

    await db.delete(households).where(eq(households.id, householdId));

    for (const table of FINANCE_TABLES.filter((name) => name !== "finance_transaction_tags")) {
      const result = await client.execute({
        sql: `select count(*) as n from ${table} where household_id = ?`,
        args: [householdId],
      });
      expect(Number(result.rows[0]?.n)).toBe(0);
    }
  });
});

describe("(d) slot constraints", () => {
  test("the slot CHECK rejects slot 3 and the (household_id, member_slot) index a duplicate slot", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Plätze");
    const extra = await createUser("Extra");

    await expect(
      client.execute({
        sql: "insert into finance_participants (household_id, user_id, member_slot, display_name, joined_at) values (?, ?, 3, 'Drei', 0)",
        args: [householdId, extra.id],
      }),
    ).rejects.toThrow(/CHECK constraint failed/i);

    await expect(
      client.execute({
        sql: "insert into finance_participants (household_id, user_id, member_slot, display_name, joined_at) values (?, ?, 2, 'Zwei', 0)",
        args: [householdId, extra.id],
      }),
    ).rejects.toThrow(/UNIQUE constraint failed/i);

    expect(await participantsOf(householdId)).toHaveLength(2);
  });
});

describe("(e) isUniqueViolation", () => {
  test("sees through the wrapper drizzle puts around every query error", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Wrapper");
    let caught: unknown;
    try {
      // Slot 1 is already the owner's.
      await db.insert(financeParticipants).values({
        householdId,
        userId: owner.id,
        memberSlot: 1,
        displayName: "Doppelt",
        joinedAt: Date.now(),
      });
    } catch (error) {
      caught = error;
    }
    // The thrown object is a `DrizzleQueryError` reading "Failed query: insert
    // into …" — the words "UNIQUE constraint failed" only appear in `.cause`.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toMatch(/unique constraint/i);
    expect(isUniqueViolation(caught)).toBe(true);
  });
});

describe("(f) health", () => {
  test("/api/health lists finance", async () => {
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { modules: string[] }).modules).toContain("finance");
  });
});

describe("(g) the harness's createHousehold", () => {
  test("is finance-ready: owner slot 1, hidden partner slot 2, the plan starts in the pinned period", async () => {
    setClockForTest(JAN_15_NOON_BERLIN);
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Januar");

    expect(await financeModuleRow(householdId)).toBeDefined();
    const seats = await participantsOf(householdId);
    expect(seats.map((row) => row.memberSlot)).toEqual([1, 2]);
    expect(seats[0]?.userId).toBe(owner.id);
    expect(seats[0]?.displayName).toBe("Owner");
    expect(seats[0]?.joinedAt).toBe(JAN_15_NOON_BERLIN);
    const partnerId = seats[1]?.userId ?? "";
    expect(partnerId).not.toBe(owner.id);
    expect(seats[1]?.displayName).toBe("Partner");
    const members = await db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId));
    expect(members.map((row) => row.userId).sort()).toEqual([owner.id, partnerId].sort());

    const plan = await planOf(householdId);
    expect(plan?.enabled).toBe(false);
    expect(plan?.payerId).toBe(owner.id);
    expect(plan?.startPeriod).toBe("2026-01");
    expect(plan?.lastBookedPeriod).toBeNull();
    expect(plan?.createdAt).toBe(JAN_15_NOON_BERLIN);
  });
});

describe("(h) joinAsSecondMember", () => {
  test("seats the member in slot 2; the hidden partner keeps its membership but no slot", async () => {
    const owner = await createUser("Owner");
    const member = await createUser("Robin");
    const householdId = await createHousehold(owner, "Zu zweit");
    const partnerId = (await participantsOf(householdId))[1]?.userId ?? "";

    await joinAsSecondMember(owner, householdId, member);

    const seats = await participantsOf(householdId);
    expect(seats.map((row) => [row.userId, row.memberSlot])).toEqual([
      [owner.id, 1],
      [member.id, 2],
    ]);
    expect(seats[1]?.displayName).toBe("Robin");
    expect(seats.some((row) => row.userId === partnerId)).toBe(false);
    const members = await db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId));
    expect(members.map((row) => row.userId)).toContain(partnerId);
    expect((await planOf(householdId))?.payerId).toBe(owner.id);
  });
});

describe("(i) assignParticipants", () => {
  async function threeMemberHousehold(): Promise<{ owner: TestUser; b: TestUser; c: TestUser; householdId: string }> {
    const owner = await createUser("Owner");
    const b = await createUser("Bea");
    const c = await createUser("Carla");
    const householdId = await createPlainHousehold(owner, "Drei");
    await addMember(owner, householdId, b);
    await addMember(owner, householdId, c);
    expect((await enableFinance(owner, householdId, owner, b)).status).toBe(200);
    return { owner, b, c, householdId };
  }

  test("refuses invalid assignments with the decision-4 codes and writes nothing", async () => {
    const { owner, b, householdId } = await threeMemberHousehold();
    const outsider = await createUser("Fremd");
    const before = await participantsOf(householdId);

    const invalid: [ParticipantAssignmentEntry[], string][] = [
      [[{ userId: owner.id, memberSlot: 1 }, { userId: owner.id, memberSlot: 2 }], "server.finance.participantsRequired"],
      [[{ userId: owner.id, memberSlot: 1 }], "server.finance.participantsRequired"],
      [[{ userId: owner.id, memberSlot: 1 }, { userId: b.id, memberSlot: 1 }], "server.finance.participantsRequired"],
      [
        [
          { userId: owner.id, memberSlot: 1 },
          { userId: b.id, memberSlot: 2 },
          { userId: outsider.id, memberSlot: 2 },
        ],
        "server.finance.participantsRequired",
      ],
      [[{ userId: owner.id, memberSlot: 1 }, { userId: outsider.id, memberSlot: 2 }], "server.finance.participantNotMember"],
    ];
    for (const [assignment, key] of invalid) {
      const error = await rejection(assignParticipants(db, householdId, assignment));
      expect(error.status).toBe(422);
      expect(error.code).toBe("finance_participants_required");
      expect(error.text).toBe(key as never);
    }
    expect(await participantsOf(householdId)).toEqual(before);
  });

  test("a leaving participant named as payer is 409 finance_participant_in_use, nothing changed", async () => {
    const { owner, b, c, householdId } = await threeMemberHousehold();
    await insertTransaction(householdId, b.id);
    const before = await participantsOf(householdId);

    const error = await rejection(
      assignParticipants(db, householdId, [
        { userId: owner.id, memberSlot: 1 },
        { userId: c.id, memberSlot: 2 },
      ]),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe("finance_participant_in_use");
    expect(await participantsOf(householdId)).toEqual(before);

    // Swapping the same two users between slots is allowed even with ledger rows.
    await assignParticipants(db, householdId, [
      { userId: b.id, memberSlot: 1 },
      { userId: owner.id, memberSlot: 2 },
    ]);
    expect((await participantsOf(householdId)).map((row) => row.userId)).toEqual([b.id, owner.id]);
  });

  test("without ledger rows the replacement succeeds, the plan payer follows the slot, a kept user keeps its row", async () => {
    const { owner, b, c, householdId } = await threeMemberHousehold();
    await updateParticipantDisplayName(db, householdId, b.id, "Bee");
    const keptBefore = (await participantsOf(householdId)).find((row) => row.userId === b.id);
    expect((await planOf(householdId))?.payerId).toBe(owner.id);

    setClockForTest(JAN_15_NOON_BERLIN);
    await assignParticipants(db, householdId, [
      { userId: c.id, memberSlot: 1 },
      { userId: b.id, memberSlot: 2 },
    ]);

    const seats = await participantsOf(householdId);
    expect(seats.map((row) => [row.userId, row.memberSlot])).toEqual([
      [c.id, 1],
      [b.id, 2],
    ]);
    expect(seats[0]?.displayName).toBe("Carla");
    expect(seats[0]?.joinedAt).toBe(JAN_15_NOON_BERLIN);
    expect(seats[1]?.displayName).toBe("Bee");
    expect(seats[1]?.joinedAt).toBe(keptBefore?.joinedAt as number);
    expect((await planOf(householdId))?.payerId).toBe(c.id);
  });

  test("POST …/modules/finance with a malformed participants body is 422 and enables nothing", async () => {
    const owner = await createUser("Owner");
    const b = await createUser("Bea");
    const householdId = await createPlainHousehold(owner, "Kaputt");
    await addMember(owner, householdId, b);

    const response = await call(`/api/households/${householdId}/modules/finance`, {
      method: "POST",
      cookie: owner.cookie,
      body: { settings: { participants: [{ userId: owner.id, memberSlot: 1 }] } },
    });
    expect(response.status).toBe(422);
    expect((await body<{ error: { code: string } }>(response)).error.code).toBe("finance_participants_required");
    expect(await financeModuleRow(householdId)).toBeUndefined();
    expect(await participantsOf(householdId)).toEqual([]);
  });
});

describe("(j) disable and re-enable", () => {
  test("re-enabling WITHOUT a body keeps the participants (D2)", async () => {
    const owner = await createUser("Owner");
    const householdId = await createHousehold(owner, "Pause");
    const before = await participantsOf(householdId);

    const disabled = await call(`/api/households/${householdId}/modules/finance`, { method: "DELETE", cookie: owner.cookie });
    expect(disabled.status).toBe(204);
    expect(await financeModuleRow(householdId)).toBeUndefined();

    const enabled = await call(`/api/households/${householdId}/modules/finance`, { method: "POST", cookie: owner.cookie });
    expect(enabled.status).toBe(200);
    expect((await body<{ household: { modules: string[] } }>(enabled)).household.modules).toEqual(["recipe", "finance"]);
    expect(await participantsOf(householdId)).toEqual(before);
  });
});

describe("(k) createSoloFinanceHousehold", () => {
  test("yields one participant and an enabled module with its plan row", async () => {
    const solo = await createUser("Solo");
    const householdId = await createSoloFinanceHousehold(solo, "Allein");
    const seats = await participantsOf(householdId);
    expect(seats).toHaveLength(1);
    expect(seats[0]?.userId).toBe(solo.id);
    expect(seats[0]?.memberSlot).toBe(1);
    expect(await financeModuleRow(householdId)).toBeDefined();
    expect((await planOf(householdId))?.payerId).toBe(solo.id);
    const categories = await db.select().from(financeCategories).where(eq(financeCategories.householdId, householdId));
    expect(categories).toHaveLength(21);
  });
});
