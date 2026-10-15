/**
 * Step 2 of the migration: households, members, invites, module rows, finance seats and settings
 * (plan m5 decisions 10 and 11, Table M rows 6-14, SPEC §6.3, §6.4, D2, D3, ADR 0005).
 *
 * Order (nothing is written before step c):
 * a. validate `ctx.mapping` against the ids the snapshots know (a `MappingError` propagates before
 *    any target read or write);
 * b. build the proposal from the snapshots and the ledger (reads only, legacy group ids);
 * c. recipe groups -> households (same id unless CLAIMED in this run or by a target row, as the
 *    users step does), `group_members`, `group_invites`, the `recipe` module row per group;
 * d. one decision per finance household: `new` writes a household (creator as owner, or the member
 *    with the lowest slot when the creator left: FH4's gina) and its members, `merge` writes only
 *    the ledger row plus the `addMembers` of a `--mapping`, `skip` writes nothing;
 * e. `finance_participants` (a lone slot-2 participant is re-seated in slot 1, ADR 0005),
 *    `finance_settings`, the `finance` module row; a one-seat ledger is a warning;
 * f. finance-only users without an active household get the one their earliest-joined finance
 *    household landed in (an UPDATE guarded by `IS NULL`);
 * g. F's `invites` are counted under "Not migrated by design".
 *
 * The module hooks (`initializeHousehold`, `onHouseholdCreated`, `onEnable`) are NOT called: they
 * would seed the 21 default categories, which collide with the copied ones. A migrated household
 * that enables finance later is completed by `ensureFinanceHousehold`, like a pre-M3 household.
 *
 * No module-scope code beyond imports and constants (decision 5); the library takes the target
 * from the context and never uses the shared `db`.
 */
import { copyTable, recordSkip, type SkipResult, type WriteEntry, writeEntries } from "./copy.ts";
import { loadAll, lookupMany } from "./ledger.ts";
import {
  type FinanceHouseholdInfo,
  type GroupInfo,
  type KnownIds,
  type ProposalEntry,
  proposeHouseholdMapping,
  validateMappingOverride,
} from "./mapping.ts";
import { addCount } from "./report.ts";
import { readAll } from "./sources.ts";
import {
  financeParticipants,
  financeSettings,
  householdInvites,
  householdMembers,
  householdModules,
  households,
} from "../../src/db/schema.ts";
import { normalizeStoredUploadUrl } from "../../src/lib/uploadUrls.ts";
import type { HouseholdDecision, LegacySource, MigrationContext, Row, TableCount } from "./types.ts";

/** Prefix of a member id whose user the users step did not migrate: matches no group. */
const UNMAPPED = "unmapped:";

/** The solo-seat warning text (decision 11, ADR 0005). */
export const SOLO_SEAT_NOTE = "one participant; seat the second with PUT …/finance/participants";

function str(value: unknown): string {
  return String(value ?? "");
}

function num(value: unknown): number {
  return Number(value ?? 0);
}

function newCount(table: string, source: LegacySource): TableCount {
  return { table, source, read: 0, written: 0, alreadyMigrated: 0, skipped: 0 };
}

interface FinanceMember {
  legacyUserId: string;
  userId: string | undefined; // unified id, undefined when the user was not migrated
  slot: 1 | 2;
  displayName: string;
  joinedAt: number;
}

interface FinanceHousehold {
  row: Row;
  id: string;
  name: string;
  createdAt: number;
  legacyCreatedBy: string;
  createdBy: string | undefined; // unified id
  members: FinanceMember[];
}

/** Reads the R group ids and F household ids the mapping may name (step a). */
async function knownIds(ctx: MigrationContext): Promise<KnownIds> {
  const groupIds = ctx.recipe ? (await readAll(ctx.recipe, "SELECT id FROM groups")).map((r) => str(r.id)) : [];
  const financeIds = ctx.finance
    ? (await readAll(ctx.finance, "SELECT id FROM households")).map((r) => str(r.id))
    : [];
  return { groupIds: new Set(groupIds), financeIds: new Set(financeIds) };
}

/**
 * Migrates the households of both sources and everything that hangs off a household in the core
 * (Table M rows 6-14). Requires `migrateUsers` to have filled `ctx.ids.users`; fills
 * `ctx.ids.households.{recipe,finance}` and `ctx.report.decisions`. Idempotent through the ledger.
 */
export async function migrateHouseholds(ctx: MigrationContext): Promise<void> {
  const { target, report } = ctx;

  // a. Validate the override before anything else touches the target.
  if (ctx.mapping) validateMappingOverride(ctx.mapping, await knownIds(ctx));

  // b. The proposal: snapshots and the ledger only.
  const groupRows = ctx.recipe ? await readAll(ctx.recipe, "SELECT * FROM groups ORDER BY rowid") : [];
  const groupMemberRows = ctx.recipe ? await readAll(ctx.recipe, "SELECT group_id, user_id FROM group_members ORDER BY rowid") : [];
  const recipeCounts = new Map<string, number>();
  if (ctx.recipe) {
    for (const row of await readAll(ctx.recipe, "SELECT group_id, count(*) AS n FROM recipes GROUP BY group_id")) {
      recipeCounts.set(str(row.group_id), num(row.n));
    }
  }
  const groupNames = new Map(groupRows.map((row) => [str(row.id), str(row.name)] as const));
  const groupInfos: GroupInfo[] = groupRows.map((row) => {
    const id = str(row.id);
    const memberIds = groupMemberRows
      .filter((member) => str(member.group_id) === id)
      .map((member) => ctx.ids.users.recipe.get(str(member.user_id)))
      .filter((userId): userId is string => userId !== undefined);
    return { id, name: str(row.name), createdAt: num(row.created_at), memberIds, recipeCount: recipeCounts.get(id) ?? 0 };
  });

  const financeEmails = new Map<string, string>(); // F user id -> normalised e-mail
  const financeRows = ctx.finance ? await readAll(ctx.finance, "SELECT * FROM households ORDER BY rowid") : [];
  const financeMemberRows = ctx.finance
    ? await readAll(ctx.finance, "SELECT * FROM household_members ORDER BY member_slot, rowid")
    : [];
  if (ctx.finance) {
    for (const row of await readAll(ctx.finance, "SELECT id, email, email_normalized FROM users")) {
      financeEmails.set(str(row.id), str(row.email_normalized ?? row.email).trim().toLowerCase());
    }
  }
  const financeHouseholds: FinanceHousehold[] = financeRows.map((row) => {
    const id = str(row.id);
    const members: FinanceMember[] = financeMemberRows
      .filter((member) => str(member.household_id) === id)
      .map((member) => ({
        legacyUserId: str(member.user_id),
        userId: ctx.ids.users.finance.get(str(member.user_id)),
        slot: num(member.member_slot) === 1 ? 1 : 2,
        displayName: str(member.display_name),
        joinedAt: num(member.joined_at),
      }));
    return {
      row,
      id,
      name: str(row.name),
      createdAt: num(row.created_at),
      legacyCreatedBy: str(row.created_by),
      createdBy: ctx.ids.users.finance.get(str(row.created_by)),
      members,
    };
  });
  const financeInfos: FinanceHouseholdInfo[] = financeHouseholds.map((household) => ({
    id: household.id,
    name: household.name,
    createdAt: household.createdAt,
    createdBy: household.createdBy ?? `${UNMAPPED}${household.legacyCreatedBy}`,
    members: household.members.map((member) => ({
      userId: member.userId ?? `${UNMAPPED}${member.legacyUserId}`,
      slot: member.slot,
      displayName: member.displayName,
      joinedAt: member.joinedAt,
    })),
  }));

  const groupLedger = await loadAll(target.client, "households", "recipe"); // legacy group -> target
  const groupOfTarget = new Map<string, string>();
  for (const [legacy, targetId] of groupLedger) groupOfTarget.set(targetId, legacy);
  const financeLedger = await loadAll(target.client, "households", "finance"); // F household -> target
  const alreadyMapped = new Map<string, string>();
  for (const [financeId, targetId] of financeLedger) alreadyMapped.set(financeId, groupOfTarget.get(targetId) ?? targetId);
  const proposal: ProposalEntry[] = proposeHouseholdMapping(groupInfos, financeInfos, {
    ...(ctx.mapping ? { override: ctx.mapping } : {}),
    alreadyMapped,
  });

  // c. Recipe households (Table M rows 6-9).
  const claimed = new Set<string>([...groupLedger.values(), ...financeLedger.values()]);
  const idTaken = async (id: string): Promise<boolean> => {
    if (claimed.has(id)) return true;
    const result = await target.client.execute({ sql: "SELECT 1 FROM households WHERE id = ? LIMIT 1", args: [id] });
    return result.rows.length > 0;
  };
  /** The legacy id unless claimed (in this run or by a target row): then a fresh UUID and a warning. */
  const pickHouseholdId = async (preferred: string, label: string): Promise<string> => {
    let id = preferred;
    if (await idTaken(preferred)) {
      id = crypto.randomUUID();
      report.warnings.push(`${label}: the id ${preferred} is already taken in the target, new id ${id}`);
    }
    claimed.add(id);
    return id;
  };

  const householdsRecipe = newCount("households", "recipe");
  householdsRecipe.read = groupRows.length;
  const groupEntries: WriteEntry[] = [];
  for (const row of groupRows) {
    const legacyId = str(row.id);
    const known = groupLedger.get(legacyId);
    if (known !== undefined) {
      ctx.ids.households.recipe.set(legacyId, known);
      householdsRecipe.alreadyMigrated += 1;
      continue;
    }
    const createdBy = ctx.ids.users.recipe.get(str(row.created_by));
    if (createdBy === undefined) {
      recordSkip(ctx, householdsRecipe, legacyId, `user ${str(row.created_by)} not migrated`, true);
      continue;
    }
    const id = await pickHouseholdId(legacyId, `recipe group ${legacyId} (${str(row.name)})`);
    groupEntries.push({
      values: {
        id,
        name: row.name ?? null,
        description: row.description ?? null,
        image_url: normalizeStoredUploadUrl(row.image_url === null ? null : str(row.image_url)),
        created_by: createdBy,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
      },
      ledger: [{ source: "recipe", legacyId }],
      newId: id,
      label: `households ${legacyId}`,
    });
  }
  for (const entry of await writeEntries(ctx, households, groupEntries, householdsRecipe)) {
    ctx.ids.households.recipe.set(entry.ledger[0]?.legacyId ?? "", entry.newId);
  }
  addCount(report, householdsRecipe);

  if (ctx.recipe) {
    const householdOf = (row: Row) => ctx.ids.households.recipe.get(str(row.group_id));
    const userOf = (id: unknown) => ctx.ids.users.recipe.get(str(id));
    await copyTable(ctx, {
      source: "recipe",
      legacyTable: "group_members",
      target: householdMembers,
      transform: (row): Row | SkipResult => {
        const householdId = householdOf(row);
        if (householdId === undefined) return { skip: `household ${str(row.group_id)} not migrated`, error: true };
        const userId = userOf(row.user_id);
        if (userId === undefined) return { skip: `user ${str(row.user_id)} not migrated`, error: true };
        const { group_id: _group, ...rest } = row;
        return { ...rest, household_id: householdId, user_id: userId };
      },
    });
    await copyTable(ctx, {
      source: "recipe",
      legacyTable: "group_invites",
      target: householdInvites,
      transform: (row): Row | SkipResult => {
        const householdId = householdOf(row);
        if (householdId === undefined) return { skip: `household ${str(row.group_id)} not migrated`, error: true };
        const invitedBy = userOf(row.invited_by);
        if (invitedBy === undefined) return { skip: `user ${str(row.invited_by)} not migrated`, error: true };
        let acceptedBy: string | null = null;
        if (row.accepted_by !== null && row.accepted_by !== undefined) {
          const mapped = userOf(row.accepted_by);
          if (mapped === undefined) return { skip: `user ${str(row.accepted_by)} not migrated`, error: true };
          acceptedBy = mapped;
        }
        const { group_id: _group, ...rest } = row;
        return { ...rest, household_id: householdId, invited_by: invitedBy, accepted_by: acceptedBy };
      },
    });

    // The `recipe` module row per group household (Table M row 9): ledger key `<G.id>`.
    const modulesRecipe = newCount("household_modules", "recipe");
    modulesRecipe.read = groupRows.length;
    const existing = await lookupMany(target.client, "household_modules", "recipe", groupRows.map((row) => str(row.id)));
    const moduleEntries: WriteEntry[] = [];
    for (const row of groupRows) {
      const legacyId = str(row.id);
      if (existing.has(legacyId)) {
        modulesRecipe.alreadyMigrated += 1;
        continue;
      }
      const householdId = ctx.ids.households.recipe.get(legacyId);
      if (householdId === undefined) {
        recordSkip(ctx, modulesRecipe, legacyId, `household ${legacyId} not migrated`, true);
        continue;
      }
      moduleEntries.push({
        values: { household_id: householdId, module_id: "recipe", enabled_at: row.created_at ?? null, settings: null },
        ledger: [{ source: "recipe", legacyId }],
        newId: `${householdId}:recipe`,
        label: `household_modules ${legacyId}:recipe`,
      });
    }
    await writeEntries(ctx, householdModules, moduleEntries, modulesRecipe);
    addCount(report, modulesRecipe);
  }

  // d. One decision per finance household (Table M rows 10-11).
  const householdsFinance = newCount("households", "finance");
  householdsFinance.read = financeHouseholds.length;
  const membersFinance = newCount("household_members", "finance");
  const decisions: HouseholdDecision[] = [];
  const householdEntries: { household: FinanceHousehold; entry: WriteEntry }[] = [];
  const plannedMembers: { household: FinanceHousehold; member: FinanceMember; role: "owner" | "member" }[] = [];
  const landed = new Map<string, { targetId: string; household: FinanceHousehold }>(); // F id -> target
  /**
   * The members of a household of its own: the creator is the owner; when the creator is no
   * longer a member, the member with the lowest remaining slot is (members are read in slot
   * order: FH4's gina); everyone else is `member`.
   */
  const planNewMembers = (household: FinanceHousehold): void => {
    const owner =
      household.members.find((member) => member.userId !== undefined && member.userId === household.createdBy) ??
      household.members[0];
    for (const member of household.members) {
      plannedMembers.push({ household, member, role: member === owner ? "owner" : "member" });
    }
  };

  for (const [index, entry] of proposal.entries()) {
    const household = financeHouseholds[index] as FinanceHousehold;
    const emailOf = (legacyUserId: string) => financeEmails.get(legacyUserId) ?? legacyUserId;
    const decision: HouseholdDecision = {
      financeHouseholdId: household.id,
      financeName: household.name,
      memberEmails: household.members.map((member) => emailOf(member.legacyUserId)),
      decision: entry.decision,
      reason: entry.reason,
      addMembers: entry.addMembers.map(
        (userId) => emailOf(household.members.find((member) => member.userId === userId)?.legacyUserId ?? userId),
      ),
    };
    decisions.push(decision);

    if (entry.reason === "already-migrated") {
      const targetId = entry.groupId !== undefined ? ctx.ids.households.recipe.get(entry.groupId) : entry.targetHouseholdId;
      const override = ctx.mapping?.[household.id];
      if (override !== undefined) {
        const agrees = override === "new" ? entry.decision === "new" : entry.groupId === override;
        if (!agrees) {
          report.warnings.push(
            `finance household ${household.id} (${household.name}): already migrated to ${targetId ?? "?"}; the --mapping entry "${override}" is ignored`,
          );
        }
      }
      if (targetId !== undefined) {
        decision.targetHouseholdId = targetId;
        decision.targetName = entry.groupId !== undefined ? groupNames.get(entry.groupId) : household.name;
        ctx.ids.households.finance.set(household.id, targetId);
        landed.set(household.id, { targetId, household });
        // A resumed run completes what an interrupted one left out; the ledger skips the rest.
        if (entry.groupId !== undefined) {
          const groupMembers = new Set(groupInfos.find((group) => group.id === entry.groupId)?.memberIds ?? []);
          for (const member of household.members) {
            if (member.userId !== undefined && !groupMembers.has(member.userId)) {
              plannedMembers.push({ household, member, role: "member" });
            }
          }
        } else {
          planNewMembers(household);
        }
      }
      householdsFinance.alreadyMigrated += 1;
      continue;
    }

    if (entry.decision === "skip") {
      recordSkip(ctx, householdsFinance, household.id, `finance household ${household.id} skipped: no members`, false);
      continue;
    }
    const unmappedMember = household.members.find((member) => member.userId === undefined);
    if (unmappedMember) {
      recordSkip(ctx, householdsFinance, household.id, `user ${unmappedMember.legacyUserId} not migrated`, true);
      continue;
    }

    if (entry.decision === "merge") {
      const targetId = entry.groupId !== undefined ? ctx.ids.households.recipe.get(entry.groupId) : undefined;
      if (targetId === undefined) {
        recordSkip(ctx, householdsFinance, household.id, `household ${entry.groupId ?? "?"} not migrated`, true);
        continue;
      }
      decision.targetHouseholdId = targetId;
      decision.targetName = entry.groupId !== undefined ? groupNames.get(entry.groupId) : undefined;
      householdEntries.push({
        household,
        entry: { values: null, ledger: [{ source: "finance", legacyId: household.id }], newId: targetId, label: `households ${household.id}` },
      });
      const added = new Set(entry.addMembers);
      for (const member of household.members) {
        if (member.userId !== undefined && added.has(member.userId)) plannedMembers.push({ household, member, role: "member" });
      }
      continue;
    }

    // new: a household of its own with the creator as `created_by` (FH4: fritz, who left).
    if (household.createdBy === undefined) {
      recordSkip(ctx, householdsFinance, household.id, `user ${household.legacyCreatedBy} not migrated`, true);
      continue;
    }
    const id = await pickHouseholdId(household.id, `finance household ${household.id} (${household.name})`);
    decision.targetHouseholdId = id;
    decision.targetName = household.name;
    householdEntries.push({
      household,
      entry: {
        values: {
          id,
          name: household.name,
          description: null,
          image_url: null,
          created_by: household.createdBy,
          created_at: household.row.created_at ?? null,
          updated_at: household.row.updated_at ?? null,
        },
        ledger: [{ source: "finance", legacyId: household.id }],
        newId: id,
        label: `households ${household.id}`,
      },
    });
    planNewMembers(household);
  }
  report.decisions = decisions;

  const writtenHouseholds = new Set(
    await writeEntries(ctx, households, householdEntries.map((item) => item.entry), householdsFinance),
  );
  for (const { household, entry } of householdEntries) {
    if (!writtenHouseholds.has(entry)) continue;
    ctx.ids.households.finance.set(household.id, entry.newId);
    landed.set(household.id, { targetId: entry.newId, household });
  }
  addCount(report, householdsFinance);

  // F members of new households and the addMembers of a mapped group (Table M row 11).
  const memberKey = (household: FinanceHousehold, member: FinanceMember) => `${household.id}:${member.legacyUserId}`;
  const existingMembers = await lookupMany(
    target.client,
    "household_members",
    "finance",
    plannedMembers.map(({ household, member }) => memberKey(household, member)),
  );
  membersFinance.read = plannedMembers.length;
  const memberEntries: WriteEntry[] = [];
  for (const { household, member, role } of plannedMembers) {
    const key = memberKey(household, member);
    if (existingMembers.has(key)) {
      membersFinance.alreadyMigrated += 1;
      continue;
    }
    const householdId = ctx.ids.households.finance.get(household.id);
    if (householdId === undefined) {
      recordSkip(ctx, membersFinance, key, `household ${household.id} not migrated`, true);
      continue;
    }
    if (member.userId === undefined) {
      recordSkip(ctx, membersFinance, key, `user ${member.legacyUserId} not migrated`, true);
      continue;
    }
    const id = crypto.randomUUID();
    memberEntries.push({
      values: { id, household_id: householdId, user_id: member.userId, role, created_at: member.joinedAt },
      ledger: [{ source: "finance", legacyId: key }],
      newId: id,
      label: `household_members ${key}`,
    });
  }
  await writeEntries(ctx, householdMembers, memberEntries, membersFinance);
  addCount(report, membersFinance);

  // e. Finance seats, settings and the module row (Table M rows 12-14, decision 11, ADR 0005).
  const participants = newCount("finance_participants", "finance");
  const settings = newCount("finance_settings", "finance");
  const modulesFinance = newCount("household_modules", "finance");
  const landedHouseholds = financeHouseholds.filter((household) => landed.has(household.id));
  const seatKeys = landedHouseholds.flatMap((household) => household.members.map((member) => memberKey(household, member)));
  const existingSeats = await lookupMany(target.client, "finance_participants", "finance", seatKeys);
  const landedIds = landedHouseholds.map((household) => household.id);
  const existingSettings = await lookupMany(target.client, "finance_settings", "finance", landedIds);
  const existingModules = await lookupMany(target.client, "household_modules", "finance", landedIds);
  const seatEntries: WriteEntry[] = [];
  const settingsEntries: WriteEntry[] = [];
  const financeModuleEntries: WriteEntry[] = [];
  for (const household of landedHouseholds) {
    const householdId = (landed.get(household.id) as { targetId: string }).targetId;
    const solo = household.members.length === 1;
    if (solo) {
      const email = financeEmails.get(household.members[0]?.legacyUserId ?? "") ?? "?";
      report.warnings.push(`finance household ${household.id} (${household.name}): ${SOLO_SEAT_NOTE} (${email} is the only participant)`);
    }
    for (const member of household.members) {
      participants.read += 1;
      const key = memberKey(household, member);
      if (existingSeats.has(key)) {
        participants.alreadyMigrated += 1;
        continue;
      }
      if (member.userId === undefined) {
        recordSkip(ctx, participants, key, `user ${member.legacyUserId} not migrated`, true);
        continue;
      }
      // Slot 1 anchors the balance and must resolve: a lone slot-2 participant moves to slot 1.
      const slot = solo ? 1 : member.slot;
      if (solo && member.slot === 2) {
        report.warnings.push(
          `finance household ${household.id} (${household.name}): the only participant ${financeEmails.get(member.legacyUserId) ?? member.legacyUserId} sat in slot 2 and is re-seated in slot 1 (ADR 0005)`,
        );
      }
      seatEntries.push({
        values: {
          household_id: householdId,
          user_id: member.userId,
          member_slot: slot,
          display_name: member.displayName,
          joined_at: member.joinedAt,
        },
        ledger: [{ source: "finance", legacyId: key }],
        newId: `${householdId}:${member.userId}`,
        label: `finance_participants ${key}`,
      });
    }
    settings.read += 1;
    if (existingSettings.has(household.id)) {
      settings.alreadyMigrated += 1;
    } else {
      settingsEntries.push({
        values: {
          household_id: householdId,
          default_locale: household.row.default_locale ?? "de",
          created_at: household.row.created_at ?? null,
          updated_at: household.row.updated_at ?? null,
        },
        ledger: [{ source: "finance", legacyId: household.id }],
        newId: householdId,
        label: `finance_settings ${household.id}`,
      });
    }
    modulesFinance.read += 1;
    if (existingModules.has(household.id)) {
      modulesFinance.alreadyMigrated += 1;
    } else {
      financeModuleEntries.push({
        values: { household_id: householdId, module_id: "finance", enabled_at: household.createdAt, settings: null },
        ledger: [{ source: "finance", legacyId: household.id }],
        newId: `${householdId}:finance`,
        label: `household_modules ${household.id}:finance`,
      });
    }
  }
  await writeEntries(ctx, financeParticipants, seatEntries, participants);
  await writeEntries(ctx, financeSettings, settingsEntries, settings);
  await writeEntries(ctx, householdModules, financeModuleEntries, modulesFinance);
  if (ctx.finance) {
    addCount(report, participants);
    addCount(report, settings);
    addCount(report, modulesFinance);
  }

  // f. Finance-only users without an active household (decision 11).
  if (ctx.finance) {
    const activeCount = newCount("users (active_household_id)", "finance");
    const recipeTargets = new Set(ctx.ids.users.recipe.values());
    const done = new Set<string>();
    const byJoin = [...financeMemberRows].sort((a, b) => num(a.joined_at) - num(b.joined_at) || str(a.household_id).localeCompare(str(b.household_id)));
    for (const member of byJoin) {
      const userId = ctx.ids.users.finance.get(str(member.user_id));
      if (userId === undefined || recipeTargets.has(userId) || done.has(userId)) continue;
      const householdId = ctx.ids.households.finance.get(str(member.household_id));
      if (householdId === undefined) continue;
      done.add(userId);
      activeCount.read += 1;
      const result = await target.client.execute({
        sql: "UPDATE users SET active_household_id = ? WHERE id = ? AND active_household_id IS NULL",
        args: [householdId, userId],
      });
      if (result.rowsAffected > 0) activeCount.written += 1;
      else activeCount.alreadyMigrated += 1;
    }
    addCount(report, activeCount);

    // g. F's invites are not migrated (decision 12); replaced, not appended, on a second call.
    const invites = await readAll(ctx.finance, "SELECT count(*) AS n FROM invites");
    report.notMigrated = report.notMigrated.filter((item) => !(item.table === "invites" && item.source === "finance"));
    report.notMigrated.push({
      table: "invites",
      source: "finance",
      rows: num(invites[0]?.n),
      reason: "pending finance invites expire; invite again from the new app",
    });
  }
}
