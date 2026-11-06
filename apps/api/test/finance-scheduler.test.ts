/**
 * The finance accrual scheduler on `Schedule`, driven by the `TestClock` (docs/EFFECT.md E7, E9, E12; plan
 * `docs/plans/e4-finance-services.md` P8, P11; module doc 4a "The `start` hook and the clock").
 *
 * Both tests run the REAL scheduler (`startAccrualSchedule` / `stopAccrualSchedule`) on the migrated legacy fixtures
 * (`test/fixtures/legacy/`, `test/support/legacy-harness.ts`: a temp file target, never the shared test DB), handed in
 * with `Database.withExecutor(run.target.db)`; the scheduler builds its finance services over that `Database`
 * (`withFinanceServices`, a local memo map).
 *
 * - The boot catch-up at the moment of the M6 cutover rehearsal (15 Oct 2026 10:59:36 Berlin, `docs/plans/m6-deploy.md`
 *   section 9.7, CLAUDE.md "The first boot catches the fixed-cost plan up"): FH1's plan (`startPeriod 2026-07`,
 *   `lastBookedPeriod 2026-08`) books `2026-09` and `2026-10`, two rows of 51400 ct, so its balance moves from the
 *   migration report's 119486 ct to 222286 ct, while the households whose plan books nothing keep their balance.
 * - The 6-hour tick: started at 31 Oct 2026 21:00 Berlin (the boot books `2026-09` and `2026-10`), nothing runs
 *   until `adjust("6 hours")` in total: five hours later there is no `interval` run, one hour after that every finance
 *   household has one and FH1 holds the `2026-11` row (51400 ct, booked at 1 Nov 2026 00:00 Berlin). The catch-up's
 *   database I/O is real and settles after `TestClock.adjust` returns, hence a bounded real-time poll.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import type { BalanceResponse } from "@toon/shared";
import { migrateFinance as migrateFinanceEffect } from "../scripts/legacy/finance.ts";
import { migrateHouseholds } from "./support/bridges/legacy-households.ts";
import { runLegacy } from "./support/bridges/legacy-io.ts";
import type { MigrationContext } from "../scripts/legacy/types.ts";
import { migrateUsers } from "./support/bridges/legacy-users.ts";
import type { DrizzleDatabase } from "../src/db/client.ts";
import { Database } from "../src/db/database.ts";
import { withFinanceServices } from "../src/modules/finance/layer.ts";
import { FinanceBalance } from "../src/modules/finance/services/ledger/balance.service.ts";
import { startAccrualSchedule, stopAccrualSchedule } from "../src/modules/finance/services/plan/scheduler.ts";
import { FINANCE_HOUSEHOLDS } from "./fixtures/legacy/facts.ts";
import { createLegacyRun, type LegacyRun } from "./support/legacy-harness.ts";
import { runTest } from "./support/effect.ts";

/** The finance balance on `database` (the old Promise bridge's shape; plan e5 P11): the finance services over that executor. */
function getBalance(
  database: DrizzleDatabase,
  householdId: string,
  viewerUserId: string,
  viewerSlot: 1 | 2,
  includeAggregates: boolean,
): Promise<BalanceResponse> {
  return runLegacy(
    withFinanceServices(
      FinanceBalance.use((balance) => balance.getBalance(householdId, viewerUserId, viewerSlot, includeAggregates)),
    ).pipe(Effect.provide(Database.layerFromExecutor(database))),
  );
}

/** `migrateFinance` as a Promise (an Effect since E5-T07). */
function migrateFinance(ctx: MigrationContext): Promise<void> {
  return runLegacy(migrateFinanceEffect(ctx));
}

/** A real-time poll, a time budget like the thumbnail tests' (the same reason: parallel worktrees load the host). */
const SCHEDULER_TEST_TIMEOUT_MS = 60_000;
const POLL_ROUNDS = 500;
const POLL_MS = 10;

const runs: LegacyRun[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
});

async function migrated(): Promise<LegacyRun> {
  const run = await createLegacyRun();
  runs.push(run);
  await migrateUsers(run.ctx);
  await migrateHouseholds(run.ctx);
  await migrateFinance(run.ctx);
  return run;
}

type Key = keyof typeof FINANCE_HOUSEHOLDS;

function financeTarget(run: LegacyRun, key: Key): string {
  const id = run.ctx.ids.households.finance.get(FINANCE_HOUSEHOLDS[key].id);
  if (id === undefined) throw new Error(`${key} was not migrated`);
  return id;
}

/** The balance from the slot-1 participant's side, as the report and the rehearsal read it. */
async function balanceOf(run: LegacyRun, householdId: string): Promise<number> {
  const seat = await run.target.client.execute({
    sql: "SELECT user_id FROM finance_participants WHERE household_id = ? AND member_slot = 1",
    args: [householdId],
  });
  const slot1 = String(seat.rows[0]?.user_id);
  return (await getBalance(run.target.db, householdId, slot1, 1, true)).balanceCents;
}

/**
 * The `fixed_plan` rows from `2026-09` on. FH1's migrated ledger already holds the plan rows of `2026-07` and `2026-08`
 * (its `lastBookedPeriod`), which are not the scheduler's.
 */
async function planRows(run: LegacyRun, householdId: string): Promise<{ description: string; amount_cents: number; booked_at: number; plan_period: string }[]> {
  const result = await run.target.client.execute({
    sql: "SELECT description, amount_cents, booked_at, plan_period FROM finance_transactions WHERE household_id = ? AND origin = 'fixed_plan' AND plan_period >= '2026-09' ORDER BY plan_period",
    args: [householdId],
  });
  return result.rows.map((row) => ({
    description: String(row.description),
    amount_cents: Number(row.amount_cents),
    booked_at: Number(row.booked_at),
    plan_period: String(row.plan_period),
  }));
}

async function runCount(run: LegacyRun, trigger: string): Promise<number> {
  const result = await run.target.client.execute({
    sql: "SELECT count(*) AS n FROM finance_accrual_runs WHERE trigger = ?",
    args: [trigger],
  });
  return Number(result.rows[0]?.n);
}

async function financeHouseholdCount(run: LegacyRun): Promise<number> {
  const result = await run.target.client.execute("SELECT count(*) AS n FROM household_modules WHERE module_id = 'finance'");
  return Number(result.rows[0]?.n);
}

/** Real-time rounds that let the catch-up's database I/O settle (the `TestClock` does not drive it). */
const settle = Effect.promise(() => Bun.sleep(POLL_MS));

describe("the accrual scheduler under the TestClock", () => {
  test(
    "the boot catch-up of the fixtures at the M6 moment books two rows of 51400 ct for FH1 and moves its balance to 222286 ct",
    async () => {
      const run = await migrated();
      const fh1 = financeTarget(run, "FH1");
      const others = (["FH2", "FH3", "FH4", "FH6"] as const).map((key) => financeTarget(run, key));
      const before = await balanceOf(run, fh1);
      const othersBefore = await Promise.all(others.map((id) => balanceOf(run, id)));
      expect(before).toBe(119486);
      // the report's other balances (`docs/plans/m6-deploy.md` 9.7): FH2 1675 ct, FH3 1900, FH4 2500, FH6 2100
      expect(othersBefore).toEqual([1675, 1900, 2500, 2100]);
      expect(await planRows(run, fh1)).toEqual([]);
      // the fixtures carry one legacy `accrual_runs` row of their own
      const bootRunsBefore = await runCount(run, "boot");

      await runTest(
        Effect.gen(function* () {
          yield* TestClock.setTime(Date.UTC(2026, 9, 15, 8, 59, 36));
          yield* startAccrualSchedule();
        }).pipe(Effect.ensuring(stopAccrualSchedule()), Database.withExecutor(run.target.db)),
        { clock: "test" },
      );

      const rows = await planRows(run, fh1);
      expect(rows.map((row) => [row.plan_period, row.description, row.amount_cents])).toEqual([
        ["2026-09", "Fixkostenanteil 09/2026", 51400],
        ["2026-10", "Fixkostenanteil 10/2026", 51400],
      ]);
      expect(await balanceOf(run, fh1)).toBe(222286);
      expect(await Promise.all(others.map((id) => balanceOf(run, id)))).toEqual(othersBefore);
      for (const id of others) expect(await planRows(run, id)).toEqual([]);
      // every finance household got its boot run
      expect((await runCount(run, "boot")) - bootRunsBefore).toBe(await financeHouseholdCount(run));
      expect(await runCount(run, "interval")).toBe(0);
    },
    SCHEDULER_TEST_TIMEOUT_MS,
  );

  test(
    "the interval tick runs six hours after the start, not before: no run at +5 h, the 2026-11 row of 51400 ct at +6 h",
    async () => {
      const run = await migrated();
      const fh1 = financeTarget(run, "FH1");
      const finance = await financeHouseholdCount(run);
      expect(finance).toBeGreaterThan(1);

      const observed = await runTest(
        Effect.gen(function* () {
          // 31 Oct 2026 21:00 Berlin: the boot books 2026-09 and 2026-10.
          yield* TestClock.setTime(Date.UTC(2026, 9, 31, 20, 0));
          yield* startAccrualSchedule();
          const bootRows = yield* Effect.promise(() => planRows(run, fh1));

          // +5 h: no interval run yet. The real-time rounds give a wrongly early tick every chance to show.
          yield* TestClock.adjust("5 hours");
          for (let round = 0; round < 20; round++) yield* settle;
          const earlyRuns = yield* Effect.promise(() => runCount(run, "interval"));
          const earlyRows = yield* Effect.promise(() => planRows(run, fh1));

          // +6 h (1 Nov 2026 03:00 Berlin): the tick fires; poll until every finance household has its interval run.
          yield* TestClock.adjust("1 hour");
          for (let round = 0; round < POLL_ROUNDS; round++) {
            if ((yield* Effect.promise(() => runCount(run, "interval"))) >= finance) break;
            yield* settle;
          }
          const lateRuns = yield* Effect.promise(() => runCount(run, "interval"));
          const lateRows = yield* Effect.promise(() => planRows(run, fh1));
          return { bootRows, earlyRuns, earlyRows, lateRuns, lateRows };
        }).pipe(Effect.ensuring(stopAccrualSchedule()), Database.withExecutor(run.target.db)),
        { clock: "test" },
      );

      expect(observed.bootRows.map((row) => row.plan_period)).toEqual(["2026-09", "2026-10"]);
      expect(observed.earlyRuns).toBe(0);
      expect(observed.earlyRows.map((row) => row.plan_period)).toEqual(["2026-09", "2026-10"]);
      expect(observed.lateRuns).toBe(finance);
      const november = observed.lateRows.filter((row) => row.plan_period === "2026-11");
      expect(november).toHaveLength(1);
      expect(november[0]?.amount_cents).toBe(51400);
      // 1 Nov 2026 00:00 Berlin (CET, UTC+1)
      expect(november[0]?.booked_at).toBe(Date.UTC(2026, 9, 31, 23, 0));
      expect(await balanceOf(run, fh1)).toBe(119486 + 3 * 51400);
    },
    SCHEDULER_TEST_TIMEOUT_MS,
  );

  test("stopAccrualSchedule is idempotent and a second start never forks a second tick", async () => {
    const run = await migrated();
    await runTest(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.UTC(2026, 9, 15, 8, 59, 36));
        yield* startAccrualSchedule();
        yield* startAccrualSchedule();
        yield* stopAccrualSchedule();
        yield* stopAccrualSchedule();
      }).pipe(Effect.ensuring(stopAccrualSchedule()), Database.withExecutor(run.target.db)),
      { clock: "test" },
    );
    // two boot passes over the same data: the second books nothing new
    expect((await planRows(run, financeTarget(run, "FH1"))).map((row) => row.plan_period)).toEqual(["2026-09", "2026-10"]);
  }, SCHEDULER_TEST_TIMEOUT_MS);
});

