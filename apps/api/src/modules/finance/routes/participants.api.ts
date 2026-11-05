/** Finance participants (plan M3 decisions 3 and 4, SPEC D3); served at /api/households/:householdId/finance/participants (docs/API.md "Finance module"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireHouseholdAdmin, RequireVerifiedEmail } from "../../../http/middleware.ts";
import { RequireFinanceParticipant } from "../http.ts";

export const FinanceParticipantsGroup = HttpApiGroup.make("finance.participants")
  .add(
    /** GET /api/households/:householdId/finance/participants */
    HttpApiEndpoint.get("get", "/", { params: { householdId: Schema.String } }),
    /** PUT /api/households/:householdId/finance/participants */
    HttpApiEndpoint.put("put", "/", { params: { householdId: Schema.String } }).pipe(
      chain(RequireVerifiedEmail, RequireHouseholdAdmin),
    ),
    /** PATCH /api/households/:householdId/finance/participants/me */
    HttpApiEndpoint.patch("patchMe", "/me", { params: { householdId: Schema.String } }).pipe(
      chain(RequireVerifiedEmail, RequireFinanceParticipant),
    ),
    /** PATCH /api/households/:householdId/finance/participants/:userId */
    HttpApiEndpoint.patch("patchByUserId", "/:userId", {
      params: { householdId: Schema.String, userId: Schema.String },
    }).pipe(chain(RequireVerifiedEmail, RequireFinanceParticipant)),
  )
  .prefix("/participants");

export const FinanceParticipantsApi = householdModuleApi(
  "finance",
  HttpApi.make("finance.participants").add(FinanceParticipantsGroup),
);
