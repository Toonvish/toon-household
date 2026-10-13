/**
 * Households, memberships, roles, invites and module enabling — the core household
 * API (SPEC D1, D8, §2, §3). Mounted at /api/households by src/index.ts.
 *
 * `householdRoutes` is the ONE Hono instance of this API. The sub-registrations
 * (invites.ts, members.ts, and M1-T09's modules.ts) add FULL-PATH routes to it
 * rather than being mounted with `app.route()` under a parameterised prefix.
 *
 * Registration order is load-bearing (D8): the invite-token routes (`/invites/:token`,
 * `/invites/accept`) come FIRST, otherwise `/:householdId` would capture "invites".
 *
 * Membership is verified exclusively by `requireHouseholdRole(...)`
 * (src/middleware/household.ts) — there is not a single inline membership check here.
 * `requireVerifiedEmail()` is applied PER ROUTE, not with `use("*")`, because the
 * writes in this API are deliberately NOT uniform (services/auth/verifiedEmail.ts):
 *
 *   gated    POST /  ·  PATCH /:householdId  ·  DELETE /:householdId  ·  POST /:householdId/invites
 *            — creating households and mailing invitations is the spam surface.
 *   gated    POST + DELETE /:householdId/modules/:moduleId (modules.ts) — a household-wide
 *            settings write, gated like PATCH /:householdId.
 *   ungated  POST /invites/accept — the one write an unconfirmed account MUST
 *            keep, or an invited flatmate cannot get in at all.
 *   ungated  the member routes — leaving a household and role changes are neither
 *            spam nor content, and trapping somebody in a household they cannot leave
 *            is a worse outcome than the thing gated.
 *   ungated  DELETE /:householdId/invites/:inviteId — revoking is the UNDO for the
 *            gated create; blocking it could only strand a live invitation.
 *
 * A `use("*")` here would silently swallow the accept route, i.e. the escape
 * hatch, so a new write added below needs its own line and a decision.
 *
 * Endpoint contract: docs/API.md (section "Households").
 */
import { zValidator } from "@hono/zod-validator";
import {
  CreateHouseholdRequestSchema,
  UpdateHouseholdRequestSchema,
} from "@toon/shared";
import { Hono } from "hono";
import { db } from "../../db/client.ts";
import { created, json, noContent } from "../../lib/http.ts";
import type { AppEnv } from "../../lib/types.ts";
import { requireMembership, requireUser } from "../../lib/types.ts";
import { requireHouseholdRole } from "../../middleware/household.ts";
import { requireSession } from "../../middleware/session.ts";
import { requireVerifiedEmail } from "../../middleware/verifiedEmail.ts";
import {
  createHousehold,
  deleteHousehold,
  getHouseholdWithRole,
  listHouseholdsForUser,
  listMembers,
  updateHousehold,
} from "../services/households/households.service.ts";
import { onValidationError } from "../services/households/validation.ts";
import { registerHouseholdInviteRoutes, registerInviteTokenRoutes } from "./invites.ts";
import { registerMemberRoutes } from "./members.ts";
import { registerModuleRoutes } from "./modules.ts";

export const householdRoutes = new Hono<AppEnv>();

// Invite-token routes FIRST (D8): `/invites/...` must not be captured by `/:householdId`.
registerInviteTokenRoutes(householdRoutes);

/* -------------------------------------------------------------------------- */
/* my households                                                              */
/* -------------------------------------------------------------------------- */

/** GET /api/households — every household of the caller incl. role + counts + modules. */
householdRoutes.get("/", requireSession(), async (c) => {
  const user = requireUser(c);
  return json(c, { items: await listHouseholdsForUser(db, user.id) });
});

/** POST /api/households — the caller becomes owner and the household becomes active. */
householdRoutes.post(
  "/",
  requireSession(),
  requireVerifiedEmail(),
  zValidator("json", CreateHouseholdRequestSchema, onValidationError),
  async (c) => {
    const user = requireUser(c);
    const household = await createHousehold(db, user.id, c.req.valid("json"));
    return created(c, { household }, `/api/households/${household.id}`);
  },
);

/* -------------------------------------------------------------------------- */
/* one household                                                              */
/* -------------------------------------------------------------------------- */

/** GET /api/households/:householdId — household + members. */
householdRoutes.get("/:householdId", requireSession(), requireHouseholdRole("member"), async (c) => {
  const membership = requireMembership(c);
  const [household, members] = await Promise.all([
    getHouseholdWithRole(db, membership.householdId, membership.role),
    listMembers(db, membership.householdId),
  ]);
  return json(c, { household, members });
});

/** PATCH /api/households/:householdId — rename/describe (admin+). */
householdRoutes.patch(
  "/:householdId",
  requireSession(),
  requireHouseholdRole("admin"),
  requireVerifiedEmail(),
  zValidator("json", UpdateHouseholdRequestSchema, onValidationError),
  async (c) => {
    const membership = requireMembership(c);
    const household = await updateHousehold(db, membership.householdId, membership.role, c.req.valid("json"));
    return json(c, { household });
  },
);

/** DELETE /api/households/:householdId — owner only; all content cascades. */
householdRoutes.delete(
  "/:householdId",
  requireSession(),
  requireHouseholdRole("owner"),
  requireVerifiedEmail(),
  async (c) => {
    const membership = requireMembership(c);
    await deleteHousehold(db, membership.householdId);
    return noContent(c);
  },
);

/* -------------------------------------------------------------------------- */
/* members and household invites (see members.ts / invites.ts)                */
/* -------------------------------------------------------------------------- */

registerMemberRoutes(householdRoutes);
registerHouseholdInviteRoutes(householdRoutes);

registerModuleRoutes(householdRoutes);

export default householdRoutes;
