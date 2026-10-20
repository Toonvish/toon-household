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
import {
  CreateHouseholdRequestSchema,
  UpdateHouseholdRequestSchema,
} from "@toon/shared";
import { Effect } from "effect";
import { Hono } from "hono";
import { created, json, noContent } from "../../lib/http.ts";
import type { AppEnv } from "../../lib/types.ts";
import { currentMembership, currentUser } from "../../lib/types.ts";
import { requireHouseholdRole } from "../../middleware/household.ts";
import { requireSession } from "../../middleware/session.ts";
import { requireVerifiedEmail } from "../../middleware/verifiedEmail.ts";
import { HOUSEHOLD_CREATE_RULE, RateLimiter } from "../services/auth/rateLimit.ts";
import { Households } from "../services/households/households.service.ts";
import { validate } from "../../lib/validate.ts";
import { runtime } from "../../runtime.ts";
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
householdRoutes.get("/", requireSession(), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const households = yield* Households;
      const user = yield* currentUser(c);
      return json(c, { items: yield* households.listHouseholdsForUser(user.id) });
    }),
  ),
);

/** POST /api/households — the caller becomes owner and the household becomes active. */
householdRoutes.post(
  "/",
  requireSession(),
  requireVerifiedEmail(),
  validate("json", CreateHouseholdRequestSchema),
  (c) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const households = yield* Households;
        const rateLimiter = yield* RateLimiter;
        const user = yield* currentUser(c);
        yield* rateLimiter.enforce("household-create", user.id, HOUSEHOLD_CREATE_RULE);
        const household = yield* households.createHousehold(user.id, c.req.valid("json"));
        return created(c, { household }, `/api/households/${household.id}`);
      }),
    ),
);

/* -------------------------------------------------------------------------- */
/* one household                                                              */
/* -------------------------------------------------------------------------- */

/** GET /api/households/:householdId — household + members. */
householdRoutes.get("/:householdId", requireSession(), requireHouseholdRole("member"), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const households = yield* Households;
      const membership = yield* currentMembership(c);
      const [household, members] = yield* Effect.all(
        [
          households.getHouseholdWithRole(membership.householdId, membership.role),
          households.listMembers(membership.householdId),
        ],
        { concurrency: "unbounded" },
      );
      return json(c, { household, members });
    }),
  ),
);

/** PATCH /api/households/:householdId — rename/describe (admin+). */
householdRoutes.patch(
  "/:householdId",
  requireSession(),
  requireHouseholdRole("admin"),
  requireVerifiedEmail(),
  validate("json", UpdateHouseholdRequestSchema),
  (c) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const households = yield* Households;
        const membership = yield* currentMembership(c);
        const household = yield* households.updateHousehold(membership.householdId, membership.role, c.req.valid("json"));
        return json(c, { household });
      }),
    ),
);

/** DELETE /api/households/:householdId — owner only; all content cascades. */
householdRoutes.delete(
  "/:householdId",
  requireSession(),
  requireHouseholdRole("owner"),
  requireVerifiedEmail(),
  (c) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const households = yield* Households;
        const membership = yield* currentMembership(c);
        yield* households.deleteHousehold(membership.householdId);
        return noContent(c);
      }),
    ),
);

/* -------------------------------------------------------------------------- */
/* members and household invites (see members.ts / invites.ts)                */
/* -------------------------------------------------------------------------- */

registerMemberRoutes(householdRoutes);
registerHouseholdInviteRoutes(householdRoutes);

registerModuleRoutes(householdRoutes);

export default householdRoutes;
