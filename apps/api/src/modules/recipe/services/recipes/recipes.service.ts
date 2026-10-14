/**
 * Recipes: search/list, detail, transactional nested writes, scaling.
 *
 * Pagination is limit/offset (`?limit=24&offset=0`, `limit` max 100) and every
 * list answers the shared `{ items, total, limit, offset }` envelope.
 *
 * No N+1 queries anywhere: a page of recipes is followed by exactly three
 * `inArray` queries (ingredient counts, step counts, tags) that are grouped in
 * memory — see buildRecipeListItems().
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
import type { Database } from "../../../../db/client.ts";
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
import { ApiError } from "../../../../lib/errors.ts";
import type { Membership } from "../../../../lib/types.ts";
import { normalizeStoredUploadUrl } from "../../../../lib/uploadUrls.ts";
import { toPublicUser } from "../../../../core/services/households/mappers.ts";
import { assertCanModifyOwned, assertRole } from "../../../../core/services/households/membership.ts";
import {
  type DbLike,
  foldText,
  likeStoredFold,
  nowMs,
  toCountMap,
  unique,
  withTransaction,
} from "../../../../core/services/households/support.ts";
import { toIngredientRecord, toRecipe, toStepRecord } from "./mappers.ts";
import { getOrCreateTagIds, tagsByRecipe } from "./tags.service.ts";

/**
 * Total time used for filtering/sorting: the explicit total, otherwise
 * prep + cook, and NULL when the recipe carries no time information at all
 * (unknown must never satisfy a `maxMinutes` filter).
 */
const effectiveMinutes = sql<number | null>`coalesce(${recipes.totalMinutes}, nullif(coalesce(${recipes.prepMinutes}, 0) + coalesce(${recipes.cookMinutes}, 0), 0))`;

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

/** The raw recipe row inside `householdId` or a 404. */
export async function loadRecipeRow(
  db: DbLike,
  householdId: string,
  recipeId: string,
): Promise<RecipeRow> {
  const [row] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);
  if (!row) throw ApiError.notFound("server.recipes.recipeNotFound");
  return row;
}

/** Ingredient/step counts + tags for a page of recipes — three queries total. */
export async function buildRecipeListItems(
  db: DbLike,
  rows: readonly RecipeRow[],
): Promise<RecipeListItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [ingredientRows, stepRows, tagMap] = await Promise.all([
    db
      .select({ key: recipeIngredients.recipeId, value: count() })
      .from(recipeIngredients)
      .where(inArray(recipeIngredients.recipeId, ids))
      .groupBy(recipeIngredients.recipeId),
    db
      .select({ key: recipeSteps.recipeId, value: count() })
      .from(recipeSteps)
      .where(inArray(recipeSteps.recipeId, ids))
      .groupBy(recipeSteps.recipeId),
    tagsByRecipe(db, ids),
  ]);

  const ingredientCounts = toCountMap(ingredientRows);
  const stepCounts = toCountMap(stepRows);

  return rows.map((row) => ({
    ...toRecipe(row),
    tags: tagMap.get(row.id) ?? [],
    ingredientCount: ingredientCounts.get(row.id) ?? 0,
    stepCount: stepCounts.get(row.id) ?? 0,
  }));
}

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

/**
 * Search/filter/sort recipes of a household.
 * `q` matches title, description and ingredient names case-insensitively with
 * German folding ("Möhre" is found by "mohre", "Grieß" by "griess").
 */
export async function listRecipes(
  db: DbLike,
  householdId: string,
  query: RecipeListQuery,
  tagIds: readonly string[] = [],
): Promise<RecipeListResponse> {
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

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(recipes)
      .where(where)
      .orderBy(...orderFor(query.sort))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ value: count() }).from(recipes).where(where),
  ]);

  return {
    items: await buildRecipeListItems(db, rows),
    total: Number(totals[0]?.value ?? 0),
    limit: query.limit,
    offset: query.offset,
  };
}

/** Full recipe: ingredients, steps, tags, collection ids and the author. */
export async function getRecipeDetail(
  db: DbLike,
  householdId: string,
  recipeId: string,
): Promise<RecipeDetail> {
  const [head] = await db
    .select({ recipe: recipes, author: users })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.createdBy))
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);
  if (!head) throw ApiError.notFound("server.recipes.recipeNotFound");

  const [ingredientRows, stepRows, tagMap, collectionRows] = await Promise.all([
    db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipeId))
      .orderBy(asc(recipeIngredients.position)),
    db
      .select()
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, recipeId))
      .orderBy(asc(recipeSteps.position)),
    tagsByRecipe(db, [recipeId]),
    db
      .select({ collectionId: collectionRecipes.collectionId })
      .from(collectionRecipes)
      .where(eq(collectionRecipes.recipeId, recipeId)),
  ]);

  return {
    ...toRecipe(head.recipe),
    ingredients: ingredientRows.map(toIngredientRecord),
    steps: stepRows.map(toStepRecord),
    tags: tagMap.get(recipeId) ?? [],
    collectionIds: collectionRows.map((row) => row.collectionId),
    author: toPublicUser(head.author),
  };
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

/** Deletes and reinserts ingredients — always inside a transaction. */
async function replaceIngredients(
  tx: DbLike,
  recipeId: string,
  inputs: readonly RecipeIngredientInput[],
): Promise<void> {
  await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
  const rows = buildIngredientRows(recipeId, inputs);
  if (rows.length > 0) await tx.insert(recipeIngredients).values(rows);
}

/** Deletes and reinserts steps — always inside a transaction. */
async function replaceSteps(
  tx: DbLike,
  recipeId: string,
  inputs: readonly RecipeStepInput[],
): Promise<void> {
  await tx.delete(recipeSteps).where(eq(recipeSteps.recipeId, recipeId));
  const rows = buildStepRows(recipeId, inputs);
  if (rows.length > 0) await tx.insert(recipeSteps).values(rows);
}

/**
 * Replaces the FREE tag links only, creating unknown tag names on the fly.
 * `tags` (the free-form field) must never touch a `kind:'course'` link — see
 * `replaceCourse` below — or `PATCH { tags: [...] }` from the recipe form would
 * silently drop the recipe's category on every save.
 */
async function replaceTags(
  tx: DbLike,
  householdId: string,
  recipeId: string,
  names: readonly string[],
): Promise<void> {
  const tagIds = await getOrCreateTagIds(tx, householdId, names);
  await tx.delete(recipeTags).where(
    and(
      eq(recipeTags.recipeId, recipeId),
      inArray(
        recipeTags.tagId,
        tx.select({ id: tags.id }).from(tags).where(and(eq(tags.householdId, householdId), eq(tags.kind, "free"))),
      ),
    ),
  );
  if (tagIds.length > 0) {
    await tx.insert(recipeTags).values(tagIds.map((tagId) => ({ recipeId, tagId })));
  }
}

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
async function replaceCourse(
  tx: DbLike,
  householdId: string,
  recipeId: string,
  courseName: string | null,
): Promise<void> {
  await tx.delete(recipeTags).where(
    and(
      eq(recipeTags.recipeId, recipeId),
      inArray(
        recipeTags.tagId,
        tx.select({ id: tags.id }).from(tags).where(and(eq(tags.householdId, householdId), eq(tags.kind, "course"))),
      ),
    ),
  );
  if (!courseName) return;
  const [tagId] = await getOrCreateTagIds(tx, householdId, [courseName], "course");
  if (tagId) await tx.insert(recipeTags).values({ recipeId, tagId });
}

/** Replaces the collection memberships of a recipe (appends at the end). */
async function replaceCollections(
  tx: DbLike,
  householdId: string,
  recipeId: string,
  collectionIds: readonly string[],
): Promise<void> {
  const wanted = unique([...collectionIds]);
  await tx.delete(collectionRecipes).where(eq(collectionRecipes.recipeId, recipeId));
  if (wanted.length === 0) return;

  const valid = await tx
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.householdId, householdId), inArray(collections.id, wanted)));
  if (valid.length !== wanted.length) throw ApiError.notFound("server.recipes.collectionNotFound");

  const maxRows = await tx
    .select({ collectionId: collectionRecipes.collectionId, value: sql<number>`max(${collectionRecipes.position})` })
    .from(collectionRecipes)
    .where(inArray(collectionRecipes.collectionId, wanted))
    .groupBy(collectionRecipes.collectionId);
  const maxPosition = new Map(maxRows.map((row) => [row.collectionId, Number(row.value ?? -1)]));

  const timestamp = nowMs();
  await tx.insert(collectionRecipes).values(
    wanted.map((collectionId) => ({
      collectionId,
      recipeId,
      position: (maxPosition.get(collectionId) ?? -1) + 1,
      addedAt: timestamp,
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

/** Author or admin+ may change/delete a recipe. Named alias for the shared rule. */
export function assertCanModifyRecipe(membership: Membership, row: RecipeRow): void {
  assertCanModifyOwned(membership, row);
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

/**
 * Creates a recipe with all children in ONE transaction, so a failure can never
 * leave orphan ingredient/step rows behind.
 */
export async function createRecipe(
  db: Database,
  householdId: string,
  userId: string,
  input: CreateRecipeRequest,
): Promise<RecipeDetail> {
  const id = crypto.randomUUID();
  const timestamp = nowMs();

  const patch = recipePatch(input);
  // Not sent (or explicitly empty) -> derive it, so every UI surface can rely on it.
  if (input.totalMinutes === undefined || input.totalMinutes === null) {
    patch.totalMinutes = deriveTotalMinutes(input.prepMinutes, input.cookMinutes);
  }

  await withTransaction(db, async (tx) => {
    await tx.insert(recipes).values({
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
    });
    await replaceIngredients(tx, id, input.ingredients);
    await replaceSteps(tx, id, input.steps);
    await replaceTags(tx, householdId, id, input.tags);
    if (input.course !== undefined) await replaceCourse(tx, householdId, id, input.course ?? null);
    await replaceCollections(tx, householdId, id, input.collectionIds);
  });

  return getRecipeDetail(db, householdId, id);
}

/**
 * Partial update. `ingredients`/`steps`/`tags`/`collectionIds` are replace-all
 * when present and untouched when absent; positions are re-numbered from the
 * array order inside the same transaction.
 */
export async function updateRecipe(
  db: Database,
  membership: Membership,
  recipeId: string,
  input: UpdateRecipeRequest,
): Promise<RecipeDetail> {
  const { householdId } = membership;
  const row = await loadRecipeRow(db, householdId, recipeId);
  assertCanModifyRecipe(membership, row);

  const timestamp = nowMs();
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

  await withTransaction(db, async (tx) => {
    await tx
      .update(recipes)
      .set({ ...patch, updatedAt: timestamp })
      .where(eq(recipes.id, recipeId));
    if (input.ingredients !== undefined) await replaceIngredients(tx, recipeId, input.ingredients);
    if (input.steps !== undefined) await replaceSteps(tx, recipeId, input.steps);
    if (input.tags !== undefined) await replaceTags(tx, householdId, recipeId, input.tags);
    // Absent -> untouched (no `.default()` on `course`, so this is genuinely
    // undefined rather than a sent-but-empty value); `null` unlinks.
    if (input.course !== undefined) await replaceCourse(tx, householdId, recipeId, input.course ?? null);
    if (input.collectionIds !== undefined) {
      await replaceCollections(tx, householdId, recipeId, input.collectionIds);
    }
  });

  return getRecipeDetail(db, householdId, recipeId);
}

/** Deletes a recipe (author or admin+); children cascade. */
export async function deleteRecipe(
  db: DbLike,
  membership: Membership,
  recipeId: string,
): Promise<void> {
  const row = await loadRecipeRow(db, membership.householdId, recipeId);
  assertCanModifyRecipe(membership, row);
  await db.delete(recipes).where(eq(recipes.id, recipeId));
}

/** Sets the recipe image after an upload and returns the updated recipe. */
export async function setRecipeImage(
  db: DbLike,
  householdId: string,
  recipeId: string,
  imageUrl: string,
): Promise<Recipe> {
  await loadRecipeRow(db, householdId, recipeId);
  await db
    .update(recipes)
    .set({ imageUrl: normalizeStoredUploadUrl(imageUrl), updatedAt: nowMs() })
    .where(eq(recipes.id, recipeId));
  return toRecipe(await loadRecipeRow(db, householdId, recipeId));
}

/* -------------------------------------------------------------------------- */
/* scaling                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Server-side servings scaler. Uses `scaleIngredientsToServings` from
 * @toon/shared so the web app (which scales locally for instant feedback) and
 * the API can never disagree. "Prise"/"Msp." amounts stay untouched.
 */
export async function scaleRecipe(
  db: DbLike,
  householdId: string,
  recipeId: string,
  servings: number,
): Promise<ScaledRecipeResponse> {
  const row = await loadRecipeRow(db, householdId, recipeId);
  const base = row.servingsAmount;
  if (base === null || base <= 0) {
    throw ApiError.validationFailed(undefined, "server.recipes.noServingsToScale");
  }

  const ingredientRows = await db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId))
    .orderBy(asc(recipeIngredients.position));

  const scaled = scaleIngredientsToServings(
    ingredientRows.map(toIngredientRecord),
    base,
    servings,
    { keepNonScalingUnits: true },
  );

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
  };
}
