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
 */
import { Hono } from "hono";
import type { AppEnv } from "../../../lib/types.ts";
import { cardRoutes } from "./cards.ts";
import { importRoutes } from "./imports.ts";
import { planRoutes } from "./plan.ts";
import { recipeRoutes } from "./recipes.ts";
import { shoppingRoutes } from "./shopping.ts";

export const recipeHouseholdRouter = new Hono<AppEnv>()
  .route("/imports", importRoutes)
  .route("/shopping-lists", shoppingRoutes)
  .route("/plan", planRoutes)
  .route("/", recipeRoutes);

export const recipeUserRouter = new Hono<AppEnv>().route("/cards", cardRoutes);
