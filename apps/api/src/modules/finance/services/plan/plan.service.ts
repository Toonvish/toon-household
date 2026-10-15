/**
 * Reading and writing the fixed-cost plan itself: the one `fixed_cost_plans`
 * row, its `fixed_cost_items` and `incomes`, and the read-only preview that
 * shows what a period WOULD compute to before anything is booked
 * (docs/spec.md §3.7). The actual booking side effect lives in
 * `accrual.service.ts` — this file never writes a `transactions` row.
 */
import type {
  AccrualRunResponse,
  CreateFixedCostItemRequest,
  CreateIncomeRequest,
  FixedCostItemResponse,
  IncomeResponse,
  PlanComputationResponse,
  PlanResponse,
  UpdateFixedCostItemRequest,
  UpdateIncomeRequest,
  UpdatePlanRequest,
} from "@toon/shared";
import { comparePeriods, computePlanForPeriod, currentPeriod, DEFAULT_LOCALE, periodsInclusive, serverText } from "@toon/shared";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type { Database } from "../../../../db/client.ts";
import {
  type FinanceAccrualRunRow as AccrualRunRow,
  financeAccrualRuns as accrualRuns,
  type FinanceFixedCostItemRow as FixedCostItemRow,
  financeFixedCostItems as fixedCostItems,
  type FinanceFixedCostPlanRow as FixedCostPlanRow,
  financeFixedCostPlans as fixedCostPlans,
  type FinanceIncomeRow as IncomeRow,
  financeIncomes as incomes,
  financeTransactions as transactions,
} from "../../schema.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { nowMs } from "../../lib/clock.ts";
import { toIso } from "../../../../lib/http.ts";
import { isUniqueViolation } from "../../../../core/services/auth/users.ts";
import { otherMemberId, participantSlotOf } from "../participants/participants.service.ts";
import type { DbLike } from "../support.ts";
import { catchUpRange, isPlanComputable } from "./period-scan.ts";

export async function loadPlanRow(db: Database, householdId: string): Promise<FixedCostPlanRow> {
  const rows = await db.select().from(fixedCostPlans).where(eq(fixedCostPlans.householdId, householdId)).limit(1);
  const row = rows[0];
  if (!row) throw ApiError.internal(); // seeded at household creation — missing is a programming error
  return row;
}

function toItemResponse(row: FixedCostItemRow): FixedCostItemResponse {
  return { id: row.id, label: row.label, amountCents: row.amountCents, activeFrom: row.activeFrom, activeTo: row.activeTo, position: row.position };
}

function toIncomeResponse(row: IncomeRow): IncomeResponse {
  return { id: row.id, personId: row.personId, amountCents: row.amountCents, validFrom: row.validFrom, validTo: row.validTo };
}

export function toAccrualRunResponse(row: AccrualRunRow): AccrualRunResponse {
  return {
    id: row.id,
    trigger: row.trigger,
    fromPeriod: row.fromPeriod,
    toPeriod: row.toPeriod,
    periodsBooked: row.periodsBooked,
    periodsSkipped: row.periodsSkipped,
    bookedCents: row.bookedCents,
    error: row.error,
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
  };
}

async function listItemRows(db: DbLike, householdId: string): Promise<FixedCostItemRow[]> {
  return db.select().from(fixedCostItems).where(eq(fixedCostItems.householdId, householdId)).orderBy(asc(fixedCostItems.position));
}

async function listIncomeRows(db: DbLike, householdId: string): Promise<IncomeRow[]> {
  return db.select().from(incomes).where(eq(incomes.householdId, householdId)).orderBy(asc(incomes.validFrom));
}

/**
 * The two temporal tables every computation needs, concurrently — they have no
 * data dependency on each other, and every plan read wants both. One helper so
 * the pair cannot drift apart between the callers that load it.
 */
async function listPlanInputRows(db: DbLike, householdId: string): Promise<{ items: FixedCostItemRow[]; incomeRows: IncomeRow[] }> {
  const [items, incomeRows] = await Promise.all([listItemRows(db, householdId), listIncomeRows(db, householdId)]);
  return { items, incomeRows };
}

/**
 * Whether ANY row already occupies this period — regardless of `origin`.
 * Deliberately NOT filtered to `origin = 'fixed_plan'`: an imported rent-series
 * row (`origin = 'import'`, `planPeriod` set by scripts/import/rent.ts) covers
 * the period exactly as much as a live plan booking would, and the catch-up
 * loop in accrual.service.ts relies on this same function to refuse booking a
 * period a second time under a different `externalKey` namespace (the
 * `xlsx:rent:*` vs. `fixedplan:*` collision docs/ledger-spec.md §4.7 requires
 * to never happen, but the unique index alone cannot see across namespaces).
 */
export async function isPeriodBooked(db: DbLike, householdId: string, period: string): Promise<boolean> {
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.planPeriod, period)))
    .limit(1);
  return rows.length > 0;
}

async function computeCurrent(
  db: Database,
  householdId: string,
  plan: FixedCostPlanRow,
  items: FixedCostItemRow[],
  incomeRows: IncomeRow[],
  period: string,
): Promise<PlanComputationResponse | null> {
  const otherId = await otherMemberId(db, householdId, plan.payerId);
  if (!otherId || !isPlanComputable(items, incomeRows, period, plan.payerId, otherId)) return null;

  const computation = computePlanForPeriod({ period, items, incomes: incomeRows, payerId: plan.payerId, otherId });
  const booked = await isPeriodBooked(db, householdId, period);
  return {
    period: computation.period,
    costTotalCents: computation.costTotalCents,
    incomeTotalCents: computation.incomeTotalCents,
    quoteNumerator: computation.quoteNumerator,
    quoteDenominator: computation.quoteDenominator,
    shares: computation.shares,
    payerId: computation.payerId,
    bookableCents: computation.bookableCents,
    booked,
  };
}

async function lastRunOf(db: Database, householdId: string): Promise<AccrualRunResponse | null> {
  const rows = await db.select().from(accrualRuns).where(eq(accrualRuns.householdId, householdId)).orderBy(desc(accrualRuns.startedAt)).limit(1);
  const row = rows[0];
  return row ? toAccrualRunResponse(row) : null;
}

/** `GET …/plan`: everything the plan screen needs in one call. */
export async function getPlanResponse(db: Database, householdId: string): Promise<PlanResponse> {
  const plan = await loadPlanRow(db, householdId);
  const { items, incomeRows } = await listPlanInputRows(db, householdId);
  const nowPeriod = currentPeriod(nowMs());

  const current = await computeCurrent(db, householdId, plan, items, incomeRows, nowPeriod);
  const lastRun = await lastRunOf(db, householdId);
  const { from, to } = catchUpRange(plan.startPeriod, plan.lastBookedPeriod, nowPeriod);
  const pendingPeriods = plan.enabled && comparePeriods(from, to) <= 0 ? periodsInclusive(from, to) : [];

  return {
    plan: { enabled: plan.enabled, payerId: plan.payerId, startPeriod: plan.startPeriod, lastBookedPeriod: plan.lastBookedPeriod },
    items: items.map(toItemResponse),
    incomes: incomeRows.map(toIncomeResponse),
    current,
    lastRun,
    pendingPeriods,
  };
}

/**
 * The latest period ANY transaction already occupies — regardless of origin.
 * Used to keep `startPeriod` from being moved onto or before a period the
 * one-time xlsx import already booked as rent (review finding #3/#4,
 * ledger-spec.md §4.7): without this check, `PATCH .../plan { startPeriod }`
 * would happily accept a value inside the imported range, and the very next
 * catch-up run would try to book those months a second time under
 * `fixedplan:{hh}:{p}` — caught by `isPeriodBooked` in the run itself, but
 * only AFTER the plan has already advertised (via `pendingPeriods`) periods
 * it can never actually book. Failing fast here is cheaper and clearer.
 */
async function maxOccupiedPeriod(db: Database, householdId: string): Promise<string | null> {
  const rows = await db
    .select({ planPeriod: transactions.planPeriod })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), isNotNull(transactions.planPeriod)))
    .orderBy(desc(transactions.planPeriod))
    .limit(1);
  return rows[0]?.planPeriod ?? null;
}

/**
 * The plan payer and an income's person must be one of the household's `finance_participants`
 * (M3 review finding B, SPEC D3/D8): the household comes from the path only, never from the id
 * being checked, so a member without a seat or a user of another household is refused with
 * `422 validation_failed` and a detail on `field` carrying `server.finance.personNotParticipant`
 * (the same issue shape as every other service-side validation, toon-finance gotcha 47).
 */
async function assertParticipant(db: DbLike, householdId: string, userId: string, field: "payerId" | "personId"): Promise<void> {
  if ((await participantSlotOf(db, householdId, userId)) !== null) return;
  throw ApiError.validationFailed(
    [
      {
        path: field,
        code: "custom",
        message: serverText(DEFAULT_LOCALE, "server.finance.personNotParticipant"),
        i18n: { key: "server.finance.personNotParticipant" },
      },
    ],
    "server.finance.personNotParticipant",
  );
}

/**
 * `activeTo`/`validTo` before `activeFrom`/`validFrom` would hit the DB CHECK and surface as a 500
 * (toon-finance 1715207). Thrown explicitly, not as a Zod refinement: a refinement on a partial
 * PATCH cannot see the row's other half (F gotcha 48).
 */
function assertPeriodRange(from: string, to: string | null | undefined): void {
  if (to !== null && to !== undefined && comparePeriods(to, from) < 0) {
    throw ApiError.validationFailed(undefined, "server.validation.periodRange");
  }
}

export async function updatePlan(db: Database, householdId: string, input: UpdatePlanRequest): Promise<PlanResponse> {
  if (input.startPeriod !== undefined) {
    const occupied = await maxOccupiedPeriod(db, householdId);
    if (occupied && comparePeriods(input.startPeriod, occupied) <= 0) {
      throw ApiError.conflict("plan_period_locked", "server.plan.periodLocked");
    }
  }
  if (input.payerId !== undefined) await assertParticipant(db, householdId, input.payerId, "payerId");
  if (input.enabled === true && input.payerId === undefined) {
    // Switching the plan on must start from a participant, too: the payer of record may have been
    // seated once and left since (toon-finance 1715207, gotcha 70).
    const current = await loadPlanRow(db, householdId);
    await assertParticipant(db, householdId, current.payerId, "payerId");
  }
  const patch: Partial<typeof fixedCostPlans.$inferInsert> = { updatedAt: nowMs() };
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.payerId !== undefined) patch.payerId = input.payerId;
  if (input.startPeriod !== undefined) patch.startPeriod = input.startPeriod;
  await db.update(fixedCostPlans).set(patch).where(eq(fixedCostPlans.householdId, householdId));
  return getPlanResponse(db, householdId);
}

/**
 * `GET …/plan/preview?period=`. `422 plan_period_out_of_range` before
 * `startPeriod` or after the current period; `409 plan_incomplete` when the
 * period cannot be computed (docs/spec.md §3.7).
 */
export async function previewPlan(db: Database, householdId: string, period: string): Promise<PlanComputationResponse> {
  const plan = await loadPlanRow(db, householdId);
  const nowPeriod = currentPeriod(nowMs());
  if (comparePeriods(period, plan.startPeriod) < 0 || comparePeriods(period, nowPeriod) > 0) {
    throw new ApiError(422, "plan_period_out_of_range", "server.plan.periodOutOfRange");
  }

  const { items, incomeRows } = await listPlanInputRows(db, householdId);
  const result = await computeCurrent(db, householdId, plan, items, incomeRows, period);
  if (!result) throw ApiError.conflict("plan_incomplete", "server.plan.incomplete");
  return result;
}

/* -------------------------------------------------------------------------- */
/* fixed-cost items                                                          */
/* -------------------------------------------------------------------------- */

async function nextItemPosition(db: Database, householdId: string): Promise<number> {
  const rows = await listItemRows(db, householdId);
  const last = rows.at(-1)?.position;
  return last === undefined ? 0 : last + 1;
}

export async function createFixedCostItem(db: Database, householdId: string, input: CreateFixedCostItemRequest): Promise<FixedCostItemResponse> {
  assertPeriodRange(input.activeFrom, input.activeTo);
  const id = crypto.randomUUID();
  const timestamp = nowMs();
  const position = input.position ?? (await nextItemPosition(db, householdId));
  await db.insert(fixedCostItems).values({
    id,
    householdId,
    label: input.label,
    amountCents: input.amountCents,
    activeFrom: input.activeFrom,
    activeTo: input.activeTo ?? null,
    position,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return toItemResponse(await loadItemOr404(db, householdId, id));
}

async function loadItemOr404(db: Database, householdId: string, itemId: string): Promise<FixedCostItemRow> {
  const rows = await db.select().from(fixedCostItems).where(and(eq(fixedCostItems.id, itemId), eq(fixedCostItems.householdId, householdId))).limit(1);
  const row = rows[0];
  if (!row) throw ApiError.notFound();
  return row;
}

export async function updateFixedCostItem(
  db: Database,
  householdId: string,
  itemId: string,
  input: UpdateFixedCostItemRequest,
): Promise<FixedCostItemResponse> {
  const existing = await loadItemOr404(db, householdId, itemId);
  assertPeriodRange(input.activeFrom ?? existing.activeFrom, input.activeTo === undefined ? existing.activeTo : input.activeTo);
  const patch: Partial<typeof fixedCostItems.$inferInsert> = { updatedAt: nowMs() };
  if (input.label !== undefined) patch.label = input.label;
  if (input.amountCents !== undefined) patch.amountCents = input.amountCents;
  if (input.activeFrom !== undefined) patch.activeFrom = input.activeFrom;
  if (input.activeTo !== undefined) patch.activeTo = input.activeTo ?? null;
  if (input.position !== undefined) patch.position = input.position;
  await db.update(fixedCostItems).set(patch).where(eq(fixedCostItems.id, itemId));
  return toItemResponse(await loadItemOr404(db, householdId, itemId));
}

export async function deleteFixedCostItem(db: Database, householdId: string, itemId: string): Promise<void> {
  await loadItemOr404(db, householdId, itemId);
  await db.delete(fixedCostItems).where(eq(fixedCostItems.id, itemId));
}

/* -------------------------------------------------------------------------- */
/* incomes                                                                    */
/* -------------------------------------------------------------------------- */

async function loadIncomeOr404(db: Database, householdId: string, incomeId: string): Promise<IncomeRow> {
  const rows = await db.select().from(incomes).where(and(eq(incomes.id, incomeId), eq(incomes.householdId, householdId))).limit(1);
  const row = rows[0];
  if (!row) throw ApiError.notFound();
  return row;
}

/**
 * `409 conflict` when this person already has an income row starting the
 * SAME month (`incomes_person_from_uidx`, docs/spec.md §2.11). A broader
 * overlap across different `validFrom`s is intentionally NOT rejected here —
 * the DB cannot see it either, and it surfaces as `plan_incomplete` at
 * compute time instead (`period-scan.ts`'s `isPlanComputable`).
 */
export async function createIncome(db: Database, householdId: string, input: CreateIncomeRequest): Promise<IncomeResponse> {
  await assertParticipant(db, householdId, input.personId, "personId");
  assertPeriodRange(input.validFrom, input.validTo);
  const id = crypto.randomUUID();
  const timestamp = nowMs();
  try {
    await db.insert(incomes).values({
      id,
      householdId,
      personId: input.personId,
      amountCents: input.amountCents,
      validFrom: input.validFrom,
      validTo: input.validTo ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw ApiError.conflict("conflict", "server.plan.incomeOverlap");
    throw error;
  }
  return toIncomeResponse(await loadIncomeOr404(db, householdId, id));
}

export async function updateIncome(db: Database, householdId: string, incomeId: string, input: UpdateIncomeRequest): Promise<IncomeResponse> {
  const existing = await loadIncomeOr404(db, householdId, incomeId);
  if (input.personId !== undefined) await assertParticipant(db, householdId, input.personId, "personId");
  assertPeriodRange(input.validFrom ?? existing.validFrom, input.validTo === undefined ? existing.validTo : input.validTo);
  const patch: Partial<typeof incomes.$inferInsert> = { updatedAt: nowMs() };
  if (input.personId !== undefined) patch.personId = input.personId;
  if (input.amountCents !== undefined) patch.amountCents = input.amountCents;
  if (input.validFrom !== undefined) patch.validFrom = input.validFrom;
  if (input.validTo !== undefined) patch.validTo = input.validTo ?? null;
  try {
    await db.update(incomes).set(patch).where(eq(incomes.id, incomeId));
  } catch (error) {
    if (isUniqueViolation(error)) throw ApiError.conflict("conflict", "server.plan.incomeOverlap");
    throw error;
  }
  return toIncomeResponse(await loadIncomeOr404(db, householdId, incomeId));
}

export async function deleteIncome(db: Database, householdId: string, incomeId: string): Promise<void> {
  await loadIncomeOr404(db, householdId, incomeId);
  await db.delete(incomes).where(eq(incomes.id, incomeId));
}

/** `GET …/plan/runs` — the audit trail, most recent first. */
export async function listAccrualRuns(
  db: Database,
  householdId: string,
  limit: number,
  offset: number,
): Promise<{ items: AccrualRunResponse[]; total: number }> {
  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(accrualRuns)
      .where(eq(accrualRuns.householdId, householdId))
      .orderBy(desc(accrualRuns.startedAt))
      .limit(limit)
      .offset(offset),
    db.select({ id: accrualRuns.id }).from(accrualRuns).where(eq(accrualRuns.householdId, householdId)),
  ]);
  return { items: rows.map(toAccrualRunResponse), total: totalRows.length };
}

export { listItemRows, listIncomeRows, listPlanInputRows };
