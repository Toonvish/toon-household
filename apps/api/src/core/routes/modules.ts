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
import type { Hono } from "hono";
import { db } from "../../db/client.ts";
import { ApiError } from "../../lib/errors.ts";
import { json, noContent } from "../../lib/http.ts";
import type { AppContext, AppEnv } from "../../lib/types.ts";
import { requireMembership } from "../../lib/types.ts";
import { requireHouseholdRole } from "../../middleware/household.ts";
import { requireSession } from "../../middleware/session.ts";
import { requireVerifiedEmail } from "../../middleware/verifiedEmail.ts";
import { getHouseholdWithRole } from "../services/households/households.service.ts";
import { disableModule, enableModule } from "../services/households/modules.ts";
import { onValidationError } from "../services/households/validation.ts";

/** The `:moduleId` param as a `ModuleId`, or 404 `not_found`. */
function moduleIdParam(c: AppContext): ModuleId {
  const moduleId = c.req.param("moduleId");
  if (!moduleId || !isModuleId(moduleId)) throw ApiError.notFound();
  return moduleId;
}

/**
 * The optional JSON body. An empty body means `{}`; anything else goes through
 * `EnableModuleRequestSchema` and answers 422 `validation_failed` like every zValidator here.
 */
async function enableBody(c: AppContext): Promise<{ settings?: Record<string, unknown> }> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw ApiError.validationFailed(undefined);
  }
  const result = EnableModuleRequestSchema.safeParse(raw);
  if (!result.success) {
    onValidationError(result);
    throw ApiError.validationFailed(undefined); // unreachable: onValidationError throws
  }
  return result.data;
}

export function registerModuleRoutes(router: Hono<AppEnv>): void {
  /** POST /api/households/:householdId/modules/:moduleId — enable (admin+, verified e-mail). */
  router.post(
    "/:householdId/modules/:moduleId",
    requireSession(),
    requireHouseholdRole("admin"),
    requireVerifiedEmail(),
    async (c) => {
      const membership = requireMembership(c);
      const moduleId = moduleIdParam(c);
      const { settings } = await enableBody(c);
      await enableModule(db, membership.householdId, moduleId, settings);
      return json(c, { household: await getHouseholdWithRole(db, membership.householdId, membership.role) });
    },
  );

  /** DELETE /api/households/:householdId/modules/:moduleId — disable (admin+, verified e-mail). */
  router.delete(
    "/:householdId/modules/:moduleId",
    requireSession(),
    requireHouseholdRole("admin"),
    requireVerifiedEmail(),
    async (c) => {
      const membership = requireMembership(c);
      const moduleId = moduleIdParam(c);
      await disableModule(db, membership.householdId, moduleId);
      return noContent(c);
    },
  );
}
