/**
 * Mounted at /api/households/:householdId/finance/settlements (see src/index.ts).
 * There is no separate `settlements` table (docs/spec.md §3.9) — a settlement
 * IS a transaction with `splitMode: "SETTLEMENT"`, so `GET /` is the exact
 * same reader `GET .../transactions?splitMode=SETTLEMENT` would give.
 */
import { CreateSettlementRequestSchema, FinancePaginationQuerySchema as PaginationQuerySchema } from "@toon/shared";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { jsonBody, queryParams } from "../../../http/request.ts";
import { created, json } from "../../../http/response.ts";
import { CurrentFinanceParticipant } from "../http.ts";
import { FinanceSettlements } from "../services/ledger/settlements.service.ts";
import { FinanceTransactions } from "../services/ledger/transactions.service.ts";
import { FinanceSettlementsApi } from "./settlements.api.ts";

export const settlementsHandlers = HttpApiBuilder.group(FinanceSettlementsApi, "finance.settlements", (handlers) =>
  handlers
    /** GET / — every SETTLEMENT transaction, newest first. */
    .handle(
      "get",
      Effect.fn("finance.settlements.get")(function* () {
        const query = yield* queryParams(PaginationQuerySchema);
        const transactionsService = yield* FinanceTransactions;
        const household = yield* CurrentFinanceParticipant;
        const payload = yield* transactionsService.listTransactions(household.householdId, household.userId, {
          splitMode: "SETTLEMENT",
          includeAggregates: true,
          sort: "-bookedAt",
          limit: query.limit,
          offset: query.offset,
        });
        return json(payload);
      }),
      UNINTERRUPTIBLE,
    )
    /**
     * POST / — "Jetzt ausgleichen". `expectedBalanceCents` is REQUIRED; a stale
     * value answers `409 balance_stale` with `details.currentBalanceCents`
     * (docs/spec.md §3.9 — the one race in this app that costs real money).
     * `201` on a fresh booking, `200` on a replayed `mutationId`.
     */
    .handle(
      "post",
      Effect.fn("finance.settlements.post")(function* () {
        const body = yield* jsonBody(CreateSettlementRequestSchema);
        const settlementsService = yield* FinanceSettlements;
        const household = yield* CurrentFinanceParticipant;
        const outcome = yield* settlementsService.createSettlement(household.householdId, household.userId, household.memberSlot, body);
        return outcome.applied ? created(outcome.response) : json(outcome.response);
      }),
      UNINTERRUPTIBLE,
    ),
);
