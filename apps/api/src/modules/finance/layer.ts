/**
 * The finance module's one composition (docs/EFFECT.md E7; SPEC §2; plan `docs/plans/e4-finance-services.md` P4):
 * every finance service, the areas nested by dependency. `Layer.provideMerge` satisfies the left side's requirements
 * from the right side and keeps both outputs; `Layer.mergeAll` feeds no member into another, so an area that needs
 * another area sits in an OUTER step:
 *
 *   setup + plan   (FinanceSetup needs participants; FinanceAccrual needs ledger, participants, categories)
 *   over ledger    (needs participants and categories)
 *   over participants + categories   (over `Database` and `AppConfig` only)
 *
 * What `financeLayer()` leaves open is `Database | AppConfig` (both `ModuleRequirements`, `src/modules/types.ts`):
 * the runtime nests the module over the core and the infrastructure (`src/runtime.ts`), and the manifest exports it
 * as `layer: Layer.suspend(financeLayer)`.
 *
 * The hooks, the bridges (`./bridge.ts`) and the scheduler do NOT use the runtime's copy: they run OUTSIDE the
 * runtime too (`runModuleHook` in `scripts/seed.ts`, `runMigrations`, the scripts), where nothing but `Database`
 * exists. `withFinanceServices(effect)` builds the services over the CURRENT `Database` of the calling fiber with a
 * fresh memo map (`{ local: true }`): a plain `Effect.provide(layer)` would take a child of the runtime's memo map
 * (`Layer.buildWithScope`, `CurrentMemoMap.forkOrCreate`) and reuse the leaf layers the `AppLayer` memoized, bound
 * to the runtime's `Database`, so a test's private database (`Database.layerFrom(…)`, `Database.withExecutor(db)`)
 * would never be reached. No finance service holds state, so the copies cannot disagree.
 *
 * Import cycle (CLAUDE.md "API import cycle"): hoisted functions and types only; nothing runs at import.
 */
import { Effect, Layer } from "effect";
import { AppConfig } from "../../config.ts";
import type { Database as DatabaseService } from "../../db/database.ts";
import { type CategoriesServices, categoriesLayer } from "./services/categories/layer.ts";
import { type LedgerServices, ledgerLayer } from "./services/ledger/layer.ts";
import { type ParticipantsServices, participantsLayer } from "./services/participants/layer.ts";
import { type PlanServices, planLayer } from "./services/plan/layer.ts";
import { type SetupServices, setupLayer } from "./services/setup/layer.ts";

/** Every service the finance module provides (`src/modules/index.ts` `ModuleServices`). */
export type FinanceServices =
  | ParticipantsServices
  | CategoriesServices
  | LedgerServices
  | PlanServices
  | SetupServices;

/** Every finance service, the areas nested by dependency. */
export function financeLayer() {
  return Layer.mergeAll(setupLayer(), planLayer()).pipe(
    Layer.provideMerge(ledgerLayer()),
    Layer.provideMerge(Layer.mergeAll(participantsLayer(), categoriesLayer())),
  );
}

/** The same services with `AppConfig` provided: what a hook or a bridge needs besides `Database`. */
export function financeStandaloneLayer() {
  return financeLayer().pipe(Layer.provide(AppConfig.layer));
}

/**
 * Runs `effect` with the finance services built over the CURRENT `Database` (hooks, bridges, the scheduler), with a fresh
 * memo map (`local: true`), so a copy memoized by the runtime's `AppLayer` is never reused.
 */
export function withFinanceServices<A, E>(
  effect: Effect.Effect<A, E, FinanceServices | DatabaseService>,
): Effect.Effect<A, E, DatabaseService> {
  return effect.pipe(Effect.provide(financeStandaloneLayer(), { local: true }));
}
