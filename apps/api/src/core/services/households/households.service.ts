/**
 * Households + memberships.
 *
 * The `Households` service (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P2, P7, P11) reads the
 * current executor of `Database` on every call, so an open transaction reaches it, and takes every timestamp from
 * the `Clock`. `createHousehold`,
 * `addPlaceholderMember`, `updateMemberRole`, `deleteHousehold` and `removeMember` run their writes in
 * `database.transaction`; `removeMember` runs every module's `onMemberRemoving` veto first, inside that transaction.
 *
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
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../db/database.ts";
import { householdMembers, households, users } from "../../../db/schema.ts";
import type { HouseholdRow } from "../../../db/schema.ts";
import { Conflict, type DatabaseError, type Forbidden, NotFound } from "../../../lib/errors.ts";
import type { Membership } from "../../../lib/types.ts";
import { normalizeStoredUploadUrl } from "../../../lib/uploadUrls.ts";
import { API_MODULES } from "../../../modules/index.ts";
import type { ApiModule, HookError } from "../../../modules/types.ts";
import { Users, isPlaceholderUser } from "../auth/users.ts";
import { toHouseholdMember, toHouseholdWithRole } from "./mappers.ts";
import { checkRole, toHouseholdRole } from "./membership.ts";
import { HouseholdModules } from "./modules.ts";
import { eqFolded, toCountMap } from "./support.ts";

/** Households and their members: reads, creation, the placeholder members and the role and membership changes. */
export class Households extends Context.Service<
  Households,
  {
    /** All households the user belongs to, with their own role, member count and enabled modules. */
    readonly listHouseholdsForUser: (userId: string) => Effect.Effect<HouseholdWithRole[], DatabaseError>;
    /** The raw household row or a 404. */
    readonly loadHouseholdRow: (householdId: string) => Effect.Effect<HouseholdRow, NotFound | DatabaseError>;
    /** A single household in the `HouseholdWithRole` shape used by every household response. */
    readonly getHouseholdWithRole: (
      householdId: string,
      role: HouseholdRole,
    ) => Effect.Effect<HouseholdWithRole, NotFound | DatabaseError>;
    /** Members of a household incl. their public user record — ONE joined query. */
    readonly listMembers: (householdId: string) => Effect.Effect<HouseholdMember[], DatabaseError>;
    /** The membership row of one user, mapped to the contract shape (404 if none). */
    readonly getMember: (householdId: string, userId: string) => Effect.Effect<HouseholdMember, NotFound | DatabaseError>;
    /** Number of owners in a household — the guard behind the `last_owner` conflict. */
    readonly countOwners: (householdId: string) => Effect.Effect<number, DatabaseError>;
    /**
     * Creates a household, makes the caller its owner and points
     * `users.active_household_id` at it — all inside one transaction. The owner's
     * membership is written first, then `initializeHousehold` writes the default module
     * rows and runs the build modules' `onHouseholdCreated` hooks (SPEC D2).
     */
    readonly createHousehold: (
      userId: string,
      input: CreateHouseholdRequest,
    ) => Effect.Effect<HouseholdWithRole, Conflict | NotFound | HookError>;
    /** Renames/re-describes a household (admin+ enforced by the route middleware). */
    readonly updateHousehold: (
      householdId: string,
      role: HouseholdRole,
      input: UpdateHouseholdRequest,
    ) => Effect.Effect<HouseholdWithRole, NotFound | DatabaseError>;
    /**
     * Deletes a household; members, invites, module rows and every module's household-scoped rows
     * cascade. The users that were PLACEHOLDER members of it go too (ADR 0006, plan m3b decision 3):
     * a placeholder exists only for its household and has no login that could join another one.
     * They are deleted AFTER the household row, whose cascade first removes the module rows that
     * reference them (finance's `payer_id` / `person_id` / seats are `RESTRICT`), and only while
     * they are still placeholders in no other household.
     */
    readonly deleteHousehold: (householdId: string) => Effect.Effect<void, NotFound | DatabaseError>;
    /**
     * Adds a PLACEHOLDER member: a person without an account, named by an admin (ADR 0006, plan m3b
     * decision 2; toon-finance `addPlaceholderMember`). The user row and the `member` membership are
     * written in one transaction: a placeholder in no household is an orphan nobody can see or
     * claim. The core has no "household full" rule (D1: N members); a module that seats people
     * (finance) decides its own seats.
     */
    readonly addPlaceholderMember: (
      householdId: string,
      displayName: string,
    ) => Effect.Effect<HouseholdMember, NotFound | DatabaseError>;
    /**
     * True when `userId` is a member of `householdId` AND a placeholder (no e-mail, no password).
     * False for a non-member, so a caller that needs the 404 checks membership first.
     */
    readonly isPlaceholderMember: (householdId: string, userId: string) => Effect.Effect<boolean, DatabaseError>;
    /**
     * Renames a placeholder (`users.name`, ADR 0006 decision 3). A person with an account names
     * themselves (`PATCH /api/auth/me`), so a member with an account is `409 member_has_account`;
     * a non-member is `404`.
     */
    readonly renamePlaceholderMember: (
      householdId: string,
      userId: string,
      name: string,
    ) => Effect.Effect<HouseholdMember, Conflict | NotFound | DatabaseError>;
    /**
     * Changes a member's role.
     * - only an owner may grant `owner`; the previous owner is demoted to `admin`
     *   in the same transaction (ownership transfer)
     * - only an owner may change the role of another owner
     * - the last owner can never lose the role -> 409 `last_owner`
     */
    readonly updateMemberRole: (
      actor: Membership,
      targetUserId: string,
      nextRole: HouseholdRole,
    ) => Effect.Effect<HouseholdMember, Conflict | Forbidden | NotFound | DatabaseError>;
    /**
     * Removes a member (admin+) or lets a member leave the household themselves.
     * Admins may not remove someone above their own rank, and the last owner
     * cannot leave -> 409 `last_owner`. Every build module's `onMemberRemoving` hook runs
     * first, inside the transaction, and may veto (finance: 409 `member_has_ledger` while the ledger
     * has rows, SPEC D13); a veto deletes nothing.
     *
     * A PLACEHOLDER member (ADR 0006 decision 3) goes the same way, module vetoes included, and
     * then its user row is deleted in the same transaction: there is no account that could join
     * another household later. Its claim invites follow by `ON DELETE cascade`.
     */
    readonly removeMember: (
      actor: Membership,
      targetUserId: string,
      modules?: readonly ApiModule[],
    ) => Effect.Effect<void, Conflict | Forbidden | NotFound | HookError>;
  }
>()("toon/api/core/services/households/households.service/Households") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const householdModules = yield* HouseholdModules;
      const usersService = yield* Users;

      /** memberCount per household — ONE grouped query for the whole page. */
      const memberCounts = Effect.fnUntraced(function* (householdIds: readonly string[]) {
        if (householdIds.length === 0) return new Map<string, number>();
        const rows = yield* database.use((db) =>
          db
            .select({ key: householdMembers.householdId, value: count() })
            .from(householdMembers)
            .where(inArray(householdMembers.householdId, [...householdIds]))
            .groupBy(householdMembers.householdId),
        );
        return toCountMap(rows);
      });

      const listHouseholdsForUser = Effect.fn("Households.listHouseholdsForUser")(function* (userId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ household: households, role: householdMembers.role })
            .from(householdMembers)
            .innerJoin(households, eq(households.id, householdMembers.householdId))
            .where(eq(householdMembers.userId, userId))
            .orderBy(asc(households.name), asc(households.createdAt)),
        );

        const ids = rows.map((row) => row.household.id);
        const [members, modules] = yield* Effect.all([memberCounts(ids), householdModules.enabledModulesFor(ids)], {
          concurrency: "unbounded",
        });

        return rows.map((row) =>
          toHouseholdWithRole(
            row.household,
            toHouseholdRole(row.role),
            members.get(row.household.id) ?? 0,
            modules.get(row.household.id) ?? [],
          ),
        );
      });

      const loadHouseholdRow = Effect.fn("Households.loadHouseholdRow")(function* (householdId: string) {
        const [row] = yield* database.use((db) =>
          db.select().from(households).where(eq(households.id, householdId)).limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.group.notFound" });
        return row;
      });

      const getHouseholdWithRole = Effect.fn("Households.getHouseholdWithRole")(function* (
        householdId: string,
        role: HouseholdRole,
      ) {
        const row = yield* loadHouseholdRow(householdId);
        const [members, modules] = yield* Effect.all(
          [memberCounts([householdId]), householdModules.enabledModulesFor([householdId])],
          { concurrency: "unbounded" },
        );
        return toHouseholdWithRole(row, role, members.get(householdId) ?? 0, modules.get(householdId) ?? []);
      });

      const listMembers = Effect.fn("Households.listMembers")(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ member: householdMembers, user: users })
            .from(householdMembers)
            .innerJoin(users, eq(users.id, householdMembers.userId))
            .where(eq(householdMembers.householdId, householdId))
            .orderBy(asc(householdMembers.createdAt), asc(users.name)),
        );
        return rows.map((row) => toHouseholdMember(row.member, row.user));
      });

      const getMember = Effect.fn("Households.getMember")(function* (householdId: string, userId: string) {
        const [row] = yield* database.use((db) =>
          db
            .select({ member: householdMembers, user: users })
            .from(householdMembers)
            .innerJoin(users, eq(users.id, householdMembers.userId))
            .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
            .limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.group.memberNotFound" });
        return toHouseholdMember(row.member, row.user);
      });

      /**
       * The raw membership row, for the role checks that need it before they can decide
       * what to do — `getMember` joins the user and builds the wire shape, which
       * those callers would only throw away. Fails with 404 `member_not_found`.
       */
      const loadMemberRow = Effect.fnUntraced(function* (householdId: string, userId: string) {
        const [row] = yield* database.use((db) =>
          db
            .select()
            .from(householdMembers)
            .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
            .limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.group.memberNotFound" });
        return row;
      });

      const countOwners = Effect.fn("Households.countOwners")(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ userId: householdMembers.userId })
            .from(householdMembers)
            .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.role, "owner"))),
        );
        return rows.length;
      });

      const isPlaceholderMember = Effect.fn("Households.isPlaceholderMember")(function* (
        householdId: string,
        userId: string,
      ) {
        const [row] = yield* database.use((db) =>
          db
            .select({ email: users.email, passwordHash: users.passwordHash })
            .from(householdMembers)
            .innerJoin(users, eq(users.id, householdMembers.userId))
            .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
            .limit(1),
        );
        return row !== undefined && isPlaceholderUser(row);
      });

      const createHousehold = Effect.fn("Households.createHousehold")(function* (
        userId: string,
        input: CreateHouseholdRequest,
      ) {
        const duplicate = yield* database.use((db) =>
          db
            .select({ id: households.id })
            .from(households)
            .innerJoin(householdMembers, eq(householdMembers.householdId, households.id))
            .where(and(eq(householdMembers.userId, userId), eqFolded(households.name, input.name)))
            .limit(1),
        );
        if (duplicate.length > 0) {
          return yield* new Conflict({ code: "group_name_taken", text: "server.group.nameTaken" });
        }

        const id = crypto.randomUUID();
        const timestamp = yield* Clock.currentTimeMillis;

        yield* database.transaction(
          Effect.gen(function* () {
            yield* database.use((tx) =>
              tx.insert(households).values({
                id,
                name: input.name,
                description: input.description ?? null,
                createdBy: userId,
                createdAt: timestamp,
                updatedAt: timestamp,
              }),
            );
            yield* database.use((tx) =>
              tx.insert(householdMembers).values({
                id: crypto.randomUUID(),
                householdId: id,
                userId,
                role: "owner",
                createdAt: timestamp,
              }),
            );
            // The default module rows + the build modules' hooks run on the open transaction.
            yield* householdModules.initializeHousehold(id);
            yield* database.use((tx) =>
              tx.update(users).set({ activeHouseholdId: id, updatedAt: timestamp }).where(eq(users.id, userId)),
            );
          }),
        );

        return yield* getHouseholdWithRole(id, "owner");
      });

      const updateHousehold = Effect.fn("Households.updateHousehold")(function* (
        householdId: string,
        role: HouseholdRole,
        input: UpdateHouseholdRequest,
      ) {
        yield* loadHouseholdRow(householdId);

        const patch: Partial<typeof households.$inferInsert> = { updatedAt: yield* Clock.currentTimeMillis };
        if (input.name !== undefined) patch.name = input.name;
        if (input.description !== undefined) patch.description = input.description ?? null;
        // Bare `/uploads/<file>`, never the signed wire value (lib/uploadUrls.ts).
        if (input.imageUrl !== undefined) patch.imageUrl = normalizeStoredUploadUrl(input.imageUrl) ?? null;

        yield* database.use((db) => db.update(households).set(patch).where(eq(households.id, householdId)));
        return yield* getHouseholdWithRole(householdId, role);
      });

      const deleteHousehold = Effect.fn("Households.deleteHousehold")(function* (householdId: string) {
        yield* loadHouseholdRow(householdId);
        yield* database.transaction(
          Effect.gen(function* () {
            const placeholderIds = (yield* database.use((tx) =>
              tx
                .select({ id: users.id })
                .from(householdMembers)
                .innerJoin(users, eq(users.id, householdMembers.userId))
                .where(
                  and(eq(householdMembers.householdId, householdId), isNull(users.email), isNull(users.passwordHash)),
                ),
            )).map((row) => row.id);

            yield* database.use((tx) => tx.delete(households).where(eq(households.id, householdId)));
            if (placeholderIds.length === 0) return;

            const stillMembers = new Set(
              (yield* database.use((tx) =>
                tx
                  .select({ userId: householdMembers.userId })
                  .from(householdMembers)
                  .where(inArray(householdMembers.userId, placeholderIds)),
              )).map((row) => row.userId),
            );
            const orphans = placeholderIds.filter((id) => !stillMembers.has(id));
            if (orphans.length === 0) return;
            yield* database.use((tx) =>
              tx.delete(users).where(and(inArray(users.id, orphans), isNull(users.email), isNull(users.passwordHash))),
            );
          }),
        );
      });

      const addPlaceholderMember = Effect.fn("Households.addPlaceholderMember")(function* (
        householdId: string,
        displayName: string,
      ) {
        yield* loadHouseholdRow(householdId);
        const timestamp = yield* Clock.currentTimeMillis;
        const userId = yield* database.transaction(
          Effect.gen(function* () {
            const user = yield* usersService.createPlaceholderUser(displayName, householdId);
            yield* database.use((tx) =>
              tx.insert(householdMembers).values({
                id: crypto.randomUUID(),
                householdId,
                userId: user.id,
                role: "member",
                createdAt: timestamp,
              }),
            );
            yield* database.use((tx) =>
              tx.update(households).set({ updatedAt: timestamp }).where(eq(households.id, householdId)),
            );
            return user.id;
          }),
        );
        return yield* getMember(householdId, userId);
      });

      const renamePlaceholderMember = Effect.fn("Households.renamePlaceholderMember")(function* (
        householdId: string,
        userId: string,
        name: string,
      ) {
        yield* loadMemberRow(householdId, userId);
        if (!(yield* isPlaceholderMember(householdId, userId))) {
          return yield* new Conflict({ code: "member_has_account", text: "server.household.memberHasAccount" });
        }
        const updatedAt = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db
            .update(users)
            .set({ name: name.trim(), updatedAt })
            .where(and(eq(users.id, userId), isNull(users.email), isNull(users.passwordHash))),
        );
        return yield* getMember(householdId, userId);
      });

      const updateMemberRole = Effect.fn("Households.updateMemberRole")(function* (
        actor: Membership,
        targetUserId: string,
        nextRole: HouseholdRole,
      ) {
        const { householdId } = actor;
        const target = yield* loadMemberRow(householdId, targetUserId);

        const currentRole = toHouseholdRole(target.role);
        if (currentRole === nextRole) return yield* getMember(householdId, targetUserId);

        if (nextRole === "owner" || currentRole === "owner") yield* checkRole(actor, "owner");

        // A placeholder keeps `member` (ADR 0006 decision 2): an admin without a login could never
        // act, and an ownership transfer to one would orphan the household.
        if (yield* isPlaceholderMember(householdId, targetUserId)) {
          return yield* new Conflict({ code: "conflict", text: "server.household.placeholderRole" });
        }

        if (currentRole === "owner" && (yield* countOwners(householdId)) <= 1) {
          return yield* new Conflict({ code: "last_owner", text: "server.group.lastOwner" });
        }

        const timestamp = yield* Clock.currentTimeMillis;
        yield* database.transaction(
          Effect.gen(function* () {
            if (nextRole === "owner") {
              // Exactly one owner per household: demote every current owner first.
              yield* database.use((tx) =>
                tx
                  .update(householdMembers)
                  .set({ role: "admin" })
                  .where(
                    and(
                      eq(householdMembers.householdId, householdId),
                      eq(householdMembers.role, "owner"),
                      ne(householdMembers.userId, targetUserId),
                    ),
                  ),
              );
            }
            yield* database.use((tx) =>
              tx
                .update(householdMembers)
                .set({ role: nextRole })
                .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, targetUserId))),
            );
            yield* database.use((tx) =>
              tx.update(households).set({ updatedAt: timestamp }).where(eq(households.id, householdId)),
            );
          }),
        );

        return yield* getMember(householdId, targetUserId);
      });

      const removeMember = Effect.fn("Households.removeMember")(function* (
        actor: Membership,
        targetUserId: string,
        modules: readonly ApiModule[] = API_MODULES,
      ) {
        const { householdId } = actor;
        const target = yield* loadMemberRow(householdId, targetUserId);

        const targetRole = toHouseholdRole(target.role);
        const isSelf = actor.userId === targetUserId;

        if (!isSelf) {
          yield* checkRole(actor, "admin");
          if (targetRole === "owner") yield* checkRole(actor, "owner");
        }

        if (targetRole === "owner" && (yield* countOwners(householdId)) <= 1) {
          return yield* new Conflict({
            code: "last_owner",
            text: isSelf ? "server.group.transferOwnershipFirst" : "server.group.lastOwner",
          });
        }

        const placeholder = yield* isPlaceholderMember(householdId, targetUserId);

        yield* database.transaction(
          Effect.gen(function* () {
            // The hooks run first, on the open transaction (plan e2 P11); a refusal fails with the hook's own error
            // and rolls the transaction back before anything below is written.
            for (const module of modules) {
              if (module.onMemberRemoving) {
                yield* module.onMemberRemoving(householdId, targetUserId).pipe(Effect.provideService(Database, database));
              }
            }

            yield* database.use((tx) =>
              tx
                .delete(householdMembers)
                .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, targetUserId))),
            );
            if (placeholder) {
              yield* database.use((tx) =>
                tx.delete(users).where(and(eq(users.id, targetUserId), isNull(users.email), isNull(users.passwordHash))),
              );
            }
          }),
        );
      });

      return Households.of({
        listHouseholdsForUser,
        loadHouseholdRow,
        getHouseholdWithRole,
        listMembers,
        getMember,
        countOwners,
        createHousehold,
        updateHousehold,
        deleteHousehold,
        addPlaceholderMember,
        isPlaceholderMember,
        renamePlaceholderMember,
        updateMemberRole,
        removeMember,
      });
    }),
  );
}
