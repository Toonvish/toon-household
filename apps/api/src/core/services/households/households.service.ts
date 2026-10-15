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
import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Database } from "../../../db/client.ts";
import { householdMembers, households, users } from "../../../db/schema.ts";
import type { HouseholdRow } from "../../../db/schema.ts";
import { ApiError } from "../../../lib/errors.ts";
import { API_MODULES } from "../../../modules/index.ts";
import type { ApiModule } from "../../../modules/types.ts";
import type { Membership } from "../../../lib/types.ts";
import { normalizeStoredUploadUrl } from "../../../lib/uploadUrls.ts";
import { createPlaceholderUser, isPlaceholderUser } from "../auth/users.ts";
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

/**
 * Deletes a household; members, invites, module rows and every module's household-scoped rows
 * cascade. The users that were PLACEHOLDER members of it go too (ADR 0006, plan m3b decision 3):
 * a placeholder exists only for its household and has no login that could join another one.
 * They are deleted AFTER the household row, whose cascade first removes the module rows that
 * reference them (finance's `payer_id` / `person_id` / seats are `RESTRICT`), and only while
 * they are still placeholders in no other household.
 */
export async function deleteHousehold(db: Database, householdId: string): Promise<void> {
  await loadHouseholdRow(db, householdId);
  await withTransaction(db, async (tx) => {
    const placeholderIds = (
      await tx
        .select({ id: users.id })
        .from(householdMembers)
        .innerJoin(users, eq(users.id, householdMembers.userId))
        .where(and(eq(householdMembers.householdId, householdId), isNull(users.email), isNull(users.passwordHash)))
    ).map((row) => row.id);

    await tx.delete(households).where(eq(households.id, householdId));
    if (placeholderIds.length === 0) return;

    const stillMembers = new Set(
      (
        await tx
          .select({ userId: householdMembers.userId })
          .from(householdMembers)
          .where(inArray(householdMembers.userId, placeholderIds))
      ).map((row) => row.userId),
    );
    const orphans = placeholderIds.filter((id) => !stillMembers.has(id));
    if (orphans.length === 0) return;
    await tx
      .delete(users)
      .where(and(inArray(users.id, orphans), isNull(users.email), isNull(users.passwordHash)));
  });
}

/* -------------------------------------------------------------------------- */
/* placeholder members (ADR 0006)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Adds a PLACEHOLDER member: a person without an account, named by an admin (ADR 0006, plan m3b
 * decision 2; toon-finance `addPlaceholderMember`). The user row and the `member` membership are
 * written in one transaction: a placeholder in no household is an orphan nobody can see or
 * claim. The core has no "household full" rule (D1: N members); a module that seats people
 * (finance) decides its own seats.
 */
export async function addPlaceholderMember(
  db: Database,
  householdId: string,
  displayName: string,
): Promise<HouseholdMember> {
  await loadHouseholdRow(db, householdId);
  const timestamp = nowMs();
  const userId = await withTransaction(db, async (tx) => {
    const user = await createPlaceholderUser(tx, displayName, householdId);
    await tx.insert(householdMembers).values({
      id: crypto.randomUUID(),
      householdId,
      userId: user.id,
      role: "member",
      createdAt: timestamp,
    });
    await tx.update(households).set({ updatedAt: timestamp }).where(eq(households.id, householdId));
    return user.id;
  });
  return getMember(db, householdId, userId);
}

/**
 * True when `userId` is a member of `householdId` AND a placeholder (no e-mail, no password).
 * False for a non-member, so a caller that needs the 404 checks membership first.
 */
export async function isPlaceholderMember(db: DbLike, householdId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .limit(1);
  return row !== undefined && isPlaceholderUser(row);
}

/**
 * Renames a placeholder (`users.name`, ADR 0006 decision 3). A person with an account names
 * themselves (`PATCH /api/auth/me`), so a member with an account is `409 member_has_account`;
 * a non-member is `404`.
 */
export async function renamePlaceholderMember(
  db: DbLike,
  householdId: string,
  userId: string,
  name: string,
): Promise<HouseholdMember> {
  await loadMemberRow(db, householdId, userId);
  if (!(await isPlaceholderMember(db, householdId, userId))) {
    throw ApiError.conflict("member_has_account", "server.household.memberHasAccount");
  }
  await db
    .update(users)
    .set({ name: name.trim(), updatedAt: nowMs() })
    .where(and(eq(users.id, userId), isNull(users.email), isNull(users.passwordHash)));
  return getMember(db, householdId, userId);
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

  // A placeholder keeps `member` (ADR 0006 decision 2): an admin without a login could never
  // act, and an ownership transfer to one would orphan the household.
  if (await isPlaceholderMember(db, householdId, targetUserId)) {
    throw ApiError.conflict("conflict", "server.household.placeholderRole");
  }

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
 *
 * A PLACEHOLDER member (ADR 0006 decision 3) goes the same way, module vetoes included, and
 * then its user row is deleted in the same transaction: there is no account that could join
 * another household later. Its claim invites follow by `ON DELETE cascade`.
 */
export async function removeMember(
  db: Database,
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

  const placeholder = await isPlaceholderMember(db, householdId, targetUserId);

  await withTransaction(db, async (tx) => {
    for (const module of modules) await module.onMemberRemoving?.(householdId, targetUserId, tx);

    await tx
      .delete(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, targetUserId)));
    if (placeholder) {
      await tx
        .delete(users)
        .where(and(eq(users.id, targetUserId), isNull(users.email), isNull(users.passwordHash)));
    }
  });
}
