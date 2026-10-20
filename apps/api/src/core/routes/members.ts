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
import {
  CreatePlaceholderMemberRequestSchema,
  UpdateMemberRoleRequestSchema,
  UpdatePlaceholderMemberRequestSchema,
} from "@toon/shared";
import { Effect } from "effect";
import type { Hono } from "hono";
import { created, json, noContent } from "../../lib/http.ts";
import type { AppEnv } from "../../lib/types.ts";
import { currentMembership } from "../../lib/types.ts";
import { requireHouseholdRole } from "../../middleware/household.ts";
import { requireSession } from "../../middleware/session.ts";
import { requireVerifiedEmail } from "../../middleware/verifiedEmail.ts";
import { Households } from "../services/households/households.service.ts";
import { validate } from "../../lib/validate.ts";
import { runtime } from "../../runtime.ts";

export function registerMemberRoutes(router: Hono<AppEnv>): void {
  /** GET /api/households/:householdId/members */
  router.get("/:householdId/members", requireSession(), requireHouseholdRole("member"), (c) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const households = yield* Households;
        const membership = yield* currentMembership(c);
        return json(c, { items: yield* households.listMembers(membership.householdId) });
      }),
    ),
  );

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
    validate("json", CreatePlaceholderMemberRequestSchema),
    (c) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const households = yield* Households;
          const membership = yield* currentMembership(c);
          const member = yield* households.addPlaceholderMember(
            membership.householdId,
            c.req.valid("json").displayName,
          );
          return created(c, { member }, `/api/households/${membership.householdId}/members/${member.userId}`);
        }),
      ),
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
    validate("json", UpdatePlaceholderMemberRequestSchema),
    (c) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const households = yield* Households;
          const membership = yield* currentMembership(c);
          const member = yield* households.renamePlaceholderMember(
            membership.householdId,
            c.req.param("userId"),
            c.req.valid("json").name,
          );
          return json(c, { member });
        }),
      ),
  );

  /**
   * PATCH /api/households/:householdId/members/:userId — role change / ownership transfer.
   * A placeholder keeps `member`: `409 conflict` (`server.household.placeholderRole`).
   */
  router.patch(
    "/:householdId/members/:userId",
    requireSession(),
    requireHouseholdRole("admin"),
    validate("json", UpdateMemberRoleRequestSchema),
    (c) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const households = yield* Households;
          const membership = yield* currentMembership(c);
          const member = yield* households.updateMemberRole(
            membership,
            c.req.param("userId"),
            c.req.valid("json").role,
          );
          return json(c, { member });
        }),
      ),
  );

  /**
   * DELETE /api/households/:householdId/members/:userId
   * Admins remove others, everybody may remove themselves ("Gruppe verlassen"),
   * which is why this route only requires `member` and delegates the rank rules
   * to removeMember(). Removing a placeholder also deletes its user row (ADR 0006).
   */
  router.delete("/:householdId/members/:userId", requireSession(), requireHouseholdRole("member"), (c) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const households = yield* Households;
        const membership = yield* currentMembership(c);
        yield* households.removeMember(membership, c.req.param("userId"));
        return noContent(c);
      }),
    ),
  );
}
