/**
 * The finance module's clock, composition and bridge runner (docs/EFFECT.md E7, E9, E12; plan
 * `docs/plans/e4-finance-services.md` P1, P4, P6, P11).
 *
 * Covered: `financeTimeMillis` returns the `setClockForTest` override (it wins over any `Clock`), else the fiber's
 * `Clock` (a `TestClock` moved by `setTime` / `adjust`), read on every run; the synchronous `nowMs()` keeps its
 * override seam; `withFinanceServices` builds over the CURRENT `Database` with a local memo map, so a private
 * `Database.layerFrom(…)` (or `Database.withExecutor(db)`) inside the app runtime is the database reached, never the
 * shared test DB; `runFinanceBridge` resolves a value on the executor it is handed (an open drizzle transaction
 * included), rejects a refusal of the API error family as the SAME object (`instanceof ApiError`), and a
 * `DatabaseError` with its `cause` (the raw driver error the old Promise functions threw).
 *
 * The private databases are temp `file:` DBs of this file with one probe table; the shared test DB has no `probe`.
 * Every test that pins the clock hands it back (`setClockForTest(null)` in `afterEach`, F gotcha 4).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { type CreatedDatabase, createDatabase } from "../src/db/client.ts";
import { Database } from "../src/db/database.ts";
import { DatabaseError, NotFound } from "../src/lib/errors.ts";
import { ApiError } from "./support/bridges/api-error.ts";
import { runFinanceBridge } from "./support/bridges/finance-bridge.ts";
import { withFinanceServices } from "../src/modules/finance/layer.ts";
import { financeTimeMillis, setClockForTest } from "../src/modules/finance/lib/clock.ts";
import { nowMs } from "./support/bridges/finance-clock.ts";
import { runTest } from "./support/effect.ts";

const dir = mkdtempSync(join(tmpdir(), "toon-household-finance-clock-"));
let privateDb: CreatedDatabase;

/** The names in the private DB's `probe` table, in insertion order. */
function probeNames(): Effect.Effect<string[], DatabaseError, Database> {
  return Database.use((database) =>
    database.use(async (db) => (await db.all<{ name: string }>(sql`SELECT name FROM probe ORDER BY rowid`)).map((row) => row.name)),
  );
}

beforeAll(async () => {
  privateDb = createDatabase({ url: `file:${join(dir, "private.db")}` });
  await privateDb.ready;
  await privateDb.db.run(sql`CREATE TABLE probe (name TEXT NOT NULL)`);
  await privateDb.db.run(sql`INSERT INTO probe (name) VALUES ('private')`);
});

afterAll(() => {
  privateDb.client.close();
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  setClockForTest(null);
});

describe("financeTimeMillis", () => {
  test("without an override it reads the fiber's Clock: a TestClock's time, moved by setTime and adjust", async () => {
    const pinned = Date.UTC(2026, 9, 31, 20, 0);
    const [first, second] = await runTest(
      Effect.gen(function* () {
        yield* TestClock.setTime(pinned);
        const first = yield* financeTimeMillis;
        yield* TestClock.adjust("6 hours");
        const second = yield* financeTimeMillis;
        return [first, second] as const;
      }),
      { clock: "test" },
    );
    expect(first).toBe(pinned);
    expect(second).toBe(pinned + 6 * 60 * 60 * 1000);
  });

  test("the setClockForTest override wins over any Clock, and is read on every run", async () => {
    const pinned = Date.UTC(2026, 0, 15, 12, 0);
    setClockForTest(pinned);
    const read = await runTest(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.UTC(2030, 0, 1));
        return yield* financeTimeMillis;
      }),
      { clock: "test" },
    );
    expect(read).toBe(pinned);
    // The same Effect value, run again after the seam is released, reads the clock instead (never captured).
    setClockForTest(null);
    const released = await runTest(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.UTC(2030, 0, 1));
        return yield* financeTimeMillis;
      }),
      { clock: "test" },
    );
    expect(released).toBe(Date.UTC(2030, 0, 1));
  });

  test("on the live clock it is the wall time", async () => {
    const before = Date.now();
    const read = await Effect.runPromise(financeTimeMillis);
    const after = Date.now();
    expect(read).toBeGreaterThanOrEqual(before);
    expect(read).toBeLessThanOrEqual(after);
  });

  test("the synchronous nowMs keeps its override seam", () => {
    const pinned = Date.UTC(2025, 5, 1);
    setClockForTest(pinned);
    expect(nowMs()).toBe(pinned);
    setClockForTest(null);
    const before = Date.now();
    const read = nowMs();
    expect(read).toBeGreaterThanOrEqual(before);
    expect(read).toBeLessThanOrEqual(Date.now());
  });
});

describe("withFinanceServices (a local memo map over the current Database)", () => {
  test("inside the app runtime, a private Database.layerFrom is the database reached, not the shared one", async () => {
    const names = await runTest(withFinanceServices(probeNames()).pipe(Effect.provide(Database.layerFrom(privateDb))));
    expect(names).toEqual(["private"]);
    // The shared test DB of the runtime has no probe table: the same program without the private layer fails there.
    const failure = await runTest(Effect.flip(withFinanceServices(probeNames())));
    expect(failure).toBeInstanceOf(DatabaseError);
  });

  test("inside the app runtime, Database.withExecutor(db) hands the private executor through", async () => {
    const names = await runTest(withFinanceServices(probeNames()).pipe(Database.withExecutor(privateDb.db)));
    expect(names).toEqual(["private"]);
  });
});

describe("runFinanceBridge", () => {
  test("resolves the effect's value on the executor it is handed", async () => {
    await expect(runFinanceBridge(probeNames(), privateDb.db)).resolves.toEqual(["private"]);
  });

  test("runs on an open drizzle transaction when handed one, so a rollback takes its write", async () => {
    const insertInside = Database.use((database) =>
      database.use((db) => db.run(sql`INSERT INTO probe (name) VALUES ('rolled back')`)),
    );
    const rollback = new Error("roll back");
    await expect(
      privateDb.db.transaction(async (tx) => {
        await runFinanceBridge(insertInside, tx);
        await expect(runFinanceBridge(probeNames(), tx)).resolves.toEqual(["private", "rolled back"]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    await expect(runFinanceBridge(probeNames(), privateDb.db)).resolves.toEqual(["private"]);
  });

  test("rejects a refusal of the API error family as the same object", async () => {
    const refusal = new NotFound();
    const rejection = runFinanceBridge(Effect.fail(refusal), privateDb.db);
    await expect(rejection).rejects.toBe(refusal);
    await expect(rejection).rejects.toBeInstanceOf(ApiError);
  });

  test("rejects a DatabaseError with its cause", async () => {
    const cause = new Error("insert into finance_transactions failed");
    await expect(runFinanceBridge(Effect.fail(new DatabaseError({ cause })), privateDb.db)).rejects.toBe(cause);
  });

  test("a real driver failure rejects with the driver's error, never the DatabaseError wrapper", async () => {
    const failing = Database.use((database) => database.use((db) => db.run(sql`INSERT INTO no_such_table VALUES (1)`)));
    const error: unknown = await runFinanceBridge(failing, privateDb.db).then(
      () => undefined,
      (rejected: unknown) => rejected,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DatabaseError);
    expect(String((error as Error).message)).toContain("no_such_table");
  });
});
