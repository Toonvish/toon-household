/**
 * Mounts the build's modules on the app (SPEC §2, D8):
 *
 *   userRouter       -> /api/<id>                          (user-scoped, no household)
 *   householdRouter  -> /api/households/:householdId/<id>  behind
 *                       requireSession() -> requireHouseholdRole("member") -> requireModule(id)
 *
 * The chain order is load-bearing and pinned by test/middleware.test.ts: no cookie
 * answers 401 before anything else, a non-member answers 403 before the module row
 * is even looked at. A module router adds `requireVerifiedEmail()` itself, where
 * its writes are uniformly gated.
 *
 * A module's userRouter does its own `requireSession()`.
 */
import type { Hono } from "hono";
import { requireHouseholdRole } from "../middleware/household.ts";
import { requireModule } from "../middleware/module.ts";
import { requireSession } from "../middleware/session.ts";
import type { AppEnv } from "../lib/types.ts";
import type { ApiModule } from "./types.ts";

export function mountModules(app: Hono<AppEnv>, modules: readonly ApiModule[]): void {
  for (const module of modules) {
    if (module.userRouter) {
      app.route(`/api/${module.id}`, module.userRouter);
    }
    if (module.householdRouter) {
      // Hono's `/*` also matches the bare base path, so one registration covers both.
      const base = `/api/households/:householdId/${module.id}`;
      app.use(`${base}/*`, requireSession(), requireHouseholdRole("member"), requireModule(module.id));
      app.route(base, module.householdRouter);
    }
  }
}
