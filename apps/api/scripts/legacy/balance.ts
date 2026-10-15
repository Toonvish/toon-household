/**
 * The balance invariant (plan m5 M5-T07, decision 14, SPEC §6.6): after the finance copy, every
 * migrated finance household must show the balance toon-finance showed.
 *
 * Per household the legacy breakdown (`computeBreakdown` over F's rows) is computed from the
 * perspective of the legacy user who holds slot 1 in the TARGET (identity-based, so a re-seated
 * slot-2 survivor compares correctly) and compared with the migrated one
 * (`getBalance(target.db, household, slot1, 1, true)`, every row, `sammelbuchung` included):
 * `balanceCents`, `transactionCount` and `sum(amount_cents)` must be equal and the target's slot-1
 * user must be the mapped legacy slot-1 user. Anything else is a `FAIL` row and an error.
 *
 * After the copy it also re-checks that every migrated plan payer is a participant (an error there
 * is a bug in `migrateFinance`'s transform, not a data problem). Incomes naming a non-participant
 * are never errors (ADR 0005).
 *
 * Idempotent: a second call replaces the balance rows and its own earlier errors. No module-scope
 * code beyond imports and constants (decision 5); money is integer cents.
 */
import { computeBreakdown, type BalanceBreakdown } from "@toon/shared";
import { getBalance } from "../../src/modules/finance/services/ledger/balance.service.ts";
import { readAll } from "./sources.ts";
import type { BalanceCheck, LegacyDb, MigrationContext } from "./types.ts";

/** Prefix of every error this module writes (so a second call can replace its own). */
const BALANCE_ERROR = "balance check:";
const PLAN_PAYER_ERROR = "plan payer check:";

function str(value: unknown): string {
  return String(value ?? "");
}

function num(value: unknown): number {
  return Number(value ?? 0);
}

type SplitMode = "SPLIT_EQUAL" | "OTHER_ONLY" | "SETTLEMENT";

/**
 * toon-finance's breakdown of one household, over the legacy rows only, from the perspective of
 * `person1LegacyId` (a legacy F user id). Pure over F's data; `amountSumCents` is the plain sum.
 */
export async function legacyBreakdown(
  finance: LegacyDb,
  financeHouseholdId: string,
  person1LegacyId: string,
): Promise<BalanceBreakdown & { amountSumCents: number }> {
  const rows = await readAll(
    finance,
    "SELECT payer_id, split_mode, amount_cents FROM transactions WHERE household_id = ?",
    [financeHouseholdId],
  );
  const transactions = rows.map((row) => ({
    payerId: str(row.payer_id),
    splitMode: str(row.split_mode) as SplitMode,
    amountCents: num(row.amount_cents),
  }));
  const breakdown = computeBreakdown(transactions, person1LegacyId);
  const amountSumCents = transactions.reduce((sum, tx) => sum + tx.amountCents, 0);
  return { ...breakdown, amountSumCents };
}

/**
 * Fills `ctx.report.balances` (one row per migrated finance household, in `created_at` order) and
 * `ctx.report.errors` (a failed row; a plan payer who is not a participant). No-op without a
 * finance input.
 */
export async function verifyBalances(ctx: MigrationContext): Promise<void> {
  const { report, finance, target } = ctx;
  report.balances = [];
  report.errors = report.errors.filter((line) => !line.startsWith(BALANCE_ERROR) && !line.startsWith(PLAN_PAYER_ERROR));
  if (!finance) return;

  const emails = new Map<string, string>(
    (await target.client.execute("SELECT id, email FROM users")).rows.map((row) => [str(row.id), str(row.email)]),
  );
  // target user id -> legacy F user id
  const legacyOf = new Map<string, string>();
  for (const [legacyId, targetId] of ctx.ids.users.finance) legacyOf.set(targetId, legacyId);

  const households = await readAll(finance, "SELECT id, name FROM households ORDER BY created_at, id");
  for (const household of households) {
    const financeId = str(household.id);
    const targetId = ctx.ids.households.finance.get(financeId);
    if (targetId === undefined) continue;
    const name = str(household.name);

    const seatRows = (
      await target.client.execute({
        sql: "SELECT user_id, member_slot FROM finance_participants WHERE household_id = ? ORDER BY member_slot",
        args: [targetId],
      })
    ).rows;
    const slot1 = seatRows.find((row) => num(row.member_slot) === 1);
    if (!slot1) {
      report.errors.push(`${BALANCE_ERROR} finance household ${financeId} (${name}): the target has no slot-1 participant`);
      continue;
    }
    const slot1UserId = str(slot1.user_id);

    // The legacy slot-1 user: F's slot 1, else (a solo ledger re-seated by ADR 0005) the only member.
    const legacyMembers = await readAll(
      finance,
      "SELECT user_id, member_slot FROM household_members WHERE household_id = ? ORDER BY member_slot",
      [financeId],
    );
    const expectedLegacy =
      legacyMembers.find((row) => num(row.member_slot) === 1) ?? (legacyMembers.length === 1 ? legacyMembers[0] : undefined);
    const expectedTarget = expectedLegacy ? ctx.ids.users.finance.get(str(expectedLegacy.user_id)) : undefined;
    const slot1Matches = expectedTarget !== undefined && expectedTarget === slot1UserId;

    const legacy = await legacyBreakdown(finance, financeId, legacyOf.get(slot1UserId) ?? slot1UserId);
    const migrated = await getBalance(target.db, targetId, slot1UserId, 1, true);
    const sumRow = (
      await target.client.execute({
        sql: "SELECT coalesce(sum(amount_cents), 0) AS total FROM finance_transactions WHERE household_id = ?",
        args: [targetId],
      })
    ).rows[0];
    const migratedAmountSumCents = num(sumRow?.total);

    const ok =
      slot1Matches &&
      legacy.balanceCents === migrated.balanceCents &&
      legacy.transactionCount === migrated.breakdown.transactionCount &&
      legacy.amountSumCents === migratedAmountSumCents;
    const check: BalanceCheck = {
      financeHouseholdId: financeId,
      targetHouseholdId: targetId,
      name,
      slot1Email: emails.get(slot1UserId) ?? slot1UserId,
      legacyBalanceCents: legacy.balanceCents,
      migratedBalanceCents: migrated.balanceCents,
      legacyTransactionCount: legacy.transactionCount,
      migratedTransactionCount: migrated.breakdown.transactionCount,
      legacyAmountSumCents: legacy.amountSumCents,
      migratedAmountSumCents,
      slot1Matches,
      ok,
    };
    report.balances.push(check);
    if (!ok) {
      report.errors.push(
        `${BALANCE_ERROR} finance household ${financeId} (${name}) FAILED: balance ${check.legacyBalanceCents} ct vs ${check.migratedBalanceCents} ct, ` +
          `transactions ${check.legacyTransactionCount} vs ${check.migratedTransactionCount}, amount sum ${check.legacyAmountSumCents} ct vs ${check.migratedAmountSumCents} ct, ` +
          `slot-1 user ${slot1Matches ? "matches" : "does not match"} the legacy slot-1 user`,
      );
    }

    // After-copy check: the plan payer is a participant (a failure here is a transform bug).
    const plan = (
      await target.client.execute({
        sql: "SELECT payer_id FROM finance_fixed_cost_plans WHERE household_id = ?",
        args: [targetId],
      })
    ).rows[0];
    if (plan && !seatRows.some((row) => str(row.user_id) === str(plan.payer_id))) {
      const payer = str(plan.payer_id);
      report.errors.push(
        `${PLAN_PAYER_ERROR} finance household ${financeId} (${name}): the migrated plan payer ${emails.get(payer) ?? payer} is not a participant (transform bug)`,
      );
    }
  }
}
