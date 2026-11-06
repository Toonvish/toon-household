/**
 * The recipe module's HTTP surface (plan M2 decision 3, SPEC §2, D8; docs/EFFECT.md E7, E8; plan
 * `docs/plans/e7-http-api.md` P14, P15): the `HttpApi`s of its route files and their handler layers, which the manifest
 * contributes as `householdApi` / `userApi` (`ModuleHttpApi`):
 *
 *   recipeHouseholdApis()      RecipeImportsApi, RecipeShoppingApi, RecipePlanApi, RecipeRecipesApi
 *                              (householdModuleApi("recipe", …): /api/households/:householdId/recipe/{imports,
 *                              shopping-lists,plan,recipes,tags,collections}/…, behind ApiErrorBoundary ->
 *                              RequireSession -> RequireHouseholdMember -> RequireModule; each group attaches
 *                              RequireVerifiedEmail itself)
 *   recipeHouseholdHandlers()  the handler layers of their four groups
 *   recipeUserApis()           RecipeCardsApi (userModuleApi("recipe", …): /api/recipe/cards/…, user-owned, NOT behind
 *                              RequireModule: a card follows its owner, toon-recipe decision 11; the group runs its own
 *                              RequireSession)
 *   recipeUserHandlers()       its handler layer
 *
 * Every list is computed in a hoisted function and read by the manifest lazily (a getter, `Layer.suspend`), never at
 * module scope: the manifest is evaluated inside the API's import cycle, where these route files may not be. The
 * router matches by specificity, not registration order, so toon-recipe's mount order (imports, shopping lists and
 * plan BEFORE the recipe routes, whose `/:recipeId` paths would have shadowed them in pre-E7 Hono) no longer matters; the APIs
 * are listed in that order all the same.
 */
import { Layer } from "effect";
import type { AnyHttpApi } from "../../types.ts";
import { RecipeCardsApi } from "./cards.api.ts";
import { cardsHandlers } from "./cards.ts";
import { RecipeImportsApi } from "./imports.api.ts";
import { importsHandlers } from "./imports.ts";
import { RecipePlanApi } from "./plan.api.ts";
import { recipePlanHandlers } from "./plan.ts";
import { RecipeRecipesApi } from "./recipes.api.ts";
import { recipesHandlers } from "./recipes.ts";
import { RecipeShoppingApi } from "./shopping.api.ts";
import { shoppingHandlers } from "./shopping.ts";

/** The recipe module's household APIs (P14), one per route file. */
export function recipeHouseholdApis(): ReadonlyArray<AnyHttpApi> {
  return [RecipeImportsApi, RecipeShoppingApi, RecipePlanApi, RecipeRecipesApi];
}

/** The handlers of every group of `recipeHouseholdApis()`. */
export function recipeHouseholdHandlers() {
  return Layer.mergeAll(importsHandlers, shoppingHandlers, recipePlanHandlers, recipesHandlers);
}

/** The recipe module's user-scoped APIs (P14): the saved cards. */
export function recipeUserApis(): ReadonlyArray<AnyHttpApi> {
  return [RecipeCardsApi];
}

/** The handlers of `recipeUserApis()`. */
export function recipeUserHandlers() {
  return cardsHandlers;
}
