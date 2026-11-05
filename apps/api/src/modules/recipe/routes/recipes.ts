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
import { Hono } from "hono";
import { created, json, noContent, parseCsvParam } from "../../../lib/http.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { currentMembership, currentUser } from "../../../lib/types.ts";
import { requireHouseholdRole } from "../../../middleware/household.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { keepOnlySentKeys } from "../../../core/services/households/validation.ts";
import { validate } from "../../../lib/validate.ts";
import { runtime } from "../../../runtime.ts";
import { RecipeCollections } from "../services/recipes/collections.service.ts";
import { Recipes } from "../services/recipes/recipes.service.ts";
import { CookLog } from "../services/recipes/cookLog.ts";
import { RecipeTags } from "../services/recipes/tags.service.ts";
import { Uploads } from "../../../core/services/media/uploads.ts";

export const recipeRoutes = new Hono<AppEnv>();

// A confirmed address for every WRITE among them (GETs pass through, so
// an unconfirmed account still reads the whole household). Mounted once so a route
// added below is gated by default — see middleware/verifiedEmail.ts.
recipeRoutes.use("*", requireVerifiedEmail());

/* -------------------------------------------------------------------------- */
/* recipes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * GET /recipes — search + filter + sort, paginated with `limit`/`offset`
 * (defaults 24/0, `limit` max 100). Returns the lightweight card shape.
 */
recipeRoutes.get("/recipes", validate("query", RecipeListQuerySchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const recipeService = yield* Recipes;
      const membership = yield* currentMembership(c);
      const query = c.req.valid("query");
      return json(
        c,
        yield* recipeService.listRecipes(membership.householdId, query, parseCsvParam(query.tags)),
      );
    }),
  ),
);

/** POST /recipes — create with nested ingredients/steps/tag names/collections. */
recipeRoutes.post("/recipes", validate("json", CreateRecipeRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const recipeService = yield* Recipes;
      const membership = yield* currentMembership(c);
      const user = yield* currentUser(c);
      const recipe = yield* recipeService.createRecipe(
        membership.householdId,
        user.id,
        c.req.valid("json"),
      );
      return created(c, { recipe }, `/api/households/${membership.householdId}/recipe/recipes/${recipe.id}`);
    }),
  ),
);

/** GET /recipes/:recipeId — full detail incl. children, tags and author. */
recipeRoutes.get("/recipes/:recipeId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const recipeService = yield* Recipes;
      const membership = yield* currentMembership(c);
      return json(c, {
        recipe: yield* recipeService.getRecipeDetail(membership.householdId, c.req.param("recipeId")),
      });
    }),
  ),
);

/** PATCH /recipes/:recipeId — author or admin; child arrays are replace-all. */
recipeRoutes.patch("/recipes/:recipeId", validate("json", UpdateRecipeRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const recipeService = yield* Recipes;
      const membership = yield* currentMembership(c);
      // Absent child arrays must stay untouched — see keepOnlySentKeys().
      const input = keepOnlySentKeys(c.req.valid("json"), yield* Effect.promise(() => c.req.json()), [
        "ingredients",
        "steps",
        "tags",
        "collectionIds",
      ]);
      const recipe = yield* recipeService.updateRecipe(membership, c.req.param("recipeId"), input);
      return json(c, { recipe });
    }),
  ),
);

/** DELETE /recipes/:recipeId — author or admin. */
recipeRoutes.delete("/recipes/:recipeId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const recipeService = yield* Recipes;
      const membership = yield* currentMembership(c);
      yield* recipeService.deleteRecipe(membership, c.req.param("recipeId"));
      return noContent(c);
    }),
  ),
);

/** POST /recipes/:recipeId/image — multipart `file`, max 15 MB, type sniffed. */
recipeRoutes.post("/recipes/:recipeId/image", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const recipeService = yield* Recipes;
      const uploads = yield* Uploads;
      const membership = yield* currentMembership(c);
      const recipeId = c.req.param("recipeId");
      const upload = yield* uploads.storeUploadedImage(yield* Effect.promise(() => c.req.formData()));
      yield* recipeService.setRecipeImage(membership.householdId, recipeId, upload.url);
      return json(c, upload);
    }),
  ),
);

/**
 * POST /recipes/:recipeId/cooked — "Gekocht": append a log row, bump
 * `recipes.last_cooked_at`, and stamp the plan entry the client names (or the one
 * for `plannedOn`, if it sent a date). NEVER guesses the date — see calendar.ts.
 */
recipeRoutes.post("/recipes/:recipeId/cooked", validate("json", MarkCookedRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const cookLogService = yield* CookLog;
      const membership = yield* currentMembership(c);
      const user = yield* currentUser(c);
      return json(
        c,
        yield* cookLogService.recordCooked(
          membership.householdId,
          user.id,
          c.req.param("recipeId"),
          c.req.valid("json"),
        ),
      );
    }),
  ),
);

/**
 * DELETE /recipes/:recipeId/cooked — undo the CALLER's own most recent cook of
 * this recipe within `COOK_UNDO_WINDOW_MS` (R18); 404 `server.recipes.nothingToUndo`
 * outside the window or with nothing to undo.
 */
recipeRoutes.delete("/recipes/:recipeId/cooked", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const cookLogService = yield* CookLog;
      const membership = yield* currentMembership(c);
      const user = yield* currentUser(c);
      yield* cookLogService.undoCooked(membership.householdId, user.id, c.req.param("recipeId"));
      return noContent(c);
    }),
  ),
);

/**
 * GET /recipes/:recipeId/scale?servings=n — server-side scaler.
 * The web app ALSO scales locally with `scaleIngredients` from @toon/shared for
 * instant feedback; both use the same pure function, so results are identical.
 */
recipeRoutes.get("/recipes/:recipeId/scale", validate("query", ScaleRecipeQuerySchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const recipeService = yield* Recipes;
      const membership = yield* currentMembership(c);
      const { servings } = c.req.valid("query");
      return json(
        c,
        yield* recipeService.scaleRecipe(membership.householdId, c.req.param("recipeId"), servings),
      );
    }),
  ),
);

/* -------------------------------------------------------------------------- */
/* tags                                                                       */
/* -------------------------------------------------------------------------- */

/** GET /tags — household tags with usage counts. */
recipeRoutes.get("/tags", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const tagService = yield* RecipeTags;
      const membership = yield* currentMembership(c);
      return json(c, { items: yield* tagService.listTags(membership.householdId) });
    }),
  ),
);

/** POST /tags */
recipeRoutes.post("/tags", validate("json", CreateTagRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const tagService = yield* RecipeTags;
      const membership = yield* currentMembership(c);
      const tag = yield* tagService.createTag(membership.householdId, c.req.valid("json"));
      return created(c, { tag });
    }),
  ),
);

/** PATCH /tags/:tagId — rename/recolor. */
recipeRoutes.patch("/tags/:tagId", validate("json", UpdateTagRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const tagService = yield* RecipeTags;
      const membership = yield* currentMembership(c);
      const tag = yield* tagService.updateTag(
        membership.householdId,
        c.req.param("tagId"),
        c.req.valid("json"),
      );
      return json(c, { tag });
    }),
  ),
);

/** DELETE /tags/:tagId — admin+; recipe links cascade. */
recipeRoutes.delete("/tags/:tagId", requireHouseholdRole("admin"), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const tagService = yield* RecipeTags;
      const membership = yield* currentMembership(c);
      yield* tagService.deleteTag(membership.householdId, c.req.param("tagId"));
      return noContent(c);
    }),
  ),
);

/* -------------------------------------------------------------------------- */
/* collections                                                                */
/* -------------------------------------------------------------------------- */

/** GET /collections — with recipe counts. */
recipeRoutes.get("/collections", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const collectionService = yield* RecipeCollections;
      const membership = yield* currentMembership(c);
      return json(c, { items: yield* collectionService.listCollections(membership.householdId) });
    }),
  ),
);

/** POST /collections — optionally pre-filled with recipeIds (array order). */
recipeRoutes.post("/collections", validate("json", CreateCollectionRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const collectionService = yield* RecipeCollections;
      const membership = yield* currentMembership(c);
      const user = yield* currentUser(c);
      const collection = yield* collectionService.createCollection(
        membership.householdId,
        user.id,
        c.req.valid("json"),
      );
      return created(c, { collection });
    }),
  ),
);

/** GET /collections/:collectionId — collection + recipes in `position` order. */
recipeRoutes.get("/collections/:collectionId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const collectionService = yield* RecipeCollections;
      const membership = yield* currentMembership(c);
      return json(
        c,
        yield* collectionService.getCollectionDetail(membership.householdId, c.req.param("collectionId")),
      );
    }),
  ),
);

/**
 * PATCH /collections/:collectionId — metadata and/or `recipeIds`.
 * Passing `recipeIds` replaces the membership and renumbers positions 0..n-1 in
 * one transaction, which is how the UI reorders a collection.
 */
recipeRoutes.patch("/collections/:collectionId", validate("json", UpdateCollectionRequestSchema), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const collectionService = yield* RecipeCollections;
      const membership = yield* currentMembership(c);
      // `recipeIds` only replaces the membership when it was actually sent.
      const input = keepOnlySentKeys(c.req.valid("json"), yield* Effect.promise(() => c.req.json()), [
        "recipeIds",
      ]);
      const collection = yield* collectionService.updateCollection(
        membership.householdId,
        c.req.param("collectionId"),
        input,
      );
      return json(c, { collection });
    }),
  ),
);

/** DELETE /collections/:collectionId — creator or admin. */
recipeRoutes.delete("/collections/:collectionId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const collectionService = yield* RecipeCollections;
      const membership = yield* currentMembership(c);
      yield* collectionService.deleteCollection(membership, c.req.param("collectionId"));
      return noContent(c);
    }),
  ),
);

/** PUT /collections/:collectionId/recipes/:recipeId — append (idempotent). */
recipeRoutes.put("/collections/:collectionId/recipes/:recipeId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const collectionService = yield* RecipeCollections;
      const membership = yield* currentMembership(c);
      yield* collectionService.addRecipeToCollection(
        membership.householdId,
        c.req.param("collectionId"),
        c.req.param("recipeId"),
      );
      return noContent(c);
    }),
  ),
);

/** DELETE /collections/:collectionId/recipes/:recipeId — remove (idempotent). */
recipeRoutes.delete("/collections/:collectionId/recipes/:recipeId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const collectionService = yield* RecipeCollections;
      const membership = yield* currentMembership(c);
      yield* collectionService.removeRecipeFromCollection(
        membership.householdId,
        c.req.param("collectionId"),
        c.req.param("recipeId"),
      );
      return noContent(c);
    }),
  ),
);

export default recipeRoutes;
