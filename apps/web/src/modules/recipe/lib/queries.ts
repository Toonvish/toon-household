/**
 * The recipe module's TanStack Query keys, query options and invalidation helpers: R
 * `lib/queries.ts` §keys, §recipe query options and §recipe invalidation (R lines 109–175,
 * 261–415, 435–462, 465–501), built on the core key factory in `@/lib/queries`.
 *
 * Key layout (decision 8; the core layout is in `@/lib/queries`):
 *   ["toon","household",householdId,"recipe",<segment>,…]   <- one household's recipe data
 *   ["toon","recipe","cards"]                                <- user-owned, no household segment
 *   ["toon","recipe","shopping",<op>]                        <- shopping mutation keys (offline.ts)
 *
 * Fetchers come from `./api`; a prefix invalidates a whole subtree, so `invalidate.recipes`
 * refreshes every mounted recipe page of one household.
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { ImportDraftListQuery, MealPlanRangeQuery, RecipeListQuery } from "@toon/shared";
import {
  filterKey,
  invalidate as coreInvalidate,
  queryKeys as coreQueryKeys,
  STALE_TIME,
} from "@/lib/queries";
import {
  fetchCards,
  fetchCollection,
  fetchCollections,
  fetchImportDraft,
  fetchImportDrafts,
  fetchLastPlanned,
  fetchPlanRange,
  fetchPlanShoppingPreview,
  fetchRecipe,
  fetchRecipes,
  fetchScaledRecipe,
  fetchShoppingBoughtHistory,
  fetchShoppingCatalogPage,
  fetchShoppingList,
  fetchShoppingLists,
  fetchTags,
  type ShoppingBoughtHistoryQuery,
  type ShoppingCatalogPageQuery,
} from "./api";

export * from "@/lib/queries";

const ROOT = "toon" as const;

/* -------------------------------------------------------------------------- */
/* keys                                                                       */
/* -------------------------------------------------------------------------- */

export const queryKeys = {
  ...coreQueryKeys,

  recipes: (householdId: string, query?: Partial<RecipeListQuery>) =>
    [ROOT, "household", householdId, "recipe", "recipes", filterKey(query)] as const,
  recipesRoot: (householdId: string) => [ROOT, "household", householdId, "recipe", "recipes"] as const,
  recipe: (householdId: string, recipeId: string) =>
    [ROOT, "household", householdId, "recipe", "recipe", recipeId] as const,
  recipeScale: (householdId: string, recipeId: string, servings: number) =>
    [ROOT, "household", householdId, "recipe", "recipe", recipeId, "scale", servings] as const,

  tags: (householdId: string) => [ROOT, "household", householdId, "recipe", "tags"] as const,
  collections: (householdId: string) => [ROOT, "household", householdId, "recipe", "collections"] as const,
  collection: (householdId: string, collectionId: string) =>
    [ROOT, "household", householdId, "recipe", "collection", collectionId] as const,

  importDrafts: (householdId: string, query?: Partial<ImportDraftListQuery>) =>
    [ROOT, "household", householdId, "recipe", "imports", filterKey(query)] as const,
  importDraftsRoot: (householdId: string) => [ROOT, "household", householdId, "recipe", "imports"] as const,
  importDraft: (householdId: string, draftId: string) =>
    [ROOT, "household", householdId, "recipe", "import", draftId] as const,

  /**
   * Saved cards. NOT under `household` — a card belongs to the user, so it must stay
   * in the cache when the active household is switched (and the per-user namespacing
   * of the persisted blob is what keeps it off a shared phone's other account).
   */
  cards: () => [ROOT, "recipe", "cards"] as const,

  shoppingLists: (householdId: string) => [ROOT, "household", householdId, "recipe", "shopping-lists"] as const,
  shoppingList: (householdId: string, listId: string) =>
    [ROOT, "household", householdId, "recipe", "shopping-list", listId] as const,

  /**
   * The meal planner. `planRoot` is the prefix `invalidateAfterPlanMutation`
   * invalidates — every range fetched for the household hangs off it, so moving an
   * entry between two ranges refreshes both without knowing which ones are mounted.
   */
  planRoot: (householdId: string) => [ROOT, "household", householdId, "recipe", "plan"] as const,
  plan: (householdId: string, range: { from: string; to: string }) =>
    [ROOT, "household", householdId, "recipe", "plan", filterKey(range)] as const,
  /** Under `planRoot`, so every plan mutation refreshes it and it persists with the week. */
  planLastPlanned: (householdId: string, before: string) =>
    [ROOT, "household", householdId, "recipe", "plan", "last-planned", before] as const,

  /**
   * "From this week's plan" (the shopping list's own read of the planner) — segment
   * `"plan-shopping"` on purpose, distinct from `"plan"`: R24 persists the planner's
   * own range reads but NOT this one, since its only affordance is an online-only
   * bulk add and a restored diff would draw an `Add` button that cannot run.
   */
  planShopping: (householdId: string, listId: string) =>
    [ROOT, "household", householdId, "recipe", "plan-shopping", listId] as const,

  /**
   * The cross-list "Bought today" / history feed. Segment `"shopping-bought"` is
   * what `PERSISTED_GROUP_SEGMENTS` (lib/persist.ts) allow-lists — it sits on the
   * already-offline `/shopping` screen, so leaving it unpersisted would be a
   * spinner that never resolves.
   */
  boughtHistory: (householdId: string, query?: ShoppingBoughtHistoryQuery) =>
    [ROOT, "household", householdId, "recipe", "shopping-bought", filterKey(query)] as const,

  /**
   * The full "Häufig gekauft" sheet (`Show all`). Segment `"shopping-catalog"` is
   * deliberately NOT on the persist allow-list — a sheet opened on demand, not the
   * always-visible chip row (which comes from the list detail payload instead).
   */
  catalogPage: (householdId: string, listId: string, query?: ShoppingCatalogPageQuery) =>
    [ROOT, "household", householdId, "recipe", "shopping-catalog", listId, filterKey(query)] as const,
} as const;

/* -------------------------------------------------------------------------- */
/* query options                                                              */
/* -------------------------------------------------------------------------- */

export const recipesQuery = (householdId: string, query: Partial<RecipeListQuery> = {}) =>
  queryOptions({
    queryKey: queryKeys.recipes(householdId, query),
    queryFn: ({ signal }) => fetchRecipes(householdId, query, { signal }),
    staleTime: STALE_TIME.list,
  });

export const recipeQuery = (householdId: string, recipeId: string) =>
  queryOptions({
    queryKey: queryKeys.recipe(householdId, recipeId),
    queryFn: ({ signal }) => fetchRecipe(householdId, recipeId, { signal }),
    staleTime: STALE_TIME.detail,
  });

export const recipeScaleQuery = (householdId: string, recipeId: string, servings: number) =>
  queryOptions({
    queryKey: queryKeys.recipeScale(householdId, recipeId, servings),
    queryFn: ({ signal }) => fetchScaledRecipe(householdId, recipeId, servings, { signal }),
    staleTime: STALE_TIME.detail,
  });

export const tagsQuery = (householdId: string) =>
  queryOptions({
    queryKey: queryKeys.tags(householdId),
    queryFn: ({ signal }) => fetchTags(householdId, { signal }),
    staleTime: STALE_TIME.meta,
  });

export const collectionsQuery = (householdId: string) =>
  queryOptions({
    queryKey: queryKeys.collections(householdId),
    queryFn: ({ signal }) => fetchCollections(householdId, { signal }),
    staleTime: STALE_TIME.meta,
  });

export const collectionQuery = (householdId: string, collectionId: string) =>
  queryOptions({
    queryKey: queryKeys.collection(householdId, collectionId),
    queryFn: ({ signal }) => fetchCollection(householdId, collectionId, { signal }),
    staleTime: STALE_TIME.detail,
  });

export const importDraftsQuery = (
  householdId: string,
  query: Partial<ImportDraftListQuery> = {},
) =>
  queryOptions({
    queryKey: queryKeys.importDrafts(householdId, query),
    queryFn: ({ signal }) => fetchImportDrafts(householdId, query, { signal }),
    staleTime: STALE_TIME.list,
  });

export const importDraftQuery = (householdId: string, draftId: string) =>
  queryOptions({
    queryKey: queryKeys.importDraft(householdId, draftId),
    queryFn: ({ signal }) => fetchImportDraft(householdId, draftId, { signal }),
    /** A draft is edited locally; don't fight the form with background refetches. */
    staleTime: Infinity,
  });

/**
 * The user's saved cards.
 *
 * `networkMode: "offlineFirst"` for the same reason the shopping list has it: the
 * screen this feeds is used at a till, where the phone may have no signal at all,
 * and the persisted copy is the whole point of saving a card in the app. Writes
 * are online-only (see modules/recipe/features/cards/lib/queries.ts) — only reading works offline.
 */
export const cardsQuery = () =>
  queryOptions({
    queryKey: queryKeys.cards(),
    queryFn: ({ signal }) => fetchCards({ signal }),
    staleTime: STALE_TIME.meta,
    networkMode: "offlineFirst",
  });

export const shoppingListsQuery = (householdId: string) =>
  queryOptions({
    queryKey: queryKeys.shoppingLists(householdId),
    queryFn: ({ signal }) => fetchShoppingLists(householdId, { signal }),
    staleTime: STALE_TIME.list,
  });

/**
 * One shopping list with its items and suggestions.
 *
 * `networkMode: "offlineFirst"` so a cold start in a supermarket basement renders the
 * persisted copy instead of sitting in `pending` forever — the mutations that go with
 * it queue the same way (modules/recipe/features/shopping/lib/offline.ts).
 *
 * `staleTime: 0`: a shared list is the one thing in this app another person changes
 * while you are looking at it, so every remount refetches.
 */
export const shoppingListQuery = (householdId: string, listId: string) =>
  queryOptions({
    queryKey: queryKeys.shoppingList(householdId, listId),
    queryFn: ({ signal }) => fetchShoppingList(householdId, listId, { signal }),
    staleTime: 0,
    networkMode: "offlineFirst",
  });

/**
 * A week (or other bounded range) of the meal planner. `offlineFirst`, same reason
 * as the shopping list: the library's week strip is on a screen that has to survive
 * a cold start with no signal.
 */
export const planQuery = (householdId: string, range: MealPlanRangeQuery) =>
  queryOptions({
    queryKey: queryKeys.plan(householdId, range),
    queryFn: ({ signal }) => fetchPlanRange(householdId, range, { signal }),
    staleTime: STALE_TIME.list,
    networkMode: "offlineFirst",
  });

/** The recipe picker's "Zuletzt geplant" dates for the day being planned. */
export const lastPlannedQuery = (householdId: string, before: string) =>
  queryOptions({
    queryKey: queryKeys.planLastPlanned(householdId, before),
    queryFn: ({ signal }) => fetchLastPlanned(householdId, before, { signal }),
    staleTime: STALE_TIME.list,
    networkMode: "offlineFirst",
  });

/**
 * "From this week's plan" — a server-computed diff against ONE list. Deliberately
 * the default (online) network mode, not `offlineFirst`: its only affordance is a
 * bulk add that cannot run offline anyway (R24), so there is nothing useful to
 * restore from a stale copy.
 */
export const planShoppingQuery = (householdId: string, listId: string, range: { from: string; to: string }) =>
  queryOptions({
    queryKey: queryKeys.planShopping(householdId, listId),
    queryFn: ({ signal }) => fetchPlanShoppingPreview(householdId, listId, range, { signal }),
    staleTime: STALE_TIME.list,
  });

/** The cross-list "Bought today" / history feed — the overview panel and `/shopping/history`. */
export const boughtHistoryQuery = (householdId: string, query: ShoppingBoughtHistoryQuery = {}) =>
  queryOptions({
    queryKey: queryKeys.boughtHistory(householdId, query),
    queryFn: ({ signal }) => fetchShoppingBoughtHistory(householdId, query, { signal }),
    staleTime: STALE_TIME.list,
  });

/** The full "Häufig gekauft" sheet (`Show all`). */
export const catalogPageQuery = (
  householdId: string,
  listId: string,
  query: ShoppingCatalogPageQuery = {},
) =>
  queryOptions({
    queryKey: queryKeys.catalogPage(householdId, listId, query),
    queryFn: ({ signal }) => fetchShoppingCatalogPage(householdId, listId, query, { signal }),
    staleTime: STALE_TIME.list,
  });

/* -------------------------------------------------------------------------- */
/* invalidation helpers                                                       */
/* -------------------------------------------------------------------------- */

export const invalidate = {
  ...coreInvalidate,
  recipes: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.recipesRoot(householdId) }),
  recipe: (qc: QueryClient, householdId: string, recipeId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.recipe(householdId, recipeId) }),
  tags: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.tags(householdId) }),
  collections: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.collections(householdId) }),
  collection: (qc: QueryClient, householdId: string, collectionId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.collection(householdId, collectionId) }),
  importDrafts: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.importDraftsRoot(householdId) }),
  importDraft: (qc: QueryClient, householdId: string, draftId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.importDraft(householdId, draftId) }),
  cards: (qc: QueryClient) => qc.invalidateQueries({ queryKey: queryKeys.cards() }),
  shoppingLists: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.shoppingLists(householdId) }),
  shoppingList: (qc: QueryClient, householdId: string, listId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.shoppingList(householdId, listId) }),
  /** Every range fetched for the household — a prefix, so any mounted week refetches. */
  planRoot: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.planRoot(householdId) }),
  planShopping: (qc: QueryClient, householdId: string, listId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.planShopping(householdId, listId) }),
  boughtHistory: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: [ROOT, "household", householdId, "recipe", "shopping-bought"] }),
  catalogPage: (qc: QueryClient, householdId: string, listId: string) =>
    qc.invalidateQueries({ queryKey: [ROOT, "household", householdId, "recipe", "shopping-catalog", listId] }),
} as const;

/**
 * After creating/updating/deleting a recipe: refresh the lists, the recipe itself
 * and the tag/collection counts that depend on it.
 *
 * The household recipe count is the unfiltered `recipes` page of `useHouseholdRecipeCount` (plan
 * decision 13), refreshed by `invalidate.recipes`; `households` and `me` stay in this `Promise.all`
 * as in toon-recipe (ADR 0001 took `recipeCount` off them).
 */
export async function invalidateAfterRecipeMutation(
  qc: QueryClient,
  householdId: string,
  recipeId?: string,
): Promise<void> {
  await Promise.all([
    invalidate.recipes(qc, householdId),
    invalidate.tags(qc, householdId),
    invalidate.collections(qc, householdId),
    invalidate.households(qc),
    invalidate.me(qc),
    recipeId ? invalidate.recipe(qc, householdId, recipeId) : Promise.resolve(),
  ]);
}

/**
 * After creating/moving/deleting a plan entry: refresh every mounted range for the
 * household (`planRoot` is a prefix) and the shopping list's own "from this week's
 * plan" diff, which is stale the moment a recipe is added to or removed from the
 * week. Does NOT touch `invalidate.recipes` — planning a recipe does not change the
 * recipe itself, only the week it sits in.
 */
export async function invalidateAfterPlanMutation(qc: QueryClient, householdId: string): Promise<void> {
  await Promise.all([
    invalidate.planRoot(qc, householdId),
    qc.invalidateQueries({ queryKey: [ROOT, "household", householdId, "recipe", "plan-shopping"] }),
  ]);
}
