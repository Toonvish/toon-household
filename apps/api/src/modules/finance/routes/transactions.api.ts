/** Finance transactions (`/summary` is registered BEFORE `/:transactionId`, otherwise the literal path would be captured as an id.); served at /api/households/:householdId/finance/transactions (docs/API.md "Finance module"). */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { chain, householdModuleApi, RequireVerifiedEmail } from "../../../http/middleware.ts";
import { RequireFinanceParticipant } from "../http.ts";

const params = { householdId: Schema.String };

export const FinanceTransactionsGroup = HttpApiGroup.make("finance.transactions")
  .add(
    /** GET /api/households/:householdId/finance/transactions */
    HttpApiEndpoint.get("get", "/", { params }),
    /** POST /api/households/:householdId/finance/transactions */
    HttpApiEndpoint.post("post", "/", { params }),
    /** GET /api/households/:householdId/finance/transactions/summary */
    HttpApiEndpoint.get("getSummary", "/summary", { params }),
    /** GET /api/households/:householdId/finance/transactions/:transactionId */
    HttpApiEndpoint.get("getByTransactionId", "/:transactionId", {
      params: { householdId: Schema.String, transactionId: Schema.String },
    }),
    /** PATCH /api/households/:householdId/finance/transactions/:transactionId */
    HttpApiEndpoint.patch("patchByTransactionId", "/:transactionId", {
      params: { householdId: Schema.String, transactionId: Schema.String },
    }),
    /** DELETE /api/households/:householdId/finance/transactions/:transactionId */
    HttpApiEndpoint.delete("deleteByTransactionId", "/:transactionId", {
      params: { householdId: Schema.String, transactionId: Schema.String },
    }),
  )
  .prefix("/transactions")
  .pipe(chain(RequireVerifiedEmail, RequireFinanceParticipant));

export const FinanceTransactionsApi = householdModuleApi(
  "finance",
  HttpApi.make("finance.transactions").add(FinanceTransactionsGroup),
);
