/**
 * The test door of `apps/api/src/modules/finance/bridge.ts` (docs/EFFECT.md E3, E7, E9; plan
 * `docs/plans/e8-harden.md` P1): moved from `apps/api/src/modules/finance/bridge.ts` at E8 (plan e8 P1).
 *
 * `runFinanceBridge(effect, executor)` builds the finance services over `executor` (`withFinanceServices`, a local
 * memo map) and runs the effect outside the runtime with `Effect.runPromise`, providing
 * `Database.layerFromExecutor(executor)`, which makes `executor` the root of `Database` (a bare drizzle executor,
 * nothing closed). The rejection is mapped once: a `DatabaseError` rejects with its `cause` (the raw driver error the
 * old Promise function threw), anything else with the squashed value unchanged (a refusal of the API error family is
 * the same object, `instanceof ApiError` holds).
 *
 * Like its source module, this file NEVER imports `src/runtime.ts`.
 */
import { Effect } from "effect";
import { Database, type DbExecutor } from "../../../src/db/database.ts";
import { isDatabaseError } from "../../../src/lib/errors.ts";
import { type FinanceServices, withFinanceServices } from "../../../src/modules/finance/layer.ts";

/**
 * Runs a finance effect on a bare drizzle executor, as the old Promise functions did. Moved from
 * `apps/api/src/modules/finance/bridge.ts` at E8 (plan e8 P1). Callers: `apps/api/test/finance-clock.test.ts`,
 * `apps/api/test/finance-security.test.ts`, the finance-participants door (`./finance-participants.ts`).
 */
export function runFinanceBridge<A, E>(
  effect: Effect.Effect<A, E, FinanceServices | Database>,
  executor: DbExecutor,
): Promise<A> {
  return Effect.runPromise(withFinanceServices(effect).pipe(Effect.provide(Database.layerFromExecutor(executor)))).then(
    undefined,
    (error: unknown) => Promise.reject(isDatabaseError(error) ? error.cause : error),
  );
}
