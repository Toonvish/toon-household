/**
 * Key shapes of lib/queries.ts. The roots are the contract the persist allow-list
 * (lib/persist.ts), the module query keys and the invalidation helpers all build on
 * (SPEC D9), so a rename must fail here first.
 */
import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { filterKey, healthQuery, invalidate, queryKeys, retryDelay, shouldRetry } from "./queries";

const householdId = "11111111-1111-4111-8111-111111111111";

describe("queryKeys", () => {
  test("core roots", () => {
    expect(queryKeys.all).toEqual(["toon"]);
    expect(queryKeys.health()).toEqual(["toon", "health"]);
    expect(queryKeys.me()).toEqual(["toon", "me"]);
  });

  test("household data starts ['toon','household',id]", () => {
    expect(queryKeys.household(householdId)).toEqual(["toon", "household", householdId]);
  });

  test("household module data starts ['toon','household',id,'<module>']", () => {
    expect(queryKeys.householdModule(householdId, "recipe")).toEqual([
      "toon",
      "household",
      householdId,
      "recipe",
    ]);
    expect(queryKeys.householdModule(householdId, "finance")).toEqual([
      "toon",
      "household",
      householdId,
      "finance",
    ]);
  });

  test("user module data starts ['toon','<module>']", () => {
    expect(queryKeys.userModule("recipe")).toEqual(["toon", "recipe"]);
    expect(queryKeys.userModule("finance")).toEqual(["toon", "finance"]);
  });

  test("the household prefix is a prefix of every module key under it", () => {
    const root = queryKeys.household(householdId);
    const module = queryKeys.householdModule(householdId, "finance");
    expect(module.slice(0, root.length)).toEqual([...root]);
  });

  test("everything hangs off the 'toon' root", () => {
    const keys = [
      queryKeys.health(),
      queryKeys.me(),
      queryKeys.household(householdId),
      queryKeys.householdModule(householdId, "recipe"),
      queryKeys.userModule("finance"),
    ];
    for (const key of keys) expect(key[0]).toBe(queryKeys.all[0]);
  });
});

describe("healthQuery", () => {
  test("uses the health key", () => {
    expect([...healthQuery().queryKey]).toEqual([...queryKeys.health()]);
  });
});

describe("invalidate", () => {
  test("health invalidates exactly the health key", async () => {
    const qc = new QueryClient();
    qc.setQueryData([...queryKeys.health()], { ok: true });
    qc.setQueryData([...queryKeys.me()], { id: "u1" });
    await invalidate.health(qc);
    expect(qc.getQueryState([...queryKeys.health()])?.isInvalidated).toBe(true);
    expect(qc.getQueryState([...queryKeys.me()])?.isInvalidated).toBe(false);
  });
});

describe("filterKey", () => {
  test("drops empty values and sorts keys so equal filters give equal keys", () => {
    expect(filterKey(undefined)).toEqual({});
    const a = filterKey({ b: 1, a: "x", c: undefined, d: null, e: "" });
    expect(Object.keys(a)).toEqual(["a", "b"]);
    expect(JSON.stringify(filterKey({ b: 1, a: 2 }))).toBe(JSON.stringify(filterKey({ a: 2, b: 1 })));
  });
});

describe("retry policy", () => {
  test("retries network errors twice, then gives up", () => {
    expect(shouldRetry(0, new Error("offline"))).toBe(true);
    expect(shouldRetry(1, new Error("offline"))).toBe(true);
    expect(shouldRetry(2, new Error("offline"))).toBe(false);
  });

  test("backoff doubles and caps at 8s", () => {
    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(10)).toBe(8000);
  });
});
