/**
 * The recipe module's composition, the meal plan area (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P4).
 *
 * `MealPlan` (E3-T08, over `Database` and `Recipes`), then `CookLog` (over `Recipes`, `MealPlan`) and `ShoppingFromPlan`
 * (over `MealPlan`, `ShoppingLists`), which need it and go in an outer `Layer.provideMerge` step: inside an area a
 * service that needs a sibling never sits beside it in one `Layer.mergeAll`. Requirements stay open (`Database`,
 * `Recipes`, `ShoppingLists`) and are satisfied by `recipeLayer()` (`apps/api/src/modules/recipe/layer.ts`) and the
 * areas under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";
import { CookLog } from "../recipes/cookLog.ts";
import { ShoppingFromPlan } from "../shopping/fromPlan.service.ts";
import { MealPlan } from "./plan.service.ts";

/** Every service `planLayer()` provides. */
export type PlanServices = MealPlan | CookLog | ShoppingFromPlan;

export function planLayer() {
  return Layer.mergeAll(CookLog.layer, ShoppingFromPlan.layer).pipe(Layer.provideMerge(MealPlan.layer));
}
