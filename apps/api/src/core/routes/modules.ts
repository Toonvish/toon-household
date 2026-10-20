/**
 * Module enabling per household (SPEC D2, D3, D8, §2; docs/plans/m1-core.md decision 3).
 *
 * Registered on `householdRoutes` by households.ts:
 *
 *   POST   /api/households/:householdId/modules/:moduleId   body `{ settings?: object }` (optional)
 *          -> 200 { household: HouseholdWithRole }   (its `modules` lists the new state)
 *   DELETE /api/households/:householdId/modules/:moduleId   -> 204, idempotent
 *
 * GATING: owner/admin AND a verified e-mail on both. Enabling or disabling a module is a
 * household-wide settings write, gated exactly like PATCH /:householdId. Membership is verified
 * by `requireHouseholdRole(...)` only — no inline check here.
 *
 * Any id in `MODULE_IDS` is accepted (else 404 `not_found`), whether or not this build contains
 * the module. The build module's `onEnable` hook may refuse with an `ApiError`, in which case
 * nothing is written (services/households/modules.ts).
 *
 * DISABLE KEEPS THE DATA: only the `household_modules` row goes; the module's household-scoped
 * rows stay in its tables, so enabling again brings them back unchanged.
 */
import { EnableModuleRequestSchema, isModuleId, type ModuleId } from "@toon/shared";
import { Effect, Schema } from "effect";
import type { Hono } from "hono";
import { NotFound, ValidationFailed } from "../../lib/errors.ts";
import { json, noContent } from "../../lib/http.ts";
import type { AppContext, AppEnv } from "../../lib/types.ts";
import { currentMembership } from "../../lib/types.ts";
import { requireHouseholdRole } from "../../middleware/household.ts";
import { requireSession } from "../../middleware/session.ts";
import { requireVerifiedEmail } from "../../middleware/verifiedEmail.ts";
import { Households } from "../services/households/households.service.ts";
import { HouseholdModules } from "../services/households/modules.ts";
import { decode } from "../../lib/validate.ts";
import { runtime } from "../../runtime.ts";

/** The `:moduleId` param as a `ModuleId`, or 404 `not_found`. */
const moduleIdParam = Effect.fnUntraced(function* (c: AppContext): Effect.fn.Return<ModuleId, NotFound> {
  const moduleId = c.req.param("moduleId");
  if (!moduleId || !isModuleId(moduleId)) return yield* new NotFound();
  return moduleId;
});

/**
 * The optional JSON body. An empty body means `{}`; anything else goes through
 * `EnableModuleRequestSchema` and answers 422 `validation_failed` like every validate() here.
 */
const enableBody = Effect.fnUntraced(function* (
  c: AppContext,
): Effect.fn.Return<{ settings?: Record<string, unknown> }, ValidationFailed | Schema.SchemaError> {
  const text = yield* Effect.promise(() => c.req.text());
  if (text.trim() === "") return {};
  const raw = yield* Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: () => new ValidationFailed({ details: undefined }),
  });
  return yield* decode(EnableModuleRequestSchema, raw);
});

export function registerModuleRoutes(router: Hono<AppEnv>): void {
  /** POST /api/households/:householdId/modules/:moduleId — enable (admin+, verified e-mail). */
  router.post(
    "/:householdId/modules/:moduleId",
    requireSession(),
    requireHouseholdRole("admin"),
    requireVerifiedEmail(),
    (c) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const households = yield* Households;
          const modules = yield* HouseholdModules;
          const membership = yield* currentMembership(c);
          const moduleId = yield* moduleIdParam(c);
          const { settings } = yield* enableBody(c);
          yield* modules.enableModule(membership.householdId, moduleId, settings);
          return json(c, {
            household: yield* households.getHouseholdWithRole(membership.householdId, membership.role),
          });
        }),
      ),
  );

  /** DELETE /api/households/:householdId/modules/:moduleId — disable (admin+, verified e-mail). */
  router.delete(
    "/:householdId/modules/:moduleId",
    requireSession(),
    requireHouseholdRole("admin"),
    requireVerifiedEmail(),
    (c) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const modules = yield* HouseholdModules;
          const membership = yield* currentMembership(c);
          const moduleId = yield* moduleIdParam(c);
          yield* modules.disableModule(membership.householdId, moduleId);
          return noContent(c);
        }),
      ),
  );
}
