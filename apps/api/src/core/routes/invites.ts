/**
 * Household invites (SPEC D8, docs/API.md "Households").
 *
 * Two groups of routes, both registered on `householdRoutes` by households.ts:
 *
 *   registerInviteTokenRoutes     `/invites/...` — the token is the credential, so
 *                                  these are registered FIRST: `/:householdId` would
 *                                  otherwise capture "invites" (D8).
 *   registerHouseholdInviteRoutes `/:householdId/invites...` — admin+ of the household.
 *
 * `requireVerifiedEmail()` is applied PER ROUTE, because the writes are deliberately
 * NOT uniform (services/auth/verifiedEmail.ts explains the gate itself):
 *
 *   gated    POST /:householdId/invites — mailing invitations is the spam surface.
 *   ungated  POST /invites/accept — the one write an unconfirmed account MUST keep,
 *            or an invited flatmate cannot get in at all.
 *   ungated  DELETE /:householdId/invites/:inviteId — revoking is the UNDO for the
 *            gated create; blocking it could only strand a live invitation.
 */
import {
  AcceptInviteRequestSchema,
  CreateInviteRequestSchema,
  PaginationQuerySchema,
} from "@toon/shared";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentMembership, CurrentUser } from "../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../http/middleware.ts";
import { jsonBody, queryParams } from "../../http/request.ts";
import { created, json, noContent } from "../../http/response.ts";
import { INVITE_RULE, RateLimiter } from "../services/auth/rateLimit.ts";
import { HouseholdInvites } from "../services/households/invites.service.ts";
import { HouseholdsApi } from "./households.api.ts";

/* -------------------------------------------------------------------------- */
/* invite tokens (registered first — see the header)                          */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* invites of a household (admin+)                                            */
/* -------------------------------------------------------------------------- */

export const invitesHandlers = HttpApiBuilder.group(HouseholdsApi, "invites", (handlers) =>
  handlers
    /** GET /api/households/invites/:token — public preview for the landing page. */
    .handle(
      "getInvitesByToken",
      Effect.fn("invites.getInvitesByToken")(function* ({ params }) {
        const invites = yield* HouseholdInvites;
        return json(yield* invites.previewInvite(params.token));
      }),
      UNINTERRUPTIBLE,
    )
    /** POST /api/households/invites/accept — join the household behind a token. */
    .handle(
      "postInvitesAccept",
      Effect.fn("invites.postInvitesAccept")(function* () {
        const body = yield* jsonBody(AcceptInviteRequestSchema);
        const invites = yield* HouseholdInvites;
        const user = yield* CurrentUser;
        return json(yield* invites.acceptInvite(user.id, body.token));
      }),
      UNINTERRUPTIBLE,
    )
    /** GET /api/households/:householdId/invites */
    .handle(
      "getByHouseholdIdInvites",
      Effect.fn("invites.getByHouseholdIdInvites")(function* () {
        const query = yield* queryParams(PaginationQuerySchema);
        const invites = yield* HouseholdInvites;
        const membership = yield* CurrentMembership;
        return json(yield* invites.listInvites(membership.householdId, query));
      }),
      UNINTERRUPTIBLE,
    )
    /** POST /api/households/:householdId/invites — returns the shareable inviteUrl. */
    .handle(
      "postByHouseholdIdInvites",
      Effect.fn("invites.postByHouseholdIdInvites")(function* () {
        const body = yield* jsonBody(CreateInviteRequestSchema);
        const invites = yield* HouseholdInvites;
        const rateLimiter = yield* RateLimiter;
        const membership = yield* CurrentMembership;
        const user = yield* CurrentUser;
        // Only the MAILING variant is metered (toon-finance 1715207) — a link-only invite
        // sends nothing.
        if (body.email !== undefined) yield* rateLimiter.enforce("invite-mail", user.id, INVITE_RULE);
        const result = yield* invites.createInvite(membership.householdId, user.id, body);
        return created(result);
      }),
      UNINTERRUPTIBLE,
    )
    /** DELETE /api/households/:householdId/invites/:inviteId */
    .handle(
      "deleteByHouseholdIdInvitesByInviteId",
      Effect.fn("invites.deleteByHouseholdIdInvitesByInviteId")(function* ({ params }) {
        const invites = yield* HouseholdInvites;
        const membership = yield* CurrentMembership;
        yield* invites.revokeInvite(membership.householdId, params.inviteId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);
