/**
 * Mounted at /api/households/:householdId/finance/plan (see src/index.ts). The
 * fixed-cost plan itself, its items/incomes, and the read-only preview that
 * shows a period's computation before anything is booked. The actual booking
 * side effect (`run`/`recalculate`) is a thin call into
 * `services/plan/accrual.service.ts` — never re-derived here.
 */
import { zValidator } from "@hono/zod-validator";
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
import { db } from "../../../db/client.ts";
import { onValidationError } from "../../../core/services/households/validation.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { created, json, noContent } from "../../../lib/http.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { requireUser } from "../../../lib/types.ts";
import { requireFinanceParticipant, requireFinanceParticipantContext as requireHouseholdContext } from "../middleware.ts";
import { recalculatePlan, runPlanNow } from "../services/plan/accrual.service.ts";
import {
  createFixedCostItem,
  createIncome,
  deleteFixedCostItem,
  deleteIncome,
  getPlanResponse,
  listAccrualRuns,
  previewPlan,
  updateFixedCostItem,
  updateIncome,
  updatePlan,
} from "../services/plan/plan.service.ts";

export const planRoutes = new Hono<AppEnv>();

planRoutes.use("*", requireVerifiedEmail());
planRoutes.use("*", requireFinanceParticipant());

/** GET / — plan + items + incomes + this period's computation + last run + pending periods. */
planRoutes.get("/", async (c) => {
  const household = requireHouseholdContext(c);
  return json(c, await getPlanResponse(db, household.householdId));
});

/** PATCH / — enable/disable, change the payer, or move `startPeriod`. */
planRoutes.patch("/", zValidator("json", UpdatePlanRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  return json(c, await updatePlan(db, household.householdId, c.req.valid("json")));
});

/** GET /preview?period= — the read-only computation for one period, before anything is booked. */
planRoutes.get("/preview", zValidator("query", PlanPreviewQuerySchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const payload: PlanComputationResponse = await previewPlan(db, household.householdId, c.req.valid("query").period);
  return json(c, payload);
});

/** POST /run — the catch-up, on demand. `409 plan_disabled` / `409 plan_incomplete`. */
planRoutes.post("/run", zValidator("json", RunPlanRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  return json(c, await runPlanNow(db, household.householdId, c.req.valid("json").through));
});

/** POST /recalculate — preview (`dryRun: true`) or apply (booked periods are NEVER edited, only superseded by a new adjustment row). */
planRoutes.post("/recalculate", zValidator("json", RecalculatePlanRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const user = requireUser(c);
  const body = c.req.valid("json");
  return json(c, await recalculatePlan(db, household.householdId, user.id, body.dryRun));
});

/** GET /runs — the audit trail, most recent first. */
planRoutes.get("/runs", zValidator("query", PaginationQuerySchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const query = c.req.valid("query");
  const { items, total } = await listAccrualRuns(db, household.householdId, query.limit, query.offset);
  const payload: AccrualRunListResponse = { items, total, limit: query.limit, offset: query.offset };
  return json(c, payload);
});

/* -------------------------------------------------------------------------- */
/* fixed-cost items                                                          */
/* -------------------------------------------------------------------------- */

planRoutes.post("/items", zValidator("json", CreateFixedCostItemRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const item = await createFixedCostItem(db, household.householdId, c.req.valid("json"));
  return created(c, item);
});

planRoutes.patch("/items/:itemId", zValidator("json", UpdateFixedCostItemRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const item = await updateFixedCostItem(db, household.householdId, c.req.param("itemId"), c.req.valid("json"));
  return json(c, item);
});

planRoutes.delete("/items/:itemId", async (c) => {
  const household = requireHouseholdContext(c);
  await deleteFixedCostItem(db, household.householdId, c.req.param("itemId"));
  return noContent(c);
});

/* -------------------------------------------------------------------------- */
/* incomes                                                                    */
/* -------------------------------------------------------------------------- */

planRoutes.post("/incomes", zValidator("json", CreateIncomeRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const income = await createIncome(db, household.householdId, c.req.valid("json"));
  return created(c, income);
});

planRoutes.patch("/incomes/:incomeId", zValidator("json", UpdateIncomeRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const income = await updateIncome(db, household.householdId, c.req.param("incomeId"), c.req.valid("json"));
  return json(c, income);
});

planRoutes.delete("/incomes/:incomeId", async (c) => {
  const household = requireHouseholdContext(c);
  await deleteIncome(db, household.householdId, c.req.param("incomeId"));
  return noContent(c);
});

export default planRoutes;
