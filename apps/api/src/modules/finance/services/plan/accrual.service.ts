/**
 * The monthly run: books the non-payer's income-proportional share of the
 * fixed costs as one `OTHER_ONLY` transaction per period, strictly idempotent
 * per `(household_id, external_key)` (docs/spec.md §3.7, ledger-spec.md
 * §4.3-§4.6). Also owns `recalculate` — booked periods are immutable, so a
 * retroactive data change produces a NEW adjustment transaction, never an
 * edit of the old one.
 */
import type { RecalculatePlanResponse, RunPlanResponse, TransactionResponse } from "@toon/shared";
import { comparePeriods, computePlanForPeriod, currentPeriod, periodStartMs, periodsInclusive, serverText } from "@toon/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Database } from "../../../../db/client.ts";
import {
  type FinanceAccrualRunRow as AccrualRunRow,
  financeAccrualRuns as accrualRuns,
  financeFixedCostPlans as fixedCostPlans,
  financeTransactions as transactions,
} from "../../schema.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { nowMs } from "../../lib/clock.ts";
import { categoryIdBySlug } from "../categories/categories.service.ts";
import { loadHouseholdRow } from "../settings/settings.service.ts";
import { otherMemberId, slot1UserId } from "../participants/participants.service.ts";
import { withTransaction } from "../support.ts";
import { toTransactionResponse } from "../ledger/transactions.service.ts";
import { syncTransactionTags } from "../tags/tags.service.ts";
import { catchUpRange, isPlanComputable, periodAsMonthSlashYear } from "./period-scan.ts";
import { isPeriodBooked, listPlanInputRows, loadPlanRow, toAccrualRunResponse } from "./plan.service.ts";

/** The fixed-cost plan books into this category (docs/spec.md §2.6, §3.7). */
const PLAN_CATEGORY_SLUG = "fixkosten";

async function recordRun(
  db: Database,
  householdId: string,
  trigger: AccrualRunRow["trigger"],
  fromPeriod: string | null,
  toPeriod: string | null,
  periodsBooked: number,
  periodsSkipped: number,
  bookedCents: number,
  error: string | null,
  startedAt: number,
): Promise<AccrualRunRow> {
  const id = crypto.randomUUID();
  const finishedAt = nowMs();
  await db.insert(accrualRuns).values({
    id,
    householdId,
    trigger,
    fromPeriod,
    toPeriod,
    periodsBooked,
    periodsSkipped,
    bookedCents,
    error,
    startedAt,
    finishedAt,
  });
  return { id, householdId, trigger, fromPeriod, toPeriod, periodsBooked, periodsSkipped, bookedCents, error, startedAt, finishedAt };
}

export interface RunCatchUpOptions {
  trigger: AccrualRunRow["trigger"];
  /** Only honoured when it is BEFORE the current period — a run never books the future. */
  through?: string;
  /** `POST …/plan/run`: true (409 `plan_disabled`). Boot/interval ticks: false (silently a no-op). */
  requireEnabled: boolean;
  /** `POST …/plan/run`: true (409 `plan_incomplete` when nothing at all could be booked). Boot/interval ticks: false. */
  throwOnIncomplete: boolean;
}

export interface RunCatchUpResult {
  bookedPeriods: string[];
  skippedPeriods: string[];
  bookedCents: number;
  run: AccrualRunRow;
}

/**
 * The catch-up loop (ledger-spec.md §4.5). Booking + `lastBookedPeriod` run
 * inside ONE `withTransaction`; the `accrual_runs` audit row is written
 * AFTER that transaction settles (success OR the domain "nothing bookable"
 * case) so a `plan_incomplete` thrown to the caller never rolls back an
 * audit trail that already reflects what actually happened. A genuinely
 * unexpected failure inside the transaction still gets an audit row (`error`
 * set to the English exception message) before it is rethrown.
 */
export async function runCatchUp(db: Database, householdId: string, options: RunCatchUpOptions): Promise<RunCatchUpResult> {
  const startedAt = nowMs();
  const plan = await loadPlanRow(db, householdId);

  if (options.requireEnabled && !plan.enabled) {
    throw ApiError.conflict("plan_disabled", "server.plan.disabled");
  }
  if (!plan.enabled) {
    const run = await recordRun(db, householdId, options.trigger, null, null, 0, 0, 0, null, startedAt);
    return { bookedPeriods: [], skippedPeriods: [], bookedCents: 0, run };
  }

  const nowPeriod = currentPeriod(nowMs());
  const { from, to } = catchUpRange(plan.startPeriod, plan.lastBookedPeriod, nowPeriod, options.through);

  if (comparePeriods(from, to) > 0) {
    const run = await recordRun(db, householdId, options.trigger, null, null, 0, 0, 0, null, startedAt);
    return { bookedPeriods: [], skippedPeriods: [], bookedCents: 0, run };
  }

  const otherId = await otherMemberId(db, householdId, plan.payerId);
  const candidatePeriods = periodsInclusive(from, to);

  let outcome: { bookedPeriods: string[]; skippedPeriods: string[]; bookedCents: number; allIncomplete: boolean };
  try {
    outcome = await withTransaction(db, async (tx) => {
      if (!otherId) {
        // No second member yet — nothing can be booked as OTHER_ONLY for them.
        return { bookedPeriods: [], skippedPeriods: candidatePeriods, bookedCents: 0, allIncomplete: candidatePeriods.length > 0 };
      }

      const { items, incomeRows } = await listPlanInputRows(tx, householdId);
      const household = await loadHouseholdRow(tx, householdId);
      const categoryId = await categoryIdBySlug(tx, householdId, PLAN_CATEGORY_SLUG);

      const bookedPeriods: string[] = [];
      const skippedPeriods: string[] = [];
      let bookedCents = 0;
      // true once a period is skipped for lack of data (ledger-spec.md §4.5's
      // "gap"). `lastBookedPeriod` must never advance PAST such a period —
      // otherwise the next run's `catchUpRange` starts after it and the gap
      // can never be booked again, even once the missing data is filled in
      // (docs/spec.md's "catch-up books every missed period" would silently
      // stop being true). A period skipped for any OTHER reason (already
      // covered by an import, or a genuine zero share) is fully resolved, so
      // it is safe to advance past as long as no real gap came before it.
      let dataGapSeen = false;
      // true once at least one candidate period resolved to *something* —
      // covered, zero-share, or booked. Stays false only when EVERY candidate
      // failed `isPlanComputable`, which is the one case `plan_incomplete`
      // (`throwOnIncomplete`) should actually fire for.
      let anyResolved = false;
      let lastBooked = plan.lastBookedPeriod;

      for (const period of candidatePeriods) {
        // Already occupied by ANY origin — most commonly the one-time xlsx
        // import's rent series (`xlsx:rent:<period>`, ledger-spec.md §4.7).
        // Its `externalKey` lives in a different namespace than
        // `fixedplan:{hh}:{period}`, so the unique index below would never
        // catch this on its own — without this check the period would be
        // booked TWICE, once by the import and once by this loop.
        if (await isPeriodBooked(tx, householdId, period)) {
          skippedPeriods.push(period);
          anyResolved = true;
          if (!dataGapSeen) lastBooked = period;
          continue;
        }

        if (!isPlanComputable(items, incomeRows, period, plan.payerId, otherId)) {
          skippedPeriods.push(period);
          dataGapSeen = true;
          continue;
        }
        anyResolved = true;

        const computation = computePlanForPeriod({ period, items, incomes: incomeRows, payerId: plan.payerId, otherId });
        if (computation.bookableCents === 0) {
          skippedPeriods.push(period);
          if (!dataGapSeen) lastBooked = period;
          continue;
        }

        const id = crypto.randomUUID();
        const timestamp = nowMs();
        const description = serverText(household.defaultLocale, {
          key: "server.content.planBookingDescription",
          values: { period: periodAsMonthSlashYear(period) },
        });
        const inserted = await tx
          .insert(transactions)
          .values({
            id,
            householdId,
            payerId: plan.payerId,
            splitMode: "OTHER_ONLY",
            amountCents: computation.bookableCents,
            description,
            categoryId,
            bookedAt: periodStartMs(period),
            dateSource: "exact",
            origin: "fixed_plan",
            planPeriod: period,
            categorySource: "system",
            importSeq: null,
            externalKey: `fixedplan:${householdId}:${period}`,
            createdBy: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .onConflictDoNothing({ target: [transactions.householdId, transactions.externalKey] })
          .returning({ id: transactions.id });

        if (inserted.length > 0) {
          await syncTransactionTags(tx, householdId, id, ["fixkosten", "auto"]);
          bookedPeriods.push(period);
          bookedCents += computation.bookableCents;
          if (!dataGapSeen) lastBooked = period;
        } else {
          // Another concurrent run already booked this exact period.
          skippedPeriods.push(period);
          if (!dataGapSeen) lastBooked = period;
        }
      }

      await tx.update(fixedCostPlans).set({ lastBookedPeriod: lastBooked, updatedAt: nowMs() }).where(eq(fixedCostPlans.householdId, householdId));

      return { bookedPeriods, skippedPeriods, bookedCents, allIncomplete: !anyResolved && candidatePeriods.length > 0 };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordRun(db, householdId, options.trigger, from, to, 0, 0, 0, message, startedAt);
    throw error;
  }

  const run = await recordRun(
    db,
    householdId,
    options.trigger,
    from,
    to,
    outcome.bookedPeriods.length,
    outcome.skippedPeriods.length,
    outcome.bookedCents,
    null,
    startedAt,
  );

  if (options.throwOnIncomplete && outcome.bookedPeriods.length === 0 && outcome.allIncomplete) {
    throw ApiError.conflict("plan_incomplete", "server.plan.incomplete");
  }

  return { bookedPeriods: outcome.bookedPeriods, skippedPeriods: outcome.skippedPeriods, bookedCents: outcome.bookedCents, run };
}

/** `POST …/plan/run`. */
export async function runPlanNow(db: Database, householdId: string, through?: string): Promise<RunPlanResponse> {
  const result = await runCatchUp(db, householdId, { trigger: "manual", through, requireEnabled: true, throwOnIncomplete: true });
  return {
    bookedPeriods: result.bookedPeriods,
    skippedPeriods: result.skippedPeriods,
    bookedCents: result.bookedCents,
    run: toAccrualRunResponse(result.run),
  };
}

interface RecalculationLine {
  period: string;
  bookedCents: number;
  recomputedCents: number;
  deltaCents: number;
}

/**
 * `POST …/plan/recalculate` (ledger-spec.md §4.6). Every already-booked
 * `fixed_plan` period is recomputed against TODAY's items/incomes; a
 * difference produces a preview line, and — unless `dryRun` — a NEW
 * `fixed_plan_adjustment` transaction (never an edit of the booked row).
 * `externalKey` encodes the superseded amount, so re-running against
 * unchanged data collides (no-op) while a second correction gets its own key.
 *
 * "Superseded amount" means the EFFECTIVE booked amount — the original
 * `fixed_plan` row PLUS every `fixed_plan_adjustment` already booked for that
 * same period — not the original row alone. A second retroactive correction
 * of the same period must diff against what the first correction left
 * behind, otherwise its `externalKey` collides with the first adjustment's
 * (both would encode the same original amount) and `onConflictDoNothing`
 * silently drops it: `applied: true` but `adjustments: []`, and the ledger
 * never learns about the second change at all (ledger-spec.md §4.6).
 *
 * The candidate set is NOT "every period that has a `fixed_plan` row". A
 * period whose share came out as exactly 0 writes no row at all (`runCatchUp`'s
 * `bookableCents === 0` branch) and still advances `lastBookedPeriod`, so a
 * row-driven recalculation cannot see it and the catch-up loop never returns
 * to it either — a later income/item correction that turns that share non-zero
 * would be lost for good, with no API path back. `[startPeriod,
 * lastBookedPeriod]` — every period a run has already walked past — is
 * therefore part of the candidate set, and a period with no plan row simply
 * diffs against 0.
 *
 * Each period is recomputed for the payer THAT PERIOD was booked under, read
 * off its own row (`payerByPeriod`), never `plan.payerId`. That column is
 * mutable via `PATCH …/plan { payerId }` and carries no history, so using it
 * for a historical month would recompute January under whoever pays today: the
 * two incomes swap places in `share(other) = income × costTotal / incomeTotal`,
 * every already-booked period reports a delta that corresponds to no change in
 * the data, and the household gets a full set of adjustments the moment it
 * decides the other person takes over the fixed costs. Periods with no plan row
 * (a share of exactly 0) have no payer of record and fall back to the plan's.
 */
export async function recalculatePlan(db: Database, householdId: string, viewerId: string, dryRun: boolean): Promise<RecalculatePlanResponse> {
  const plan = await loadPlanRow(db, householdId);
  if (!plan.enabled) throw ApiError.conflict("plan_disabled", "server.plan.disabled");

  const { items, incomeRows } = await listPlanInputRows(db, householdId);

  // Every row claiming a plan period, in ONE query, partitioned by origin:
  // `fixed_plan` + `fixed_plan_adjustment` together are the EFFECTIVE booked
  // amount, while ANY other origin (the one-time xlsx rent series, a manual
  // row carrying a planPeriod) means the plan deliberately never booked that
  // month — `runCatchUp`'s `isPeriodBooked` skip — and must not start now.
  const periodRows = await db
    .select({
      planPeriod: transactions.planPeriod,
      origin: transactions.origin,
      amountCents: transactions.amountCents,
      payerId: transactions.payerId,
    })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), isNotNull(transactions.planPeriod)));

  const bookedByPeriod = new Map<string, number>();
  const adjustmentSumByPeriod = new Map<string, number>();
  const foreignPeriods = new Set<string>();
  // The payer OF RECORD per period, read off the row the plan actually wrote.
  // `plan.payerId` is the payer of TODAY, not of that month.
  const payerByPeriod = new Map<string, string>();
  for (const row of periodRows) {
    const period = row.planPeriod;
    if (!period) continue;
    if (row.origin === "fixed_plan") {
      bookedByPeriod.set(period, (bookedByPeriod.get(period) ?? 0) + row.amountCents);
      payerByPeriod.set(period, row.payerId);
    } else if (row.origin === "fixed_plan_adjustment") {
      adjustmentSumByPeriod.set(period, (adjustmentSumByPeriod.get(period) ?? 0) + row.amountCents);
      // Only as a fallback: a period whose share came out 0 has no `fixed_plan`
      // row, so its adjustments are the only record of who was paying.
      if (!payerByPeriod.has(period)) payerByPeriod.set(period, row.payerId);
    } else {
      foreignPeriods.add(period);
    }
  }

  /** The payer/other pair that was in effect for `period`. */
  const otherIdByPayer = new Map<string, string | null>();
  async function membersForPeriod(period: string): Promise<{ payerId: string; otherId: string | null }> {
    const payerId = payerByPeriod.get(period) ?? plan.payerId;
    if (!otherIdByPayer.has(payerId)) otherIdByPayer.set(payerId, await otherMemberId(db, householdId, payerId));
    return { payerId, otherId: otherIdByPayer.get(payerId) ?? null };
  }

  const candidatePeriods = new Set<string>(bookedByPeriod.keys());
  if (plan.lastBookedPeriod !== null && comparePeriods(plan.startPeriod, plan.lastBookedPeriod) <= 0) {
    for (const period of periodsInclusive(plan.startPeriod, plan.lastBookedPeriod)) candidatePeriods.add(period);
  }

  const lines: RecalculationLine[] = [];
  for (const period of candidatePeriods) {
    const { payerId, otherId } = await membersForPeriod(period);
    if (!otherId) continue;
    if (!isPlanComputable(items, incomeRows, period, payerId, otherId)) continue;
    // Occupied by an import/manual row rather than by the plan: that period
    // is somebody else's, and an adjustment on top would double-count it.
    if (!bookedByPeriod.has(period) && foreignPeriods.has(period)) continue;
    const effectiveBookedCents = (bookedByPeriod.get(period) ?? 0) + (adjustmentSumByPeriod.get(period) ?? 0);
    const computation = computePlanForPeriod({ period, items, incomes: incomeRows, payerId, otherId });
    const delta = computation.bookableCents - effectiveBookedCents;
    if (delta !== 0) {
      lines.push({ period, bookedCents: effectiveBookedCents, recomputedCents: computation.bookableCents, deltaCents: delta });
    }
  }
  lines.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  const totalDeltaCents = lines.reduce((sum, line) => sum + line.deltaCents, 0);

  if (dryRun || lines.length === 0) {
    return { items: lines, totalDeltaCents, applied: false, adjustments: [] };
  }

  const adjustments: TransactionResponse[] = await withTransaction(db, async (tx) => {
    const household = await loadHouseholdRow(tx, householdId);
    const categoryId = await categoryIdBySlug(tx, householdId, PLAN_CATEGORY_SLUG);
    const person1Id = await slot1UserId(tx, householdId);
    const created: TransactionResponse[] = [];

    for (const line of lines) {
      const id = crypto.randomUUID();
      const timestamp = nowMs();
      const description = serverText(household.defaultLocale, {
        key: "server.content.planAdjustmentDescription",
        values: { period: periodAsMonthSlashYear(line.period) },
      });
      const inserted = await tx
        .insert(transactions)
        .values({
          id,
          householdId,
          // The period's own payer, for the same reason the delta was computed
          // against them: attributing a correction of a month A paid for to B
          // flips the sign the balance moves in.
          payerId: payerByPeriod.get(line.period) ?? plan.payerId,
          splitMode: "OTHER_ONLY",
          amountCents: line.deltaCents,
          description,
          categoryId,
          bookedAt: timestamp,
          dateSource: "exact",
          origin: "fixed_plan_adjustment",
          planPeriod: line.period,
          categorySource: "system",
          importSeq: null,
          externalKey: `fixedplan-adj:${householdId}:${line.period}:${line.bookedCents}`,
          createdBy: viewerId,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .onConflictDoNothing({ target: [transactions.householdId, transactions.externalKey] })
        .returning({ id: transactions.id });

      if (inserted.length === 0) continue; // re-run against unchanged data: already applied
      await syncTransactionTags(tx, householdId, id, ["fixkosten", "korrektur"]);
      const rows = await tx.select().from(transactions).where(eq(transactions.id, id)).limit(1);
      created.push(await toTransactionResponse(tx, rows[0]!, person1Id));
    }
    return created;
  });

  return { items: lines, totalDeltaCents, applied: true, adjustments };
}
