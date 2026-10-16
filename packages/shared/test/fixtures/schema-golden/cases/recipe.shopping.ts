import { z } from "zod";
import { COERCE_STRINGS, gen, leaf, singleKeys, uniqueIds, type Case, nonFinite } from "./_lib.ts";
import { ID, ID2, ID3, SHOPPING_LIST, TS, rep } from "./_fixtures.ts";

/**
 * The two query schemas that live in `apps/api/src/modules/recipe/routes/
 * shopping.ts` at `f41fb96f3` (lines 95-108), copied SELF-CONTAINED: no shared
 * schema is imported, so this file keeps compiling when the core flips. Their
 * future names are those of plan e1 P12 (`packages/shared/src/modules/recipe/
 * schemas/shopping.ts`, E1-T07). The only case file that imports zod.
 */
const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

export const localSchemas: Record<string, unknown> = {
  ShoppingBoughtListQuerySchema: PaginationQuery.extend({ listId: z.uuid().optional() }),
  ShoppingCatalogListQuerySchema: PaginationQuery.extend({
    includeHidden: z
      .enum(["0", "1"])
      .optional()
      .transform((value) => value === "1"),
  }),
};

const PREVIEW = { name: "Milch", quantity: 1.5, unit: "l" };
const LIST = SHOPPING_LIST;
const LIST_MIN = { id: ID, householdId: ID2, name: "x", createdBy: ID, createdAt: TS, updatedAt: TS };
const SOURCE = { id: ID, title: "Linsensuppe" };
const ITEM = { id: ID, listId: ID2, name: "Milch", quantity: 1.5, unit: "l", note: "bio", position: 0, sourceRecipeIds: [ID3], sources: [SOURCE], createdAt: TS, updatedAt: TS };
const ITEM_NULL = { ...ITEM, quantity: null, unit: null, note: null };
const BOUGHT = { id: ID, listId: ID2, name: "Milch", quantity: 1, unit: "l", note: "bio", boughtBy: ID, boughtByName: "Anna", boughtAt: TS, sourceRecipeIds: [ID3] };
const BOUGHT_NULL = { ...BOUGHT, quantity: null, unit: null, note: null, boughtBy: null, boughtByName: null };
const LIST_RECIPE = { recipeId: ID, title: "Linsensuppe", thumbnailUrl: "/t.webp", servings: 4, servingsUnit: "Portionen", ingredientTotal: 8, onListCount: 5, sharedCount: 1, addedAt: TS };
const LIST_RECIPE_NULL = { ...LIST_RECIPE, thumbnailUrl: null, servings: null, servingsUnit: null };
const CATALOG = { id: ID, listId: ID2, name: "Milch", unit: "l", useCount: 3, lastUsedAt: TS, hiddenAt: TS };
const CATALOG_NULL = { ...CATALOG, unit: null, hiddenAt: null };
const MISSING = { id: ID, name: "Linsen", quantity: 200, unit: "g" };
const PREVIEW_RECIPE = { recipeId: ID, title: "Linsensuppe", thumbnailUrl: "/t.webp", plannedOn: "2026-10-16", servings: 4, ingredientTotal: 8, missingCount: 1, missingIngredientIds: [ID2], missingIngredients: [MISSING] };
const DETAIL_MIN = { list: LIST_MIN, items: [], catalog: [], bought: [], recipes: [] };

const ITEM_INPUT = { name: "Milch", quantity: 1.5, unit: "l", note: "bio" };
const QUANTITIES = [0, 1, 0.001, 1000000, 1000001, -1, -0.001, 1.5, NaN, Infinity, -Infinity, "1", "1,5", null, undefined, "", true, [], {}, 1e20];

export const cases: Case[] = uniqueIds([
  ...leaf("MutationIdSchema", [ID, ID2, ID.toUpperCase(), "x", "00000000-0000-0000-0000-000000000000", `${ID} `, ID.replace(/-/g, "")]),
  ...gen("ShoppingItemPreviewSchema", PREVIEW, { mode: "full", extra: { "quantity-null": { ...PREVIEW, quantity: null, unit: null }, "quantity-negative": { ...PREVIEW, quantity: -1 }, "quantity-absent": { name: "x", unit: null }, "unit-absent": { name: "x", quantity: null } } }),
  ...gen("ShoppingListSchema", LIST, {
    minimal: LIST_MIN,
    allNull: { ...LIST, boughtClearedAt: null },
    extra: {
      "count-negative": { ...LIST, itemCount: -1 },
      "count-fraction": { ...LIST, boughtCount: 0.5 },
      "cleared-undefined": { ...LIST, boughtClearedAt: undefined },
      "preview-empty": { ...LIST, previewItems: [] },
      "preview-bad": { ...LIST, previewItems: [{ name: 1 }] },
      "preview-second-bad": { ...LIST, previewItems: [PREVIEW, { name: 1 }] },
    },
  }),
  ...gen("ShoppingItemSourceSchema", SOURCE, { mode: "full" }),
  ...gen("ShoppingItemSchema", ITEM, {
    allNull: ITEM_NULL,
    extra: { "position-negative": { ...ITEM, position: -1 }, "position-fraction": { ...ITEM, position: 0.5 }, "sources-bad": { ...ITEM, sources: [{ id: "x" }] }, "recipe-ids-bad": { ...ITEM, sourceRecipeIds: ["x"] }, "quantity-negative-allowed": { ...ITEM, quantity: -5 }, "quantity-absent": Object.fromEntries(Object.entries(ITEM).filter(([key]) => key !== "quantity")) },
  }),
  ...gen("ShoppingBoughtItemSchema", BOUGHT, { allNull: BOUGHT_NULL, extra: { "bought-at-bad": { ...BOUGHT, boughtAt: "2026-10-16" }, "recipe-ids-bad": { ...BOUGHT, sourceRecipeIds: [1] } } }),
  ...gen("ShoppingListRecipeSchema", LIST_RECIPE, {
    allNull: LIST_RECIPE_NULL,
    extra: { "count-negative": { ...LIST_RECIPE, onListCount: -1 }, "count-fraction": { ...LIST_RECIPE, sharedCount: 0.5 }, "total-negative": { ...LIST_RECIPE, ingredientTotal: -1 } },
  }),
  ...gen("ShoppingCatalogEntrySchema", CATALOG, { allNull: CATALOG_NULL, extra: { "use-count-negative": { ...CATALOG, useCount: -1 }, "use-count-fraction": { ...CATALOG, useCount: 0.5 }, "hidden-absent": Object.fromEntries(Object.entries(CATALOG).filter(([key]) => key !== "hiddenAt")) } }),

  ...gen("CreateShoppingListRequestSchema", { name: "Wocheneinkauf" }, {
    mode: "full",
    lens: { name: [119, 120, 121] },
    extra: { padded: { name: "  Woche  " }, blank: { name: "   " }, "padded-long": { name: `  ${rep("n", 121)}  ` }, "unknown-key": { name: "x", foo: 1 } },
  }),
  ...gen("UpdateShoppingListRequestSchema", { name: "Wocheneinkauf" }, {
    mode: "full",
    lens: { name: [119, 120, 121] },
    extra: { padded: { name: "  Woche  " }, blank: { name: "   " }, empty: {} },
  }),
  ...gen("ShoppingItemInputSchema", ITEM_INPUT, {
    mode: "full",
    minimal: { name: "x" },
    allNull: { name: "x", quantity: null, unit: null, note: null },
    lens: { name: [299, 300, 301], unit: [39, 40, 41], note: [299, 300, 301] },
    extra: {
      "name-padded": { name: "  Milch  " },
      "name-blank": { name: "   " },
      "unit-padded": { name: "x", unit: "  l  " },
      "unit-blank": { name: "x", unit: "   " },
      "note-padded": { name: "x", note: "  n  " },
      "all-bad": { name: "", quantity: -1, unit: rep("u", 41), note: rep("n", 301) },
    },
  }),
  ...QUANTITIES.map((quantity, index) => ({ id: `ShoppingItemInputSchema#quantity-${index}-${typeof quantity === "string" ? JSON.stringify(quantity) : String(quantity)}`, schema: "ShoppingItemInputSchema", input: { name: "x", quantity } })),
  ...gen("AddShoppingItemsRequestSchema", { items: [ITEM_INPUT], mutationId: ID }, {
    mode: "full",
    minimal: { items: [{ name: "x" }] },
    lens: { items: [199, 200, 201] },
    lenItem: { items: { name: "x" } },
    extra: {
      "items-empty": { items: [] },
      "items-max": { items: Array.from({ length: 200 }, () => ({ name: "x" })) },
      "items-over-max": { items: Array.from({ length: 201 }, () => ({ name: "x" })) },
      "items-second-bad": { items: [{ name: "x" }, { name: "" }, { quantity: -1 }] },
      "items-null-element": { items: [null] },
      "items-string": { items: "x" },
      "mutation-bad": { items: [{ name: "x" }], mutationId: "x" },
      "mutation-null": { items: [{ name: "x" }], mutationId: null },
      "all-bad": { items: [], mutationId: "x" },
    },
  }),
  ...gen("UpdateShoppingItemRequestSchema", { name: "Milch", quantity: 1.5, unit: "l", note: "bio" }, {
    mode: "full",
    lens: { name: [300, 301], unit: [40, 41], note: [300, 301] },
    extra: {
      empty: {},
      "unknown-only": { foo: 1 },
      "name-only": { name: "Neu" },
      "name-empty": { name: "" },
      "name-padded": { name: "  Neu  " },
      "name-null": { name: null },
      "quantity-null": { quantity: null },
      "quantity-1000000": { quantity: 1000000 },
      "quantity-1000001": { quantity: 1000001 },
      "quantity-negative": { quantity: -1 },
      "all-undefined": { name: undefined, quantity: undefined, unit: undefined, note: undefined },
      "all-null": { quantity: null, unit: null, note: null },
      "all-bad": { name: "", quantity: -1, unit: rep("u", 41), note: rep("n", 301) },
      "bad-and-unknown": { name: "", foo: 1 },
    },
  }),
  ...singleKeys("UpdateShoppingItemRequestSchema", { name: "Milch", quantity: 1.5, unit: "l", note: "bio" }),
  ...gen("AddRecipeToShoppingListRequestSchema", { recipeId: ID, servings: 4, ingredientIds: [ID2], mutationId: ID3 }, {
    mode: "full",
    minimal: { recipeId: ID },
    lens: { ingredientIds: [499, 500, 501] },
    lenItem: { ingredientIds: ID },
    skip: ["ingredientIds.0"],
    extra: {
      "servings-1000": { recipeId: ID, servings: 1000 },
      "servings-1001": { recipeId: ID, servings: 1001 },
      "servings-zero": { recipeId: ID, servings: 0 },
      "servings-negative": { recipeId: ID, servings: -1 },
      "servings-fraction": { recipeId: ID, servings: 0.5 },
      "servings-null": { recipeId: ID, servings: null },
      "ingredient-ids-empty": { recipeId: ID, ingredientIds: [] },
      "ingredient-ids-bad": { recipeId: ID, ingredientIds: ["x"] },
      "ingredient-ids-two-bad": { recipeId: ID, ingredientIds: ["x", ID2, 1] },
      "ingredient-ids-null": { recipeId: ID, ingredientIds: null },
      "mutation-bad": { recipeId: ID, mutationId: "x" },
      "all-bad": { recipeId: "x", servings: 0, ingredientIds: "y", mutationId: "z" },
    },
  }),
  ...gen("CheckShoppingItemRequestSchema", { mutationId: ID }, {
    mode: "full",
    minimal: {},
    extra: { "mutation-bad": { mutationId: "x" }, "mutation-null": { mutationId: null }, "mutation-undefined": { mutationId: undefined }, "unknown-key": { foo: 1 }, "mutation-upper": { mutationId: ID.toUpperCase() } },
  }),
  ...gen("UpdateShoppingCatalogEntryRequestSchema", { hidden: true }, {
    mode: "full",
    extra: { false: { hidden: false }, string: { hidden: "true" }, one: { hidden: 1 }, "unknown-key": { hidden: true, foo: 1 } },
  }),

  ...gen("ShoppingListResponseSchema", { list: LIST_MIN }, { depth: 0, extra: { full: { list: LIST }, "list-bad": { list: { id: "x" } } } }),
  ...gen("ShoppingListListResponseSchema", { items: [LIST_MIN] }, { depth: 0, minimal: { items: [] }, extra: { full: { items: [LIST] }, "second-bad": { items: [LIST, { id: "x" }] } } }),
  ...gen("ShoppingListDetailResponseSchema", DETAIL_MIN, {
    depth: 0,
    extra: {
      full: { list: LIST, items: [ITEM], catalog: [CATALOG], bought: [BOUGHT], recipes: [LIST_RECIPE] },
      "all-null": { list: { ...LIST, boughtClearedAt: null }, items: [ITEM_NULL], catalog: [CATALOG_NULL], bought: [BOUGHT_NULL], recipes: [LIST_RECIPE_NULL] },
      "item-bad": { ...DETAIL_MIN, items: [{ id: "x" }] },
      "catalog-bad": { ...DETAIL_MIN, catalog: [{ id: "x" }] },
      "bought-bad": { ...DETAIL_MIN, bought: [{ id: "x" }] },
      "recipes-bad": { ...DETAIL_MIN, recipes: [{ recipeId: "x" }] },
      "all-bad": { list: 1, items: 2, catalog: 3, bought: 4, recipes: 5 },
    },
  }),
  ...gen("ShoppingBoughtListResponseSchema", { items: [{ ...BOUGHT_NULL }], total: 1, limit: 24, offset: 0 }, {
    depth: 0,
    minimal: { items: [], total: 0, limit: 1, offset: 0 },
    extra: { full: { items: [BOUGHT], total: 1, limit: 24, offset: 0 }, "item-bad": { items: [{ id: "x" }], total: 1, limit: 1, offset: 0 }, "limit-zero": { items: [], total: 0, limit: 0, offset: 0 } },
  }),
  ...gen("ShoppingCatalogListResponseSchema", { items: [CATALOG_NULL], total: 1, limit: 24, offset: 0 }, {
    depth: 0,
    minimal: { items: [], total: 0, limit: 1, offset: 0 },
    extra: { full: { items: [CATALOG], total: 1, limit: 24, offset: 0 }, "item-bad": { items: [{ id: "x" }], total: 1, limit: 1, offset: 0 }, "limit-zero": { items: [], total: 0, limit: 0, offset: 0 } },
  }),
  ...gen("PlanShoppingMissingIngredientSchema", MISSING, { allNull: { ...MISSING, quantity: null, unit: null } }),
  ...gen("PlanShoppingPreviewRecipeSchema", PREVIEW_RECIPE, {
    allNull: { ...PREVIEW_RECIPE, thumbnailUrl: null, servings: null },
    extra: { "missing-empty": { ...PREVIEW_RECIPE, missingIngredientIds: [], missingIngredients: [], missingCount: 0 }, "missing-bad": { ...PREVIEW_RECIPE, missingIngredients: [{ id: "x" }] }, "count-negative": { ...PREVIEW_RECIPE, missingCount: -1 } },
  }),
  ...gen("PlanShoppingPreviewResponseSchema", { listId: ID, listName: "Woche", from: "2026-10-01", to: "2026-10-07", totalMissingCount: 0, recipes: [] }, {
    depth: 0,
    extra: { full: { listId: ID, listName: "Woche", from: "2026-10-01", to: "2026-10-07", totalMissingCount: 1, recipes: [PREVIEW_RECIPE] }, "recipe-bad": { listId: ID, listName: "x", from: "a", to: "b", totalMissingCount: 0, recipes: [{ recipeId: "x" }] }, "count-negative": { listId: ID, listName: "x", from: "a", to: "b", totalMissingCount: -1, recipes: [] } },
  }),

  ...gen("ShoppingBoughtListQuerySchema", { limit: "24", offset: "0", listId: ID }, {
    mode: "full",
    minimal: {},
    extra: Object.fromEntries([
      ...COERCE_STRINGS.map((value, index) => [`limit-${index}`, { limit: value }] as const),
      ...COERCE_STRINGS.map((value, index) => [`offset-${index}`, { offset: value }] as const),
      ["limit-100", { limit: "100" }],
      ["limit-101", { limit: "101" }],
      ["list-bad", { listId: "x" }],
      ["list-empty", { listId: "" }],
      ["list-upper", { listId: ID.toUpperCase() }],
      ["list-array", { listId: [ID, ID2] }],
      ["list-undefined", { listId: undefined }],
      ["list-null", { listId: null }],
      ["unknown-key", { foo: "bar" }],
      ["everything-bad", { limit: "0", offset: "-1", listId: "x" }],
    ]),
  }),
  ...gen("ShoppingCatalogListQuerySchema", { limit: "24", offset: "0", includeHidden: "1" }, {
    mode: "full",
    minimal: {},
    extra: Object.fromEntries([
      ...COERCE_STRINGS.map((value, index) => [`limit-${index}`, { limit: value }] as const),
      ["include-hidden-0", { includeHidden: "0" }],
      ["include-hidden-1", { includeHidden: "1" }],
      ["include-hidden-true", { includeHidden: "true" }],
      ["include-hidden-false", { includeHidden: "false" }],
      ["include-hidden-2", { includeHidden: "2" }],
      ["include-hidden-empty", { includeHidden: "" }],
      ["include-hidden-undefined", { includeHidden: undefined }],
      ["include-hidden-null", { includeHidden: null }],
      ["include-hidden-boolean", { includeHidden: true }],
      ["include-hidden-number", { includeHidden: 1 }],
      ["include-hidden-array", { includeHidden: ["1"] }],
      ["unknown-key", { foo: "bar" }],
      ["everything-bad", { limit: "0", offset: "-1", includeHidden: "yes" }],
    ]),
  }),
  ...nonFinite("ShoppingListResponseSchema", { list: LIST }),
  ...nonFinite("ShoppingListListResponseSchema", { items: [LIST] }),
  ...nonFinite("ShoppingListDetailResponseSchema", { list: LIST, items: [ITEM], catalog: [CATALOG], bought: [BOUGHT], recipes: [LIST_RECIPE] }),
  ...nonFinite("ShoppingBoughtListResponseSchema", { items: [BOUGHT], total: 1, limit: 24, offset: 0 }),
  ...nonFinite("PlanShoppingPreviewResponseSchema", { listId: ID, listName: "Woche", from: "2026-10-01", to: "2026-10-07", totalMissingCount: 1, recipes: [PREVIEW_RECIPE] }),
]);
