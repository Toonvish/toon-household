/**
 * The finance module's household router (plan M3 decision 6, SPEC D8):
 *
 *   financeHouseholdRouter -> /api/households/:householdId/finance/{participants,transactions,
 *                             categories,tags,plan,balance,settlements}/…
 *                             (behind the session, member and module-enabled checks that
 *                             modules/mount.ts applies; every ledger router adds
 *                             requireVerifiedEmail() + requireFinanceParticipant())
 *
 * No userRouter: finance has no user-scoped routes. toon-finance's `/summary` before
 * `/:transactionId` stays inside transactions.ts. Hono copies a sub-app's routes when
 * `.route()` is called, so every router file registers its handlers at module top level.
 *
 * The HttpApi side (docs/EFFECT.md E7, E8; plan `docs/plans/e7-http-api.md` P14, P15; E7-T10, beside the router until
 * E7-T11 removes it): the manifest's `householdApi` (`ModuleHttpApi`) reads the hoisted functions below, never their
 * results at module scope (the import cycle). `financeHouseholdApis()` lists the seven APIs
 * (`householdModuleApi("finance", …)`: /api/households/:householdId/finance/…), `financeHouseholdHandlers()` the handler
 * layers of their groups with `RequireFinanceParticipantLayer` provided and kept in the output: the ledger groups
 * attach `RequireFinanceParticipant` (after `RequireVerifiedEmail`), and `HttpApiBuilder` resolves a middleware when it
 * builds the routes.
 */
import { Layer } from "effect";
import { bridgeRouter } from "../../../http/bridge.ts";
import type { AnyHttpApi } from "../../types.ts";
import { RequireFinanceParticipantLayer } from "../middleware.ts";
import { FinanceBalanceApi } from "./balance.api.ts";
import { balanceHandlers, balanceRoutes } from "./balance.ts";
import { FinanceCategoriesApi } from "./categories.api.ts";
import { categoriesHandlers, categoryRoutes } from "./categories.ts";
import { FinanceParticipantsApi } from "./participants.api.ts";
import { participantRoutes, participantsHandlers } from "./participants.ts";
import { FinancePlanApi } from "./plan.api.ts";
import { financePlanHandlers, planRoutes } from "./plan.ts";
import { FinanceSettlementsApi } from "./settlements.api.ts";
import { settlementRoutes, settlementsHandlers } from "./settlements.ts";
import { FinanceTagsApi } from "./tags.api.ts";
import { financeTagsHandlers, tagRoutes } from "./tags.ts";
import { FinanceTransactionsApi } from "./transactions.api.ts";
import { transactionRoutes, transactionsHandlers } from "./transactions.ts";

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

export const financeHouseholdRouter = bridgeRouter()
  .route("/participants", participantRoutes)
  .route("/transactions", transactionRoutes)
  .route("/categories", categoryRoutes)
  .route("/tags", tagRoutes)
  .route("/plan", planRoutes)
  .route("/balance", balanceRoutes)
  .route("/settlements", settlementRoutes);
