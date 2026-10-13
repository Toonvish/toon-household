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
import type { MiddlewareHandler } from "hono";
import { db } from "../db/client.ts";
import { householdModules } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import type { AppEnv } from "../lib/types.ts";
import { requireMembership } from "../lib/types.ts";

/** 404 `module_disabled` unless the addressed household has enabled module `id`. */
export function requireModule(id: ModuleId): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const membership = requireMembership(c);
    const rows = await db
      .select({ moduleId: householdModules.moduleId })
      .from(householdModules)
      .where(
        and(
          eq(householdModules.householdId, membership.householdId),
          eq(householdModules.moduleId, id),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new ApiError(404, "module_disabled", "server.module.disabled");
    }
    await next();
  };
}
