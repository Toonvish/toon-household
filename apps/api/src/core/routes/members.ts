/**
 * Household members and roles (SPEC D8, docs/API.md "Households").
 *
 * Registered on `householdRoutes` by households.ts. Membership is verified by
 * `requireHouseholdRole(...)` — there is not a single inline membership check here.
 *
 * `requireVerifiedEmail()` is deliberately NOT applied to leaving a household
 * ("Gruppe verlassen") and role changes: they are neither spam nor content, and trapping
 * somebody in a household they cannot leave is a worse outcome than the thing gated.
 * Adding and renaming a PLACEHOLDER member (ADR 0006, plan m3b decisions 2 and 3) writes
 * content (a person the household's modules can name), so those two routes ARE gated.
 */
import { zValidator } from "@hono/zod-validator";
import {
  CreatePlaceholderMemberRequestSchema,
  UpdateMemberRoleRequestSchema,
  UpdatePlaceholderMemberRequestSchema,
} from "@toon/shared";
import type { Hono } from "hono";
import { db } from "../../db/client.ts";
import { created, json, noContent } from "../../lib/http.ts";
import type { AppEnv } from "../../lib/types.ts";
import { requireMembership } from "../../lib/types.ts";
import { requireHouseholdRole } from "../../middleware/household.ts";
import { requireSession } from "../../middleware/session.ts";
import { requireVerifiedEmail } from "../../middleware/verifiedEmail.ts";
import {
  addPlaceholderMember,
  listMembers,
  removeMember,
  renamePlaceholderMember,
  updateMemberRole,
} from "../services/households/households.service.ts";
import { onValidationError } from "../services/households/validation.ts";

export function registerMemberRoutes(router: Hono<AppEnv>): void {
  /** GET /api/households/:householdId/members */
  router.get("/:householdId/members", requireSession(), requireHouseholdRole("member"), async (c) => {
    const membership = requireMembership(c);
    return json(c, { items: await listMembers(db, membership.householdId) });
  });

  /**
   * POST /api/households/:householdId/members — adds a PLACEHOLDER member by display name
   * (ADR 0006 decision 2; toon-finance's route): role `member`, no e-mail, no password, `201
   * { member }` with `hasAccount: false`. The account comes later through a claim invite
   * (`POST …/invites { claimsUserId }`). No "household full" rule (D1).
   */
  router.post(
    "/:householdId/members",
    requireSession(),
    requireHouseholdRole("admin"),
    requireVerifiedEmail(),
    zValidator("json", CreatePlaceholderMemberRequestSchema, onValidationError),
    async (c) => {
      const membership = requireMembership(c);
      const member = await addPlaceholderMember(
        db,
        membership.householdId,
        c.req.valid("json").displayName,
      );
      return created(c, { member }, `/api/households/${membership.householdId}/members/${member.userId}`);
    },
  );

  /**
   * PATCH /api/households/:householdId/members/:userId/placeholder — renames a placeholder
   * (ADR 0006 decision 3): `404` for a non-member, `409 member_has_account` for a member with
   * an account (they name themselves).
   */
  router.patch(
    "/:householdId/members/:userId/placeholder",
    requireSession(),
    requireHouseholdRole("admin"),
    requireVerifiedEmail(),
    zValidator("json", UpdatePlaceholderMemberRequestSchema, onValidationError),
    async (c) => {
      const membership = requireMembership(c);
      const member = await renamePlaceholderMember(
        db,
        membership.householdId,
        c.req.param("userId"),
        c.req.valid("json").name,
      );
      return json(c, { member });
    },
  );

  /**
   * PATCH /api/households/:householdId/members/:userId — role change / ownership transfer.
   * A placeholder keeps `member`: `409 conflict` (`server.household.placeholderRole`).
   */
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
   * to removeMember(). Removing a placeholder also deletes its user row (ADR 0006).
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
