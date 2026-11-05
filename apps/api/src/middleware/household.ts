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
 *
 * The Effect HTTP layer (docs/EFFECT.md E8; plan `docs/plans/e7-http-api.md` P5): `RequireHouseholdMemberLayer`,
 * `RequireHouseholdAdminLayer` and `RequireHouseholdOwnerLayer` implement the tags of `apps/api/src/http/middleware.ts`
 * (the household from the route's `:householdId`, else its `:inviteId`; they require `CurrentUser` and provide
 * `CurrentMembership`). The Hono section at the end (until E7-T12 deletes it) keeps `requireHouseholdRole` and its
 * aliases: since E2-T12 the lookups are effects over `Database`, run as ONE `runtime.runPromise` before `next()` (plan
 * e2 P12); a refusal fails the effect with the tagged error (same texts, same statuses), which reaches
 * `onErrorHandler` as the rejection. Every exported factory is a hoisted function declaration that reads no
 * imported binding until a request arrives (the routers call them at module scope, inside the import cycle). Both
 * sides share `resolveHouseholdId`, `resolveMembership` and `authorize`.
 */
import type { HouseholdRole } from "@toon/shared";
import { roleAtLeast } from "@toon/shared";
import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import type { HttpApiMiddleware } from "effect/http-api";
import { Database } from "../db/database.ts";
import { householdInvites, householdMembers, households } from "../db/schema.ts";
import { CurrentMembership, CurrentUser, type Membership } from "../http/context.ts";
import {
  type BoundaryFailure,
  RequireHouseholdAdmin,
  RequireHouseholdMember,
  RequireHouseholdOwner,
} from "../http/middleware.ts";
import { BadRequest, type DatabaseError, Forbidden, NotFound } from "../lib/errors.ts";
import { toHouseholdRole } from "../core/services/households/membership.ts";

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

/** Reads one route param of the request (`c.req.param(name)` on the Hono side, the route's params in Effect). */
export type RouteParam = (name: string) => string | undefined;

/** Looks up the owning household of a resource id, or null when it does not exist. */
const householdIdOfResource = Effect.fn("Household.idOfResource")(function* (param: ResourceParam, id: string) {
  const database = yield* Database;
  switch (param) {
    case "inviteId": {
      const rows = yield* database.use((db) =>
        db
          .select({ householdId: householdInvites.householdId })
          .from(householdInvites)
          .where(eq(householdInvites.id, id))
          .limit(1),
      );
      return rows[0]?.householdId ?? null;
    }
  }
});

/**
 * Determines which household the request targets. Fails with 404 when the addressed
 * resource does not exist and 400 when the route carries no usable id at all.
 */
export const resolveHouseholdId = Effect.fn("Household.resolveId")(function* (
  param: RouteParam,
  options: HouseholdRoleOptions = {},
) {
  if (!options.via) {
    const direct = param("householdId");
    if (direct && direct.length > 0) return direct;
  }

  const candidates: readonly ResourceParam[] = options.via ? [options.via] : RESOURCE_PARAMS;
  for (const name of candidates) {
    const id = param(name);
    if (!id || id.length === 0) continue;
    const householdId = yield* householdIdOfResource(name, id);
    if (!householdId) return yield* new NotFound();
    return householdId;
  }

  return yield* new BadRequest({ text: "server.group.groupIdMissing" });
});

/** The outcome of the membership lookup: household unknown, known but not a member, or a member with a role. */
export interface MembershipAccess {
  exists: boolean;
  membership?: Membership;
}

/**
 * Membership + role of `userId` in `householdId`, distinguishing "household
 * unknown" from "not a member" in a single query.
 */
export const resolveMembership = Effect.fn("Household.resolveMembership")(function* (
  householdId: string,
  userId: string,
): Effect.fn.Return<MembershipAccess, DatabaseError, Database> {
  const database = yield* Database;
  const rows = yield* database.use((db) =>
    db
      .select({ id: households.id, role: householdMembers.role })
      .from(households)
      .leftJoin(
        householdMembers,
        and(eq(householdMembers.householdId, households.id), eq(householdMembers.userId, userId)),
      )
      .where(eq(households.id, householdId))
      .limit(1),
  );

  const row = rows[0];
  if (!row) return { exists: false };
  if (row.role === null) return { exists: true };
  return { exists: true, membership: { householdId, userId, role: toHouseholdRole(row.role) } };
});

/** The 404 / 403 / role ladder of a request for the user `userId`: the membership, or the refusal. */
export const authorize = Effect.fn("Household.authorize")(function* (
  userId: string,
  param: RouteParam,
  required: HouseholdRole,
  options: HouseholdRoleOptions,
) {
  const householdId = yield* resolveHouseholdId(param, options);
  const access = yield* resolveMembership(householdId, userId);

  if (!access.exists) return yield* new NotFound({ text: "server.group.notFound" });
  if (!access.membership) return yield* new Forbidden({ text: "server.group.noAccess" });

  if (!roleAtLeast(access.membership.role, required)) {
    return yield* new Forbidden({
      text: required === "owner" ? "server.group.ownerOnly" : "server.group.adminOnly",
    });
  }

  return access.membership;
});

/** The service of the three household tags (they differ in the role they require only). */
type HouseholdMiddleware = HttpApiMiddleware.HttpApiMiddleware<CurrentMembership, typeof BoundaryFailure, CurrentUser>;

/**
 * The middleware requiring at least `required` in the household of the route (`authorize` with the route's params
 * and the signed-in user), providing the membership to everything behind it. Built once per layer, with the
 * `Database` of the layer.
 */
const householdMiddleware = Effect.fnUntraced(function* (
  required: HouseholdRole,
): Effect.fn.Return<HouseholdMiddleware, never, Database> {
  const database = yield* Database;
  return Effect.fn("Household.middleware")(function* (httpEffect) {
    const user = yield* CurrentUser;
    const params = yield* HttpRouter.params;
    const membership = yield* Effect.provideService(
      authorize(user.id, (name) => params[name], required, {}),
      Database,
      database,
    );
    return yield* Effect.provideService(httpEffect, CurrentMembership, membership);
  });
});

/** `RequireHouseholdMember` (P5): `requireHouseholdRole("member")`. */
export const RequireHouseholdMemberLayer = Layer.effect(
  RequireHouseholdMember,
  Effect.gen(function* () {
    return RequireHouseholdMember.of(yield* householdMiddleware("member"));
  }),
);

/** `RequireHouseholdAdmin` (P5): `requireHouseholdRole("admin")`. */
export const RequireHouseholdAdminLayer = Layer.effect(
  RequireHouseholdAdmin,
  Effect.gen(function* () {
    return RequireHouseholdAdmin.of(yield* householdMiddleware("admin"));
  }),
);

/** `RequireHouseholdOwner` (P5): `requireHouseholdRole("owner")`. */
export const RequireHouseholdOwnerLayer = Layer.effect(
  RequireHouseholdOwner,
  Effect.gen(function* () {
    return RequireHouseholdOwner.of(yield* householdMiddleware("owner"));
  }),
);

/* Hono (E7 transition): E7-T12 deletes this section */
import type { MiddlewareHandler } from "hono";
import type { AppContext, AppEnv } from "../lib/types.ts";
import { currentUser } from "../lib/types.ts";
import { runtime } from "../runtime.ts";

/** `authorize` for the Hono request `c`: sets `membership` on `c` or fails with the refusal. */
const authorizeOn = Effect.fn("Household.authorizeOn")(function* (
  c: AppContext,
  required: HouseholdRole,
  options: HouseholdRoleOptions,
) {
  const user = yield* currentUser(c);
  c.set("membership", yield* authorize(user.id, (name) => c.req.param(name), required, options));
});

/**
 * Factory: middleware that requires at least `required` in the addressed household.
 * Defaults to "member" so `requireHouseholdRole()` is valid too.
 */
export function requireHouseholdRole(
  required: HouseholdRole = "member",
  options: HouseholdRoleOptions = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await runtime.runPromise(authorizeOn(c, required, options));
    await next();
  };
}

/** Convenience aliases so call sites read like the docs' auth levels. */
export function requireHouseholdMember(): MiddlewareHandler<AppEnv> {
  return requireHouseholdRole("member");
}
export function requireHouseholdAdmin(): MiddlewareHandler<AppEnv> {
  return requireHouseholdRole("admin");
}
export function requireHouseholdOwner(): MiddlewareHandler<AppEnv> {
  return requireHouseholdRole("owner");
}
