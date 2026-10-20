/**
 * The `Database` service (`src/db/database.ts`; docs/EFFECT.md E5; plan e2 P6).
 *
 * Most cases run on a temp `file:` database of their own (`createDatabase` + `Database.layerFrom`) with one probe
 * table, so they never touch the shared test DB of ADR 0009; the app runtime's `Database` (the shared client) is
 * exercised through `runTest` and by the "never closes under test" case.
 *
 * Covered: `use` on the root; `transaction` commits; a typed failure rolls back and surfaces the SAME error object;
 * a defect rolls back; a `use` inside `transaction` sees the uncommitted row; a nested `transaction` runs inline;
 * `withExecutor(other)` runs `use` and `transaction` on the other instance; `layerFromExecutor(tx)` inside a drizzle
 * transaction the test opened (the hook sees that `tx`, its write rolls back with the outer transaction, a
 * `transaction` inside is a savepoint); `layerFromExecutor(db)` follows the process-wide rule of `support.ts`;
 * `layerFromUrl("file::memory:")` runs without a transaction; `layerFromUrl(<file>)` applies WAL and closes its
 * client with its scope; `Database.layer` under the test env never closes the shared client.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Cause, Clock, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect";
import { AppConfig } from "../src/config.ts";
import { transactionsSupported as supportTransactionsSupported } from "../src/core/services/households/support.ts";
import { client as sharedClient, type CreatedDatabase, createDatabase, db as sharedDb } from "../src/db/client.ts";
import { Database, type DbExecutor } from "../src/db/database.ts";
import { DatabaseError } from "../src/lib/errors.ts";
import { AppLayer, runtime } from "../src/runtime.ts";
import { itEffect, runTest, runTestExit } from "./support/effect.ts";

class Refusal extends Schema.TaggedError<Refusal>()("Refusal", { reason: Schema.String }) {}

const dir = mkdtempSync(join(tmpdir(), "toon-household-database-"));
let primary: CreatedDatabase;
let other: CreatedDatabase;

async function createProbeDb(name: string): Promise<CreatedDatabase> {
  const created = createDatabase({ url: `file:${join(dir, name)}` });
  await created.ready;
  await created.db.run(sql`CREATE TABLE probe (id TEXT PRIMARY KEY)`);
  return created;
}

beforeAll(async () => {
  primary = await createProbeDb("primary.db");
  other = await createProbeDb("other.db");
});

afterAll(() => {
  primary.client.close();
  other.client.close();
  rmSync(dir, { recursive: true, force: true });
});

const insert = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database;
    yield* database.use((db) => db.run(sql`INSERT INTO probe (id) VALUES (${id})`));
  });

const ids = Effect.gen(function* () {
  const database = yield* Database;
  const rows = yield* database.use((db) => db.all<{ id: string }>(sql`SELECT id FROM probe ORDER BY id`));
  return rows.map((row) => row.id);
});

async function idsOf(created: CreatedDatabase): Promise<string[]> {
  const rows = await created.db.all<{ id: string }>(sql`SELECT id FROM probe ORDER BY id`);
  return rows.map((row) => row.id);
}

function onPrimary<A, E>(effect: Effect.Effect<A, E, Database>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(Database.layerFrom(primary))));
}

function onPrimaryExit<A, E>(effect: Effect.Effect<A, E, Database>): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect.pipe(Effect.provide(Database.layerFrom(primary))));
}

describe("Database.use", () => {
  test("runs on the root executor and maps a rejection to a DatabaseError", async () => {
    await onPrimary(insert("use-root"));
    expect(await idsOf(primary)).toContain("use-root");
    const root = await onPrimary(Effect.flatMap(Database, (database) => database.executor));
    expect(root).toBe(primary.db);

    const error = await onPrimary(Effect.flip(insert("use-root")));
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error._tag).toBe("DatabaseError");
  });

  itEffect("the app runtime's Database is the shared client of the test DB", () =>
    Effect.gen(function* () {
      const database = yield* Database;
      expect(database.client).toBe(sharedClient);
      expect(database.drizzle).toBe(sharedDb);
      expect(database.transactionsSupported).toBe(true);
      const rows = yield* database.use((db) => db.all<{ one: number }>(sql`SELECT 1 AS one`));
      expect(rows).toEqual([{ one: 1 }]);
    }),
  );
});

describe("Database.transaction", () => {
  test("commits on success", async () => {
    const result = await onPrimary(
      Effect.gen(function* () {
        const database = yield* Database;
        return yield* database.transaction(Effect.as(insert("commit-1"), "done"));
      }),
    );
    expect(result).toBe("done");
    expect(await idsOf(primary)).toContain("commit-1");
  });

  test("a typed failure rolls back and surfaces the same error object", async () => {
    const refusal = new Refusal({ reason: "no" });
    const exit = await onPrimaryExit(
      Effect.gen(function* () {
        const database = yield* Database;
        return yield* database.transaction(
          Effect.gen(function* () {
            yield* insert("rollback-typed");
            return yield* refusal;
          }),
        );
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(refusal);
    expect(await idsOf(primary)).not.toContain("rollback-typed");

    const flipped = await onPrimary(
      Effect.flip(Effect.flatMap(Database, (database) => database.transaction(Effect.andThen(insert("rollback-typed"), Effect.fail(refusal))))),
    );
    expect(flipped).toBe(refusal);
    expect(await idsOf(primary)).not.toContain("rollback-typed");
  });

  test("a defect rolls back and surfaces as the same defect", async () => {
    const boom = new Error("boom");
    const exit = await onPrimaryExit(
      Effect.gen(function* () {
        const database = yield* Database;
        return yield* database.transaction(Effect.andThen(insert("rollback-defect"), Effect.die(boom)));
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.squash(exit.cause)).toBe(boom);
    }
    expect(await idsOf(primary)).not.toContain("rollback-defect");
  });

  test("a use inside the transaction sees the uncommitted row on the open transaction", async () => {
    const seen = await onPrimaryExit(
      Effect.gen(function* () {
        const database = yield* Database;
        return yield* database.transaction(
          Effect.gen(function* () {
            yield* insert("uncommitted");
            const inside = yield* ids;
            const executor = yield* database.executor;
            expect(executor).not.toBe(primary.db);
            return yield* new Refusal({ reason: `${inside.includes("uncommitted")}` });
          }),
        );
      }),
    );
    expect(Exit.isFailure(seen)).toBe(true);
    if (Exit.isFailure(seen)) expect((Cause.squash(seen.cause) as Refusal).reason).toBe("true");
    expect(await idsOf(primary)).not.toContain("uncommitted");
  });

  test("a nested transaction runs inline on the open transaction (no savepoint)", async () => {
    const exit = await onPrimaryExit(
      Effect.gen(function* () {
        const database = yield* Database;
        return yield* database.transaction(
          Effect.gen(function* () {
            const outer = yield* database.executor;
            yield* insert("nested-outer");
            const inner = yield* database.transaction(
              Effect.gen(function* () {
                yield* insert("nested-inner");
                return yield* database.executor;
              }),
            );
            expect(inner).toBe(outer);
            // Inline: the outer failure takes the inner write with it.
            return yield* new Refusal({ reason: "outer" });
          }),
        );
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const after = await idsOf(primary);
    expect(after).not.toContain("nested-outer");
    expect(after).not.toContain("nested-inner");

    // An inline inner failure is the outer failure too: nothing of either survives.
    const refusal = new Refusal({ reason: "inner" });
    const error = await onPrimary(
      Effect.flip(
        Effect.gen(function* () {
          const database = yield* Database;
          return yield* database.transaction(
            Effect.andThen(insert("inline-outer"), database.transaction(Effect.andThen(insert("inline-inner"), Effect.fail(refusal)))),
          );
        }),
      ),
    );
    expect(error).toBe(refusal);
    const final = await idsOf(primary);
    expect(final).not.toContain("inline-outer");
    expect(final).not.toContain("inline-inner");
  });
});

describe("Database.withExecutor", () => {
  test("runs use and transaction on the handed-in instance", async () => {
    await onPrimary(
      Database.withExecutor(other.db)(
        Effect.gen(function* () {
          const database = yield* Database;
          expect(yield* database.executor).toBe(other.db);
          yield* insert("with-use");
          yield* database.transaction(insert("with-tx"));
        }),
      ),
    );
    expect(await idsOf(other)).toEqual(expect.arrayContaining(["with-tx", "with-use"]));
    const onPrimaryIds = await idsOf(primary);
    expect(onPrimaryIds).not.toContain("with-use");
    expect(onPrimaryIds).not.toContain("with-tx");

    const refusal = new Refusal({ reason: "other" });
    const error = await onPrimary(
      Database.withExecutor(other.db)(
        Effect.flip(Effect.flatMap(Database, (database) => database.transaction(Effect.andThen(insert("with-rollback"), Effect.fail(refusal))))),
      ),
    );
    expect(error).toBe(refusal);
    expect(await idsOf(other)).not.toContain("with-rollback");
  });
});

describe("Database.layerFromExecutor", () => {
  test("inside a drizzle transaction: the hook sees that tx, rolls back with it, and its transaction is a savepoint", async () => {
    const outerRefusal = new Error("outer rollback");
    let seen: DbExecutor | undefined;
    let held: DbExecutor | undefined;
    const rejected = await primary.db
      .transaction(async (tx) => {
        held = tx;
        await Effect.runPromise(
          Effect.gen(function* () {
            const database = yield* Database;
            seen = yield* database.executor;
            expect(database.client).toBeUndefined();
            expect(database.url).toBeUndefined();
            yield* insert("hook-write");
            // The inner transaction is a savepoint: its failure rolls back only the inner write.
            const inner = yield* Effect.flip(
              database.transaction(Effect.andThen(insert("hook-savepoint"), Effect.fail(new Refusal({ reason: "inner" })))),
            );
            expect(inner._tag).toBe("Refusal");
            const visible = yield* ids;
            expect(visible).toContain("hook-write");
            expect(visible).not.toContain("hook-savepoint");
            yield* database.transaction(insert("hook-savepoint-ok"));
          }).pipe(Effect.provide(Database.layerFromExecutor(tx))),
        );
        const inside = await tx.all<{ id: string }>(sql`SELECT id FROM probe`);
        expect(inside.map((row) => row.id)).toEqual(expect.arrayContaining(["hook-write", "hook-savepoint-ok"]));
        throw outerRefusal;
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(rejected).toBe(outerRefusal);
    expect(seen).toBe(held);
    const after = await idsOf(primary);
    expect(after).not.toContain("hook-write");
    expect(after).not.toContain("hook-savepoint-ok");
  });

  test("on a root instance: transactionsSupported is support.ts's process-wide rule", async () => {
    const database = await Effect.runPromise(Database.pipe(Effect.provide(Database.layerFromExecutor(primary.db))));
    expect(database.transactionsSupported).toBe(supportTransactionsSupported);
    expect(database.drizzle).toBe(primary.db);
  });
});

describe("Database.layerFromUrl", () => {
  test("file::memory: has no transactions: the effect runs sequentially without a rollback", async () => {
    const refusal = new Refusal({ reason: "memory" });
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database;
        expect(database.transactionsSupported).toBe(false);
        yield* database.use((db) => db.run(sql`CREATE TABLE probe (id TEXT PRIMARY KEY)`));
        const error = yield* Effect.flip(database.transaction(Effect.andThen(insert("memory-a"), Effect.fail(refusal))));
        expect(error).toBe(refusal);
        yield* database.transaction(insert("memory-b"));
        return yield* ids;
      }).pipe(Effect.provide(Database.layerFromUrl("file::memory:"))),
    );
    // Same statement order, no rollback guarantee: the write before the failure stays.
    expect(outcome).toEqual(["memory-a", "memory-b"]);
  });

  test("a file: URL gets journal_mode = wal and its client is closed when the scope ends", async () => {
    const url = `file:${join(dir, "scoped.db")}`;
    let opened: Database["Service"] | undefined;
    const mode = await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database;
        opened = database;
        expect(database.url).toBe(url);
        expect(database.transactionsSupported).toBe(true);
        expect(database.client?.closed).toBe(false);
        const rows = yield* database.use((db) => db.all<{ journal_mode: string }>(sql`PRAGMA journal_mode`));
        return rows[0]?.journal_mode;
      }).pipe(Effect.provide(Database.layerFromUrl(url))),
    );
    expect(String(mode).toLowerCase()).toBe("wal");
    expect(opened?.client?.closed).toBe(true);
  });
});

describe("Database.layer under the test env", () => {
  test("disposing a runtime built from it never closes the shared client", async () => {
    const rt = ManagedRuntime.make(Database.layer.pipe(Layer.provideMerge(AppConfig.layer)));
    const database = await rt.runPromise(Database);
    expect(database.client).toBe(sharedClient);
    await rt.dispose();
    expect(sharedClient.closed).toBe(false);
    const result = await sharedClient.execute("SELECT 1 AS one");
    expect(Number(result.rows[0]?.one)).toBe(1);
  });

  test("an AppLayer runtime of its own, disposed, leaves the shared runtime and client working", async () => {
    const rt = ManagedRuntime.make(AppLayer);
    await rt.runPromise(Effect.void);
    await rt.dispose();
    expect(sharedClient.closed).toBe(false);
    const rows = await runtime.runPromise(
      Effect.flatMap(Database, (database) => database.use((db) => db.all<{ one: number }>(sql`SELECT 1 AS one`))),
    );
    expect(rows).toEqual([{ one: 1 }]);
  });
});

describe("apps/api/test/support/effect.ts", () => {
  test("runTest with the test clock starts at epoch 0", async () => {
    expect(await runTest(Clock.currentTimeMillis, { clock: "test" })).toBe(0);
    expect(await runTest(Clock.currentTimeMillis)).toBeGreaterThan(0);
  });

  test("runTestExit resolves with the failure; runTest rejects with the error itself", async () => {
    const refusal = new Refusal({ reason: "exit" });
    const exit = await runTestExit(Effect.fail(refusal));
    expect(Exit.isFailure(exit)).toBe(true);
    await expect(runTest(Effect.fail(refusal))).rejects.toBe(refusal);
    expect(await runTest(Effect.flip(Effect.fail(refusal)))).toBe(refusal);
  });
});
