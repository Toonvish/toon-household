/**
 * The finance module's HTTP surface (plan M3 decision 6, SPEC §2, D8; docs/EFFECT.md E7, E8; plan
 * `docs/plans/e7-http-api.md` P14, P15): the seven `HttpApi`s of its route files and their handler layer, which the
 * manifest contributes as `householdApi` (`ModuleHttpApi`):
 *
 *   financeHouseholdApis()      FinanceParticipantsApi, FinanceTransactionsApi, FinanceCategoriesApi, FinanceTagsApi,
 *                               FinancePlanApi, FinanceBalanceApi, FinanceSettlementsApi
 *                               (householdModuleApi("finance", …): /api/households/:householdId/finance/{participants,
 *                               transactions,categories,tags,plan,balance,settlements}/…, behind ApiErrorBoundary ->
 *                               RequireSession -> RequireHouseholdMember -> RequireModule; every ledger group attaches
 *                               RequireVerifiedEmail -> RequireFinanceParticipant itself)
 *   financeHouseholdHandlers()  the handler layers of their groups with `RequireFinanceParticipantLayer` provided and
 *                               kept in the output: `HttpApiBuilder` resolves a middleware when it builds the routes
 *
 * No user API: finance has no user-scoped routes. toon-finance's `/summary` before `/:transactionId` is a matter of
 * specificity on the router now. Both lists are computed in hoisted functions and read by the manifest lazily (a
 * getter, `Layer.suspend`), never at module scope (the import cycle).
 */
import { Layer } from "effect";
import type { AnyHttpApi } from "../../types.ts";
import { RequireFinanceParticipantLayer } from "../middleware.ts";
import { FinanceBalanceApi } from "./balance.api.ts";
import { balanceHandlers } from "./balance.ts";
import { FinanceCategoriesApi } from "./categories.api.ts";
import { categoriesHandlers } from "./categories.ts";
import { FinanceParticipantsApi } from "./participants.api.ts";
import { participantsHandlers } from "./participants.ts";
import { FinancePlanApi } from "./plan.api.ts";
import { financePlanHandlers } from "./plan.ts";
import { FinanceSettlementsApi } from "./settlements.api.ts";
import { settlementsHandlers } from "./settlements.ts";
import { FinanceTagsApi } from "./tags.api.ts";
import { financeTagsHandlers } from "./tags.ts";
import { FinanceTransactionsApi } from "./transactions.api.ts";
import { transactionsHandlers } from "./transactions.ts";

/** The finance module's household APIs (P14), one per route file, in the router's mount order. */
export function financeHouseholdApis(): ReadonlyArray<AnyHttpApi> {
  return [
    FinanceParticipantsApi,
    FinanceTransactionsApi,
    FinanceCategoriesApi,
    FinanceTagsApi,
    FinancePlanApi,
    FinanceBalanceApi,
    FinanceSettlementsApi,
  ];
}

/** The handlers of every group of `financeHouseholdApis()`, over the finance participant gate. */
export function financeHouseholdHandlers() {
  return Layer.provideMerge(
    Layer.mergeAll(
      participantsHandlers,
      transactionsHandlers,
      categoriesHandlers,
      financeTagsHandlers,
      financePlanHandlers,
      balanceHandlers,
      settlementsHandlers,
    ),
    RequireFinanceParticipantLayer,
  );
}
