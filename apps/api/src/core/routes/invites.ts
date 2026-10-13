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
import { zValidator } from "@hono/zod-validator";
import {
  AcceptInviteRequestSchema,
  CreateInviteRequestSchema,
  PaginationQuerySchema,
} from "@toon/shared";
import type { Hono } from "hono";
import { db } from "../../db/client.ts";
import { created, json, noContent } from "../../lib/http.ts";
import type { AppEnv } from "../../lib/types.ts";
import { requireMembership, requireUser } from "../../lib/types.ts";
import { requireHouseholdRole } from "../../middleware/household.ts";
import { requireSession } from "../../middleware/session.ts";
import { requireVerifiedEmail } from "../../middleware/verifiedEmail.ts";
import {
  acceptInvite,
  createInvite,
  listInvites,
  previewInvite,
  revokeInvite,
} from "../services/households/invites.service.ts";
import { onValidationError } from "../services/households/validation.ts";

/* -------------------------------------------------------------------------- */
/* invite tokens (registered first — see the header)                          */
/* -------------------------------------------------------------------------- */

export function registerInviteTokenRoutes(router: Hono<AppEnv>): void {
  /** GET /api/households/invites/:token — public preview for the landing page. */
  router.get("/invites/:token", async (c) => json(c, await previewInvite(db, c.req.param("token"))));

  /** POST /api/households/invites/accept — join the household behind a token. */
  router.post(
    "/invites/accept",
    requireSession(),
    zValidator("json", AcceptInviteRequestSchema, onValidationError),
    async (c) => {
      const user = requireUser(c);
      return json(c, await acceptInvite(db, user.id, c.req.valid("json").token));
    },
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
    zValidator("query", PaginationQuerySchema, onValidationError),
    async (c) => {
      const membership = requireMembership(c);
      return json(c, await listInvites(db, membership.householdId, c.req.valid("query")));
    },
  );

  /** POST /api/households/:householdId/invites — returns the shareable inviteUrl. */
  router.post(
    "/:householdId/invites",
    requireSession(),
    requireHouseholdRole("admin"),
    requireVerifiedEmail(),
    zValidator("json", CreateInviteRequestSchema, onValidationError),
    async (c) => {
      const membership = requireMembership(c);
      const user = requireUser(c);
      const result = await createInvite(db, membership.householdId, user.id, c.req.valid("json"));
      return created(c, result);
    },
  );

  /** DELETE /api/households/:householdId/invites/:inviteId */
  router.delete(
    "/:householdId/invites/:inviteId",
    requireSession(),
    requireHouseholdRole("admin"),
    async (c) => {
      const membership = requireMembership(c);
      await revokeInvite(db, membership.householdId, c.req.param("inviteId"));
      return noContent(c);
    },
  );
}
