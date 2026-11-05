/**
 * The finance module's composition, the categories area (docs/EFFECT.md E7; plan `docs/plans/e4-finance-services.md` P4).
 *
 * E4-T01 creates it empty (`Layer.empty`, `CategoriesServices = never`); E4-T03 fills it with `FinanceCategories`, `FinanceTags` and `FinanceMutationClaims`. Inside the
 * area a service that needs a sibling goes in an outer `Layer.provideMerge` step, never beside it in one
 * `Layer.mergeAll`; requirements stay open and are satisfied by `financeLayer()`
 * (`apps/api/src/modules/finance/layer.ts`) and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";

/** Every service `categoriesLayer()` provides. */
export type CategoriesServices = never;

export function categoriesLayer() {
  return Layer.empty;
}
