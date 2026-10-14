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
import { zValidator } from "@hono/zod-validator";
import {
  CreateTransactionRequestSchema,
  type TransactionListResponse,
  TransactionListQuerySchema,
  type TransactionResponse,
  TransactionSummaryQuerySchema,
  UpdateTransactionRequestSchema,
} from "@toon/shared";
import { Hono } from "hono";
import { db } from "../../../db/client.ts";
import { created, json, noContent } from "../../../lib/http.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { requireUser } from "../../../lib/types.ts";
import { requireFinanceParticipant, requireFinanceParticipantContext as requireHouseholdContext } from "../middleware.ts";
import { onValidationError } from "../../../core/services/households/validation.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from "../services/ledger/transactions.service.ts";
import { getTransactionSummary } from "../services/ledger/summary.service.ts";

export const transactionRoutes = new Hono<AppEnv>();

transactionRoutes.use("*", requireVerifiedEmail());
transactionRoutes.use("*", requireFinanceParticipant());

/** GET / — filtered, paginated list. `kind` is a viewer-relative projection resolved server-side. */
transactionRoutes.get("/", zValidator("query", TransactionListQuerySchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const query = c.req.valid("query");
  const payload: TransactionListResponse = await listTransactions(db, household.householdId, household.userId, query);
  return json(c, payload);
});

/** POST / — 201 on a fresh create, 200 on a replayed `mutationId`. */
transactionRoutes.post("/", zValidator("json", CreateTransactionRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const body = c.req.valid("json");
  const outcome = await createTransaction(db, { ...body, householdId: household.householdId, viewerId: household.userId, createdBy: household.userId });
  return outcome.applied ? created(c, outcome.response, `/api/households/${household.householdId}/finance/transactions/${outcome.response.id}`) : json(c, outcome.response);
});

/** GET /summary — MUST stay above /:transactionId. */
transactionRoutes.get("/summary", zValidator("query", TransactionSummaryQuerySchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const query = c.req.valid("query");
  const payload = await getTransactionSummary(db, household.householdId, query);
  return json(c, payload);
});

/** GET /:transactionId */
transactionRoutes.get("/:transactionId", async (c) => {
  const household = requireHouseholdContext(c);
  const payload: TransactionResponse = await getTransaction(db, household.householdId, c.req.param("transactionId"));
  return json(c, payload);
});

/** PATCH /:transactionId — `409 transaction_generated` unless `origin === "manual"`. */
transactionRoutes.patch("/:transactionId", zValidator("json", UpdateTransactionRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const body = c.req.valid("json");
  const outcome = await updateTransaction(db, c.req.param("transactionId"), { ...body, householdId: household.householdId, viewerId: household.userId });
  return json(c, outcome.response);
});

/** DELETE /:transactionId?mutationId= — `409 transaction_generated` unless `origin === "manual"`. */
transactionRoutes.delete("/:transactionId", async (c) => {
  const household = requireHouseholdContext(c);
  const mutationId = c.req.query("mutationId");
  await deleteTransaction(db, household.householdId, c.req.param("transactionId"), mutationId);
  return noContent(c);
});

export default transactionRoutes;
