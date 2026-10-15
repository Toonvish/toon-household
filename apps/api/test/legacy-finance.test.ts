/**
 * `migrateFinance` and `verifyBalances` (plan m5 M5-T07, Table M rows 32-40, decisions 10, 11 and
 * 14, ADR 0005) against the committed fixtures (`test/fixtures/legacy/`, facts in `facts.ts`), on
 * temp file databases.
 *
 * THE TRAPS: FH4's plan payer fritz and one of its incomes name a user who is not a participant
 * (F lets a member who never paid leave and never touches the plan): the payer is re-pointed to
 * gina, the income is kept, both with a warning and never an error; FH5 has no members, so its
 * plan row is skipped without an error; the balance of FH4 is compared from gina's perspective
 * (she was re-seated in slot 1). FH6's slot 2 is the placeholder pia (plan m3b decision 13): one
 * booking names her as payer, and the balance holds with a placeholder payer.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { computeBreakdown } from "@toon/shared";
import { getBalance } from "../src/modules/finance/services/ledger/balance.service.ts";
import { verifyBalances } from "../scripts/legacy/balance.ts";
import { migrateFinance } from "../scripts/legacy/finance.ts";
import { migrateHouseholds } from "../scripts/legacy/households.ts";
import { exitCodeFor } from "../scripts/legacy/report.ts";
import { migrateUsers } from "../scripts/legacy/users.ts";
import { EXPECTED, FINANCE_HOUSEHOLDS, FINANCE_USERS, FH4_INCOMES } from "./fixtures/legacy/facts.ts";
import { countRows, createLegacyRun, type LegacyRun } from "./support/legacy-harness.ts";

const runs: LegacyRun[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
});

async function migrated(options: Parameters<typeof createLegacyRun>[0] = {}): Promise<LegacyRun> {
  const run = await createLegacyRun(options);
  runs.push(run);
  await migrateUsers(run.ctx);
  await migrateHouseholds(run.ctx);
  await migrateFinance(run.ctx);
  await verifyBalances(run.ctx);
  return run;
}

type Plain = Record<string, unknown>;

async function rows(client: { execute(q: { sql: string; args: (string | number)[] }): Promise<{ columns: string[]; rows: unknown[][] }> }, sql: string, args: (string | number)[] = []): Promise<Plain[]> {
  const result = await client.execute({ sql, args });
  return result.rows.map((row) => {
    const out: Plain = {};
    result.columns.forEach((column, index) => {
      out[column] = (row as unknown as Record<number, unknown>)[index];
    });
    return out;
  });
}

const targetRows = (run: LegacyRun, sql: string, args: (string | number)[] = []) =>
  rows(run.target.client as never, sql, args);
const legacyRows = (run: LegacyRun, sql: string, args: (string | number)[] = []) =>
  rows((run.ctx.finance as NonNullable<typeof run.ctx.finance>).client as never, sql, args);

type Key = keyof typeof FINANCE_HOUSEHOLDS;

function financeTarget(run: LegacyRun, key: Key): string {
  const id = run.ctx.ids.households.finance.get(FINANCE_HOUSEHOLDS[key].id);
  if (id === undefined) throw new Error(`${key} was not migrated`);
  return id;
}

function userTarget(run: LegacyRun, who: keyof typeof FINANCE_USERS): string {
  const id = run.ctx.ids.users.finance.get(FINANCE_USERS[who].id);
  if (id === undefined) throw new Error(`${who} was not migrated`);
  return id;
}

const FINANCE_TABLES = [
  ["finance_categories", "categories"],
  ["finance_tags", "tags"],
  ["finance_transactions", "transactions"],
  ["finance_transaction_tags", "transaction_tags"],
  ["finance_mutation_claims", "mutation_claims"],
  ["finance_fixed_cost_items", "fixed_cost_items"],
  ["finance_incomes", "incomes"],
  ["finance_accrual_runs", "accrual_runs"],
] as const;

describe("migrateFinance on the fixtures", () => {
  test("the whole pipeline has no error and exit code 0", async () => {
    const run = await migrated();
    expect(run.ctx.report.errors).toEqual([]);
    expect(run.ctx.report.skipped.filter((row) => row.error)).toEqual([]);
    expect(exitCodeFor(run.ctx.report)).toBe(0);
  });

  test("row counts per table equal the facts (FH5 has no rows)", async () => {
    const run = await migrated();
    const legacy = EXPECTED.legacyRows.finance;
    for (const [target, source] of FINANCE_TABLES) {
      expect(await countRows(run.target.client, target)).toBe(legacy[source] ?? 0);
    }
    expect(await countRows(run.target.client, "finance_incomes")).toBe(EXPECTED.financeIncomes);
    // 6 legacy plan rows, FH5's is skipped (no members)
    expect(await countRows(run.target.client, "finance_fixed_cost_plans")).toBe(5);
    for (const key of ["FH1", "FH2", "FH3", "FH4", "FH6"] as const) {
      const ledger = EXPECTED.financeLedgers[key];
      const [row] = await targetRows(
        run,
        "SELECT count(*) AS n, sum(amount_cents) AS total FROM finance_transactions WHERE household_id = ?",
        [financeTarget(run, key)],
      );
      expect(Number(row?.n)).toBe(ledger?.transactions ?? -1);
      expect(Number(row?.total)).toBe(ledger?.sumCents ?? -1);
    }
  });

  test("FH5's plan row is skipped as 'no members', not as an error", async () => {
    const run = await migrated();
    const skipped = run.ctx.report.skipped.filter((row) => row.table === "finance_fixed_cost_plans");
    expect(skipped).toEqual([
      {
        table: "finance_fixed_cost_plans",
        source: "finance",
        legacyId: FINANCE_HOUSEHOLDS.FH5.id,
        reason: `finance household ${FINANCE_HOUSEHOLDS.FH5.id} skipped: no members`,
        error: false,
      },
    ]);
    const plans = run.ctx.report.counts.find((count) => count.table === "finance_fixed_cost_plans");
    expect(plans).toMatchObject({ read: 6, written: 5, skipped: 1 });
  });

  test("categories keep is_system / is_hidden as 0/1 and the custom label", async () => {
    const run = await migrated();
    const fh1 = financeTarget(run, "FH1");
    const system = await targetRows(run, "SELECT is_system, is_hidden FROM finance_categories WHERE household_id = ? AND slug = 'fixkosten'", [fh1]);
    expect(system).toEqual([{ is_system: 1, is_hidden: 0 }]);
    const hidden = await targetRows(run, "SELECT slug, typeof(is_hidden) AS t FROM finance_categories WHERE household_id = ? AND is_hidden = 1", [fh1]);
    expect(hidden).toEqual([{ slug: "steuern_abgaben", t: "integer" }]);
    const custom = await targetRows(run, "SELECT custom_label FROM finance_categories WHERE household_id = ? AND custom_label IS NOT NULL", [fh1]);
    expect(custom).toContainEqual({ custom_label: "Fellnasen" });
  });

  test("the -101 refund keeps its sign and split mode; halfForOther(-101) is -50 in the balance", async () => {
    const run = await migrated();
    const refund = await targetRows(
      run,
      "SELECT split_mode, amount_cents, payer_id, origin FROM finance_transactions WHERE household_id = ? AND amount_cents = -101",
      [financeTarget(run, "FH1")],
    );
    expect(refund).toHaveLength(1);
    expect(refund[0]).toMatchObject({ split_mode: "SPLIT_EQUAL", amount_cents: -101, origin: "manual" });
  });

  test("plan rows and import rows keep plan_period, import_seq and external_key", async () => {
    const run = await migrated();
    const legacy = await legacyRows(run, "SELECT id, origin, plan_period, import_seq, external_key, created_by FROM transactions WHERE origin != 'manual' ORDER BY id");
    expect(legacy.length).toBeGreaterThanOrEqual(4);
    for (const row of legacy) {
      const [copy] = await targetRows(run, "SELECT origin, plan_period, import_seq, external_key FROM finance_transactions WHERE id = ?", [String(row.id)]);
      expect(copy).toEqual({
        origin: row.origin,
        plan_period: row.plan_period,
        import_seq: row.import_seq,
        external_key: row.external_key,
      });
    }
  });

  test("the sammelbuchung tag and its link exist", async () => {
    const run = await migrated();
    const tag = await targetRows(run, "SELECT id, name_key FROM finance_tags WHERE household_id = ? AND name_key = 'sammelbuchung'", [financeTarget(run, "FH1")]);
    expect(tag).toHaveLength(1);
    const links = await targetRows(run, "SELECT transaction_id FROM finance_transaction_tags WHERE tag_id = ?", [String(tag[0]?.id)]);
    expect(links).toHaveLength(1);
  });

  test("the plan's enabled flag and last_booked_period are F's", async () => {
    const run = await migrated();
    const fh1 = await targetRows(run, "SELECT enabled, start_period, last_booked_period FROM finance_fixed_cost_plans WHERE household_id = ?", [financeTarget(run, "FH1")]);
    expect(fh1).toEqual([{ enabled: 1, start_period: "2026-07", last_booked_period: "2026-08" }]);
    const fh3 = await targetRows(run, "SELECT enabled, last_booked_period FROM finance_fixed_cost_plans WHERE household_id = ?", [financeTarget(run, "FH3")]);
    expect(fh3).toEqual([{ enabled: 0, last_booked_period: null }]);
  });

  test("mutation claims keep their transaction_id (and a NULL one)", async () => {
    const run = await migrated();
    const legacy = await legacyRows(run, "SELECT id, transaction_id FROM mutation_claims ORDER BY id");
    const copies = await targetRows(run, "SELECT id, transaction_id FROM finance_mutation_claims ORDER BY id");
    expect(copies).toEqual(legacy);
    expect(copies.some((row) => row.transaction_id !== null)).toBe(true);
    expect(copies.some((row) => row.transaction_id === null)).toBe(true);
  });

  test("ledger entries: plans are keyed by the F household id", async () => {
    const run = await migrated();
    const entry = await targetRows(
      run,
      `SELECT new_id FROM legacy_ids WHERE "table" = 'finance_fixed_cost_plans' AND legacy_source = 'finance' AND legacy_id = ?`,
      [FINANCE_HOUSEHOLDS.FH3.id],
    );
    expect(entry).toEqual([{ new_id: financeTarget(run, "FH3") }]);
  });

  test("a second migrateFinance writes 0 rows", async () => {
    const run = await migrated();
    const before = await countRows(run.target.client, "legacy_ids");
    const warnings = run.ctx.report.warnings.length;
    await migrateFinance(run.ctx);
    expect(await countRows(run.target.client, "legacy_ids")).toBe(before);
    const finance = run.ctx.report.counts.filter((count) => count.table.startsWith("finance_") && count.source === "finance");
    expect(finance.length).toBeGreaterThan(0);
    // counts are summed per table; the second pass added only "already migrated" / skipped rows
    expect(run.ctx.report.warnings.length).toBe(warnings);
    await verifyBalances(run.ctx);
    expect(run.ctx.report.errors).toEqual([]);
    expect(run.ctx.report.balances).toHaveLength(EXPECTED.balances.rows);
  });
});

describe("balance invariant", () => {
  test("verifyBalances: five rows, all ok, equal to the facts", async () => {
    const run = await migrated();
    const { balances } = run.ctx.report;
    expect(balances).toHaveLength(EXPECTED.balances.rows);
    expect(balances.filter((row) => row.ok)).toHaveLength(EXPECTED.balances.ok);
    expect(balances.map((row) => row.financeHouseholdId).sort()).toEqual(
      (["FH1", "FH2", "FH3", "FH4", "FH6"] as const).map((key) => FINANCE_HOUSEHOLDS[key].id).sort(),
    );
    for (const row of balances) {
      expect(row.slot1Matches).toBe(true);
      expect(row.migratedBalanceCents).toBe(row.legacyBalanceCents);
      expect(row.migratedTransactionCount).toBe(row.legacyTransactionCount);
      expect(row.migratedAmountSumCents).toBe(row.legacyAmountSumCents);
    }
  });

  for (const key of ["FH1", "FH2", "FH3", "FH4", "FH6"] as const) {
    test(`${key}: the legacy balance, computed independently, equals getBalance on the target`, async () => {
      const run = await migrated();
      const facts = FINANCE_HOUSEHOLDS[key];
      const slot1Who = key === "FH4" ? "gina" : facts.members.find((member) => member.slot === 1)?.user;
      if (!slot1Who) throw new Error("no slot 1");
      const slot1Legacy = FINANCE_USERS[slot1Who as keyof typeof FINANCE_USERS].id;
      // independent of balance.ts: F's rows straight from the fixture database
      const legacy = await legacyRows(run, "SELECT payer_id, split_mode, amount_cents FROM transactions WHERE household_id = ?", [facts.id]);
      const expected = computeBreakdown(
        legacy.map((row) => ({
          payerId: String(row.payer_id),
          splitMode: String(row.split_mode) as "SPLIT_EQUAL" | "OTHER_ONLY" | "SETTLEMENT",
          amountCents: Number(row.amount_cents),
        })),
        slot1Legacy,
      );
      const householdId = financeTarget(run, key);
      const slot1Target = userTarget(run, slot1Who as keyof typeof FINANCE_USERS);
      const seat = await targetRows(run, "SELECT user_id FROM finance_participants WHERE household_id = ? AND member_slot = 1", [householdId]);
      expect(seat).toEqual([{ user_id: slot1Target }]);

      const onTarget = await getBalance(run.target.db, householdId, slot1Target, 1, true);
      expect(onTarget.balanceCents).toBe(expected.balanceCents);
      expect(onTarget.breakdown.transactionCount).toBe(expected.transactionCount);
      expect(onTarget.breakdown.transactionCount).toBe(EXPECTED.financeLedgers[key]?.transactions ?? -1);

      const row = run.ctx.report.balances.find((item) => item.financeHouseholdId === facts.id);
      expect(row?.legacyBalanceCents).toBe(expected.balanceCents);
      expect(row?.migratedBalanceCents).toBe(expected.balanceCents);
      expect(row?.ok).toBe(true);
    });
  }

  test("FH1: the balance without aggregates differs exactly by the sammelbuchung row's delta", async () => {
    const run = await migrated();
    const householdId = financeTarget(run, "FH1");
    const slot1 = userTarget(run, "anna");
    const all = await getBalance(run.target.db, householdId, slot1, 1, true);
    const without = await getBalance(run.target.db, householdId, slot1, 1, false);
    const [tagged] = await targetRows(
      run,
      `SELECT t.payer_id, t.split_mode, t.amount_cents FROM finance_transactions t
         JOIN finance_transaction_tags l ON l.transaction_id = t.id
         JOIN finance_tags g ON g.id = l.tag_id AND g.name_key = 'sammelbuchung'
        WHERE t.household_id = ?`,
      [householdId],
    );
    const delta = computeBreakdown(
      [{ payerId: String(tagged?.payer_id), splitMode: String(tagged?.split_mode) as "SPLIT_EQUAL", amountCents: Number(tagged?.amount_cents) }],
      slot1,
    ).balanceCents;
    expect(delta).not.toBe(0);
    expect(all.balanceCents).not.toBe(without.balanceCents);
    expect(all.balanceCents - without.balanceCents).toBe(delta);
    expect(without.breakdown.transactionCount).toBe(all.breakdown.transactionCount - 1);
  });

  test("tamper: changing one migrated amount fails that household with one error and exit code 1", async () => {
    const run = await migrated();
    const householdId = financeTarget(run, "FH2");
    await run.target.client.execute({
      sql: "UPDATE finance_transactions SET amount_cents = amount_cents + 100 WHERE id = (SELECT id FROM finance_transactions WHERE household_id = ? LIMIT 1)",
      args: [householdId],
    });
    await verifyBalances(run.ctx);
    const failed = run.ctx.report.balances.filter((row) => !row.ok);
    expect(failed.map((row) => row.financeHouseholdId)).toEqual([FINANCE_HOUSEHOLDS.FH2.id]);
    expect(run.ctx.report.balances.filter((row) => row.ok)).toHaveLength(EXPECTED.balances.ok - 1);
    expect(run.ctx.report.errors).toHaveLength(1);
    expect(run.ctx.report.errors[0]).toContain(FINANCE_HOUSEHOLDS.FH2.id);
    expect(exitCodeFor(run.ctx.report)).toBe(1);
    // running it again does not stack the same error
    await verifyBalances(run.ctx);
    expect(run.ctx.report.errors).toHaveLength(1);
  });

  test("tamper: swapping the slot-1 user fails the identity check", async () => {
    const run = await migrated();
    const householdId = financeTarget(run, "FH1");
    // swap the two seats (slot 1 <-> 2) the way a bad re-seat would (the unique index forbids an UPDATE swap)
    const seats = await targetRows(run, "SELECT user_id, member_slot, display_name, joined_at FROM finance_participants WHERE household_id = ?", [householdId]);
    await run.target.client.batch(
      [
        { sql: "DELETE FROM finance_participants WHERE household_id = ?", args: [householdId] },
        ...seats.map((seat) => ({
          sql: "INSERT INTO finance_participants (household_id, user_id, member_slot, display_name, joined_at) VALUES (?, ?, ?, ?, ?)",
          args: [householdId, String(seat.user_id), 3 - Number(seat.member_slot), String(seat.display_name), Number(seat.joined_at)],
        })),
      ],
      "write",
    );
    await verifyBalances(run.ctx);
    const row = run.ctx.report.balances.find((item) => item.financeHouseholdId === FINANCE_HOUSEHOLDS.FH1.id);
    expect(row?.slot1Matches).toBe(false);
    expect(row?.ok).toBe(false);
    expect(exitCodeFor(run.ctx.report)).toBe(1);
  });
});

describe("non-participants (decision 14, ADR 0005)", () => {
  test("FH4's plan payer is gina (F had fritz) and a warning names FH4", async () => {
    const run = await migrated();
    const [plan] = await targetRows(run, "SELECT payer_id FROM finance_fixed_cost_plans WHERE household_id = ?", [financeTarget(run, "FH4")]);
    expect(plan?.payer_id).toBe(userTarget(run, "gina"));
    expect(plan?.payer_id).not.toBe(userTarget(run, "fritz"));
    const [legacyPlan] = await legacyRows(run, "SELECT payer_id FROM fixed_cost_plans WHERE household_id = ?", [FINANCE_HOUSEHOLDS.FH4.id]);
    expect(legacyPlan?.payer_id).toBe(FINANCE_USERS.fritz.id);
    expect(run.ctx.report.warnings).toContain(
      `finance household ${FINANCE_HOUSEHOLDS.FH4.id}: plan payer ${FINANCE_USERS.fritz.emailNormalized} is not a participant; payer set to ${FINANCE_USERS.gina.emailNormalized}`,
    );
    // participants' own plans are untouched
    const [fh1] = await targetRows(run, "SELECT payer_id FROM finance_fixed_cost_plans WHERE household_id = ?", [financeTarget(run, "FH1")]);
    expect(fh1?.payer_id).toBe(userTarget(run, "anna"));
  });

  test("the income naming fritz is copied unchanged, with a warning, and is no error", async () => {
    const run = await migrated();
    const householdId = financeTarget(run, "FH4");
    const incomes = await targetRows(run, "SELECT person_id, amount_cents FROM finance_incomes WHERE household_id = ? ORDER BY amount_cents", [householdId]);
    const fritzIncome = FH4_INCOMES.find((income) => income.user === "fritz");
    expect(incomes).toHaveLength(FH4_INCOMES.length);
    expect(incomes).toContainEqual({ person_id: userTarget(run, "fritz"), amount_cents: fritzIncome?.amountCents });
    expect(incomes).toContainEqual({ person_id: userTarget(run, "gina"), amount_cents: 250000 });
    const [legacyIncome] = await legacyRows(run, "SELECT id FROM incomes WHERE household_id = ? AND person_id = ?", [FINANCE_HOUSEHOLDS.FH4.id, FINANCE_USERS.fritz.id]);
    const warning = run.ctx.report.warnings.find((line) => line.startsWith(`income ${String(legacyIncome?.id)} `));
    expect(warning).toBe(
      `income ${String(legacyIncome?.id)} of finance household ${FINANCE_HOUSEHOLDS.FH4.id} names ${FINANCE_USERS.fritz.emailNormalized}, who is not a participant; the plan stays incomplete until an admin deletes or replaces it`,
    );
    // gina's income and every participant income raise no such warning
    expect(run.ctx.report.warnings.filter((line) => line.startsWith("income "))).toHaveLength(1);
    expect(run.ctx.report.errors).toEqual([]);
    expect(run.ctx.report.skipped.filter((row) => row.table === "finance_incomes")).toEqual([]);
    expect(exitCodeFor(run.ctx.report)).toBe(0);
  });

  test("tamper: a migrated plan payer who is not a participant is one error", async () => {
    const run = await migrated();
    await run.target.client.execute({
      sql: "UPDATE finance_fixed_cost_plans SET payer_id = ? WHERE household_id = ?",
      args: [userTarget(run, "fritz"), financeTarget(run, "FH4")],
    });
    await verifyBalances(run.ctx);
    expect(run.ctx.report.errors).toHaveLength(1);
    expect(run.ctx.report.errors[0]).toContain(FINANCE_HOUSEHOLDS.FH4.id);
    expect(run.ctx.report.errors[0]).toContain("not a participant");
    expect(run.ctx.report.balances.every((row) => row.ok)).toBe(true);
    expect(exitCodeFor(run.ctx.report)).toBe(1);
  });
});

describe("FH6: a placeholder payer (plan m3b decision 13, ADR 0006)", () => {
  test("pia's booking keeps her as payer; the plan payer stays anna; the balance is OK without a warning", async () => {
    const run = await migrated();
    const householdId = financeTarget(run, "FH6");
    const pia = userTarget(run, "pia");
    const paidByPia = await targetRows(run, "SELECT amount_cents, created_by FROM finance_transactions WHERE household_id = ? AND payer_id = ?", [householdId, pia]);
    expect(paidByPia).toEqual([{ amount_cents: 1800, created_by: userTarget(run, "anna") }]);
    const [placeholder] = await targetRows(run, "SELECT email, password_hash FROM users WHERE id = ?", [pia]);
    expect(placeholder).toEqual({ email: null, password_hash: null });
    const [plan] = await targetRows(run, "SELECT payer_id, enabled FROM finance_fixed_cost_plans WHERE household_id = ?", [householdId]);
    expect(plan).toEqual({ payer_id: userTarget(run, "anna"), enabled: 0 });
    const row = run.ctx.report.balances.find((item) => item.financeHouseholdId === FINANCE_HOUSEHOLDS.FH6.id);
    expect(row).toMatchObject({ targetHouseholdId: householdId, slot1Email: "anna@example.test", slot1Matches: true, ok: true });
    expect(row?.legacyTransactionCount).toBe(EXPECTED.financeLedgers.FH6?.transactions ?? -1);
    expect(row?.legacyAmountSumCents).toBe(EXPECTED.financeLedgers.FH6?.sumCents ?? -1);
    expect(run.ctx.report.warnings.filter((line) => line.includes(FINANCE_HOUSEHOLDS.FH6.id))).toEqual([]);
    expect(exitCodeFor(run.ctx.report)).toBe(0);
  });
});
