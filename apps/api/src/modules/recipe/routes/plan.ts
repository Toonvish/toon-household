/**
 * OWNER: plan agent.
 *
 * Mounted at /api/households/:householdId/recipe/plan (via modules/recipe/routes/index.ts, behind the module chain), so the paths declared
 * here are relative: "/", "/last-planned", "/:entryId".
 *
 * Auth: the module chain (modules/mount.ts) runs `requireSession()` + `requireHouseholdRole("member")` +
 * `requireModule("recipe")` as router-level middleware for EVERY route below, so no handler checks
 * membership itself. A router adds `requireVerifiedEmail()` on top (a confirmed address for every write).
 *
 * ANY MEMBER may plan or unplan ANY entry — a shared week is shared property, the
 * same rule `updateShoppingList` already applies to renaming a shopping list. There
 * is no `assertCanModifyOwned` call anywhere in this file.
 *
 * Endpoint contract: docs/API.md (section "Meal plan").
 */
import { zValidator } from "@hono/zod-validator";
import {
  CreateMealPlanEntryRequestSchema,
  LastPlannedQuerySchema,
  MealPlanRangeQuerySchema,
  UpdateMealPlanEntryRequestSchema,
} from "@toon/shared";
import { Hono } from "hono";
import { db } from "../../../db/client.ts";
import { created, json, noContent } from "../../../lib/http.ts";
import type { AppEnv } from "../../../lib/types.ts";
import { requireMembership, requireUser } from "../../../lib/types.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { onValidationError } from "../../../core/services/households/validation.ts";
import {
  createPlanEntry,
  deletePlanEntry,
  listLastPlanned,
  listPlanEntries,
  updatePlanEntry,
} from "../services/plan/plan.service.ts";

export const planRoutes = new Hono<AppEnv>();

// A confirmed address for every WRITE below (GETs pass through) — see
// middleware/verifiedEmail.ts. Mounted once so a route added later is gated by
// default, same as recipeRoutes.
planRoutes.use("*", requireVerifiedEmail());

/**
 * GET /?from&to — flat, `(plannedOn, position)`-ordered range read. A day with
 * nothing planned is simply absent; the seven-slot week (incl. the "+ Plan"
 * empty cards) is built client-side.
 */
planRoutes.get(
  "/",
  zValidator("query", MealPlanRangeQuerySchema, onValidationError),
  async (c) => {
    const membership = requireMembership(c);
    const { from, to } = c.req.valid("query");
    const items = await listPlanEntries(db, membership.householdId, from, to);
    return json(c, { from, to, items });
  },
);

/**
 * GET /last-planned?before — the latest day each recipe was planned before
 * `before`, for the recipe picker's "Zuletzt geplant". A never-planned recipe is
 * absent. No clash with `/:entryId`, which has no GET.
 */
planRoutes.get(
  "/last-planned",
  zValidator("query", LastPlannedQuerySchema, onValidationError),
  async (c) => {
    const membership = requireMembership(c);
    const { before } = c.req.valid("query");
    const items = await listLastPlanned(db, membership.householdId, before);
    return json(c, { before, items });
  },
);

/**
 * POST / — plans a recipe on a day. Idempotent: 201 for a new entry, 200 when the
 * recipe was already planned that day (the second call's `servings` still applies).
 */
planRoutes.post(
  "/",
  zValidator("json", CreateMealPlanEntryRequestSchema, onValidationError),
  async (c) => {
    const membership = requireMembership(c);
    const user = requireUser(c);
    const { entry, created: isNew } = await createPlanEntry(
      db,
      membership.householdId,
      user.id,
      c.req.valid("json"),
    );
    return isNew
      ? created(c, { entry }, `/api/households/${membership.householdId}/recipe/plan/${entry.id}`)
      : json(c, { entry });
  },
);

/**
 * PATCH /:entryId — move to another day (re-tailing `position` on the target
 * day), change servings, or re-order within a day. Any member may edit any entry.
 */
planRoutes.patch(
  "/:entryId",
  zValidator("json", UpdateMealPlanEntryRequestSchema, onValidationError),
  async (c) => {
    const membership = requireMembership(c);
    const entry = await updatePlanEntry(
      db,
      membership.householdId,
      c.req.param("entryId"),
      c.req.valid("json"),
    );
    return json(c, { entry });
  },
);

/** DELETE /:entryId — unplans. Any member may remove any entry. */
planRoutes.delete("/:entryId", async (c) => {
  const membership = requireMembership(c);
  await deletePlanEntry(db, membership.householdId, c.req.param("entryId"));
  return noContent(c);
});
