/**
 * Mounted at /api/households/:householdId/finance/plan (see src/index.ts). The
 * fixed-cost plan itself, its items/incomes, and the read-only preview that
 * shows a period's computation before anything is booked. The actual booking
 * side effect (`run`/`recalculate`) is a thin call into
 * `services/plan/accrual.service.ts` — never re-derived here.
 */
import {
  type AccrualRunListResponse,
  CreateFixedCostItemRequestSchema,
  CreateIncomeRequestSchema,
  FinancePaginationQuerySchema as PaginationQuerySchema,
  type PlanComputationResponse,
  PlanPreviewQuerySchema,
  RecalculatePlanRequestSchema,
  RunPlanRequestSchema,
  UpdateFixedCostItemRequestSchema,
  UpdateIncomeRequestSchema,
  UpdatePlanRequestSchema,
} from "@toon/shared";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { effectBridge } from "../../../http/bridge.ts";
import { CurrentUser } from "../../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { jsonBody, queryParams } from "../../../http/request.ts";
import { created, json, noContent } from "../../../http/response.ts";
import { CurrentFinanceParticipant } from "../http.ts";
import { RequireFinanceParticipantLayer } from "../middleware.ts";
import { FinanceAccrual } from "../services/plan/accrual.service.ts";
import { FinancePlan } from "../services/plan/plan.service.ts";
import { FinancePlanApi } from "./plan.api.ts";

export const financePlanHandlers = HttpApiBuilder.group(FinancePlanApi, "finance.plan", (handlers) =>
  handlers
    /** GET / — plan + items + incomes + this period's computation + last run + pending periods. */
    .handle(
      "get",
      Effect.fn("finance.plan.get")(function* () {
        const planService = yield* FinancePlan;
        const household = yield* CurrentFinanceParticipant;
        return json(yield* planService.getPlanResponse(household.householdId));
      }),
      UNINTERRUPTIBLE,
    )
    /** PATCH / — enable/disable, change the payer, or move `startPeriod`. */
    .handle(
      "patch",
      Effect.fn("finance.plan.patch")(function* () {
        const body = yield* jsonBody(UpdatePlanRequestSchema);
        const planService = yield* FinancePlan;
        const household = yield* CurrentFinanceParticipant;
        return json(yield* planService.updatePlan(household.householdId, body));
      }),
      UNINTERRUPTIBLE,
    )
    /** GET /preview?period= — the read-only computation for one period, before anything is booked. */
    .handle(
      "getPreview",
      Effect.fn("finance.plan.getPreview")(function* () {
        const query = yield* queryParams(PlanPreviewQuerySchema);
        const planService = yield* FinancePlan;
        const household = yield* CurrentFinanceParticipant;
        const payload: PlanComputationResponse = yield* planService.previewPlan(household.householdId, query.period);
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /** POST /run — the catch-up, on demand. `409 plan_disabled` / `409 plan_incomplete`. */
    .handle(
      "postRun",
      Effect.fn("finance.plan.postRun")(function* () {
        const body = yield* jsonBody(RunPlanRequestSchema);
        const accrualService = yield* FinanceAccrual;
        const household = yield* CurrentFinanceParticipant;
        return json(yield* accrualService.runPlanNow(household.householdId, body.through));
      }),
      UNINTERRUPTIBLE,
    )
    /** POST /recalculate — preview (`dryRun: true`) or apply (booked periods are NEVER edited, only superseded by a new adjustment row). */
    .handle(
      "postRecalculate",
      Effect.fn("finance.plan.postRecalculate")(function* () {
        const body = yield* jsonBody(RecalculatePlanRequestSchema);
        const accrualService = yield* FinanceAccrual;
        const household = yield* CurrentFinanceParticipant;
        const user = yield* CurrentUser;
        return json(yield* accrualService.recalculatePlan(household.householdId, user.id, body.dryRun));
      }),
      UNINTERRUPTIBLE,
    )
    /** GET /runs — the audit trail, most recent first. */
    .handle(
      "getRuns",
      Effect.fn("finance.plan.getRuns")(function* () {
        const query = yield* queryParams(PaginationQuerySchema);
        const planService = yield* FinancePlan;
        const household = yield* CurrentFinanceParticipant;
        const { items, total } = yield* planService.listAccrualRuns(household.householdId, query.limit, query.offset);
        const payload: AccrualRunListResponse = { items, total, limit: query.limit, offset: query.offset };
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /* -------------------------------------------------------------------------- */
    /* fixed-cost items                                                          */
    /* -------------------------------------------------------------------------- */
    .handle(
      "postItems",
      Effect.fn("finance.plan.postItems")(function* () {
        const body = yield* jsonBody(CreateFixedCostItemRequestSchema);
        const planService = yield* FinancePlan;
        const household = yield* CurrentFinanceParticipant;
        const item = yield* planService.createFixedCostItem(household.householdId, body);
        return created(item);
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "patchItemsByItemId",
      Effect.fn("finance.plan.patchItemsByItemId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateFixedCostItemRequestSchema);
        const planService = yield* FinancePlan;
        const household = yield* CurrentFinanceParticipant;
        const item = yield* planService.updateFixedCostItem(household.householdId, params.itemId, body);
        return json(item);
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "deleteItemsByItemId",
      Effect.fn("finance.plan.deleteItemsByItemId")(function* ({ params }) {
        const planService = yield* FinancePlan;
        const household = yield* CurrentFinanceParticipant;
        yield* planService.deleteFixedCostItem(household.householdId, params.itemId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )
    /* -------------------------------------------------------------------------- */
    /* incomes                                                                    */
    /* -------------------------------------------------------------------------- */
    .handle(
      "postIncomes",
      Effect.fn("finance.plan.postIncomes")(function* () {
        const body = yield* jsonBody(CreateIncomeRequestSchema);
        const planService = yield* FinancePlan;
        const household = yield* CurrentFinanceParticipant;
        const income = yield* planService.createIncome(household.householdId, body);
        return created(income);
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "patchIncomesByIncomeId",
      Effect.fn("finance.plan.patchIncomesByIncomeId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateIncomeRequestSchema);
        const planService = yield* FinancePlan;
        const household = yield* CurrentFinanceParticipant;
        const income = yield* planService.updateIncome(household.householdId, params.incomeId, body);
        return json(income);
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "deleteIncomesByIncomeId",
      Effect.fn("finance.plan.deleteIncomesByIncomeId")(function* ({ params }) {
        const planService = yield* FinancePlan;
        const household = yield* CurrentFinanceParticipant;
        yield* planService.deleteIncome(household.householdId, params.incomeId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);

export const planRoutes = effectBridge(
  FinancePlanApi,
  Layer.suspend(() => Layer.provideMerge(financePlanHandlers, RequireFinanceParticipantLayer)),
  "/api/households/:householdId/finance/plan",
);

export default planRoutes;
