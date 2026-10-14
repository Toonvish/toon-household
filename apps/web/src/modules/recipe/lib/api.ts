/**
 * The recipe module's API functions: R `lib/api.ts` §recipes through §saved cards (R
 * lines 699–1496), re-homed under `/api/households/:householdId/recipe/…`, with user-owned
 * cards at `/api/recipe/cards`. The ONLY fetch is still `request` in `@/lib/api`; this file
 * adds no transport of its own.
 */
import { fileForm, queryString, request, type RequestOptions } from "@/lib/api";
import {
  type AddRecipeToShoppingListRequest,
  type AddShoppingItemsRequest,
  type CardListResponse,
  type CardResponse,
  type CheckShoppingItemRequest,
  type CollectionDetailResponse,
  type CollectionListResponse,
  type CollectionResponse,
  type CommitImportDraftRequest,
  type CommitImportDraftResponse,
  type CreateCardRequest,
  type CreateCollectionRequest,
  type CreateMealPlanEntryRequest,
  type CreateRecipeRequest,
  type CreateShoppingListRequest,
  type CreateTagRequest,
  type ImportDraftListQuery,
  type ImportDraftListResponse,
  type ImportDraftResponse,
  type ImportTextRequest,
  type ImportUrlRequest,
  type LastPlannedResponse,
  type MarkCookedRequest,
  type MealPlanEntryResponse,
  type MealPlanRangeQuery,
  type MealPlanRangeResponse,
  type PaginationQuery,
  type PlanShoppingPreviewResponse,
  type RecipeCookedResponse,
  type RecipeListQuery,
  type RecipeListResponse,
  type RecipeResponse,
  type ScaledRecipeResponse,
  type ShoppingBoughtListResponse,
  type ShoppingCatalogListResponse,
  type ShoppingListDetailResponse,
  type ShoppingListListResponse,
  type ShoppingListResponse,
  type TagListResponse,
  type TagResponse,
  type UpdateCardRequest,
  type UpdateCollectionRequest,
  type UpdateImportDraftRequest,
  type UpdateMealPlanEntryRequest,
  type UpdateRecipeRequest,
  type UpdateShoppingCatalogEntryRequest,
  type UpdateShoppingItemRequest,
  type UpdateShoppingListRequest,
  type UpdateTagRequest,
  type UploadResponse,
} from "@toon/shared";

export * from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* recipes                                                                    */
/* -------------------------------------------------------------------------- */

export function fetchRecipes(
  householdId: string,
  query: Partial<RecipeListQuery> = {},
  options?: RequestOptions,
): Promise<RecipeListResponse> {
  return request<RecipeListResponse>(
    `/api/households/${householdId}/recipe/recipes${queryString({
      q: query.q,
      tags: query.tags,
      collectionId: query.collectionId,
      maxMinutes: query.maxMinutes,
      difficulty: query.difficulty,
      // The wire form is the string `"1"`/`"0"`, never a boolean: the schema is
      // `z.enum(["0","1"])` on purpose (`z.coerce.boolean()` reads `"0"` as true),
      // so `String(false)` would be rejected outright and `String(true)` with it.
      hasCooked:
        query.hasCooked === undefined ? undefined : query.hasCooked ? "1" : "0",
      sort: query.sort,
      limit: query.limit,
      offset: query.offset,
    })}`,
    options,
  );
}

export function createRecipe(
  householdId: string,
  body: CreateRecipeRequest,
  options?: RequestOptions,
): Promise<RecipeResponse> {
  return request<RecipeResponse>(`/api/households/${householdId}/recipe/recipes`, {
    ...options,
    method: "POST",
    body,
  });
}

export function fetchRecipe(
  householdId: string,
  recipeId: string,
  options?: RequestOptions,
): Promise<RecipeResponse> {
  return request<RecipeResponse>(`/api/households/${householdId}/recipe/recipes/${recipeId}`, options);
}

export function updateRecipe(
  householdId: string,
  recipeId: string,
  body: UpdateRecipeRequest,
  options?: RequestOptions,
): Promise<RecipeResponse> {
  return request<RecipeResponse>(`/api/households/${householdId}/recipe/recipes/${recipeId}`, {
    ...options,
    method: "PATCH",
    body,
  });
}

export function deleteRecipe(
  householdId: string,
  recipeId: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`/api/households/${householdId}/recipe/recipes/${recipeId}`, {
    ...options,
    method: "DELETE",
  });
}

/** Recipe photo upload (camera or gallery). Max 15 MB, type sniffed server-side. */
export function uploadRecipeImage(
  householdId: string,
  recipeId: string,
  file: File,
  options?: RequestOptions,
): Promise<UploadResponse> {
  return request<UploadResponse>(`/api/households/${householdId}/recipe/recipes/${recipeId}/image`, {
    ...options,
    method: "POST",
    form: fileForm(file),
  });
}

/** Server-side scaling so client and server always agree on rounding. */
export function fetchScaledRecipe(
  householdId: string,
  recipeId: string,
  servings: number,
  options?: RequestOptions,
): Promise<ScaledRecipeResponse> {
  return request<ScaledRecipeResponse>(
    `/api/households/${householdId}/recipe/recipes/${recipeId}/scale${queryString({ servings })}`,
    options,
  );
}

/**
 * "Gekocht": appends a cook-log row, bumps `recipes.lastCookedAt` and — when the
 * recipe was on the plan that day — stamps the plan entry's `cookedAt` too. Body is
 * optional-everything, so a bare tap (`{}`) works.
 */
export function markRecipeCooked(
  householdId: string,
  recipeId: string,
  body: MarkCookedRequest = {},
  options?: RequestOptions,
): Promise<RecipeCookedResponse> {
  return request<RecipeCookedResponse>(`/api/households/${householdId}/recipe/recipes/${recipeId}/cooked`, {
    ...options,
    method: "POST",
    body,
  });
}

/**
 * Undoes the CALLER's own most recent "Gekocht" tap for this recipe, within the
 * server's short undo window. Recomputes `lastCookedAt` from what remains in the log.
 *
 * Answers **204, no body** (docs/API.md), so this resolves to `undefined` — the
 * caller refetches the recipe rather than reading a new `lastCookedAt` off the
 * response, because the recomputed value may be another member's cook.
 */
export function undoRecipeCooked(
  householdId: string,
  recipeId: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`/api/households/${householdId}/recipe/recipes/${recipeId}/cooked`, {
    ...options,
    method: "DELETE",
  });
}

/* -------------------------------------------------------------------------- */
/* tags                                                                       */
/* -------------------------------------------------------------------------- */

export function fetchTags(householdId: string, options?: RequestOptions): Promise<TagListResponse> {
  return request<TagListResponse>(`/api/households/${householdId}/recipe/tags`, options);
}

export function createTag(
  householdId: string,
  body: CreateTagRequest,
  options?: RequestOptions,
): Promise<TagResponse> {
  return request<TagResponse>(`/api/households/${householdId}/recipe/tags`, { ...options, method: "POST", body });
}

export function updateTag(
  householdId: string,
  tagId: string,
  body: UpdateTagRequest,
  options?: RequestOptions,
): Promise<TagResponse> {
  return request<TagResponse>(`/api/households/${householdId}/recipe/tags/${tagId}`, {
    ...options,
    method: "PATCH",
    body,
  });
}

export function deleteTag(
  householdId: string,
  tagId: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`/api/households/${householdId}/recipe/tags/${tagId}`, { ...options, method: "DELETE" });
}

/* -------------------------------------------------------------------------- */
/* collections                                                                */
/* -------------------------------------------------------------------------- */

export function fetchCollections(
  householdId: string,
  options?: RequestOptions,
): Promise<CollectionListResponse> {
  return request<CollectionListResponse>(`/api/households/${householdId}/recipe/collections`, options);
}

export function createCollection(
  householdId: string,
  body: CreateCollectionRequest,
  options?: RequestOptions,
): Promise<CollectionResponse> {
  return request<CollectionResponse>(`/api/households/${householdId}/recipe/collections`, {
    ...options,
    method: "POST",
    body,
  });
}

export function fetchCollection(
  householdId: string,
  collectionId: string,
  options?: RequestOptions,
): Promise<CollectionDetailResponse> {
  return request<CollectionDetailResponse>(
    `/api/households/${householdId}/recipe/collections/${collectionId}`,
    options,
  );
}

export function updateCollection(
  householdId: string,
  collectionId: string,
  body: UpdateCollectionRequest,
  options?: RequestOptions,
): Promise<CollectionResponse> {
  return request<CollectionResponse>(`/api/households/${householdId}/recipe/collections/${collectionId}`, {
    ...options,
    method: "PATCH",
    body,
  });
}

export function deleteCollection(
  householdId: string,
  collectionId: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`/api/households/${householdId}/recipe/collections/${collectionId}`, {
    ...options,
    method: "DELETE",
  });
}

/** One membership row: PUT adds it, DELETE removes it, both idempotent. */
function collectionRecipe(
  method: "PUT" | "DELETE",
  householdId: string,
  collectionId: string,
  recipeId: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`/api/households/${householdId}/recipe/collections/${collectionId}/recipes/${recipeId}`, {
    ...options,
    method,
  });
}

/** Idempotent. */
export function addRecipeToCollection(
  householdId: string,
  collectionId: string,
  recipeId: string,
  options?: RequestOptions,
): Promise<void> {
  return collectionRecipe("PUT", householdId, collectionId, recipeId, options);
}

export function removeRecipeFromCollection(
  householdId: string,
  collectionId: string,
  recipeId: string,
  options?: RequestOptions,
): Promise<void> {
  return collectionRecipe("DELETE", householdId, collectionId, recipeId, options);
}

/* -------------------------------------------------------------------------- */
/* meal planner ("Wochenplan")                                                */
/* -------------------------------------------------------------------------- */

/**
 * A flat, `(plannedOn, position)`-ordered range — never the `{ items, total, limit,
 * offset }` envelope, because a week is bounded by its own `from`/`to`, not a page.
 * `from`/`to` are `YYYY-MM-DD` calendar dates the CLIENT computed
 * (`packages/shared/src/calendar.ts`); the server never derives a date from its clock.
 */
export function fetchPlanRange(
  householdId: string,
  query: MealPlanRangeQuery,
  options?: RequestOptions,
): Promise<MealPlanRangeResponse> {
  return request<MealPlanRangeResponse>(
    `/api/households/${householdId}/recipe/plan${queryString({ from: query.from, to: query.to })}`,
    options,
  );
}

/** "Zuletzt geplant" — the latest day each recipe was planned strictly before `before`. */
export function fetchLastPlanned(
  householdId: string,
  before: string,
  options?: RequestOptions,
): Promise<LastPlannedResponse> {
  return request<LastPlannedResponse>(
    `/api/households/${householdId}/recipe/plan/last-planned${queryString({ before })}`,
    options,
  );
}

export function createPlanEntry(
  householdId: string,
  body: CreateMealPlanEntryRequest,
  options?: RequestOptions,
): Promise<MealPlanEntryResponse> {
  return request<MealPlanEntryResponse>(`/api/households/${householdId}/recipe/plan`, {
    ...options,
    method: "POST",
    body,
  });
}

/** Moving an entry to another day is a PATCH of `plannedOn` — that is the drag-and-drop. */
export function updatePlanEntry(
  householdId: string,
  entryId: string,
  body: UpdateMealPlanEntryRequest,
  options?: RequestOptions,
): Promise<MealPlanEntryResponse> {
  return request<MealPlanEntryResponse>(`/api/households/${householdId}/recipe/plan/${entryId}`, {
    ...options,
    method: "PATCH",
    body,
  });
}

export function deletePlanEntry(
  householdId: string,
  entryId: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`/api/households/${householdId}/recipe/plan/${entryId}`, {
    ...options,
    method: "DELETE",
  });
}

/* -------------------------------------------------------------------------- */
/* imports (every source produces an editable draft)                          */
/* -------------------------------------------------------------------------- */

export function importFromUrl(
  householdId: string,
  body: ImportUrlRequest,
  options?: RequestOptions,
): Promise<ImportDraftResponse> {
  return request<ImportDraftResponse>(`/api/households/${householdId}/recipe/imports/url`, {
    ...options,
    method: "POST",
    body,
  });
}

/** Photo of a recipe -> server-side OCR (sharp + native tesseract, deu+eng) -> draft. */
export function importFromImage(
  householdId: string,
  file: File,
  options?: RequestOptions,
): Promise<ImportDraftResponse> {
  return request<ImportDraftResponse>(`/api/households/${householdId}/recipe/imports/image`, {
    ...options,
    method: "POST",
    form: fileForm(file),
  });
}

/** PDF -> text layer first, rasterize + OCR as fallback -> draft. */
export function importFromPdf(
  householdId: string,
  file: File,
  options?: RequestOptions,
): Promise<ImportDraftResponse> {
  return request<ImportDraftResponse>(`/api/households/${householdId}/recipe/imports/pdf`, {
    ...options,
    method: "POST",
    form: fileForm(file),
  });
}

export function importFromText(
  householdId: string,
  body: ImportTextRequest,
  options?: RequestOptions,
): Promise<ImportDraftResponse> {
  return request<ImportDraftResponse>(`/api/households/${householdId}/recipe/imports/text`, {
    ...options,
    method: "POST",
    body,
  });
}

export function fetchImportDrafts(
  householdId: string,
  query: Partial<ImportDraftListQuery> = {},
  options?: RequestOptions,
): Promise<ImportDraftListResponse> {
  return request<ImportDraftListResponse>(
    `/api/households/${householdId}/recipe/imports${queryString({
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    })}`,
    options,
  );
}

export function fetchImportDraft(
  householdId: string,
  draftId: string,
  options?: RequestOptions,
): Promise<ImportDraftResponse> {
  return request<ImportDraftResponse>(`/api/households/${householdId}/recipe/imports/${draftId}`, options);
}

export function updateImportDraft(
  householdId: string,
  draftId: string,
  body: UpdateImportDraftRequest,
  options?: RequestOptions,
): Promise<ImportDraftResponse> {
  return request<ImportDraftResponse>(`/api/households/${householdId}/recipe/imports/${draftId}`, {
    ...options,
    method: "PATCH",
    body,
  });
}

/** "Speichern" in the review screen: writes the real recipe. */
export function commitImportDraft(
  householdId: string,
  draftId: string,
  body: CommitImportDraftRequest = {},
  options?: RequestOptions,
): Promise<CommitImportDraftResponse> {
  return request<CommitImportDraftResponse>(`/api/households/${householdId}/recipe/imports/${draftId}/commit`, {
    ...options,
    method: "POST",
    body,
  });
}

export function deleteImportDraft(
  householdId: string,
  draftId: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`/api/households/${householdId}/recipe/imports/${draftId}`, {
    ...options,
    method: "DELETE",
  });
}

/* -------------------------------------------------------------------------- */
/* shopping lists                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Every MUTATION below returns the whole `ShoppingListDetailResponse`, not just the
 * touched item. The caller writes that payload straight into the query cache, which is
 * what keeps an optimistic offline edit from drifting: merging means one added line can
 * change a different one, so a patch-in-place would be wrong.
 *
 * `mutationId` is a client-generated uuid that makes a replay after an offline spell
 * safe (the API remembers applied ids per list). Pass one for anything queued.
 */
function shoppingBase(householdId: string, listId?: string): string {
  const base = `/api/households/${householdId}/recipe/shopping-lists`;
  return listId === undefined ? base : `${base}/${listId}`;
}

export function fetchShoppingLists(
  householdId: string,
  options?: RequestOptions,
): Promise<ShoppingListListResponse> {
  return request<ShoppingListListResponse>(shoppingBase(householdId), options);
}

export function createShoppingList(
  householdId: string,
  body: CreateShoppingListRequest,
  options?: RequestOptions,
): Promise<ShoppingListResponse> {
  return request<ShoppingListResponse>(shoppingBase(householdId), {
    ...options,
    method: "POST",
    body,
  });
}

export function fetchShoppingList(
  householdId: string,
  listId: string,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return request<ShoppingListDetailResponse>(shoppingBase(householdId, listId), options);
}

export function updateShoppingList(
  householdId: string,
  listId: string,
  body: UpdateShoppingListRequest,
  options?: RequestOptions,
): Promise<ShoppingListResponse> {
  return request<ShoppingListResponse>(shoppingBase(householdId, listId), {
    ...options,
    method: "PATCH",
    body,
  });
}

export function deleteShoppingList(
  householdId: string,
  listId: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(shoppingBase(householdId, listId), { ...options, method: "DELETE" });
}

export function addShoppingItems(
  householdId: string,
  listId: string,
  body: AddShoppingItemsRequest,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return request<ShoppingListDetailResponse>(`${shoppingBase(householdId, listId)}/items`, {
    ...options,
    method: "POST",
    body,
  });
}

export function updateShoppingItem(
  householdId: string,
  listId: string,
  itemId: string,
  body: UpdateShoppingItemRequest,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return request<ShoppingListDetailResponse>(
    `${shoppingBase(householdId, listId)}/items/${itemId}`,
    { ...options, method: "PATCH", body },
  );
}

/** Removes a line without counting it as bought. Idempotent, so safe to replay. */
export function deleteShoppingItem(
  householdId: string,
  listId: string,
  itemId: string,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return request<ShoppingListDetailResponse>(
    `${shoppingBase(householdId, listId)}/items/${itemId}`,
    { ...options, method: "DELETE" },
  );
}

/** Checks a line off: it leaves the list and appears under "Häufig gekauft". */
export function checkShoppingItem(
  householdId: string,
  listId: string,
  itemId: string,
  body: CheckShoppingItemRequest = {},
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return request<ShoppingListDetailResponse>(
    `${shoppingBase(householdId, listId)}/items/${itemId}/check`,
    { ...options, method: "POST", body },
  );
}

export function clearShoppingList(
  householdId: string,
  listId: string,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return request<ShoppingListDetailResponse>(`${shoppingBase(householdId, listId)}/items`, {
    ...options,
    method: "DELETE",
  });
}

export function addRecipeToShoppingList(
  householdId: string,
  listId: string,
  body: AddRecipeToShoppingListRequest,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return request<ShoppingListDetailResponse>(`${shoppingBase(householdId, listId)}/recipes`, {
    ...options,
    method: "POST",
    body,
  });
}

/** Re-adds a "Häufig gekauft" suggestion, deliberately without an amount. */
export function addShoppingCatalogEntry(
  householdId: string,
  listId: string,
  entryId: string,
  body: CheckShoppingItemRequest = {},
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return request<ShoppingListDetailResponse>(
    `${shoppingBase(householdId, listId)}/catalog/${entryId}`,
    { ...options, method: "POST", body },
  );
}

/** "Nicht mehr vorschlagen". Idempotent. */
export function deleteShoppingCatalogEntry(
  householdId: string,
  listId: string,
  entryId: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`${shoppingBase(householdId, listId)}/catalog/${entryId}`, {
    ...options,
    method: "DELETE",
  });
}

/**
 * Hides or unhides a "Häufig gekauft" entry WITHOUT losing its `useCount` — the
 * long-press action the redesign replaces the per-chip `×` with. The existing
 * `deleteShoppingCatalogEntry` ("nicht mehr vorschlagen") stays as it is; this is a
 * different, reversible action.
 */
export function setShoppingCatalogEntryHidden(
  householdId: string,
  listId: string,
  entryId: string,
  body: UpdateShoppingCatalogEntryRequest,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return request<ShoppingListDetailResponse>(
    `${shoppingBase(householdId, listId)}/catalog/${entryId}`,
    { ...options, method: "PATCH", body },
  );
}

/** `GET …/shopping-lists/:listId/catalog` query — the "Show all" sheet. */
export type ShoppingCatalogPageQuery = Partial<PaginationQuery> & {
  includeHidden?: boolean;
};

/** The full "Häufig gekauft" sheet — every entry, hidden ones included on request. */
export function fetchShoppingCatalogPage(
  householdId: string,
  listId: string,
  query: ShoppingCatalogPageQuery = {},
  options?: RequestOptions,
): Promise<ShoppingCatalogListResponse> {
  return request<ShoppingCatalogListResponse>(
    `${shoppingBase(householdId, listId)}/catalog${queryString({
      includeHidden: query.includeHidden ? 1 : undefined,
      limit: query.limit,
      offset: query.offset,
    })}`,
    options,
  );
}

/**
 * `GET …/shopping-lists/bought` — the cross-list "Bought today" / history feed.
 * `listId` omitted means the whole household, which is what the overview panel wants.
 */
export type ShoppingBoughtHistoryQuery = Partial<PaginationQuery> & {
  listId?: string;
};

export function fetchShoppingBoughtHistory(
  householdId: string,
  query: ShoppingBoughtHistoryQuery = {},
  options?: RequestOptions,
): Promise<ShoppingBoughtListResponse> {
  return request<ShoppingBoughtListResponse>(
    `/api/households/${householdId}/recipe/shopping-lists/bought${queryString({
      listId: query.listId,
      limit: query.limit,
      offset: query.offset,
    })}`,
    options,
  );
}

/**
 * `Clear bought`: stamps the per-list watermark. The log itself is never deleted —
 * the history panel reads past the watermark, so nothing bought is forgotten.
 */
export function clearBoughtSection(
  householdId: string,
  listId: string,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return request<ShoppingListDetailResponse>(`${shoppingBase(householdId, listId)}/bought/clear`, {
    ...options,
    method: "POST",
  });
}

/**
 * Undoes one "Bought today" row: deletes the log row and re-merges the amount back
 * onto the list (folding into whatever is already there under the same
 * `(name, unit)` bucket — nothing is lost, nothing is invented).
 */
export function undoBoughtItem(
  householdId: string,
  listId: string,
  boughtId: string,
  body: CheckShoppingItemRequest = {},
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return request<ShoppingListDetailResponse>(
    `${shoppingBase(householdId, listId)}/bought/${boughtId}/undo`,
    { ...options, method: "POST", body },
  );
}

/**
 * Removes a recipe from "Recipes on this list". Deletes only the ingredient lines
 * that came SOLELY from this recipe; a line still shared with another recipe on the
 * list keeps its quantity unchanged. Online-only — never queued (see
 * features/shopping/lib/offline.ts): a bulk delete replayed against a list the user
 * can no longer see is exactly the class the offline outbox excludes.
 */
export function removeRecipeFromShoppingList(
  householdId: string,
  listId: string,
  recipeId: string,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return request<ShoppingListDetailResponse>(
    `${shoppingBase(householdId, listId)}/recipes/${recipeId}`,
    { ...options, method: "DELETE" },
  );
}

/**
 * "From this week's plan": which planned recipes are missing from this list, and by
 * how much. `from`/`to` are both required `YYYY-MM-DD` calendar dates — the server
 * never guesses where a week starts; the client sends `localWeekRange(new Date())`.
 */
export function fetchPlanShoppingPreview(
  householdId: string,
  listId: string,
  range: { from: string; to: string },
  options?: RequestOptions,
): Promise<PlanShoppingPreviewResponse> {
  return request<PlanShoppingPreviewResponse>(
    `${shoppingBase(householdId, listId)}/from-plan${queryString({ from: range.from, to: range.to })}`,
    options,
  );
}

/* -------------------------------------------------------------------------- */
/* saved cards (loyalty barcodes — the user's own, NOT a household's)              */
/* -------------------------------------------------------------------------- */

/**
 * The wallet, most recently used first.
 *
 * Note the missing `householdId`: cards belong to the signed-in user, so these five
 * calls are the only content endpoints in this file with no household in their path
 * (see packages/shared/src/schemas/card.ts for why).
 */
export function fetchCards(options?: RequestOptions): Promise<CardListResponse> {
  return request<CardListResponse>("/api/recipe/cards", options);
}

export function createCard(
  body: CreateCardRequest,
  options?: RequestOptions,
): Promise<CardResponse> {
  return request<CardResponse>("/api/recipe/cards", { ...options, method: "POST", body });
}

export function updateCard(
  cardId: string,
  body: UpdateCardRequest,
  options?: RequestOptions,
): Promise<CardResponse> {
  return request<CardResponse>(`/api/recipe/cards/${cardId}`, { ...options, method: "PATCH", body });
}

export function deleteCard(cardId: string, options?: RequestOptions): Promise<void> {
  return request<void>(`/api/recipe/cards/${cardId}`, { ...options, method: "DELETE" });
}

/**
 * Records that a card was SHOWN — what the wallet's ordering is built on.
 *
 * Fire-and-forget at every call site: it is a 403 for an account with an
 * unconfirmed address and a network error at a till with no signal, and neither
 * may stop the barcode from being on screen.
 */
export function markCardUsed(cardId: string, options?: RequestOptions): Promise<CardResponse> {
  return request<CardResponse>(`/api/recipe/cards/${cardId}/used`, { ...options, method: "POST" });
}

