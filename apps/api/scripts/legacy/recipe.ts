/**
 * Step 3 of the migration: the recipe module's rows (plan m5 decisions 7, 8 and 12, Table M rows
 * 15-31, SPEC §4 recipe module, §6.5).
 *
 * One `CopySpec` per Table M row, in the listed order (foreign keys are enforced, so a parent is
 * always written before its children): tags, recipes, ingredients, steps, recipe tags,
 * collections, collection recipes, meal plan, cook log, import drafts, shopping lists with their
 * items, catalog, bought items, list recipes and mutations, cards.
 *
 * - Ids are kept (the legacy id is the new id), `group_id` becomes `household_id` through
 *   `ctx.ids.households.recipe`, every user column goes through `ctx.ids.users.recipe`.
 * - Rows 19 and 21 have composite keys; their ledger id is `<a>:<b>`.
 * - `image_url` / `cover_image_url` pass through `normalizeStoredUploadUrl`; JSON columns are
 *   copied verbatim (the ids inside stay valid because ids are kept).
 * - The fold columns are recomputed with `foldText` at copy time (one definition of the fold, H's);
 *   `backfillFoldedColumns` runs afterwards and must find nothing to do.
 * - A row whose user, household or parent row was not migrated is a skipped row with
 *   `error: true` (a missing parent would otherwise fail its insert on the foreign key).
 *
 * No module-scope code beyond imports and constants (decision 5); the target comes from the
 * context, never from the shared `db`.
 */
import { foldText } from "@toon/shared";
import { copyTable, renameColumns, type SkipResult } from "./copy.ts";
import { loadAll } from "./ledger.ts";
import type { MigrationContext, Row } from "./types.ts";
import {
  cards,
  collectionRecipes,
  collections,
  importDrafts,
  mealPlanEntries,
  recipeCookLog,
  recipeIngredients,
  recipeSteps,
  recipeTags,
  recipes,
  shoppingBoughtItems,
  shoppingListCatalog,
  shoppingListItems,
  shoppingListRecipes,
  shoppingLists,
  shoppingMutations,
  tags,
} from "../../src/db/schema.ts";
import { backfillFoldedColumns } from "../../src/modules/recipe/migrate.ts";
import { normalizeStoredUploadUrl } from "../../src/lib/uploadUrls.ts";

function str(value: unknown): string {
  return String(value ?? "");
}

function isNull(value: unknown): boolean {
  return value === null || value === undefined;
}

/** The normalised upload URL of a nullable text column (an external URL is returned untouched). */
function normalizedUrl(value: unknown): string | null {
  return isNull(value) ? null : normalizeStoredUploadUrl(str(value));
}

/** The target household of a legacy `group_id`, or the skip. */
function householdOf(ctx: MigrationContext, row: Row): string | SkipResult {
  const id = ctx.ids.households.recipe.get(str(row.group_id));
  return id ?? { skip: `household ${str(row.group_id)} not migrated`, error: true };
}

/** The target user of a legacy user column; `nullable` lets a NULL pass through as NULL. */
function userOf(ctx: MigrationContext, value: unknown, nullable = false): string | null | SkipResult {
  if (isNull(value)) return nullable ? null : { skip: "user reference is empty", error: true };
  const id = ctx.ids.users.recipe.get(str(value));
  return id ?? { skip: `user ${str(value)} not migrated`, error: true };
}

/** The target id of a parent row (legacy id -> new id, read from the ledger), or the skip. */
function parentOf(map: Map<string, string>, what: string, value: unknown, nullable = false): string | null | SkipResult {
  if (isNull(value)) return nullable ? null : { skip: `${what} reference is empty`, error: true };
  const id = map.get(str(value));
  return id ?? { skip: `${what} ${str(value)} not migrated`, error: true };
}

function isSkip(value: unknown): value is SkipResult {
  return typeof value === "object" && value !== null && "skip" in value;
}

/** Legacy id -> target id of every row of `table` the ledger knows for the recipe source. */
async function mapOf(ctx: MigrationContext, table: string): Promise<Map<string, string>> {
  return loadAll(ctx.target.client, table, "recipe");
}

/**
 * Copies Table M rows 15-31 and runs `backfillFoldedColumns` on the target. Requires
 * `migrateUsers` and `migrateHouseholds` to have filled `ctx.ids`. Idempotent through the ledger.
 * Returns how many fold columns the backfill had to fill (0 when every fold was written at copy
 * time); a non-zero value is also a warning.
 */
export async function migrateRecipe(ctx: MigrationContext): Promise<{ backfilled: number }> {
  if (!ctx.recipe) return { backfilled: 0 };

  // 15. tags
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "tags",
    target: tags,
    transform: (row): Row | SkipResult => {
      const householdId = householdOf(ctx, row);
      if (isSkip(householdId)) return householdId;
      return { ...renameColumns(row, { group_id: "household_id" }), household_id: householdId };
    },
  });

  // 16. recipes
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "recipes",
    target: recipes,
    transform: (row): Row | SkipResult => {
      const householdId = householdOf(ctx, row);
      if (isSkip(householdId)) return householdId;
      const createdBy = userOf(ctx, row.created_by);
      if (isSkip(createdBy)) return createdBy;
      return {
        ...renameColumns(row, { group_id: "household_id" }),
        household_id: householdId,
        created_by: createdBy,
        image_url: normalizedUrl(row.image_url),
        title_fold: foldText(str(row.title)),
        description_fold: foldText(isNull(row.description) ? "" : str(row.description)),
      };
    },
  });
  const recipeIds = await mapOf(ctx, "recipe_recipes");

  // 17. recipe_ingredients
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "recipe_ingredients",
    target: recipeIngredients,
    transform: (row): Row | SkipResult => {
      const recipeId = parentOf(recipeIds, "recipe", row.recipe_id);
      if (isSkip(recipeId)) return recipeId;
      return { ...row, recipe_id: recipeId, name_fold: foldText(str(row.name)) };
    },
  });

  // 18. recipe_steps
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "recipe_steps",
    target: recipeSteps,
    transform: (row): Row | SkipResult => {
      const recipeId = parentOf(recipeIds, "recipe", row.recipe_id);
      if (isSkip(recipeId)) return recipeId;
      return { ...row, recipe_id: recipeId };
    },
  });

  // 19. recipe_tags (composite key <recipe_id>:<tag_id>)
  const tagIds = await mapOf(ctx, "recipe_tags");
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "recipe_tags",
    target: recipeTags,
    legacyId: (row) => `${str(row.recipe_id)}:${str(row.tag_id)}`,
    transform: (row): Row | SkipResult => {
      const recipeId = parentOf(recipeIds, "recipe", row.recipe_id);
      if (isSkip(recipeId)) return recipeId;
      const tagId = parentOf(tagIds, "tag", row.tag_id);
      if (isSkip(tagId)) return tagId;
      return { ...row, recipe_id: recipeId, tag_id: tagId };
    },
    newId: (values) => `${str(values.recipe_id)}:${str(values.tag_id)}`,
  });

  // 20. collections
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "collections",
    target: collections,
    transform: (row): Row | SkipResult => {
      const householdId = householdOf(ctx, row);
      if (isSkip(householdId)) return householdId;
      const createdBy = userOf(ctx, row.created_by);
      if (isSkip(createdBy)) return createdBy;
      return {
        ...renameColumns(row, { group_id: "household_id" }),
        household_id: householdId,
        created_by: createdBy,
        cover_image_url: normalizedUrl(row.cover_image_url),
      };
    },
  });
  const collectionIds = await mapOf(ctx, "recipe_collections");

  // 21. collection_recipes (composite key <collection_id>:<recipe_id>)
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "collection_recipes",
    target: collectionRecipes,
    legacyId: (row) => `${str(row.collection_id)}:${str(row.recipe_id)}`,
    transform: (row): Row | SkipResult => {
      const collectionId = parentOf(collectionIds, "collection", row.collection_id);
      if (isSkip(collectionId)) return collectionId;
      const recipeId = parentOf(recipeIds, "recipe", row.recipe_id);
      if (isSkip(recipeId)) return recipeId;
      return { ...row, collection_id: collectionId, recipe_id: recipeId };
    },
    newId: (values) => `${str(values.collection_id)}:${str(values.recipe_id)}`,
  });

  // 22. meal_plan_entries
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "meal_plan_entries",
    target: mealPlanEntries,
    transform: (row): Row | SkipResult => {
      const householdId = householdOf(ctx, row);
      if (isSkip(householdId)) return householdId;
      const recipeId = parentOf(recipeIds, "recipe", row.recipe_id);
      if (isSkip(recipeId)) return recipeId;
      const createdBy = userOf(ctx, row.created_by);
      if (isSkip(createdBy)) return createdBy;
      return {
        ...renameColumns(row, { group_id: "household_id" }),
        household_id: householdId,
        recipe_id: recipeId,
        created_by: createdBy,
      };
    },
  });
  const entryIds = await mapOf(ctx, "recipe_meal_plan_entries");

  // 23. recipe_cook_log
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "recipe_cook_log",
    target: recipeCookLog,
    transform: (row): Row | SkipResult => {
      const householdId = householdOf(ctx, row);
      if (isSkip(householdId)) return householdId;
      const recipeId = parentOf(recipeIds, "recipe", row.recipe_id);
      if (isSkip(recipeId)) return recipeId;
      const cookedBy = userOf(ctx, row.cooked_by);
      if (isSkip(cookedBy)) return cookedBy;
      const entryId = parentOf(entryIds, "meal plan entry", row.meal_plan_entry_id, true);
      if (isSkip(entryId)) return entryId;
      return {
        ...renameColumns(row, { group_id: "household_id" }),
        household_id: householdId,
        recipe_id: recipeId,
        cooked_by: cookedBy,
        meal_plan_entry_id: entryId,
      };
    },
  });

  // 24. import_drafts (JSON columns verbatim)
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "import_drafts",
    target: importDrafts,
    transform: (row): Row | SkipResult => {
      const householdId = householdOf(ctx, row);
      if (isSkip(householdId)) return householdId;
      const createdBy = userOf(ctx, row.created_by);
      if (isSkip(createdBy)) return createdBy;
      const recipeId = parentOf(recipeIds, "recipe", row.recipe_id, true);
      if (isSkip(recipeId)) return recipeId;
      return {
        ...renameColumns(row, { group_id: "household_id" }),
        household_id: householdId,
        created_by: createdBy,
        recipe_id: recipeId,
      };
    },
  });

  // 25. shopping_lists
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "shopping_lists",
    target: shoppingLists,
    transform: (row): Row | SkipResult => {
      const householdId = householdOf(ctx, row);
      if (isSkip(householdId)) return householdId;
      const createdBy = userOf(ctx, row.created_by);
      if (isSkip(createdBy)) return createdBy;
      return { ...renameColumns(row, { group_id: "household_id" }), household_id: householdId, created_by: createdBy };
    },
  });
  const listIds = await mapOf(ctx, "recipe_shopping_lists");

  // 26-27. children of a list that carry no user column (items, catalog)
  for (const [legacyTable, target] of [
    ["shopping_list_items", shoppingListItems],
    ["shopping_list_catalog", shoppingListCatalog],
  ] as const) {
    await copyTable(ctx, {
      source: "recipe",
      legacyTable,
      target,
      transform: (row): Row | SkipResult => {
        const listId = parentOf(listIds, "shopping list", row.list_id);
        if (isSkip(listId)) return listId;
        return { ...row, list_id: listId };
      },
    });
  }

  // 28. shopping_bought_items
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "shopping_bought_items",
    target: shoppingBoughtItems,
    transform: (row): Row | SkipResult => {
      const listId = parentOf(listIds, "shopping list", row.list_id);
      if (isSkip(listId)) return listId;
      const boughtBy = userOf(ctx, row.bought_by, true);
      if (isSkip(boughtBy)) return boughtBy;
      return { ...row, list_id: listId, bought_by: boughtBy };
    },
  });

  // 29. shopping_list_recipes
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "shopping_list_recipes",
    target: shoppingListRecipes,
    transform: (row): Row | SkipResult => {
      const listId = parentOf(listIds, "shopping list", row.list_id);
      if (isSkip(listId)) return listId;
      const recipeId = parentOf(recipeIds, "recipe", row.recipe_id);
      if (isSkip(recipeId)) return recipeId;
      const addedBy = userOf(ctx, row.added_by, true);
      if (isSkip(addedBy)) return addedBy;
      return { ...row, list_id: listId, recipe_id: recipeId, added_by: addedBy };
    },
  });

  // 30. shopping_mutations (why: a replayed offline write must still be applied once)
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "shopping_mutations",
    target: shoppingMutations,
    transform: (row): Row | SkipResult => {
      const listId = parentOf(listIds, "shopping list", row.list_id);
      if (isSkip(listId)) return listId;
      return { ...row, list_id: listId };
    },
  });

  // 31. cards
  await copyTable(ctx, {
    source: "recipe",
    legacyTable: "cards",
    target: cards,
    transform: (row): Row | SkipResult => {
      const userId = userOf(ctx, row.user_id);
      if (isSkip(userId)) return userId;
      return { ...row, user_id: userId };
    },
  });

  // The folds were written at copy time: the backfill has nothing to do (decision 12).
  const backfilled = await backfillFoldedColumns(ctx.target.db);
  if (backfilled > 0) {
    ctx.report.warnings.push(`recipe folds: backfillFoldedColumns had to fill ${backfilled} column(s) after the copy`);
  }
  return { backfilled };
}
