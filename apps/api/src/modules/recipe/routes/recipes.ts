/**
 * OWNER: recipes agent.
 *
 * Mounted at /api/households/:householdId/recipe (via modules/recipe/routes/index.ts, behind the module chain), so the paths declared here
 * are relative: "/recipes", "/recipes/:recipeId", "/tags", "/collections", ...
 *
 * Auth: the module chain (modules/mount.ts) runs `requireSession()` + `requireHouseholdRole("member")` +
 * `requireModule("recipe")` as router-level middleware for EVERY route below, so no handler checks
 * membership itself. A router adds `requireVerifiedEmail()` on top (a confirmed address for every write).
 *
 * Endpoint contract: docs/API.md (sections "Recipes", "Tags", "Collections").
 */
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  CreateCollectionRequestSchema,
  CreateRecipeRequestSchema,
  CreateTagRequestSchema,
  MarkCookedRequestSchema,
  RecipeListQuerySchema,
  ScaleRecipeQuerySchema,
  UpdateCollectionRequestSchema,
  UpdateRecipeRequestSchema,
  UpdateTagRequestSchema,
} from "@toon/shared";
import { created, json, noContent } from "../../../http/response.ts";
import { jsonBody, queryParams, rawJsonOrDie, webRequest } from "../../../http/request.ts";
import { CurrentMembership, CurrentUser } from "../../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { parseCsvParam } from "../../../lib/http.ts";
import { keepOnlySentKeys } from "../../../core/services/households/validation.ts";
import { RecipeCollections } from "../services/recipes/collections.service.ts";
import { Recipes } from "../services/recipes/recipes.service.ts";
import { CookLog } from "../services/recipes/cookLog.ts";
import { RecipeTags } from "../services/recipes/tags.service.ts";
import { Uploads } from "../../../core/services/media/uploads.ts";
import { RecipeRecipesApi } from "./recipes.api.ts";

// A confirmed address for every WRITE among them (GETs pass through, so
// an unconfirmed account still reads the whole household). Mounted once so a route
// added below is gated by default — see middleware/verifiedEmail.ts.

export const recipesHandlers = HttpApiBuilder.group(RecipeRecipesApi, "recipe.recipes", (handlers) =>
  handlers
    /* -------------------------------------------------------------------------- */
    /* recipes                                                                    */
    /* -------------------------------------------------------------------------- */

    /**
     * GET /recipes — search + filter + sort, paginated with `limit`/`offset`
     * (defaults 24/0, `limit` max 100). Returns the lightweight card shape.
     */
    .handle(
      "getRecipes",
      Effect.fn("recipe.recipes.getRecipes")(function* () {
        const query = yield* queryParams(RecipeListQuerySchema);
        const recipeService = yield* Recipes;
        const membership = yield* CurrentMembership;
        return json(yield* recipeService.listRecipes(membership.householdId, query, parseCsvParam(query.tags)));
      }),
      UNINTERRUPTIBLE,
    )

    /** POST /recipes — create with nested ingredients/steps/tag names/collections. */
    .handle(
      "postRecipes",
      Effect.fn("recipe.recipes.postRecipes")(function* () {
        const body = yield* jsonBody(CreateRecipeRequestSchema);
        const recipeService = yield* Recipes;
        const membership = yield* CurrentMembership;
        const user = yield* CurrentUser;
        const recipe = yield* recipeService.createRecipe(membership.householdId, user.id, body);
        return created({ recipe }, `/api/households/${membership.householdId}/recipe/recipes/${recipe.id}`);
      }),
      UNINTERRUPTIBLE,
    )

    /** GET /recipes/:recipeId — full detail incl. children, tags and author. */
    .handle(
      "getRecipesByRecipeId",
      Effect.fn("recipe.recipes.getRecipesByRecipeId")(function* ({ params }) {
        const recipeService = yield* Recipes;
        const membership = yield* CurrentMembership;
        return json({
          recipe: yield* recipeService.getRecipeDetail(membership.householdId, params.recipeId),
        });
      }),
      UNINTERRUPTIBLE,
    )

    /** PATCH /recipes/:recipeId — author or admin; child arrays are replace-all. */
    .handle(
      "patchRecipesByRecipeId",
      Effect.fn("recipe.recipes.patchRecipesByRecipeId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateRecipeRequestSchema);
        const recipeService = yield* Recipes;
        const membership = yield* CurrentMembership;
        // Absent child arrays must stay untouched — see keepOnlySentKeys().
        const input = keepOnlySentKeys(body, yield* rawJsonOrDie, [
          "ingredients",
          "steps",
          "tags",
          "collectionIds",
        ]);
        const recipe = yield* recipeService.updateRecipe(membership, params.recipeId, input);
        return json({ recipe });
      }),
      UNINTERRUPTIBLE,
    )

    /** DELETE /recipes/:recipeId — author or admin. */
    .handle(
      "deleteRecipesByRecipeId",
      Effect.fn("recipe.recipes.deleteRecipesByRecipeId")(function* ({ params }) {
        const recipeService = yield* Recipes;
        const membership = yield* CurrentMembership;
        yield* recipeService.deleteRecipe(membership, params.recipeId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )

    /** POST /recipes/:recipeId/image — multipart `file`, max 15 MB, type sniffed. */
    .handle(
      "postRecipesByRecipeIdImage",
      Effect.fn("recipe.recipes.postRecipesByRecipeIdImage")(function* ({ params }) {
        const recipeService = yield* Recipes;
        const uploads = yield* Uploads;
        const membership = yield* CurrentMembership;
        const recipeId = params.recipeId;
        const request = yield* webRequest;
        const upload = yield* uploads.storeUploadedImage(
          yield* Effect.promise(() => request.formData() as Promise<FormData>),
        );
        yield* recipeService.setRecipeImage(membership.householdId, recipeId, upload.url);
        return json(upload);
      }),
      UNINTERRUPTIBLE,
    )

    /**
     * POST /recipes/:recipeId/cooked — "Gekocht": append a log row, bump
     * `recipes.last_cooked_at`, and stamp the plan entry the client names (or the one
     * for `plannedOn`, if it sent a date). NEVER guesses the date — see calendar.ts.
     */
    .handle(
      "postRecipesByRecipeIdCooked",
      Effect.fn("recipe.recipes.postRecipesByRecipeIdCooked")(function* ({ params }) {
        const body = yield* jsonBody(MarkCookedRequestSchema);
        const cookLogService = yield* CookLog;
        const membership = yield* CurrentMembership;
        const user = yield* CurrentUser;
        return json(
          yield* cookLogService.recordCooked(membership.householdId, user.id, params.recipeId, body),
        );
      }),
      UNINTERRUPTIBLE,
    )

    /**
     * DELETE /recipes/:recipeId/cooked — undo the CALLER's own most recent cook of
     * this recipe within `COOK_UNDO_WINDOW_MS` (R18); 404 `server.recipes.nothingToUndo`
     * outside the window or with nothing to undo.
     */
    .handle(
      "deleteRecipesByRecipeIdCooked",
      Effect.fn("recipe.recipes.deleteRecipesByRecipeIdCooked")(function* ({ params }) {
        const cookLogService = yield* CookLog;
        const membership = yield* CurrentMembership;
        const user = yield* CurrentUser;
        yield* cookLogService.undoCooked(membership.householdId, user.id, params.recipeId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )

    /**
     * GET /recipes/:recipeId/scale?servings=n — server-side scaler.
     * The web app ALSO scales locally with `scaleIngredients` from @toon/shared for
     * instant feedback; both use the same pure function, so results are identical.
     */
    .handle(
      "getRecipesByRecipeIdScale",
      Effect.fn("recipe.recipes.getRecipesByRecipeIdScale")(function* ({ params }) {
        const query = yield* queryParams(ScaleRecipeQuerySchema);
        const recipeService = yield* Recipes;
        const membership = yield* CurrentMembership;
        const { servings } = query;
        return json(yield* recipeService.scaleRecipe(membership.householdId, params.recipeId, servings));
      }),
      UNINTERRUPTIBLE,
    )

    /* -------------------------------------------------------------------------- */
    /* tags                                                                       */
    /* -------------------------------------------------------------------------- */

    /** GET /tags — household tags with usage counts. */
    .handle(
      "getTags",
      Effect.fn("recipe.recipes.getTags")(function* () {
        const tagService = yield* RecipeTags;
        const membership = yield* CurrentMembership;
        return json({ items: yield* tagService.listTags(membership.householdId) });
      }),
      UNINTERRUPTIBLE,
    )

    /** POST /tags */
    .handle(
      "postTags",
      Effect.fn("recipe.recipes.postTags")(function* () {
        const body = yield* jsonBody(CreateTagRequestSchema);
        const tagService = yield* RecipeTags;
        const membership = yield* CurrentMembership;
        const tag = yield* tagService.createTag(membership.householdId, body);
        return created({ tag });
      }),
      UNINTERRUPTIBLE,
    )

    /** PATCH /tags/:tagId — rename/recolor. */
    .handle(
      "patchTagsByTagId",
      Effect.fn("recipe.recipes.patchTagsByTagId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateTagRequestSchema);
        const tagService = yield* RecipeTags;
        const membership = yield* CurrentMembership;
        const tag = yield* tagService.updateTag(membership.householdId, params.tagId, body);
        return json({ tag });
      }),
      UNINTERRUPTIBLE,
    )

    /** DELETE /tags/:tagId — admin+; recipe links cascade. */
    .handle(
      "deleteTagsByTagId",
      Effect.fn("recipe.recipes.deleteTagsByTagId")(function* ({ params }) {
        const tagService = yield* RecipeTags;
        const membership = yield* CurrentMembership;
        yield* tagService.deleteTag(membership.householdId, params.tagId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )

    /* -------------------------------------------------------------------------- */
    /* collections                                                                */
    /* -------------------------------------------------------------------------- */

    /** GET /collections — with recipe counts. */
    .handle(
      "getCollections",
      Effect.fn("recipe.recipes.getCollections")(function* () {
        const collectionService = yield* RecipeCollections;
        const membership = yield* CurrentMembership;
        return json({ items: yield* collectionService.listCollections(membership.householdId) });
      }),
      UNINTERRUPTIBLE,
    )

    /** POST /collections — optionally pre-filled with recipeIds (array order). */
    .handle(
      "postCollections",
      Effect.fn("recipe.recipes.postCollections")(function* () {
        const body = yield* jsonBody(CreateCollectionRequestSchema);
        const collectionService = yield* RecipeCollections;
        const membership = yield* CurrentMembership;
        const user = yield* CurrentUser;
        const collection = yield* collectionService.createCollection(membership.householdId, user.id, body);
        return created({ collection });
      }),
      UNINTERRUPTIBLE,
    )

    /** GET /collections/:collectionId — collection + recipes in `position` order. */
    .handle(
      "getCollectionsByCollectionId",
      Effect.fn("recipe.recipes.getCollectionsByCollectionId")(function* ({ params }) {
        const collectionService = yield* RecipeCollections;
        const membership = yield* CurrentMembership;
        return json(
          yield* collectionService.getCollectionDetail(membership.householdId, params.collectionId),
        );
      }),
      UNINTERRUPTIBLE,
    )

    /**
     * PATCH /collections/:collectionId — metadata and/or `recipeIds`.
     * Passing `recipeIds` replaces the membership and renumbers positions 0..n-1 in
     * one transaction, which is how the UI reorders a collection.
     */
    .handle(
      "patchCollectionsByCollectionId",
      Effect.fn("recipe.recipes.patchCollectionsByCollectionId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateCollectionRequestSchema);
        const collectionService = yield* RecipeCollections;
        const membership = yield* CurrentMembership;
        // `recipeIds` only replaces the membership when it was actually sent.
        const input = keepOnlySentKeys(body, yield* rawJsonOrDie, [
          "recipeIds",
        ]);
        const collection = yield* collectionService.updateCollection(
          membership.householdId,
          params.collectionId,
          input,
        );
        return json({ collection });
      }),
      UNINTERRUPTIBLE,
    )

    /** DELETE /collections/:collectionId — creator or admin. */
    .handle(
      "deleteCollectionsByCollectionId",
      Effect.fn("recipe.recipes.deleteCollectionsByCollectionId")(function* ({ params }) {
        const collectionService = yield* RecipeCollections;
        const membership = yield* CurrentMembership;
        yield* collectionService.deleteCollection(membership, params.collectionId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )

    /** PUT /collections/:collectionId/recipes/:recipeId — append (idempotent). */
    .handle(
      "putCollectionsByCollectionIdRecipesByRecipeId",
      Effect.fn("recipe.recipes.putCollectionsByCollectionIdRecipesByRecipeId")(function* ({ params }) {
        const collectionService = yield* RecipeCollections;
        const membership = yield* CurrentMembership;
        yield* collectionService.addRecipeToCollection(
          membership.householdId,
          params.collectionId,
          params.recipeId,
        );
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )

    /** DELETE /collections/:collectionId/recipes/:recipeId — remove (idempotent). */
    .handle(
      "deleteCollectionsByCollectionIdRecipesByRecipeId",
      Effect.fn("recipe.recipes.deleteCollectionsByCollectionIdRecipesByRecipeId")(function* ({ params }) {
        const collectionService = yield* RecipeCollections;
        const membership = yield* CurrentMembership;
        yield* collectionService.removeRecipeFromCollection(
          membership.householdId,
          params.collectionId,
          params.recipeId,
        );
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);
