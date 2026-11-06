/**
 * Households, memberships, roles, invites and module enabling — the core household
 * API (SPEC D1, D8, §2, §3). Served at /api/households by src/http/app.ts.
 *
 * `HouseholdsApi` (households.api.ts) is the ONE API of /api/households: its four
 * groups `invites`, `households`, `members`, `modules` carry FULL paths below the one
 * prefix, and `householdsHandlers` (end of file) provides the four handler layers
 * (invites.ts, members.ts, modules.ts and this file's `householdGroupHandlers`).
 *
 * The invite-token routes (`/invites/:token`, `/invites/accept`) sit beside `/:householdId` without an
 * order: the HttpApi router matches by specificity, so `/:householdId` never captures "invites" (the
 * pre-E7 Hono router matched in registration order and needed them declared first; D8).
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
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentMembership, CurrentUser } from "../../http/context.ts";
import { UNINTERRUPTIBLE } from "../../http/middleware.ts";
import { jsonBody } from "../../http/request.ts";
import { created, json, noContent } from "../../http/response.ts";
import { HOUSEHOLD_CREATE_RULE, RateLimiter } from "../services/auth/rateLimit.ts";
import { Households } from "../services/households/households.service.ts";
import { HouseholdsApi } from "./households.api.ts";
import { invitesHandlers } from "./invites.ts";
import { membersHandlers } from "./members.ts";
import { modulesHandlers } from "./modules.ts";

// Invite-token routes FIRST (D8): `/invites/...` must not be captured by `/:householdId`.

/* -------------------------------------------------------------------------- */
/* my households                                                              */
/* -------------------------------------------------------------------------- */

export const householdGroupHandlers = HttpApiBuilder.group(HouseholdsApi, "households", (handlers) =>
  handlers
    /** GET /api/households — every household of the caller incl. role + counts + modules. */
    .handle(
      "get",
      Effect.fn("households.get")(function* () {
        const households = yield* Households;
        const user = yield* CurrentUser;
        return json({ items: yield* households.listHouseholdsForUser(user.id) });
      }),
      UNINTERRUPTIBLE,
    )
    /** POST /api/households — the caller becomes owner and the household becomes active. */
    .handle(
      "post",
      Effect.fn("households.post")(function* () {
        const body = yield* jsonBody(CreateHouseholdRequestSchema);
        const households = yield* Households;
        const rateLimiter = yield* RateLimiter;
        const user = yield* CurrentUser;
        yield* rateLimiter.enforce("household-create", user.id, HOUSEHOLD_CREATE_RULE);
        const household = yield* households.createHousehold(user.id, body);
        return created({ household }, `/api/households/${household.id}`);
      }),
      UNINTERRUPTIBLE,
    )
    /* -------------------------------------------------------------------------- */
    /* one household                                                              */
    /* -------------------------------------------------------------------------- */
    /** GET /api/households/:householdId — household + members. */
    .handle(
      "getByHouseholdId",
      Effect.fn("households.getByHouseholdId")(function* () {
        const households = yield* Households;
        const membership = yield* CurrentMembership;
        const [household, members] = yield* Effect.all(
          [
            households.getHouseholdWithRole(membership.householdId, membership.role),
            households.listMembers(membership.householdId),
          ],
          { concurrency: "unbounded" },
        );
        return json({ household, members });
      }),
      UNINTERRUPTIBLE,
    )
    /** PATCH /api/households/:householdId — rename/describe (admin+). */
    .handle(
      "patchByHouseholdId",
      Effect.fn("households.patchByHouseholdId")(function* () {
        const body = yield* jsonBody(UpdateHouseholdRequestSchema);
        const households = yield* Households;
        const membership = yield* CurrentMembership;
        const household = yield* households.updateHousehold(membership.householdId, membership.role, body);
        return json({ household });
      }),
      UNINTERRUPTIBLE,
    )
    /** DELETE /api/households/:householdId — owner only; all content cascades. */
    .handle(
      "deleteByHouseholdId",
      Effect.fn("households.deleteByHouseholdId")(function* () {
        const households = yield* Households;
        const membership = yield* CurrentMembership;
        yield* households.deleteHousehold(membership.householdId);
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);

/* -------------------------------------------------------------------------- */
/* members and household invites (see members.ts / invites.ts)                */
/* -------------------------------------------------------------------------- */

export const householdsHandlers = Layer.mergeAll(
  invitesHandlers,
  householdGroupHandlers,
  membersHandlers,
  modulesHandlers,
);
