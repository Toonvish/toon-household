/**
 * The finance module's composition, the plan area (docs/EFFECT.md E7; plan `docs/plans/e4-finance-services.md` P4).
 *
 * E4-T01 creates it empty (`Layer.empty`, `PlanServices = never`); E4-T05 and E4-T06 fills it with `FinancePlan` and `FinanceAccrual`. Inside the
 * area a service that needs a sibling goes in an outer `Layer.provideMerge` step, never beside it in one
 * `Layer.mergeAll`; requirements stay open and are satisfied by `financeLayer()`
 * (`apps/api/src/modules/finance/layer.ts`) and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";

/** Every service `planLayer()` provides. */
export type PlanServices = never;

export function planLayer() {
  return Layer.empty;
}
