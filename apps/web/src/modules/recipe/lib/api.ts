/**
 * The recipe module's API: R `lib/api.ts` §recipes through §saved cards (R lines 699-1496), re-homed under
 * `/api/households/:householdId/recipe/...`, with user-owned cards at `/api/recipe/cards`.
 *
 * Every endpoint is a member of {@link RecipeApi} (docs/EFFECT.md E11; plan docs/plans/e6-web-client.md P8):
 * an Effect over the helpers of `@/lib/api` (`getJson`, `sendJson`, `sendForm`, `sendVoid`), which go through
 * the `ApiClient` service on the web's one runtime and decode the response with the shared
 * `...ResponseSchema` (structure and types only, P7). The exported functions below keep their names,
 * signatures and `Promise` results as facades over `runPromise`; this file adds no transport of its own.
 * Ids are interpolated RAW into the paths (behaviour frozen, unlike the core client's `seg()`).
 */
import {
  getJson,
  queryString,
  sendForm,
  sendJson,
  sendVoid,
  type RequestOptions,
} from "@/lib/api";
import { runPromise } from "@/lib/runtime";
import {
  CardListResponseSchema,
  CardResponseSchema,
  CollectionDetailResponseSchema,
  CollectionListResponseSchema,
  CollectionResponseSchema,
  CommitImportDraftResponseSchema,
  ImportDraftListResponseSchema,
  ImportDraftResponseSchema,
  LastPlannedResponseSchema,
  MealPlanEntryResponseSchema,
  MealPlanRangeResponseSchema,
  PlanShoppingPreviewResponseSchema,
  RecipeCookedResponseSchema,
  RecipeListResponseSchema,
  RecipeResponseSchema,
  ScaledRecipeResponseSchema,
  ShoppingBoughtListResponseSchema,
  ShoppingCatalogListResponseSchema,
  ShoppingListDetailResponseSchema,
  ShoppingListListResponseSchema,
  ShoppingListResponseSchema,
  TagListResponseSchema,
  TagResponseSchema,
  UploadResponseSchema,
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

/** `GET …/shopping-lists/:listId/catalog` query — the "Show all" sheet. */
export type ShoppingCatalogPageQuery = Partial<PaginationQuery> & {
  includeHidden?: boolean;
};

/**
 * `GET …/shopping-lists/bought` — the cross-list "Bought today" / history feed.
 * `listId` omitted means the whole household, which is what the overview panel wants.
 */
export type ShoppingBoughtHistoryQuery = Partial<PaginationQuery> & {
  listId?: string;
};

/**
 * Every shopping mutation returns the whole `ShoppingListDetailResponse`, not just the touched item. The caller
 * writes that payload straight into the query cache, which is what keeps an optimistic offline edit from
 * drifting: merging means one added line can change a different one, so a patch-in-place would be wrong.
 *
 * `mutationId` is a client-generated uuid that makes a replay after an offline spell safe (the API remembers
 * applied ids per list). Pass one for anything queued.
 */
function shoppingBase(householdId: string, listId?: string): string {
  const base = `/api/households/${householdId}/recipe/shopping-lists`;
  return listId === undefined ? base : `${base}/${listId}`;
}

/** One membership row: PUT adds it, DELETE removes it, both idempotent. */
function collectionRecipe(
  method: "PUT" | "DELETE",
  householdId: string,
  collectionId: string,
  recipeId: string,
  options?: RequestOptions,
) {
  return sendVoid(
    method,
    `/api/households/${householdId}/recipe/collections/${collectionId}/recipes/${recipeId}`,
    undefined,
    options,
  );
}

/* -------------------------------------------------------------------------- */
/* the recipe endpoints, described once                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every recipe request as an Effect (plan e6 P8): the member name is the facade's name, the parameters are the
 * facade's without the signal, and only `allowUnauthorized` is read from `options`. Members are arrow
 * functions: nothing is read at definition (P16). Writes pass a mismatching response through (P7a); only a
 * READ fails with `invalid_response`.
 */
export const RecipeApi = {
  /* recipes */

  fetchRecipes: (
    householdId: string,
    query: Partial<RecipeListQuery> = {},
    options?: RequestOptions,
  ) =>
    getJson(
      RecipeListResponseSchema,
      `/api/households/${householdId}/recipe/recipes${queryString({
        q: query.q,
        tags: query.tags,
        collectionId: query.collectionId,
        maxMinutes: query.maxMinutes,
        difficulty: query.difficulty,
        // The wire form is the string `"1"`/`"0"`, never a boolean: the schema is a literal union on purpose
        // (a boolean coercion reads `"0"` as true), so `String(false)` would be rejected outright and
        // `String(true)` with it.
        hasCooked: query.hasCooked === undefined ? undefined : query.hasCooked ? "1" : "0",
        sort: query.sort,
        limit: query.limit,
        offset: query.offset,
      })}`,
      options,
    ),

  createRecipe: (householdId: string, body: CreateRecipeRequest, options?: RequestOptions) =>
    sendJson("POST", RecipeResponseSchema, `/api/households/${householdId}/recipe/recipes`, body, options),

  fetchRecipe: (householdId: string, recipeId: string, options?: RequestOptions) =>
    getJson(RecipeResponseSchema, `/api/households/${householdId}/recipe/recipes/${recipeId}`, options),

  updateRecipe: (householdId: string, recipeId: string, body: UpdateRecipeRequest, options?: RequestOptions) =>
    sendJson(
      "PATCH",
      RecipeResponseSchema,
      `/api/households/${householdId}/recipe/recipes/${recipeId}`,
      body,
      options,
    ),

  deleteRecipe: (householdId: string, recipeId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/households/${householdId}/recipe/recipes/${recipeId}`, undefined, options),

  uploadRecipeImage: (householdId: string, recipeId: string, file: File, options?: RequestOptions) =>
    sendForm(
      UploadResponseSchema,
      `/api/households/${householdId}/recipe/recipes/${recipeId}/image`,
      file,
      options,
    ),

  fetchScaledRecipe: (householdId: string, recipeId: string, servings: number, options?: RequestOptions) =>
    getJson(
      ScaledRecipeResponseSchema,
      `/api/households/${householdId}/recipe/recipes/${recipeId}/scale${queryString({ servings })}`,
      options,
    ),

  markRecipeCooked: (
    householdId: string,
    recipeId: string,
    body: MarkCookedRequest = {},
    options?: RequestOptions,
  ) =>
    sendJson(
      "POST",
      RecipeCookedResponseSchema,
      `/api/households/${householdId}/recipe/recipes/${recipeId}/cooked`,
      body,
      options,
    ),

  undoRecipeCooked: (householdId: string, recipeId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/households/${householdId}/recipe/recipes/${recipeId}/cooked`, undefined, options),

  /* tags */

  fetchTags: (householdId: string, options?: RequestOptions) =>
    getJson(TagListResponseSchema, `/api/households/${householdId}/recipe/tags`, options),

  createTag: (householdId: string, body: CreateTagRequest, options?: RequestOptions) =>
    sendJson("POST", TagResponseSchema, `/api/households/${householdId}/recipe/tags`, body, options),

  updateTag: (householdId: string, tagId: string, body: UpdateTagRequest, options?: RequestOptions) =>
    sendJson("PATCH", TagResponseSchema, `/api/households/${householdId}/recipe/tags/${tagId}`, body, options),

  deleteTag: (householdId: string, tagId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/households/${householdId}/recipe/tags/${tagId}`, undefined, options),

  /* collections */

  fetchCollections: (householdId: string, options?: RequestOptions) =>
    getJson(CollectionListResponseSchema, `/api/households/${householdId}/recipe/collections`, options),

  createCollection: (householdId: string, body: CreateCollectionRequest, options?: RequestOptions) =>
    sendJson(
      "POST",
      CollectionResponseSchema,
      `/api/households/${householdId}/recipe/collections`,
      body,
      options,
    ),

  fetchCollection: (householdId: string, collectionId: string, options?: RequestOptions) =>
    getJson(
      CollectionDetailResponseSchema,
      `/api/households/${householdId}/recipe/collections/${collectionId}`,
      options,
    ),

  updateCollection: (
    householdId: string,
    collectionId: string,
    body: UpdateCollectionRequest,
    options?: RequestOptions,
  ) =>
    sendJson(
      "PATCH",
      CollectionResponseSchema,
      `/api/households/${householdId}/recipe/collections/${collectionId}`,
      body,
      options,
    ),

  deleteCollection: (householdId: string, collectionId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/households/${householdId}/recipe/collections/${collectionId}`, undefined, options),

  addRecipeToCollection: (
    householdId: string,
    collectionId: string,
    recipeId: string,
    options?: RequestOptions,
  ) => collectionRecipe("PUT", householdId, collectionId, recipeId, options),

  removeRecipeFromCollection: (
    householdId: string,
    collectionId: string,
    recipeId: string,
    options?: RequestOptions,
  ) => collectionRecipe("DELETE", householdId, collectionId, recipeId, options),

  /* meal planner ("Wochenplan") */

  fetchPlanRange: (householdId: string, query: MealPlanRangeQuery, options?: RequestOptions) =>
    getJson(
      MealPlanRangeResponseSchema,
      `/api/households/${householdId}/recipe/plan${queryString({ from: query.from, to: query.to })}`,
      options,
    ),

  fetchLastPlanned: (householdId: string, before: string, options?: RequestOptions) =>
    getJson(
      LastPlannedResponseSchema,
      `/api/households/${householdId}/recipe/plan/last-planned${queryString({ before })}`,
      options,
    ),

  createPlanEntry: (householdId: string, body: CreateMealPlanEntryRequest, options?: RequestOptions) =>
    sendJson(
      "POST",
      MealPlanEntryResponseSchema,
      `/api/households/${householdId}/recipe/plan`,
      body,
      options,
    ),

  updatePlanEntry: (
    householdId: string,
    entryId: string,
    body: UpdateMealPlanEntryRequest,
    options?: RequestOptions,
  ) =>
    sendJson(
      "PATCH",
      MealPlanEntryResponseSchema,
      `/api/households/${householdId}/recipe/plan/${entryId}`,
      body,
      options,
    ),

  deletePlanEntry: (householdId: string, entryId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/households/${householdId}/recipe/plan/${entryId}`, undefined, options),

  /* imports (every source produces an editable draft) */

  importFromUrl: (householdId: string, body: ImportUrlRequest, options?: RequestOptions) =>
    sendJson(
      "POST",
      ImportDraftResponseSchema,
      `/api/households/${householdId}/recipe/imports/url`,
      body,
      options,
    ),

  importFromImage: (householdId: string, file: File, options?: RequestOptions) =>
    sendForm(ImportDraftResponseSchema, `/api/households/${householdId}/recipe/imports/image`, file, options),

  importFromPdf: (householdId: string, file: File, options?: RequestOptions) =>
    sendForm(ImportDraftResponseSchema, `/api/households/${householdId}/recipe/imports/pdf`, file, options),

  importFromText: (householdId: string, body: ImportTextRequest, options?: RequestOptions) =>
    sendJson(
      "POST",
      ImportDraftResponseSchema,
      `/api/households/${householdId}/recipe/imports/text`,
      body,
      options,
    ),

  fetchImportDrafts: (
    householdId: string,
    query: Partial<ImportDraftListQuery> = {},
    options?: RequestOptions,
  ) =>
    getJson(
      ImportDraftListResponseSchema,
      `/api/households/${householdId}/recipe/imports${queryString({
        status: query.status,
        limit: query.limit,
        offset: query.offset,
      })}`,
      options,
    ),

  fetchImportDraft: (householdId: string, draftId: string, options?: RequestOptions) =>
    getJson(ImportDraftResponseSchema, `/api/households/${householdId}/recipe/imports/${draftId}`, options),

  updateImportDraft: (
    householdId: string,
    draftId: string,
    body: UpdateImportDraftRequest,
    options?: RequestOptions,
  ) =>
    sendJson(
      "PATCH",
      ImportDraftResponseSchema,
      `/api/households/${householdId}/recipe/imports/${draftId}`,
      body,
      options,
    ),

  commitImportDraft: (
    householdId: string,
    draftId: string,
    body: CommitImportDraftRequest = {},
    options?: RequestOptions,
  ) =>
    sendJson(
      "POST",
      CommitImportDraftResponseSchema,
      `/api/households/${householdId}/recipe/imports/${draftId}/commit`,
      body,
      options,
    ),

  deleteImportDraft: (householdId: string, draftId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/households/${householdId}/recipe/imports/${draftId}`, undefined, options),

  /* shopping lists */

  fetchShoppingLists: (householdId: string, options?: RequestOptions) =>
    getJson(ShoppingListListResponseSchema, shoppingBase(householdId), options),

  createShoppingList: (householdId: string, body: CreateShoppingListRequest, options?: RequestOptions) =>
    sendJson("POST", ShoppingListResponseSchema, shoppingBase(householdId), body, options),

  fetchShoppingList: (householdId: string, listId: string, options?: RequestOptions) =>
    getJson(ShoppingListDetailResponseSchema, shoppingBase(householdId, listId), options),

  updateShoppingList: (
    householdId: string,
    listId: string,
    body: UpdateShoppingListRequest,
    options?: RequestOptions,
  ) => sendJson("PATCH", ShoppingListResponseSchema, shoppingBase(householdId, listId), body, options),

  deleteShoppingList: (householdId: string, listId: string, options?: RequestOptions) =>
    sendVoid("DELETE", shoppingBase(householdId, listId), undefined, options),

  addShoppingItems: (
    householdId: string,
    listId: string,
    body: AddShoppingItemsRequest,
    options?: RequestOptions,
  ) =>
    sendJson(
      "POST",
      ShoppingListDetailResponseSchema,
      `${shoppingBase(householdId, listId)}/items`,
      body,
      options,
    ),

  updateShoppingItem: (
    householdId: string,
    listId: string,
    itemId: string,
    body: UpdateShoppingItemRequest,
    options?: RequestOptions,
  ) =>
    sendJson(
      "PATCH",
      ShoppingListDetailResponseSchema,
      `${shoppingBase(householdId, listId)}/items/${itemId}`,
      body,
      options,
    ),

  deleteShoppingItem: (householdId: string, listId: string, itemId: string, options?: RequestOptions) =>
    sendJson(
      "DELETE",
      ShoppingListDetailResponseSchema,
      `${shoppingBase(householdId, listId)}/items/${itemId}`,
      undefined,
      options,
    ),

  checkShoppingItem: (
    householdId: string,
    listId: string,
    itemId: string,
    body: CheckShoppingItemRequest = {},
    options?: RequestOptions,
  ) =>
    sendJson(
      "POST",
      ShoppingListDetailResponseSchema,
      `${shoppingBase(householdId, listId)}/items/${itemId}/check`,
      body,
      options,
    ),

  clearShoppingList: (householdId: string, listId: string, options?: RequestOptions) =>
    sendJson(
      "DELETE",
      ShoppingListDetailResponseSchema,
      `${shoppingBase(householdId, listId)}/items`,
      undefined,
      options,
    ),

  addRecipeToShoppingList: (
    householdId: string,
    listId: string,
    body: AddRecipeToShoppingListRequest,
    options?: RequestOptions,
  ) =>
    sendJson(
      "POST",
      ShoppingListDetailResponseSchema,
      `${shoppingBase(householdId, listId)}/recipes`,
      body,
      options,
    ),

  addShoppingCatalogEntry: (
    householdId: string,
    listId: string,
    entryId: string,
    body: CheckShoppingItemRequest = {},
    options?: RequestOptions,
  ) =>
    sendJson(
      "POST",
      ShoppingListDetailResponseSchema,
      `${shoppingBase(householdId, listId)}/catalog/${entryId}`,
      body,
      options,
    ),

  deleteShoppingCatalogEntry: (householdId: string, listId: string, entryId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `${shoppingBase(householdId, listId)}/catalog/${entryId}`, undefined, options),

  setShoppingCatalogEntryHidden: (
    householdId: string,
    listId: string,
    entryId: string,
    body: UpdateShoppingCatalogEntryRequest,
    options?: RequestOptions,
  ) =>
    sendJson(
      "PATCH",
      ShoppingListDetailResponseSchema,
      `${shoppingBase(householdId, listId)}/catalog/${entryId}`,
      body,
      options,
    ),

  fetchShoppingCatalogPage: (
    householdId: string,
    listId: string,
    query: ShoppingCatalogPageQuery = {},
    options?: RequestOptions,
  ) =>
    getJson(
      ShoppingCatalogListResponseSchema,
      `${shoppingBase(householdId, listId)}/catalog${queryString({
        includeHidden: query.includeHidden ? 1 : undefined,
        limit: query.limit,
        offset: query.offset,
      })}`,
      options,
    ),

  fetchShoppingBoughtHistory: (
    householdId: string,
    query: ShoppingBoughtHistoryQuery = {},
    options?: RequestOptions,
  ) =>
    getJson(
      ShoppingBoughtListResponseSchema,
      `/api/households/${householdId}/recipe/shopping-lists/bought${queryString({
        listId: query.listId,
        limit: query.limit,
        offset: query.offset,
      })}`,
      options,
    ),

  clearBoughtSection: (householdId: string, listId: string, options?: RequestOptions) =>
    sendJson(
      "POST",
      ShoppingListDetailResponseSchema,
      `${shoppingBase(householdId, listId)}/bought/clear`,
      undefined,
      options,
    ),

  undoBoughtItem: (
    householdId: string,
    listId: string,
    boughtId: string,
    body: CheckShoppingItemRequest = {},
    options?: RequestOptions,
  ) =>
    sendJson(
      "POST",
      ShoppingListDetailResponseSchema,
      `${shoppingBase(householdId, listId)}/bought/${boughtId}/undo`,
      body,
      options,
    ),

  removeRecipeFromShoppingList: (
    householdId: string,
    listId: string,
    recipeId: string,
    options?: RequestOptions,
  ) =>
    sendJson(
      "DELETE",
      ShoppingListDetailResponseSchema,
      `${shoppingBase(householdId, listId)}/recipes/${recipeId}`,
      undefined,
      options,
    ),

  fetchPlanShoppingPreview: (
    householdId: string,
    listId: string,
    range: { from: string; to: string },
    options?: RequestOptions,
  ) =>
    getJson(
      PlanShoppingPreviewResponseSchema,
      `${shoppingBase(householdId, listId)}/from-plan${queryString({ from: range.from, to: range.to })}`,
      options,
    ),

  /* saved cards (loyalty barcodes: the user's own, NOT a household's) */

  fetchCards: (options?: RequestOptions) => getJson(CardListResponseSchema, "/api/recipe/cards", options),

  createCard: (body: CreateCardRequest, options?: RequestOptions) =>
    sendJson("POST", CardResponseSchema, "/api/recipe/cards", body, options),

  updateCard: (cardId: string, body: UpdateCardRequest, options?: RequestOptions) =>
    sendJson("PATCH", CardResponseSchema, `/api/recipe/cards/${cardId}`, body, options),

  deleteCard: (cardId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/recipe/cards/${cardId}`, undefined, options),

  markCardUsed: (cardId: string, options?: RequestOptions) =>
    sendJson("POST", CardResponseSchema, `/api/recipe/cards/${cardId}/used`, undefined, options),
};

/* -------------------------------------------------------------------------- */
/* recipes                                                                    */
/* -------------------------------------------------------------------------- */

export function fetchRecipes(
  householdId: string,
  query: Partial<RecipeListQuery> = {},
  options?: RequestOptions,
): Promise<RecipeListResponse> {
  return runPromise(RecipeApi.fetchRecipes(householdId, query, options), options);
}

export function createRecipe(
  householdId: string,
  body: CreateRecipeRequest,
  options?: RequestOptions,
): Promise<RecipeResponse> {
  return runPromise(RecipeApi.createRecipe(householdId, body, options), options);
}

export function fetchRecipe(
  householdId: string,
  recipeId: string,
  options?: RequestOptions,
): Promise<RecipeResponse> {
  return runPromise(RecipeApi.fetchRecipe(householdId, recipeId, options), options);
}

export function updateRecipe(
  householdId: string,
  recipeId: string,
  body: UpdateRecipeRequest,
  options?: RequestOptions,
): Promise<RecipeResponse> {
  return runPromise(RecipeApi.updateRecipe(householdId, recipeId, body, options), options);
}

export function deleteRecipe(
  householdId: string,
  recipeId: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(RecipeApi.deleteRecipe(householdId, recipeId, options), options);
}

/**
 * Recipe photo upload (camera or gallery). Max 15 MB, type sniffed server-side. An oversized file REJECTS
 * with `payload_too_large` (plan e6 P11, deviation D2: it used to throw synchronously).
 */
export function uploadRecipeImage(
  householdId: string,
  recipeId: string,
  file: File,
  options?: RequestOptions,
): Promise<UploadResponse> {
  return runPromise(RecipeApi.uploadRecipeImage(householdId, recipeId, file, options), options);
}

/** Server-side scaling so client and server always agree on rounding. */
export function fetchScaledRecipe(
  householdId: string,
  recipeId: string,
  servings: number,
  options?: RequestOptions,
): Promise<ScaledRecipeResponse> {
  return runPromise(RecipeApi.fetchScaledRecipe(householdId, recipeId, servings, options), options);
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
  return runPromise(RecipeApi.markRecipeCooked(householdId, recipeId, body, options), options);
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
  return runPromise(RecipeApi.undoRecipeCooked(householdId, recipeId, options), options);
}

/* -------------------------------------------------------------------------- */
/* tags                                                                       */
/* -------------------------------------------------------------------------- */

export function fetchTags(householdId: string, options?: RequestOptions): Promise<TagListResponse> {
  return runPromise(RecipeApi.fetchTags(householdId, options), options);
}

export function createTag(
  householdId: string,
  body: CreateTagRequest,
  options?: RequestOptions,
): Promise<TagResponse> {
  return runPromise(RecipeApi.createTag(householdId, body, options), options);
}

export function updateTag(
  householdId: string,
  tagId: string,
  body: UpdateTagRequest,
  options?: RequestOptions,
): Promise<TagResponse> {
  return runPromise(RecipeApi.updateTag(householdId, tagId, body, options), options);
}

export function deleteTag(
  householdId: string,
  tagId: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(RecipeApi.deleteTag(householdId, tagId, options), options);
}

/* -------------------------------------------------------------------------- */
/* collections                                                                */
/* -------------------------------------------------------------------------- */

export function fetchCollections(
  householdId: string,
  options?: RequestOptions,
): Promise<CollectionListResponse> {
  return runPromise(RecipeApi.fetchCollections(householdId, options), options);
}

export function createCollection(
  householdId: string,
  body: CreateCollectionRequest,
  options?: RequestOptions,
): Promise<CollectionResponse> {
  return runPromise(RecipeApi.createCollection(householdId, body, options), options);
}

export function fetchCollection(
  householdId: string,
  collectionId: string,
  options?: RequestOptions,
): Promise<CollectionDetailResponse> {
  return runPromise(RecipeApi.fetchCollection(householdId, collectionId, options), options);
}

export function updateCollection(
  householdId: string,
  collectionId: string,
  body: UpdateCollectionRequest,
  options?: RequestOptions,
): Promise<CollectionResponse> {
  return runPromise(RecipeApi.updateCollection(householdId, collectionId, body, options), options);
}

export function deleteCollection(
  householdId: string,
  collectionId: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(RecipeApi.deleteCollection(householdId, collectionId, options), options);
}

/** Idempotent. */
export function addRecipeToCollection(
  householdId: string,
  collectionId: string,
  recipeId: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(RecipeApi.addRecipeToCollection(householdId, collectionId, recipeId, options), options);
}

export function removeRecipeFromCollection(
  householdId: string,
  collectionId: string,
  recipeId: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(RecipeApi.removeRecipeFromCollection(householdId, collectionId, recipeId, options), options);
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
  return runPromise(RecipeApi.fetchPlanRange(householdId, query, options), options);
}

/** "Zuletzt geplant" — the latest day each recipe was planned strictly before `before`. */
export function fetchLastPlanned(
  householdId: string,
  before: string,
  options?: RequestOptions,
): Promise<LastPlannedResponse> {
  return runPromise(RecipeApi.fetchLastPlanned(householdId, before, options), options);
}

export function createPlanEntry(
  householdId: string,
  body: CreateMealPlanEntryRequest,
  options?: RequestOptions,
): Promise<MealPlanEntryResponse> {
  return runPromise(RecipeApi.createPlanEntry(householdId, body, options), options);
}

/** Moving an entry to another day is a PATCH of `plannedOn` — that is the drag-and-drop. */
export function updatePlanEntry(
  householdId: string,
  entryId: string,
  body: UpdateMealPlanEntryRequest,
  options?: RequestOptions,
): Promise<MealPlanEntryResponse> {
  return runPromise(RecipeApi.updatePlanEntry(householdId, entryId, body, options), options);
}

export function deletePlanEntry(
  householdId: string,
  entryId: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(RecipeApi.deletePlanEntry(householdId, entryId, options), options);
}

/* -------------------------------------------------------------------------- */
/* imports (every source produces an editable draft)                          */
/* -------------------------------------------------------------------------- */

export function importFromUrl(
  householdId: string,
  body: ImportUrlRequest,
  options?: RequestOptions,
): Promise<ImportDraftResponse> {
  return runPromise(RecipeApi.importFromUrl(householdId, body, options), options);
}

/** Photo of a recipe -> server-side OCR (sharp + native tesseract, deu+eng) -> draft. */
export function importFromImage(
  householdId: string,
  file: File,
  options?: RequestOptions,
): Promise<ImportDraftResponse> {
  return runPromise(RecipeApi.importFromImage(householdId, file, options), options);
}

/** PDF -> text layer first, rasterize + OCR as fallback -> draft. */
export function importFromPdf(
  householdId: string,
  file: File,
  options?: RequestOptions,
): Promise<ImportDraftResponse> {
  return runPromise(RecipeApi.importFromPdf(householdId, file, options), options);
}

export function importFromText(
  householdId: string,
  body: ImportTextRequest,
  options?: RequestOptions,
): Promise<ImportDraftResponse> {
  return runPromise(RecipeApi.importFromText(householdId, body, options), options);
}

export function fetchImportDrafts(
  householdId: string,
  query: Partial<ImportDraftListQuery> = {},
  options?: RequestOptions,
): Promise<ImportDraftListResponse> {
  return runPromise(RecipeApi.fetchImportDrafts(householdId, query, options), options);
}

export function fetchImportDraft(
  householdId: string,
  draftId: string,
  options?: RequestOptions,
): Promise<ImportDraftResponse> {
  return runPromise(RecipeApi.fetchImportDraft(householdId, draftId, options), options);
}

export function updateImportDraft(
  householdId: string,
  draftId: string,
  body: UpdateImportDraftRequest,
  options?: RequestOptions,
): Promise<ImportDraftResponse> {
  return runPromise(RecipeApi.updateImportDraft(householdId, draftId, body, options), options);
}

/** "Speichern" in the review screen: writes the real recipe. */
export function commitImportDraft(
  householdId: string,
  draftId: string,
  body: CommitImportDraftRequest = {},
  options?: RequestOptions,
): Promise<CommitImportDraftResponse> {
  return runPromise(RecipeApi.commitImportDraft(householdId, draftId, body, options), options);
}

export function deleteImportDraft(
  householdId: string,
  draftId: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(RecipeApi.deleteImportDraft(householdId, draftId, options), options);
}

/* -------------------------------------------------------------------------- */
/* shopping lists                                                             */
/* -------------------------------------------------------------------------- */

export function fetchShoppingLists(
  householdId: string,
  options?: RequestOptions,
): Promise<ShoppingListListResponse> {
  return runPromise(RecipeApi.fetchShoppingLists(householdId, options), options);
}

export function createShoppingList(
  householdId: string,
  body: CreateShoppingListRequest,
  options?: RequestOptions,
): Promise<ShoppingListResponse> {
  return runPromise(RecipeApi.createShoppingList(householdId, body, options), options);
}

export function fetchShoppingList(
  householdId: string,
  listId: string,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return runPromise(RecipeApi.fetchShoppingList(householdId, listId, options), options);
}

export function updateShoppingList(
  householdId: string,
  listId: string,
  body: UpdateShoppingListRequest,
  options?: RequestOptions,
): Promise<ShoppingListResponse> {
  return runPromise(RecipeApi.updateShoppingList(householdId, listId, body, options), options);
}

export function deleteShoppingList(
  householdId: string,
  listId: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(RecipeApi.deleteShoppingList(householdId, listId, options), options);
}

export function addShoppingItems(
  householdId: string,
  listId: string,
  body: AddShoppingItemsRequest,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return runPromise(RecipeApi.addShoppingItems(householdId, listId, body, options), options);
}

export function updateShoppingItem(
  householdId: string,
  listId: string,
  itemId: string,
  body: UpdateShoppingItemRequest,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return runPromise(RecipeApi.updateShoppingItem(householdId, listId, itemId, body, options), options);
}

/** Removes a line without counting it as bought. Idempotent, so safe to replay. */
export function deleteShoppingItem(
  householdId: string,
  listId: string,
  itemId: string,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return runPromise(RecipeApi.deleteShoppingItem(householdId, listId, itemId, options), options);
}

/** Checks a line off: it leaves the list and appears under "Häufig gekauft". */
export function checkShoppingItem(
  householdId: string,
  listId: string,
  itemId: string,
  body: CheckShoppingItemRequest = {},
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return runPromise(RecipeApi.checkShoppingItem(householdId, listId, itemId, body, options), options);
}

export function clearShoppingList(
  householdId: string,
  listId: string,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return runPromise(RecipeApi.clearShoppingList(householdId, listId, options), options);
}

export function addRecipeToShoppingList(
  householdId: string,
  listId: string,
  body: AddRecipeToShoppingListRequest,
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return runPromise(RecipeApi.addRecipeToShoppingList(householdId, listId, body, options), options);
}

/** Re-adds a "Häufig gekauft" suggestion, deliberately without an amount. */
export function addShoppingCatalogEntry(
  householdId: string,
  listId: string,
  entryId: string,
  body: CheckShoppingItemRequest = {},
  options?: RequestOptions,
): Promise<ShoppingListDetailResponse> {
  return runPromise(RecipeApi.addShoppingCatalogEntry(householdId, listId, entryId, body, options), options);
}

/** "Nicht mehr vorschlagen". Idempotent. */
export function deleteShoppingCatalogEntry(
  householdId: string,
  listId: string,
  entryId: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(RecipeApi.deleteShoppingCatalogEntry(householdId, listId, entryId, options), options);
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
  return runPromise(
    RecipeApi.setShoppingCatalogEntryHidden(householdId, listId, entryId, body, options),
    options,
  );
}

/** The full "Häufig gekauft" sheet — every entry, hidden ones included on request. */
export function fetchShoppingCatalogPage(
  householdId: string,
  listId: string,
  query: ShoppingCatalogPageQuery = {},
  options?: RequestOptions,
): Promise<ShoppingCatalogListResponse> {
  return runPromise(RecipeApi.fetchShoppingCatalogPage(householdId, listId, query, options), options);
}

export function fetchShoppingBoughtHistory(
  householdId: string,
  query: ShoppingBoughtHistoryQuery = {},
  options?: RequestOptions,
): Promise<ShoppingBoughtListResponse> {
  return runPromise(RecipeApi.fetchShoppingBoughtHistory(householdId, query, options), options);
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
  return runPromise(RecipeApi.clearBoughtSection(householdId, listId, options), options);
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
  return runPromise(RecipeApi.undoBoughtItem(householdId, listId, boughtId, body, options), options);
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
  return runPromise(RecipeApi.removeRecipeFromShoppingList(householdId, listId, recipeId, options), options);
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
  return runPromise(RecipeApi.fetchPlanShoppingPreview(householdId, listId, range, options), options);
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
  return runPromise(RecipeApi.fetchCards(options), options);
}

export function createCard(
  body: CreateCardRequest,
  options?: RequestOptions,
): Promise<CardResponse> {
  return runPromise(RecipeApi.createCard(body, options), options);
}

export function updateCard(
  cardId: string,
  body: UpdateCardRequest,
  options?: RequestOptions,
): Promise<CardResponse> {
  return runPromise(RecipeApi.updateCard(cardId, body, options), options);
}

export function deleteCard(cardId: string, options?: RequestOptions): Promise<void> {
  return runPromise(RecipeApi.deleteCard(cardId, options), options);
}

/**
 * Records that a card was SHOWN — what the wallet's ordering is built on.
 *
 * Fire-and-forget at every call site: it is a 403 for an account with an
 * unconfirmed address and a network error at a till with no signal, and neither
 * may stop the barcode from being on screen.
 */
export function markCardUsed(cardId: string, options?: RequestOptions): Promise<CardResponse> {
  return runPromise(RecipeApi.markCardUsed(cardId, options), options);
}
