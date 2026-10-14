/**
 * "From this week's plan" (SPEC § 4.5 / A03 § 5): diffs a shopping list against the
 * household's meal plan and reports, per planned recipe, which ingredients are not on
 * the list yet.
 *
 * R21 put this in the shopping router under the name `from-plan`, not a
 * `plan-suggestions` endpoint on the planner: the diff is against a LIST, so it
 * belongs to the list's router — and pathing it under `…/shopping-lists/` is what
 * lets the existing `NetworkOnly` service-worker rule cover it with no new rule.
 *
 * R23 refuses a `GET …/summary` endpoint by the same logic this file has to
 * respect for itself: a local libSQL file is ONE serialised lane, so the lever is
 * a MEASURED, BOUNDED query, never more concurrency. `PLAN_LIMITS.fromPlanEntries`
 * (60, earliest `plannedOn` first) is that bound — see the PR for the measured
 * median against a scratch file DB.
 */
import {
  PLAN_LIMITS,
  ingredientToShoppingItem,
  scaleIngredients,
  shoppingItemKey,
  type PlanShoppingPreviewResponse,
} from "@toon/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../../../db/client.ts";
import { recipeIngredients, shoppingListItems } from "../../../../db/schema.ts";
import { toIngredientRecord } from "../recipes/mappers.ts";
import { listPlanEntries } from "../plan/plan.service.ts";
import { loadShoppingListRow } from "./lists.service.ts";

/**
 * `planShoppingPreview(db, householdId, listId, { from, to })`.
 *
 * 1. Loads the target list's OPEN item rows and builds `onList` from their stored
 *    `merge_key`s — NOT the name, so "200 g Mehl" counts as missing while "2 EL
 *    Mehl" is on the list: they are different unit buckets and cannot merge, so
 *    both are genuinely needed.
 * 2. Loads the window's plan entries (already `(plannedOn, position)` ordered by
 *    `listPlanEntries`), caps them at `PLAN_LIMITS.fromPlanEntries` (earliest
 *    first — the bound this file exists to honour), then de-duplicates by recipe,
 *    KEEPING THE EARLIEST `plannedOn` and that entry's `servings` — a recipe
 *    planned twice in one week is one row in the panel.
 * 3. Per recipe: scales its CURRENT ingredients exactly as `addRecipeToShoppingList`
 *    does (`servings / servingsAmount` when both are positive, else factor 1 —
 *    the SAME fallback rule, so the preview and the eventual add agree), then
 *    checks EVERY ingredient row's key individually against `onList` — never
 *    merged first, because `missingIngredientIds` must list every row sharing a
 *    missing key, and `recipeToShoppingItems` would collapse them before their
 *    ids could be recovered.
 * 4. A recipe with nothing missing is omitted from `recipes` entirely.
 */
export async function planShoppingPreview(
  db: Database,
  householdId: string,
  listId: string,
  range: { from: string; to: string },
): Promise<PlanShoppingPreviewResponse> {
  const list = await loadShoppingListRow(db, householdId, listId);

  const itemRows = await db
    .select({ mergeKey: shoppingListItems.mergeKey })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId));
  const onList = new Set(itemRows.map((row) => row.mergeKey));

  const entries = (await listPlanEntries(db, householdId, range.from, range.to)).slice(
    0,
    PLAN_LIMITS.fromPlanEntries,
  );

  // De-duplicate by recipe, keeping the first (= earliest `plannedOn`, since
  // `listPlanEntries` is already sorted ascending) occurrence.
  const byRecipe = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) {
    if (!byRecipe.has(entry.recipeId)) byRecipe.set(entry.recipeId, entry);
  }

  const recipeIds = [...byRecipe.keys()];
  // Order by (recipeId, position) — the SAME two columns the leading
  // `recipe_recipe_ingredients_recipe_position_idx` covers, so SQLite serves this
  // straight off the index instead of a temp sort over the IN's combined rows
  // (verified by `shopping-from-plan.test.ts`'s `explain query plan` assertion).
  const ingredientRows =
    recipeIds.length === 0
      ? []
      : await db
          .select()
          .from(recipeIngredients)
          .where(inArray(recipeIngredients.recipeId, recipeIds))
          .orderBy(asc(recipeIngredients.recipeId), asc(recipeIngredients.position));
  const ingredientsByRecipe = new Map<string, typeof ingredientRows>();
  for (const row of ingredientRows) {
    const bucket = ingredientsByRecipe.get(row.recipeId);
    if (bucket) bucket.push(row);
    else ingredientsByRecipe.set(row.recipeId, [row]);
  }

  const recipes: PlanShoppingPreviewResponse["recipes"] = [];
  let totalMissingCount = 0;

  for (const entry of byRecipe.values()) {
    const rows = ingredientsByRecipe.get(entry.recipeId) ?? [];
    const ingredientTotal = rows.length;

    const base = entry.recipe.servingsAmount;
    const target = entry.servings;
    const factor =
      typeof base === "number" && base > 0 && typeof target === "number" && target > 0
        ? target / base
        : 1;
    const records = rows.map(toIngredientRecord);
    const scaled =
      factor === 1 ? records : scaleIngredients(records, factor, { keepNonScalingUnits: true });

    const missingIdsByKey = new Map<string, string[]>();
    const missingIngredients: PlanShoppingPreviewResponse["recipes"][number]["missingIngredients"] =
      [];
    for (const ingredient of scaled) {
      if (ingredient.name.trim().length === 0) continue;
      const item = ingredientToShoppingItem(ingredient, entry.recipeId);
      const key = shoppingItemKey(item.name, item.unit);
      if (onList.has(key)) continue;
      const ids = missingIdsByKey.get(key);
      if (ids) ids.push(ingredient.id);
      else missingIdsByKey.set(key, [ingredient.id]);
      // The SCALED line, as the picker should show it: what will land on the list.
      missingIngredients.push({
        id: ingredient.id,
        name: ingredient.name,
        quantity: ingredient.quantity ?? null,
        unit: ingredient.unit ?? null,
      });
    }

    if (missingIdsByKey.size === 0) continue;
    const missingIngredientIds = [...missingIdsByKey.values()].flat();
    totalMissingCount += missingIdsByKey.size;

    recipes.push({
      recipeId: entry.recipeId,
      title: entry.recipe.title,
      // Already the signed, derived thumbnail (`toPlanRecipe`) — a panel row is a
      // list image, never the full-size `imageUrl`.
      thumbnailUrl: entry.recipe.thumbnailUrl ?? null,
      plannedOn: entry.plannedOn,
      servings: entry.servings ?? null,
      ingredientTotal,
      missingCount: missingIdsByKey.size,
      missingIngredientIds,
      missingIngredients,
    });
  }

  return {
    listId: list.id,
    listName: list.name,
    from: range.from,
    to: range.to,
    totalMissingCount,
    recipes,
  };
}
