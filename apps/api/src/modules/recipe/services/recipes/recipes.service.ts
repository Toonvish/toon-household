/**
 * Recipes: search/list, detail, transactional nested writes, scaling.
 *
 * Pagination is limit/offset (`?limit=24&offset=0`, `limit` max 100) and every
 * list answers the shared `{ items, total, limit, offset }` envelope.
 *
 * No N+1 queries anywhere: a page of recipes is followed by exactly three
 * `inArray` queries (ingredient counts, step counts, tags) that are grouped in
 * memory — see buildRecipeListItems().
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md` P2, P8, P9, P12). `Recipes` reads the
 * current executor of `Database` on every call (inside `Database.transaction` that is the open transaction), takes its
 * timestamps from the `Clock`, tags through `RecipeTags`, localizes a remote image through `RemoteImages` BEFORE the
 * transaction opens, and refuses with the tagged family. Every by-id read keeps its `householdId` filter (D8). The pre-folded
 * search columns (`titleFold`, `descriptionFold`, `nameFold`, R45) are written on every write. The Promise bridges at
 * the end of the file keep the routes (until E3-T10) and the not-yet-converted plan, cook-log and shopping services
 * (until E3-T08 and E3-T09) working.
 */
import type {
  CreateRecipeRequest,
  Recipe,
  RecipeDetail,
  RecipeIngredient,
  RecipeIngredientInput,
  RecipeListItem,
  RecipeListQuery,
  RecipeListResponse,
  RecipeSort,
  RecipeStepInput,
  ScaledRecipeResponse,
  UpdateRecipeRequest,
} from "@toon/shared";
import { formatIngredient, formatQuantity, scaleIngredientsToServings } from "@toon/shared";
import type { SQL } from "drizzle-orm";
import { and, asc, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import {
  collectionRecipes,
  collections,
  recipeIngredients,
  recipeSteps,
  recipeTags,
  recipes,
  tags,
  users,
} from "../../../../db/schema.ts";
import type { RecipeIngredientRow, RecipeRow, RecipeStepRow } from "../../../../db/schema.ts";
import { NotFound, ValidationFailed } from "../../../../lib/errors.ts";
import type { DatabaseError, Forbidden } from "../../../../lib/errors.ts";
import type { Membership } from "../../../../lib/types.ts";
import { normalizeStoredUploadUrl } from "../../../../lib/uploadUrls.ts";
import { runtime } from "../../../../runtime.ts";
import { toPublicUser } from "../../../../core/services/households/mappers.ts";
import { checkCanModifyOwned } from "../../../../core/services/households/membership.ts";
import {
  type DbLike,
  foldText,
  likeStoredFold,
  toCountMap,
  unique,
} from "../../../../core/services/households/support.ts";
import { toIngredientRecord, toRecipe, toStepRecord } from "./mappers.ts";
import { RemoteImages } from "./remoteImage.ts";
import { RecipeTags } from "./tags.service.ts";

/**
 * Total time used for filtering/sorting: the explicit total, otherwise
 * prep + cook, and NULL when the recipe carries no time information at all
 * (unknown must never satisfy a `maxMinutes` filter).
 */
const effectiveMinutes = sql<number | null>`coalesce(${recipes.totalMinutes}, nullif(coalesce(${recipes.prepMinutes}, 0) + coalesce(${recipes.cookMinutes}, 0), 0))`;

/** ORDER BY for the documented sort values (NULLs always last). */
function orderFor(sort: RecipeSort): SQL[] {
  switch (sort) {
    case "oldest":
      return [asc(recipes.createdAt)];
    case "title":
      // The STORED fold, so `recipe_recipes_household_title_fold_idx` can supply the order.
      // Ordering by the equivalent expression cost a TEMP B-TREE over the household.
      return [asc(recipes.titleFold)];
    case "rating":
      return [sql`${recipes.rating} is null`, desc(recipes.rating), desc(recipes.createdAt)];
    case "time":
      return [sql`${effectiveMinutes} is null`, asc(effectiveMinutes), desc(recipes.createdAt)];
    case "lastCooked":
      // NULLs sort LAST under DESC in SQLite, so this needs no `is null` leading
      // term — which is exactly what lets `recipe_recipes_household_last_cooked_idx` supply
      // the order by a reverse index scan. `?sort=rating` pays a temp b-tree for
      // its `is null`; this must not.
      return [desc(recipes.lastCookedAt), desc(recipes.createdAt)];
    default:
      return [desc(recipes.createdAt)];
  }
}

/* -------------------------------------------------------------------------- */
/* child rows                                                                 */
/* -------------------------------------------------------------------------- */

/** Ingredient rows with contiguous positions (0..n-1) in array order. */
export function buildIngredientRows(
  recipeId: string,
  inputs: readonly RecipeIngredientInput[],
): RecipeIngredientRow[] {
  return inputs.map((input, index) => {
    const row: RecipeIngredientRow = {
      id: crypto.randomUUID(),
      recipeId,
      position: index,
      section: input.section ?? null,
      quantity: input.quantity ?? null,
      quantityMax: input.quantityMax ?? null,
      unit: input.unit ?? null,
      name: input.name,
      // Written here rather than computed at query time — see src/db/schema.ts.
      nameFold: foldText(input.name),
      note: input.note ?? null,
      raw: "",
    };
    // `raw` is provenance: keep what the client sent, otherwise render the line.
    row.raw = input.raw ?? formatIngredient(row, formatQuantity);
    return row;
  });
}

/** Step rows with contiguous positions (0..n-1) in array order. */
export function buildStepRows(
  recipeId: string,
  inputs: readonly RecipeStepInput[],
): RecipeStepRow[] {
  return inputs.map((input, index) => ({
    id: crypto.randomUUID(),
    recipeId,
    position: index,
    section: input.section ?? null,
    text: input.text,
  }));
}

/**
 * `totalMinutes` from prep + cook, or null when neither is known.
 *
 * The list query already coalesces this (see `effectiveMinutes`), but the COLUMN
 * stayed null, so a recipe created with prep 30 / cook 45 and no total showed a
 * time in the list and nothing at all inside a collection. Derive it once, on write.
 */
export function deriveTotalMinutes(
  prepMinutes: number | null | undefined,
  cookMinutes: number | null | undefined,
): number | null {
  const total = (prepMinutes ?? 0) + (cookMinutes ?? 0);
  return total > 0 ? total : null;
}

/** Maps the request fields onto recipe columns (undefined = untouched). */
function recipePatch(input: UpdateRecipeRequest): Partial<typeof recipes.$inferInsert> {
  const patch: Partial<typeof recipes.$inferInsert> = {};
  // Each folded column moves with its source column, in the same branch, so a
  // PATCH can never leave the two disagreeing (the row would drop out of search).
  if (input.title !== undefined) {
    patch.title = input.title;
    patch.titleFold = foldText(input.title);
  }
  if (input.description !== undefined) {
    patch.description = input.description ?? null;
    patch.descriptionFold = foldText(input.description ?? "");
  }
  // The client sends back the SIGNED url it was served (see lib/uploadUrls.ts);
  // store the bare `/uploads/<file>` so the row never holds an expiring value.
  if (input.imageUrl !== undefined) {
    patch.imageUrl = normalizeStoredUploadUrl(input.imageUrl) ?? null;
  }
  if (input.sourceUrl !== undefined) patch.sourceUrl = input.sourceUrl ?? null;
  if (input.sourceName !== undefined) patch.sourceName = input.sourceName ?? null;
  if (input.servingsAmount !== undefined) patch.servingsAmount = input.servingsAmount ?? null;
  if (input.servingsUnit !== undefined) patch.servingsUnit = input.servingsUnit ?? null;
  if (input.prepMinutes !== undefined) patch.prepMinutes = input.prepMinutes ?? null;
  if (input.cookMinutes !== undefined) patch.cookMinutes = input.cookMinutes ?? null;
  if (input.totalMinutes !== undefined) patch.totalMinutes = input.totalMinutes ?? null;
  if (input.difficulty !== undefined) patch.difficulty = input.difficulty ?? null;
  if (input.rating !== undefined) patch.rating = input.rating ?? null;
  if (input.notes !== undefined) patch.notes = input.notes ?? null;
  if (input.language !== undefined) patch.language = input.language ?? "de";
  return patch;
}

/* -------------------------------------------------------------------------- */
/* the service                                                                */
/* -------------------------------------------------------------------------- */

/** Author or admin+ may change/delete a recipe. Named alias for the shared rule (`checkCanModifyOwned`). */
export const assertCanModifyRecipe = Effect.fnUntraced(function* (
  membership: Membership,
  row: RecipeRow,
): Effect.fn.Return<void, Forbidden> {
  yield* checkCanModifyOwned(membership, row);
});

/** Recipes of a household: search/list, detail, the transactional nested writes and the scaler. */
export class Recipes extends Context.Service<
  Recipes,
  {
    /** The raw recipe row inside `householdId` or a 404. */
    readonly loadRecipeRow: (
      householdId: string,
      recipeId: string,
    ) => Effect.Effect<RecipeRow, NotFound | DatabaseError>;
    /** Ingredient/step counts + tags for a page of recipes — three queries total. */
    readonly buildRecipeListItems: (rows: readonly RecipeRow[]) => Effect.Effect<RecipeListItem[], DatabaseError>;
    /**
     * Search/filter/sort recipes of a household.
     * `q` matches title, description and ingredient names case-insensitively with
     * German folding ("Möhre" is found by "mohre", "Grieß" by "griess").
     */
    readonly listRecipes: (
      householdId: string,
      query: RecipeListQuery,
      tagIds?: readonly string[],
    ) => Effect.Effect<RecipeListResponse, DatabaseError>;
    /** Full recipe: ingredients, steps, tags, collection ids and the author. */
    readonly getRecipeDetail: (
      householdId: string,
      recipeId: string,
    ) => Effect.Effect<RecipeDetail, NotFound | DatabaseError>;
    /** Author or admin+ may change/delete a recipe. */
    readonly assertCanModifyRecipe: (membership: Membership, row: RecipeRow) => Effect.Effect<void, Forbidden>;
    /**
     * Creates a recipe with all children in ONE transaction, so a failure can never
     * leave orphan ingredient/step rows behind.
     */
    readonly createRecipe: (
      householdId: string,
      userId: string,
      input: CreateRecipeRequest,
    ) => Effect.Effect<RecipeDetail, NotFound | DatabaseError>;
    /**
     * Partial update. `ingredients`/`steps`/`tags`/`collectionIds` are replace-all
     * when present and untouched when absent; positions are re-numbered from the
     * array order inside the same transaction.
     */
    readonly updateRecipe: (
      membership: Membership,
      recipeId: string,
      input: UpdateRecipeRequest,
    ) => Effect.Effect<RecipeDetail, NotFound | Forbidden | DatabaseError>;
    /** Deletes a recipe (author or admin+); children cascade. */
    readonly deleteRecipe: (
      membership: Membership,
      recipeId: string,
    ) => Effect.Effect<void, NotFound | Forbidden | DatabaseError>;
    /** Sets the recipe image after an upload and returns the updated recipe. */
    readonly setRecipeImage: (
      householdId: string,
      recipeId: string,
      imageUrl: string,
    ) => Effect.Effect<Recipe, NotFound | DatabaseError>;
    /**
     * Server-side servings scaler. Uses `scaleIngredientsToServings` from
     * @toon/shared so the web app (which scales locally for instant feedback) and
     * the API can never disagree. "Prise"/"Msp." amounts stay untouched.
     */
    readonly scaleRecipe: (
      householdId: string,
      recipeId: string,
      servings: number,
    ) => Effect.Effect<ScaledRecipeResponse, NotFound | ValidationFailed | DatabaseError>;
  }
>()("toon/api/modules/recipe/services/recipes/recipes.service/Recipes") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const tagService = yield* RecipeTags;
      const images = yield* RemoteImages;

      const loadRecipeRow = Effect.fn("Recipes.loadRecipeRow")(function* (householdId: string, recipeId: string) {
        const [row] = yield* database.use((db) =>
          db
            .select()
            .from(recipes)
            .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
            .limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.recipes.recipeNotFound" });
        return row;
      });

      const buildRecipeListItems = Effect.fn("Recipes.buildRecipeListItems")(function* (rows: readonly RecipeRow[]) {
        if (rows.length === 0) return [] as RecipeListItem[];
        const ids = rows.map((row) => row.id);

        const [ingredientRows, stepRows, tagMap] = yield* Effect.all(
          [
            database.use((db) =>
              db
                .select({ key: recipeIngredients.recipeId, value: count() })
                .from(recipeIngredients)
                .where(inArray(recipeIngredients.recipeId, ids))
                .groupBy(recipeIngredients.recipeId),
            ),
            database.use((db) =>
              db
                .select({ key: recipeSteps.recipeId, value: count() })
                .from(recipeSteps)
                .where(inArray(recipeSteps.recipeId, ids))
                .groupBy(recipeSteps.recipeId),
            ),
            tagService.tagsByRecipe(ids),
          ],
          { concurrency: "unbounded" },
        );

        const ingredientCounts = toCountMap(ingredientRows);
        const stepCounts = toCountMap(stepRows);

        return rows.map(
          (row): RecipeListItem => ({
            ...toRecipe(row),
            tags: tagMap.get(row.id) ?? [],
            ingredientCount: ingredientCounts.get(row.id) ?? 0,
            stepCount: stepCounts.get(row.id) ?? 0,
          }),
        );
      });

      const listRecipes = Effect.fn("Recipes.listRecipes")(function* (
        householdId: string,
        query: RecipeListQuery,
        tagIds: readonly string[] = [],
      ) {
        const conditions: SQL[] = [eq(recipes.householdId, householdId)];

        if (query.q && query.q.length > 0) {
          const term = query.q;
          // Against the PRE-FOLDED columns: the `total` count(*) below cannot stop early,
          // so folding in SQL meant 23 replace() calls per row per search (32 ms at 2000
          // recipes, 91 ms when nothing matched). See src/db/schema.ts.
          conditions.push(
            sql`(${likeStoredFold(recipes.titleFold, term)} or ${likeStoredFold(recipes.descriptionFold, term)} or exists (select 1 from ${recipeIngredients} where ${recipeIngredients.recipeId} = ${recipes.id} and ${likeStoredFold(recipeIngredients.nameFold, term)}))`,
          );
        }

        const wantedTags = unique([...tagIds]);
        if (wantedTags.length > 0) {
          // A recipe must carry ALL requested tags.
          conditions.push(
            sql`(select count(distinct ${recipeTags.tagId}) from ${recipeTags} where ${recipeTags.recipeId} = ${recipes.id} and ${inArray(recipeTags.tagId, wantedTags)}) = ${wantedTags.length}`,
          );
        }

        if (query.collectionId) {
          conditions.push(
            sql`exists (select 1 from ${collectionRecipes} where ${collectionRecipes.recipeId} = ${recipes.id} and ${collectionRecipes.collectionId} = ${query.collectionId})`,
          );
        }

        if (query.maxMinutes !== undefined) {
          conditions.push(
            sql`${effectiveMinutes} is not null and ${effectiveMinutes} <= ${query.maxMinutes}`,
          );
        }

        if (query.difficulty) conditions.push(eq(recipes.difficulty, query.difficulty));

        // A column predicate, never a subquery — the `total` half is a `count(*)` that
        // cannot stop early, so this must stay index-narrowed rather than per-row work.
        if (query.hasCooked === true) conditions.push(isNotNull(recipes.lastCookedAt));

        const where = and(...conditions);

        const [rows, totals] = yield* Effect.all(
          [
            database.use((db) =>
              db
                .select()
                .from(recipes)
                .where(where)
                .orderBy(...orderFor(query.sort))
                .limit(query.limit)
                .offset(query.offset),
            ),
            database.use((db) => db.select({ value: count() }).from(recipes).where(where)),
          ],
          { concurrency: "unbounded" },
        );

        return {
          items: yield* buildRecipeListItems(rows),
          total: Number(totals[0]?.value ?? 0),
          limit: query.limit,
          offset: query.offset,
        } satisfies RecipeListResponse;
      });

      const getRecipeDetail = Effect.fn("Recipes.getRecipeDetail")(function* (householdId: string, recipeId: string) {
        const [head] = yield* database.use((db) =>
          db
            .select({ recipe: recipes, author: users })
            .from(recipes)
            .innerJoin(users, eq(users.id, recipes.createdBy))
            .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
            .limit(1),
        );
        if (!head) return yield* new NotFound({ text: "server.recipes.recipeNotFound" });

        const [ingredientRows, stepRows, tagMap, collectionRows] = yield* Effect.all(
          [
            database.use((db) =>
              db
                .select()
                .from(recipeIngredients)
                .where(eq(recipeIngredients.recipeId, recipeId))
                .orderBy(asc(recipeIngredients.position)),
            ),
            database.use((db) =>
              db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId)).orderBy(asc(recipeSteps.position)),
            ),
            tagService.tagsByRecipe([recipeId]),
            database.use((db) =>
              db
                .select({ collectionId: collectionRecipes.collectionId })
                .from(collectionRecipes)
                .where(eq(collectionRecipes.recipeId, recipeId)),
            ),
          ],
          { concurrency: "unbounded" },
        );

        return {
          ...toRecipe(head.recipe),
          ingredients: ingredientRows.map(toIngredientRecord),
          steps: stepRows.map(toStepRecord),
          tags: tagMap.get(recipeId) ?? [],
          collectionIds: collectionRows.map((row) => row.collectionId),
          author: toPublicUser(head.author),
        } satisfies RecipeDetail;
      });

      /** Deletes and reinserts ingredients — always inside a transaction. */
      const replaceIngredients = Effect.fnUntraced(function* (
        recipeId: string,
        inputs: readonly RecipeIngredientInput[],
      ) {
        yield* database.use((db) => db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId)));
        const rows = buildIngredientRows(recipeId, inputs);
        if (rows.length > 0) yield* database.use((db) => db.insert(recipeIngredients).values(rows));
      });

      /** Deletes and reinserts steps — always inside a transaction. */
      const replaceSteps = Effect.fnUntraced(function* (recipeId: string, inputs: readonly RecipeStepInput[]) {
        yield* database.use((db) => db.delete(recipeSteps).where(eq(recipeSteps.recipeId, recipeId)));
        const rows = buildStepRows(recipeId, inputs);
        if (rows.length > 0) yield* database.use((db) => db.insert(recipeSteps).values(rows));
      });

      /**
       * Replaces the FREE tag links only, creating unknown tag names on the fly.
       * `tags` (the free-form field) must never touch a `kind:'course'` link — see
       * `replaceCourse` below — or `PATCH { tags: [...] }` from the recipe form would
       * silently drop the recipe's category on every save.
       */
      const replaceTags = Effect.fnUntraced(function* (
        householdId: string,
        recipeId: string,
        names: readonly string[],
      ) {
        const tagIds = yield* tagService.getOrCreateTagIds(householdId, names);
        yield* database.use((db) =>
          db.delete(recipeTags).where(
            and(
              eq(recipeTags.recipeId, recipeId),
              inArray(
                recipeTags.tagId,
                db.select({ id: tags.id }).from(tags).where(and(eq(tags.householdId, householdId), eq(tags.kind, "free"))),
              ),
            ),
          ),
        );
        if (tagIds.length > 0) {
          yield* database.use((db) => db.insert(recipeTags).values(tagIds.map((tagId) => ({ recipeId, tagId }))));
        }
      });

      /**
       * Replaces the recipe's single `kind:'course'` link. `courseName` absent from the
       * caller means "leave it alone" and is handled by the caller not invoking this at
       * all; `null` here means "unlink" (the tag row itself survives — only
       * `recipe_tags` changes); a name gets-or-creates it as `kind:'course'` (never
       * flipping an existing tag's kind) and becomes the recipe's only course link.
       * There is no DB constraint enforcing "at most one course tag" — see
       * `recipeEyebrow()` in `@toon/shared`, which just takes the alphabetically first
       * if a recipe somehow ends up with two.
       */
      const replaceCourse = Effect.fnUntraced(function* (
        householdId: string,
        recipeId: string,
        courseName: string | null,
      ) {
        yield* database.use((db) =>
          db.delete(recipeTags).where(
            and(
              eq(recipeTags.recipeId, recipeId),
              inArray(
                recipeTags.tagId,
                db
                  .select({ id: tags.id })
                  .from(tags)
                  .where(and(eq(tags.householdId, householdId), eq(tags.kind, "course"))),
              ),
            ),
          ),
        );
        if (!courseName) return;
        const [tagId] = yield* tagService.getOrCreateTagIds(householdId, [courseName], "course");
        if (tagId) yield* database.use((db) => db.insert(recipeTags).values({ recipeId, tagId }));
      });

      /** Replaces the collection memberships of a recipe (appends at the end). */
      const replaceCollections = Effect.fnUntraced(function* (
        householdId: string,
        recipeId: string,
        collectionIds: readonly string[],
      ) {
        const wanted = unique([...collectionIds]);
        yield* database.use((db) => db.delete(collectionRecipes).where(eq(collectionRecipes.recipeId, recipeId)));
        if (wanted.length === 0) return;

        const valid = yield* database.use((db) =>
          db
            .select({ id: collections.id })
            .from(collections)
            .where(and(eq(collections.householdId, householdId), inArray(collections.id, wanted))),
        );
        if (valid.length !== wanted.length) return yield* new NotFound({ text: "server.recipes.collectionNotFound" });

        const maxRows = yield* database.use((db) =>
          db
            .select({
              collectionId: collectionRecipes.collectionId,
              value: sql<number>`max(${collectionRecipes.position})`,
            })
            .from(collectionRecipes)
            .where(inArray(collectionRecipes.collectionId, wanted))
            .groupBy(collectionRecipes.collectionId),
        );
        const maxPosition = new Map(maxRows.map((row) => [row.collectionId, Number(row.value ?? -1)]));

        const timestamp = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db.insert(collectionRecipes).values(
            wanted.map((collectionId) => ({
              collectionId,
              recipeId,
              position: (maxPosition.get(collectionId) ?? -1) + 1,
              addedAt: timestamp,
            })),
          ),
        );
      });

      const createRecipe = Effect.fn("Recipes.createRecipe")(function* (
        householdId: string,
        userId: string,
        input: CreateRecipeRequest,
      ) {
        const id = crypto.randomUUID();
        const timestamp = yield* Clock.currentTimeMillis;

        const patch = recipePatch(input);
        // Not sent (or explicitly empty) -> derive it, so every UI surface can rely on it.
        if (input.totalMinutes === undefined || input.totalMinutes === null) {
          patch.totalMinutes = deriveTotalMinutes(input.prepMinutes, input.cookMinutes);
        }
        // A remote image becomes a local copy, downloaded BEFORE the transaction opens.
        if (input.imageUrl !== undefined) patch.imageUrl = (yield* images.localizeImageUrl(input.imageUrl)) ?? null;

        yield* database.transaction(
          Effect.gen(function* () {
            yield* database.use((db) =>
              db.insert(recipes).values({
                id,
                householdId,
                createdBy: userId,
                createdAt: timestamp,
                updatedAt: timestamp,
                title: input.title,
                // Spelled out rather than left to `patch`: a create always has a title, but
                // `recipePatch` only emits `descriptionFold` when a description was sent, and
                // both columns are NOT NULL.
                titleFold: foldText(input.title),
                descriptionFold: foldText(input.description ?? ""),
                language: input.language ?? "de",
                ...patch,
              }),
            );
            yield* replaceIngredients(id, input.ingredients);
            yield* replaceSteps(id, input.steps);
            yield* replaceTags(householdId, id, input.tags);
            if (input.course !== undefined) yield* replaceCourse(householdId, id, input.course ?? null);
            yield* replaceCollections(householdId, id, input.collectionIds);
          }),
        );

        return yield* getRecipeDetail(householdId, id);
      });

      const updateRecipe = Effect.fn("Recipes.updateRecipe")(function* (
        membership: Membership,
        recipeId: string,
        input: UpdateRecipeRequest,
      ) {
        const { householdId } = membership;
        const row = yield* loadRecipeRow(householdId, recipeId);
        yield* assertCanModifyRecipe(membership, row);

        const timestamp = yield* Clock.currentTimeMillis;
        const patch = recipePatch(input);
        // Only when the client did not speak about it at all — an explicit null stays a
        // deliberate "unknown".
        //
        // Gated on prep/cook actually MOVING, and then assigned even when the derivation
        // comes back null: clearing both times has to clear the total with them, or the row
        // keeps a figure nothing supports any more (prep 30 + cook 45 = 75, both cleared,
        // total stubbornly 75). The gate is what protects a total the user typed BY HAND —
        // prep and cook empty, total 90 — from being wiped by an unrelated PATCH.
        if (
          input.totalMinutes === undefined &&
          (input.prepMinutes !== undefined || input.cookMinutes !== undefined)
        ) {
          patch.totalMinutes = deriveTotalMinutes(
            patch.prepMinutes === undefined ? row.prepMinutes : patch.prepMinutes,
            patch.cookMinutes === undefined ? row.cookMinutes : patch.cookMinutes,
          );
        }
        // A remote image becomes a local copy, downloaded BEFORE the transaction opens;
        // the unchanged remote URL of a recipe whose copy failed earlier is not retried.
        if (input.imageUrl !== undefined) {
          patch.imageUrl = (yield* images.localizeImageUrl(input.imageUrl, row.imageUrl)) ?? null;
        }

        yield* database.transaction(
          Effect.gen(function* () {
            yield* database.use((db) =>
              db
                .update(recipes)
                .set({ ...patch, updatedAt: timestamp })
                .where(eq(recipes.id, recipeId)),
            );
            if (input.ingredients !== undefined) yield* replaceIngredients(recipeId, input.ingredients);
            if (input.steps !== undefined) yield* replaceSteps(recipeId, input.steps);
            if (input.tags !== undefined) yield* replaceTags(householdId, recipeId, input.tags);
            // Absent -> untouched (no `.default()` on `course`, so this is genuinely
            // undefined rather than a sent-but-empty value); `null` unlinks.
            if (input.course !== undefined) yield* replaceCourse(householdId, recipeId, input.course ?? null);
            if (input.collectionIds !== undefined) {
              yield* replaceCollections(householdId, recipeId, input.collectionIds);
            }
          }),
        );

        return yield* getRecipeDetail(householdId, recipeId);
      });

      const deleteRecipe = Effect.fn("Recipes.deleteRecipe")(function* (membership: Membership, recipeId: string) {
        const row = yield* loadRecipeRow(membership.householdId, recipeId);
        yield* assertCanModifyRecipe(membership, row);
        yield* database.use((db) => db.delete(recipes).where(eq(recipes.id, recipeId)));
      });

      const setRecipeImage = Effect.fn("Recipes.setRecipeImage")(function* (
        householdId: string,
        recipeId: string,
        imageUrl: string,
      ) {
        yield* loadRecipeRow(householdId, recipeId);
        const updatedAt = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db
            .update(recipes)
            .set({ imageUrl: normalizeStoredUploadUrl(imageUrl), updatedAt })
            .where(eq(recipes.id, recipeId)),
        );
        return toRecipe(yield* loadRecipeRow(householdId, recipeId));
      });

      const scaleRecipe = Effect.fn("Recipes.scaleRecipe")(function* (
        householdId: string,
        recipeId: string,
        servings: number,
      ) {
        const row = yield* loadRecipeRow(householdId, recipeId);
        const base = row.servingsAmount;
        if (base === null || base <= 0) {
          return yield* new ValidationFailed({ text: "server.recipes.noServingsToScale" });
        }

        const ingredientRows = yield* database.use((db) =>
          db
            .select()
            .from(recipeIngredients)
            .where(eq(recipeIngredients.recipeId, recipeId))
            .orderBy(asc(recipeIngredients.position)),
        );

        const scaled = scaleIngredientsToServings(ingredientRows.map(toIngredientRecord), base, servings, {
          keepNonScalingUnits: true,
        });

        const ingredients: RecipeIngredient[] = scaled.map((ingredient) => ({
          position: ingredient.position,
          section: ingredient.section,
          quantity: ingredient.quantity,
          quantityMax: ingredient.quantityMax,
          unit: ingredient.unit,
          name: ingredient.name,
          note: ingredient.note,
          raw: ingredient.raw,
        }));

        return {
          recipeId,
          factor: servings / base,
          servingsAmount: servings,
          servingsUnit: row.servingsUnit,
          ingredients,
        } satisfies ScaledRecipeResponse;
      });

      return Recipes.of({
        loadRecipeRow,
        buildRecipeListItems,
        listRecipes,
        getRecipeDetail,
        assertCanModifyRecipe,
        createRecipe,
        updateRecipe,
        deleteRecipe,
        setRecipeImage,
        scaleRecipe,
      });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

// Every bridge honours its `db` argument with `Database.withExecutor(db)` (plan e3 P1): called inside an open
// `withTransaction(db, async (tx) => …)` it runs on that `tx`. A failure rejects with the tagged error itself.

/** Callers: `plan/plan.service.ts` (E3-T08), `recipes/cookLog.ts` (E3-T08), `shopping/items.service.ts` (E3-T09). Promise. */
export function loadRecipeRow(db: DbLike, householdId: string, recipeId: string): Promise<RecipeRow> {
  return runtime.runPromise(Recipes.use((s) => s.loadRecipeRow(householdId, recipeId)).pipe(Database.withExecutor(db)));
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function listRecipes(
  db: DbLike,
  householdId: string,
  query: RecipeListQuery,
  tagIds: readonly string[] = [],
): Promise<RecipeListResponse> {
  return runtime.runPromise(
    Recipes.use((s) => s.listRecipes(householdId, query, tagIds)).pipe(Database.withExecutor(db)),
  );
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function getRecipeDetail(db: DbLike, householdId: string, recipeId: string): Promise<RecipeDetail> {
  return runtime.runPromise(
    Recipes.use((s) => s.getRecipeDetail(householdId, recipeId)).pipe(Database.withExecutor(db)),
  );
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function createRecipe(
  db: DbLike,
  householdId: string,
  userId: string,
  input: CreateRecipeRequest,
): Promise<RecipeDetail> {
  return runtime.runPromise(
    Recipes.use((s) => s.createRecipe(householdId, userId, input)).pipe(Database.withExecutor(db)),
  );
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function updateRecipe(
  db: DbLike,
  membership: Membership,
  recipeId: string,
  input: UpdateRecipeRequest,
): Promise<RecipeDetail> {
  return runtime.runPromise(
    Recipes.use((s) => s.updateRecipe(membership, recipeId, input)).pipe(Database.withExecutor(db)),
  );
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function deleteRecipe(db: DbLike, membership: Membership, recipeId: string): Promise<void> {
  return runtime.runPromise(Recipes.use((s) => s.deleteRecipe(membership, recipeId)).pipe(Database.withExecutor(db)));
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function setRecipeImage(db: DbLike, householdId: string, recipeId: string, imageUrl: string): Promise<Recipe> {
  return runtime.runPromise(
    Recipes.use((s) => s.setRecipeImage(householdId, recipeId, imageUrl)).pipe(Database.withExecutor(db)),
  );
}

/** Callers: `routes/recipes.ts` (E3-T10). Promise. */
export function scaleRecipe(
  db: DbLike,
  householdId: string,
  recipeId: string,
  servings: number,
): Promise<ScaledRecipeResponse> {
  return runtime.runPromise(
    Recipes.use((s) => s.scaleRecipe(householdId, recipeId, servings)).pipe(Database.withExecutor(db)),
  );
}
