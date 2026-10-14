/**
 * Offline-editable shopping lists.
 *
 * This module is imported for its SIDE EFFECT from src/app.tsx and registers one
 * mutation default per shopping operation. Everything below exists to make one thing
 * work: ticking items off in a supermarket basement with no signal, and having the
 * result reach the server later without the list being wrong in between.
 *
 * ## How the four pieces fit together
 *
 * 1. **`networkMode: "offlineFirst"`** — the mutation is ATTEMPTED even when the
 *    browser reports offline. If the request fails because there is no network, the
 *    mutation is PAUSED instead of failed, and TanStack keeps it in the mutation cache.
 * 2. **`onMutate` writes the answer the server would have given.** The optimistic
 *    update runs the SAME merge algebra the API runs (`@toon/shared`), so "200 g Mehl"
 *    added to an existing 200 g line shows 400 g immediately and does not jump when the
 *    real response lands.
 * 3. **Paused mutations are persisted** (`shouldPersistMutation` in lib/persist.ts) and
 *    replayed by `resumePausedMutations()` after the cache is restored. That is why
 *    every operation is registered HERE with `setMutationDefaults` rather than passed
 *    inline to `useMutation`: a dehydrated mutation keeps its variables but cannot keep
 *    a function, so the replay looks the `mutationFn` up by mutation key.
 * 4. **A `mutationId` travels with every queued write.** Generated once when the
 *    mutation is fired (never in `mutationFn`, which re-runs on replay), it lets the
 *    API apply each mutation at most once. Without it, a request that reached the
 *    server but lost its response would be applied twice on replay — and because items
 *    MERGE, that is a silently doubled amount, not a visible duplicate.
 *
 * ## Ordering
 *
 * `resumePausedMutations()` replays in the order the mutations were made, which matters:
 * "add Milch" then "check Milch off" must not arrive the other way round. Everything
 * here therefore stays on the default serial resume — do not make these mutations
 * concurrent.
 *
 * ## What is deliberately NOT offline
 *
 * Creating, renaming and deleting a LIST. Those are rare, they are not what you do
 * while shopping, and a list created offline would need a client-side id that every
 * queued item mutation then has to be rewritten to point at. Online-only keeps the
 * whole queue addressing server ids.
 */
import type { QueryClient } from "@tanstack/react-query";
import {
  mergeShoppingItems,
  nameKey,
  normalizeUnit,
  shoppingItemKey,
  type AddRecipeToShoppingListRequest,
  type ShoppingItem,
  type ShoppingItemInput,
  type ShoppingListDetailResponse,
  type UpdateShoppingItemRequest,
} from "@toon/shared";
import {
  addRecipeToShoppingList,
  addShoppingCatalogEntry,
  addShoppingItems,
  checkShoppingItem,
  clearShoppingList,
  deleteShoppingItem,
  undoBoughtItem,
  updateShoppingItem,
} from "@/modules/recipe/lib/api";
import { queryKeys } from "@/modules/recipe/lib/queries";

/* -------------------------------------------------------------------------- */
/* mutation keys                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Mutation keys are `["toon","recipe","shopping",<operation>]`. The `"shopping"` segment is what
 * `shouldPersistMutation` allow-lists, so a new operation is queued offline the moment
 * it is registered here — and NOT persisted if it is defined inline somewhere else.
 */
export const SHOPPING_MUTATION_KEYS = {
  addItems: ["toon", "recipe", "shopping", "add-items"] as const,
  updateItem: ["toon", "recipe", "shopping", "update-item"] as const,
  removeItem: ["toon", "recipe", "shopping", "remove-item"] as const,
  check: ["toon", "recipe", "shopping", "check"] as const,
  clear: ["toon", "recipe", "shopping", "clear"] as const,
  addRecipe: ["toon", "recipe", "shopping", "add-recipe"] as const,
  addSuggestion: ["toon", "recipe", "shopping", "add-suggestion"] as const,
  undoBought: ["toon", "recipe", "shopping", "undo-bought"] as const,
} as const;

/** Variables every shopping mutation carries. */
interface ShoppingTarget {
  householdId: string;
  listId: string;
  /** Client-generated, stable across replays — the API's at-most-once token. */
  mutationId: string;
}

export interface AddItemsVariables extends ShoppingTarget {
  items: ShoppingItemInput[];
}
export interface ItemVariables extends ShoppingTarget {
  itemId: string;
}
export interface UpdateItemVariables extends ItemVariables {
  patch: UpdateShoppingItemRequest;
}
/**
 * The current session's user, resolved at CALL time (`features/shopping/lib/queries.ts`)
 * from the cached `["toon","me"]` payload — never inside `mutationFn`, which re-runs on
 * replay and would resolve to whoever is signed in when the queue drains, not who
 * checked the item off. Not sent to the server (`CheckShoppingItemRequest` carries only
 * `mutationId`; the API reads the buyer from the session), only used to draw the
 * optimistic "Heute gekauft" row before the server has told us anything.
 */
export interface CheckItemVariables extends ItemVariables {
  boughtBy: { id: string; name: string };
}
/** One "Bought today" row is put back on the list. */
export interface UndoBoughtVariables extends ShoppingTarget {
  boughtId: string;
}
export interface AddRecipeVariables extends ShoppingTarget {
  recipeId: string;
  servings?: number | undefined;
  /** Subset of the recipe's ingredient rows; omitted means the whole recipe. */
  ingredientIds?: readonly string[] | undefined;
}
export interface AddSuggestionVariables extends ShoppingTarget {
  entryId: string;
  /** Only for the optimistic update; the server reads the name from its own row. */
  name: string;
}

/* -------------------------------------------------------------------------- */
/* optimistic cache surgery                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A placeholder id for a line that does not exist on the server yet.
 * Recognisable so the UI can disable per-item actions that need a real id.
 */
export function isPendingItemId(id: string): boolean {
  return id.startsWith("pending:");
}

/** Applies `change` to the cached detail payload, if there is one. */
function patchCache(
  client: QueryClient,
  householdId: string,
  listId: string,
  change: (current: ShoppingListDetailResponse) => ShoppingListDetailResponse,
): ShoppingListDetailResponse | undefined {
  const key = queryKeys.shoppingList(householdId, listId);
  const current = client.getQueryData<ShoppingListDetailResponse>(key);
  if (!current) return undefined;
  const next = change(current);
  client.setQueryData(key, next);
  return current;
}

/**
 * Rolls the cache back to a snapshot taken in `onMutate`, then asks the server for the
 * truth.
 *
 * The refetch is not belt-and-braces, it is load-bearing. Snapshots are per-mutation, so
 * with several edits in flight, rolling back the FIRST one to fail also discards the
 * optimistic changes of the ones after it — the classic optimistic-update trap. Letting
 * the server's answer land afterwards is what converges the list again. Offline the
 * refetch simply fails and the restored snapshot stands, which is the right outcome
 * there.
 */
function rollbackCache(
  client: QueryClient,
  householdId: string,
  listId: string,
  snapshot: ShoppingListDetailResponse | undefined,
): void {
  if (snapshot) client.setQueryData(queryKeys.shoppingList(householdId, listId), snapshot);
  void client.invalidateQueries({ queryKey: queryKeys.shoppingList(householdId, listId) });
}

/**
 * Optimistically merges `additions` into the cached list with the SAME algebra the
 * server uses, so the number the user sees offline is the number that survives.
 *
 * Lines that merge into an existing item keep that item's real id. Genuinely new lines
 * get a `pending:` id (see {@link isPendingItemId}) until the server answers.
 */
function mergeIntoCache(
  current: ShoppingListDetailResponse,
  additions: ShoppingItemInput[],
  sourceRecipeIds: string[] = [],
): ShoppingListDetailResponse {
  const timestamp = new Date().toISOString();
  const drafts = additions.map((item) => ({
    name: item.name.trim(),
    quantity: typeof item.quantity === "number" ? item.quantity : null,
    unit: item.unit?.trim() ? normalizeUnit(item.unit) : null,
    note: item.note?.trim() ? item.note.trim() : null,
    sourceRecipeIds,
  }));

  const merged = mergeShoppingItems(
    current.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      note: item.note,
      sourceRecipeIds: item.sourceRecipeIds,
      existing: item,
    })),
    drafts,
  );

  const items: ShoppingItem[] = merged.map((entry, index) => {
    const existing = "existing" in entry ? (entry.existing as ShoppingItem) : undefined;
    if (existing) {
      return {
        ...existing,
        quantity: entry.quantity,
        unit: entry.unit,
        note: entry.note,
        sourceRecipeIds: entry.sourceRecipeIds,
        updatedAt: timestamp,
      };
    }
    return {
      id: `pending:${shoppingItemKey(entry.name, entry.unit)}`,
      listId: current.list.id,
      name: entry.name,
      quantity: entry.quantity,
      unit: entry.unit,
      note: entry.note,
      position: index,
      sourceRecipeIds: entry.sourceRecipeIds,
      // Titles are only known to the server; the line shows its provenance after sync.
      sources: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });

  // Anything now on the list must stop being suggested, exactly as the server does.
  const onList = new Set(items.map((item) => nameKey(item.name)));
  return {
    list: { ...current.list, itemCount: items.length, updatedAt: timestamp },
    items,
    catalog: current.catalog.filter((entry) => !onList.has(nameKey(entry.name))),
    // Neither the bought log nor the attached-recipes list is touched by an add —
    // callers that DO change one of those (the undo default clears its own row first)
    // pass in a `current` that already reflects it.
    bought: current.bought,
    recipes: current.recipes,
  };
}

/**
 * Removes a line from the cached list. Used by both check-off and delete, and exported
 * for `offline.test.ts` — the cache algebra is the whole point of this module and is
 * cheapest to pin directly rather than through a registered mutation's `onMutate`.
 */
export function removeFromCache(
  current: ShoppingListDetailResponse,
  itemId: string,
  options: { asBought: boolean; boughtBy?: { id: string; name: string } },
): ShoppingListDetailResponse {
  const removed = current.items.find((item) => item.id === itemId);
  const items = current.items.filter((item) => item.id !== itemId);
  const timestamp = new Date().toISOString();

  // A checked item reappears under "Häufig gekauft" immediately, so the offline screen
  // looks like the online one. useCount is only an optimistic guess; the next server
  // response replaces the whole payload with the real ranking.
  let catalog = current.catalog;
  if (options.asBought && removed) {
    const key = nameKey(removed.name);
    const known = catalog.find((entry) => nameKey(entry.name) === key);
    catalog = known
      ? catalog.map((entry) =>
          entry.id === known.id
            ? { ...entry, useCount: entry.useCount + 1, lastUsedAt: timestamp, unit: removed.unit }
            : entry,
        )
      : [
          {
            id: `pending:${key}`,
            listId: current.list.id,
            name: removed.name,
            unit: removed.unit,
            useCount: 1,
            lastUsedAt: timestamp,
            hiddenAt: null,
          },
          ...catalog,
        ];
  }

  // A checked-off line must MOVE, not vanish: "Heute gekauft" gets its own optimistic
  // row, `pending:`-prefixed like every other id this module invents, so
  // `isPendingItemId` can disable undo on it until the server assigns a real one. A
  // plain delete (`asBought: false`) never touches the bought log.
  let bought = current.bought;
  if (options.asBought && removed) {
    bought = [
      {
        id: `pending:${itemId}`,
        listId: current.list.id,
        name: removed.name,
        quantity: removed.quantity,
        unit: removed.unit,
        note: removed.note,
        boughtBy: options.boughtBy?.id ?? null,
        boughtByName: options.boughtBy?.name ?? null,
        boughtAt: timestamp,
        sourceRecipeIds: removed.sourceRecipeIds,
      },
      ...current.bought,
    ];
  }

  return {
    list: { ...current.list, itemCount: items.length, updatedAt: timestamp },
    items,
    catalog,
    bought,
    recipes: current.recipes,
  };
}

/* -------------------------------------------------------------------------- */
/* registration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Registers every shopping mutation on `client`.
 *
 * Called by the recipe manifest's `mutationDefaults` (app.tsx) before the persister restores, and
 * callable in a test with a throwaway client. Idempotent — re-registering a key replaces its defaults.
 */
export function registerShoppingMutationDefaults(client: QueryClient): void {
  const shared = {
    networkMode: "offlineFirst",
    // Retry once so a flaky connection is not immediately a red toast; a genuinely
    // offline mutation is PAUSED rather than retried, so this does not fight the queue.
    retry: 1,
  } as const;

  /** Replaces the cached list with the server's answer — never patches it. */
  const commit = (data: ShoppingListDetailResponse, variables: ShoppingTarget) => {
    client.setQueryData(queryKeys.shoppingList(variables.householdId, variables.listId), data);
    // The overview shows per-list item counts, so it is stale after every write.
    void client.invalidateQueries({ queryKey: queryKeys.shoppingLists(variables.householdId) });
  };

  client.setMutationDefaults(SHOPPING_MUTATION_KEYS.addItems, {
    ...shared,
    mutationFn: (variables: AddItemsVariables) =>
      addShoppingItems(variables.householdId, variables.listId, {
        items: variables.items,
        mutationId: variables.mutationId,
      }),
    onMutate: (variables: AddItemsVariables) =>
      patchCache(client, variables.householdId, variables.listId, (current) =>
        mergeIntoCache(current, variables.items),
      ),
    onError: (_error, variables: AddItemsVariables, snapshot) =>
      rollbackCache(client, variables.householdId, variables.listId, snapshot as never),
    onSuccess: commit,
  });

  client.setMutationDefaults(SHOPPING_MUTATION_KEYS.addRecipe, {
    ...shared,
    mutationFn: (variables: AddRecipeVariables) => {
      const body: AddRecipeToShoppingListRequest = {
        recipeId: variables.recipeId,
        mutationId: variables.mutationId,
        ...(variables.servings === undefined ? {} : { servings: variables.servings }),
        // Omitted, not `[]`, when everything is selected: an empty array would mean
        // "add nothing", and "the whole recipe" is the request we want to replay.
        ...(variables.ingredientIds === undefined
          ? {}
          : { ingredientIds: [...variables.ingredientIds] }),
      };
      return addRecipeToShoppingList(variables.householdId, variables.listId, body);
    },
    // No optimistic update: the ingredient rows are not necessarily in the cache (the
    // recipe may never have been opened), and inventing them would show amounts that
    // then change. The list simply updates when the server answers.
    onSuccess: commit,
  });

  client.setMutationDefaults(SHOPPING_MUTATION_KEYS.updateItem, {
    ...shared,
    mutationFn: (variables: UpdateItemVariables) =>
      updateShoppingItem(variables.householdId, variables.listId, variables.itemId, variables.patch),
    onMutate: (variables: UpdateItemVariables) =>
      patchCache(client, variables.householdId, variables.listId, (current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === variables.itemId
            ? {
                ...item,
                ...(variables.patch.name === undefined ? {} : { name: variables.patch.name }),
                ...(variables.patch.quantity === undefined
                  ? {}
                  : { quantity: variables.patch.quantity ?? null }),
                ...(variables.patch.unit === undefined
                  ? {}
                  : { unit: variables.patch.unit ? normalizeUnit(variables.patch.unit) : null }),
                ...(variables.patch.note === undefined
                  ? {}
                  : { note: variables.patch.note ?? null }),
              }
            : item,
        ),
      })),
    onError: (_error, variables: UpdateItemVariables, snapshot) =>
      rollbackCache(client, variables.householdId, variables.listId, snapshot as never),
    onSuccess: commit,
  });

  client.setMutationDefaults(SHOPPING_MUTATION_KEYS.check, {
    ...shared,
    mutationFn: (variables: CheckItemVariables) =>
      checkShoppingItem(variables.householdId, variables.listId, variables.itemId, {
        mutationId: variables.mutationId,
      }),
    onMutate: (variables: CheckItemVariables) =>
      patchCache(client, variables.householdId, variables.listId, (current) =>
        removeFromCache(current, variables.itemId, {
          asBought: true,
          boughtBy: variables.boughtBy,
        }),
      ),
    onError: (_error, variables: CheckItemVariables, snapshot) =>
      rollbackCache(client, variables.householdId, variables.listId, snapshot as never),
    onSuccess: commit,
  });

  client.setMutationDefaults(SHOPPING_MUTATION_KEYS.removeItem, {
    ...shared,
    mutationFn: (variables: ItemVariables) =>
      deleteShoppingItem(variables.householdId, variables.listId, variables.itemId),
    onMutate: (variables: ItemVariables) =>
      patchCache(client, variables.householdId, variables.listId, (current) =>
        removeFromCache(current, variables.itemId, { asBought: false }),
      ),
    onError: (_error, variables: ItemVariables, snapshot) =>
      rollbackCache(client, variables.householdId, variables.listId, snapshot as never),
    onSuccess: commit,
  });

  client.setMutationDefaults(SHOPPING_MUTATION_KEYS.clear, {
    ...shared,
    // `mutationId` is carried in the variables for a uniform shape but deliberately not
    // sent: "delete every row on this list" is already idempotent, so a replay needs no
    // ledger entry — and spending one would only shorten the ledger's useful window.
    mutationFn: (variables: ShoppingTarget) =>
      clearShoppingList(variables.householdId, variables.listId),
    onMutate: (variables: ShoppingTarget) =>
      patchCache(client, variables.householdId, variables.listId, (current) => ({
        ...current,
        list: { ...current.list, itemCount: 0 },
        items: [],
      })),
    onError: (_error, variables: ShoppingTarget, snapshot) =>
      rollbackCache(client, variables.householdId, variables.listId, snapshot as never),
    onSuccess: commit,
  });

  client.setMutationDefaults(SHOPPING_MUTATION_KEYS.addSuggestion, {
    ...shared,
    mutationFn: (variables: AddSuggestionVariables) =>
      addShoppingCatalogEntry(variables.householdId, variables.listId, variables.entryId, {
        mutationId: variables.mutationId,
      }),
    // A suggestion goes back on the list without an amount, matching the API.
    onMutate: (variables: AddSuggestionVariables) =>
      patchCache(client, variables.householdId, variables.listId, (current) =>
        mergeIntoCache(current, [{ name: variables.name }]),
      ),
    onError: (_error, variables: AddSuggestionVariables, snapshot) =>
      rollbackCache(client, variables.householdId, variables.listId, snapshot as never),
    onSuccess: commit,
  });

  client.setMutationDefaults(SHOPPING_MUTATION_KEYS.undoBought, {
    ...shared,
    mutationFn: (variables: UndoBoughtVariables) =>
      undoBoughtItem(variables.householdId, variables.listId, variables.boughtId, {
        mutationId: variables.mutationId,
      }),
    // Pulls the row out of `bought` and folds its amount back onto `items` with the
    // SAME merge algebra the server runs (`mergeIntoCache`), so a restored 500 g line
    // that lands on an existing 200 g one shows 700 g immediately and does not jump
    // when the real response arrives. A boughtId no longer present (a replay, or a
    // second undo click before the first one's response lands) is a no-op — there is
    // nothing left to restore.
    onMutate: (variables: UndoBoughtVariables) =>
      patchCache(client, variables.householdId, variables.listId, (current) => {
        const row = current.bought.find((entry) => entry.id === variables.boughtId);
        if (!row) return current;
        const withoutRow = {
          ...current,
          bought: current.bought.filter((entry) => entry.id !== variables.boughtId),
        };
        return mergeIntoCache(
          withoutRow,
          [{ name: row.name, quantity: row.quantity, unit: row.unit, note: row.note }],
          row.sourceRecipeIds,
        );
      }),
    onError: (_error, variables: UndoBoughtVariables, snapshot) =>
      rollbackCache(client, variables.householdId, variables.listId, snapshot as never),
    onSuccess: commit,
  });
}
