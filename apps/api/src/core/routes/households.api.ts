/**
 * Households, memberships, roles, invites and module enabling — the core household API (SPEC D1, D8, §2, §3);
 * served at /api/households (docs/API.md "Households"). Four groups of the one `/api/households` router, in the
 * order the router registered them: invites (token routes first, D8), households, members, modules.
 *
 * Definitions only (plan P2, Table R): the handlers live in invites.ts, households.ts, members.ts and modules.ts.
 */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  chain,
  coreApi,
  RequireHouseholdAdmin,
  RequireHouseholdMember,
  RequireHouseholdOwner,
  RequireSession,
  RequireVerifiedEmail,
} from "../../http/middleware.ts";

export const InvitesGroup = HttpApiGroup.make("invites")
  .add(
    /** GET /api/households/invites/:token */
    HttpApiEndpoint.get("getInvitesByToken", "/invites/:token", { params: { token: Schema.String } }),
    /** POST /api/households/invites/accept */
    HttpApiEndpoint.post("postInvitesAccept", "/invites/accept").pipe(chain(RequireSession)),
    /** GET /api/households/:householdId/invites */
    HttpApiEndpoint.get("getByHouseholdIdInvites", "/:householdId/invites", {
      params: { householdId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdAdmin)),
    /** POST /api/households/:householdId/invites */
    HttpApiEndpoint.post("postByHouseholdIdInvites", "/:householdId/invites", {
      params: { householdId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdAdmin, RequireVerifiedEmail)),
    /** DELETE /api/households/:householdId/invites/:inviteId */
    HttpApiEndpoint.delete("deleteByHouseholdIdInvitesByInviteId", "/:householdId/invites/:inviteId", {
      params: { householdId: Schema.String, inviteId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdAdmin)),
  )
  .prefix("/api/households");

export const HouseholdsGroup = HttpApiGroup.make("households")
  .add(
    /** GET /api/households — every household of the caller incl. role + counts + modules. */
    HttpApiEndpoint.get("get", "/").pipe(chain(RequireSession)),
    /** POST /api/households — the caller becomes owner and the household becomes active. */
    HttpApiEndpoint.post("post", "/").pipe(chain(RequireSession, RequireVerifiedEmail)),
    /** GET /api/households/:householdId — household + members. */
    HttpApiEndpoint.get("getByHouseholdId", "/:householdId", {
      params: { householdId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdMember)),
    /** PATCH /api/households/:householdId — rename/describe (admin+). */
    HttpApiEndpoint.patch("patchByHouseholdId", "/:householdId", {
      params: { householdId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdAdmin, RequireVerifiedEmail)),
    /** DELETE /api/households/:householdId — owner only; all content cascades. */
    HttpApiEndpoint.delete("deleteByHouseholdId", "/:householdId", {
      params: { householdId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdOwner, RequireVerifiedEmail)),
  )
  .prefix("/api/households");

export const MembersGroup = HttpApiGroup.make("members")
  .add(
    /** GET /api/households/:householdId/members */
    HttpApiEndpoint.get("getByHouseholdIdMembers", "/:householdId/members", {
      params: { householdId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdMember)),
    /** POST /api/households/:householdId/members — adds a PLACEHOLDER member by display name */
    HttpApiEndpoint.post("postByHouseholdIdMembers", "/:householdId/members", {
      params: { householdId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdAdmin, RequireVerifiedEmail)),
    /** PATCH /api/households/:householdId/members/:userId/placeholder — renames a placeholder */
    HttpApiEndpoint.patch("patchByHouseholdIdMembersByUserIdPlaceholder", "/:householdId/members/:userId/placeholder", {
      params: { householdId: Schema.String, userId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdAdmin, RequireVerifiedEmail)),
    /** PATCH /api/households/:householdId/members/:userId — role change / ownership transfer. */
    HttpApiEndpoint.patch("patchByHouseholdIdMembersByUserId", "/:householdId/members/:userId", {
      params: { householdId: Schema.String, userId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdAdmin)),
    /** DELETE /api/households/:householdId/members/:userId */
    HttpApiEndpoint.delete("deleteByHouseholdIdMembersByUserId", "/:householdId/members/:userId", {
      params: { householdId: Schema.String, userId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdMember)),
  )
  .prefix("/api/households");

export const ModulesGroup = HttpApiGroup.make("modules")
  .add(
    /** POST /api/households/:householdId/modules/:moduleId — enable (admin+, verified e-mail). */
    HttpApiEndpoint.post("postByHouseholdIdModulesByModuleId", "/:householdId/modules/:moduleId", {
      params: { householdId: Schema.String, moduleId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdAdmin, RequireVerifiedEmail)),
    /** DELETE /api/households/:householdId/modules/:moduleId — disable (admin+, verified e-mail). */
    HttpApiEndpoint.delete("deleteByHouseholdIdModulesByModuleId", "/:householdId/modules/:moduleId", {
      params: { householdId: Schema.String, moduleId: Schema.String },
    }).pipe(chain(RequireSession, RequireHouseholdAdmin, RequireVerifiedEmail)),
  )
  .prefix("/api/households");

export const HouseholdsApi = coreApi(
  HttpApi.make("households").add(InvitesGroup, HouseholdsGroup, MembersGroup, ModulesGroup),
);
