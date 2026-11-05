/**
 * The runner of the finance module's legacy Promise bridges (docs/EFFECT.md E3, E7; plan
 * `docs/plans/e4-finance-services.md` P1; ADR 0014).
 *
 * A converted finance service keeps, for every old export a caller outside the converted set still uses (a script,
 * an unconverted service, a pinned test), a bridge with the old `(db, …) => Promise<T>` signature:
 *
 *   export function slot1UserId(db: DbLike, householdId: string): Promise<string> {
 *     return runFinanceBridge(FinanceParticipants.use((service) => service.slot1UserId(householdId)), db);
 *   }
 *
 * `runFinanceBridge(effect, executor)` builds the finance services over `executor` (`withFinanceServices`, a local
 * memo map, `./layer.ts`) and runs the effect with `runModuleHook`, which makes `executor` the root of `Database`
 * (`Database.layerFromExecutor`): a bridge called inside an open drizzle transaction runs on that transaction, one
 * called with the `migrate:legacy` target runs on the target. The rejection is mapped once: a `DatabaseError`
 * rejects with its `cause` (the raw driver error the old Promise function threw), anything else with the squashed
 * value unchanged (a refusal of the API error family is the same object, `instanceof ApiError` holds).
 *
 * This file NEVER imports `src/runtime.ts`: `scripts/legacy/balance.ts` runs inside `migrate:legacy`, whose import
 * order is load-bearing (CLAUDE.md "The CLI never imports `src/env.ts`, and its import order is load-bearing"), and
 * must never reach the shared database. Import cycle (CLAUDE.md "API import cycle"): a hoisted function only.
 */
import type { Effect } from "effect";
import type { Database as DatabaseService, DbExecutor } from "../../db/database.ts";
import { isDatabaseError } from "../../lib/errors.ts";
import { runModuleHook } from "../adapter.ts";
import { type FinanceServices, withFinanceServices } from "./layer.ts";

/** Runs a finance effect on a bare drizzle executor, as the old Promise functions did (P1). */
export function runFinanceBridge<A, E>(
  effect: Effect.Effect<A, E, FinanceServices | DatabaseService>,
  executor: DbExecutor,
): Promise<A> {
  return runModuleHook(withFinanceServices(effect), executor).then(undefined, (error: unknown) =>
    Promise.reject(isDatabaseError(error) ? error.cause : error),
  );
}
