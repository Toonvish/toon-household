/**
 * `requireModule(id)` — the module gate (SPEC D8). A household reaches a module's
 * routes only once it has enabled it, i.e. a `household_modules` row exists for
 * `(householdId, id)`. Absent -> 404 `module_disabled`.
 *
 * ORDER: after `requireSession()` and `requireHouseholdRole()`, because it reads
 * `c.get("membership")`. Role before module on purpose: a non-member of a
 * household gets 403 `forbidden`, never a `module_disabled` that would confirm
 * which modules some other household has switched on.
 * `mountModules()` (modules/mount.ts) applies the chain, so a module router never
 * mounts this itself.
 */
import type { ModuleId } from "@toon/shared";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { MiddlewareHandler } from "hono";
import { Database } from "../db/database.ts";
import { householdModules } from "../db/schema.ts";
import { ApiFailure } from "../lib/errors.ts";
import type { AppContext, AppEnv } from "../lib/types.ts";
import { currentMembership } from "../lib/types.ts";
import { runtime } from "../runtime.ts";

/** The gate as one effect: 404 `module_disabled` unless the household row for `id` exists. */
const checkModuleEnabled = Effect.fn("Module.check")(function* (c: AppContext, id: ModuleId) {
  const membership = yield* currentMembership(c);
  const database = yield* Database;
  const rows = yield* database.use((db) =>
    db
      .select({ moduleId: householdModules.moduleId })
      .from(householdModules)
      .where(
        and(
          eq(householdModules.householdId, membership.householdId),
          eq(householdModules.moduleId, id),
        ),
      )
      .limit(1),
  );
  if (rows.length === 0) {
    return yield* new ApiFailure({ status: 404, code: "module_disabled", text: "server.module.disabled" });
  }
});

/**
 * 404 `module_disabled` unless the addressed household has enabled module `id`. A hoisted declaration that reads
 * no imported binding until a request arrives (plan e2 P12; the routers' import cycle).
 */
export function requireModule(id: ModuleId): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await runtime.runPromise(checkModuleEnabled(c, id));
    await next();
  };
}
