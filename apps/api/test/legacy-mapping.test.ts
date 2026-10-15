/**
 * The household mapping of `migrate:legacy` (plan m5 decision 10, task M5-T04): the proposal
 * `proposeHouseholdMapping`, the validator `validateMappingOverride` and the `--mapping` parser
 * `parseMappingFile`. Pure functions: no database, no files.
 */
import { describe, expect, test } from "bun:test";
import {
  type FinanceHouseholdInfo,
  type GroupInfo,
  type KnownIds,
  MappingError,
  parseMappingFile,
  proposeHouseholdMapping,
  validateMappingOverride,
} from "../scripts/legacy/mapping.ts";
import type { MappingOverride } from "../scripts/legacy/types.ts";

function group(id: string, memberIds: string[], recipeCount: number, createdAt: number): GroupInfo {
  return { id, name: `Group ${id}`, createdAt, memberIds, recipeCount };
}

function household(id: string, memberIds: string[], createdAt: number, createdBy?: string): FinanceHouseholdInfo {
  return {
    id,
    name: `Ledger ${id}`,
    createdAt,
    createdBy: createdBy ?? memberIds[0] ?? "nobody",
    members: memberIds.map((userId, index) => ({
      userId,
      slot: (index + 1) as 1 | 2,
      displayName: userId,
      joinedAt: createdAt + index,
    })),
  };
}

/** Every permutation of a small array (the determinism checks). */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}

function thrown(fn: () => unknown): MappingError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MappingError);
    return error as MappingError;
  }
  throw new Error("expected a MappingError, nothing was thrown");
}

describe("proposeHouseholdMapping", () => {
  test("one group holding both members: merge, only-group", () => {
    const result = proposeHouseholdMapping(
      [group("G1", ["anna", "ben"], 3, 10), group("G2", ["anna"], 9, 5)],
      [household("F1", ["anna", "ben"], 100)],
    );
    expect(result).toEqual([
      { financeHouseholdId: "F1", decision: "merge", groupId: "G1", reason: "only-group", addMembers: [] },
    ]);
  });

  test("two groups qualify: the one with more recipes, most-recipes", () => {
    const result = proposeHouseholdMapping(
      [group("G1", ["anna", "ben"], 2, 10), group("G2", ["anna", "ben", "cleo"], 5, 20)],
      [household("F1", ["anna", "ben"], 100)],
    );
    expect(result[0]).toMatchObject({ decision: "merge", groupId: "G2", reason: "most-recipes" });
  });

  test("equal recipe counts: the oldest group, tie-oldest", () => {
    const groups = [group("G1", ["anna", "ben"], 4, 30), group("G2", ["anna", "ben"], 4, 10)];
    const result = proposeHouseholdMapping(groups, [household("F1", ["anna", "ben"], 100)]);
    expect(result[0]).toMatchObject({ decision: "merge", groupId: "G2", reason: "tie-oldest" });
  });

  test("equal recipe counts and equal created_at: the lower id", () => {
    const groups = [group("Gb", ["anna", "ben"], 4, 10), group("Ga", ["anna", "ben"], 4, 10)];
    const result = proposeHouseholdMapping(groups, [household("F1", ["anna", "ben"], 100)]);
    expect(result[0]).toMatchObject({ groupId: "Ga", reason: "tie-oldest" });
  });

  test("no group holds both members: new, no-group", () => {
    const result = proposeHouseholdMapping(
      [group("G1", ["anna"], 3, 10), group("G2", ["ben"], 3, 10)],
      [household("F1", ["anna", "ben"], 100)],
    );
    expect(result).toEqual([{ financeHouseholdId: "F1", decision: "new", reason: "no-group", addMembers: [] }]);
  });

  test("a solo member in one group: merge", () => {
    const result = proposeHouseholdMapping(
      [group("G1", ["gina", "hugo"], 1, 10), group("G2", ["anna"], 7, 10)],
      [household("F1", ["gina"], 100)],
    );
    expect(result[0]).toMatchObject({ decision: "merge", groupId: "G1", reason: "only-group", addMembers: [] });
  });

  test("zero members: skip, no-members", () => {
    const result = proposeHouseholdMapping([group("G1", ["anna"], 1, 10)], [household("F1", [], 100)]);
    expect(result).toEqual([{ financeHouseholdId: "F1", decision: "skip", reason: "no-members", addMembers: [] }]);
  });

  test("zero members wins over an override", () => {
    const result = proposeHouseholdMapping([group("G1", ["anna"], 1, 10)], [household("F1", [], 100)], {
      override: { F1: "G1" },
    });
    expect(result[0]).toMatchObject({ decision: "skip", reason: "no-members" });
  });

  test("two households qualify for one group: the older merges, the other is new, group-taken", () => {
    const groups = [group("G1", ["anna", "ben"], 3, 10)];
    // input order puts the younger first: processing order is created_at, output order is input order
    const result = proposeHouseholdMapping(groups, [
      household("F2", ["anna", "ben"], 200),
      household("F1", ["anna", "ben"], 100),
    ]);
    expect(result).toEqual([
      { financeHouseholdId: "F2", decision: "new", reason: "group-taken", addMembers: [] },
      { financeHouseholdId: "F1", decision: "merge", groupId: "G1", reason: "only-group", addMembers: [] },
    ]);
  });

  test("equal created_at: the lower finance id is processed first", () => {
    const groups = [group("G1", ["anna", "ben"], 3, 10)];
    const result = proposeHouseholdMapping(groups, [
      household("Fb", ["anna", "ben"], 100),
      household("Fa", ["anna", "ben"], 100),
    ]);
    expect(result.map((e) => [e.financeHouseholdId, e.decision, e.reason])).toEqual([
      ["Fb", "new", "group-taken"],
      ["Fa", "merge", "only-group"],
    ]);
  });

  test("two households qualify for G1 and G2: the second falls back to G2", () => {
    const groups = [group("G1", ["anna", "ben"], 9, 10), group("G2", ["anna", "ben"], 5, 20)];
    const result = proposeHouseholdMapping(groups, [
      household("F1", ["anna", "ben"], 100),
      household("F2", ["anna", "ben"], 200),
    ]);
    expect(result[0]).toMatchObject({ decision: "merge", groupId: "G1", reason: "most-recipes" });
    // G1 is taken, so G2 is the only candidate left (decision 10: taken groups are removed first)
    expect(result[1]).toMatchObject({ decision: "merge", groupId: "G2", reason: "only-group" });
  });

  test("the fallback picks by most recipes among the groups left", () => {
    const groups = [
      group("G1", ["anna", "ben"], 9, 10),
      group("G2", ["anna", "ben"], 5, 20),
      group("G3", ["anna", "ben"], 2, 5),
    ];
    const result = proposeHouseholdMapping(groups, [
      household("F1", ["anna", "ben"], 100),
      household("F2", ["anna", "ben"], 200),
    ]);
    expect(result[0]).toMatchObject({ groupId: "G1", reason: "most-recipes" });
    expect(result[1]).toMatchObject({ groupId: "G2", reason: "most-recipes" });
  });

  test("override to a group lacking a member: merge, mapping, addMembers", () => {
    const result = proposeHouseholdMapping(
      [group("G1", ["cleo"], 1, 10), group("G3", ["cleo", "dana"], 2, 10)],
      [household("F1", ["cleo", "dana"], 100)],
      { override: { F1: "G1" } },
    );
    expect(result).toEqual([
      { financeHouseholdId: "F1", decision: "merge", groupId: "G1", reason: "mapping", addMembers: ["dana"] },
    ]);
  });

  test("override \"new\": new, mapping, although a group qualifies", () => {
    const result = proposeHouseholdMapping(
      [group("G1", ["anna", "ben"], 3, 10)],
      [household("F1", ["anna", "ben"], 100)],
      { override: { F1: "new" } },
    );
    expect(result).toEqual([{ financeHouseholdId: "F1", decision: "new", reason: "mapping", addMembers: [] }]);
  });

  test("override entries take their group before the proposals", () => {
    const groups = [group("G1", ["anna", "ben"], 9, 10), group("G2", ["anna", "ben"], 1, 20)];
    // F1 is older and would propose G1; F2's override claims G1 first
    const result = proposeHouseholdMapping(
      groups,
      [household("F1", ["anna", "ben"], 100), household("F2", ["anna", "ben"], 200)],
      { override: { F2: "G1" } },
    );
    expect(result[0]).toMatchObject({ financeHouseholdId: "F1", decision: "merge", groupId: "G2", reason: "only-group" });
    expect(result[1]).toMatchObject({ financeHouseholdId: "F2", decision: "merge", groupId: "G1", reason: "mapping" });
  });

  test("an override taking the only group leaves the other household group-taken", () => {
    const result = proposeHouseholdMapping(
      [group("G1", ["anna", "ben"], 9, 10)],
      [household("F1", ["anna", "ben"], 100), household("F2", ["anna", "ben"], 200)],
      { override: { F2: "G1" } },
    );
    expect(result[0]).toMatchObject({ decision: "new", reason: "group-taken" });
  });

  test("alreadyMapped wins over an override and keeps its target", () => {
    const groups = [group("G1", ["anna", "ben"], 9, 10), group("G2", ["anna", "ben"], 1, 20)];
    const result = proposeHouseholdMapping(groups, [household("F1", ["anna", "ben"], 100)], {
      override: { F1: "G2" },
      alreadyMapped: new Map([["F1", "G1"]]),
    });
    expect(result).toEqual([
      { financeHouseholdId: "F1", decision: "merge", groupId: "G1", reason: "already-migrated", addMembers: [] },
    ]);
  });

  test("alreadyMapped to a household that is not a group: new with the target id", () => {
    const result = proposeHouseholdMapping(
      [group("G1", ["anna", "ben"], 9, 10)],
      [household("F1", ["anna", "ben"], 100)],
      { alreadyMapped: new Map([["F1", "target-xyz"]]) },
    );
    expect(result).toEqual([
      {
        financeHouseholdId: "F1",
        decision: "new",
        targetHouseholdId: "target-xyz",
        reason: "already-migrated",
        addMembers: [],
      },
    ]);
  });

  test("a group an already-migrated household holds is taken for the proposals", () => {
    const result = proposeHouseholdMapping(
      [group("G1", ["anna", "ben"], 9, 10)],
      [household("F1", ["anna", "ben"], 100), household("F2", ["anna", "ben"], 50)],
      { alreadyMapped: new Map([["F1", "G1"]]) },
    );
    expect(result[1]).toMatchObject({ financeHouseholdId: "F2", decision: "new", reason: "group-taken" });
  });

  test("an override naming a group an already-migrated household holds is a MappingError", () => {
    const error = thrown(() =>
      proposeHouseholdMapping(
        [group("G1", ["anna", "ben"], 9, 10)],
        [household("F1", ["anna", "ben"], 100), household("F2", ["anna", "ben"], 200)],
        { override: { F2: "G1" }, alreadyMapped: new Map([["F1", "G1"]]) },
      ),
    );
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain("G1");
    expect(error.message).toContain("F1");
  });

  test("an override naming a group missing from the groups is a MappingError", () => {
    const error = thrown(() =>
      proposeHouseholdMapping([group("G1", ["anna"], 1, 10)], [household("F1", ["anna"], 100)], {
        override: { F1: "G9" },
      }),
    );
    expect(error.message).toContain("G9");
  });

  test("output order is the input order of finance", () => {
    const finance = [household("F3", [], 300), household("F1", ["anna"], 100), household("F2", ["x"], 200)];
    const result = proposeHouseholdMapping([group("G1", ["anna"], 1, 10)], finance);
    expect(result.map((e) => e.financeHouseholdId)).toEqual(["F3", "F1", "F2"]);
  });

  test("deterministic for any array order of groups (and of finance)", () => {
    const groups = [
      group("G1", ["anna", "ben"], 4, 30),
      group("G2", ["anna", "ben", "cleo"], 4, 10),
      group("G3", ["cleo", "dana"], 7, 20),
      group("G4", ["anna", "ben"], 2, 5),
      group("G5", ["gina"], 0, 5),
    ];
    const finance = [
      household("F1", ["anna", "ben"], 100),
      household("F2", ["anna", "ben"], 150),
      household("F3", ["cleo", "dana"], 120),
      household("F4", ["anna", "ben"], 200),
      household("F5", ["gina"], 90),
      household("F6", ["emil"], 80),
    ];
    const byId = (entries: ReturnType<typeof proposeHouseholdMapping>) =>
      Object.fromEntries(entries.map((e) => [e.financeHouseholdId, e]));
    const reference = byId(proposeHouseholdMapping(groups, finance));
    expect(reference.F1).toMatchObject({ groupId: "G2", reason: "tie-oldest" });
    expect(reference.F2).toMatchObject({ groupId: "G1", reason: "most-recipes" });
    expect(reference.F4).toMatchObject({ groupId: "G4", reason: "only-group" });
    expect(reference.F3).toMatchObject({ groupId: "G3", reason: "only-group" });
    expect(reference.F5).toMatchObject({ groupId: "G5", reason: "only-group" });
    expect(reference.F6).toMatchObject({ decision: "new", reason: "no-group" });
    for (const order of permutations(groups)) {
      expect(byId(proposeHouseholdMapping(order, finance))).toEqual(reference);
    }
    for (const order of [[...finance].reverse(), [finance[3], finance[0], finance[5], finance[1], finance[4], finance[2]]]) {
      expect(byId(proposeHouseholdMapping(groups, order as FinanceHouseholdInfo[]))).toEqual(reference);
    }
  });

  test("does not mutate its inputs", () => {
    const groups = [group("G2", ["anna"], 1, 20), group("G1", ["anna"], 5, 10)];
    const finance = [household("F2", ["anna"], 200), household("F1", ["anna"], 100)];
    const before = JSON.stringify([groups, finance]);
    proposeHouseholdMapping(groups, finance, { override: { F2: "G2" } });
    expect(JSON.stringify([groups, finance])).toBe(before);
  });
});

const KNOWN: KnownIds = {
  groupIds: new Set(["G1", "G2", "G3"]),
  financeIds: new Set(["F1", "F2", "F3"]),
};

/** Each invalid override, its file text and the id its message must name. */
const INVALID: { name: string; override: Record<string, unknown>; names: string }[] = [
  { name: "unknown finance id", override: { "no-such-id": "new" }, names: "no-such-id" },
  { name: "unknown group id", override: { F1: "G9" }, names: "G9" },
  { name: "non-string value", override: { F2: 42 }, names: "F2" },
  { name: "null value", override: { F3: null }, names: "F3" },
  { name: "two entries naming one group", override: { F1: "G1", F2: "G1" }, names: "G1" },
];

describe("parseMappingFile", () => {
  test("a valid file returns the override", () => {
    const text = JSON.stringify({ finance: { F1: "G1", F2: "new", F3: "new" } });
    expect(parseMappingFile(text, KNOWN)).toEqual({ F1: "G1", F2: "new", F3: "new" });
  });

  test("an empty finance object is valid", () => {
    expect(parseMappingFile(`{"finance": {}}`, KNOWN)).toEqual({});
  });

  test("invalid JSON", () => {
    const error = thrown(() => parseMappingFile(`{"finance": {"F1": "G1",}`, KNOWN));
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain("not valid JSON");
  });

  test("a top-level key other than finance", () => {
    const error = thrown(() => parseMappingFile(JSON.stringify({ finance: {}, recipe: {} }), KNOWN));
    expect(error.message).toContain(`"recipe"`);
  });

  test("a top-level value that is not an object", () => {
    expect(thrown(() => parseMappingFile(`["F1"]`, KNOWN)).message).toContain("object");
    expect(thrown(() => parseMappingFile(`null`, KNOWN)).message).toContain("object");
  });

  test("finance that is not an object (or missing)", () => {
    for (const text of [`{"finance": ["F1"]}`, `{"finance": "G1"}`, `{"finance": null}`, `{}`]) {
      expect(thrown(() => parseMappingFile(text, KNOWN)).message).toContain(`"finance" must be an object`);
    }
  });

  for (const { name, override, names } of INVALID) {
    test(`${name}: names the offending id`, () => {
      const error = thrown(() => parseMappingFile(JSON.stringify({ finance: override }), KNOWN));
      expect(error.exitCode).toBe(2);
      expect(error.message).toContain(names);
    });
  }
});

describe("validateMappingOverride", () => {
  for (const { name, override, names } of INVALID) {
    test(`${name}: the same MappingError as through parseMappingFile`, () => {
      const raw = thrown(() => validateMappingOverride(override as MappingOverride, KNOWN));
      const viaFile = thrown(() => parseMappingFile(JSON.stringify({ finance: override }), KNOWN));
      expect(raw.exitCode).toBe(2);
      expect(raw.message).toContain(names);
      expect(raw.message).toBe(viaFile.message);
    });
  }

  test("two \"new\" entries are accepted", () => {
    expect(() => validateMappingOverride({ F1: "new", F2: "new" }, KNOWN)).not.toThrow();
  });

  test("an empty override is accepted", () => {
    expect(() => validateMappingOverride({}, KNOWN)).not.toThrow();
  });

  test("distinct groups plus new are accepted", () => {
    expect(() => validateMappingOverride({ F1: "G1", F2: "G2", F3: "new" }, KNOWN)).not.toThrow();
  });

  test("a group id is not accepted as a finance key", () => {
    expect(thrown(() => validateMappingOverride({ G1: "new" }, KNOWN)).message).toContain("G1");
  });

  test("parseMappingFile goes through validateMappingOverride (same first error)", () => {
    // two errors in one override: both paths report the first in key order
    const override = { F1: "G9", "no-such-id": "new" };
    const raw = thrown(() => validateMappingOverride(override, KNOWN));
    const viaFile = thrown(() => parseMappingFile(JSON.stringify({ finance: override }), KNOWN));
    expect(raw.message).toBe(viaFile.message);
    expect(raw.message).toContain("G9");
  });
});
