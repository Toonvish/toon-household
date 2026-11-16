import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { storageKeys } from "@/lib/storage";
import { defaultTargetList, orderShoppingListsForOverview, primaryShoppingList } from "./target";

// `bun test` has no DOM: `readStorage` reads `window.localStorage`, so the test brings a one-key stand-in.
const store = new Map<string, string>();
const hadWindow = "window" in globalThis;
const previousWindow = (globalThis as { window?: unknown }).window;
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
};
afterAll(() => {
  if (hadWindow) (globalThis as { window?: unknown }).window = previousWindow;
  else delete (globalThis as { window?: unknown }).window;
});

const H = "household-1";
const lists = [
  { id: "z", name: "Zoo" },
  { id: "a", name: "Äpfel" },
  { id: "r", name: "Rewe" },
];

function setLastOpened(value: string | null): void {
  if (value === null) store.delete(storageKeys.lastShoppingListId);
  else store.set(storageKeys.lastShoppingListId, value);
}

afterEach(() => setLastOpened(null));

describe("primaryShoppingList", () => {
  test("finds the flagged list, none without one", () => {
    expect(primaryShoppingList([...lists, { id: "p", name: "P", isPrimary: true }])?.id).toBe("p");
    expect(primaryShoppingList(lists)).toBeUndefined();
  });
});

describe("defaultTargetList", () => {
  test("alphabetical without a primary or last-opened list", () => {
    expect(defaultTargetList(H, lists)?.id).toBe("a");
    expect(defaultTargetList(H, [])).toBeNull();
  });

  test("the last-opened list of this household beats the alphabet", () => {
    setLastOpened(`${H}:z`);
    expect(defaultTargetList(H, lists)?.id).toBe("z");
    setLastOpened("other-household:z");
    expect(defaultTargetList(H, lists)?.id).toBe("a");
  });

  test("the primary list beats the last-opened one", () => {
    setLastOpened(`${H}:z`);
    const withPrimary = lists.map((list) => ({ ...list, isPrimary: list.id === "r" }));
    expect(defaultTargetList(H, withPrimary)?.id).toBe("r");
  });
});

describe("orderShoppingListsForOverview", () => {
  test("primary, then last-opened, then folded alphabetical", () => {
    setLastOpened(`${H}:z`);
    const withPrimary = lists.map((list) => ({ ...list, isPrimary: list.id === "r" }));
    expect(orderShoppingListsForOverview(H, withPrimary).map((list) => list.id)).toEqual(["r", "z", "a"]);
  });

  test("a last-opened primary list appears once", () => {
    setLastOpened(`${H}:r`);
    const withPrimary = lists.map((list) => ({ ...list, isPrimary: list.id === "r" }));
    expect(orderShoppingListsForOverview(H, withPrimary).map((list) => list.id)).toEqual(["r", "a", "z"]);
  });

  test("without either, folded alphabetical (Äpfel before Rewe)", () => {
    expect(orderShoppingListsForOverview(H, lists).map((list) => list.id)).toEqual(["a", "r", "z"]);
  });
});
