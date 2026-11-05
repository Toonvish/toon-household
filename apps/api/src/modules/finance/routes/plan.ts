/**
 * Mounted at /api/households/:householdId/finance/plan (see src/index.ts). The
 * fixed-cost plan itself, its items/incomes, and the read-only preview that
 * shows a period's computation before anything is booked. The actual booking
 * side effect (`run`/`recalculate`) is a thin call into
 * `services/plan/accrual.service.ts` — never re-derived here.
 */
import { Effect } from "effect";
import { runtime } from "../../../runtime.ts";
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
import { Hono } from "hono";
import { validate } from "../../../lib/validate.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { created, json, noContent } from "../../../lib/http.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { currentUser } from "../../../lib/types.ts";
import { requireFinanceParticipant, currentFinanceParticipant } from "../middleware.ts";
import { FinanceAccrual } from "../services/plan/accrual.service.ts";
import { FinancePlan } from "../services/plan/plan.service.ts";

export const planRoutes = new Hono<AppEnv>();

planRoutes.use("*", requireVerifiedEmail());
planRoutes.use("*", requireFinanceParticipant());

/** GET / — plan + items + incomes + this period's computation + last run + pending periods. */
planRoutes.get("/", (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const planService = yield* FinancePlan;
  const household = yield* currentFinanceParticipant(c);
  return json(c, yield* planService.getPlanResponse(household.householdId));
}),
),
);

/** PATCH / — enable/disable, change the payer, or move `startPeriod`. */
planRoutes.patch("/", validate("json", UpdatePlanRequestSchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const planService = yield* FinancePlan;
  const household = yield* currentFinanceParticipant(c);
  return json(c, yield* planService.updatePlan(household.householdId, c.req.valid("json")));
}),
),
);

/** GET /preview?period= — the read-only computation for one period, before anything is booked. */
planRoutes.get("/preview", validate("query", PlanPreviewQuerySchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const planService = yield* FinancePlan;
  const household = yield* currentFinanceParticipant(c);
  const payload: PlanComputationResponse = yield* planService.previewPlan(household.householdId, c.req.valid("query").period);
  return json(c, payload);
}),
),
);

/** POST /run — the catch-up, on demand. `409 plan_disabled` / `409 plan_incomplete`. */
planRoutes.post("/run", validate("json", RunPlanRequestSchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const accrualService = yield* FinanceAccrual;
  const household = yield* currentFinanceParticipant(c);
  return json(c, yield* accrualService.runPlanNow(household.householdId, c.req.valid("json").through));
}),
),
);

/** POST /recalculate — preview (`dryRun: true`) or apply (booked periods are NEVER edited, only superseded by a new adjustment row). */
planRoutes.post("/recalculate", validate("json", RecalculatePlanRequestSchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const accrualService = yield* FinanceAccrual;
  const household = yield* currentFinanceParticipant(c);
  const user = yield* currentUser(c);
  const body = c.req.valid("json");
  return json(c, yield* accrualService.recalculatePlan(household.householdId, user.id, body.dryRun));
}),
),
);

/** GET /runs — the audit trail, most recent first. */
planRoutes.get("/runs", validate("query", PaginationQuerySchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const planService = yield* FinancePlan;
  const household = yield* currentFinanceParticipant(c);
  const query = c.req.valid("query");
  const { items, total } = yield* planService.listAccrualRuns(household.householdId, query.limit, query.offset);
  const payload: AccrualRunListResponse = { items, total, limit: query.limit, offset: query.offset };
  return json(c, payload);
}),
),
);

/* -------------------------------------------------------------------------- */
/* fixed-cost items                                                          */
/* -------------------------------------------------------------------------- */

planRoutes.post("/items", validate("json", CreateFixedCostItemRequestSchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const planService = yield* FinancePlan;
  const household = yield* currentFinanceParticipant(c);
  const item = yield* planService.createFixedCostItem(household.householdId, c.req.valid("json"));
  return created(c, item);
}),
),
);

planRoutes.patch("/items/:itemId", validate("json", UpdateFixedCostItemRequestSchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const planService = yield* FinancePlan;
  const household = yield* currentFinanceParticipant(c);
  const item = yield* planService.updateFixedCostItem(household.householdId, c.req.param("itemId"), c.req.valid("json"));
  return json(c, item);
}),
),
);

planRoutes.delete("/items/:itemId", (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const planService = yield* FinancePlan;
  const household = yield* currentFinanceParticipant(c);
  yield* planService.deleteFixedCostItem(household.householdId, c.req.param("itemId"));
  return noContent(c);
}),
),
);

/* -------------------------------------------------------------------------- */
/* incomes                                                                    */
/* -------------------------------------------------------------------------- */

planRoutes.post("/incomes", validate("json", CreateIncomeRequestSchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const planService = yield* FinancePlan;
  const household = yield* currentFinanceParticipant(c);
  const income = yield* planService.createIncome(household.householdId, c.req.valid("json"));
  return created(c, income);
}),
),
);

planRoutes.patch("/incomes/:incomeId", validate("json", UpdateIncomeRequestSchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const planService = yield* FinancePlan;
  const household = yield* currentFinanceParticipant(c);
  const income = yield* planService.updateIncome(household.householdId, c.req.param("incomeId"), c.req.valid("json"));
  return json(c, income);
}),
),
);

planRoutes.delete("/incomes/:incomeId", (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const planService = yield* FinancePlan;
  const household = yield* currentFinanceParticipant(c);
  yield* planService.deleteIncome(household.householdId, c.req.param("incomeId"));
  return noContent(c);
}),
),
);

export default planRoutes;
