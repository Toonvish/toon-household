/**
 * The ledger's real-transaction proof (plan M3 decision 15; toon-finance gotcha 2; ADR 0003,
 * superseded by ADR 0009).
 *
 * Since M7-T02 the whole suite runs on one process-wide temp `file:` database (env.ts), so every
 * `withTransaction` is real. This file still builds its OWN temp `file:` database
 * (`createDatabase` + `runMigrations`) for (a)-(c), inserts users, the household and the two
 * participants directly, and runs the finance write paths against it, isolated from the rest
 * of the run (case (c) installs a trigger):
 *
 * (a) a `Database.transaction` (on `Database.layerFrom(created)`) that fails after an insert leaves no row;
 * (b) `FinanceSettlements.createSettlement` with a `mutationId`, twice, books one row and holds one claim;
 * (c) a `FinanceTransactions.createTransaction` whose tag insert fails leaves neither the transaction nor its
 *     claim, and the same `mutationId` can be delivered again afterwards;
 *
 * (b) and (c), and the `FinanceSetup.ensureFinanceHousehold` of the setup, run the services of the app runtime on
 * this file's database through `Database.withExecutor` (docs/EFFECT.md E9; plan `docs/plans/e4-finance-services.md` P11).
 * (d) on the SHARED client the same holds: a throw inside `Database.transaction` (the app runtime's) and inside the
 *     core `withTransaction` rolls the insert back (under ADR 0003 this case documented the
 *     opposite: on `file::memory:` the insert survived).
 *
 * The finance module's own `withTransaction` was deleted with E5 (plan `docs/plans/e5-scripts.md` P11).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { type CreatedDatabase, createDatabase, db as sharedDb } from "../src/db/client.ts";
import { Database } from "../src/db/database.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { householdMembers, households, users } from "../src/db/schema.ts";
import {
  financeMutationClaims,
  financeParticipants,
  financeTags,
  financeTransactions,
} from "../src/modules/finance/schema.ts";
import { FinanceSettlements } from "../src/modules/finance/services/ledger/settlements.service.ts";
import { FinanceTransactions } from "../src/modules/finance/services/ledger/transactions.service.ts";
import {
  type DbLike,
  withTransaction as coreWithTransaction,
  transactionsSupported,
} from "../src/core/services/households/support.ts";
import { FinanceSetup } from "../src/modules/finance/setup.ts";
import { runTest } from "./support/effect.ts";

await runMigrations(sharedDb);

let dir = "";
let created: CreatedDatabase;
let householdId = "";
const user1 = crypto.randomUUID();
const user2 = crypto.randomUUID();

/** The finance services of the app runtime, on this file's own database (`Database.withExecutor`). */
function onCreated<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Database.withExecutor(created.db)(effect);
}

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
  await runTest(onCreated(FinanceSetup.use((setup) => setup.ensureFinanceHousehold(householdId))));
});

afterAll(() => {
  created.client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Database.transaction on a real file database", () => {
  test("(a) a throw after an insert rolls the insert back", async () => {
    const before = await transactionCount();
    const timestamp = Date.now();
    await expect(
      runTest(
        Effect.gen(function* () {
          const database = yield* Database;
          yield* database.transaction(
            Effect.gen(function* () {
              yield* database.use((tx) =>
                tx.insert(financeTransactions).values({
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
                }),
              );
              return yield* Effect.fail(new Error("forced rollback"));
            }),
          );
        }).pipe(Effect.provide(Database.layerFrom(created))),
      ),
    ).rejects.toThrow("forced rollback");
    expect(await transactionCount()).toBe(before);
  });

  test("(b) createSettlement with the same mutationId twice books one row and holds one claim", async () => {
    const booked = await runTest(
      onCreated(
        FinanceTransactions.use((service) =>
          service.createTransaction({
            householdId,
            viewerId: user1,
            createdBy: user1,
            kind: "MINE_SPLIT",
            amountCents: 1_000,
            description: "Einkauf",
          }),
        ),
      ),
    );
    expect(booked.applied).toBe(true);

    const mutationId = crypto.randomUUID();
    const request = { expectedBalanceCents: 500, mutationId };
    const settle = () =>
      runTest(onCreated(FinanceSettlements.use((service) => service.createSettlement(householdId, user1, 1, request))));
    const first = await settle();
    expect(first.applied).toBe(true);
    const second = await settle();
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
      await expect(
        runTest(onCreated(FinanceTransactions.use((service) => service.createTransaction(input)))),
      ).rejects.toThrow();
      expect(await transactionCount()).toBe(transactionsBefore);
      expect(await claimCount()).toBe(claimsBefore);
      expect(await created.db.select().from(financeTags).where(eq(financeTags.nameKey, "boom"))).toHaveLength(0);
    } finally {
      await created.client.execute("DROP TRIGGER finance_tags_forced_failure");
    }

    // The same mutationId is still deliverable: the failed attempt left no claim behind.
    const retried = await runTest(onCreated(FinanceTransactions.use((service) => service.createTransaction(input))));
    expect(retried.applied).toBe(true);
    expect(await transactionCount()).toBe(transactionsBefore + 1);
    expect(await claimCount()).toBe(claimsBefore + 1);
  });
});

describe("the shared client is a real file database (ADR 0009)", () => {
  test("(d) a transaction on the shared client rolls back: a throw leaves no row", async () => {
    expect(transactionsSupported).toBe(true);
    // `Database.transaction` of the app runtime (the shared client) and the core's `withTransaction`, same body.
    const databaseTransaction = (_db: typeof sharedDb, work: (tx: DbLike) => Promise<void>): Promise<void> =>
      runTest(
        Effect.gen(function* () {
          const database = yield* Database;
          yield* database.transaction(
            Effect.gen(function* () {
              const tx = yield* database.executor;
              return yield* Effect.tryPromise({ try: () => work(tx), catch: (cause): unknown => cause });
            }),
          );
        }),
      );
    for (const [label, run] of [
      ["database", databaseTransaction],
      ["core", coreWithTransaction],
    ] as const) {
      const id = crypto.randomUUID();
      try {
        await expect(
          run(sharedDb, async (tx) => {
            await tx.insert(users).values({ id, email: `rollback.${id.slice(0, 8)}@toon.test`, name: label });
            // Visible inside the transaction ...
            expect(await tx.select({ id: users.id }).from(users).where(eq(users.id, id))).toHaveLength(1);
            throw new Error(`forced ${label}`);
          }),
        ).rejects.toThrow(`forced ${label}`);
        // ... and gone after the rollback.
        expect(await sharedDb.select({ id: users.id }).from(users).where(eq(users.id, id))).toHaveLength(0);
      } finally {
        await sharedDb.delete(users).where(eq(users.id, id));
      }
    }
  });
});
