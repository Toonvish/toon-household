/**
 * The recipe module's API manifest (SPEC §2): toon-recipe's recipes, tags,
 * collections, import, meal plan + cook log, shopping lists and saved cards, on
 * the `recipe_` tables of `./schema.ts`. The core reaches it only through
 * `modules/index.ts`.
 *
 * Hooks (plan M2 decision 4):
 * - `healthFeatures` — the two import capability flags (toon-recipe gotcha "PHOTO
 *   AND PDF IMPORT ARE TWO FEATURE FLAGS"), merged into `/api/health` `features`.
 * - `afterMigrate` — the fold backfill (`./migrate.ts`), idempotent, no transaction.
 * - `uploadReferences` — the recipe half of toon-recipe's `uploads:gc` collect list.
 * - `seedDemo` (M2-T05) and `shutdown` (M2-T09a, the OCR worker) join later.
 */
import { collections, importDrafts, recipes, recipeTables } from "./schema.ts";
import { backfillFoldedColumns } from "./migrate.ts";
import { recipeHouseholdRouter, recipeUserRouter } from "./routes/index.ts";
import { isOcrImportEnabled, isPdfImportEnabled } from "./services/import/capabilities.ts";
import type { Database } from "../../db/client.ts";
import type { ApiModule } from "../types.ts";

/**
 * Every upload a recipe row references, as stored (the caller normalises bare,
 * absolute and signed forms):
 *   recipe_recipes.image_url            hero images
 *   recipe_collections.cover_image_url  collection covers
 *   recipe_import_drafts.source_meta    the uploaded scan (`storedPath`)
 *   recipe_import_drafts.parsed         the hero image the URL importer downloaded
 *                                       into `parsed.imageUrl`
 * Missing one here makes `uploads:gc` delete a live image.
 */
async function uploadReferences(database: Database): Promise<string[]> {
  const values: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === "string" && value.length > 0) values.push(value);
  };
  for (const row of await database.select({ url: recipes.imageUrl }).from(recipes)) add(row.url);
  for (const row of await database.select({ url: collections.coverImageUrl }).from(collections)) {
    add(row.url);
  }
  for (const row of await database
    .select({ meta: importDrafts.sourceMeta, parsed: importDrafts.parsed })
    .from(importDrafts)) {
    add(row.meta?.storedPath);
    add(row.parsed?.imageUrl);
  }
  return values;
}

export const recipeModule: ApiModule = {
  id: "recipe",
  householdRouter: recipeHouseholdRouter,
  userRouter: recipeUserRouter,
  schema: recipeTables,
  healthFeatures: () => ({ ocrImport: isOcrImportEnabled(), pdfImport: isPdfImportEnabled() }),
  afterMigrate: async (database) => {
    await backfillFoldedColumns(database);
  },
  uploadReferences,
};
