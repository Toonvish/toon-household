/**
 * The ledger's real-transaction proof (plan M3 decision 15, ADR 0003; toon-finance gotcha 2).
 *
 * The whole suite runs on the one process-wide `file::memory:` client, where
 * `withTransaction` degrades to sequential statements (no rollback). This file therefore builds
 * its OWN temp `file:` database (`createDatabase` + `runMigrations`), inserts users, the
 * household and the two participants directly, and runs the finance write paths against it:
 *
 * (a) a finance `withTransaction` that throws after an insert leaves no row;
 * (b) `createSettlement` with a `mutationId`, twice, books one row and holds one claim;
 * (c) a `createTransaction` whose tag insert fails leaves neither the transaction nor its
 *     claim, and the same `mutationId` can be delivered again afterwards;
 * (d) `withTransaction` on the shared memory client still degrades (documents the boundary).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { type CreatedDatabase, createDatabase, db as sharedDb } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { householdMembers, households, users } from "../src/db/schema.ts";
import {
  financeMutationClaims,
  financeParticipants,
  financeTags,
  financeTransactions,
} from "../src/modules/finance/schema.ts";
import { createSettlement } from "../src/modules/finance/services/ledger/settlements.service.ts";
import { createTransaction } from "../src/modules/finance/services/ledger/transactions.service.ts";
import { withTransaction } from "../src/modules/finance/services/support.ts";
import { ensureFinanceHousehold } from "../src/modules/finance/setup.ts";

await runMigrations(sharedDb);

let dir = "";
let created: CreatedDatabase;
let householdId = "";
const user1 = crypto.randomUUID();
const user2 = crypto.randomUUID();

function transactionCount(): Promise<number> {
  return created.db
    .select({ id: financeTransactions.id })
    .from(financeTransactions)
    .where(eq(financeTransactions.householdId, householdId))
    .then((rows) => rows.length);
}

function claimCount(): Promise<number> {
  return created.db
    .select({ id: financeMutationClaims.id })
    .from(financeMutationClaims)
    .where(eq(financeMutationClaims.householdId, householdId))
    .then((rows) => rows.length);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "toon-finance-file-db-"));
  created = createDatabase({ url: `file:${join(dir, "ledger.db")}` });
  await created.ready;
  await runMigrations(created.db);

  const now = Date.now();
  householdId = crypto.randomUUID();
  for (const [id, name] of [
    [user1, "Eins"],
    [user2, "Zwei"],
  ] as const) {
    await created.db.insert(users).values({
      id,
      email: `${name.toLowerCase()}.${id.slice(0, 8)}@toon.test`,
      name,
      emailVerified: true,
      emailVerifiedAt: now,
    });
  }
  await created.db.insert(households).values({ id: householdId, name: "Dateidatenbank", createdBy: user1 });
  for (const userId of [user1, user2]) {
    await created.db
      .insert(householdMembers)
      .values({ id: crypto.randomUUID(), householdId, userId, role: "member", createdAt: now });
  }
  await created.db.insert(financeParticipants).values([
    { householdId, userId: user1, memberSlot: 1, displayName: "Eins", joinedAt: now },
    { householdId, userId: user2, memberSlot: 2, displayName: "Zwei", joinedAt: now },
  ]);
  await ensureFinanceHousehold(created.db, householdId);
});

afterAll(() => {
  created.client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("finance withTransaction on a real file database", () => {
  test("(a) a throw after an insert rolls the insert back", async () => {
    const before = await transactionCount();
    const timestamp = Date.now();
    await expect(
      withTransaction(created.db, async (tx) => {
        await tx.insert(financeTransactions).values({
          id: crypto.randomUUID(),
          householdId,
          payerId: user1,
          splitMode: "SPLIT_EQUAL",
          amountCents: 100,
          description: "wird zurückgerollt",
          bookedAt: timestamp,
          dateSource: "exact",
          origin: "manual",
          categorySource: "manual",
          createdBy: user1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");
    expect(await transactionCount()).toBe(before);
  });

  test("(b) createSettlement with the same mutationId twice books one row and holds one claim", async () => {
    const booked = await createTransaction(created.db, {
      householdId,
      viewerId: user1,
      createdBy: user1,
      kind: "MINE_SPLIT",
      amountCents: 1_000,
      description: "Einkauf",
    });
    expect(booked.applied).toBe(true);

    const mutationId = crypto.randomUUID();
    const request = { expectedBalanceCents: 500, mutationId };
    const first = await createSettlement(created.db, householdId, user1, 1, request);
    expect(first.applied).toBe(true);
    const second = await createSettlement(created.db, householdId, user1, 1, request);
    expect(second.applied).toBe(false);
    expect(second.response.transaction.id).toBe(first.response.transaction.id);

    const settlements = await created.db
      .select({ id: financeTransactions.id })
      .from(financeTransactions)
      .where(eq(financeTransactions.splitMode, "SETTLEMENT"));
    expect(settlements).toHaveLength(1);
    const claims = await created.db
      .select()
      .from(financeMutationClaims)
      .where(eq(financeMutationClaims.id, mutationId));
    expect(claims).toHaveLength(1);
    expect(claims[0]?.transactionId).toBe(first.response.transaction.id);
  });

  test("(c) a failing tag insert leaves neither the transaction nor its claim", async () => {
    // Forces the LAST write of createTransaction's transaction to fail: the claim and the
    // transaction row are already inserted when the tag insert aborts.
    await created.client.execute(
      "CREATE TRIGGER finance_tags_forced_failure BEFORE INSERT ON finance_tags " +
        "WHEN NEW.name_key = 'boom' BEGIN SELECT RAISE(ABORT, 'forced constraint violation'); END",
    );
    const transactionsBefore = await transactionCount();
    const claimsBefore = await claimCount();
    const mutationId = crypto.randomUUID();
    const input = {
      householdId,
      viewerId: user1,
      createdBy: user1,
      kind: "MINE_SPLIT" as const,
      amountCents: 700,
      description: "scheitert am Tag",
      tags: ["boom"],
      mutationId,
    };
    try {
      await expect(createTransaction(created.db, input)).rejects.toThrow();
      expect(await transactionCount()).toBe(transactionsBefore);
      expect(await claimCount()).toBe(claimsBefore);
      expect(await created.db.select().from(financeTags).where(eq(financeTags.nameKey, "boom"))).toHaveLength(0);
    } finally {
      await created.client.execute("DROP TRIGGER finance_tags_forced_failure");
    }

    // The same mutationId is still deliverable: the failed attempt left no claim behind.
    const retried = await createTransaction(created.db, input);
    expect(retried.applied).toBe(true);
    expect(await transactionCount()).toBe(transactionsBefore + 1);
    expect(await claimCount()).toBe(claimsBefore + 1);
  });
});

describe("the shared memory client (documents the boundary)", () => {
  test("(d) withTransaction degrades to sequential statements: a throw does not roll back", async () => {
    const id = crypto.randomUUID();
    try {
      await expect(
        withTransaction(sharedDb, async (tx) => {
          await tx.insert(users).values({ id, email: `degrade.${id.slice(0, 8)}@toon.test`, name: "Degrade" });
          throw new Error("forced");
        }),
      ).rejects.toThrow("forced");
      expect(await sharedDb.select({ id: users.id }).from(users).where(eq(users.id, id))).toHaveLength(1);
    } finally {
      await sharedDb.delete(users).where(eq(users.id, id));
    }
  });
});
