/**
 * The recipe module's two routers (plan M2 decision 3, SPEC D8), composed in
 * toon-recipe's mount order: imports, shopping lists and plan BEFORE the recipe
 * router, whose `/:recipeId`-style catch-alls would otherwise shadow them.
 *
 *   recipeHouseholdRouter -> /api/households/:householdId/recipe/{imports,shopping-lists,plan,recipes,tags,collections}/…
 *                            (behind requireSession() -> requireHouseholdRole("member") -> requireModule("recipe"),
 *                            applied by modules/mount.ts; each router adds requireVerifiedEmail() itself)
 *   recipeUserRouter      -> /api/recipe/cards/…  (user-owned, NOT behind requireModule: a card follows its
 *                            owner, toon-recipe decision 11; cardRoutes runs its own requireSession())
 *
 * Hono copies a sub-app's routes when `.route()` is called, so every router file must
 * register its handlers at module top level (as toon-recipe's do) — never later.
 *
 * The HttpApi side (docs/EFFECT.md E7, E8; plan `docs/plans/e7-http-api.md` P14, P15; E7-T10, beside the Hono
 * routers until E7-T11 removes them): the manifest's `householdApi` / `userApi` (`ModuleHttpApi`) read the hoisted
 * functions below, never their results at module scope (the import cycle):
 *
 *   recipeHouseholdApis()      RecipeImportsApi, RecipeShoppingApi, RecipePlanApi, RecipeRecipesApi
 *                              (householdModuleApi("recipe", …): /api/households/:householdId/recipe/…)
 *   recipeHouseholdHandlers()  the handler layers of their four groups
 *   recipeUserApis()           RecipeCardsApi (userModuleApi("recipe", …): /api/recipe/cards/…)
 *   recipeUserHandlers()       its handler layer
 *
 * On the router the order does not matter (specificity decides, not registration order); the APIs are listed in the
 * Hono mount order all the same.
 */
import { Layer } from "effect";
import { Hono } from "hono";
import type { AppEnv } from "../../../lib/types.ts";
import type { AnyHttpApi } from "../../types.ts";
import { RecipeCardsApi } from "./cards.api.ts";
import { cardRoutes, cardsHandlers } from "./cards.ts";
import { RecipeImportsApi } from "./imports.api.ts";
import { importRoutes, importsHandlers } from "./imports.ts";
import { RecipePlanApi } from "./plan.api.ts";
import { planRoutes, recipePlanHandlers } from "./plan.ts";
import { RecipeRecipesApi } from "./recipes.api.ts";
import { recipeRoutes, recipesHandlers } from "./recipes.ts";
import { RecipeShoppingApi } from "./shopping.api.ts";
import { shoppingHandlers, shoppingRoutes } from "./shopping.ts";

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

export const recipeHouseholdRouter = new Hono<AppEnv>()
  .route("/imports", importRoutes)
  .route("/shopping-lists", shoppingRoutes)
  .route("/plan", planRoutes)
  .route("/", recipeRoutes);

export const recipeUserRouter = new Hono<AppEnv>().route("/cards", cardRoutes);
