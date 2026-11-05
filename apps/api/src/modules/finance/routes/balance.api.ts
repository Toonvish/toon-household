/** Finance balance (the balance and its sub-totals; the sign convention and derivation live in `@toon/shared`'s `computeBreakdown`); served at /api/households/:householdId/finance/balance (docs/API.md "Finance module"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";
import { RequireFinanceParticipant } from "../http.ts";

const params = { householdId: Schema.String };

export const FinanceBalanceGroup = HttpApiGroup.make("finance.balance")
  .add(
    /** GET /api/households/:householdId/finance/balance */
    HttpApiEndpoint.get("get", "/", { params }),
    /** GET /api/households/:householdId/finance/balance/history */
    HttpApiEndpoint.get("getHistory", "/history", { params }),
  )
  .prefix("/balance")
  .pipe(chain(RequireVerifiedEmail, RequireFinanceParticipant));

export const FinanceBalanceApi = householdModuleApi("finance", HttpApi.make("finance.balance").add(FinanceBalanceGroup));
