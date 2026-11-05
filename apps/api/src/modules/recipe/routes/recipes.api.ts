/**
 * OWNER: recipes agent; served at /api/households/:householdId/recipe (docs/API.md "Recipes", "Tags", "Collections").
 */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireHouseholdAdmin, RequireVerifiedEmail } from "../../../http/middleware.ts";

export const RecipeRecipesGroup = HttpApiGroup.make("recipe.recipes")
  .add(
    /** GET /api/households/:householdId/recipe/recipes */
    HttpApiEndpoint.get("getRecipes", "/recipes", { params: { householdId: Schema.String } }),
    /** POST /api/households/:householdId/recipe/recipes */
    HttpApiEndpoint.post("postRecipes", "/recipes", { params: { householdId: Schema.String } }),
    /** GET /api/households/:householdId/recipe/recipes/:recipeId */
    HttpApiEndpoint.get("getRecipesByRecipeId", "/recipes/:recipeId", {
      params: { householdId: Schema.String, recipeId: Schema.String },
    }),
    /** PATCH /api/households/:householdId/recipe/recipes/:recipeId */
    HttpApiEndpoint.patch("patchRecipesByRecipeId", "/recipes/:recipeId", {
      params: { householdId: Schema.String, recipeId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/recipe/recipes/:recipeId */
    HttpApiEndpoint.delete("deleteRecipesByRecipeId", "/recipes/:recipeId", {
      params: { householdId: Schema.String, recipeId: Schema.String },
    }),
    /** POST /api/households/:householdId/recipe/recipes/:recipeId/image */
    HttpApiEndpoint.post("postRecipesByRecipeIdImage", "/recipes/:recipeId/image", {
      params: { householdId: Schema.String, recipeId: Schema.String },
    }),
    /** POST /api/households/:householdId/recipe/recipes/:recipeId/cooked */
    HttpApiEndpoint.post("postRecipesByRecipeIdCooked", "/recipes/:recipeId/cooked", {
      params: { householdId: Schema.String, recipeId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/recipe/recipes/:recipeId/cooked */
    HttpApiEndpoint.delete("deleteRecipesByRecipeIdCooked", "/recipes/:recipeId/cooked", {
      params: { householdId: Schema.String, recipeId: Schema.String },
    }),
    /** GET /api/households/:householdId/recipe/recipes/:recipeId/scale */
    HttpApiEndpoint.get("getRecipesByRecipeIdScale", "/recipes/:recipeId/scale", {
      params: { householdId: Schema.String, recipeId: Schema.String },
    }),
    /** GET /api/households/:householdId/recipe/tags */
    HttpApiEndpoint.get("getTags", "/tags", { params: { householdId: Schema.String } }),
    /** POST /api/households/:householdId/recipe/tags */
    HttpApiEndpoint.post("postTags", "/tags", { params: { householdId: Schema.String } }),
    /** PATCH /api/households/:householdId/recipe/tags/:tagId */
    HttpApiEndpoint.patch("patchTagsByTagId", "/tags/:tagId", {
      params: { householdId: Schema.String, tagId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/recipe/tags/:tagId */
    HttpApiEndpoint.delete("deleteTagsByTagId", "/tags/:tagId", {
      params: { householdId: Schema.String, tagId: Schema.String },
    }).pipe(chain(RequireHouseholdAdmin)),
    /** GET /api/households/:householdId/recipe/collections */
    HttpApiEndpoint.get("getCollections", "/collections", { params: { householdId: Schema.String } }),
    /** POST /api/households/:householdId/recipe/collections */
    HttpApiEndpoint.post("postCollections", "/collections", { params: { householdId: Schema.String } }),
    /** GET /api/households/:householdId/recipe/collections/:collectionId */
    HttpApiEndpoint.get("getCollectionsByCollectionId", "/collections/:collectionId", {
      params: { householdId: Schema.String, collectionId: Schema.String },
    }),
    /** PATCH /api/households/:householdId/recipe/collections/:collectionId */
    HttpApiEndpoint.patch("patchCollectionsByCollectionId", "/collections/:collectionId", {
      params: { householdId: Schema.String, collectionId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/recipe/collections/:collectionId */
    HttpApiEndpoint.delete("deleteCollectionsByCollectionId", "/collections/:collectionId", {
      params: { householdId: Schema.String, collectionId: Schema.String },
    }),
    /** PUT /api/households/:householdId/recipe/collections/:collectionId/recipes/:recipeId */
    HttpApiEndpoint.put("putCollectionsByCollectionIdRecipesByRecipeId", "/collections/:collectionId/recipes/:recipeId", {
      params: { householdId: Schema.String, collectionId: Schema.String, recipeId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/recipe/collections/:collectionId/recipes/:recipeId */
    HttpApiEndpoint.delete(
      "deleteCollectionsByCollectionIdRecipesByRecipeId",
      "/collections/:collectionId/recipes/:recipeId",
      { params: { householdId: Schema.String, collectionId: Schema.String, recipeId: Schema.String } },
    ),
  )
  .pipe(chain(RequireVerifiedEmail));

export const RecipeRecipesApi = householdModuleApi("recipe", HttpApi.make("recipe.recipes").add(RecipeRecipesGroup));
