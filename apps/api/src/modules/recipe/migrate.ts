/**
 * The recipe module's post-migration step (plan M2 decision 5): toon-recipe's
 * `backfillFoldedColumns` from `apps/api/src/db/migrate.ts`, moved here verbatim.
 * `runMigrations` (db/migrate.ts) calls it through the manifest's `afterMigrate`
 * hook after every `migrate()`, so the core never names it.
 */
import { foldText } from "@toon/shared";
import { and, eq, ne } from "drizzle-orm";
import type { Database } from "../../db/client.ts";
import { db as sharedDb } from "../../db/client.ts";
import { recipeIngredients, recipes } from "../../db/schema.ts";

/**
 * Fills `recipe_recipes.title_fold` / `description_fold` and
 * `recipe_recipe_ingredients.name_fold` for rows written without them (in
 * toon-recipe: rows written before its migration 0003 added them; here: rows a
 * legacy copy or a raw insert leaves empty). It runs as the recipe module's
 * `afterMigrate`.
 *
 * IN JS, NOT IN SQL, and that is the whole point. The columns exist so that search
 * never folds per row (see the `recipes` comment in schema.ts), and every write
 * fills them with `foldText()`. Reproducing `foldText()` in SQL is not actually
 * possible here: SQLite's `lower()` is ASCII-only, so an uppercase "È" or "ẞ" would
 * need its own `replace()`, and the full table is 40 nested calls against a parser
 * that overflows at 31. Doing it here means ONE definition of the fold — the same
 * function for a backfilled row and a freshly written one.
 *
 * IDEMPOTENT, and safe to run on every boot. "Needs backfill" is `fold = '' AND
 * source <> ''`: an empty fold is a legitimate stored value (a recipe with no
 * description), so the source column has to be what decides. A row whose title is
 * genuinely empty is left alone — its fold is correctly ''.
 *
 * DELIBERATELY NOT IN A TRANSACTION. libSQL 0.17.4 discarded a `file::memory:`
 * database when a transaction commits (0.18.0 no longer does; the guard stays,
 * see `withTransaction` in
 * core/services/households/support.ts), and this runs inside `runMigrations`, which every
 * integration test calls against exactly such a database. It does not need one
 * anyway: each row is independent and an interrupted run simply finds the rest of
 * the work still waiting for it next time.
 *
 * Cheap by construction — on an up-to-date database both SELECTs match nothing.
 * It is not built for millions of rows, and a family recipe box does not have them.
 */
export async function backfillFoldedColumns(database: Database = sharedDb): Promise<number> {
  const staleRecipes = await database
    .select({ id: recipes.id, title: recipes.title, description: recipes.description })
    .from(recipes)
    .where(and(eq(recipes.titleFold, ""), ne(recipes.title, "")));

  for (const row of staleRecipes) {
    await database
      .update(recipes)
      .set({ titleFold: foldText(row.title), descriptionFold: foldText(row.description ?? "") })
      .where(eq(recipes.id, row.id));
  }

  const staleIngredients = await database
    .select({ id: recipeIngredients.id, name: recipeIngredients.name })
    .from(recipeIngredients)
    .where(and(eq(recipeIngredients.nameFold, ""), ne(recipeIngredients.name, "")));

  for (const row of staleIngredients) {
    await database
      .update(recipeIngredients)
      .set({ nameFold: foldText(row.name) })
      .where(eq(recipeIngredients.id, row.id));
  }

  return staleRecipes.length + staleIngredients.length;
}
