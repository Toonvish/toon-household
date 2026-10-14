/**
 * Mounted at /api/households/:householdId/finance/settlements (see src/index.ts).
 * There is no separate `settlements` table (docs/spec.md §3.9) — a settlement
 * IS a transaction with `splitMode: "SETTLEMENT"`, so `GET /` is the exact
 * same reader `GET .../transactions?splitMode=SETTLEMENT` would give.
 */
import { zValidator } from "@hono/zod-validator";
import { CreateSettlementRequestSchema, FinancePaginationQuerySchema as PaginationQuerySchema } from "@toon/shared";
import { Hono } from "hono";
import { db } from "../../../db/client.ts";
import { created, json } from "../../../lib/http.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { requireFinanceParticipant, requireFinanceParticipantContext as requireHouseholdContext } from "../middleware.ts";
import { onValidationError } from "../../../core/services/households/validation.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { createSettlement } from "../services/ledger/settlements.service.ts";
import { listTransactions } from "../services/ledger/transactions.service.ts";

export const settlementRoutes = new Hono<AppEnv>();

settlementRoutes.use("*", requireVerifiedEmail());
settlementRoutes.use("*", requireFinanceParticipant());

/** GET / — every SETTLEMENT transaction, newest first. */
settlementRoutes.get("/", zValidator("query", PaginationQuerySchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const query = c.req.valid("query");
  const payload = await listTransactions(db, household.householdId, household.userId, {
    splitMode: "SETTLEMENT",
    includeAggregates: true,
    sort: "-bookedAt",
    limit: query.limit,
    offset: query.offset,
  });
  return json(c, payload);
});

/**
 * POST / — "Jetzt ausgleichen". `expectedBalanceCents` is REQUIRED; a stale
 * value answers `409 balance_stale` with `details.currentBalanceCents`
 * (docs/spec.md §3.9 — the one race in this app that costs real money).
 * `201` on a fresh booking, `200` on a replayed `mutationId`.
 */
settlementRoutes.post("/", zValidator("json", CreateSettlementRequestSchema, onValidationError), async (c) => {
  const household = requireHouseholdContext(c);
  const outcome = await createSettlement(db, household.householdId, household.userId, household.memberSlot, c.req.valid("json"));
  return outcome.applied ? created(c, outcome.response) : json(c, outcome.response);
});

export default settlementRoutes;
