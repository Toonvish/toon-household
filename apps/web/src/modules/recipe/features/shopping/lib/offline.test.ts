/**
 * The offline shopping cache algebra: `removeFromCache` directly, and the `check` /
 * `undoBought` mutation defaults through the QueryClient they are registered on.
 *
 * No real fetch runs here — `mutationFn` is never invoked, only `onMutate`, which is
 * exactly what `resumePausedMutations()` would find registered if `bun test` had
 * IndexedDB. `bun:test` types come from `apps/web/tsconfig.test.json`, which is the
 * project that type-checks this file — `tsconfig.json` excludes it.
 */
import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { ShoppingItem, ShoppingListDetailResponse } from "@toon/shared";
import { queryKeys } from "@/modules/recipe/lib/queries";
import {
  registerShoppingMutationDefaults,
  removeFromCache,
  SHOPPING_MUTATION_KEYS,
  type CheckItemVariables,
  type UndoBoughtVariables,
} from "./offline";

const HOUSEHOLD_ID = "household-1";
const LIST_ID = "list-1";
const NOW = "2026-01-01T12:00:00.000Z";

function item(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: "item-1",
    listId: LIST_ID,
    name: "Mehl",
    quantity: 500,
    unit: "g",
    note: null,
    position: 0,
    sourceRecipeIds: [],
    sources: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function detail(overrides: Partial<ShoppingListDetailResponse> = {}): ShoppingListDetailResponse {
  return {
    list: {
      id: LIST_ID,
      householdId: HOUSEHOLD_ID,
      name: "Rewe",
      createdBy: "u1",
      createdAt: NOW,
      updatedAt: NOW,
    },
    items: [],
    catalog: [],
    bought: [],
    recipes: [],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* removeFromCache — the pure cache surgery                                   */
/* -------------------------------------------------------------------------- */

describe("removeFromCache(..., { asBought: true })", () => {
  test("removes the line from `items`, prepends exactly one `pending:` bought row with the passed buyer, and still bumps the catalog", () => {
    const current = detail({ items: [item()] });

    const next = removeFromCache(current, "item-1", {
      asBought: true,
      boughtBy: { id: "u1", name: "Alex" },
    });

    expect(next.items).toEqual([]);
    expect(next.bought).toHaveLength(1);
    expect(next.bought[0]).toMatchObject({
      id: "pending:item-1",
      name: "Mehl",
      quantity: 500,
      unit: "g",
      boughtBy: "u1",
      boughtByName: "Alex",
    });
    expect(next.catalog).toHaveLength(1);
    expect(next.catalog[0]).toMatchObject({ name: "Mehl", useCount: 1 });
  });

  test("a plain delete (asBought: false) never touches `bought`", () => {
    const current = detail({ items: [item()] });

    const next = removeFromCache(current, "item-1", { asBought: false });

    expect(next.items).toEqual([]);
    expect(next.bought).toEqual([]);
  });

  test("a missing `boughtBy` (a session-less caller) draws a nameless row rather than throwing", () => {
    const current = detail({ items: [item()] });

    const next = removeFromCache(current, "item-1", { asBought: true });

    expect(next.bought[0]).toMatchObject({ boughtBy: null, boughtByName: null });
  });
});

/* -------------------------------------------------------------------------- */
/* the registered mutation defaults                                           */
/* -------------------------------------------------------------------------- */

function seededClient(seed: ShoppingListDetailResponse): QueryClient {
  const client = new QueryClient();
  registerShoppingMutationDefaults(client);
  client.setQueryData(queryKeys.shoppingList(HOUSEHOLD_ID, LIST_ID), seed);
  return client;
}

function fakeContext(client: QueryClient): Parameters<NonNullable<ReturnType<typeof client.getMutationDefaults>["onMutate"]>>[1] {
  return { client, meta: undefined };
}

function read(client: QueryClient): ShoppingListDetailResponse {
  const data = client.getQueryData<ShoppingListDetailResponse>(
    queryKeys.shoppingList(HOUSEHOLD_ID, LIST_ID),
  );
  if (!data) throw new Error("expected a seeded cache entry");
  return data;
}

describe("check default — the optimistic 'Heute gekauft' row", () => {
  test("onMutate moves the item out of `items` and into `bought` with the call-time buyer", () => {
    const client = seededClient(detail({ items: [item()] }));
    const defaults = client.getMutationDefaults(SHOPPING_MUTATION_KEYS.check);
    const variables: CheckItemVariables = {
      householdId: HOUSEHOLD_ID,
      listId: LIST_ID,
      itemId: "item-1",
      mutationId: "m-1",
      boughtBy: { id: "u1", name: "Alex" },
    };

    defaults.onMutate?.(variables, fakeContext(client));

    const result = read(client);
    expect(result.items).toEqual([]);
    expect(result.bought[0]).toMatchObject({ boughtByName: "Alex" });
  });
});

describe("undoBought default", () => {
  test("onMutate merges the restored line into an EXISTING item rather than adding a second", () => {
    const client = seededClient(
      detail({
        items: [item({ id: "item-2", quantity: 200 })],
        bought: [
          {
            id: "bought-1",
            listId: LIST_ID,
            name: "Mehl",
            quantity: 500,
            unit: "g",
            note: null,
            boughtBy: "u1",
            boughtByName: "Alex",
            boughtAt: NOW,
            sourceRecipeIds: [],
          },
        ],
      }),
    );
    const defaults = client.getMutationDefaults(SHOPPING_MUTATION_KEYS.undoBought);
    const variables: UndoBoughtVariables = {
      householdId: HOUSEHOLD_ID,
      listId: LIST_ID,
      boughtId: "bought-1",
      mutationId: "m-2",
    };

    defaults.onMutate?.(variables, fakeContext(client));

    const result = read(client);
    expect(result.bought).toEqual([]);
    // ONE line, 700 g — not a second "Mehl" line sitting next to the first.
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: "item-2", name: "Mehl", quantity: 700, unit: "g" });
  });

  test("a replay of the same variables is a no-op on the cache", () => {
    const client = seededClient(
      detail({
        items: [item({ id: "item-2", quantity: 200 })],
        bought: [
          {
            id: "bought-1",
            listId: LIST_ID,
            name: "Mehl",
            quantity: 500,
            unit: "g",
            note: null,
            boughtBy: "u1",
            boughtByName: "Alex",
            boughtAt: NOW,
            sourceRecipeIds: [],
          },
        ],
      }),
    );
    const defaults = client.getMutationDefaults(SHOPPING_MUTATION_KEYS.undoBought);
    const variables: UndoBoughtVariables = {
      householdId: HOUSEHOLD_ID,
      listId: LIST_ID,
      boughtId: "bought-1",
      mutationId: "m-2",
    };

    defaults.onMutate?.(variables, fakeContext(client));
    const afterFirst = read(client);
    // The row is already gone from `bought`, so a second call with the SAME
    // variables — what a stray replay would look like — must change nothing.
    defaults.onMutate?.(variables, fakeContext(client));
    const afterSecond = read(client);

    expect(afterSecond).toEqual(afterFirst);
  });
});
