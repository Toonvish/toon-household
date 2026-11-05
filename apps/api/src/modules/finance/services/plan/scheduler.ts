/**
 * Triggers the fixed-cost catch-up WITHOUT a cron dependency (docs/spec.md
 * §3.7): once at API boot — after migrations, before the server accepts
 * traffic — and then every 6 hours. Both paths funnel through the same
 * `FinanceAccrual.runCatchUp`, so a boot run and an interval tick can never
 * disagree about what "already booked" means; the unique index on
 * `external_key` makes a second, overlapping tick a safe no-op even if one is
 * still in flight.
 *
 * ON `Schedule` (docs/EFFECT.md E7, E12; plan `docs/plans/e4-finance-services.md` P8). Not a service: it holds the
 * process's one tick fiber, a lifecycle and not a dependency. `startAccrualSchedule` awaits the boot run, then forks
 * a DETACHED fiber running `Effect.schedule(tick, Schedule.spaced("6 hours"))` (`Effect.schedule` steps the schedule
 * before the first run, so the first interval run comes six hours AFTER the start, as `setInterval` did) and stores it
 * in the module-level `tickFiber`; `stopAccrualSchedule` interrupts it (the manifest's `shutdown`, which the API runs
 * before it disposes the runtime, so the tick never outlives the database). The time is the fiber's `Clock`, so a
 * `TestClock` drives the tick (`apps/api/test/finance-scheduler.test.ts`). The finance services are built through
 * `withFinanceServices` over the CURRENT `Database` of the calling fiber (a local memo map, plan P4).
 *
 * Never started under `bun test` (src/index.ts gates `start` on `!env.isTest`) — a repeating timer would keep the
 * test process alive past its last assertion; the scheduler test starts and stops it itself.
 *
 * Import cycle (CLAUDE.md "API import cycle"): the module scope reads only `effect` exports.
 */
import { and, eq } from "drizzle-orm";
import { Cause, Effect, Fiber, Schedule } from "effect";
import { db as sharedDb } from "../../../../db/client.ts";
import { Database } from "../../../../db/database.ts";
import type { Database as DatabaseService } from "../../../../db/database.ts";
import { householdModules, households } from "../../../../db/schema.ts";
import { type DatabaseError, isDatabaseError } from "../../../../lib/errors.ts";
import { runModuleHook } from "../../../adapter.ts";
import { runFinanceBridge } from "../../bridge.ts";
import { withFinanceServices } from "../../layer.ts";
import { FinanceAccrual } from "./accrual.service.ts";

/** The one tick fiber of the process (the old `intervalHandle`). */
let tickFiber: Fiber.Fiber<unknown, never> | undefined;

/**
 * Ids of the households with finance enabled: a `household_modules` row
 * with `module_id = 'finance'`. The catch-up runs for these only, never for a household
 * that never turned the module on (plan M3-T06 step 1).
 */
export const financeHouseholdIds = Effect.fnUntraced(function* () {
  const database = yield* Database;
  const rows = yield* database.use((db) =>
    db
      .select({ id: households.id })
      .from(households)
      .innerJoin(householdModules, and(eq(householdModules.householdId, households.id), eq(householdModules.moduleId, "finance"))),
  );
  return rows.map((row) => row.id);
});

/** What a failed run logs: a `DatabaseError` shows the driver error it wraps (the line the old `catch` printed). */
function loggedError(cause: Cause.Cause<unknown>): unknown {
  const squashed = Cause.squash(cause);
  return isDatabaseError(squashed) ? squashed.cause : squashed;
}

/**
 * One catch-up per finance household. It never fails on a household: a genuinely unexpected failure (already recorded
 * in `accrual_runs` by `runCatchUp` itself) must not take the whole boot sequence down, and must not stop the OTHER
 * households in this loop from getting their run (an interruption, a shutdown, does stop it).
 */
export const runForEveryHousehold = Effect.fn("FinanceScheduler.runForEveryHousehold")(function* (
  trigger: "boot" | "interval",
) {
  const accrual = yield* FinanceAccrual;
  const ids = yield* financeHouseholdIds();
  for (const id of ids) {
    // requireEnabled/throwOnIncomplete: false — an automatic tick is not a
    // user action; a disabled plan or incomplete data is simply "nothing to
    // do", recorded in accrual_runs, never a rejected request.
    yield* accrual.runCatchUp(id, { trigger, requireEnabled: false, throwOnIncomplete: false }).pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.sync(() => console.error(`[plan] catch-up failed for household ${id}:`, loggedError(cause))),
      ),
    );
  }
});

/**
 * Starts the repeating 6-hour tick unless it already runs (idempotent: a second call never starts a second fiber). The
 * fiber is DETACHED and inherits the calling fiber's context (`Database` with its executor, the `Clock`); each tick
 * builds its own finance services through `withFinanceServices`. One tick's failure never ends the schedule (an
 * unhandled rejection of `setInterval`'s callback never ended it either); an interruption does.
 */
export function startAccrualTick(): Effect.Effect<void, never, DatabaseService> {
  return Effect.suspend(() => {
    if (tickFiber !== undefined) return Effect.void;
    const tick = withFinanceServices(runForEveryHousehold("interval")).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.sync(() => console.error("[plan] interval catch-up failed:", loggedError(cause))),
      ),
    );
    return Effect.forkDetach(Effect.schedule(tick, Schedule.spaced("6 hours"))).pipe(
      Effect.tap((fiber) =>
        Effect.sync(() => {
          tickFiber = fiber;
        }),
      ),
      Effect.asVoid,
    );
  });
}

/**
 * The manifest's `start`: the boot catch-up (awaited: a failure of `financeHouseholdIds` itself fails `start`, which the
 * API logs as `[api] start of module finance failed:`, and the tick is then not started), then the 6-hour tick.
 */
export const startAccrualSchedule = Effect.fn("FinanceScheduler.startAccrualSchedule")(function* (): Effect.fn.Return<
  void,
  DatabaseError,
  DatabaseService
> {
  yield* withFinanceServices(runForEveryHousehold("boot"));
  yield* startAccrualTick();
});

/** Stops the tick: the manifest's `shutdown`, and the tests. */
export function stopAccrualSchedule(): Effect.Effect<void> {
  return Effect.suspend(() => {
    const fiber = tickFiber;
    tickFiber = undefined;
    return fiber === undefined ? Effect.void : Fiber.interrupt(fiber);
  });
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/** Callers: `index.ts`, the Promise manifest's `start` (E4-T07 deletes it). Over the shared `db`, as before. */
export function runBootCatchUp(): Promise<void> {
  return runFinanceBridge(runForEveryHousehold("boot"), sharedDb);
}

/** Callers: `index.ts`, the Promise manifest's `start` (E4-T07 deletes it). Starts the tick; never rejects. */
export function startAccrualScheduler(): void {
  void runModuleHook(startAccrualTick(), sharedDb).catch((error: unknown) => {
    console.error("[plan] could not start the interval tick:", error);
  });
}

/** Callers: `index.ts`, the Promise manifest's `shutdown` (E4-T07 deletes it). Needs no database; never rejects. */
export function stopAccrualScheduler(): void {
  void Effect.runPromise(stopAccrualSchedule());
}
