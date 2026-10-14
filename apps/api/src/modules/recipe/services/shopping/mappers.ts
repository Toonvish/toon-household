/**
 * Row -> contract mappers for shopping lists, items, the bought log, list-recipes
 * and catalog entries.
 */
import type {
  ShoppingBoughtItem,
  ShoppingCatalogEntry,
  ShoppingItem,
  ShoppingItemPreview,
  ShoppingItemSource,
  ShoppingList,
  ShoppingListRecipe,
} from "@toon/shared";
import type {
  RecipeRow,
  ShoppingBoughtItemRow,
  ShoppingListCatalogRow,
  ShoppingListItemRow,
  ShoppingListRecipeRow,
  ShoppingListRow,
} from "../../../../db/schema.ts";
import { toIso, toIsoOrNull } from "../../../../lib/http.ts";
import { signUploadUrl } from "../../../../lib/uploadUrls.ts";
import { listImageUrlFor } from "../../../../core/services/media/thumbnails.ts";

/**
 * `extras` carries the fields that are only ever computed at the INDEX or DETAIL
 * call sites (`boughtCount`/`previewItems` are index-only, `itemCount` is both) —
 * a plain create/rename response omits them by leaving the object out.
 * `boughtClearedAt` is always taken from the row: it costs nothing and every
 * caller has the row in hand.
 */
export function toShoppingList(
  row: ShoppingListRow,
  extras?: {
    itemCount?: number;
    boughtCount?: number;
    previewItems?: ShoppingItemPreview[];
  },
): ShoppingList {
  const list: ShoppingList = {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    boughtClearedAt: toIsoOrNull(row.boughtClearedAt),
  };
  if (extras?.itemCount !== undefined) list.itemCount = extras.itemCount;
  if (extras?.boughtCount !== undefined) list.boughtCount = extras.boughtCount;
  if (extras?.previewItems !== undefined) list.previewItems = extras.previewItems;
  return list;
}

/**
 * `titles` maps recipe id -> title for the recipes still present in the household.
 *
 * An id with no entry is kept in `sourceRecipeIds` but omitted from `sources`: the
 * provenance is still true ("this came from a recipe") while the UI has nothing to
 * link to. That is why the column is not a FK — a deleted recipe must not take the
 * shopping item with it.
 */
export function toShoppingItem(
  row: ShoppingListItemRow,
  titles: ReadonlyMap<string, string>,
): ShoppingItem {
  const sourceRecipeIds = Array.isArray(row.sourceRecipeIds) ? row.sourceRecipeIds : [];
  const sources: ShoppingItemSource[] = [];
  for (const id of sourceRecipeIds) {
    const title = titles.get(id);
    if (title !== undefined) sources.push({ id, title });
  }
  return {
    id: row.id,
    listId: row.listId,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    note: row.note,
    position: row.position,
    sourceRecipeIds,
    sources,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function toShoppingCatalogEntry(row: ShoppingListCatalogRow): ShoppingCatalogEntry {
  return {
    id: row.id,
    listId: row.listId,
    name: row.name,
    unit: row.unit,
    useCount: row.useCount,
    lastUsedAt: toIso(row.lastUsedAt),
    hiddenAt: toIsoOrNull(row.hiddenAt),
  };
}

/**
 * One check-off log row. `boughtByName` is the joined `users.name`, already
 * resolved by the caller — `null` for a buyer who has since left/deleted their
 * account (the row itself outlives the membership), and the client renders the
 * catalog's `shopping.bought.unknownBuyer` ("Unbekannt"/"Unknown") for that case.
 */
export function toShoppingBoughtItem(
  row: ShoppingBoughtItemRow,
  boughtByName: string | null,
): ShoppingBoughtItem {
  return {
    id: row.id,
    listId: row.listId,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    note: row.note,
    boughtBy: row.boughtBy,
    boughtByName,
    boughtAt: toIso(row.boughtAt),
    sourceRecipeIds: Array.isArray(row.sourceRecipeIds) ? row.sourceRecipeIds : [],
  };
}

/**
 * One "Recipes on this list" rail row. `recipe` is restricted to the household by the
 * caller's join, same rule as `toShoppingItem`'s `titles` map.
 * `ingredientTotal`/`onListCount`/`sharedCount` are supplied by the caller — they
 * need the full item-row set and the recipe's CURRENT ingredient count, neither of
 * which this row alone carries (R22: the count is live, not a snapshot).
 */
export function toShoppingListRecipe(
  row: ShoppingListRecipeRow,
  recipe: RecipeRow,
  counts: { ingredientTotal: number; onListCount: number; sharedCount: number },
): ShoppingListRecipe {
  return {
    recipeId: recipe.id,
    title: recipe.title,
    // Derivative for a hosted upload, the original for an external hero image —
    // this slim DTO has no `imageUrl` fallback (see `listImageUrlFor`).
    thumbnailUrl: signUploadUrl(listImageUrlFor(recipe.imageUrl)),
    servings: row.servings,
    servingsUnit: recipe.servingsUnit,
    ingredientTotal: counts.ingredientTotal,
    onListCount: counts.onListCount,
    sharedCount: counts.sharedCount,
    addedAt: toIso(row.addedAt),
  };
}
