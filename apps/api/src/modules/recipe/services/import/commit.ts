/**
 * Committing a reviewed draft into a real recipe.
 *
 * TRANSACTIONAL BY DESIGN: recipe + ingredients + steps + tag links + collection
 * links are written inside ONE `db.transaction`. The collection ownership check
 * runs LAST, inside the transaction, so a request naming a foreign collection
 * leaves no half-written recipe behind — that invariant is covered by a test.
 *
 * The draft is marked `reviewed` and gets `recipe_id` in the same transaction, so
 * "draft committed" and "recipe exists" can never disagree.
 */
import {
  DEFAULT_LOCALE,
  type Difficulty,
  type ParsedRecipe,
  type PublicUser,
  type RecipeDetail,
  type RecipeIngredientRecord,
  type RecipeStepRecord,
  type Tag,
  type TagKind,
  foldText,
  serverText,
} from "@toon/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../../../../db/client.ts";
import {
  collectionRecipes,
  collections,
  importDrafts,
  recipeIngredients,
  recipeSteps,
  recipeTags,
  recipes,
  tags,
  users,
} from "../../../../db/schema.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { toIso } from "../../../../lib/http.ts";
import { normalizeStoredUploadUrl, signUploadUrl } from "../../../../lib/uploadUrls.ts";
import { toPublicUser } from "../../../../core/services/households/mappers.ts";
import { thumbnailUrlFor } from "../../../../core/services/media/thumbnails.ts";
import { localizeImageUrl } from "../recipes/remoteImage.ts";
import { dedupeTags } from "./parsed.ts";

/**
 * The scalar fields a `ParsedRecipe` contributes, in the shape BOTH the `recipes`
 * insert and the `RecipeDetail` response want them.
 *
 * The two used to list all twelve separately, which is a silent bug generator: add
 * a field to the schema, wire it into the insert, forget the response, and the
 * committed recipe loses its cook time until the screen is reloaded. The three
 * things that genuinely differ between the two sites — `imageUrl` (bare in the
 * column, signed on the wire), the folded search columns and the timestamps — stay
 * at the call site.
 *
 * `difficulty` is widened to the column's `Difficulty | null`; the wire type is the
 * same union, so one shape serves both.
 */
function parsedScalars(parsed: ParsedRecipe) {
  return {
    description: parsed.description ?? null,
    sourceUrl: parsed.sourceUrl ?? null,
    sourceName: parsed.sourceName ?? null,
    servingsAmount: parsed.servings?.amount ?? null,
    servingsUnit: parsed.servings?.unit ?? null,
    prepMinutes: parsed.prepMinutes ?? null,
    cookMinutes: parsed.cookMinutes ?? null,
    totalMinutes: parsed.totalMinutes ?? null,
    difficulty: (parsed.difficulty ?? null) as Difficulty | null,
    rating: null,
    notes: parsed.notes ?? null,
    language: parsed.language ?? "de",
  };
}

export interface CommitDraftInput {
  householdId: string;
  draftId: string;
  userId: string;
  /** The reviewed payload. Overrides whatever is stored on the draft. */
  parsed: ParsedRecipe;
  /** Extra tag NAMES from the review screen, merged with `parsed.tags`. */
  tagNames?: readonly string[];
  collectionIds?: readonly string[];
}

export interface CommitDraftResult {
  recipe: RecipeDetail;
  recipeId: string;
}

/**
 * Writes the recipe and links everything up.
 *
 * @throws ApiError 422 `validation_failed` when the reviewed draft has no title
 *   or no content, 404 when a collection does not belong to the household.
 */
export async function commitDraft(db: Database, input: CommitDraftInput): Promise<CommitDraftResult> {
  let parsed = input.parsed;

  const title = (parsed.title ?? "").trim();
  if (title.length === 0) {
    throw ApiError.validationFailed(
      [
        {
          path: "parsed.title",
          code: "custom",
          message: serverText(DEFAULT_LOCALE, "server.import.titleMissing"),
          i18n: { key: "server.import.titleMissing" },
        },
      ],
      "server.import.titleRequired",
    );
  }
  if (parsed.ingredients.length === 0 && parsed.steps.length === 0) {
    throw ApiError.validationFailed(
      [
        {
          path: "parsed",
          code: "custom",
          message: serverText(DEFAULT_LOCALE, "server.import.noIngredientsOrSteps"),
          i18n: { key: "server.import.noIngredientsOrSteps" },
        },
      ],
      "server.import.recipeNeedsIngredientOrStep",
    );
  }

  const recipeId = crypto.randomUUID();
  const now = Date.now();
  // A remote hero image (the importer's download failed, or the review screen
  // changed it) becomes a local copy, downloaded before the transaction opens; the
  // draft row below keeps the localized value too.
  const imageUrl = await localizeImageUrl(parsed.imageUrl);
  if (typeof imageUrl === "string" && imageUrl !== parsed.imageUrl) parsed = { ...parsed, imageUrl };

  const tagNames = dedupeTags([...parsed.tags, ...(input.tagNames ?? [])]);
  const collectionIds = [...new Set(input.collectionIds ?? [])];

  const ingredientRows = parsed.ingredients.map((ingredient, index) => ({
    id: crypto.randomUUID(),
    recipeId,
    position: index,
    section: ingredient.section ?? null,
    quantity: ingredient.quantity ?? null,
    quantityMax: ingredient.quantityMax ?? null,
    unit: ingredient.unit ?? null,
    name: ingredient.name,
    // Pre-folded for search; see src/db/schema.ts. A committed import that skipped
    // this would be a recipe nobody can find by its ingredients.
    nameFold: foldText(ingredient.name),
    note: ingredient.note ?? null,
    raw: ingredient.raw,
  }));

  const stepRows = parsed.steps.map((step, index) => ({
    id: crypto.randomUUID(),
    recipeId,
    position: index,
    section: step.section ?? null,
    text: step.text,
  }));

  const linkedTags = await db.transaction(async (tx) => {
    await tx.insert(recipes).values({
      id: recipeId,
      householdId: input.householdId,
      title,
      titleFold: foldText(title),
      descriptionFold: foldText(parsed.description ?? ""),
      // The review screen PATCHes back the signed hero-image URL it was served,
      // so reduce it to the bare `/uploads/<file>` before it becomes a column.
      imageUrl: normalizeStoredUploadUrl(parsed.imageUrl) ?? null,
      ...parsedScalars(parsed),
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
    });

    if (ingredientRows.length > 0) await tx.insert(recipeIngredients).values(ingredientRows);
    if (stepRows.length > 0) await tx.insert(recipeSteps).values(stepRows);

    const resolved = await resolveTags(tx, input.householdId, tagNames, now);
    if (resolved.length > 0) {
      await tx.insert(recipeTags).values(resolved.map((tag) => ({ recipeId, tagId: tag.id })));
    }

    // LAST, and inside the transaction: a foreign collection id must roll the
    // whole recipe back rather than leave an orphan.
    if (collectionIds.length > 0) {
      const owned = await tx
        .select({ id: collections.id })
        .from(collections)
        .where(and(eq(collections.householdId, input.householdId), inArray(collections.id, collectionIds)));
      const ownedIds = new Set(owned.map((row) => row.id));
      const unknown = collectionIds.filter((id) => !ownedIds.has(id));
      if (unknown.length > 0) {
        throw ApiError.notFound(
          unknown.length === 1 ? "server.import.collectionNotInGroup" : "server.import.collectionsNotInGroup",
        );
      }
      await tx.insert(collectionRecipes).values(
        collectionIds.map((collectionId, index) => ({
          collectionId,
          recipeId,
          position: index,
          addedAt: now,
        })),
      );
    }

    await tx
      .update(importDrafts)
      .set({ status: "reviewed", recipeId, parsed, confidence: parsed.confidence.overall, updatedAt: now })
      .where(and(eq(importDrafts.id, input.draftId), eq(importDrafts.householdId, input.householdId)));

    return resolved;
  });

  const recipe = await loadRecipeDetail(db, {
    recipeId,
    householdId: input.householdId,
    userId: input.userId,
    createdAt: now,
    title,
    parsed,
    ingredientRows,
    stepRows,
    tagList: linkedTags,
    collectionIds,
  });

  return { recipe, recipeId };
}

/**
 * Finds existing household tags by case-insensitive name and creates the missing
 * ones. Matching is case-insensitive on purpose: "Vegan" and "vegan" must not
 * become two tags in the same household.
 */
async function resolveTags(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  householdId: string,
  names: readonly string[],
  now: number,
): Promise<Tag[]> {
  if (names.length === 0) return [];

  const existing = await tx.select().from(tags).where(eq(tags.householdId, householdId));
  const byLower = new Map(existing.map((tag) => [tag.name.toLocaleLowerCase("de-DE"), tag]));

  const out: Tag[] = [];
  const toInsert: Array<{
    id: string;
    householdId: string;
    name: string;
    color: null;
    kind: TagKind;
    createdAt: number;
  }> = [];

  for (const name of names) {
    const key = name.toLocaleLowerCase("de-DE");
    const found = byLower.get(key);
    if (found) {
      out.push({
        id: found.id,
        householdId: found.householdId,
        name: found.name,
        color: found.color,
        // Passed THROUGH, never rewritten: an import that names an existing
        // `kind: "course"` tag links it as-is (the same rule
        // `getOrCreateTagIds` follows — it sets `kind` only on a tag it creates).
        kind: found.kind,
        createdAt: toIso(found.createdAt),
      });
      continue;
    }
    // An imported tag name is free-form vocabulary; a course is set explicitly
    // through `CreateRecipeRequest.course`, never inferred from a tag name.
    const row = {
      id: crypto.randomUUID(),
      householdId,
      name,
      color: null,
      kind: "free" as const,
      createdAt: now,
    };
    toInsert.push(row);
    byLower.set(key, { ...row, color: null });
    out.push({ id: row.id, householdId, name, color: null, kind: "free", createdAt: toIso(now) });
  }

  if (toInsert.length > 0) await tx.insert(tags).values(toInsert);
  return out;
}

interface LoadRecipeDetailInput {
  recipeId: string;
  householdId: string;
  userId: string;
  createdAt: number;
  title: string;
  parsed: ParsedRecipe;
  ingredientRows: Array<Omit<RecipeIngredientRecord, "position"> & { position: number }>;
  stepRows: Array<Omit<RecipeStepRecord, "position"> & { position: number }>;
  tagList: Tag[];
  collectionIds: string[];
}

/**
 * Builds the `RecipeDetail` response for the freshly created recipe.
 *
 * Deliberately assembled from the rows we just wrote plus one author lookup,
 * instead of re-reading five tables: this module must not depend on the recipes
 * router (owned by another agent) to stay merge-conflict free.
 */
async function loadRecipeDetail(db: Database, input: LoadRecipeDetailInput): Promise<RecipeDetail> {
  const authorRows = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  // Same mapper the recipes router uses, so the wire shape (and the avatar
  // signature) cannot drift between "created by import" and "read back later".
  // The row is the session's own user, so the fallback is unreachable in practice;
  // it exists so a missing author cannot fail a committed recipe.
  const found = authorRows[0];
  const author: PublicUser = found
    ? toPublicUser(found)
    : { id: input.userId, name: "", email: "", avatarUrl: null };

  const iso = toIso(input.createdAt);
  const parsed = input.parsed;

  return {
    id: input.recipeId,
    householdId: input.householdId,
    title: input.title,
    // Same wire shape as toRecipe(): what was stored is bare, what is sent is signed.
    imageUrl: signUploadUrl(normalizeStoredUploadUrl(parsed.imageUrl)) ?? null,
    thumbnailUrl: signUploadUrl(thumbnailUrlFor(parsed.imageUrl)),
    ...parsedScalars(parsed),
    createdBy: input.userId,
    createdAt: iso,
    updatedAt: iso,
    ingredients: input.ingredientRows.map((row) => ({
      id: row.id,
      recipeId: row.recipeId,
      position: row.position,
      section: row.section ?? null,
      quantity: row.quantity ?? null,
      quantityMax: row.quantityMax ?? null,
      unit: row.unit ?? null,
      name: row.name,
      note: row.note ?? null,
      raw: row.raw,
    })),
    steps: input.stepRows.map((row) => ({
      id: row.id,
      recipeId: row.recipeId,
      position: row.position,
      section: row.section ?? null,
      text: row.text,
    })),
    tags: input.tagList,
    collectionIds: input.collectionIds,
    author,
  };
}

/** Count of recipes in a household — used by tests to assert rollback. */
export async function countRecipes(db: Database, householdId: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(recipes)
    .where(eq(recipes.householdId, householdId));
  return Number(rows[0]?.value ?? 0);
}
