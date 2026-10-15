/**
 * `migrateFinance` (plan m5 M5-T07, Table M rows 32-40, decisions 7, 8, 10 and 14, ADR 0005):
 * toon-finance's ledger rows into the `finance_*` tables, in FK order: categories, tags,
 * transactions, transaction_tags, mutation_claims, fixed_cost_items, incomes, fixed_cost_plans,
 * accrual_runs.
 *
 * - A row whose finance household did not land (`ctx.ids.households.finance` has no entry) is
 *   skipped: `error: false` when the households step decided `skip` (no members), `error: true`
 *   otherwise. A user id the users step did not migrate is a skipped row with `error: true`.
 * - `transaction_tags` follow their transaction (and tag) through the household map.
 * - `fixed_cost_plans` (ledger key = the F household id) re-points a `payer_id` that is not a
 *   TARGET participant to the slot-1 participant, with a warning (ADR 0005: toon-finance creates the
 *   plan with the household's creator as payer and `removeMember` never touches it).
 * - `incomes` keep a `person_id` that is not a participant, with a warning (never skipped, never
 *   an error: the plan merely reports `plan_incomplete` until an admin replaces the row).
 * - Booked periods, `last_booked_period`, `origin`, `external_key`, amounts and timestamps are
 *   copied unchanged (F gotchas 35, 37, 45).
 *
 * The finance TS identifiers carry a `finance` prefix and are aliased here (H/CLAUDE.md). No
 * module-scope code beyond imports and constants (decision 5); the library takes the target from
 * the context and never uses the shared `db`.
 */
import { copyTable, type CopySpec, type SkipResult } from "./copy.ts";
import { readAll } from "./sources.ts";
import {
  financeAccrualRuns as accrualRuns,
  financeCategories as categories,
  financeFixedCostItems as fixedCostItems,
  financeFixedCostPlans as fixedCostPlans,
  financeIncomes as incomes,
  financeMutationClaims as mutationClaims,
  financeTags as tags,
  financeTransactionTags as transactionTags,
  financeTransactions as transactions,
} from "../../src/db/schema.ts";
import type { MigrationContext, Row } from "./types.ts";

interface Seat {
  userId: string;
  slot: number;
  email: string;
}

function str(value: unknown): string {
  return String(value ?? "");
}

/** The target's participants per household id, with their e-mails (for warning texts). */
async function loadSeats(ctx: MigrationContext): Promise<Map<string, Seat[]>> {
  const result = await ctx.target.client.execute(
    `SELECT p.household_id AS household_id, p.user_id AS user_id, p.member_slot AS slot, u.email AS email
       FROM finance_participants p JOIN users u ON u.id = p.user_id ORDER BY p.household_id, p.member_slot`,
  );
  const seats = new Map<string, Seat[]>();
  for (const row of result.rows) {
    const householdId = str(row.household_id);
    const list = seats.get(householdId) ?? [];
    list.push({ userId: str(row.user_id), slot: Number(row.slot), email: str(row.email) });
    seats.set(householdId, list);
  }
  return seats;
}

/** Target user id -> e-mail (a household's own users only matter for warning texts). */
async function loadEmails(ctx: MigrationContext): Promise<Map<string, string>> {
  const result = await ctx.target.client.execute("SELECT id, email FROM users");
  return new Map(result.rows.map((row) => [str(row.id), str(row.email)]));
}

/** Why a finance household did not land, as a skip (decision 10). */
function householdSkip(ctx: MigrationContext, financeHouseholdId: string): SkipResult {
  const decision = ctx.report.decisions.find((entry) => entry.financeHouseholdId === financeHouseholdId);
  if (decision?.decision === "skip") {
    return { skip: `finance household ${financeHouseholdId} skipped: no members` };
  }
  return { skip: `household ${financeHouseholdId} not migrated`, error: true };
}

/** Maps `household_id` through the household map; a skip when it did not land. */
function mapHousehold(ctx: MigrationContext, row: Row): string | SkipResult {
  const financeId = str(row.household_id);
  const target = ctx.ids.households.finance.get(financeId);
  return target === undefined ? householdSkip(ctx, financeId) : target;
}

function mapUser(ctx: MigrationContext, legacyUserId: unknown): string | SkipResult {
  const target = ctx.ids.users.finance.get(str(legacyUserId));
  return target === undefined ? { skip: `user ${str(legacyUserId)} not migrated`, error: true } : target;
}

function isSkip(value: string | SkipResult): value is SkipResult {
  return typeof value !== "string";
}

/** A table whose only change is `household_id` through the household map. */
function householdScoped(
  legacyTable: string,
  target: CopySpec["target"],
  patch?: (mapped: Row, original: Row, ctx: MigrationContext) => Row | SkipResult,
): CopySpec {
  return {
    source: "finance",
    legacyTable,
    target,
    transform(row, ctx) {
      const householdId = mapHousehold(ctx, row);
      if (isSkip(householdId)) return householdId;
      const mapped: Row = { ...row, household_id: householdId };
      return patch ? patch(mapped, row, ctx) : mapped;
    },
  };
}

/**
 * Copies toon-finance's ledger rows (Table M rows 32-40) into the target. Idempotent through the
 * ledger: a second call writes nothing. Needs the users and households steps first.
 */
export async function migrateFinance(ctx: MigrationContext): Promise<void> {
  if (!ctx.finance) return;
  const finance = ctx.finance;
  const seats = await loadSeats(ctx);
  const emails = await loadEmails(ctx);
  const emailOf = (userId: string): string => emails.get(userId) ?? userId;

  // transaction id / tag id -> F household id, so a tag link follows its transaction's fate.
  const transactionHouseholds = new Map<string, string>();
  for (const row of await readAll(finance, "SELECT id, household_id FROM transactions")) {
    transactionHouseholds.set(str(row.id), str(row.household_id));
  }
  const tagHouseholds = new Map<string, string>();
  for (const row of await readAll(finance, "SELECT id, household_id FROM tags")) {
    tagHouseholds.set(str(row.id), str(row.household_id));
  }

  await copyTable(ctx, householdScoped("categories", categories));
  await copyTable(ctx, householdScoped("tags", tags));

  await copyTable(
    ctx,
    householdScoped("transactions", transactions, (row, _original, ctx2) => {
      const payer = mapUser(ctx2, row.payer_id);
      if (isSkip(payer)) return payer;
      let createdBy: string | null = null;
      if (row.created_by !== null && row.created_by !== undefined) {
        // created_by is nullable (ON DELETE SET NULL): a creator that was not migrated is dropped.
        createdBy = ctx2.ids.users.finance.get(str(row.created_by)) ?? null;
      }
      return { ...row, payer_id: payer, created_by: createdBy };
    }),
  );

  await copyTable(ctx, {
    source: "finance",
    legacyTable: "transaction_tags",
    target: transactionTags,
    legacyId: (row) => `${str(row.transaction_id)}:${str(row.tag_id)}`,
    transform(row, ctx2) {
      const financeId = transactionHouseholds.get(str(row.transaction_id)) ?? tagHouseholds.get(str(row.tag_id));
      if (financeId === undefined) {
        return { skip: `transaction ${str(row.transaction_id)} not found in the finance database`, error: true };
      }
      if (!ctx2.ids.households.finance.has(financeId)) return householdSkip(ctx2, financeId);
      return { transaction_id: row.transaction_id ?? null, tag_id: row.tag_id ?? null };
    },
  });

  await copyTable(ctx, householdScoped("mutation_claims", mutationClaims));
  await copyTable(ctx, householdScoped("fixed_cost_items", fixedCostItems));

  // Incomes: a person who is not a participant is kept, with a warning (decision 14, ADR 0005).
  await copyTable(
    ctx,
    householdScoped("incomes", incomes, (row, original, ctx2) => {
      const person = mapUser(ctx2, row.person_id);
      if (isSkip(person)) return person;
      const householdId = str(row.household_id);
      if (!(seats.get(householdId) ?? []).some((seat) => seat.userId === person)) {
        ctx2.report.warnings.push(
          `income ${str(original.id)} of finance household ${str(original.household_id)} names ${emailOf(person)}, who is not a participant; the plan stays incomplete until an admin deletes or replaces it`,
        );
      }
      return { ...row, person_id: person };
    }),
  );

  // Plans: the payer must be a participant (ADR 0004's rule, ADR 0005); a leaver's payer role
  // moves to the slot-1 participant. The ledger key is the F household id.
  await copyTable(ctx, {
    ...householdScoped("fixed_cost_plans", fixedCostPlans, (row, original, ctx2) => {
      const payer = mapUser(ctx2, row.payer_id);
      if (isSkip(payer)) return payer;
      const householdSeats = seats.get(str(row.household_id)) ?? [];
      if (householdSeats.some((seat) => seat.userId === payer)) return { ...row, payer_id: payer };
      const slot1 = householdSeats.find((seat) => seat.slot === 1);
      if (!slot1) {
        return {
          skip: `finance household ${str(original.household_id)} has no slot-1 participant for its plan payer`,
          error: true,
        };
      }
      ctx2.report.warnings.push(
        `finance household ${str(original.household_id)}: plan payer ${emailOf(payer)} is not a participant; payer set to ${slot1.email}`,
      );
      return { ...row, payer_id: slot1.userId };
    }),
    legacyId: (row) => str(row.household_id),
    newId: (values) => str(values.household_id),
  });

  await copyTable(ctx, householdScoped("accrual_runs", accrualRuns));
}
