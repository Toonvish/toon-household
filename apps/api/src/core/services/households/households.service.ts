/**
 * Households + memberships.
 *
 * Every function takes the drizzle handle explicitly so it can run inside a
 * transaction and so tests can point it at an isolated in-memory database.
 * List endpoints never do N+1 queries: children/counts are fetched with a
 * single `inArray` query and joined in memory.
 */
import type {
  CreateHouseholdRequest,
  HouseholdMember,
  HouseholdRole,
  HouseholdWithRole,
  UpdateHouseholdRequest,
} from "@toon/shared";
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import type { Database } from "../../../db/client.ts";
import { householdMembers, households, users } from "../../../db/schema.ts";
import type { HouseholdRow } from "../../../db/schema.ts";
import { ApiError } from "../../../lib/errors.ts";
import { API_MODULES } from "../../../modules/index.ts";
import type { ApiModule } from "../../../modules/types.ts";
import type { Membership } from "../../../lib/types.ts";
import { normalizeStoredUploadUrl } from "../../../lib/uploadUrls.ts";
import { toHouseholdMember, toHouseholdWithRole } from "./mappers.ts";
import { assertRole, countOwners, toHouseholdRole } from "./membership.ts";
import { enabledModulesFor, initializeHousehold } from "./modules.ts";
import { type DbLike, eqFolded, nowMs, toCountMap, withTransaction } from "./support.ts";

/* -------------------------------------------------------------------------- */
/* counts                                                                     */
/* -------------------------------------------------------------------------- */

/** memberCount per household — ONE grouped query for the whole page. */
async function memberCounts(db: DbLike, householdIds: readonly string[]): Promise<Map<string, number>> {
  if (householdIds.length === 0) return new Map();
  const rows = await db
    .select({ key: householdMembers.householdId, value: count() })
    .from(householdMembers)
    .where(inArray(householdMembers.householdId, [...householdIds]))
    .groupBy(householdMembers.householdId);
  return toCountMap(rows);
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

/** All households the user belongs to, with their own role, member count and enabled modules. */
export async function listHouseholdsForUser(db: DbLike, userId: string): Promise<HouseholdWithRole[]> {
  const rows = await db
    .select({ household: households, role: householdMembers.role })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.userId, userId))
    .orderBy(asc(households.name), asc(households.createdAt));

  const ids = rows.map((row) => row.household.id);
  const [members, modules] = await Promise.all([memberCounts(db, ids), enabledModulesFor(db, ids)]);

  return rows.map((row) =>
    toHouseholdWithRole(
      row.household,
      toHouseholdRole(row.role),
      members.get(row.household.id) ?? 0,
      modules.get(row.household.id) ?? [],
    ),
  );
}

/** The raw household row or a 404. */
export async function loadHouseholdRow(db: DbLike, householdId: string): Promise<HouseholdRow> {
  const [row] = await db.select().from(households).where(eq(households.id, householdId)).limit(1);
  if (!row) throw ApiError.notFound("server.group.notFound");
  return row;
}

/** A single household in the `HouseholdWithRole` shape used by every household response. */
export async function getHouseholdWithRole(
  db: DbLike,
  householdId: string,
  role: HouseholdRole,
): Promise<HouseholdWithRole> {
  const row = await loadHouseholdRow(db, householdId);
  const [members, modules] = await Promise.all([
    memberCounts(db, [householdId]),
    enabledModulesFor(db, [householdId]),
  ]);
  return toHouseholdWithRole(row, role, members.get(householdId) ?? 0, modules.get(householdId) ?? []);
}

/** Members of a household incl. their public user record — ONE joined query. */
export async function listMembers(db: DbLike, householdId: string): Promise<HouseholdMember[]> {
  const rows = await db
    .select({ member: householdMembers, user: users })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(asc(householdMembers.createdAt), asc(users.name));
  return rows.map((row) => toHouseholdMember(row.member, row.user));
}

/** The membership row of one user, mapped to the contract shape (404 if none). */
export async function getMember(
  db: DbLike,
  householdId: string,
  userId: string,
): Promise<HouseholdMember> {
  const [row] = await db
    .select({ member: householdMembers, user: users })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .limit(1);
  if (!row) throw ApiError.notFound("server.group.memberNotFound");
  return toHouseholdMember(row.member, row.user);
}

/**
 * The raw membership row, for the role checks that need it before they can decide
 * what to do — {@link getMember} joins the user and builds the wire shape, which
 * those callers would only throw away.
 *
 * @throws ApiError 404 `member_not_found`.
 */
async function loadMemberRow(db: DbLike, householdId: string, userId: string) {
  const [row] = await db
    .select()
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .limit(1);
  if (!row) throw ApiError.notFound("server.group.memberNotFound");
  return row;
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Creates a household, makes the caller its owner and points
 * `users.active_household_id` at it — all inside one transaction. The owner's
 * membership is written first, then `initializeHousehold` writes the default module
 * rows and runs the build modules' `onHouseholdCreated` hooks (SPEC D2).
 */
export async function createHousehold(
  db: Database,
  userId: string,
  input: CreateHouseholdRequest,
): Promise<HouseholdWithRole> {
  const duplicate = await db
    .select({ id: households.id })
    .from(households)
    .innerJoin(householdMembers, eq(householdMembers.householdId, households.id))
    .where(and(eq(householdMembers.userId, userId), eqFolded(households.name, input.name)))
    .limit(1);
  if (duplicate.length > 0) {
    throw ApiError.conflict("group_name_taken", "server.group.nameTaken");
  }

  const id = crypto.randomUUID();
  const timestamp = nowMs();

  await withTransaction(db, async (tx) => {
    await tx.insert(households).values({
      id,
      name: input.name,
      description: input.description ?? null,
      createdBy: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await tx.insert(householdMembers).values({
      id: crypto.randomUUID(),
      householdId: id,
      userId,
      role: "owner",
      createdAt: timestamp,
    });
    await initializeHousehold(tx, id);
    await tx
      .update(users)
      .set({ activeHouseholdId: id, updatedAt: timestamp })
      .where(eq(users.id, userId));
  });

  return getHouseholdWithRole(db, id, "owner");
}

/** Renames/re-describes a household (admin+ enforced by the route middleware). */
export async function updateHousehold(
  db: DbLike,
  householdId: string,
  role: HouseholdRole,
  input: UpdateHouseholdRequest,
): Promise<HouseholdWithRole> {
  await loadHouseholdRow(db, householdId);

  const patch: Partial<typeof households.$inferInsert> = { updatedAt: nowMs() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description ?? null;
  // Bare `/uploads/<file>`, never the signed wire value (lib/uploadUrls.ts).
  if (input.imageUrl !== undefined) patch.imageUrl = normalizeStoredUploadUrl(input.imageUrl) ?? null;

  await db.update(households).set(patch).where(eq(households.id, householdId));
  return getHouseholdWithRole(db, householdId, role);
}

/** Deletes a household; members, invites, module rows and every module's household-scoped rows cascade. */
export async function deleteHousehold(db: DbLike, householdId: string): Promise<void> {
  await loadHouseholdRow(db, householdId);
  await db.delete(households).where(eq(households.id, householdId));
}

/**
 * Changes a member's role.
 * - only an owner may grant `owner`; the previous owner is demoted to `admin`
 *   in the same transaction (ownership transfer)
 * - only an owner may change the role of another owner
 * - the last owner can never lose the role -> 409 `last_owner`
 */
export async function updateMemberRole(
  db: Database,
  actor: Membership,
  targetUserId: string,
  nextRole: HouseholdRole,
): Promise<HouseholdMember> {
  const { householdId } = actor;
  const target = await loadMemberRow(db, householdId, targetUserId);

  const currentRole = toHouseholdRole(target.role);
  if (currentRole === nextRole) return getMember(db, householdId, targetUserId);

  if (nextRole === "owner" || currentRole === "owner") assertRole(actor, "owner");

  if (currentRole === "owner" && (await countOwners(db, householdId)) <= 1) {
    throw ApiError.conflict("last_owner", "server.group.lastOwner");
  }

  const timestamp = nowMs();
  await withTransaction(db, async (tx) => {
    if (nextRole === "owner") {
      // Exactly one owner per household: demote every current owner first.
      await tx
        .update(householdMembers)
        .set({ role: "admin" })
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            eq(householdMembers.role, "owner"),
            ne(householdMembers.userId, targetUserId),
          ),
        );
    }
    await tx
      .update(householdMembers)
      .set({ role: nextRole })
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, targetUserId)));
    await tx.update(households).set({ updatedAt: timestamp }).where(eq(households.id, householdId));
  });

  return getMember(db, householdId, targetUserId);
}

/**
 * Removes a member (admin+) or lets a member leave the household themselves.
 * Admins may not remove someone above their own rank, and the last owner
 * cannot leave -> 409 `last_owner`. Every build module's `onMemberRemoving` hook runs
 * first and may veto (finance: 409 `member_has_ledger` while the ledger has rows, SPEC D13);
 * a veto deletes nothing.
 */
export async function removeMember(
  db: DbLike,
  actor: Membership,
  targetUserId: string,
  modules: readonly ApiModule[] = API_MODULES,
): Promise<void> {
  const { householdId } = actor;
  const target = await loadMemberRow(db, householdId, targetUserId);

  const targetRole = toHouseholdRole(target.role);
  const isSelf = actor.userId === targetUserId;

  if (!isSelf) {
    assertRole(actor, "admin");
    if (targetRole === "owner") assertRole(actor, "owner");
  }

  if (targetRole === "owner" && (await countOwners(db, householdId)) <= 1) {
    throw ApiError.conflict(
      "last_owner",
      isSelf ? "server.group.transferOwnershipFirst" : "server.group.lastOwner",
    );
  }

  for (const module of modules) await module.onMemberRemoving?.(householdId, targetUserId, db);

  await db
    .delete(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, targetUserId)));
}
