// FIRST import, on purpose (H/CLAUDE.md "A module owns its layout route and its static import
// graph stays shell-free"): the manifest is evaluated before anything else; a path from its
// static graph back into the registry would crash this file with a TDZ `ReferenceError`.
import { financeModule } from "./index";
/**
 * The finance module's offline policy (SPEC D9; docs/plans/m3-finance-module.md §1 decision 12),
 * ported from F `apps/web/src/lib/persist.test.ts` (its finance cases) onto the
 * manifest-assembled policy: `buildPersistPolicy([financeModule])` with the household keys of
 * plan Table F (`["toon","household",<id>,"finance",<segment>,…]`) and the mutation namespace
 * `["toon","finance","tx",…]`.
 *
 * These are what stand between "erfassen funktioniert offline" and a stale or replayed plan
 * change, so they are pinned here rather than only in the manifest's prose. F's core cases
 * (`cacheKeyForUser`, `me`, sessions, invites) are the core's `lib/persist.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { buildPersistPolicy } from "@/modules/persist";
import { TX_MUTATION_KEYS } from "./features/transactions/lib/offline";

const policy = buildPersistPolicy([financeModule]);

type QueryLike = Parameters<typeof policy.shouldDehydrateQuery>[0];
type MutationLike = Parameters<typeof policy.shouldDehydrateMutation>[0];

const householdId = "11111111-1111-4111-8111-111111111111";
const h = (...rest: unknown[]) => ["toon", "household", householdId, "finance", ...rest];

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

describe("finance queries — what MAY be written", () => {
  test("transactions, plan, categories, tags, balance", () => {
    for (const segment of [
      "transactions",
      "transaction",
      "transaction-summary",
      "categories",
      "tags",
      "plan",
      "balance",
    ]) {
      expect(persists(h(segment))).toBe(true);
    }
  });

  test("a transaction list WITH filters (the key carries a filter object)", () => {
    expect(persists(h("transactions", { sort: "-bookedAt" }))).toBe(true);
    expect(persists(h("transactions", { kind: "MINE_SPLIT", q: "rewe" }))).toBe(true);
  });

  test("one transaction and a period summary", () => {
    expect(persists(h("transaction", "t1"))).toBe(true);
    expect(persists(h("transaction-summary", "2026-03"))).toBe(true);
  });

  test("the participants — a cold offline start must know the viewer's slot (decision 12)", () => {
    expect(persists(h("participants"))).toBe(true);
  });

  test("the bootstrap payload (core) still persists next to the module's keys", () => {
    expect(persists(["toon", "me"])).toBe(true);
  });
});

describe("finance queries — what may NOT be written", () => {
  test("live-only finance data: plan preview, plan runs, balance history, settlements", () => {
    expect(persists(h("plan-preview"))).toBe(false);
    expect(persists(h("plan-runs"))).toBe(false);
    expect(persists(h("balance-history"))).toBe(false);
    expect(persists(h("settlements"))).toBe(false);
  });

  test("household listings, members and invites (core; not needed offline, so not stored)", () => {
    expect(persists(["toon", "households"])).toBe(false);
    expect(persists(["toon", "household", householdId, "members"])).toBe(false);
    expect(persists(["toon", "household", householdId, "invites"])).toBe(false);
    expect(persists(["toon", "household", householdId, "detail"])).toBe(false);
  });

  test("security surfaces that must always be live", () => {
    expect(persists(["toon", "sessions"])).toBe(false);
    expect(persists(["toon", "invite", "token"])).toBe(false);
  });

  test("an UNKNOWN key — the list is allow, not deny, so new endpoints are excluded", () => {
    expect(persists(h("exports"))).toBe(false);
    expect(persists(["something-else", "transactions"])).toBe(false);
    expect(persists([])).toBe(false);
  });

  test("toon-finance's old key shapes (no module segment) match nothing", () => {
    expect(persists(["toon", "household", householdId, "transactions"])).toBe(false);
    expect(persists(["toon", "household", householdId, "balance"])).toBe(false);
  });

  test("a pending or failed query — restoring it would read as 'no transactions'", () => {
    expect(policy.shouldDehydrateQuery(query(h("transactions"), { status: "pending" }))).toBe(false);
    expect(policy.shouldDehydrateQuery(query(h("transactions"), { status: "error" }))).toBe(false);
  });
});

describe("finance mutations — the ledger outbox (F gotchas 7–10)", () => {
  test("a PAUSED transaction mutation is queued for replay", () => {
    expect(policy.shouldDehydrateMutation(mutation(["toon", "finance", "tx", "create"]))).toBe(true);
    expect(policy.shouldDehydrateMutation(mutation(["toon", "finance", "tx", "remove"]))).toBe(true);
  });

  test("every registered transaction mutation key is in the persisted namespace", () => {
    for (const key of Object.values(TX_MUTATION_KEYS)) {
      expect(policy.shouldDehydrateMutation(mutation(key))).toBe(true);
    }
  });

  /**
   * The whole point: a mutation that already reached the server must not be re-run on the next
   * launch. The API's mutation-claims ledger catches a duplicate for calls that carry a
   * mutationId, but this is the first line of defence.
   */
  test("a mutation that is NOT paused is never persisted", () => {
    expect(
      policy.shouldDehydrateMutation(mutation(["toon", "finance", "tx", "create"], { isPaused: false })),
    ).toBe(false);
    expect(
      policy.shouldDehydrateMutation(
        mutation(["toon", "finance", "tx", "create"], { isPaused: false, status: "success" }),
      ),
    ).toBe(false);
  });

  test("plan mutations are excluded — a late-replayed plan change is not a nicety (F gotcha 9)", () => {
    expect(policy.shouldDehydrateMutation(mutation(["toon", "finance", "plan", "run"]))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation(["toon", "finance", "plan", "update"]))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation(["toon", "finance", "categories", "create"]))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation(["toon", "finance", "participants", "update"]))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation(["toon", "auth", "logout"]))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation(["toon", "household", "update"]))).toBe(false);
  });

  test("an unkeyed, foreign or pre-module mutation is excluded", () => {
    expect(policy.shouldDehydrateMutation(mutation(undefined))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation([]))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation(["other", "finance", "tx"]))).toBe(false);
    // toon-finance's own key shape, without the module segment (plan Table F).
    expect(policy.shouldDehydrateMutation(mutation(["toon", "tx", "create"]))).toBe(false);
  });
});
