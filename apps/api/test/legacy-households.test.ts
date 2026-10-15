/**
 * `migrateHouseholds` (plan m5 M5-T05, decisions 10 and 11, Table M rows 6-14, ADR 0005) against
 * the committed fixtures (`test/fixtures/legacy/`, facts in `facts.ts`), on temp file databases.
 *
 * THE TRAPS: FH3's id equals G2's id (FH3 gets a fresh id through the in-run claimed set); FH4's
 * creator fritz left, gina sits alone in slot 2 (gina owns the household, `created_by` stays
 * fritz, gina is re-seated in slot 1, a solo warning); FH5 has no members (skipped). A bad
 * `--mapping` is refused before anything is written. FH6's slot 2 is the placeholder pia (plan
 * m3b decision 13, ADR 0006): matching uses the account member anna only, so FH6 merges into G2
 * and pia joins G2 as `member` with her seat; an all-placeholder household is `no-account-members`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type InStatement } from "@libsql/client";
import { openLegacy } from "../scripts/legacy/sources.ts";
import {
  EXPECTED,
  FINANCE_HOUSEHOLDS,
  FINANCE_USERS,
  GROUP_MEMBERS,
  GROUPS,
  RECIPE_USERS,
} from "./fixtures/legacy/facts.ts";
import { migrateHouseholds, NO_ACCOUNT_MEMBERS_NOTE, SOLO_SEAT_NOTE } from "../scripts/legacy/households.ts";
import { MappingError } from "../scripts/legacy/mapping.ts";
import { createReport, exitCodeFor, totalWritten } from "../scripts/legacy/report.ts";
import type { MappingOverride } from "../scripts/legacy/types.ts";
import { migrateUsers } from "../scripts/legacy/users.ts";
import { countRows, createLegacyRun, type LegacyRun } from "./support/legacy-harness.ts";

const runs: LegacyRun[] = [];
const extraClients: { close(): void }[] = [];
afterEach(() => {
  for (const client of extraClients.splice(0)) client.close();
  for (const run of runs.splice(0)) run.cleanup();
});

/**
 * A mutated copy: edits the operator-side copy of finance.db (the snapshot is read-only) and
 * re-opens it through `openLegacy`, so the run reads the edited rows.
 */
async function mutateFinance(r: LegacyRun, statements: InStatement[]): Promise<void> {
  const client = createClient({ url: `file:${r.financePath}` });
  try {
    await client.batch(statements, "write");
  } finally {
    client.close();
  }
  const scratch = join(r.dir, `scratch-mutated-${extraClients.length}`);
  mkdirSync(scratch, { recursive: true });
  const reopened = await openLegacy("finance", r.financePath, scratch);
  extraClients.push(reopened.client);
  r.ctx.finance = reopened;
}

async function migrated(options: Parameters<typeof createLegacyRun>[0] = {}): Promise<LegacyRun> {
  const created = await createLegacyRun(options);
  runs.push(created);
  await migrateUsers(created.ctx);
  await migrateHouseholds(created.ctx);
  return created;
}

type Plain = Record<string, unknown>;

async function rows(run: LegacyRun, sql: string, args: (string | number)[] = []): Promise<Plain[]> {
  const result = await run.target.client.execute({ sql, args });
  return result.rows.map((row) => {
    const out: Plain = {};
    result.columns.forEach((column, index) => {
      out[column] = row[index];
    });
    return out;
  });
}

function financeTarget(run: LegacyRun, key: keyof typeof FINANCE_HOUSEHOLDS): string {
  const id = run.ctx.ids.households.finance.get(FINANCE_HOUSEHOLDS[key].id);
  if (id === undefined) throw new Error(`${key} was not migrated`);
  return id;
}

function userTarget(run: LegacyRun, who: keyof typeof FINANCE_USERS): string {
  const id = run.ctx.ids.users.finance.get(FINANCE_USERS[who].id);
  if (id === undefined) throw new Error(`${who} was not migrated`);
  return id;
}

const COUNTED_TABLES = [
  "households",
  "household_members",
  "household_invites",
  "household_modules",
  "finance_participants",
  "finance_settings",
  "legacy_ids",
] as const;

async function counts(run: LegacyRun): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of COUNTED_TABLES) out[table] = await countRows(run.target.client, table);
  return out;
}

describe("migrateHouseholds on the fixtures", () => {
  test("5 households: the three groups keep their ids, FH3 is re-keyed, FH4 keeps its id", async () => {
    const r = await migrated();
    expect(await countRows(r.target.client, "households")).toBe(EXPECTED.households);
    for (const group of Object.values(GROUPS)) {
      const [row] = await rows(r, "SELECT name FROM households WHERE id = ?", [group.id]);
      expect(row?.name).toBe(group.name);
      expect(r.ctx.ids.households.recipe.get(group.id)).toBe(group.id);
    }
    const fh3 = financeTarget(r, "FH3");
    expect(fh3).not.toBe(GROUPS.G2.id);
    expect(fh3).not.toBe(FINANCE_HOUSEHOLDS.FH3.id);
    expect((await rows(r, "SELECT name FROM households WHERE id = ?", [fh3]))[0]?.name).toBe(FINANCE_HOUSEHOLDS.FH3.name);
    expect(r.ctx.report.warnings.some((w) => w.includes(FINANCE_HOUSEHOLDS.FH3.id) && w.includes(`new id ${fh3}`))).toBe(true);
    expect(financeTarget(r, "FH4")).toBe(FINANCE_HOUSEHOLDS.FH4.id);
    expect(r.ctx.ids.households.finance.has(FINANCE_HOUSEHOLDS.FH5.id)).toBe(false);
    expect(r.ctx.report.errors).toEqual([]);
    expect(exitCodeFor(r.ctx.report)).toBe(0);
  });

  test("the group image is stored as the bare /uploads path", async () => {
    const r = await migrated();
    const [g1] = await rows(r, "SELECT image_url, description, created_by FROM households WHERE id = ?", [GROUPS.G1.id]);
    expect(String(g1?.image_url)).toMatch(/^\/uploads\/[^?]+\.png$/);
    expect(g1?.created_by).toBe(RECIPE_USERS.anna.id);
  });

  test("the decisions equal facts.ts", async () => {
    const r = await migrated();
    const decisions = r.ctx.report.decisions;
    expect(decisions.map((d) => d.financeHouseholdId)).toEqual(Object.values(FINANCE_HOUSEHOLDS).map((h) => h.id));
    for (const [key, household] of Object.entries(FINANCE_HOUSEHOLDS)) {
      const decision = decisions.find((d) => d.financeHouseholdId === household.id);
      expect(decision?.decision).toBe(household.decision.action);
      expect(decision?.reason).toBe(household.decision.reason);
      expect(decision?.financeName).toBe(household.name);
      // a merge brings the placeholders in (FH6: pia), listed by F id (they have no address)
      expect(decision?.addMembers).toEqual(key === "FH6" ? [`placeholder ${FINANCE_USERS.pia.id}`] : []);
      if (household.decision.action === "merge") {
        const group = GROUPS[(household.decision as { group: keyof typeof GROUPS }).group];
        expect(decision?.targetHouseholdId).toBe(group.id);
        expect(decision?.targetName).toBe(group.name);
      } else if (household.decision.action === "new") {
        expect(decision?.targetHouseholdId).toBe(financeTarget(r, key as keyof typeof FINANCE_HOUSEHOLDS));
        expect(decision?.targetName).toBe(household.name);
      } else {
        expect(decision?.targetHouseholdId).toBeUndefined();
      }
    }
    expect(decisions.find((d) => d.financeHouseholdId === FINANCE_HOUSEHOLDS.FH1.id)?.memberEmails).toEqual([
      "anna@example.test",
      "ben@example.test",
    ]);
    expect(decisions.find((d) => d.financeHouseholdId === FINANCE_HOUSEHOLDS.FH6.id)?.memberEmails).toEqual([
      "anna@example.test",
      `placeholder ${FINANCE_USERS.pia.id}`,
    ]);
  });

  test("merged groups keep their members; F's invites are not migrated, R's are", async () => {
    const r = await migrated();
    for (const [key, members] of Object.entries(GROUP_MEMBERS)) {
      const group = GROUPS[key as keyof typeof GROUPS];
      const got = await rows(r, "SELECT user_id, role FROM household_members WHERE household_id = ? ORDER BY user_id", [group.id]);
      const want: { user_id: string; role: string }[] = members.map((m) => ({ user_id: RECIPE_USERS[m.user].id, role: m.role }));
      // FH6 merges into G2: its placeholder pia joins as member
      if (key === "G2") want.push({ user_id: FINANCE_USERS.pia.id, role: "member" });
      want.sort((a, b) => a.user_id.localeCompare(b.user_id));
      expect(got).toEqual(want);
    }
    const invites = await rows(r, "SELECT household_id, invited_by, email FROM household_invites");
    expect(invites).toEqual([{ household_id: GROUPS.G1.id, invited_by: RECIPE_USERS.anna.id, email: "emil@example.test" }]);
    expect(r.ctx.report.notMigrated.find((n) => n.table === "invites" && n.source === "finance")?.rows).toBe(
      EXPECTED.legacyRows.finance.invites,
    );
  });

  test("FH3's household: emil owner, fritz member, created by emil", async () => {
    const r = await migrated();
    const fh3 = financeTarget(r, "FH3");
    const members = await rows(r, "SELECT user_id, role, created_at FROM household_members WHERE household_id = ? ORDER BY role DESC", [fh3]);
    expect(members.map((m) => [m.user_id, m.role])).toEqual([
      [userTarget(r, "emil"), "owner"],
      [userTarget(r, "fritz"), "member"],
    ]);
    const [household] = await rows(r, "SELECT created_by FROM households WHERE id = ?", [fh3]);
    expect(household?.created_by).toBe(userTarget(r, "emil"));
  });

  test("FH4: gina owner, created_by fritz, re-seated in slot 1, solo warning", async () => {
    const r = await migrated();
    const fh4 = financeTarget(r, "FH4");
    const gina = userTarget(r, "gina");
    expect(gina).not.toBe(RECIPE_USERS.cleo.id);
    const [household] = await rows(r, "SELECT created_by FROM households WHERE id = ?", [fh4]);
    expect(household?.created_by).toBe(userTarget(r, "fritz"));
    const members = await rows(r, "SELECT user_id, role FROM household_members WHERE household_id = ?", [fh4]);
    expect(members).toEqual([{ user_id: gina, role: "owner" }]);
    const seats = await rows(r, "SELECT user_id, member_slot, display_name FROM finance_participants WHERE household_id = ?", [fh4]);
    expect(seats).toEqual([{ user_id: gina, member_slot: 1, display_name: "Gina" }]);
    const warnings = r.ctx.report.warnings.filter((w) => w.includes(FINANCE_HOUSEHOLDS.FH4.id));
    expect(warnings.some((w) => w.includes(SOLO_SEAT_NOTE))).toBe(true);
    expect(warnings.some((w) => w.includes("re-seated in slot 1"))).toBe(true);
  });

  test("FH5 is skipped (no members) without an error", async () => {
    const r = await migrated();
    const skipped = r.ctx.report.skipped.filter((s) => s.legacyId === FINANCE_HOUSEHOLDS.FH5.id);
    expect(skipped).toEqual([
      {
        table: "households",
        source: "finance",
        legacyId: FINANCE_HOUSEHOLDS.FH5.id,
        reason: `finance household ${FINANCE_HOUSEHOLDS.FH5.id} skipped: no members`,
        error: false,
      },
    ]);
  });

  test("module rows: recipe x3 on the groups, finance x5; no hook ran (no categories)", async () => {
    const r = await migrated();
    const modules = await rows(r, "SELECT household_id, module_id, enabled_at, settings FROM household_modules");
    expect(modules).toHaveLength(EXPECTED.householdModules);
    const recipe = modules.filter((m) => m.module_id === "recipe").map((m) => m.household_id).sort();
    expect(recipe).toEqual(Object.values(GROUPS).map((g) => g.id).sort());
    expect(recipe).toHaveLength(EXPECTED.householdModulesRecipe);
    const finance = modules.filter((m) => m.module_id === "finance").map((m) => m.household_id).sort();
    expect(finance).toEqual(
      [GROUPS.G1.id, GROUPS.G2.id, GROUPS.G3.id, financeTarget(r, "FH3"), financeTarget(r, "FH4")].sort(),
    );
    expect(finance).toHaveLength(EXPECTED.householdModulesFinance);
    expect(modules.every((m) => m.settings === null)).toBe(true);
    const [g1Finance] = await rows(r, "SELECT enabled_at FROM household_modules WHERE household_id = ? AND module_id = 'finance'", [GROUPS.G1.id]);
    expect(g1Finance?.enabled_at).toBe(1780401600000); // FH1's created_at
    expect(await countRows(r.target.client, "finance_categories")).toBe(0);
    expect(await countRows(r.target.client, "finance_fixed_cost_plans")).toBe(0);
  });

  test("participants 9 with F's slots, display names and joined_at; settings 5 with F's locales", async () => {
    const r = await migrated();
    const seats = await rows(r, "SELECT household_id, user_id, member_slot, display_name, joined_at FROM finance_participants");
    expect(seats).toHaveLength(EXPECTED.financeParticipants);
    const fh1 = seats.filter((s) => s.household_id === GROUPS.G1.id).sort((a, b) => Number(a.member_slot) - Number(b.member_slot));
    expect(fh1).toEqual([
      { household_id: GROUPS.G1.id, user_id: RECIPE_USERS.anna.id, member_slot: 1, display_name: "Anna", joined_at: 1780405200000 },
      { household_id: GROUPS.G1.id, user_id: RECIPE_USERS.ben.id, member_slot: 2, display_name: "Ben", joined_at: 1780405200000 },
    ]);
    const fh2 = seats.filter((s) => s.household_id === GROUPS.G3.id).map((s) => [s.user_id, s.member_slot, s.display_name]);
    expect(fh2.sort()).toEqual([
      [RECIPE_USERS.cleo.id, 1, "Cleo"],
      [RECIPE_USERS.dana.id, 2, "Dana"],
    ]);
    const settings = await rows(r, "SELECT household_id, default_locale FROM finance_settings ORDER BY household_id");
    expect(settings).toHaveLength(EXPECTED.financeSettings);
    expect(settings.find((s) => s.household_id === GROUPS.G3.id)?.default_locale).toBe("en");
    expect(settings.find((s) => s.household_id === GROUPS.G1.id)?.default_locale).toBe("de");
  });

  test("finance-only users get their household as the active one; anna keeps G1", async () => {
    const r = await migrated();
    const active = async (id: string) =>
      (await rows(r, "SELECT active_household_id FROM users WHERE id = ?", [id]))[0]?.active_household_id;
    expect(await active(userTarget(r, "emil"))).toBe(financeTarget(r, "FH3"));
    expect(await active(userTarget(r, "fritz"))).toBe(financeTarget(r, "FH3"));
    expect(await active(userTarget(r, "gina"))).toBe(financeTarget(r, "FH4"));
    expect(await active(userTarget(r, "pia"))).toBe(GROUPS.G2.id);
    expect(await active(RECIPE_USERS.anna.id)).toBe(GROUPS.G1.id);
  });

  test("a second run writes 0 rows and gives the same decisions as already-migrated", async () => {
    const r = await migrated();
    const first = r.ctx.report.decisions;
    const before = await counts(r);
    const financeMap = new Map(r.ctx.ids.households.finance);
    r.ctx.ids.households.recipe.clear();
    r.ctx.ids.households.finance.clear();
    r.ctx.report = createReport("dry-run", r.target.url);
    await migrateUsers(r.ctx);
    await migrateHouseholds(r.ctx);
    expect(await counts(r)).toEqual(before);
    expect(totalWritten(r.ctx.report)).toBe(0);
    expect(r.ctx.ids.households.finance).toEqual(financeMap);
    const second = r.ctx.report.decisions;
    expect(second.map((d) => [d.financeHouseholdId, d.decision, d.targetHouseholdId])).toEqual(
      first.map((d) => [d.financeHouseholdId, d.decision, d.targetHouseholdId]),
    );
    for (const decision of second) {
      expect(decision.reason).toBe(decision.decision === "skip" ? "no-members" : "already-migrated");
    }
    expect(r.ctx.report.errors).toEqual([]);
  });

  test("--mapping FH2 -> G1 adds dana to G1 as member and reports addMembers", async () => {
    const r = await migrated({ mapping: { [FINANCE_HOUSEHOLDS.FH2.id]: GROUPS.G1.id } });
    const fh2 = r.ctx.report.decisions.find((d) => d.financeHouseholdId === FINANCE_HOUSEHOLDS.FH2.id);
    expect(fh2).toMatchObject({ decision: "merge", reason: "mapping", targetHouseholdId: GROUPS.G1.id, addMembers: ["dana@example.test"] });
    const dana = await rows(r, "SELECT role FROM household_members WHERE household_id = ? AND user_id = ?", [GROUPS.G1.id, RECIPE_USERS.dana.id]);
    expect(dana).toEqual([{ role: "member" }]);
    const fh1 = r.ctx.report.decisions.find((d) => d.financeHouseholdId === FINANCE_HOUSEHOLDS.FH1.id);
    expect(fh1).toMatchObject({ decision: "merge", targetHouseholdId: GROUPS.G2.id });
    const seats = await rows(r, "SELECT user_id FROM finance_participants WHERE household_id = ? ORDER BY member_slot", [GROUPS.G1.id]);
    expect(seats.map((s) => s.user_id)).toEqual([RECIPE_USERS.cleo.id, RECIPE_USERS.dana.id]);
    expect(r.ctx.report.errors).toEqual([]);
  });

  test("a --mapping entry that disagrees with an earlier run is ignored with a warning", async () => {
    const r = await migrated();
    r.ctx.report = createReport("dry-run", r.target.url);
    r.ctx.mapping = { [FINANCE_HOUSEHOLDS.FH1.id]: "new" };
    await migrateHouseholds(r.ctx);
    expect(totalWritten(r.ctx.report)).toBe(0);
    expect(r.ctx.report.warnings.some((w) => w.includes(FINANCE_HOUSEHOLDS.FH1.id) && w.includes("is ignored"))).toBe(true);
    expect(r.ctx.ids.households.finance.get(FINANCE_HOUSEHOLDS.FH1.id)).toBe(GROUPS.G1.id);
  });
});

describe("FH6: the placeholder pia (plan m3b decision 13, ADR 0006)", () => {
  test("FH6 merges into G2 (only-group); pia is a G2 member with the slot 2 seat 'Pia'", async () => {
    const r = await migrated();
    expect(financeTarget(r, "FH6")).toBe(GROUPS.G2.id);
    const decision = r.ctx.report.decisions.find((d) => d.financeHouseholdId === FINANCE_HOUSEHOLDS.FH6.id);
    expect(decision).toMatchObject({ decision: "merge", reason: "only-group", targetHouseholdId: GROUPS.G2.id, targetName: GROUPS.G2.name });
    const pia = userTarget(r, "pia");
    expect(pia).toBe(FINANCE_USERS.pia.id);
    const membership = await rows(r, "SELECT role FROM household_members WHERE household_id = ? AND user_id = ?", [GROUPS.G2.id, pia]);
    expect(membership).toEqual([{ role: "member" }]);
    // G2's owner stays anna (a merge never changes the group's roles)
    const owners = await rows(r, "SELECT user_id FROM household_members WHERE household_id = ? AND role = 'owner'", [GROUPS.G2.id]);
    expect(owners).toEqual([{ user_id: RECIPE_USERS.anna.id }]);
    const seats = await rows(r, "SELECT user_id, member_slot, display_name FROM finance_participants WHERE household_id = ? ORDER BY member_slot", [GROUPS.G2.id]);
    expect(seats).toEqual([
      { user_id: RECIPE_USERS.anna.id, member_slot: 1, display_name: "Anna" },
      { user_id: pia, member_slot: 2, display_name: "Pia" },
    ]);
    const [user] = await rows(r, "SELECT email, password_hash, active_household_id FROM users WHERE id = ?", [pia]);
    expect(user).toEqual({ email: null, password_hash: null, active_household_id: GROUPS.G2.id });
    expect(r.ctx.report.errors).toEqual([]);
  });

  test("a second run adds no second membership or seat for pia", async () => {
    const r = await migrated();
    const before = await counts(r);
    r.ctx.ids.households.recipe.clear();
    r.ctx.ids.households.finance.clear();
    r.ctx.report = createReport("dry-run", r.target.url);
    await migrateUsers(r.ctx);
    await migrateHouseholds(r.ctx);
    expect(await counts(r)).toEqual(before);
    const membership = await rows(r, "SELECT count(*) AS n FROM household_members WHERE user_id = ?", [FINANCE_USERS.pia.id]);
    expect(Number(membership[0]?.n)).toBe(1);
  });

  test("an all-placeholder finance household is the error no-account-members (exit 1), nothing written for it", async () => {
    const r = await createLegacyRun();
    runs.push(r);
    // anna leaves FH6 in the copy: only the placeholder pia is left
    await mutateFinance(r, [
      { sql: "DELETE FROM household_members WHERE household_id = ? AND user_id = ?", args: [FINANCE_HOUSEHOLDS.FH6.id, FINANCE_USERS.anna.id] },
    ]);
    await migrateUsers(r.ctx);
    await migrateHouseholds(r.ctx);
    const decision = r.ctx.report.decisions.find((d) => d.financeHouseholdId === FINANCE_HOUSEHOLDS.FH6.id);
    expect(decision).toMatchObject({ decision: "skip", reason: "no-account-members", memberEmails: [`placeholder ${FINANCE_USERS.pia.id}`] });
    expect(decision?.targetHouseholdId).toBeUndefined();
    const reason = `finance household ${FINANCE_HOUSEHOLDS.FH6.id} (${FINANCE_HOUSEHOLDS.FH6.name}): ${NO_ACCOUNT_MEMBERS_NOTE}`;
    expect(r.ctx.report.skipped.filter((s) => s.legacyId === FINANCE_HOUSEHOLDS.FH6.id)).toEqual([
      { table: "households", source: "finance", legacyId: FINANCE_HOUSEHOLDS.FH6.id, reason, error: true },
    ]);
    expect(r.ctx.report.errors).toEqual([`households (finance) ${FINANCE_HOUSEHOLDS.FH6.id}: ${reason}`]);
    expect(exitCodeFor(r.ctx.report)).toBe(1);
    expect(r.ctx.ids.households.finance.has(FINANCE_HOUSEHOLDS.FH6.id)).toBe(false);
    const piaMemberships = await rows(r, "SELECT count(*) AS n FROM household_members WHERE user_id = ?", [FINANCE_USERS.pia.id]);
    expect(Number(piaMemberships[0]?.n)).toBe(0);
    const g2Finance = await rows(r, "SELECT count(*) AS n FROM household_modules WHERE household_id = ? AND module_id = 'finance'", [GROUPS.G2.id]);
    expect(Number(g2Finance[0]?.n)).toBe(0);
    expect(NO_ACCOUNT_MEMBERS_NOTE).toBe("no account members (every member is a placeholder); name its recipe group with --mapping");
  });

  test("--mapping \"new\" does not lift the error (a placeholder cannot own a household)", async () => {
    const r = await createLegacyRun({ mapping: { [FINANCE_HOUSEHOLDS.FH6.id]: "new" } });
    runs.push(r);
    await mutateFinance(r, [
      { sql: "DELETE FROM household_members WHERE household_id = ? AND user_id = ?", args: [FINANCE_HOUSEHOLDS.FH6.id, FINANCE_USERS.anna.id] },
    ]);
    await migrateUsers(r.ctx);
    await migrateHouseholds(r.ctx);
    expect(r.ctx.report.decisions.find((d) => d.financeHouseholdId === FINANCE_HOUSEHOLDS.FH6.id)?.reason).toBe("no-account-members");
    expect(exitCodeFor(r.ctx.report)).toBe(1);
  });

  test("--mapping to a group lifts it: the placeholder joins that group as member with its seat", async () => {
    const r = await createLegacyRun({ mapping: { [FINANCE_HOUSEHOLDS.FH6.id]: GROUPS.G3.id, [FINANCE_HOUSEHOLDS.FH2.id]: "new" } });
    runs.push(r);
    await mutateFinance(r, [
      { sql: "DELETE FROM household_members WHERE household_id = ? AND user_id = ?", args: [FINANCE_HOUSEHOLDS.FH6.id, FINANCE_USERS.anna.id] },
    ]);
    await migrateUsers(r.ctx);
    await migrateHouseholds(r.ctx);
    const decision = r.ctx.report.decisions.find((d) => d.financeHouseholdId === FINANCE_HOUSEHOLDS.FH6.id);
    expect(decision).toMatchObject({
      decision: "merge",
      reason: "mapping",
      targetHouseholdId: GROUPS.G3.id,
      addMembers: [`placeholder ${FINANCE_USERS.pia.id}`],
    });
    const membership = await rows(r, "SELECT role FROM household_members WHERE household_id = ? AND user_id = ?", [GROUPS.G3.id, FINANCE_USERS.pia.id]);
    expect(membership).toEqual([{ role: "member" }]);
    const seats = await rows(r, "SELECT user_id, member_slot, display_name FROM finance_participants WHERE household_id = ?", [GROUPS.G3.id]);
    expect(seats).toEqual([{ user_id: FINANCE_USERS.pia.id, member_slot: 1, display_name: "Pia" }]);
    expect(r.ctx.report.errors).toEqual([]);
  });

  test("a new household with a placeholder member: the account member owns it, the placeholder is member", async () => {
    const r = await createLegacyRun({ mapping: { [FINANCE_HOUSEHOLDS.FH6.id]: "new" } });
    runs.push(r);
    // the creator anna is moved out of the creator column so the owner rule must skip pia (slot 2)
    await mutateFinance(r, [
      { sql: "UPDATE households SET created_by = ? WHERE id = ?", args: [FINANCE_USERS.pia.id, FINANCE_HOUSEHOLDS.FH6.id] },
    ]);
    await migrateUsers(r.ctx);
    await migrateHouseholds(r.ctx);
    const target = financeTarget(r, "FH6");
    expect(target).toBe(FINANCE_HOUSEHOLDS.FH6.id);
    const members = await rows(r, "SELECT user_id, role FROM household_members WHERE household_id = ? ORDER BY role DESC", [target]);
    expect(members).toEqual([
      { user_id: RECIPE_USERS.anna.id, role: "owner" },
      { user_id: FINANCE_USERS.pia.id, role: "member" },
    ]);
    expect(r.ctx.report.errors).toEqual([]);
  });
});

describe("a bad raw MappingOverride is rejected before any write", () => {
  const cases: [string, () => MappingOverride][] = [
    ["two entries naming one group", () => ({ [FINANCE_HOUSEHOLDS.FH1.id]: GROUPS.G1.id, [FINANCE_HOUSEHOLDS.FH2.id]: GROUPS.G1.id })],
    ["an unknown finance id", () => ({ "no-such-id": "new" })],
  ];
  for (const [name, mapping] of cases) {
    test(name, async () => {
      const r = await createLegacyRun({ mapping: mapping() });
      runs.push(r);
      await migrateUsers(r.ctx);
      const before = await counts(r);
      const writtenBefore = totalWritten(r.ctx.report);
      let caught: unknown;
      try {
        await migrateHouseholds(r.ctx);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MappingError);
      expect(await counts(r)).toEqual(before);
      expect(before.households).toBe(0);
      expect(totalWritten(r.ctx.report)).toBe(writtenBefore);
      expect(r.ctx.report.decisions).toEqual([]);
      expect(r.ctx.ids.households.recipe.size).toBe(0);
    });
  }
});
