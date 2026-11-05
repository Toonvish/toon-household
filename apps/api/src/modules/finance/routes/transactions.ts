/**
 * Mounted at /api/households/:householdId/finance/transactions (see src/index.ts).
 * `/summary` is registered BEFORE `/:transactionId`, otherwise the literal
 * path would be captured as an id.
 *
 * `kind` travels on the wire; `kindToStorage(kind, viewerId, otherId)` runs
 * SERVER-SIDE against the session's viewer, never a client-picked payer —
 * this is exactly what keeps an offline-replayed create correct regardless
 * of who is logged in when it is finally sent (docs/spec.md §3.6).
 */
import {
  CreateTransactionRequestSchema,
  type TransactionListResponse,
  TransactionListQuerySchema,
  type TransactionResponse,
  TransactionSummaryQuerySchema,
  UpdateTransactionRequestSchema,
} from "@toon/shared";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { effectBridge } from "../../../http/bridge.ts";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { jsonBody, queryParam, queryParams } from "../../../http/request.ts";
import { created, json, noContent } from "../../../http/response.ts";
import { CurrentFinanceParticipant } from "../http.ts";
import { RequireFinanceParticipantLayer } from "../middleware.ts";
import { FinanceTransactions } from "../services/ledger/transactions.service.ts";
import { FinanceSummary } from "../services/ledger/summary.service.ts";
import { FinanceTransactionsApi } from "./transactions.api.ts";

export const transactionsHandlers = HttpApiBuilder.group(FinanceTransactionsApi, "finance.transactions", (handlers) =>
  handlers
    /** GET / — filtered, paginated list. `kind` is a viewer-relative projection resolved server-side. */
    .handle(
      "get",
      Effect.fn("finance.transactions.get")(function* () {
        const query = yield* queryParams(TransactionListQuerySchema);
        const transactionsService = yield* FinanceTransactions;
        const household = yield* CurrentFinanceParticipant;
        const payload: TransactionListResponse = yield* transactionsService.listTransactions(household.householdId, household.userId, query);
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /** POST / — 201 on a fresh create, 200 on a replayed `mutationId`. */
    .handle(
      "post",
      Effect.fn("finance.transactions.post")(function* () {
        const body = yield* jsonBody(CreateTransactionRequestSchema);
        const transactionsService = yield* FinanceTransactions;
        const household = yield* CurrentFinanceParticipant;
        const outcome = yield* transactionsService.createTransaction({ ...body, householdId: household.householdId, viewerId: household.userId, createdBy: household.userId });
        return outcome.applied ? created(outcome.response, `/api/households/${household.householdId}/finance/transactions/${outcome.response.id}`) : json(outcome.response);
      }),
      UNINTERRUPTIBLE,
    )
    /** GET /summary — MUST stay above /:transactionId. */
    .handle(
      "getSummary",
      Effect.fn("finance.transactions.getSummary")(function* () {
        const query = yield* queryParams(TransactionSummaryQuerySchema);
        const summaryService = yield* FinanceSummary;
        const household = yield* CurrentFinanceParticipant;
        const payload = yield* summaryService.getTransactionSummary(household.householdId, query);
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /** GET /:transactionId */
    .handle(
      "getByTransactionId",
      Effect.fn("finance.transactions.getByTransactionId")(function* ({ params }) {
        const transactionsService = yield* FinanceTransactions;
        const household = yield* CurrentFinanceParticipant;
        const payload: TransactionResponse = yield* transactionsService.getTransaction(household.householdId, params.transactionId);
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /** PATCH /:transactionId — `409 transaction_generated` unless `origin === "manual"`. */
    .handle(
      "patchByTransactionId",
      Effect.fn("finance.transactions.patchByTransactionId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateTransactionRequestSchema);
        const transactionsService = yield* FinanceTransactions;
        const household = yield* CurrentFinanceParticipant;
        const outcome = yield* transactionsService.updateTransaction(params.transactionId, { ...body, householdId: household.householdId, viewerId: household.userId });
        return json(outcome.response);
      }),
      UNINTERRUPTIBLE,
    )
    /** DELETE /:transactionId?mutationId= — `409 transaction_generated` unless `origin === "manual"`. */
    .handle(
      "deleteByTransactionId",
      Effect.fn("finance.transactions.deleteByTransactionId")(function* ({ params }) {
        const transactionsService = yield* FinanceTransactions;
        const household = yield* CurrentFinanceParticipant;
        const mutationId = yield* queryParam("mutationId");
        yield* transactionsService.deleteTransaction(household.householdId, params.transactionId, mutationId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);

export const transactionRoutes = effectBridge(
  FinanceTransactionsApi,
  Layer.suspend(() => Layer.provideMerge(transactionsHandlers, RequireFinanceParticipantLayer)),
  "/api/households/:householdId/finance/transactions",
);

export default transactionRoutes;
