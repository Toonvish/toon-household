/**
 * The recipe module's composition, the recipes area (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P4).
 *
 * E3-T04: `RecipeTags` (over `Database`); E3-T06 adds `Recipes`, `RecipeCollections`, which the owning task puts in an outer
 * step and whose type it widens in the same commit. Inside the area a service that needs a sibling goes in an
 * outer `Layer.provideMerge` step, never beside it in one `Layer.mergeAll`; requirements stay open and are satisfied
 * by `recipeLayer()` (`apps/api/src/modules/recipe/layer.ts`) and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { RecipeTags } from "./tags.service.ts";

/** Every service `recipesLayer()` provides. */
export type RecipesServices = RecipeTags;

export function recipesLayer() {
  return RecipeTags.layer;
}
