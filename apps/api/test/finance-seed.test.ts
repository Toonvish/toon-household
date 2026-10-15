/**
 * The finance demo seed (plan M3-T09, `modules/finance/seed.ts`): idempotent, three logins
 * (demo and Robin seated as participants, Kim a plain member), and the non-participant gets
 * 403 on the ledger. Runs on the shared memory DB through the service-level entry point; the
 * CLI twice-on-a-fresh-file check is the task's verify command.
 *
 * M3b-T06 (plan m3b decision 17): the logins use the `demoPassword` of the `seedDemo` context,
 * never a constant of the module. That case runs on its own temp `file:` database, because
 * robin@ and kim@ are matched by e-mail and the shared memory DB already holds them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { initializeHousehold } from "../src/core/services/households/modules.ts";
import { createDatabase, db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { householdMembers, households, users } from "../src/db/schema.ts";
import {
  financeFixedCostItems,
  financeIncomes,
  financeMutationClaims,
  financeParticipants,
  financeTransactions,
} from "../src/modules/finance/schema.ts";
import { seedFinanceDemo } from "../src/modules/finance/seed.ts";
import { call, createPlainHousehold, createUser } from "./support/finance-harness.ts";

await runMigrations(db);

async function login(email: string): Promise<string> {
  const response = await call("/api/auth/login", {
    method: "POST",
    body: { email, password: "demo1234" },
    headers: { "X-Forwarded-For": `10.0.0.${Math.floor(Math.random() * 200) + 1}` },
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("login set no cookie");
  return cookie;
}

async function counts(householdId: string): Promise<Record<string, number>> {
  const of = async (table: typeof financeTransactions | typeof financeParticipants | typeof financeFixedCostItems | typeof financeIncomes | typeof financeMutationClaims) =>
    (await db.select().from(table).where(eq(table.householdId, householdId))).length;
  return {
    transactions: await of(financeTransactions),
    participants: await of(financeParticipants),
    items: await of(financeFixedCostItems),
    incomes: await of(financeIncomes),
    members: (await db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId))).length,
    users: (await db.select().from(users)).length,
  };
}

describe("seedFinanceDemo", () => {
  test("seeds twice: the second run adds nothing; robin and kim log in; kim gets 403", async () => {
    const demo = await createUser("Demo");
    const householdId = await createPlainHousehold(demo, "Familie Seed");

    await seedFinanceDemo(db, { householdId, userId: demo.id, demoPassword: "demo1234" });
    const first = await counts(householdId);
    expect(first.participants).toBe(2);
    expect(first.members).toBe(3);
    expect(first.transactions).toBeGreaterThanOrEqual(9);
    expect(first.items).toBe(2);
    expect(first.incomes).toBe(2);

    await seedFinanceDemo(db, { householdId, userId: demo.id, demoPassword: "demo1234" });
    expect(await counts(householdId)).toEqual(first);

    const base = `/api/households/${householdId}/finance`;
    const robin = await login("robin@toon.local");
    const kim = await login("kim@toon.local");

    const robinLedger = await call(`${base}/transactions`, { cookie: robin });
    expect(robinLedger.status).toBe(200);
    const robinPlan = await call(`${base}/plan`, { cookie: robin });
    expect(robinPlan.status).toBe(200);

    const kimLedger = await call(`${base}/transactions`, { cookie: kim });
    expect(kimLedger.status).toBe(403);
    expect(((await kimLedger.json()) as { error: { code: string } }).error.code).toBe("finance_not_participant");
    const kimParticipants = await call(`${base}/participants`, { cookie: kim });
    expect(kimParticipants.status).toBe(200);
  });
});

describe("seedFinanceDemo uses the context's demoPassword", () => {
  test("robin's and kim's hashes verify against demoPassword and NOT against demo1234", async () => {
    const dir = mkdtempSync(join(tmpdir(), "toon-household-finance-seed-"));
    const created = createDatabase({ url: `file:${join(dir, "seed.db")}` });
    try {
      await created.ready;
      await runMigrations(created.db);
      const now = Date.now();
      const demoId = crypto.randomUUID();
      const householdId = crypto.randomUUID();
      await created.db.insert(users).values({
        id: demoId,
        email: "demo@toon.local",
        name: "Demo",
        emailVerified: true,
        emailVerifiedAt: now,
      });
      await created.db.insert(households).values({ id: householdId, name: "Familie", createdBy: demoId });
      await created.db
        .insert(householdMembers)
        .values({ id: crypto.randomUUID(), householdId, userId: demoId, role: "owner", createdAt: now });
      await initializeHousehold(created.db, householdId);

      await seedFinanceDemo(created.db, { householdId, userId: demoId, demoPassword: "x-test-pass-123" });

      const logins = await created.db
        .select({ email: users.email, passwordHash: users.passwordHash })
        .from(users)
        .where(inArray(users.email, ["robin@toon.local", "kim@toon.local"]));
      expect(logins.map((row) => row.email).sort()).toEqual(["kim@toon.local", "robin@toon.local"]);
      for (const login of logins) {
        expect(login.passwordHash).not.toBeNull();
        expect(await Bun.password.verify("x-test-pass-123", login.passwordHash ?? "")).toBe(true);
        expect(await Bun.password.verify("demo1234", login.passwordHash ?? "")).toBe(false);
      }
    } finally {
      created.client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
