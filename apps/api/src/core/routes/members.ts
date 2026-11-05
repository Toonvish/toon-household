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
import { HttpApiBuilder } from "effect/http-api";
import { CurrentMembership } from "../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../http/middleware.ts";
import { jsonBody } from "../../http/request.ts";
import { created, json, noContent } from "../../http/response.ts";
import { Households } from "../services/households/households.service.ts";
import { HouseholdsApi } from "./households.api.ts";

export const membersHandlers = HttpApiBuilder.group(HouseholdsApi, "members", (handlers) =>
  handlers
    /** GET /api/households/:householdId/members */
    .handle(
      "getByHouseholdIdMembers",
      Effect.fn("members.getByHouseholdIdMembers")(function* () {
        const households = yield* Households;
        const membership = yield* CurrentMembership;
        return json({ items: yield* households.listMembers(membership.householdId) });
      }),
      UNINTERRUPTIBLE,
    )
    /**
     * POST /api/households/:householdId/members — adds a PLACEHOLDER member by display name
     * (ADR 0006 decision 2; toon-finance's route): role `member`, no e-mail, no password, `201
     * { member }` with `hasAccount: false`. The account comes later through a claim invite
     * (`POST …/invites { claimsUserId }`). No "household full" rule (D1).
     */
    .handle(
      "postByHouseholdIdMembers",
      Effect.fn("members.postByHouseholdIdMembers")(function* () {
        const body = yield* jsonBody(CreatePlaceholderMemberRequestSchema);
        const households = yield* Households;
        const membership = yield* CurrentMembership;
        const member = yield* households.addPlaceholderMember(membership.householdId, body.displayName);
        return created({ member }, `/api/households/${membership.householdId}/members/${member.userId}`);
      }),
      UNINTERRUPTIBLE,
    )
    /**
     * PATCH /api/households/:householdId/members/:userId/placeholder — renames a placeholder
     * (ADR 0006 decision 3): `404` for a non-member, `409 member_has_account` for a member with
     * an account (they name themselves).
     */
    .handle(
      "patchByHouseholdIdMembersByUserIdPlaceholder",
      Effect.fn("members.patchByHouseholdIdMembersByUserIdPlaceholder")(function* ({ params }) {
        const body = yield* jsonBody(UpdatePlaceholderMemberRequestSchema);
        const households = yield* Households;
        const membership = yield* CurrentMembership;
        const member = yield* households.renamePlaceholderMember(
          membership.householdId,
          params.userId,
          body.name,
        );
        return json({ member });
      }),
      UNINTERRUPTIBLE,
    )
    /**
     * PATCH /api/households/:householdId/members/:userId — role change / ownership transfer.
     * A placeholder keeps `member`: `409 conflict` (`server.household.placeholderRole`).
     */
    .handle(
      "patchByHouseholdIdMembersByUserId",
      Effect.fn("members.patchByHouseholdIdMembersByUserId")(function* ({ params }) {
        const body = yield* jsonBody(UpdateMemberRoleRequestSchema);
        const households = yield* Households;
        const membership = yield* CurrentMembership;
        const member = yield* households.updateMemberRole(membership, params.userId, body.role);
        return json({ member });
      }),
      UNINTERRUPTIBLE,
    )
    /**
     * DELETE /api/households/:householdId/members/:userId
     * Admins remove others, everybody may remove themselves ("Gruppe verlassen"),
     * which is why this route only requires `member` and delegates the rank rules
     * to removeMember(). Removing a placeholder also deletes its user row (ADR 0006).
     */
    .handle(
      "deleteByHouseholdIdMembersByUserId",
      Effect.fn("members.deleteByHouseholdIdMembersByUserId")(function* ({ params }) {
        const households = yield* Households;
        const membership = yield* CurrentMembership;
        yield* households.removeMember(membership, params.userId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);
