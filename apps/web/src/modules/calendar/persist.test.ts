// FIRST import, on purpose (CLAUDE.md "A module owns its layout route and its static import graph stays
// shell-free"): the manifest is evaluated before anything else; a path from its static graph back into the registry
// would crash this file with a TDZ `ReferenceError`.
import { calendarModule } from "./index";
/**
 * The calendar module's offline policy (SPEC D9, plan m8 P24): `buildPersistPolicy([calendarModule])` persists the
 * five read segments under `["toon","household",<id>,"calendar",…]` and nothing else; writes are online only, so no
 * calendar mutation is ever persisted.
 */
import { describe, expect, test } from "bun:test";
import { buildPersistPolicy } from "@/modules/persist";
import { calendarKeys } from "./lib/queries";

const policy = buildPersistPolicy([calendarModule]);

type QueryLike = Parameters<typeof policy.shouldDehydrateQuery>[0];
type MutationLike = Parameters<typeof policy.shouldDehydrateMutation>[0];

const householdId = "11111111-1111-4111-8111-111111111111";
const h = (...rest: unknown[]) => ["toon", "household", householdId, "calendar", ...rest];

function query(queryKey: readonly unknown[], overrides: Partial<QueryLike["state"]> = {}): QueryLike {
  return {
    queryKey: queryKey as QueryLike["queryKey"],
    state: { status: "success", data: { items: [] }, ...overrides } as QueryLike["state"],
  };
}

function mutation(mutationKey: readonly unknown[] | undefined): MutationLike {
  return { options: { mutationKey }, state: { status: "pending", isPaused: true } };
}

const persists = (key: readonly unknown[]) => policy.shouldDehydrateQuery(query(key));

describe("calendar queries — what MAY be written", () => {
  test("the five persisted segments", () => {
    for (const segment of ["occurrences", "entries", "entry", "resources", "waste"]) {
      expect(persists(h(segment))).toBe(true);
    }
  });

  test("the keys calendarKeys builds persist, filters and all", () => {
    expect(persists(calendarKeys.occurrences(householdId, "2027-01-01", "2027-01-14", { memberId: "x" }))).toBe(true);
    expect(persists(calendarKeys.entries(householdId, { kind: "task", recurring: "true" }))).toBe(true);
    expect(persists(calendarKeys.entry(householdId, "e1"))).toBe(true);
    expect(persists(calendarKeys.resources(householdId, true))).toBe(true);
    expect(persists(calendarKeys.waste(householdId, "2027-01-01"))).toBe(true);
  });

  test("the key layout of plan section 5.4", () => {
    expect(calendarKeys.all(householdId)).toEqual(["toon", "household", householdId, "calendar"]);
    expect<readonly unknown[]>(calendarKeys.occurrences(householdId, "2027-01-01", "2027-01-14", { kind: "task", memberId: undefined })).toEqual(
      h("occurrences", "2027-01-01", "2027-01-14", { kind: "task" }),
    );
    expect<readonly unknown[]>(calendarKeys.resources(householdId)).toEqual(h("resources", { includeArchived: false }));
    const keys: ReadonlyArray<readonly unknown[]> = [
      calendarKeys.occurrences(householdId, "a", "b"),
      calendarKeys.entries(householdId),
      calendarKeys.entry(householdId, "e"),
      calendarKeys.resources(householdId),
      calendarKeys.waste(householdId, "a"),
    ];
    for (const key of keys) expect(key.slice(0, 4)).toEqual([...calendarKeys.all(householdId)]);
  });
});

describe("calendar queries — what may NOT be written", () => {
  test("a foreign or unknown segment, the bare module prefix, another module's keys", () => {
    expect(persists(h("conflicts"))).toBe(false);
    expect(persists(h("waste-preview"))).toBe(false);
    // The subscription link is live data (plan m9 P17): `lastUsedAt` must come from the server.
    expect(persists(h("feed"))).toBe(false);
    expect(persists(calendarKeys.feed(householdId))).toBe(false);
    expect(persists(h())).toBe(false);
    expect(persists(["toon", "household", householdId, "finance", "transactions"])).toBe(false);
    expect(persists(["toon", "household", householdId, "occurrences"])).toBe(false);
    expect(persists(["toon", "calendar", "occurrences"])).toBe(false);
  });

  test("a pending or failed query", () => {
    expect(policy.shouldDehydrateQuery(query(h("occurrences"), { status: "pending" }))).toBe(false);
    expect(policy.shouldDehydrateQuery(query(h("occurrences"), { status: "error" }))).toBe(false);
  });
});

describe("calendar mutations — online only (P24)", () => {
  test("no outbox: the manifest declares no mutation namespace and no defaults", () => {
    expect("persistMutationNamespaces" in calendarModule).toBe(false);
    expect("mutationDefaults" in calendarModule).toBe(false);
  });

  test("a paused calendar mutation is never persisted", () => {
    expect(policy.shouldDehydrateMutation(mutation(["toon", "calendar", "entries", "create"]))).toBe(false);
    expect(policy.shouldDehydrateMutation(mutation(["toon", "household", householdId, "calendar"]))).toBe(false);
  });
});
