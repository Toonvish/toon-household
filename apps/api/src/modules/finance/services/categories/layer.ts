/**
 * The finance module's composition, the categories area (docs/EFFECT.md E7; plan `docs/plans/e4-finance-services.md` P4).
 *
 * `FinanceCategories`, `FinanceTags` and `FinanceMutationClaims`: leaves over `Database` only, so one `Layer.mergeAll`
 * holds them. Inside an area a service that needs a sibling goes in an outer `Layer.provideMerge` step, never beside it in
 * one `Layer.mergeAll`; requirements stay open and are satisfied by `financeLayer()`
 * (`apps/api/src/modules/finance/layer.ts`) and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import, and the services are
 * read inside the function body (the service files import the bridge runner, which imports `layer.ts`, which imports
 * this file).
 */
import { Layer } from "effect";
import { FinanceMutationClaims } from "../ledger/idempotency.ts";
import { FinanceTags } from "../tags/tags.service.ts";
import { FinanceCategories } from "./categories.service.ts";

/** Every service `categoriesLayer()` provides. */
export type CategoriesServices = FinanceCategories | FinanceTags | FinanceMutationClaims;

export function categoriesLayer() {
  return Layer.mergeAll(FinanceCategories.layer, FinanceTags.layer, FinanceMutationClaims.layer);
}
