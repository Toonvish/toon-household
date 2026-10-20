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
import type { Hono } from "hono";
import { created, json, noContent } from "../../lib/http.ts";
import type { AppEnv } from "../../lib/types.ts";
import { currentMembership, currentUser } from "../../lib/types.ts";
import { requireHouseholdRole } from "../../middleware/household.ts";
import { requireSession } from "../../middleware/session.ts";
import { requireVerifiedEmail } from "../../middleware/verifiedEmail.ts";
import { INVITE_RULE, RateLimiter } from "../services/auth/rateLimit.ts";
import { HouseholdInvites } from "../services/households/invites.service.ts";
import { validate } from "../../lib/validate.ts";
import { runtime } from "../../runtime.ts";

/* -------------------------------------------------------------------------- */
/* invite tokens (registered first — see the header)                          */
/* -------------------------------------------------------------------------- */

export function registerInviteTokenRoutes(router: Hono<AppEnv>): void {
  /** GET /api/households/invites/:token — public preview for the landing page. */
  router.get("/invites/:token", (c) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const invites = yield* HouseholdInvites;
        return json(c, yield* invites.previewInvite(c.req.param("token")));
      }),
    ),
  );

  /** POST /api/households/invites/accept — join the household behind a token. */
  router.post(
    "/invites/accept",
    requireSession(),
    validate("json", AcceptInviteRequestSchema),
    (c) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const invites = yield* HouseholdInvites;
          const user = yield* currentUser(c);
          return json(c, yield* invites.acceptInvite(user.id, c.req.valid("json").token));
        }),
      ),
  );
}

/* -------------------------------------------------------------------------- */
/* invites of a household (admin+)                                            */
/* -------------------------------------------------------------------------- */

export function registerHouseholdInviteRoutes(router: Hono<AppEnv>): void {
  /** GET /api/households/:householdId/invites */
  router.get(
    "/:householdId/invites",
    requireSession(),
    requireHouseholdRole("admin"),
    validate("query", PaginationQuerySchema),
    (c) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const invites = yield* HouseholdInvites;
          const membership = yield* currentMembership(c);
          return json(c, yield* invites.listInvites(membership.householdId, c.req.valid("query")));
        }),
      ),
  );

  /** POST /api/households/:householdId/invites — returns the shareable inviteUrl. */
  router.post(
    "/:householdId/invites",
    requireSession(),
    requireHouseholdRole("admin"),
    requireVerifiedEmail(),
    validate("json", CreateInviteRequestSchema),
    (c) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const invites = yield* HouseholdInvites;
          const rateLimiter = yield* RateLimiter;
          const membership = yield* currentMembership(c);
          const user = yield* currentUser(c);
          const body = c.req.valid("json");
          // Only the MAILING variant is metered (toon-finance 1715207) — a link-only invite
          // sends nothing.
          if (body.email !== undefined) yield* rateLimiter.enforce("invite-mail", user.id, INVITE_RULE);
          const result = yield* invites.createInvite(membership.householdId, user.id, body);
          return created(c, result);
        }),
      ),
  );

  /** DELETE /api/households/:householdId/invites/:inviteId */
  router.delete(
    "/:householdId/invites/:inviteId",
    requireSession(),
    requireHouseholdRole("admin"),
    (c) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const invites = yield* HouseholdInvites;
          const membership = yield* currentMembership(c);
          yield* invites.revokeInvite(membership.householdId, c.req.param("inviteId"));
          return noContent(c);
        }),
      ),
  );
}
