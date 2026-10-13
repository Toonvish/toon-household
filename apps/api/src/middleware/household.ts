/**
 * Household authorisation middleware — the ONLY place that decides whether the
 * session user may touch a household's data. Routers apply it once:
 *
 *   exampleRoutes.use("*", requireSession(), requireHouseholdRole("member"));
 *   householdRoutes.delete("/:householdId", requireHouseholdRole("owner"), handler);
 *
 * Semantics (docs/API.md):
 *   no session                -> 401 unauthorized
 *   unknown household/invite  -> 404 not_found   (never leaks that it exists)
 *   not a member              -> 403 forbidden
 *   role too low              -> 403 forbidden
 *   ok                        -> c.set("membership", { householdId, userId, role })
 *
 * The household id normally comes from the `:householdId` path param. For routes
 * that address an invite directly (`/invites/:inviteId`) the household is
 * resolved through that invite instead.
 *
 * Under D8 the household comes from `:householdId`, never from a resource row, so
 * this middleware no longer guards cross-household ids. EVERY by-id lookup in a
 * module service MUST be scoped by `membership.householdId`
 * (`and(eq(t.id, id), eq(t.householdId, membership.householdId))`) and answer 404
 * `not_found` otherwise; each module resource gets a test addressing another
 * household's id. Binding on M2/M3.
 */
import type { HouseholdRole } from "@toon/shared";
import { roleAtLeast } from "@toon/shared";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { db } from "../db/client.ts";
import { householdInvites, householdMembers, households } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import type { AppContext, AppEnv, Membership } from "../lib/types.ts";
import { requireUser } from "../lib/types.ts";

/** Route params that identify a household-scoped resource, in resolution order. */
const RESOURCE_PARAMS = ["inviteId"] as const;

export type ResourceParam = (typeof RESOURCE_PARAMS)[number];

export interface HouseholdRoleOptions {
  /**
   * Force resolution through a specific resource param instead of auto-detecting
   * it (useful when a route carries several ids).
   */
  via?: ResourceParam;
}

/** Unknown role strings in the DB degrade to the weakest role. */
function toRole(value: string): HouseholdRole {
  return value === "owner" || value === "admin" ? value : "member";
}

/** Looks up the owning household of a resource id, or null when it does not exist. */
async function householdIdOfResource(param: ResourceParam, id: string): Promise<string | null> {
  switch (param) {
    case "inviteId": {
      const rows = await db
        .select({ householdId: householdInvites.householdId })
        .from(householdInvites)
        .where(eq(householdInvites.id, id))
        .limit(1);
      return rows[0]?.householdId ?? null;
    }
  }
}

/**
 * Determines which household the request targets. Throws 404 when the addressed
 * resource does not exist and 400 when the route carries no usable id at all.
 */
export async function resolveHouseholdId(
  c: AppContext,
  options: HouseholdRoleOptions = {},
): Promise<string> {
  if (!options.via) {
    const direct = c.req.param("householdId");
    if (direct && direct.length > 0) return direct;
  }

  const candidates: readonly ResourceParam[] = options.via ? [options.via] : RESOURCE_PARAMS;
  for (const param of candidates) {
    const id = c.req.param(param);
    if (!id || id.length === 0) continue;
    const householdId = await householdIdOfResource(param, id);
    if (!householdId) throw ApiError.notFound();
    return householdId;
  }

  throw ApiError.badRequest("server.group.groupIdMissing");
}

/**
 * Membership + role of `userId` in `householdId`, distinguishing "household
 * unknown" from "not a member" in a single query.
 */
export async function resolveMembership(
  householdId: string,
  userId: string,
): Promise<{ exists: boolean; membership?: Membership }> {
  const rows = await db
    .select({ id: households.id, role: householdMembers.role })
    .from(households)
    .leftJoin(
      householdMembers,
      and(eq(householdMembers.householdId, households.id), eq(householdMembers.userId, userId)),
    )
    .where(eq(households.id, householdId))
    .limit(1);

  const row = rows[0];
  if (!row) return { exists: false };
  if (row.role === null) return { exists: true };
  return { exists: true, membership: { householdId, userId, role: toRole(row.role) } };
}

/**
 * Factory: middleware that requires at least `required` in the addressed household.
 * Defaults to "member" so `requireHouseholdRole()` is valid too.
 */
export function requireHouseholdRole(
  required: HouseholdRole = "member",
  options: HouseholdRoleOptions = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = requireUser(c);
    const householdId = await resolveHouseholdId(c, options);
    const access = await resolveMembership(householdId, user.id);

    if (!access.exists) throw ApiError.notFound("server.group.notFound");
    if (!access.membership) throw ApiError.forbidden("server.group.noAccess");

    if (!roleAtLeast(access.membership.role, required)) {
      throw ApiError.forbidden(
        required === "owner" ? "server.group.ownerOnly" : "server.group.adminOnly",
      );
    }

    c.set("membership", access.membership);
    await next();
  };
}

/** Convenience aliases so call sites read like the docs' auth levels. */
export const requireHouseholdMember = (): MiddlewareHandler<AppEnv> => requireHouseholdRole("member");
export const requireHouseholdAdmin = (): MiddlewareHandler<AppEnv> => requireHouseholdRole("admin");
export const requireHouseholdOwner = (): MiddlewareHandler<AppEnv> => requireHouseholdRole("owner");
