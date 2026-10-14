// FIRST import, on purpose (plan m2-recipe-module §1 decision 15): the manifest is evaluated
// before anything else; a path from its static graph back into the registry would crash this
// file with a TDZ `ReferenceError`.
import { recipeModule } from "./index";
/**
 * The recipe module's offline policy (SPEC D9; plan §1 decision 8), ported from R
 * `apps/web/src/lib/persist.test.ts` (its recipe cases) onto the manifest-assembled policy:
 * `buildPersistPolicy([recipeModule])` with the household keys of plan Table F.
 *
 * These pin what a phone may write to IndexedDB, so "browse your recipes in the kitchen"
 * works and nothing that must be live (import drafts, the plan-vs-list diff) is restored.
 */
import { describe, expect, test } from "bun:test";
import { buildPersistPolicy } from "@/modules/persist";
import { SHOPPING_MUTATION_KEYS } from "./features/shopping/lib/offline";

const policy = buildPersistPolicy([recipeModule]);

type QueryLike = Parameters<typeof policy.shouldDehydrateQuery>[0];
type MutationLike = Parameters<typeof policy.shouldDehydrateMutation>[0];

const householdId = "11111111-1111-4111-8111-111111111111";
const h = (...rest: unknown[]) => ["toon", "household", householdId, "recipe", ...rest];

/** A successful query with some data, which is the only persistable shape. */
function query(queryKey: readonly unknown[], overrides: Partial<QueryLike["state"]> = {}): QueryLike {
  return {
    queryKey: queryKey as QueryLike["queryKey"],
    state: { status: "success", data: { items: [] }, ...overrides } as QueryLike["state"],
  };
}

function mutation(
  mutationKey: readonly unknown[] | undefined,
  overrides: Partial<MutationLike["state"]> = {},
): MutationLike {
  return {
    options: { mutationKey },
    state: { status: "pending", isPaused: true, ...overrides },
  };
}

const persists = (key: readonly unknown[]) => policy.shouldDehydrateQuery(query(key));

describe("recipe queries — what MAY be written", () => {
  test("recipe lists, details, tags and collections", () => {
    expect(persists(h("recipes"))).toBe(true);
    expect(persists(h("recipe", "r1"))).toBe(true);
    expect(persists(h("tags"))).toBe(true);
    expect(persists(h("collections"))).toBe(true);
    expect(persists(h("collection", "c1"))).toBe(true);
  });

  test("a recipe list WITH filters (the key carries a filter object)", () => {
    expect(persists(h("recipes", { sort: "title" }))).toBe(true);
  });

  test("shopping lists — the one screen that is also EDITED offline", () => {
    expect(persists(h("shopping-lists"))).toBe(true);
    expect(persists(h("shopping-list", "l1"))).toBe(true);
  });

  test("the meal planner — read-only offline, like recipes/tags/collections", () => {
    expect(persists(h("plan", { from: "a", to: "b" }))).toBe(true);
  });

  test("the bought/history feed — read-only offline", () => {
    expect(persists(h("shopping-bought"))).toBe(true);
  });

  test("saved cards — a barcode is shown at a till, where there is no signal", () => {
    expect(persists(["toon", "recipe", "cards"])).toBe(true);
  });

  test("the bootstrap payload (core) still persists next to the module's keys", () => {
    expect(persists(["toon", "me"])).toBe(true);
  });
});

describe("recipe queries — what may NOT be written", () => {
  test("import drafts (mid-edit state must come from the server)", () => {
    expect(persists(h("imports"))).toBe(false);
    expect(persists(h("imports", { status: "ready" }))).toBe(false);
    expect(persists(h("import"))).toBe(false);
    expect(persists(h("import", "drafts", "all"))).toBe(false);
    expect(persists(h("import", "draft-1"))).toBe(false);
    expect(persists(["toon", "recipe", "import-draft"])).toBe(false);
    expect(persists(["toon", "recipe", "import-draft", "draft-1"])).toBe(false);
  });

  test("plan-shopping — a live server diff against one list, not the planner itself", () => {
    expect(persists(h("plan-shopping", "l1"))).toBe(false);
  });

  test("shopping-catalog — the 'Häufig gekauft' feed has no offline use case", () => {
    expect(persists(h("shopping-catalog"))).toBe(false);
  });

  test("anything BELOW the cards key — only the wallet itself is on the list", () => {
    expect(persists(["toon", "recipe", "cards", "x"])).toBe(false);
  });

  test("an UNKNOWN key — the list is allow, not deny, so new endpoints are excluded", () => {
    expect(persists(h("meal-plan"))).toBe(false);
    expect(persists(["something-else", "recipes"])).toBe(false);
    expect(persists([])).toBe(false);
  });

  test("toon-recipe's old key shapes (no module segment) match nothing", () => {
    expect(persists(["toon", "household", householdId, "recipes"])).toBe(false);
    expect(persists(["toon", "cards"])).toBe(false);
  });

  test("a pending or failed query — restoring it would read as 'no recipes'", () => {
    expect(policy.shouldDehydrateQuery(query(h("recipes"), { status: "pending" }))).toBe(false);
    expect(policy.shouldDehydrateQuery(query(h("recipes"), { status: "error" }))).toBe(false);
  });
});

describe("recipe mutations — the shopping outbox", () => {
  test("a PAUSED shopping mutation is queued for replay", () => {
    expect(policy.shouldDehydrateMutation(mutation(["toon", "recipe", "shopping", "check"]))).toBe(true);
    expect(policy.shouldDehydrateMutation(mutation(["toon", "recipe", "shopping", "add-items"]))).toBe(true);
  });

  test("every registered shopping mutation key is in the persisted namespace", () => {
    for (const key of Object.values(SHOPPING_MUTATION_KEYS)) {
      expect(policy.shouldDehydrateMutation(mutation(key))).toBe(true);
    }
  });

  test("a mutation that is NOT paused is never persisted", () => {
    expect(
      policy.shouldDehydrateMutation(mutation(["toon", "recipe", "shopping", "check"], { isPaused: false })),
    ).toBe(false);
    expect(
      policy.shouldDehydrateMutation(
        mutation(["toon", "recipe", "shopping", "check"], { isPaused: false, status: "success" }),
      ),
    ).toBe(false);
  });

  test("other features are excluded — replaying a recipe delete hours later is not a nicety", () => {
    expect(policy.shouldDehydrateMutation(mutation(["toon", "recipe", "recipes", "delete"]))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation(["toon", "auth", "logout"]))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation(["toon", "households", "update-role"]))).toBe(false);
  });

  test("an unkeyed, foreign or pre-module mutation is excluded", () => {
    expect(policy.shouldDehydrateMutation(mutation(undefined))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation([]))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation(["other", "recipe", "shopping"]))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation(["toon", "shopping", "check"]))).toBe(false);
  });
});
