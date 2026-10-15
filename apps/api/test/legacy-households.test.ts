/**
 * `migrateHouseholds` (plan m5 M5-T05, decisions 10 and 11, Table M rows 6-14, ADR 0005) against
 * the committed fixtures (`test/fixtures/legacy/`, facts in `facts.ts`), on temp file databases.
 *
 * THE TRAPS: FH3's id equals G2's id (FH3 gets a fresh id through the in-run claimed set); FH4's
 * creator fritz left, gina sits alone in slot 2 (gina owns the household, `created_by` stays
 * fritz, gina is re-seated in slot 1, a solo warning); FH5 has no members (skipped). A bad
 * `--mapping` is refused before anything is written.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  EXPECTED,
  FINANCE_HOUSEHOLDS,
  FINANCE_USERS,
  GROUP_MEMBERS,
  GROUPS,
  RECIPE_USERS,
} from "./fixtures/legacy/facts.ts";
import { migrateHouseholds, SOLO_SEAT_NOTE } from "../scripts/legacy/households.ts";
import { MappingError } from "../scripts/legacy/mapping.ts";
import { createReport, exitCodeFor, totalWritten } from "../scripts/legacy/report.ts";
import type { MappingOverride } from "../scripts/legacy/types.ts";
import { migrateUsers } from "../scripts/legacy/users.ts";
import { countRows, createLegacyRun, type LegacyRun } from "./support/legacy-harness.ts";

const runs: LegacyRun[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
});

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
      expect(decision?.addMembers).toEqual([]);
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
  });

  test("merged groups keep their members; F's invites are not migrated, R's are", async () => {
    const r = await migrated();
    for (const [key, members] of Object.entries(GROUP_MEMBERS)) {
      const group = GROUPS[key as keyof typeof GROUPS];
      const got = await rows(r, "SELECT user_id, role FROM household_members WHERE household_id = ? ORDER BY user_id", [group.id]);
      const want = members
        .map((m) => ({ user_id: RECIPE_USERS[m.user].id, role: m.role }))
        .sort((a, b) => a.user_id.localeCompare(b.user_id));
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

  test("module rows: recipe x3 on the groups, finance x4; no hook ran (no categories)", async () => {
    const r = await migrated();
    const modules = await rows(r, "SELECT household_id, module_id, enabled_at, settings FROM household_modules");
    expect(modules).toHaveLength(EXPECTED.householdModules);
    const recipe = modules.filter((m) => m.module_id === "recipe").map((m) => m.household_id).sort();
    expect(recipe).toEqual(Object.values(GROUPS).map((g) => g.id).sort());
    expect(recipe).toHaveLength(EXPECTED.householdModulesRecipe);
    const finance = modules.filter((m) => m.module_id === "finance").map((m) => m.household_id).sort();
    expect(finance).toEqual(
      [GROUPS.G1.id, GROUPS.G3.id, financeTarget(r, "FH3"), financeTarget(r, "FH4")].sort(),
    );
    expect(finance).toHaveLength(EXPECTED.householdModulesFinance);
    expect(modules.every((m) => m.settings === null)).toBe(true);
    const [g1Finance] = await rows(r, "SELECT enabled_at FROM household_modules WHERE household_id = ? AND module_id = 'finance'", [GROUPS.G1.id]);
    expect(g1Finance?.enabled_at).toBe(1780401600000); // FH1's created_at
    expect(await countRows(r.target.client, "finance_categories")).toBe(0);
    expect(await countRows(r.target.client, "finance_fixed_cost_plans")).toBe(0);
  });

  test("participants 7 with F's slots, display names and joined_at; settings 4 with F's locales", async () => {
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
