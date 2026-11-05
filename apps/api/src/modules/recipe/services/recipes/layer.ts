/**
 * The recipe module's composition, the recipes area (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P4).
 *
 * `RecipeTags` (E3-T04, over `Database`), `Recipes` (E3-T06, over `RecipeTags` and `RemoteImages`) and
 * `RecipeCollections` (E3-T06, over `Recipes` and `RemoteImages`). Inside the area a service that needs a sibling goes
 * in an outer `Layer.provideMerge` step, never beside it in one `Layer.mergeAll`; requirements stay open
 * (`Database`, `RemoteImages`) and are satisfied by `recipeLayer()` (`apps/api/src/modules/recipe/layer.ts`) and the
 * layers and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";
import { RecipeCollections } from "./collections.service.ts";
import { Recipes } from "./recipes.service.ts";
import { RecipeTags } from "./tags.service.ts";

/** Every service `recipesLayer()` provides. */
export type RecipesServices = RecipeTags | Recipes | RecipeCollections;

export function recipesLayer() {
  return RecipeCollections.layer.pipe(Layer.provideMerge(Recipes.layer), Layer.provideMerge(RecipeTags.layer));
}
