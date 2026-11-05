/**
 * Mounted at /api/households/:householdId/finance/balance (see src/index.ts). The
 * balance and its sub-totals; the sign convention and derivation live in
 * `@toon/shared`'s `computeBreakdown` — this router only wires the request.
 */
import { Effect } from "effect";
import { runtime } from "../../../runtime.ts";
import { BalanceHistoryQuerySchema, BalanceQuerySchema, type BalanceHistoryResponse } from "@toon/shared";
import { Hono } from "hono";
import { json } from "../../../lib/http.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { requireFinanceParticipant, currentFinanceParticipant } from "../middleware.ts";
import { validate } from "../../../lib/validate.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { FinanceBalance } from "../services/ledger/balance.service.ts";

export const balanceRoutes = new Hono<AppEnv>();

balanceRoutes.use("*", requireVerifiedEmail());
balanceRoutes.use("*", requireFinanceParticipant());

/** GET /?includeAggregates= — the current balance, from the viewer's perspective AND slot 1's. */
balanceRoutes.get("/", validate("query", BalanceQuerySchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const balanceService = yield* FinanceBalance;
  const household = yield* currentFinanceParticipant(c);
  const query = c.req.valid("query");
  const payload = yield* balanceService.getBalance(household.householdId, household.userId, household.memberSlot, query.includeAggregates);
  return json(c, payload);
}),
),
);

/** GET /history?from=&to=&includeAggregates= — a running balance per period. */
balanceRoutes.get("/history", validate("query", BalanceHistoryQuerySchema), (c) =>
runtime.runPromise(
Effect.gen(function* () {
  const balanceService = yield* FinanceBalance;
  const household = yield* currentFinanceParticipant(c);
  const query = c.req.valid("query");
  const items = yield* balanceService.getBalanceHistory(household.householdId, query.from, query.to, query.includeAggregates);
  const payload: BalanceHistoryResponse = { items };
  return json(c, payload);
}),
),
);

export default balanceRoutes;
