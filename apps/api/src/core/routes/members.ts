/**
 * Household members and roles (SPEC D8, docs/API.md "Households").
 *
 * Registered on `householdRoutes` by households.ts. Membership is verified by
 * `requireHouseholdRole(...)` — there is not a single inline membership check here.
 *
 * `requireVerifiedEmail()` is deliberately NOT applied: leaving a household
 * ("Gruppe verlassen") and role changes are neither spam nor content, and trapping
 * somebody in a household they cannot leave is a worse outcome than the thing gated.
 */
import { zValidator } from "@hono/zod-validator";
import { UpdateMemberRoleRequestSchema } from "@toon/shared";
import type { Hono } from "hono";
import { db } from "../../db/client.ts";
import { json, noContent } from "../../lib/http.ts";
import type { AppEnv } from "../../lib/types.ts";
import { requireMembership } from "../../lib/types.ts";
import { requireHouseholdRole } from "../../middleware/household.ts";
import { requireSession } from "../../middleware/session.ts";
import {
  listMembers,
  removeMember,
  updateMemberRole,
} from "../services/households/households.service.ts";
import { onValidationError } from "../services/households/validation.ts";

export function registerMemberRoutes(router: Hono<AppEnv>): void {
  /** GET /api/households/:householdId/members */
  router.get("/:householdId/members", requireSession(), requireHouseholdRole("member"), async (c) => {
    const membership = requireMembership(c);
    return json(c, { items: await listMembers(db, membership.householdId) });
  });

  /** PATCH /api/households/:householdId/members/:userId — role change / ownership transfer. */
  router.patch(
    "/:householdId/members/:userId",
    requireSession(),
    requireHouseholdRole("admin"),
    zValidator("json", UpdateMemberRoleRequestSchema, onValidationError),
    async (c) => {
      const membership = requireMembership(c);
      const member = await updateMemberRole(
        db,
        membership,
        c.req.param("userId"),
        c.req.valid("json").role,
      );
      return json(c, { member });
    },
  );

  /**
   * DELETE /api/households/:householdId/members/:userId
   * Admins remove others, everybody may remove themselves ("Gruppe verlassen"),
   * which is why this route only requires `member` and delegates the rank rules
   * to removeMember().
   */
  router.delete(
    "/:householdId/members/:userId",
    requireSession(),
    requireHouseholdRole("member"),
    async (c) => {
      const membership = requireMembership(c);
      await removeMember(db, membership, c.req.param("userId"));
      return noContent(c);
    },
  );
}
