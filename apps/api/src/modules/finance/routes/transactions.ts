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
import { Effect } from "effect";
import { runtime } from "../../../runtime.ts";
import {
  CreateTransactionRequestSchema,
  type TransactionListResponse,
  TransactionListQuerySchema,
  type TransactionResponse,
  TransactionSummaryQuerySchema,
  UpdateTransactionRequestSchema,
} from "@toon/shared";
import { Hono } from "hono";
import { created, json, noContent } from "../../../lib/http.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { requireFinanceParticipant, currentFinanceParticipant } from "../middleware.ts";
import { validate } from "../../../lib/validate.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { FinanceTransactions } from "../services/ledger/transactions.service.ts";
import { FinanceSummary } from "../services/ledger/summary.service.ts";

export const transactionRoutes = new Hono<AppEnv>();

transactionRoutes.use("*", requireVerifiedEmail());
transactionRoutes.use("*", requireFinanceParticipant());

/** GET / — filtered, paginated list. `kind` is a viewer-relative projection resolved server-side. */
transactionRoutes.get("/", validate("query", TransactionListQuerySchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const transactionsService = yield* FinanceTransactions;
  const household = yield* currentFinanceParticipant(c);
  const query = c.req.valid("query");
  const payload: TransactionListResponse = yield* transactionsService.listTransactions(household.householdId, household.userId, query);
  return json(c, payload);
}),
),
);

/** POST / — 201 on a fresh create, 200 on a replayed `mutationId`. */
transactionRoutes.post("/", validate("json", CreateTransactionRequestSchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const transactionsService = yield* FinanceTransactions;
  const household = yield* currentFinanceParticipant(c);
  const body = c.req.valid("json");
  const outcome = yield* transactionsService.createTransaction({ ...body, householdId: household.householdId, viewerId: household.userId, createdBy: household.userId });
  return outcome.applied ? created(c, outcome.response, `/api/households/${household.householdId}/finance/transactions/${outcome.response.id}`) : json(c, outcome.response);
}),
),
);

/** GET /summary — MUST stay above /:transactionId. */
transactionRoutes.get("/summary", validate("query", TransactionSummaryQuerySchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const summaryService = yield* FinanceSummary;
  const household = yield* currentFinanceParticipant(c);
  const query = c.req.valid("query");
  const payload = yield* summaryService.getTransactionSummary(household.householdId, query);
  return json(c, payload);
}),
),
);

/** GET /:transactionId */
transactionRoutes.get("/:transactionId", (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const transactionsService = yield* FinanceTransactions;
  const household = yield* currentFinanceParticipant(c);
  const payload: TransactionResponse = yield* transactionsService.getTransaction(household.householdId, c.req.param("transactionId"));
  return json(c, payload);
}),
),
);

/** PATCH /:transactionId — `409 transaction_generated` unless `origin === "manual"`. */
transactionRoutes.patch("/:transactionId", validate("json", UpdateTransactionRequestSchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const transactionsService = yield* FinanceTransactions;
  const household = yield* currentFinanceParticipant(c);
  const body = c.req.valid("json");
  const outcome = yield* transactionsService.updateTransaction(c.req.param("transactionId"), { ...body, householdId: household.householdId, viewerId: household.userId });
  return json(c, outcome.response);
}),
),
);

/** DELETE /:transactionId?mutationId= — `409 transaction_generated` unless `origin === "manual"`. */
transactionRoutes.delete("/:transactionId", (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const transactionsService = yield* FinanceTransactions;
  const household = yield* currentFinanceParticipant(c);
  const mutationId = c.req.query("mutationId");
  yield* transactionsService.deleteTransaction(household.householdId, c.req.param("transactionId"), mutationId);
  return noContent(c);
}),
),
);

export default transactionRoutes;
