/**
 * TanStack Query hooks for shopping lists.
 *
 * The MUTATIONS here are thin: they only supply a mutation key and the variables. All
 * the behaviour — the request, the optimistic merge, the rollback, the cache commit —
 * is registered once in ./offline.ts via `setMutationDefaults`, because a mutation
 * restored from IndexedDB after an offline spell can only find its function by key.
 *
 * Every mutating hook therefore mints a `mutationId` at CALL time and passes it in the
 * variables. It must not be generated inside the mutation function: that re-runs on
 * replay, a fresh id would look like a new mutation to the API, and an "add" that had
 * already been applied would be applied twice.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateShoppingListRequest,
  MeResponse,
  ShoppingItemInput,
  ShoppingList,
  ShoppingListDetailResponse,
  UpdateShoppingItemRequest,
} from "@toon/shared";
import {
  createShoppingList,
  deleteShoppingCatalogEntry,
  deleteShoppingList,
  updateShoppingList,
} from "@/modules/recipe/lib/api";
import { invalidate, queryKeys, shoppingListQuery, shoppingListsQuery } from "@/modules/recipe/lib/queries";
import {
  SHOPPING_MUTATION_KEYS,
  type AddItemsVariables,
  type AddRecipeVariables,
  type AddSuggestionVariables,
  type CheckItemVariables,
  type ItemVariables,
  type UndoBoughtVariables,
  type UpdateItemVariables,
} from "./offline";

/** A fresh at-most-once token for one queued mutation. */
function newMutationId(): string {
  return crypto.randomUUID();
}

/**
 * The signed-in user, read from the `["toon","me"]` CACHE, not a fresh fetch — offline
 * is exactly when this has to work. Used only to draw the optimistic "Heute gekauft"
 * row before the server has told us anything; a session-less caller (which should not
 * be able to reach this screen at all) draws a nameless row rather than crashing.
 */
function currentBuyer(client: ReturnType<typeof useQueryClient>): { id: string; name: string } {
  const me = client.getQueryData<MeResponse | null>(queryKeys.me());
  return { id: me?.user.id ?? "", name: me?.user.name ?? "" };
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

/** All lists of the household, unwrapped to `ShoppingList[]`. */
export function useShoppingLists(householdId: string | null) {
  const options = shoppingListsQuery(householdId ?? "");
  return useQuery({
    ...options,
    enabled: householdId !== null,
    select: (response) => response.items,
  });
}

/** One list with its items and "Häufig gekauft" suggestions. */
export function useShoppingList(householdId: string | null, listId: string | null) {
  const options = shoppingListQuery(householdId ?? "", listId ?? "");
  return useQuery({
    ...options,
    enabled: householdId !== null && listId !== null,
  });
}

/* -------------------------------------------------------------------------- */
/* list-level mutations (online only — see the note in ./offline.ts)          */
/* -------------------------------------------------------------------------- */

export function useCreateShoppingList(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<ShoppingList, Error, CreateShoppingListRequest>({
    mutationFn: async (input) => (await createShoppingList(householdId ?? "", input)).list,
    onSuccess: async () => {
      if (householdId) await invalidate.shoppingLists(client, householdId);
    },
  });
}

export function useRenameShoppingList(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<ShoppingList, Error, { listId: string; name: string }>({
    mutationFn: async ({ listId, name }) =>
      (await updateShoppingList(householdId ?? "", listId, { name })).list,
    onSuccess: async (list) => {
      if (!householdId) return;
      await Promise.all([
        invalidate.shoppingLists(client, householdId),
        invalidate.shoppingList(client, householdId, list.id),
      ]);
    },
  });
}

export function useDeleteShoppingList(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (listId) => deleteShoppingList(householdId ?? "", listId),
    onSuccess: async (_result, listId) => {
      if (!householdId) return;
      client.removeQueries({ queryKey: ["toon", "household", householdId, "recipe", "shopping-list", listId] });
      await invalidate.shoppingLists(client, householdId);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* item mutations (offline-capable)                                           */
/* -------------------------------------------------------------------------- */

type Detail = ShoppingListDetailResponse;

/** Adds hand-entered lines. Merges into what is already on the list. */
export function useAddShoppingItems(householdId: string, listId: string) {
  const mutation = useMutation<Detail, Error, AddItemsVariables>({
    mutationKey: SHOPPING_MUTATION_KEYS.addItems,
  });
  return {
    ...mutation,
    add: (items: ShoppingItemInput[]) =>
      mutation.mutate({ householdId, listId, items, mutationId: newMutationId() }),
  };
}

/** Puts a recipe on the list, scaled to `servings`. */
export function useAddRecipeToShoppingList() {
  const mutation = useMutation<Detail, Error, AddRecipeVariables>({
    mutationKey: SHOPPING_MUTATION_KEYS.addRecipe,
  });
  return {
    ...mutation,
    addRecipe: (input: {
      householdId: string;
      listId: string;
      recipeId: string;
      servings?: number | undefined;
      /** Subset of ingredient rows; omit for the whole recipe. */
      ingredientIds?: readonly string[] | undefined;
    }) => mutation.mutateAsync({ ...input, mutationId: newMutationId() }),
  };
}

export function useUpdateShoppingItem(householdId: string, listId: string) {
  const mutation = useMutation<Detail, Error, UpdateItemVariables>({
    mutationKey: SHOPPING_MUTATION_KEYS.updateItem,
  });
  return {
    ...mutation,
    update: (itemId: string, patch: UpdateShoppingItemRequest) =>
      mutation.mutate({ householdId, listId, itemId, patch, mutationId: newMutationId() }),
  };
}

/** Checks a line off: it leaves the list and shows up under "Häufig gekauft". */
export function useCheckShoppingItem(householdId: string, listId: string) {
  const client = useQueryClient();
  const mutation = useMutation<Detail, Error, CheckItemVariables>({
    mutationKey: SHOPPING_MUTATION_KEYS.check,
  });
  return {
    ...mutation,
    check: (itemId: string) =>
      mutation.mutate({
        householdId,
        listId,
        itemId,
        mutationId: newMutationId(),
        // Resolved HERE, at call time, from the cache — never inside `mutationFn`,
        // which re-runs on replay (see the type's doc comment in ./offline).
        boughtBy: currentBuyer(client),
      }),
  };
}

/** Puts a "Heute gekauft" row back on the list, folding its amount onto `items`. */
export function useUndoBoughtItem(householdId: string, listId: string) {
  const mutation = useMutation<Detail, Error, UndoBoughtVariables>({
    mutationKey: SHOPPING_MUTATION_KEYS.undoBought,
  });
  return {
    ...mutation,
    undo: (boughtId: string) =>
      mutation.mutate({ householdId, listId, boughtId, mutationId: newMutationId() }),
  };
}

/** Removes a line WITHOUT counting it as bought. */
export function useRemoveShoppingItem(householdId: string, listId: string) {
  const mutation = useMutation<Detail, Error, ItemVariables>({
    mutationKey: SHOPPING_MUTATION_KEYS.removeItem,
  });
  return {
    ...mutation,
    remove: (itemId: string) =>
      mutation.mutate({ householdId, listId, itemId, mutationId: newMutationId() }),
  };
}

export function useClearShoppingList(householdId: string, listId: string) {
  const mutation = useMutation<Detail, Error, { householdId: string; listId: string; mutationId: string }>(
    { mutationKey: SHOPPING_MUTATION_KEYS.clear },
  );
  return {
    ...mutation,
    clear: () => mutation.mutate({ householdId, listId, mutationId: newMutationId() }),
  };
}

/** Re-adds a suggestion, deliberately without an amount. */
export function useAddShoppingSuggestion(householdId: string, listId: string) {
  const mutation = useMutation<Detail, Error, AddSuggestionVariables>({
    mutationKey: SHOPPING_MUTATION_KEYS.addSuggestion,
  });
  return {
    ...mutation,
    addSuggestion: (entryId: string, name: string) =>
      mutation.mutate({ householdId, listId, entryId, name, mutationId: newMutationId() }),
  };
}

/**
 * "Nicht mehr vorschlagen". Online only and intentionally so: dismissing a suggestion
 * is housekeeping, not shopping, and a queued dismissal replayed days later could
 * remove an entry the household has since started using again.
 */
export function useDismissShoppingSuggestion(householdId: string, listId: string) {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (entryId) => deleteShoppingCatalogEntry(householdId, listId, entryId),
    onMutate: (entryId) => {
      const key = ["toon", "household", householdId, "recipe", "shopping-list", listId] as const;
      const snapshot = client.getQueryData<Detail>(key);
      if (snapshot) {
        client.setQueryData(key, {
          ...snapshot,
          catalog: snapshot.catalog.filter((entry) => entry.id !== entryId),
        });
      }
      return snapshot;
    },
    onError: (_error, _entryId, snapshot) => {
      if (snapshot) {
        client.setQueryData(["toon", "household", householdId, "recipe", "shopping-list", listId], snapshot);
      }
    },
    onSuccess: async () => {
      await invalidate.shoppingList(client, householdId, listId);
    },
  });
}
