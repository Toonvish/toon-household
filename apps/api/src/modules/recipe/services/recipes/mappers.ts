/**
 * Row -> contract mappers for recipes, ingredients, steps, tags, collections.
 */
import type {
  Collection,
  Difficulty,
  Recipe,
  RecipeIngredientRecord,
  RecipeStepRecord,
  Tag,
} from "@toon/shared";
import type {
  CollectionRow,
  RecipeIngredientRow,
  RecipeRow,
  RecipeStepRow,
  TagRow,
} from "../../../../db/schema.ts";
import { toIso, toIsoOrNull } from "../../../../lib/http.ts";
import { signUploadUrl } from "../../../../lib/uploadUrls.ts";
import { thumbnailUrlFor } from "../../../../core/services/media/thumbnails.ts";

/** The difficulty column is free text in SQLite; unknown values become null. */
export function toDifficulty(value: string | null): Difficulty | null {
  return value === "einfach" || value === "mittel" || value === "schwer" ? value : null;
}

export function toRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    householdId: row.householdId,
    title: row.title,
    description: row.description,
    // The stored column holds the bare `/uploads/<uuid>.<ext>`; the wire value
    // carries a short-lived signature, because that URL is the only credential a
    // cross-origin <img> can present. See lib/uploadUrls.ts.
    imageUrl: signUploadUrl(row.imageUrl),
    // Derived, not stored: `/uploads/<x>.thumb.webp` is built on first request (see
    // services/media/thumbnails.ts), so this URL is valid for a row whose image
    // predates thumbnails as well.
    thumbnailUrl: signUploadUrl(thumbnailUrlFor(row.imageUrl)),
    sourceUrl: row.sourceUrl,
    sourceName: row.sourceName,
    servingsAmount: row.servingsAmount,
    servingsUnit: row.servingsUnit,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    totalMinutes: row.totalMinutes,
    difficulty: toDifficulty(row.difficulty),
    rating: row.rating,
    notes: row.notes,
    language: row.language,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    // Derived, stored, one writer (services/recipes/cookLog.ts) — see the column
    // comment in db/schema.ts for why this is not a per-query join.
    lastCookedAt: toIsoOrNull(row.lastCookedAt),
  };
}

export function toIngredientRecord(row: RecipeIngredientRow): RecipeIngredientRecord {
  return {
    id: row.id,
    recipeId: row.recipeId,
    position: row.position,
    section: row.section,
    quantity: row.quantity,
    quantityMax: row.quantityMax,
    unit: row.unit,
    name: row.name,
    note: row.note,
    raw: row.raw,
  };
}

export function toStepRecord(row: RecipeStepRow): RecipeStepRecord {
  return {
    id: row.id,
    recipeId: row.recipeId,
    position: row.position,
    section: row.section,
    text: row.text,
  };
}

export function toTag(row: TagRow, recipeCount?: number): Tag {
  const tag: Tag = {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    color: row.color,
    kind: row.kind,
    createdAt: toIso(row.createdAt),
  };
  return recipeCount === undefined ? tag : { ...tag, recipeCount };
}

export function toCollection(row: CollectionRow, recipeCount?: number): Collection {
  const collection: Collection = {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    description: row.description,
    coverImageUrl: signUploadUrl(row.coverImageUrl),
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
  return recipeCount === undefined ? collection : { ...collection, recipeCount };
}
