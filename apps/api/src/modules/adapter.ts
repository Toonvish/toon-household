/**
 * The one helper left of the bridge between the Promise-based core callers and the Effect module
 * contract (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P11; SPEC §2). Every
 * manifest implements `ApiModule` itself (recipe since E3, finance since E4), so the adapter that
 * wrapped Promise manifests is gone.
 *
 * `runModuleHook(effect, executor)` runs a hook effect outside the runtime on a BARE drizzle
 * executor (`Database.layerFromExecutor`): the Promise-based callers (`runMigrations`,
 * `collectUploadReferences`, `seed`) hold a root instance or an open drizzle transaction and hand
 * it over; the hook receives that very executor. A failure rejects with the squashed value (a
 * refusal is the same object). The finance bridges run through it too (`runFinanceBridge`,
 * `src/modules/finance/bridge.ts`, plan e4 P1); it stays after E4 for the scripts (E5).
 *
 * This file never imports `src/runtime.ts`: `src/db/migrate.ts` imports it, and
 * `scripts/migrate-legacy.ts` imports `migrate.ts` only after redirecting `DATABASE_URL`
 * (CLAUDE.md "The CLI never imports `src/env.ts`, and its import order is load-bearing").
 */
import { Effect } from "effect";
import { Database, type DbExecutor } from "../db/database.ts";

/**
 * Runs a hook effect on a bare drizzle executor, outside the runtime (plan e2 P11): the hook sees
 * `executor` as the root of `Database` (`Database.layerFromExecutor`), so a hook that reads
 * `Database.executor` receives that very executor. Resolves with the hook's value; a failure or a
 * defect rejects with the squashed value (a refusal is the object the hook raised).
 */
export function runModuleHook<A, E>(effect: Effect.Effect<A, E, Database>, executor: DbExecutor): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(Database.layerFromExecutor(executor))));
}
