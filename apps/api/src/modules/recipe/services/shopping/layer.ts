/**
 * The recipe module's composition, the shopping area (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P4).
 *
 * E3-T04: `ShoppingLists`, `ShoppingMutations` (both over `Database`, so one `Layer.mergeAll` holds them); E3-T09 adds
 * `ShoppingItems`, `ShoppingBought`, which need them and go in an outer `Layer.provideMerge` step. Inside the area a service that needs a sibling goes in an
 * outer `Layer.provideMerge` step, never beside it in one `Layer.mergeAll`; requirements stay open and are satisfied
 * by `recipeLayer()` (`apps/api/src/modules/recipe/layer.ts`) and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";
import { ShoppingMutations } from "./idempotency.ts";
import { ShoppingLists } from "./lists.service.ts";

/** Every service `shoppingLayer()` provides. */
export type ShoppingServices = ShoppingLists | ShoppingMutations;

export function shoppingLayer() {
  return Layer.mergeAll(ShoppingLists.layer, ShoppingMutations.layer);
}
