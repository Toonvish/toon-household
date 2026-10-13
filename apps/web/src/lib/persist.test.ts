/**
 * The offline-cache allow-list factories and the per-account key.
 *
 * These are the things that stand between "browse your data offline" and "user B sees
 * user A's data on a shared phone", so they get pinned down here rather than only in the
 * prose of persist.ts. The factories take their inputs from the module manifests (SPEC
 * D9); the tests feed them a FAKE allow-list so the prefix, exact and scope semantics are
 * proven without knowing any real module.
 *
 * Pure functions only — `bun test` has no IndexedDB, and the storage helpers already
 * degrade silently without `window` (see lib/storage.ts). `bun:test` types come from
 * apps/web/tsconfig.test.json, which is the project that type-checks this file —
 * apps/web/tsconfig.json excludes it.
 */
import { describe, expect, test } from "bun:test";
import {
  PERSIST_BUSTER,
  cacheKeyForUser,
  createShouldPersistMutation,
  createShouldPersistQuery,
  shouldPersistMutation,
  shouldPersistQuery,
  type QueryKeyPrefix,
} from "./persist";

type QueryLike = Parameters<typeof shouldPersistQuery>[0];

/** A successful query with some data, which is the only persistable shape. */
function query(queryKey: readonly unknown[], overrides: Partial<QueryLike["state"]> = {}): QueryLike {
  return {
    queryKey: queryKey as QueryLike["queryKey"],
    state: { status: "success", data: { items: [] }, ...overrides } as QueryLike["state"],
  };
}

const FAKE_ALLOW_LIST: readonly QueryKeyPrefix[] = [
  { scope: "household", path: ["recipe", "recipes"] },
  { scope: "household", path: ["recipe", "detail"], exact: true },
  { scope: "user", path: ["recipe", "cards"], exact: true },
  { scope: "user", path: ["finance", "prefs"] },
];

const shouldPersist = createShouldPersistQuery(FAKE_ALLOW_LIST);

describe("PERSIST_BUSTER", () => {
  test("is household-v1 — asserted so the bump cannot be lost in a merge", () => {
    expect(PERSIST_BUSTER).toBe("household-v1");
  });
});

describe("cacheKeyForUser", () => {
  test("namespaces by user id — two accounts can never read one blob", () => {
    expect(cacheKeyForUser("a1")).toBe("user:a1");
    expect(cacheKeyForUser("a1")).not.toBe(cacheKeyForUser("b2"));
  });
});

describe("createShouldPersistQuery — what MAY be written", () => {
  const householdId = "11111111-1111-4111-8111-111111111111";

  test("a household prefix matches the key itself and everything below it", () => {
    expect(shouldPersist(query(["toon", "household", householdId, "recipe", "recipes"]))).toBe(true);
    expect(
      shouldPersist(query(["toon", "household", householdId, "recipe", "recipes", { sort: "title" }])),
    ).toBe(true);
    expect(shouldPersist(query(["toon", "household", householdId, "recipe", "recipes", "r1"]))).toBe(
      true,
    );
  });

  test("the household id is a wildcard segment, any household matches", () => {
    expect(shouldPersist(query(["toon", "household", "other-id", "recipe", "recipes"]))).toBe(true);
  });

  test("an exact household prefix matches only the key itself", () => {
    expect(shouldPersist(query(["toon", "household", householdId, "recipe", "detail"]))).toBe(true);
    expect(shouldPersist(query(["toon", "household", householdId, "recipe", "detail", "r1"]))).toBe(
      false,
    );
  });

  test("a user prefix matches ['toon', ...path, ...rest]", () => {
    expect(shouldPersist(query(["toon", "finance", "prefs"]))).toBe(true);
    expect(shouldPersist(query(["toon", "finance", "prefs", "currency"]))).toBe(true);
  });

  test("an exact user prefix matches only the key itself", () => {
    expect(shouldPersist(query(["toon", "recipe", "cards"]))).toBe(true);
    expect(shouldPersist(query(["toon", "recipe", "cards", "c1"]))).toBe(false);
  });

  test("the bootstrap payload is persisted even with an empty allow-list", () => {
    expect(shouldPersist(query(["toon", "me"]))).toBe(true);
    expect(shouldPersistQuery(query(["toon", "me"]))).toBe(true);
  });
});

describe("createShouldPersistQuery — what may NOT be written", () => {
  const householdId = "11111111-1111-4111-8111-111111111111";

  test("scope is enforced: a household path does not match a user key and vice versa", () => {
    expect(shouldPersist(query(["toon", "recipe", "recipes"]))).toBe(false);
    expect(shouldPersist(query(["toon", "household", "recipe", "cards"]))).toBe(false);
    expect(shouldPersist(query(["toon", "household", householdId, "finance", "prefs"]))).toBe(false);
  });

  test("a household key needs an id segment before the path", () => {
    expect(shouldPersist(query(["toon", "household"]))).toBe(false);
    expect(shouldPersist(query(["toon", "household", "recipe", "recipes"]))).toBe(false);
  });

  test("a partial path is not a match", () => {
    expect(shouldPersist(query(["toon", "household", householdId, "recipe"]))).toBe(false);
    expect(shouldPersist(query(["toon", "household", householdId]))).toBe(false);
  });

  test("security surfaces that must always be live", () => {
    expect(shouldPersist(query(["toon", "sessions"]))).toBe(false);
    expect(shouldPersist(query(["toon", "oauth-providers"]))).toBe(false);
    expect(shouldPersist(query(["toon", "invite", "token"]))).toBe(false);
  });

  test("household listings and members (not on the list, so not stored)", () => {
    expect(shouldPersist(query(["toon", "households"]))).toBe(false);
    expect(shouldPersist(query(["toon", "household", householdId, "members"]))).toBe(false);
  });

  test("an UNKNOWN key — the list is allow, not deny, so new endpoints are excluded", () => {
    expect(shouldPersist(query(["toon", "household", householdId, "recipe", "imports"]))).toBe(false);
    expect(shouldPersist(query(["something-else", "recipe", "cards"]))).toBe(false);
    expect(shouldPersist(query([]))).toBe(false);
  });

  test("an empty path never matches (it would allow everything)", () => {
    const everything = createShouldPersistQuery([{ scope: "user", path: [] }]);
    expect(everything(query(["toon", "anything"]))).toBe(false);
    expect(everything(query(["toon", "me"]))).toBe(true);
  });

  test("the default export is the core-only policy: only the bootstrap key", () => {
    expect(shouldPersistQuery(query(["toon", "household", householdId, "recipe", "recipes"]))).toBe(
      false,
    );
    expect(shouldPersistQuery(query(["toon", "recipe", "cards"]))).toBe(false);
  });

  test("a pending or failed query — restoring it would read as 'no data'", () => {
    const key = ["toon", "household", householdId, "recipe", "recipes"];
    expect(shouldPersist(query(key, { status: "pending" }))).toBe(false);
    expect(shouldPersist(query(key, { status: "error" }))).toBe(false);
  });

  test("a successful but empty `me` (logged out) is not worth storing", () => {
    expect(shouldPersist(query(["toon", "me"], { data: null }))).toBe(false);
    expect(shouldPersist(query(["toon", "me"], { data: undefined }))).toBe(false);
  });

  test("a successful but empty allow-listed query is not stored either", () => {
    expect(
      shouldPersist(query(["toon", "household", householdId, "recipe", "recipes"], { data: null })),
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* the write half: queued offline mutations                                   */
/* -------------------------------------------------------------------------- */

type MutationLike = Parameters<typeof shouldPersistMutation>[0];

function mutation(
  mutationKey: readonly unknown[] | undefined,
  overrides: Partial<MutationLike["state"]> = {},
): MutationLike {
  return {
    options: { mutationKey },
    state: { status: "pending", isPaused: true, ...overrides },
  };
}

describe("createShouldPersistMutation", () => {
  const persistMutation = createShouldPersistMutation([["recipe", "shopping"], ["finance", "tx"]]);

  test("a PAUSED mutation inside a declared namespace is queued for replay", () => {
    expect(persistMutation(mutation(["toon", "recipe", "shopping", "check"]))).toBe(true);
    expect(persistMutation(mutation(["toon", "finance", "tx", "create"]))).toBe(true);
    expect(persistMutation(mutation(["toon", "finance", "tx"]))).toBe(true);
  });

  /**
   * The whole point: a mutation that already reached the server must not be re-run on
   * the next launch. The API's ledger catches a duplicate for calls that carry a
   * mutationId, but this is the first line of defence.
   */
  test("a mutation that is NOT paused is never persisted", () => {
    expect(
      persistMutation(mutation(["toon", "finance", "tx", "create"], { isPaused: false })),
    ).toBe(false);
    expect(
      persistMutation(
        mutation(["toon", "finance", "tx", "create"], { isPaused: false, status: "success" }),
      ),
    ).toBe(false);
  });

  test("namespaces are matched as a whole path, not a first segment", () => {
    expect(persistMutation(mutation(["toon", "finance", "accounts", "delete"]))).toBe(false);
    expect(persistMutation(mutation(["toon", "finance"]))).toBe(false);
    expect(persistMutation(mutation(["toon", "recipe", "recipes", "delete"]))).toBe(false);
  });

  test("core and other features are excluded", () => {
    expect(persistMutation(mutation(["toon", "auth", "logout"]))).toBe(false);
    expect(persistMutation(mutation(["toon", "households", "update-role"]))).toBe(false);
  });

  test("an unkeyed or foreign mutation is excluded", () => {
    expect(persistMutation(mutation(undefined))).toBe(false);
    expect(persistMutation(mutation([]))).toBe(false);
    expect(persistMutation(mutation(["other", "finance", "tx"]))).toBe(false);
  });

  test("an empty namespace never matches (it would allow everything)", () => {
    expect(createShouldPersistMutation([[]])(mutation(["toon", "finance", "tx"]))).toBe(false);
  });

  test("the default export is the core-only policy: nothing is persisted", () => {
    expect(shouldPersistMutation(mutation(["toon", "finance", "tx", "create"]))).toBe(false);
    expect(shouldPersistMutation(mutation(["toon", "recipe", "shopping", "check"]))).toBe(false);
  });
});
