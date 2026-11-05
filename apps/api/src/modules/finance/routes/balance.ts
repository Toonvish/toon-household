/**
 * Mounted at /api/households/:householdId/finance/balance (see src/index.ts). The
 * balance and its sub-totals; the sign convention and derivation live in
 * `@toon/shared`'s `computeBreakdown` — this router only wires the request.
 */
import { BalanceHistoryQuerySchema, BalanceQuerySchema, type BalanceHistoryResponse } from "@toon/shared";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { effectBridge } from "../../../http/bridge.ts";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { queryParams } from "../../../http/request.ts";
import { json } from "../../../http/response.ts";
import { CurrentFinanceParticipant } from "../http.ts";
import { RequireFinanceParticipantLayer } from "../middleware.ts";
import { FinanceBalance } from "../services/ledger/balance.service.ts";
import { FinanceBalanceApi } from "./balance.api.ts";

export const balanceHandlers = HttpApiBuilder.group(FinanceBalanceApi, "finance.balance", (handlers) =>
  handlers
    /** GET /?includeAggregates= — the current balance, from the viewer's perspective AND slot 1's. */
    .handle(
      "get",
      Effect.fn("finance.balance.get")(function* () {
        const query = yield* queryParams(BalanceQuerySchema);
        const balanceService = yield* FinanceBalance;
        const household = yield* CurrentFinanceParticipant;
        const payload = yield* balanceService.getBalance(household.householdId, household.userId, household.memberSlot, query.includeAggregates);
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /** GET /history?from=&to=&includeAggregates= — a running balance per period. */
    .handle(
      "getHistory",
      Effect.fn("finance.balance.getHistory")(function* () {
        const query = yield* queryParams(BalanceHistoryQuerySchema);
        const balanceService = yield* FinanceBalance;
        const household = yield* CurrentFinanceParticipant;
        const items = yield* balanceService.getBalanceHistory(household.householdId, query.from, query.to, query.includeAggregates);
        const payload: BalanceHistoryResponse = { items };
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    ),
);

export const balanceRoutes = effectBridge(
  FinanceBalanceApi,
  Layer.suspend(() => Layer.provideMerge(balanceHandlers, RequireFinanceParticipantLayer)),
  "/api/households/:householdId/finance/balance",
);

export default balanceRoutes;
