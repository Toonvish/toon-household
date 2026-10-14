/**
 * Recipe mutations + the infinite list query.
 *
 * Read queries reuse the shell's `queryOptions` factories and key layout from
 * `@/lib/queries` so cache invalidation stays consistent across features.
 * The list endpoint is paginated (`{items,total,limit,offset}`), which `queryOptions`
 * cannot express, so the infinite variant is built here on the SAME key prefix.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateRecipeRequest,
  Difficulty,
  RecipeDetail,
  RecipeListItem,
  RecipeListResponse,
  RecipeSort,
  UpdateRecipeRequest,
  UploadResponse,
} from "@toon/shared";
import { createRecipe, deleteRecipe, fetchRecipes, updateRecipe, uploadRecipeImage } from "@/modules/recipe/lib/api";
import { translate } from "@/lib/i18n";
import {
  invalidate,
  invalidateAfterRecipeMutation,
  queryKeys,
  recipeQuery,
  recipeScaleQuery,
  recipesQuery,
  STALE_TIME,
} from "@/modules/recipe/lib/queries";

export const RECIPE_PAGE_SIZE = 24;

/** UI-side filter state of the recipe list screen. */
export interface RecipeListFilters {
  q?: string;
  /** Tag ids — sent to the API as a comma-separated list; a recipe must carry all. */
  tagIds?: readonly string[];
  collectionId?: string;
  maxMinutes?: number;
  difficulty?: Difficulty;
  sort?: RecipeSort;
  limit?: number;
}

/** Filters in the wire shape the API and the query key expect. */
function toQuery(filters: RecipeListFilters) {
  return {
    q: filters.q && filters.q.trim().length > 0 ? filters.q.trim() : undefined,
    tags: filters.tagIds && filters.tagIds.length > 0 ? [...filters.tagIds].sort().join(",") : undefined,
    collectionId: filters.collectionId,
    maxMinutes: filters.maxMinutes,
    difficulty: filters.difficulty,
    sort: filters.sort ?? ("newest" as RecipeSort),
    limit: filters.limit ?? RECIPE_PAGE_SIZE,
  };
}

export type RecipePage = RecipeListResponse;

/**
 * Paginated recipe list ("Mehr laden" advances `offset`).
 * The key is the shell's `queryKeys.recipes(householdId, filters)`, so
 * `invalidate.recipes(qc, householdId)` refreshes it.
 */
export function useRecipeList(householdId: string | null, filters: RecipeListFilters) {
  const wire = toQuery(filters);
  return useInfiniteQuery<RecipePage, Error, { pages: RecipePage[] }, readonly unknown[], number>({
    queryKey: householdId ? queryKeys.recipes(householdId, wire) : ["toon", "recipe", "recipes", "disabled"],
    enabled: householdId !== null,
    staleTime: STALE_TIME.list,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchRecipes(householdId ?? "", { ...wire, offset: pageParam }, { signal }),
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.items.length;
      return next < lastPage.total ? next : undefined;
    },
  });
}

/** Flattens the infinite-query pages into one list. */
export function flattenPages(data: { pages: RecipePage[] } | undefined): RecipeListItem[] {
  if (!data) return [];
  return data.pages.flatMap((page) => page.items);
}

export function totalCount(data: { pages: RecipePage[] } | undefined): number {
  return data?.pages[0]?.total ?? 0;
}

/**
 * The household's recipe count for the library subtitle (`recipe.recipes.list.groupSummary`,
 * `recipe.count.recipes`). ADR 0001 took `recipeCount` off `HouseholdWithRole` — the core never
 * counts a module's rows — so the module asks its own list endpoint: an UNFILTERED page of one
 * whose `total` is the count. The key sits under `recipesRoot`, so `invalidate.recipes`
 * refreshes it after every recipe mutation. `undefined` until known.
 */
export function useHouseholdRecipeCount(householdId: string | null): number | undefined {
  const { data } = useQuery({
    ...recipesQuery(householdId ?? "", { limit: 1 }),
    enabled: householdId !== null,
  });
  return data?.total;
}

/** Recipe detail. Unwraps `{ recipe }` so screens deal with `RecipeDetail`. */
export function useRecipe(householdId: string | null, recipeId: string | undefined) {
  const options = recipeQuery(householdId ?? "", recipeId ?? "");
  return useQuery({
    ...options,
    enabled: householdId !== null && recipeId !== undefined && recipeId.length > 0,
    select: (response) => response.recipe,
  });
}

/**
 * Server-side scaler. The detail screen scales locally with `scaleIngredients` for the
 * live stepper (no round-trip per tap); this hook is used where the server's rounding is
 * authoritative, e.g. before copying a scaled list.
 */
export function useScaledRecipe(
  householdId: string | null,
  recipeId: string | undefined,
  servings: number | undefined,
  enabled = true,
) {
  const options = recipeScaleQuery(householdId ?? "", recipeId ?? "", servings ?? 1);
  return useQuery({
    ...options,
    enabled:
      enabled &&
      householdId !== null &&
      recipeId !== undefined &&
      typeof servings === "number" &&
      servings > 0,
  });
}

export function useCreateRecipe(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<RecipeDetail, Error, CreateRecipeRequest>({
    mutationFn: async (input) => {
      const response = await createRecipe(householdId ?? "", input);
      return response.recipe;
    },
    onSuccess: async (recipe) => {
      if (!householdId) return;
      client.setQueryData(queryKeys.recipe(householdId, recipe.id), { recipe });
      await invalidateAfterRecipeMutation(client, householdId, recipe.id);
    },
  });
}

export interface UpdateRecipeInput extends UpdateRecipeRequest {
  /**
   * Overrides the id bound when the hook was created. Needed right after a create,
   * where the new id is not in React state yet.
   */
  recipeId?: string;
}

export function useUpdateRecipe(householdId: string | null, recipeId?: string) {
  const client = useQueryClient();
  return useMutation<RecipeDetail, Error, UpdateRecipeInput>({
    mutationFn: async ({ recipeId: override, ...patch }) => {
      const target = override ?? recipeId;
      // Internal invariant, never shown as-is to a user (a real 403/404 from the
      // API would surface first) — plain English, not a catalog key, same as
      // other dev-facing assertions in this codebase.
      if (!target) throw new Error("useUpdateRecipe: no recipeId provided.");
      const response = await updateRecipe(householdId ?? "", target, patch);
      return response.recipe;
    },
    onSuccess: async (recipe) => {
      if (!householdId) return;
      client.setQueryData(queryKeys.recipe(householdId, recipe.id), { recipe });
      await invalidateAfterRecipeMutation(client, householdId, recipe.id);
    },
  });
}

export function useDeleteRecipe(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (recipeId) => deleteRecipe(householdId ?? "", recipeId),
    onSuccess: async (_result, recipeId) => {
      if (!householdId) return;
      client.removeQueries({ queryKey: queryKeys.recipe(householdId, recipeId) });
      await invalidateAfterRecipeMutation(client, householdId);
    },
  });
}

export interface UploadRecipeImageInput {
  recipeId: string;
  file: File;
}

export function useUploadRecipeImage(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<UploadResponse, Error, UploadRecipeImageInput>({
    mutationFn: ({ recipeId, file }) => uploadRecipeImage(householdId ?? "", recipeId, file),
    onSuccess: async (_result, { recipeId }) => {
      if (!householdId) return;
      await Promise.all([
        invalidate.recipe(client, householdId, recipeId),
        invalidate.recipes(client, householdId),
      ]);
    },
  });
}

/**
 * Payload for "Duplicate" — everything except identity and timestamps.
 * The " (Kopie)" suffix is UI copy at the moment it is produced and plain
 * content afterwards (docs/i18n.md §0's borderline rule), so it reads the
 * ambient locale via `translate()` — this is a plain function, not a component.
 */
export function duplicatePayload(recipe: RecipeDetail): CreateRecipeRequest {
  return {
    title: translate("recipe.recipes.duplicateSuffix", { title: recipe.title }),
    description: recipe.description ?? null,
    imageUrl: recipe.imageUrl ?? null,
    sourceUrl: recipe.sourceUrl ?? null,
    sourceName: recipe.sourceName ?? null,
    servingsAmount: recipe.servingsAmount ?? null,
    servingsUnit: recipe.servingsUnit ?? null,
    prepMinutes: recipe.prepMinutes ?? null,
    cookMinutes: recipe.cookMinutes ?? null,
    totalMinutes: recipe.totalMinutes ?? null,
    difficulty: recipe.difficulty ?? null,
    rating: recipe.rating ?? null,
    notes: recipe.notes ?? null,
    language: recipe.language ?? null,
    ingredients: recipe.ingredients.map((ingredient, index) => ({
      position: index,
      section: ingredient.section ?? null,
      quantity: ingredient.quantity ?? null,
      quantityMax: ingredient.quantityMax ?? null,
      unit: ingredient.unit ?? null,
      name: ingredient.name,
      note: ingredient.note ?? null,
      raw: ingredient.raw,
    })),
    steps: recipe.steps.map((step, index) => ({
      position: index,
      section: step.section ?? null,
      text: step.text,
    })),
    tags: recipe.tags.map((tag) => tag.name),
    collectionIds: [...recipe.collectionIds],
  };
}
