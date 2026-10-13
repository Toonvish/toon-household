/**
 * `buildPersistPolicy` — the manifest-assembled offline policy (SPEC D9, plan §1
 * decision 8). Fed two FAKE manifest slices, so the wiring is proven without any real
 * module: what a slice declares is persisted, what no slice declares is not.
 */
import { describe, expect, test } from "bun:test";
import { buildPersistPolicy, type PersistPolicySource } from "./persist";

type QueryLike = Parameters<ReturnType<typeof buildPersistPolicy>["shouldDehydrateQuery"]>[0];
type MutationLike = Parameters<ReturnType<typeof buildPersistPolicy>["shouldDehydrateMutation"]>[0];

const householdId = "11111111-1111-4111-8111-111111111111";

function query(queryKey: readonly unknown[]): QueryLike {
  return {
    queryKey: queryKey as QueryLike["queryKey"],
    state: { status: "success", data: { items: [] } } as QueryLike["state"],
  };
}

function pausedMutation(mutationKey: readonly unknown[]): MutationLike {
  return { state: { status: "pending", isPaused: true }, options: { mutationKey } };
}

const recipeSlice: PersistPolicySource = {
  persistQueryAllowList: [{ scope: "household", path: ["recipe", "recipes"] }],
};

const financeSlice: PersistPolicySource = {
  persistQueryAllowList: [],
  persistMutationNamespaces: [["finance", "tx"]],
};

describe("buildPersistPolicy — mutations", () => {
  test("a paused mutation in a declared namespace is persisted", () => {
    const policy = buildPersistPolicy([recipeSlice, financeSlice]);
    expect(policy.shouldDehydrateMutation(pausedMutation(["toon", "finance", "tx", "m1"]))).toBe(true);
  });

  test("the same mutation is NOT persisted when no slice declares the namespace", () => {
    const policy = buildPersistPolicy([recipeSlice, { ...financeSlice, persistMutationNamespaces: [] }]);
    expect(policy.shouldDehydrateMutation(pausedMutation(["toon", "finance", "tx", "m1"]))).toBe(false);
  });

  test("an omitted persistMutationNamespaces counts as none", () => {
    const policy = buildPersistPolicy([recipeSlice]);
    expect(policy.shouldDehydrateMutation(pausedMutation(["toon", "finance", "tx", "m1"]))).toBe(false);
  });

  test("a settled mutation is never persisted, even in a declared namespace", () => {
    const policy = buildPersistPolicy([financeSlice]);
    expect(
      policy.shouldDehydrateMutation({
        state: { status: "success", isPaused: false },
        options: { mutationKey: ["toon", "finance", "tx", "m1"] },
      }),
    ).toBe(false);
  });
});

describe("buildPersistPolicy — queries", () => {
  const policy = buildPersistPolicy([recipeSlice, financeSlice]);

  test("a query under a declared household prefix is persisted", () => {
    expect(policy.shouldDehydrateQuery(query(["toon", "household", householdId, "recipe", "recipes"]))).toBe(
      true,
    );
  });

  test("a query under an undeclared household prefix is not", () => {
    expect(
      policy.shouldDehydrateQuery(query(["toon", "household", householdId, "finance", "transactions"])),
    ).toBe(false);
  });

  test("no modules at all persists only the bootstrap payload", () => {
    const empty = buildPersistPolicy([]);
    expect(empty.shouldDehydrateQuery(query(["toon", "me"]))).toBe(true);
    expect(empty.shouldDehydrateQuery(query(["toon", "household", householdId, "recipe", "recipes"]))).toBe(
      false,
    );
  });
});
