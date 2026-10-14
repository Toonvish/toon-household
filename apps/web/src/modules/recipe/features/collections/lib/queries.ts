/** TanStack Query hooks for collections ("Sammlungen"). Keys come from `@/lib/queries`. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Collection, CreateCollectionRequest, UpdateCollectionRequest } from "@toon/shared";
import {
  addRecipeToCollection,
  createCollection,
  deleteCollection,
  removeRecipeFromCollection,
  updateCollection,
} from "@/modules/recipe/lib/api";
import { collectionQuery, collectionsQuery, invalidate } from "@/modules/recipe/lib/queries";

/** Collections of the active household, unwrapped to `Collection[]`. */
export function useCollections(householdId: string | null) {
  const options = collectionsQuery(householdId ?? "");
  return useQuery({
    ...options,
    enabled: householdId !== null,
    select: (response) => response.items,
  });
}

/** One collection plus its recipes. */
export function useCollection(householdId: string | null, collectionId: string | undefined) {
  const options = collectionQuery(householdId ?? "", collectionId ?? "");
  return useQuery({
    ...options,
    enabled: householdId !== null && collectionId !== undefined && collectionId.length > 0,
  });
}

export function useCreateCollection(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<Collection, Error, CreateCollectionRequest>({
    mutationFn: async (input) => {
      const response = await createCollection(householdId ?? "", input);
      return response.collection;
    },
    onSuccess: async () => {
      if (householdId) await invalidate.collections(client, householdId);
    },
  });
}

export interface UpdateCollectionInput extends UpdateCollectionRequest {
  collectionId: string;
}

export function useUpdateCollection(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<Collection, Error, UpdateCollectionInput>({
    mutationFn: async ({ collectionId, ...patch }) => {
      const response = await updateCollection(householdId ?? "", collectionId, patch);
      return response.collection;
    },
    onSuccess: async (collection) => {
      if (!householdId) return;
      await Promise.all([
        invalidate.collections(client, householdId),
        invalidate.collection(client, householdId, collection.id),
      ]);
    },
  });
}

export function useDeleteCollection(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (collectionId) => deleteCollection(householdId ?? "", collectionId),
    onSuccess: async (_result, collectionId) => {
      if (!householdId) return;
      await Promise.all([
        invalidate.collections(client, householdId),
        invalidate.collection(client, householdId, collectionId),
        invalidate.recipes(client, householdId),
      ]);
    },
  });
}

export interface CollectionRecipeInput {
  collectionId: string;
  recipeId: string;
}

/**
 * Adding and removing touch the same three caches — the collection itself, the
 * list (its recipe count), and the recipe (its `collectionIds`). Keeping one copy
 * is what stops the two from drifting; the reorder loop below fires both, so a
 * cache one of them forgets shows up as a half-stale screen after a drag.
 */
function invalidateMembership(
  client: ReturnType<typeof useQueryClient>,
  householdId: string,
  collectionId: string,
  recipeId: string,
): Promise<unknown> {
  return Promise.all([
    invalidate.collection(client, householdId, collectionId),
    invalidate.collections(client, householdId),
    invalidate.recipe(client, householdId, recipeId),
  ]);
}

/** PUT is idempotent per the contract, so "add" can be fired repeatedly. */
export function useAddRecipeToCollection(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<void, Error, CollectionRecipeInput>({
    mutationFn: ({ collectionId, recipeId }) =>
      addRecipeToCollection(householdId ?? "", collectionId, recipeId),
    onSuccess: async (_result, { collectionId, recipeId }) => {
      if (!householdId) return;
      await invalidateMembership(client, householdId, collectionId, recipeId);
    },
  });
}

export function useRemoveRecipeFromCollection(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<void, Error, CollectionRecipeInput>({
    mutationFn: ({ collectionId, recipeId }) =>
      removeRecipeFromCollection(householdId ?? "", collectionId, recipeId),
    onSuccess: async (_result, { collectionId, recipeId }) => {
      if (!householdId) return;
      await invalidateMembership(client, householdId, collectionId, recipeId);
    },
  });
}

export interface ReorderCollectionInput {
  collectionId: string;
  /** The COMPLETE ordered list of recipe ids in the collection. */
  recipeIds: readonly string[];
}

/**
 * Reordering.
 *
 * CONTRACT GAP: there is no "set position" endpoint. `collection_recipes.position` is
 * assigned by the API on insert, so the only way for a client to express an order is to
 * remove every membership and re-add them in the desired sequence — hence `recipeIds`
 * must be the complete ordered list. Isolated here so a future dedicated endpoint
 * changes exactly one function.
 */
export function useReorderCollectionRecipes(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<void, Error, ReorderCollectionInput>({
    mutationFn: async ({ collectionId, recipeIds }) => {
      const group = householdId ?? "";
      for (const recipeId of recipeIds) {
        await removeRecipeFromCollection(group, collectionId, recipeId);
      }
      for (const recipeId of recipeIds) {
        await addRecipeToCollection(group, collectionId, recipeId);
      }
    },
    // Always refetch: a partially applied reorder must never stay on screen.
    onSettled: async (_data, _error, { collectionId }) => {
      if (!householdId) return;
      await invalidate.collection(client, householdId, collectionId);
    },
  });
}
