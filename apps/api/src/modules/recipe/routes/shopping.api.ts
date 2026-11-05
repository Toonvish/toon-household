/** Shopping lists ("Einkaufslisten"); served at /api/households/:householdId/recipe/shopping-lists (docs/API.md "Shopping lists"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";

export const RecipeShoppingGroup = HttpApiGroup.make("recipe.shopping")
  .add(
    /** GET /api/households/:householdId/recipe/shopping-lists */
    HttpApiEndpoint.get("get", "/", { params: { householdId: Schema.String } }),
    /** GET /api/households/:householdId/recipe/shopping-lists/bought */
    HttpApiEndpoint.get("getBought", "/bought", { params: { householdId: Schema.String } }),
    /** POST /api/households/:householdId/recipe/shopping-lists */
    HttpApiEndpoint.post("post", "/", { params: { householdId: Schema.String } }),
    /** GET /api/households/:householdId/recipe/shopping-lists/:listId */
    HttpApiEndpoint.get("getByListId", "/:listId", { params: { householdId: Schema.String, listId: Schema.String } }),
    /** PATCH /api/households/:householdId/recipe/shopping-lists/:listId */
    HttpApiEndpoint.patch("patchByListId", "/:listId", {
      params: { householdId: Schema.String, listId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/recipe/shopping-lists/:listId */
    HttpApiEndpoint.delete("deleteByListId", "/:listId", {
      params: { householdId: Schema.String, listId: Schema.String },
    }),
    /** POST /api/households/:householdId/recipe/shopping-lists/:listId/items */
    HttpApiEndpoint.post("postByListIdItems", "/:listId/items", {
      params: { householdId: Schema.String, listId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/recipe/shopping-lists/:listId/items */
    HttpApiEndpoint.delete("deleteByListIdItems", "/:listId/items", {
      params: { householdId: Schema.String, listId: Schema.String },
    }),
    /** PATCH /api/households/:householdId/recipe/shopping-lists/:listId/items/:itemId */
    HttpApiEndpoint.patch("patchByListIdItemsByItemId", "/:listId/items/:itemId", {
      params: { householdId: Schema.String, listId: Schema.String, itemId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/recipe/shopping-lists/:listId/items/:itemId */
    HttpApiEndpoint.delete("deleteByListIdItemsByItemId", "/:listId/items/:itemId", {
      params: { householdId: Schema.String, listId: Schema.String, itemId: Schema.String },
    }),
    /** POST /api/households/:householdId/recipe/shopping-lists/:listId/items/:itemId/check */
    HttpApiEndpoint.post("postByListIdItemsByItemIdCheck", "/:listId/items/:itemId/check", {
      params: { householdId: Schema.String, listId: Schema.String, itemId: Schema.String },
    }),
    /** POST /api/households/:householdId/recipe/shopping-lists/:listId/bought/clear */
    HttpApiEndpoint.post("postByListIdBoughtClear", "/:listId/bought/clear", {
      params: { householdId: Schema.String, listId: Schema.String },
    }),
    /** POST /api/households/:householdId/recipe/shopping-lists/:listId/bought/:boughtId/undo */
    HttpApiEndpoint.post("postByListIdBoughtByBoughtIdUndo", "/:listId/bought/:boughtId/undo", {
      params: { householdId: Schema.String, listId: Schema.String, boughtId: Schema.String },
    }),
    /** POST /api/households/:householdId/recipe/shopping-lists/:listId/recipes */
    HttpApiEndpoint.post("postByListIdRecipes", "/:listId/recipes", {
      params: { householdId: Schema.String, listId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/recipe/shopping-lists/:listId/recipes/:recipeId */
    HttpApiEndpoint.delete("deleteByListIdRecipesByRecipeId", "/:listId/recipes/:recipeId", {
      params: { householdId: Schema.String, listId: Schema.String, recipeId: Schema.String },
    }),
    /** GET /api/households/:householdId/recipe/shopping-lists/:listId/from-plan */
    HttpApiEndpoint.get("getByListIdFromPlan", "/:listId/from-plan", {
      params: { householdId: Schema.String, listId: Schema.String },
    }),
    /** GET /api/households/:householdId/recipe/shopping-lists/:listId/catalog */
    HttpApiEndpoint.get("getByListIdCatalog", "/:listId/catalog", {
      params: { householdId: Schema.String, listId: Schema.String },
    }),
    /** PATCH /api/households/:householdId/recipe/shopping-lists/:listId/catalog/:entryId */
    HttpApiEndpoint.patch("patchByListIdCatalogByEntryId", "/:listId/catalog/:entryId", {
      params: { householdId: Schema.String, listId: Schema.String, entryId: Schema.String },
    }),
    /** POST /api/households/:householdId/recipe/shopping-lists/:listId/catalog/:entryId */
    HttpApiEndpoint.post("postByListIdCatalogByEntryId", "/:listId/catalog/:entryId", {
      params: { householdId: Schema.String, listId: Schema.String, entryId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/recipe/shopping-lists/:listId/catalog/:entryId */
    HttpApiEndpoint.delete("deleteByListIdCatalogByEntryId", "/:listId/catalog/:entryId", {
      params: { householdId: Schema.String, listId: Schema.String, entryId: Schema.String },
    }),
  )
  .prefix("/shopping-lists")
  // Writes need a confirmed address (middleware/verifiedEmail.ts). Note what
  // this does to the offline outbox: a queued mutation replayed by an unconfirmed
  // account gets a 403, which `networkMode: "offlineFirst"` treats as a real
  // failure rather than a pause — correct, since retrying cannot help until the
  // address is confirmed. The web client keeps such an account out of the outbox
  // in the first place by disabling the write UI.
  .pipe(chain(RequireVerifiedEmail));

export const RecipeShoppingApi = householdModuleApi("recipe", HttpApi.make("recipe.shopping").add(RecipeShoppingGroup));
