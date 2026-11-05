#!/usr/bin/env bun
/**
 * `bun run scripts/plan-run.ts [householdId]` — runs the fixed-cost catch-up
 * by hand, for ops (docs/spec.md §5.2, ledger-spec.md §4.5). The API already
 * does this at boot and every 6 hours (services/plan/scheduler.ts); this
 * exists for the rare case an operator needs it NOW, without waiting or
 * restarting the container — same `requireEnabled: false,
 * throwOnIncomplete: false` semantics as the automatic tick, so a disabled
 * plan or incomplete data is reported, never a crashing script.
 *
 * With no argument, runs every household with finance enabled. With one, runs only
 * that one (and only if finance is enabled for it).
 *
 * An Effect program on the one `AppLayer` (docs/EFFECT.md E10; plan `docs/plans/e5-scripts.md` P1, P2, P5, P18): the
 * household query goes through `Database`, `FinanceAccrual` is yielded once, and the exit code travels as the
 * program's numeric success (1 when a household failed, or when the named one has no enabled finance).
 */
import { and, eq } from "drizzle-orm";
import { Cause, Console, Effect, Exit, Predicate } from "effect";
import { Database } from "../src/db/database.ts";
import { householdModules, households } from "../src/db/schema.ts";
import { isDatabaseError } from "../src/lib/errors.ts";
import { FinanceAccrual } from "../src/modules/finance/services/plan/accrual.service.ts";
import { AppLayer } from "../src/runtime.ts";
import { runScript } from "./support/main.ts";

const financeEnabled = and(eq(householdModules.householdId, households.id), eq(householdModules.moduleId, "finance"));

/** The message the old `catch (error)` printed: the raw driver error of a `DatabaseError`, else the value itself. */
function rawMessage(cause: Cause.Cause<unknown>): unknown {
  const squashed = Cause.squash(cause);
  const raw = isDatabaseError(squashed) ? squashed.cause : squashed;
  return Predicate.isError(raw) ? raw.message : raw;
}

export const planRun = Effect.fn("plan-run")(function* (targetId: string | undefined) {
  const database = yield* Database;
  const rows = yield* database.use((db) =>
    targetId
      ? db
          .select({ id: households.id, name: households.name })
          .from(households)
          .innerJoin(householdModules, financeEnabled)
          .where(eq(households.id, targetId))
      : db.select({ id: households.id, name: households.name }).from(households).innerJoin(householdModules, financeEnabled),
  );

  if (rows.length === 0) {
    yield* Console.error(targetId ? `[plan-run] no household ${targetId} with finance enabled` : "[plan-run] no households to run");
    return targetId ? 1 : 0;
  }

  const accrual = yield* FinanceAccrual;
  let exitCode = 0;
  for (const row of rows) {
    const exit = yield* Effect.exit(
      accrual.runCatchUp(row.id, { trigger: "manual", requireEnabled: false, throwOnIncomplete: false }),
    );
    if (Exit.isSuccess(exit)) {
      const result = exit.value;
      yield* Console.log(
        `[plan-run] ${row.name} (${row.id}): booked ${result.bookedPeriods.length} period(s), skipped ${result.skippedPeriods.length}, ${result.bookedCents} ct total`,
      );
    } else {
      exitCode = 1;
      yield* Console.error(`[plan-run] ${row.name} (${row.id}) failed:`, rawMessage(exit.cause));
    }
  }
  return exitCode;
});

if (import.meta.main) {
  runScript(planRun(process.argv[2]).pipe(Effect.provide(AppLayer)));
}
