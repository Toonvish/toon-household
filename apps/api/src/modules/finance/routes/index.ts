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
 */
import { Hono } from "hono";
import type { AppEnv } from "../../../lib/types.ts";
import { balanceRoutes } from "./balance.ts";
import { categoryRoutes } from "./categories.ts";
import { participantRoutes } from "./participants.ts";
import { planRoutes } from "./plan.ts";
import { settlementRoutes } from "./settlements.ts";
import { tagRoutes } from "./tags.ts";
import { transactionRoutes } from "./transactions.ts";

export const financeHouseholdRouter = new Hono<AppEnv>()
  .route("/participants", participantRoutes)
  .route("/transactions", transactionRoutes)
  .route("/categories", categoryRoutes)
  .route("/tags", tagRoutes)
  .route("/plan", planRoutes)
  .route("/balance", balanceRoutes)
  .route("/settlements", settlementRoutes);
