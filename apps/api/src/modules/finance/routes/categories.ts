/**
 * STUB (M3-T03b): the finance categories router, empty until M3-T05 ports toon-finance's handlers into it
 * (each ported router applies requireVerifiedEmail() then requireFinanceParticipant(), plan M3 decisions 3 and 6).
 */
import { Hono } from "hono";
import type { AppEnv } from "../../../lib/types.ts";

export const categoryRoutes = new Hono<AppEnv>();
