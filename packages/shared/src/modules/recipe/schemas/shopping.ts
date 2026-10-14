/**
 * Shopping lists ("Einkaufslisten") — wire contract.
 *
 * Shape notes that the rest of the app depends on:
 *
 *  - A list belongs to a HOUSEHOLD, like every other piece of content. Several named
 *    lists per household are supported ("Rewe", "Drogerie").
 *  - Checking an item off DELETES it and bumps a catalog entry instead of setting a
 *    flag, which is why there is no `checked` field anywhere. The catalog is the
 *    "Häufig gekauft" row (see `ShoppingCatalogEntry`). The check-off ALSO appends a
 *    row to `shopping_bought_items` — that log is what draws "Bought today" and the
 *    history panel, and it is a log, not a flag: there is still no `checked` column
 *    on `shopping_list_items`, and undoing a check-off deletes the log row and
 *    re-merges the amount back onto the list rather than clearing a bit.
 *  - Every mutating request may carry a client-generated `mutationId`. The API
 *    remembers applied ids per list, so a mutation replayed after an offline spell
 *    cannot add the same ingredients twice. See services/shopping/idempotency.ts.
 */
import { z } from "zod";
import { refineKey } from "../../../core/i18n/zod.ts";
import { IdSchema, IsoDateSchema, listResponse } from "../../../core/schemas/common.ts";

/** Upper bounds, mirrored by the UI so a phone never sends a doomed request. */
export const SHOPPING_LIMITS = {
  listsPerHousehold: 30,
  itemsPerList: 500,
  itemsPerRequest: 200,
  catalogPerList: 200,
  /** How many "Häufig gekauft" suggestions a list detail returns. */
  catalogSuggestions: 24,
  /** Rows the "Bought today" section carries in the detail payload. */
  boughtSectionMax: 100,
  /** Item names the overview card previews per list; "+N" is itemCount - this. */
  listPreviewItems: 8,
} as const;

/**
 * Idempotency token for a mutation the client may have to replay.
 * A uuid so it cannot collide across devices.
 */
export const MutationIdSchema = z.uuid();

/* --------------------------------- entities ------------------------------- */

/** One item name previewed on an overview card, index-only like `itemCount`. */
export const ShoppingItemPreviewSchema = z.object({
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
});
export type ShoppingItemPreview = z.infer<typeof ShoppingItemPreviewSchema>;

export const ShoppingListSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  name: z.string(),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  /** Present in listings and after a mutation. */
  itemCount: z.number().int().nonnegative().optional(),
  /** How many rows are in today's "Bought today" log. Index-only, like `itemCount`. */
  boughtCount: z.number().int().nonnegative().optional(),
  /** The `Clear bought` watermark — null until the first clear. Index-only. */
  boughtClearedAt: IsoDateSchema.nullable().optional(),
  /** First `SHOPPING_LIMITS.listPreviewItems` items, `position` order. Index-only. */
  previewItems: z.array(ShoppingItemPreviewSchema).optional(),
});
export type ShoppingList = z.infer<typeof ShoppingListSchema>;

/** A recipe that contributed to an item, resolved for display. */
export const ShoppingItemSourceSchema = z.object({
  id: IdSchema,
  title: z.string(),
});
export type ShoppingItemSource = z.infer<typeof ShoppingItemSourceSchema>;

export const ShoppingItemSchema = z.object({
  id: IdSchema,
  listId: IdSchema,
  name: z.string(),
  /** null means "no amount given" — never render it as 0. */
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  note: z.string().nullable(),
  position: z.number().int().nonnegative(),
  /**
   * Recipes this line was merged from. Ids whose recipe was deleted are kept here but
   * absent from `sources`, so provenance survives a deletion without a dangling link.
   */
  sourceRecipeIds: z.array(IdSchema),
  sources: z.array(ShoppingItemSourceSchema),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type ShoppingItem = z.infer<typeof ShoppingItemSchema>;

/**
 * One row of the check-off log — "Bought today" and the history panel read this,
 * never a flag on `ShoppingItemSchema`. `boughtBy`/`boughtByName` are null for a row
 * whose user has since left the household; the name is kept because the log outlives
 * membership.
 */
export const ShoppingBoughtItemSchema = z.object({
  id: IdSchema,
  listId: IdSchema,
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  note: z.string().nullable(),
  boughtBy: IdSchema.nullable(),
  boughtByName: z.string().nullable(),
  boughtAt: IsoDateSchema,
  sourceRecipeIds: z.array(IdSchema),
});
export type ShoppingBoughtItem = z.infer<typeof ShoppingBoughtItemSchema>;

/**
 * One recipe currently attached to a list (`shopping_list_recipes`), resolved for
 * display. `ingredientTotal` counts the recipe's ingredients AS IT IS TODAY, not as
 * it was when added — a recipe that gained a line since reads "5 of 6", which is the
 * prompt to add the missing one, not a bug.
 */
export const ShoppingListRecipeSchema = z.object({
  recipeId: IdSchema,
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  servings: z.number().nullable(),
  servingsUnit: z.string().nullable(),
  ingredientTotal: z.number().int().nonnegative(),
  onListCount: z.number().int().nonnegative(),
  sharedCount: z.number().int().nonnegative(),
  addedAt: IsoDateSchema,
});
export type ShoppingListRecipe = z.infer<typeof ShoppingListRecipeSchema>;

/**
 * One "Häufig gekauft" entry: something that has been on this list before.
 * `useCount` counts CHECK-OFFS, not adds — it ranks what actually gets bought.
 * A hidden entry (`hiddenAt` non-null) keeps its `use_count` — hiding removes it from
 * the chip row without losing its rank if it is ever unhidden.
 */
export const ShoppingCatalogEntrySchema = z.object({
  id: IdSchema,
  listId: IdSchema,
  name: z.string(),
  unit: z.string().nullable(),
  useCount: z.number().int().nonnegative(),
  lastUsedAt: IsoDateSchema,
  hiddenAt: IsoDateSchema.nullable(),
});
export type ShoppingCatalogEntry = z.infer<typeof ShoppingCatalogEntrySchema>;

/* --------------------------------- requests ------------------------------- */

export const CreateShoppingListRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type CreateShoppingListRequest = z.infer<typeof CreateShoppingListRequestSchema>;

export const UpdateShoppingListRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type UpdateShoppingListRequest = z.infer<typeof UpdateShoppingListRequestSchema>;

/**
 * One line to add. The client parses free text with `parseIngredientLine` from
 * @toon/shared before sending, so "500g Mehl" arrives as
 * `{ name: "Mehl", quantity: 500, unit: "g" }`.
 */
export const ShoppingItemInputSchema = z.object({
  name: z.string().trim().min(1).max(300),
  quantity: z.number().nonnegative().max(1_000_000).nullish(),
  unit: z.string().trim().max(40).nullish(),
  note: z.string().trim().max(300).nullish(),
});
export type ShoppingItemInput = z.infer<typeof ShoppingItemInputSchema>;

export const AddShoppingItemsRequestSchema = z.object({
  items: z.array(ShoppingItemInputSchema).min(1).max(SHOPPING_LIMITS.itemsPerRequest),
  mutationId: MutationIdSchema.optional(),
});
export type AddShoppingItemsRequest = z.infer<typeof AddShoppingItemsRequestSchema>;

/**
 * Edit one line. Absent keys stay untouched; an explicit `null` clears the field.
 * Changing `name`/`unit` can move the line into another item's merge bucket — the
 * API then folds them together, so the response may contain FEWER items than before.
 */
export const UpdateShoppingItemRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(300).optional(),
    quantity: z.number().nonnegative().max(1_000_000).nullish(),
    unit: z.string().trim().max(40).nullish(),
    note: z.string().trim().max(300).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, refineKey("server.validation.noChanges"));
export type UpdateShoppingItemRequest = z.infer<typeof UpdateShoppingItemRequestSchema>;

/**
 * Put a recipe on the list, scaled to `servings`.
 *
 * `servings` is the TARGET portion count. Omit it to use the recipe's own
 * `servingsAmount` (factor 1). The API scales with the same `scaleIngredients` the
 * detail screen uses, so the amounts on the list match what the cook saw.
 *
 * `ingredientIds` narrows the request to a subset of the recipe's ingredient rows —
 * the cook has usually got salt and oil at home. OMITTING it means "the whole recipe",
 * which is both the default in the UI and what keeps an older client working. Ids that
 * no longer exist are ignored rather than rejected, so a queued offline request still
 * lands after someone else edited the recipe.
 */
export const AddRecipeToShoppingListRequestSchema = z.object({
  recipeId: IdSchema,
  servings: z.number().positive().max(1000).optional(),
  ingredientIds: z.array(IdSchema).max(500).optional(),
  mutationId: MutationIdSchema.optional(),
});
export type AddRecipeToShoppingListRequest = z.infer<
  typeof AddRecipeToShoppingListRequestSchema
>;

/** Check off one item: it leaves the list and lands in "Häufig gekauft". */
export const CheckShoppingItemRequestSchema = z.object({
  mutationId: MutationIdSchema.optional(),
});
export type CheckShoppingItemRequest = z.infer<typeof CheckShoppingItemRequestSchema>;

/** Hide or unhide one "Häufig gekauft" entry without losing its `useCount`. */
export const UpdateShoppingCatalogEntryRequestSchema = z.object({
  hidden: z.boolean(),
});
export type UpdateShoppingCatalogEntryRequest = z.infer<
  typeof UpdateShoppingCatalogEntryRequestSchema
>;

/* -------------------------------- responses ------------------------------- */

export const ShoppingListResponseSchema = z.object({ list: ShoppingListSchema });
export type ShoppingListResponse = z.infer<typeof ShoppingListResponseSchema>;

export const ShoppingListListResponseSchema = z.object({
  items: z.array(ShoppingListSchema),
});
export type ShoppingListListResponse = z.infer<typeof ShoppingListListResponseSchema>;

/**
 * The whole screen in one payload: the list, its open items in `position` order, the
 * suggestions, today's bought log and the recipes attached to the list. Every
 * mutation returns this shape too, so the client can replace its cache entry instead
 * of patching it — which is what keeps an offline replay from drifting from the
 * server. `bought` and `recipes` are REQUIRED (not optional): one origin, one
 * deploy — a persisted v2 blob restored under an older `PERSIST_BUSTER` would
 * otherwise hydrate `undefined` into components that index them, drawing an empty
 * "Bought today" section over a list where things were bought. The client-side
 * bump that forces a cold reload past that blob lives in `apps/web/src/lib/persist.ts`.
 */
export const ShoppingListDetailResponseSchema = z.object({
  list: ShoppingListSchema,
  items: z.array(ShoppingItemSchema),
  catalog: z.array(ShoppingCatalogEntrySchema),
  bought: z.array(ShoppingBoughtItemSchema),
  recipes: z.array(ShoppingListRecipeSchema),
});
export type ShoppingListDetailResponse = z.infer<typeof ShoppingListDetailResponseSchema>;

/** `GET …/shopping-lists/bought` — the cross-list "Bought today" / history feed. */
export const ShoppingBoughtListResponseSchema = listResponse(ShoppingBoughtItemSchema);
export type ShoppingBoughtListResponse = z.infer<typeof ShoppingBoughtListResponseSchema>;

/** `GET …/shopping-lists/:listId/catalog` — the full "Häufig gekauft" sheet. */
export const ShoppingCatalogListResponseSchema = listResponse(ShoppingCatalogEntrySchema);
export type ShoppingCatalogListResponse = z.infer<typeof ShoppingCatalogListResponseSchema>;

/**
 * One recipe from the current week's plan, previewed for "add missing ingredients"
 * (`GET …/shopping-lists/:listId/from-plan`). `missingIngredientIds` are
 * `recipe_ingredients` ids passed straight back as `ingredientIds`.
 */
/**
 * One missing ingredient LINE, already scaled to the plan entry's portions — what
 * the "add everything" picker shows next to its checkbox. `id` is the
 * `recipe_ingredients` id, i.e. exactly what goes back as `ingredientIds`.
 */
export const PlanShoppingMissingIngredientSchema = z.object({
  id: IdSchema,
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
});
export type PlanShoppingMissingIngredient = z.infer<typeof PlanShoppingMissingIngredientSchema>;

export const PlanShoppingPreviewRecipeSchema = z.object({
  recipeId: IdSchema,
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  /** Earliest planned day in the window, YYYY-MM-DD — the row's "Tue" label. */
  plannedOn: z.string(),
  /** Portions from the plan entry; null = the recipe's own count. */
  servings: z.number().nullable(),
  ingredientTotal: z.number().int().nonnegative(),
  /** Distinct merge keys not yet on the target list — the row's "9 ingredients". */
  missingCount: z.number().int().nonnegative(),
  missingIngredientIds: z.array(IdSchema),
  /**
   * The same rows as `missingIngredientIds`, with name and scaled amount, in recipe
   * order — so the picker can offer each line for unticking without a second fetch.
   */
  missingIngredients: z.array(PlanShoppingMissingIngredientSchema),
});
export type PlanShoppingPreviewRecipe = z.infer<typeof PlanShoppingPreviewRecipeSchema>;

export const PlanShoppingPreviewResponseSchema = z.object({
  listId: IdSchema,
  listName: z.string(),
  from: z.string(),
  to: z.string(),
  /** Sum of the per-recipe missingCounts — the panel's "22 ingredients". */
  totalMissingCount: z.number().int().nonnegative(),
  recipes: z.array(PlanShoppingPreviewRecipeSchema),
});
export type PlanShoppingPreviewResponse = z.infer<typeof PlanShoppingPreviewResponseSchema>;
