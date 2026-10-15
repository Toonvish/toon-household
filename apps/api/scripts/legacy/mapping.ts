/**
 * The household mapping of `migrate:legacy` (SPEC §6.3, D12; plan m5 decision 10, task M5-T04).
 *
 * Which toon-recipe group a toon-finance household lands in: the decision function
 * `proposeHouseholdMapping`, the `--mapping` validator `validateMappingOverride` and the file
 * parser `parseMappingFile`. Pure: no I/O, no `Date`, no database; the callers (`households.ts`,
 * the CLI) read the inputs from the opened snapshots and the ledger.
 *
 * Id spaces ("Where the mapping checks live"): every USER id here is a UNIFIED id (after the
 * users step's maps); group ids (`GroupInfo.id`, override values, `ProposalEntry.groupId`) and
 * finance household ids (`FinanceHouseholdInfo.id`, override keys) are LEGACY ids, which
 * `migrateHouseholds` translates through `ctx.ids.households.recipe`.
 *
 * Every id and duplicate check lives in `validateMappingOverride`; `parseMappingFile` only parses
 * (JSON, the top-level shape) and then calls it, so the file path and the raw-object path cannot
 * disagree.
 */
import type { DecisionReason, MappingOverride } from "./types.ts";

/** One toon-recipe group (R `groups` + `group_members` + the `recipes` count). */
export interface GroupInfo {
  id: string; // legacy R groups.id
  name: string;
  createdAt: number;
  memberIds: string[]; // unified user ids
  recipeCount: number;
}

/** One toon-finance household (F `households` + `household_members`). */
export interface FinanceHouseholdInfo {
  id: string; // legacy F households.id
  name: string;
  createdAt: number;
  createdBy: string; // unified user id
  members: { userId: string; slot: 1 | 2; displayName: string; joinedAt: number }[];
}

/** The decision for one finance household; `groupId` is a LEGACY group id. */
export interface ProposalEntry {
  financeHouseholdId: string;
  decision: "merge" | "new" | "skip";
  groupId?: string;
  /**
   * Only on an `already-migrated` entry whose ledger target is not one of the given groups' ids:
   * the TARGET household id the earlier run wrote (the caller resolves it, not the proposal).
   */
  targetHouseholdId?: string;
  reason: DecisionReason;
  addMembers: string[]; // unified user ids added to a mapped group as `member`
}

/** A bad `--mapping` (file or raw object): exit 2, nothing written anywhere. */
export class MappingError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = "MappingError";
  }
}

/** The ids the snapshots know: R `groups.id` and F `households.id` (both LEGACY ids). */
export interface KnownIds {
  groupIds: Set<string>;
  financeIds: Set<string>;
}

/** The override value that asks for a household of its own. */
const NEW = "new";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every id and duplicate check of a `MappingOverride` (decision 10): an unknown finance household
 * id, a value that is not a string, a group id that is not a recipe group, two entries naming the
 * same group. `"new"` may repeat; an empty override is valid. Throws `MappingError` naming the
 * offending id; checks entries in key order so the first error is deterministic.
 */
export function validateMappingOverride(override: MappingOverride, known: KnownIds): void {
  if (!isPlainObject(override)) {
    throw new MappingError(`--mapping: "finance" must be an object of <finance household id>: <group id> | "new"`);
  }
  const claimedBy = new Map<string, string>(); // group id -> finance id that named it first
  for (const [financeId, value] of Object.entries(override as Record<string, unknown>)) {
    if (!known.financeIds.has(financeId)) {
      throw new MappingError(`--mapping: unknown finance household id "${financeId}"`);
    }
    if (typeof value !== "string") {
      throw new MappingError(
        `--mapping: the value for finance household "${financeId}" must be a recipe group id or "new", got ${JSON.stringify(value) ?? String(value)}`,
      );
    }
    if (value === NEW) continue;
    if (!known.groupIds.has(value)) {
      throw new MappingError(
        `--mapping: "${value}" (for finance household "${financeId}") is not a recipe group id`,
      );
    }
    const first = claimedBy.get(value);
    if (first !== undefined) {
      throw new MappingError(
        `--mapping: finance households "${first}" and "${financeId}" both name recipe group "${value}"`,
      );
    }
    claimedBy.set(value, financeId);
  }
}

/**
 * Parses a `--mapping` file (`{"finance": {"<H.id>": "<G.id>" | "new"}}`, SPEC §6.3): invalid JSON,
 * a top-level key other than `finance` and a `finance` that is not an object are errors here; the
 * id and duplicate checks are `validateMappingOverride`'s.
 */
export function parseMappingFile(text: string, known: KnownIds): MappingOverride {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new MappingError(`--mapping: the file is not valid JSON (${detail})`);
  }
  if (!isPlainObject(parsed)) {
    throw new MappingError(`--mapping: the file must hold an object {"finance": {…}}`);
  }
  for (const key of Object.keys(parsed)) {
    if (key !== "finance") {
      throw new MappingError(`--mapping: unknown top-level key "${key}" (only "finance" is allowed)`);
    }
  }
  const finance = parsed.finance;
  if (!isPlainObject(finance)) {
    throw new MappingError(`--mapping: "finance" must be an object of <finance household id>: <group id> | "new"`);
  }
  const override = finance as MappingOverride;
  validateMappingOverride(override, known);
  return override;
}

/** Groups ordered for the choice: recipe count desc, then `createdAt` asc, then id asc. */
function compareGroups(a: GroupInfo, b: GroupInfo): number {
  if (a.recipeCount !== b.recipeCount) return b.recipeCount - a.recipeCount;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Finance households in processing order: `createdAt` asc, then id asc. */
function compareFinance(a: FinanceHouseholdInfo, b: FinanceHouseholdInfo): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The decision of decision 10 for every finance household, in the input order of `finance`.
 *
 * Precedence per household: an entry of `alreadyMapped` (finance id -> the TARGET household id an
 * earlier run recorded) keeps that target, reason `already-migrated`, and an override entry for it
 * is ignored (the caller warns); a household without members is `skip` / `no-members`; an override
 * entry is `merge` into its group (members it lacks in `addMembers`) or `new`, reason `mapping`;
 * the rest is proposed. An `already-migrated` value that is one of `groups`' ids reads as `merge`
 * into that group, any other value as `new` with `targetHouseholdId` (a caller that knows a
 * re-keyed group's target translates it back to the legacy group id first).
 *
 * Groups are taken in this order: `already-migrated` merges, then override entries, then the
 * proposals by finance `createdAt` asc, then id asc. A proposal's candidates are the groups whose
 * members include all of the household's members, ordered by recipe count desc, `createdAt` asc,
 * id asc, minus the taken ones: one left → `only-group`; several → the first, `most-recipes`, or
 * `tie-oldest` when the first two have the same recipe count; none left but some taken →
 * `new` / `group-taken`; none at all → `new` / `no-group`. Deterministic for any array order of
 * `groups` (and of `finance`, apart from the output order).
 *
 * Throws `MappingError` when an override names a group that is not in `groups`, or a group an
 * already-migrated finance household holds: both would put two ledgers into one household.
 */
export function proposeHouseholdMapping(
  groups: GroupInfo[],
  finance: FinanceHouseholdInfo[],
  options: { override?: MappingOverride; alreadyMapped?: Map<string, string> } = {},
): ProposalEntry[] {
  const override = options.override ?? {};
  const alreadyMapped = options.alreadyMapped ?? new Map<string, string>();
  const sortedGroups = [...groups].sort(compareGroups);
  const groupById = new Map(sortedGroups.map((g) => [g.id, g] as const));
  const ordered = [...finance].sort(compareFinance);

  const entries = new Map<string, ProposalEntry>();
  const taken = new Map<string, string>(); // group id -> finance id that holds it

  // 1. already-migrated: the ledger's target stands, whatever the override says.
  for (const household of ordered) {
    const target = alreadyMapped.get(household.id);
    if (target === undefined) continue;
    if (groupById.has(target)) {
      entries.set(household.id, {
        financeHouseholdId: household.id,
        decision: "merge",
        groupId: target,
        reason: "already-migrated",
        addMembers: [],
      });
      taken.set(target, household.id);
    } else {
      entries.set(household.id, {
        financeHouseholdId: household.id,
        decision: "new",
        targetHouseholdId: target,
        reason: "already-migrated",
        addMembers: [],
      });
    }
  }

  // 2. no members: nothing to seat, all rows are skipped (an override cannot change that).
  for (const household of ordered) {
    if (entries.has(household.id) || household.members.length > 0) continue;
    entries.set(household.id, {
      financeHouseholdId: household.id,
      decision: "skip",
      reason: "no-members",
      addMembers: [],
    });
  }

  // 3. override entries take their groups before any proposal.
  for (const household of ordered) {
    if (entries.has(household.id) || !Object.hasOwn(override, household.id)) continue;
    const value = override[household.id];
    if (value === NEW) {
      entries.set(household.id, {
        financeHouseholdId: household.id,
        decision: "new",
        reason: "mapping",
        addMembers: [],
      });
      continue;
    }
    const group = value === undefined ? undefined : groupById.get(value);
    if (group === undefined) {
      throw new MappingError(
        `--mapping: "${String(value)}" (for finance household "${household.id}") is not a recipe group id`,
      );
    }
    const holder = taken.get(group.id);
    if (holder !== undefined) {
      throw new MappingError(
        `--mapping: recipe group "${group.id}" (for finance household "${household.id}") already holds finance household "${holder}" from an earlier run`,
      );
    }
    const groupMembers = new Set(group.memberIds);
    const addMembers = [...household.members]
      .sort((a, b) => a.slot - b.slot)
      .map((m) => m.userId)
      .filter((userId) => !groupMembers.has(userId));
    entries.set(household.id, {
      financeHouseholdId: household.id,
      decision: "merge",
      groupId: group.id,
      reason: "mapping",
      addMembers: [...new Set(addMembers)],
    });
    taken.set(group.id, household.id);
  }

  // 4. the proposal for the rest, in processing order.
  for (const household of ordered) {
    if (entries.has(household.id)) continue;
    const memberIds = household.members.map((m) => m.userId);
    const candidates = sortedGroups.filter((g) => {
      const groupMembers = new Set(g.memberIds);
      return memberIds.every((id) => groupMembers.has(id));
    });
    const free = candidates.filter((g) => !taken.has(g.id));
    const first = free[0];
    if (first === undefined) {
      entries.set(household.id, {
        financeHouseholdId: household.id,
        decision: "new",
        reason: candidates.length > 0 ? "group-taken" : "no-group",
        addMembers: [],
      });
      continue;
    }
    const second = free[1];
    const reason: DecisionReason =
      second === undefined
        ? "only-group"
        : second.recipeCount === first.recipeCount
          ? "tie-oldest"
          : "most-recipes";
    entries.set(household.id, {
      financeHouseholdId: household.id,
      decision: "merge",
      groupId: first.id,
      reason,
      addMembers: [],
    });
    taken.set(first.id, household.id);
  }

  return finance.map((household) => {
    const entry = entries.get(household.id);
    if (entry === undefined) throw new Error(`proposeHouseholdMapping: no entry for "${household.id}"`);
    return entry;
  });
}
