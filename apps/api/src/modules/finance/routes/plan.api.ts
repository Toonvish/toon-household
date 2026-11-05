/** Finance plan (the fixed-cost plan, its items and incomes, and the read-only preview of a period's computation); served at /api/households/:householdId/finance/plan (docs/API.md "Finance module"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";
import { RequireFinanceParticipant } from "../http.ts";

const params = { householdId: Schema.String };

export const FinancePlanGroup = HttpApiGroup.make("finance.plan")
  .add(
    /** GET /api/households/:householdId/finance/plan */
    HttpApiEndpoint.get("get", "/", { params }),
    /** PATCH /api/households/:householdId/finance/plan */
    HttpApiEndpoint.patch("patch", "/", { params }),
    /** GET /api/households/:householdId/finance/plan/preview */
    HttpApiEndpoint.get("getPreview", "/preview", { params }),
    /** POST /api/households/:householdId/finance/plan/run */
    HttpApiEndpoint.post("postRun", "/run", { params }),
    /** POST /api/households/:householdId/finance/plan/recalculate */
    HttpApiEndpoint.post("postRecalculate", "/recalculate", { params }),
    /** GET /api/households/:householdId/finance/plan/runs */
    HttpApiEndpoint.get("getRuns", "/runs", { params }),
    /** POST /api/households/:householdId/finance/plan/items */
    HttpApiEndpoint.post("postItems", "/items", { params }),
    /** PATCH /api/households/:householdId/finance/plan/items/:itemId */
    HttpApiEndpoint.patch("patchItemsByItemId", "/items/:itemId", {
      params: { householdId: Schema.String, itemId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/finance/plan/items/:itemId */
    HttpApiEndpoint.delete("deleteItemsByItemId", "/items/:itemId", {
      params: { householdId: Schema.String, itemId: Schema.String },
    }),
    /** POST /api/households/:householdId/finance/plan/incomes */
    HttpApiEndpoint.post("postIncomes", "/incomes", { params }),
    /** PATCH /api/households/:householdId/finance/plan/incomes/:incomeId */
    HttpApiEndpoint.patch("patchIncomesByIncomeId", "/incomes/:incomeId", {
      params: { householdId: Schema.String, incomeId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/finance/plan/incomes/:incomeId */
    HttpApiEndpoint.delete("deleteIncomesByIncomeId", "/incomes/:incomeId", {
      params: { householdId: Schema.String, incomeId: Schema.String },
    }),
  )
  .prefix("/plan")
  .pipe(chain(RequireVerifiedEmail, RequireFinanceParticipant));

export const FinancePlanApi = householdModuleApi("finance", HttpApi.make("finance.plan").add(FinancePlanGroup));
