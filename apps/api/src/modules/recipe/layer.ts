/**
 * The recipe module's one composition (docs/EFFECT.md E7; SPEC §2; plan `docs/plans/e3-recipe-services.md` P4): every
 * recipe service, the areas nested by dependency. `Layer.provideMerge` satisfies the left side's requirements from the
 * right side and keeps both outputs; `Layer.mergeAll` feeds no member into another, so an area that needs another area
 * sits in an OUTER step:
 *
 *   plan        (MealPlan, CookLog, ShoppingFromPlan: need Recipes, ShoppingLists)
 *   over shopping   (needs Recipes)
 *   over recipes    (needs RemoteImages)
 *   over import + cards   (ImportCommit needs RemoteImages)
 *   over url import (HeroImages needs ImportFiles)
 *   over ocr
 *
 * Whatever is left open (`Database`, `AppConfig`, `Thumbnails`, …) must be a `ModuleRequirements` service (`src/modules/types.ts`): the
 * runtime nests the modules over the core and the infrastructure (`src/runtime.ts`). The manifest exports this as
 * `layer: Layer.suspend(recipeLayer)` typed `ApiModule<RecipeServices>`, so a requirement outside
 * `ModuleRequirements`, or a service of `RecipeServices` the composition does not output, is a `tsc` error there.
 *
 * Import cycle (CLAUDE.md "API import cycle"): hoisted functions and types only; nothing runs at import.
 */
import { Layer } from "effect";
import { type CardsServices, cardsLayer } from "./services/cards/layer.ts";
import { type ImportServices, importLayer } from "./services/import/layer.ts";
import { type UrlImportServices, urlImportLayer } from "./services/import/url/layer.ts";
import { type OcrServices, ocrLayer } from "./services/ocr/layer.ts";
import { type PlanServices, planLayer } from "./services/plan/layer.ts";
import { type RecipesServices, recipesLayer } from "./services/recipes/layer.ts";
import { type ShoppingServices, shoppingLayer } from "./services/shopping/layer.ts";

/** Every service the recipe module provides (`src/modules/index.ts` `ModuleServices`). */
export type RecipeServices =
  | OcrServices
  | UrlImportServices
  | ImportServices
  | CardsServices
  | RecipesServices
  | ShoppingServices
  | PlanServices;

/** The recipe module's services, the areas nested by dependency (P4, final form). */
export function recipeLayer() {
  return planLayer().pipe(
    Layer.provideMerge(shoppingLayer()),
    Layer.provideMerge(recipesLayer()),
    Layer.provideMerge(Layer.mergeAll(importLayer(), cardsLayer())),
    Layer.provideMerge(urlImportLayer()),
    Layer.provideMerge(ocrLayer()),
  );
}
