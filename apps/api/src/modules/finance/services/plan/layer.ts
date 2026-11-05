/**
 * The finance module's composition, the plan area (docs/EFFECT.md E7; plan `docs/plans/e4-finance-services.md` P4).
 *
 * `FinancePlan` (E4-T05, needs `FinanceParticipants`) and `FinanceAccrual` (E4-T06, needs `FinancePlan` plus the
 * ledger, participants, categories, settings and tags services). Inside the area a service that needs a sibling goes
 * in an outer `Layer.provideMerge` step, never beside it in one `Layer.mergeAll`: `FinanceAccrual.layer` is the outer
 * step, `FinancePlan.layer` the inner one, and every other requirement stays open and is satisfied by `financeLayer()`
 * (`apps/api/src/modules/finance/layer.ts`) and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";
import { FinanceAccrual } from "./accrual.service.ts";
import { FinancePlan } from "./plan.service.ts";

/** Every service `planLayer()` provides. */
export type PlanServices = FinancePlan | FinanceAccrual;

export function planLayer() {
  return FinanceAccrual.layer.pipe(Layer.provideMerge(FinancePlan.layer));
}
