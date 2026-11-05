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
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  CreateMealPlanEntryRequestSchema,
  LastPlannedQuerySchema,
  MealPlanRangeQuerySchema,
  UpdateMealPlanEntryRequestSchema,
} from "@toon/shared";
import { created, json, noContent } from "../../../http/response.ts";
import { jsonBody, queryParams } from "../../../http/request.ts";
import { CurrentMembership, CurrentUser } from "../../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../../http/middleware.ts";
import { RecipePlanApi } from "./plan.api.ts";
import { MealPlan } from "../services/plan/plan.service.ts";

// A confirmed address for every WRITE below (GETs pass through) — see
// middleware/verifiedEmail.ts. Mounted once so a route added later is gated by
// default, same as the recipes group.
export const recipePlanHandlers = HttpApiBuilder.group(RecipePlanApi, "recipe.plan", (handlers) =>
  handlers
    /**
     * GET /?from&to — flat, `(plannedOn, position)`-ordered range read. A day with
     * nothing planned is simply absent; the seven-slot week (incl. the "+ Plan"
     * empty cards) is built client-side.
     */
    .handle(
      "get",
      Effect.fn("recipe.plan.get")(function* () {
        const query = yield* queryParams(MealPlanRangeQuerySchema);
        const planService = yield* MealPlan;
        const membership = yield* CurrentMembership;
        const { from, to } = query;
        const items = yield* planService.listPlanEntries(membership.householdId, from, to);
        return json({ from, to, items });
      }),
      UNINTERRUPTIBLE,
    )
    /**
     * GET /last-planned?before — the latest day each recipe was planned before
     * `before`, for the recipe picker's "Zuletzt geplant". A never-planned recipe is
     * absent. No clash with `/:entryId`, which has no GET.
     */
    .handle(
      "getLastPlanned",
      Effect.fn("recipe.plan.getLastPlanned")(function* () {
        const query = yield* queryParams(LastPlannedQuerySchema);
        const planService = yield* MealPlan;
        const membership = yield* CurrentMembership;
        const { before } = query;
        const items = yield* planService.listLastPlanned(membership.householdId, before);
        return json({ before, items });
      }),
      UNINTERRUPTIBLE,
    )
    /**
     * POST / — plans a recipe on a day. Idempotent: 201 for a new entry, 200 when the
     * recipe was already planned that day (the second call's `servings` still applies).
     */
    .handle(
      "post",
      Effect.fn("recipe.plan.post")(function* () {
        const body = yield* jsonBody(CreateMealPlanEntryRequestSchema);
        const planService = yield* MealPlan;
        const membership = yield* CurrentMembership;
        const user = yield* CurrentUser;
        const { entry, created: isNew } = yield* planService.createPlanEntry(
          membership.householdId,
          user.id,
          body,
        );
        return isNew
          ? created({ entry }, `/api/households/${membership.householdId}/recipe/plan/${entry.id}`)
          : json({ entry });
      }),
      UNINTERRUPTIBLE,
    )
    /**
     * PATCH /:entryId — move to another day (re-tailing `position` on the target
     * day), change servings, or re-order within a day. Any member may edit any entry.
     */
    .handle(
      "patchByEntryId",
      Effect.fn("recipe.plan.patchByEntryId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateMealPlanEntryRequestSchema);
        const planService = yield* MealPlan;
        const membership = yield* CurrentMembership;
        const entry = yield* planService.updatePlanEntry(membership.householdId, params.entryId, body);
        return json({ entry });
      }),
      UNINTERRUPTIBLE,
    )
    /** DELETE /:entryId — unplans. Any member may remove any entry. */
    .handle(
      "deleteByEntryId",
      Effect.fn("recipe.plan.deleteByEntryId")(function* ({ params }) {
        const planService = yield* MealPlan;
        const membership = yield* CurrentMembership;
        yield* planService.deletePlanEntry(membership.householdId, params.entryId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);
