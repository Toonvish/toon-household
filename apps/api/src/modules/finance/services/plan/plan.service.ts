/**
 * Reading and writing the fixed-cost plan itself: the one `fixed_cost_plans`
 * row, its `fixed_cost_items` and `incomes`, and the read-only preview that
 * shows what a period WOULD compute to before anything is booked
 * (docs/spec.md §3.7). The actual booking side effect lives in
 * `accrual.service.ts` — this file never writes a `transactions` row.
 *
 * AS A SERVICE (docs/EFFECT.md E5, E6, E7, E12; plan `docs/plans/e4-finance-services.md` P2, P6, P7, P10). `FinancePlan`
 * keeps every old function name with the leading `db` parameter dropped; it reads the current executor of `Database`
 * on every call, takes the time from the module clock (`financeTimeMillis`), asks `FinanceParticipants` for seats and
 * refuses with the API error family (same status, code, text and details as before). `toAccrualRunResponse` stays a
 * pure export. The legacy bridges at the end keep the Promise functions the routes, the accrual and the seed still call.
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
import { Context, Effect, Layer } from "effect";
import type { Database as DrizzleDatabase } from "../../../../db/client.ts";
import { Database } from "../../../../db/database.ts";
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
import { ApiFailure, Conflict, Internal, NotFound, ValidationFailed } from "../../../../lib/errors.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { toIso } from "../../../../lib/http.ts";
import { isUniqueViolation } from "../../../../core/services/auth/users.ts";
import { runFinanceBridge } from "../../bridge.ts";
import { financeTimeMillis } from "../../lib/clock.ts";
import { FinanceParticipants } from "../participants/participants.service.ts";
import type { DbLike } from "../support.ts";
import { catchUpRange, isPlanComputable } from "./period-scan.ts";

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

/**
 * The plan payer and an income's person must be one of the household's `finance_participants`
 * (M3 review finding B, SPEC D3/D8): the household comes from the path only, never from the id
 * being checked, so a member without a seat or a user of another household is refused with
 * `422 validation_failed` and a detail on `field` carrying `server.finance.personNotParticipant`
 * (the same issue shape as every other service-side validation, toon-finance gotcha 48).
 */
function personNotParticipant(field: "payerId" | "personId"): ValidationFailed {
  return new ValidationFailed({
    details: [
      {
        path: field,
        code: "custom",
        message: serverText(DEFAULT_LOCALE, "server.finance.personNotParticipant"),
        i18n: { key: "server.finance.personNotParticipant" },
      },
    ],
    text: "server.finance.personNotParticipant",
  });
}

/**
 * `activeTo`/`validTo` before `activeFrom`/`validFrom` would hit the DB CHECK and surface as a 500
 * (toon-finance 1715207). Failed explicitly, not as a schema refinement: a refinement on a partial
 * PATCH cannot see the row's other half (F gotcha 48).
 */
function assertPeriodRange(from: string, to: string | null | undefined): Effect.Effect<void, ValidationFailed> {
  return to !== null && to !== undefined && comparePeriods(to, from) < 0
    ? Effect.fail(new ValidationFailed({ text: "server.validation.periodRange" }))
    : Effect.void;
}

function incomeOverlap(): Conflict {
  return new Conflict({ code: "conflict", text: "server.plan.incomeOverlap" });
}

/** The fixed-cost plan of a household: the row, its items and incomes, the preview, the audit trail. */
export class FinancePlan extends Context.Service<
  FinancePlan,
  {
    /** The household's one plan row (seeded at household creation — a missing row is a programming error: `500`). */
    readonly loadPlanRow: (householdId: string) => Effect.Effect<FixedCostPlanRow, Internal | DatabaseError>;
    /** The two temporal tables every computation needs: the items by position, the incomes by `validFrom`. */
    readonly listPlanInputRows: (
      householdId: string,
    ) => Effect.Effect<{ items: FixedCostItemRow[]; incomeRows: IncomeRow[] }, DatabaseError>;
    /**
     * Whether ANY row already occupies this period — regardless of `origin`. Deliberately NOT filtered to
     * `origin = 'fixed_plan'`: an imported rent-series row (`origin = 'import'`, `planPeriod` set by the xlsx import)
     * covers the period exactly as much as a live plan booking would, and the catch-up loop in the accrual relies on
     * this same function to refuse booking a period a second time under a different `externalKey` namespace
     * (the `xlsx:rent:*` vs. `fixedplan:*` collision docs/ledger-spec.md §4.7 requires to never happen, but the unique
     * index alone cannot see across namespaces).
     */
    readonly isPeriodBooked: (householdId: string, period: string) => Effect.Effect<boolean, DatabaseError>;
    /** `GET …/plan`: everything the plan screen needs in one call. */
    readonly getPlanResponse: (householdId: string) => Effect.Effect<PlanResponse, Internal | DatabaseError>;
    /** `PATCH …/plan`: `409 plan_period_locked` onto or before an occupied period, `422` for a non-participant payer. */
    readonly updatePlan: (
      householdId: string,
      input: UpdatePlanRequest,
    ) => Effect.Effect<PlanResponse, Conflict | ValidationFailed | Internal | DatabaseError>;
    /**
     * `GET …/plan/preview?period=`. `422 plan_period_out_of_range` before `startPeriod` or after the current period;
     * `409 plan_incomplete` when the period cannot be computed (docs/spec.md §3.7).
     */
    readonly previewPlan: (
      householdId: string,
      period: string,
    ) => Effect.Effect<PlanComputationResponse, ApiFailure | Conflict | Internal | DatabaseError>;
    readonly createFixedCostItem: (
      householdId: string,
      input: CreateFixedCostItemRequest,
    ) => Effect.Effect<FixedCostItemResponse, ValidationFailed | NotFound | DatabaseError>;
    readonly updateFixedCostItem: (
      householdId: string,
      itemId: string,
      input: UpdateFixedCostItemRequest,
    ) => Effect.Effect<FixedCostItemResponse, ValidationFailed | NotFound | DatabaseError>;
    readonly deleteFixedCostItem: (householdId: string, itemId: string) => Effect.Effect<void, NotFound | DatabaseError>;
    /**
     * `409 conflict` when this person already has an income row starting the SAME month (`incomes_person_from_uidx`,
     * docs/spec.md §2.11). A broader overlap across different `validFrom`s is intentionally NOT rejected here — the DB
     * cannot see it either, and it surfaces as `plan_incomplete` at compute time instead (`period-scan.ts`).
     */
    readonly createIncome: (
      householdId: string,
      input: CreateIncomeRequest,
    ) => Effect.Effect<IncomeResponse, Conflict | ValidationFailed | NotFound | DatabaseError>;
    readonly updateIncome: (
      householdId: string,
      incomeId: string,
      input: UpdateIncomeRequest,
    ) => Effect.Effect<IncomeResponse, Conflict | ValidationFailed | NotFound | DatabaseError>;
    readonly deleteIncome: (householdId: string, incomeId: string) => Effect.Effect<void, NotFound | DatabaseError>;
    /** `GET …/plan/runs` — the audit trail, most recent first. */
    readonly listAccrualRuns: (
      householdId: string,
      limit: number,
      offset: number,
    ) => Effect.Effect<{ items: AccrualRunResponse[]; total: number }, DatabaseError>;
  }
>()("toon/api/modules/finance/services/plan/plan.service/FinancePlan") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const participants = yield* FinanceParticipants;

      const loadPlanRow = Effect.fn("FinancePlan.loadPlanRow")(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db.select().from(fixedCostPlans).where(eq(fixedCostPlans.householdId, householdId)).limit(1),
        );
        const row = rows[0];
        if (!row) return yield* new Internal(); // seeded at household creation — missing is a programming error
        return row;
      });

      const listItemRows = Effect.fnUntraced(function* (householdId: string) {
        return yield* database.use((db) =>
          db.select().from(fixedCostItems).where(eq(fixedCostItems.householdId, householdId)).orderBy(asc(fixedCostItems.position)),
        );
      });

      const listIncomeRows = Effect.fnUntraced(function* (householdId: string) {
        return yield* database.use((db) =>
          db.select().from(incomes).where(eq(incomes.householdId, householdId)).orderBy(asc(incomes.validFrom)),
        );
      });

      // The two reads have no data dependency on each other and every plan read wants both: one helper so the pair
      // cannot drift apart between the callers that load it.
      const listPlanInputRows = Effect.fn("FinancePlan.listPlanInputRows")(function* (householdId: string) {
        const [items, incomeRows] = yield* Effect.all([listItemRows(householdId), listIncomeRows(householdId)]);
        return { items, incomeRows };
      });

      const isPeriodBooked = Effect.fn("FinancePlan.isPeriodBooked")(function* (householdId: string, period: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ id: transactions.id })
            .from(transactions)
            .where(and(eq(transactions.householdId, householdId), eq(transactions.planPeriod, period)))
            .limit(1),
        );
        return rows.length > 0;
      });

      const computeCurrent = Effect.fnUntraced(function* (
        householdId: string,
        plan: FixedCostPlanRow,
        items: FixedCostItemRow[],
        incomeRows: IncomeRow[],
        period: string,
      ) {
        const otherId = yield* participants.otherMemberId(householdId, plan.payerId);
        if (!otherId || !isPlanComputable(items, incomeRows, period, plan.payerId, otherId)) return null;

        const computation = computePlanForPeriod({ period, items, incomes: incomeRows, payerId: plan.payerId, otherId });
        const booked = yield* isPeriodBooked(householdId, period);
        const result: PlanComputationResponse = {
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
        return result;
      });

      const lastRunOf = Effect.fnUntraced(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db.select().from(accrualRuns).where(eq(accrualRuns.householdId, householdId)).orderBy(desc(accrualRuns.startedAt)).limit(1),
        );
        const row = rows[0];
        return row ? toAccrualRunResponse(row) : null;
      });

      const getPlanResponse = Effect.fn("FinancePlan.getPlanResponse")(function* (householdId: string) {
        const plan = yield* loadPlanRow(householdId);
        const { items, incomeRows } = yield* listPlanInputRows(householdId);
        const nowPeriod = currentPeriod(yield* financeTimeMillis);

        const current = yield* computeCurrent(householdId, plan, items, incomeRows, nowPeriod);
        const lastRun = yield* lastRunOf(householdId);
        const { from, to } = catchUpRange(plan.startPeriod, plan.lastBookedPeriod, nowPeriod);
        const pendingPeriods = plan.enabled && comparePeriods(from, to) <= 0 ? periodsInclusive(from, to) : [];

        const response: PlanResponse = {
          plan: { enabled: plan.enabled, payerId: plan.payerId, startPeriod: plan.startPeriod, lastBookedPeriod: plan.lastBookedPeriod },
          items: items.map(toItemResponse),
          incomes: incomeRows.map(toIncomeResponse),
          current,
          lastRun,
          pendingPeriods,
        };
        return response;
      });

      /**
       * The latest period ANY transaction already occupies — regardless of origin. Used to keep `startPeriod` from
       * being moved onto or before a period the one-time xlsx import already booked as rent (review finding #3/#4,
       * ledger-spec.md §4.7): without this check, `PATCH .../plan { startPeriod }` would happily accept a value inside
       * the imported range, and the very next catch-up run would try to book those months a second time under
       * `fixedplan:{hh}:{p}` — caught by `isPeriodBooked` in the run itself, but only AFTER the plan has already
       * advertised (via `pendingPeriods`) periods it can never actually book. Failing fast here is cheaper and clearer.
       */
      const maxOccupiedPeriod = Effect.fnUntraced(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ planPeriod: transactions.planPeriod })
            .from(transactions)
            .where(and(eq(transactions.householdId, householdId), isNotNull(transactions.planPeriod)))
            .orderBy(desc(transactions.planPeriod))
            .limit(1),
        );
        return rows[0]?.planPeriod ?? null;
      });

      const assertParticipant = Effect.fnUntraced(function* (
        householdId: string,
        userId: string,
        field: "payerId" | "personId",
      ) {
        const slot = yield* participants.participantSlotOf(householdId, userId);
        if (slot === null) return yield* personNotParticipant(field);
      });

      const updatePlan = Effect.fn("FinancePlan.updatePlan")(function* (householdId: string, input: UpdatePlanRequest) {
        if (input.startPeriod !== undefined) {
          const occupied = yield* maxOccupiedPeriod(householdId);
          if (occupied && comparePeriods(input.startPeriod, occupied) <= 0) {
            return yield* new Conflict({ code: "plan_period_locked", text: "server.plan.periodLocked" });
          }
        }
        if (input.payerId !== undefined) yield* assertParticipant(householdId, input.payerId, "payerId");
        if (input.enabled === true && input.payerId === undefined) {
          // Switching the plan on must start from a participant, too: the payer of record may have been
          // seated once and left since (toon-finance 1715207, gotcha 68).
          const current = yield* loadPlanRow(householdId);
          yield* assertParticipant(householdId, current.payerId, "payerId");
        }
        const patch: Partial<typeof fixedCostPlans.$inferInsert> = { updatedAt: yield* financeTimeMillis };
        if (input.enabled !== undefined) patch.enabled = input.enabled;
        if (input.payerId !== undefined) patch.payerId = input.payerId;
        if (input.startPeriod !== undefined) patch.startPeriod = input.startPeriod;
        yield* database.use((db) => db.update(fixedCostPlans).set(patch).where(eq(fixedCostPlans.householdId, householdId)));
        return yield* getPlanResponse(householdId);
      });

      const previewPlan = Effect.fn("FinancePlan.previewPlan")(function* (householdId: string, period: string) {
        const plan = yield* loadPlanRow(householdId);
        const nowPeriod = currentPeriod(yield* financeTimeMillis);
        if (comparePeriods(period, plan.startPeriod) < 0 || comparePeriods(period, nowPeriod) > 0) {
          return yield* new ApiFailure({ status: 422, code: "plan_period_out_of_range", text: "server.plan.periodOutOfRange" });
        }

        const { items, incomeRows } = yield* listPlanInputRows(householdId);
        const result = yield* computeCurrent(householdId, plan, items, incomeRows, period);
        if (!result) return yield* new Conflict({ code: "plan_incomplete", text: "server.plan.incomplete" });
        return result;
      });

      /* ---------------------------- fixed-cost items --------------------------- */

      const nextItemPosition = Effect.fnUntraced(function* (householdId: string) {
        const rows = yield* listItemRows(householdId);
        const last = rows.at(-1)?.position;
        return last === undefined ? 0 : last + 1;
      });

      const loadItemOr404 = Effect.fnUntraced(function* (householdId: string, itemId: string) {
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(fixedCostItems)
            .where(and(eq(fixedCostItems.id, itemId), eq(fixedCostItems.householdId, householdId)))
            .limit(1),
        );
        const row = rows[0];
        if (!row) return yield* new NotFound();
        return row;
      });

      const createFixedCostItem = Effect.fn("FinancePlan.createFixedCostItem")(function* (
        householdId: string,
        input: CreateFixedCostItemRequest,
      ) {
        yield* assertPeriodRange(input.activeFrom, input.activeTo);
        const id = crypto.randomUUID();
        const timestamp = yield* financeTimeMillis;
        const position = input.position ?? (yield* nextItemPosition(householdId));
        yield* database.use((db) =>
          db.insert(fixedCostItems).values({
            id,
            householdId,
            label: input.label,
            amountCents: input.amountCents,
            activeFrom: input.activeFrom,
            activeTo: input.activeTo ?? null,
            position,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        );
        return toItemResponse(yield* loadItemOr404(householdId, id));
      });

      const updateFixedCostItem = Effect.fn("FinancePlan.updateFixedCostItem")(function* (
        householdId: string,
        itemId: string,
        input: UpdateFixedCostItemRequest,
      ) {
        const existing = yield* loadItemOr404(householdId, itemId);
        yield* assertPeriodRange(
          input.activeFrom ?? existing.activeFrom,
          input.activeTo === undefined ? existing.activeTo : input.activeTo,
        );
        const patch: Partial<typeof fixedCostItems.$inferInsert> = { updatedAt: yield* financeTimeMillis };
        if (input.label !== undefined) patch.label = input.label;
        if (input.amountCents !== undefined) patch.amountCents = input.amountCents;
        if (input.activeFrom !== undefined) patch.activeFrom = input.activeFrom;
        if (input.activeTo !== undefined) patch.activeTo = input.activeTo ?? null;
        if (input.position !== undefined) patch.position = input.position;
        yield* database.use((db) => db.update(fixedCostItems).set(patch).where(eq(fixedCostItems.id, itemId)));
        return toItemResponse(yield* loadItemOr404(householdId, itemId));
      });

      const deleteFixedCostItem = Effect.fn("FinancePlan.deleteFixedCostItem")(function* (householdId: string, itemId: string) {
        yield* loadItemOr404(householdId, itemId);
        yield* database.use((db) => db.delete(fixedCostItems).where(eq(fixedCostItems.id, itemId)));
      });

      /* -------------------------------- incomes -------------------------------- */

      const loadIncomeOr404 = Effect.fnUntraced(function* (householdId: string, incomeId: string) {
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(incomes)
            .where(and(eq(incomes.id, incomeId), eq(incomes.householdId, householdId)))
            .limit(1),
        );
        const row = rows[0];
        if (!row) return yield* new NotFound();
        return row;
      });

      const createIncome = Effect.fn("FinancePlan.createIncome")(function* (householdId: string, input: CreateIncomeRequest) {
        yield* assertParticipant(householdId, input.personId, "personId");
        yield* assertPeriodRange(input.validFrom, input.validTo);
        const id = crypto.randomUUID();
        const timestamp = yield* financeTimeMillis;
        yield* database
          .use((db) =>
            db.insert(incomes).values({
              id,
              householdId,
              personId: input.personId,
              amountCents: input.amountCents,
              validFrom: input.validFrom,
              validTo: input.validTo ?? null,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          )
          .pipe(Effect.catchTag("DatabaseError", (error) => Effect.fail(isUniqueViolation(error.cause) ? incomeOverlap() : error)));
        return toIncomeResponse(yield* loadIncomeOr404(householdId, id));
      });

      const updateIncome = Effect.fn("FinancePlan.updateIncome")(function* (
        householdId: string,
        incomeId: string,
        input: UpdateIncomeRequest,
      ) {
        const existing = yield* loadIncomeOr404(householdId, incomeId);
        if (input.personId !== undefined) yield* assertParticipant(householdId, input.personId, "personId");
        yield* assertPeriodRange(
          input.validFrom ?? existing.validFrom,
          input.validTo === undefined ? existing.validTo : input.validTo,
        );
        const patch: Partial<typeof incomes.$inferInsert> = { updatedAt: yield* financeTimeMillis };
        if (input.personId !== undefined) patch.personId = input.personId;
        if (input.amountCents !== undefined) patch.amountCents = input.amountCents;
        if (input.validFrom !== undefined) patch.validFrom = input.validFrom;
        if (input.validTo !== undefined) patch.validTo = input.validTo ?? null;
        yield* database
          .use((db) => db.update(incomes).set(patch).where(eq(incomes.id, incomeId)))
          .pipe(Effect.catchTag("DatabaseError", (error) => Effect.fail(isUniqueViolation(error.cause) ? incomeOverlap() : error)));
        return toIncomeResponse(yield* loadIncomeOr404(householdId, incomeId));
      });

      const deleteIncome = Effect.fn("FinancePlan.deleteIncome")(function* (householdId: string, incomeId: string) {
        yield* loadIncomeOr404(householdId, incomeId);
        yield* database.use((db) => db.delete(incomes).where(eq(incomes.id, incomeId)));
      });

      const listAccrualRuns = Effect.fn("FinancePlan.listAccrualRuns")(function* (
        householdId: string,
        limit: number,
        offset: number,
      ) {
        const [rows, totalRows] = yield* Effect.all([
          database.use((db) =>
            db
              .select()
              .from(accrualRuns)
              .where(eq(accrualRuns.householdId, householdId))
              .orderBy(desc(accrualRuns.startedAt))
              .limit(limit)
              .offset(offset),
          ),
          database.use((db) => db.select({ id: accrualRuns.id }).from(accrualRuns).where(eq(accrualRuns.householdId, householdId))),
        ]);
        return { items: rows.map(toAccrualRunResponse), total: totalRows.length };
      });

      return FinancePlan.of({
        loadPlanRow,
        listPlanInputRows,
        isPeriodBooked,
        getPlanResponse,
        updatePlan,
        previewPlan,
        createFixedCostItem,
        updateFixedCostItem,
        deleteFixedCostItem,
        createIncome,
        updateIncome,
        deleteIncome,
        listAccrualRuns,
      });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/** Callers: `services/plan/accrual.service.ts` (E4-T06). */
export function loadPlanRow(db: DrizzleDatabase, householdId: string): Promise<FixedCostPlanRow> {
  return runFinanceBridge(FinancePlan.use((service) => service.loadPlanRow(householdId)), db);
}

/** Callers: `services/plan/accrual.service.ts` (E4-T06). */
export function listPlanInputRows(
  db: DbLike,
  householdId: string,
): Promise<{ items: FixedCostItemRow[]; incomeRows: IncomeRow[] }> {
  return runFinanceBridge(FinancePlan.use((service) => service.listPlanInputRows(householdId)), db);
}

/** Callers: `services/plan/accrual.service.ts` (E4-T06). */
export function isPeriodBooked(db: DbLike, householdId: string, period: string): Promise<boolean> {
  return runFinanceBridge(FinancePlan.use((service) => service.isPeriodBooked(householdId, period)), db);
}

/** Callers: `routes/plan.ts` (E4-T08). */
export function getPlanResponse(db: DrizzleDatabase, householdId: string): Promise<PlanResponse> {
  return runFinanceBridge(FinancePlan.use((service) => service.getPlanResponse(householdId)), db);
}

/** Callers: `routes/plan.ts` (E4-T08), `seed.ts` (E4-T07). */
export function updatePlan(db: DrizzleDatabase, householdId: string, input: UpdatePlanRequest): Promise<PlanResponse> {
  return runFinanceBridge(FinancePlan.use((service) => service.updatePlan(householdId, input)), db);
}

/** Callers: `routes/plan.ts` (E4-T08). */
export function previewPlan(db: DrizzleDatabase, householdId: string, period: string): Promise<PlanComputationResponse> {
  return runFinanceBridge(FinancePlan.use((service) => service.previewPlan(householdId, period)), db);
}

/** Callers: `routes/plan.ts` (E4-T08), `seed.ts` (E4-T07). */
export function createFixedCostItem(
  db: DrizzleDatabase,
  householdId: string,
  input: CreateFixedCostItemRequest,
): Promise<FixedCostItemResponse> {
  return runFinanceBridge(FinancePlan.use((service) => service.createFixedCostItem(householdId, input)), db);
}

/** Callers: `routes/plan.ts` (E4-T08). */
export function updateFixedCostItem(
  db: DrizzleDatabase,
  householdId: string,
  itemId: string,
  input: UpdateFixedCostItemRequest,
): Promise<FixedCostItemResponse> {
  return runFinanceBridge(FinancePlan.use((service) => service.updateFixedCostItem(householdId, itemId, input)), db);
}

/** Callers: `routes/plan.ts` (E4-T08). */
export function deleteFixedCostItem(db: DrizzleDatabase, householdId: string, itemId: string): Promise<void> {
  return runFinanceBridge(FinancePlan.use((service) => service.deleteFixedCostItem(householdId, itemId)), db);
}

/** Callers: `routes/plan.ts` (E4-T08), `seed.ts` (E4-T07). */
export function createIncome(db: DrizzleDatabase, householdId: string, input: CreateIncomeRequest): Promise<IncomeResponse> {
  return runFinanceBridge(FinancePlan.use((service) => service.createIncome(householdId, input)), db);
}

/** Callers: `routes/plan.ts` (E4-T08). */
export function updateIncome(
  db: DrizzleDatabase,
  householdId: string,
  incomeId: string,
  input: UpdateIncomeRequest,
): Promise<IncomeResponse> {
  return runFinanceBridge(FinancePlan.use((service) => service.updateIncome(householdId, incomeId, input)), db);
}

/** Callers: `routes/plan.ts` (E4-T08). */
export function deleteIncome(db: DrizzleDatabase, householdId: string, incomeId: string): Promise<void> {
  return runFinanceBridge(FinancePlan.use((service) => service.deleteIncome(householdId, incomeId)), db);
}

/** Callers: `routes/plan.ts` (E4-T08). */
export function listAccrualRuns(
  db: DrizzleDatabase,
  householdId: string,
  limit: number,
  offset: number,
): Promise<{ items: AccrualRunResponse[]; total: number }> {
  return runFinanceBridge(FinancePlan.use((service) => service.listAccrualRuns(householdId, limit, offset)), db);
}
