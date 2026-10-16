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
import { Option, Schema, SchemaGetter, type Types } from "effect";
import {
  Bool,
  Enum,
  Int,
  Num,
  Str,
  Uuid,
  keyed,
  max,
  maxItems,
  maxLength,
  minItems,
  minLength,
  nonnegative,
  positive,
  trim,
} from "../../../core/schemas/checks.ts";
import { IdSchema, IsoDateSchema, listResponse, PaginationQuerySchema } from "../../../core/schemas/common.ts";

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
export const MutationIdSchema = Uuid;

/* --------------------------------- entities ------------------------------- */

/** One item name previewed on an overview card, index-only like `itemCount`. */
export const ShoppingItemPreviewSchema = Schema.Struct({
  name: Str,
  quantity: Schema.NullOr(Num),
  unit: Schema.NullOr(Str),
});
export type ShoppingItemPreview = Types.DeepMutable<typeof ShoppingItemPreviewSchema.Type>;

export const ShoppingListSchema = Schema.Struct({
  id: IdSchema,
  householdId: IdSchema,
  name: Str,
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  /** Present in listings and after a mutation. */
  itemCount: Schema.optional(Int.check(nonnegative())),
  /** How many rows are in today's "Bought today" log. Index-only, like `itemCount`. */
  boughtCount: Schema.optional(Int.check(nonnegative())),
  /** The `Clear bought` watermark — null until the first clear. Index-only. */
  boughtClearedAt: Schema.optional(Schema.NullOr(IsoDateSchema)),
  /** First `SHOPPING_LIMITS.listPreviewItems` items, `position` order. Index-only. */
  previewItems: Schema.optional(Schema.Array(ShoppingItemPreviewSchema)),
});
export type ShoppingList = Types.DeepMutable<typeof ShoppingListSchema.Type>;

/** A recipe that contributed to an item, resolved for display. */
export const ShoppingItemSourceSchema = Schema.Struct({
  id: IdSchema,
  title: Str,
});
export type ShoppingItemSource = Types.DeepMutable<typeof ShoppingItemSourceSchema.Type>;

export const ShoppingItemSchema = Schema.Struct({
  id: IdSchema,
  listId: IdSchema,
  name: Str,
  /** null means "no amount given" — never render it as 0. */
  quantity: Schema.NullOr(Num),
  unit: Schema.NullOr(Str),
  note: Schema.NullOr(Str),
  position: Int.check(nonnegative()),
  /**
   * Recipes this line was merged from. Ids whose recipe was deleted are kept here but
   * absent from `sources`, so provenance survives a deletion without a dangling link.
   */
  sourceRecipeIds: Schema.Array(IdSchema),
  sources: Schema.Array(ShoppingItemSourceSchema),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type ShoppingItem = Types.DeepMutable<typeof ShoppingItemSchema.Type>;

/**
 * One row of the check-off log — "Bought today" and the history panel read this,
 * never a flag on `ShoppingItemSchema`. `boughtBy`/`boughtByName` are null for a row
 * whose user has since left the household; the name is kept because the log outlives
 * membership.
 */
export const ShoppingBoughtItemSchema = Schema.Struct({
  id: IdSchema,
  listId: IdSchema,
  name: Str,
  quantity: Schema.NullOr(Num),
  unit: Schema.NullOr(Str),
  note: Schema.NullOr(Str),
  boughtBy: Schema.NullOr(IdSchema),
  boughtByName: Schema.NullOr(Str),
  boughtAt: IsoDateSchema,
  sourceRecipeIds: Schema.Array(IdSchema),
});
export type ShoppingBoughtItem = Types.DeepMutable<typeof ShoppingBoughtItemSchema.Type>;

/**
 * One recipe currently attached to a list (`shopping_list_recipes`), resolved for
 * display. `ingredientTotal` counts the recipe's ingredients AS IT IS TODAY, not as
 * it was when added — a recipe that gained a line since reads "5 of 6", which is the
 * prompt to add the missing one, not a bug.
 */
export const ShoppingListRecipeSchema = Schema.Struct({
  recipeId: IdSchema,
  title: Str,
  thumbnailUrl: Schema.NullOr(Str),
  servings: Schema.NullOr(Num),
  servingsUnit: Schema.NullOr(Str),
  ingredientTotal: Int.check(nonnegative()),
  onListCount: Int.check(nonnegative()),
  sharedCount: Int.check(nonnegative()),
  addedAt: IsoDateSchema,
});
export type ShoppingListRecipe = Types.DeepMutable<typeof ShoppingListRecipeSchema.Type>;

/**
 * One "Häufig gekauft" entry: something that has been on this list before.
 * `useCount` counts CHECK-OFFS, not adds — it ranks what actually gets bought.
 * A hidden entry (`hiddenAt` non-null) keeps its `use_count` — hiding removes it from
 * the chip row without losing its rank if it is ever unhidden.
 */
export const ShoppingCatalogEntrySchema = Schema.Struct({
  id: IdSchema,
  listId: IdSchema,
  name: Str,
  unit: Schema.NullOr(Str),
  useCount: Int.check(nonnegative()),
  lastUsedAt: IsoDateSchema,
  hiddenAt: Schema.NullOr(IsoDateSchema),
});
export type ShoppingCatalogEntry = Types.DeepMutable<typeof ShoppingCatalogEntrySchema.Type>;

/* --------------------------------- requests ------------------------------- */

export const CreateShoppingListRequestSchema = Schema.Struct({
  name: Str.pipe(trim).check(minLength(1), maxLength(120)),
});
export type CreateShoppingListRequest = Types.DeepMutable<typeof CreateShoppingListRequestSchema.Type>;

export const UpdateShoppingListRequestSchema = Schema.Struct({
  name: Str.pipe(trim).check(minLength(1), maxLength(120)),
});
export type UpdateShoppingListRequest = Types.DeepMutable<typeof UpdateShoppingListRequestSchema.Type>;

/**
 * One line to add. The client parses free text with `parseIngredientLine` from
 * @toon/shared before sending, so "500g Mehl" arrives as
 * `{ name: "Mehl", quantity: 500, unit: "g" }`.
 */
export const ShoppingItemInputSchema = Schema.Struct({
  name: Str.pipe(trim).check(minLength(1), maxLength(300)),
  quantity: Schema.optional(Schema.NullOr(Num.check(nonnegative(), max(1_000_000)))),
  unit: Schema.optional(Schema.NullOr(Str.pipe(trim).check(maxLength(40)))),
  note: Schema.optional(Schema.NullOr(Str.pipe(trim).check(maxLength(300)))),
});
export type ShoppingItemInput = Types.DeepMutable<typeof ShoppingItemInputSchema.Type>;

export const AddShoppingItemsRequestSchema = Schema.Struct({
  items: Schema.Array(ShoppingItemInputSchema).check(minItems(1), maxItems(SHOPPING_LIMITS.itemsPerRequest)),
  mutationId: Schema.optional(MutationIdSchema),
});
export type AddShoppingItemsRequest = Types.DeepMutable<typeof AddShoppingItemsRequestSchema.Type>;

/**
 * Edit one line. Absent keys stay untouched; an explicit `null` clears the field.
 * Changing `name`/`unit` can move the line into another item's merge bucket — the
 * API then folds them together, so the response may contain FEWER items than before.
 */
export const UpdateShoppingItemRequestSchema = Schema.Struct({
    name: Schema.optional(Str.pipe(trim).check(minLength(1), maxLength(300))),
    quantity: Schema.optional(Schema.NullOr(Num.check(nonnegative(), max(1_000_000)))),
    unit: Schema.optional(Schema.NullOr(Str.pipe(trim).check(maxLength(40)))),
    note: Schema.optional(Schema.NullOr(Str.pipe(trim).check(maxLength(300)))),
}).check(keyed((value) => Object.keys(value).length > 0, "server.validation.noChanges"));
export type UpdateShoppingItemRequest = Types.DeepMutable<typeof UpdateShoppingItemRequestSchema.Type>;

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
export const AddRecipeToShoppingListRequestSchema = Schema.Struct({
  recipeId: IdSchema,
  servings: Schema.optional(Num.check(positive(), max(1000))),
  ingredientIds: Schema.optional(Schema.Array(IdSchema).check(maxItems(500))),
  mutationId: Schema.optional(MutationIdSchema),
});
export type AddRecipeToShoppingListRequest = Types.DeepMutable<typeof AddRecipeToShoppingListRequestSchema.Type>;

/** Check off one item: it leaves the list and lands in "Häufig gekauft". */
export const CheckShoppingItemRequestSchema = Schema.Struct({
  mutationId: Schema.optional(MutationIdSchema),
});
export type CheckShoppingItemRequest = Types.DeepMutable<typeof CheckShoppingItemRequestSchema.Type>;

/** Hide or unhide one "Häufig gekauft" entry without losing its `useCount`. */
export const UpdateShoppingCatalogEntryRequestSchema = Schema.Struct({
  hidden: Bool,
});
export type UpdateShoppingCatalogEntryRequest = Types.DeepMutable<typeof UpdateShoppingCatalogEntryRequestSchema.Type>;

/** `GET …/shopping-lists/bought` query — the household-wide archive, `listId` optional. */
export const ShoppingBoughtListQuerySchema = Schema.Struct({
  ...PaginationQuerySchema.fields,
  listId: Schema.optional(IdSchema),
});
export type ShoppingBoughtListQuery = Types.DeepMutable<typeof ShoppingBoughtListQuerySchema.Type>;

/**
 * `GET …/shopping-lists/:listId/catalog` query. `includeHidden` is deliberately
 * NOT `z.coerce.boolean()` — that turns the string "0" into `true`, a live trap
 * for a query param (see `RecipeListQuerySchema.hasCooked` for the same rule).
 */
export const ShoppingCatalogListQuerySchema = Schema.Struct({
  ...PaginationQuerySchema.fields,
  includeHidden: Schema.optional(Enum(["0", "1"])).pipe(
    Schema.decodeTo(Bool, {
      decode: SchemaGetter.transformOptional((value) => Option.some(Option.getOrUndefined(value) === "1")),
      encode: SchemaGetter.transformOptional((value) => Option.map(value, (flag): "0" | "1" => (flag ? "1" : "0"))),
    }),
  ),
});
export type ShoppingCatalogListQuery = Types.DeepMutable<typeof ShoppingCatalogListQuerySchema.Type>;

/* -------------------------------- responses ------------------------------- */

export const ShoppingListResponseSchema = Schema.Struct({ list: ShoppingListSchema });
export type ShoppingListResponse = Types.DeepMutable<typeof ShoppingListResponseSchema.Type>;

export const ShoppingListListResponseSchema = Schema.Struct({
  items: Schema.Array(ShoppingListSchema),
});
export type ShoppingListListResponse = Types.DeepMutable<typeof ShoppingListListResponseSchema.Type>;

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
export const ShoppingListDetailResponseSchema = Schema.Struct({
  list: ShoppingListSchema,
  items: Schema.Array(ShoppingItemSchema),
  catalog: Schema.Array(ShoppingCatalogEntrySchema),
  bought: Schema.Array(ShoppingBoughtItemSchema),
  recipes: Schema.Array(ShoppingListRecipeSchema),
});
export type ShoppingListDetailResponse = Types.DeepMutable<typeof ShoppingListDetailResponseSchema.Type>;

/** `GET …/shopping-lists/bought` — the cross-list "Bought today" / history feed. */
export const ShoppingBoughtListResponseSchema = listResponse(ShoppingBoughtItemSchema);
export type ShoppingBoughtListResponse = Types.DeepMutable<typeof ShoppingBoughtListResponseSchema.Type>;

/** `GET …/shopping-lists/:listId/catalog` — the full "Häufig gekauft" sheet. */
export const ShoppingCatalogListResponseSchema = listResponse(ShoppingCatalogEntrySchema);
export type ShoppingCatalogListResponse = Types.DeepMutable<typeof ShoppingCatalogListResponseSchema.Type>;

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
export const PlanShoppingMissingIngredientSchema = Schema.Struct({
  id: IdSchema,
  name: Str,
  quantity: Schema.NullOr(Num),
  unit: Schema.NullOr(Str),
});
export type PlanShoppingMissingIngredient = Types.DeepMutable<typeof PlanShoppingMissingIngredientSchema.Type>;

export const PlanShoppingPreviewRecipeSchema = Schema.Struct({
  recipeId: IdSchema,
  title: Str,
  thumbnailUrl: Schema.NullOr(Str),
  /** Earliest planned day in the window, YYYY-MM-DD — the row's "Tue" label. */
  plannedOn: Str,
  /** Portions from the plan entry; null = the recipe's own count. */
  servings: Schema.NullOr(Num),
  ingredientTotal: Int.check(nonnegative()),
  /** Distinct merge keys not yet on the target list — the row's "9 ingredients". */
  missingCount: Int.check(nonnegative()),
  missingIngredientIds: Schema.Array(IdSchema),
  /**
   * The same rows as `missingIngredientIds`, with name and scaled amount, in recipe
   * order — so the picker can offer each line for unticking without a second fetch.
   */
  missingIngredients: Schema.Array(PlanShoppingMissingIngredientSchema),
});
export type PlanShoppingPreviewRecipe = Types.DeepMutable<typeof PlanShoppingPreviewRecipeSchema.Type>;

export const PlanShoppingPreviewResponseSchema = Schema.Struct({
  listId: IdSchema,
  listName: Str,
  from: Str,
  to: Str,
  /** Sum of the per-recipe missingCounts — the panel's "22 ingredients". */
  totalMissingCount: Int.check(nonnegative()),
  recipes: Schema.Array(PlanShoppingPreviewRecipeSchema),
});
export type PlanShoppingPreviewResponse = Types.DeepMutable<typeof PlanShoppingPreviewResponseSchema.Type>;
