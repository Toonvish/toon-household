/**
 * The module gate (SPEC D8). A household reaches a module's routes only once it has enabled it, i.e. a
 * `household_modules` row exists for `(householdId, id)`. Absent -> 404 `module_disabled`.
 *
 * ORDER: after the session and the household middleware, because it reads the membership. Role before module on
 * purpose: a non-member of a household gets 403 `forbidden`, never a `module_disabled` that would confirm which
 * modules some other household has switched on.
 *
 * - The Effect HTTP layer (docs/EFFECT.md E8; plan `docs/plans/e7-http-api.md` P5, P14): `RequireModuleLayer`
 *   implements the tag `RequireModule` of `apps/api/src/http/middleware.ts`. The module id comes from the `ModuleId`
 *   annotation `householdModuleApi` puts on every group of a module API (`moduleIdOf(group)`), never from the URL;
 *   `householdModuleApi` attaches the chain, so a module API never attaches this itself.
 * - `checkModuleEnabled` is the gate as one effect (the pre-E7 Hono `requireModule(id)` ran it through `mountModules()`
 *   of `apps/api/src/modules/mount.ts`).
 */
import type { ModuleId } from "@toon/shared";
import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { Database } from "../db/database.ts";
import { householdModules } from "../db/schema.ts";
import { CurrentMembership } from "../http/context.ts";
import { moduleIdOf, RequireModule } from "../http/middleware.ts";
import { ApiFailure } from "../lib/errors.ts";

/** The gate as one effect: 404 `module_disabled` unless the row of `householdId` for module `id` exists. */
export const checkModuleEnabled = Effect.fn("Module.check")(function* (householdId: string, id: ModuleId) {
  const database = yield* Database;
  const rows = yield* database.use((db) =>
    db
      .select({ moduleId: householdModules.moduleId })
      .from(householdModules)
      .where(and(eq(householdModules.householdId, householdId), eq(householdModules.moduleId, id)))
      .limit(1),
  );
  if (rows.length === 0) {
    return yield* new ApiFailure({ status: 404, code: "module_disabled", text: "server.module.disabled" });
  }
});

/** A `RequireModule` on a group no `householdModuleApi` annotated is a wiring bug of the API definition. */
const UNANNOTATED_GROUP = new Error("RequireModule runs on a group without a ModuleId annotation (use householdModuleApi)");

/** `RequireModule` (P5, P14): 404 `module_disabled` unless the household of the membership has the group's module. */
export const RequireModuleLayer = Layer.effect(
  RequireModule,
  Effect.gen(function* () {
    const database = yield* Database;
    return RequireModule.of(
      Effect.fn("RequireModule")(function* (httpEffect, { group }) {
        const id = moduleIdOf(group);
        if (id === undefined) return yield* Effect.die(UNANNOTATED_GROUP);
        const membership = yield* CurrentMembership;
        yield* Effect.provideService(checkModuleEnabled(membership.householdId, id), Database, database);
        return yield* httpEffect;
      }),
    );
  }),
);
