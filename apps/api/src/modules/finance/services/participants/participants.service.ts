/**
 * Finance participants: the two household members who keep the household budget,
 * seated in slot 1 and slot 2 of `finance_participants` (SPEC D3, plan M3 decision 4).
 *
 * Replaces toon-finance's `services/households/members.service.ts` with the same
 * names for what the ledger uses (`otherMemberId`, `requireOtherMemberId`,
 * `slot1UserId`, F's bodies over `finance_participants`). In toon-finance the two slots
 * WERE the household; here a household has any number of core members
 * (`household_members`) and finance seats two of them, chosen by an owner/admin
 * (`assignParticipants`, used by the enable hook and by PUT …/finance/participants).
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e4-finance-services.md` P1, P2, P6, P7, P10). `FinanceParticipants`
 * keeps every old function name with the leading `db` parameter dropped; it reads the current executor of `Database` on
 * every call, takes every timestamp from the module clock (`financeTimeMillis`: the `setClockForTest` override, else the
 * `Clock`), and refuses with the API error family (same status, code, text and details as before).
 */
import type { FinanceParticipantResponse } from "@toon/shared";
import { DEFAULT_LOCALE, serverText } from "@toon/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { householdMembers, users } from "../../../../db/schema.ts";
import { isPlaceholderUser, isUniqueViolation } from "../../../../core/services/auth/users.ts";
import { ApiFailure, Conflict, Forbidden, Internal, NotFound, ValidationFailed } from "../../../../lib/errors.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { toIso } from "../../../../lib/http.ts";
import { financeTimeMillis } from "../../lib/clock.ts";
import {
  financeFixedCostPlans,
  financeIncomes,
  financeParticipants,
  financeTransactions,
} from "../../schema.ts";

/** One seat of an assignment: who sits in which slot. */
export interface ParticipantAssignmentEntry {
  userId: string;
  memberSlot: number;
}

/** Longest display name (F `DisplayNameSchema`, 1–80 characters). */
const DISPLAY_NAME_MAX = 80;

/** What `assignParticipants` and `saveParticipants` refuse with. */
type AssignmentError = ApiFailure | ValidationFailed | Conflict | DatabaseError;

function asSlot(value: number): 1 | 2 {
  return value === 2 ? 2 : 1;
}

function participantsRequired(): ApiFailure {
  return new ApiFailure({
    status: 422,
    code: "finance_participants_required",
    text: "server.finance.participantsRequired",
  });
}

function participantInUse(): Conflict {
  return new Conflict({ code: "finance_participant_in_use", text: "server.finance.participantInUse" });
}

function toParticipantResponse(
  participant: { memberSlot: number; displayName: string; joinedAt: number },
  user: { id: string; name: string; email: string | null; passwordHash: string | null },
): FinanceParticipantResponse {
  return {
    userId: user.id,
    displayName: participant.displayName,
    memberSlot: asSlot(participant.memberSlot),
    name: user.name,
    // NULL for a placeholder seat (ADR 0006): there is no account behind it yet.
    email: user.email,
    hasAccount: !isPlaceholderUser(user),
    joinedAt: toIso(participant.joinedAt),
  };
}

/** The finance participants of a household: who sits where, who is the other person, who may leave. */
export class FinanceParticipants extends Context.Service<
  FinanceParticipants,
  {
    /** The participants of a household incl. their public user record: ONE joined query, by slot. */
    readonly listParticipants: (
      householdId: string,
    ) => Effect.Effect<FinanceParticipantResponse[], DatabaseError>;
    /** The participant row of one user, mapped to the contract shape (404 if none). */
    readonly getParticipant: (
      householdId: string,
      userId: string,
    ) => Effect.Effect<FinanceParticipantResponse, NotFound | DatabaseError>;
    /** The slot `userId` holds in the household's budget, or `null` for a non-participant. */
    readonly participantSlotOf: (
      householdId: string,
      userId: string,
    ) => Effect.Effect<1 | 2 | null, DatabaseError>;
    /**
     * The userId of the participant who is NOT `viewerId`: the unambiguous "other person" a two-slot budget
     * guarantees (docs/spec.md §2.4). `null` when the second seat is empty (only reachable through a directly seeded
     * one-participant ledger in H, M3 decision 18): the caller decides whether that is fatal.
     */
    readonly otherMemberId: (
      householdId: string,
      viewerId: string,
    ) => Effect.Effect<string | null, DatabaseError>;
    /**
     * {@link otherMemberId}, but fails `409 conflict` (`server.household.needsSecondMember`) instead of returning
     * `null`: for operations that cannot proceed without a second participant (booking a `THEIRS_SPLIT`/`TRANSFER`
     * row, running the fixed-cost plan).
     */
    readonly requireOtherMemberId: (
      householdId: string,
      viewerId: string,
    ) => Effect.Effect<string, Conflict | DatabaseError>;
    /**
     * The userId seated at `member_slot 1`, the balance sign convention's anchor (docs/spec.md §2.4: `balanceCents >
     * 0` means slot 2 owes slot 1). Every enabled finance household has a slot 1, so a missing row is a programming
     * error (`500`), not a user-facing state.
     */
    readonly slot1UserId: (householdId: string) => Effect.Effect<string, Internal | DatabaseError>;
    /**
     * Seats exactly two household members in slots 1 and 2 (plan M3 decision 4), on the CURRENT executor: the enable
     * hook runs inside the core's transaction; the PUT route goes through {@link saveParticipants}, which opens one.
     *
     * Rules, checked here and not in a schema refine (F gotcha 48: a refine cannot carry a code):
     * - exactly two entries, slots exactly {1, 2}, two different users, else `422 finance_participants_required`
     *   (`server.finance.participantsRequired`);
     * - both are core members of the household, else the same code with `server.finance.participantNotMember`;
     * - a placeholder (no account, ADR 0006) may hold slot 2 only: slot 1 answers `422 validation_failed`
     *   (`server.finance.placeholderSlotOne`, detail on the slot-1 entry);
     * - a user who LEAVES the budget (seated before, absent after) while the ledger has rows -> `409
     *   finance_participant_in_use`, nothing written. In the two-person ledger EVERY `finance_transactions` row
     *   involves both slots, so ANY transaction row of the household blocks a replacement; a
     *   `finance_incomes.person_id` naming the outgoing user blocks it too. Swapping the same two users between slots
     *   is allowed: nobody leaves, and every projection is computed at read time;
     * - when the plan's `payer_id` is an outgoing user (the ledger is empty, else 409 above), it moves to the incoming
     *   user of the same slot;
     * - a kept user keeps `display_name` and `joined_at`; a new one gets `users.name` (trimmed, ≤ 80) and `joined_at`
     *   = the module clock.
     *
     * A unique violation (a concurrent assignment won the race for a slot) answers the same 409, never a 500
     * (`isUniqueViolation` walks drizzle's cause chain, F gotcha 51).
     */
    readonly assignParticipants: (
      householdId: string,
      assignment: readonly ParticipantAssignmentEntry[],
    ) => Effect.Effect<void, AssignmentError>;
    /**
     * The finance half of "a member leaves" (the module's `onMemberRemoving` hook; toon-finance `removeMember`'s
     * `member_has_ledger` guard, SPEC D13): a SEATED participant may not leave the household while the ledger has rows
     * (any `finance_transactions` row of the household, or a `finance_incomes.person_id` naming the leaver) -> `409
     * member_has_ledger`. A member without a seat may leave. A seated leaver with an empty ledger may leave too, and
     * the seat goes with them; a fixed-cost plan whose payer is the leaver moves to the remaining participant. When the
     * leaver held slot 1 and the remaining participant holds slot 2, the survivor is moved to slot 1 in the same call
     * (ADR 0004, M4-T01). Runs on the CURRENT executor with no transaction of its own: the core's `removeMember`
     * opened it, so the veto and the release share it.
     */
    readonly assertParticipantMayLeave: (
      householdId: string,
      userId: string,
    ) => Effect.Effect<void, Conflict | DatabaseError>;
    /** {@link assignParticipants} inside its own transaction (the PUT route's entry point). */
    readonly saveParticipants: (
      householdId: string,
      assignment: readonly ParticipantAssignmentEntry[],
    ) => Effect.Effect<void, AssignmentError>;
    /** Renames the caller's own display name inside the budget (F `updateMemberDisplayName`). */
    readonly updateParticipantDisplayName: (
      householdId: string,
      userId: string,
      displayName: string,
    ) => Effect.Effect<FinanceParticipantResponse, NotFound | DatabaseError>;
    /**
     * Renames the OTHER seat when it is a placeholder (toon-finance b1b517d: "yourself or the placeholder"; H plan m3b
     * decision 6): `404` for a user without a seat in THIS household, `403 forbidden` for a seat with an account (their
     * name is theirs to change, through `…/me`). The household comes from the path only, so another household's user id
     * is a 404.
     */
    readonly renamePlaceholderParticipant: (
      householdId: string,
      userId: string,
      displayName: string,
    ) => Effect.Effect<FinanceParticipantResponse, NotFound | Forbidden | DatabaseError>;
  }
>()("toon/api/modules/finance/services/participants/participants.service/FinanceParticipants") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const listParticipants = Effect.fn("FinanceParticipants.listParticipants")(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ participant: financeParticipants, user: users })
            .from(financeParticipants)
            .innerJoin(users, eq(users.id, financeParticipants.userId))
            .where(eq(financeParticipants.householdId, householdId))
            .orderBy(asc(financeParticipants.memberSlot)),
        );
        return rows.map((row) => toParticipantResponse(row.participant, row.user));
      });

      const getParticipant = Effect.fn("FinanceParticipants.getParticipant")(function* (
        householdId: string,
        userId: string,
      ) {
        const rows = yield* database.use((db) =>
          db
            .select({ participant: financeParticipants, user: users })
            .from(financeParticipants)
            .innerJoin(users, eq(users.id, financeParticipants.userId))
            .where(and(eq(financeParticipants.householdId, householdId), eq(financeParticipants.userId, userId)))
            .limit(1),
        );
        const row = rows[0];
        if (!row) return yield* new NotFound();
        return toParticipantResponse(row.participant, row.user);
      });

      const participantSlotOf = Effect.fn("FinanceParticipants.participantSlotOf")(function* (
        householdId: string,
        userId: string,
      ) {
        const rows = yield* database.use((db) =>
          db
            .select({ memberSlot: financeParticipants.memberSlot })
            .from(financeParticipants)
            .where(and(eq(financeParticipants.householdId, householdId), eq(financeParticipants.userId, userId)))
            .limit(1),
        );
        const slot = rows[0]?.memberSlot;
        return slot === undefined ? null : asSlot(slot);
      });

      const otherMemberId = Effect.fn("FinanceParticipants.otherMemberId")(function* (
        householdId: string,
        viewerId: string,
      ) {
        const rows = yield* database.use((db) =>
          db
            .select({ userId: financeParticipants.userId })
            .from(financeParticipants)
            .where(eq(financeParticipants.householdId, householdId))
            .limit(2),
        );
        const other = rows.find((row) => row.userId !== viewerId);
        return other?.userId ?? null;
      });

      const requireOtherMemberId = Effect.fn("FinanceParticipants.requireOtherMemberId")(function* (
        householdId: string,
        viewerId: string,
      ) {
        const other = yield* otherMemberId(householdId, viewerId);
        if (!other) return yield* new Conflict({ text: "server.household.needsSecondMember" });
        return other;
      });

      const slot1UserId = Effect.fn("FinanceParticipants.slot1UserId")(function* (householdId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ userId: financeParticipants.userId })
            .from(financeParticipants)
            .where(and(eq(financeParticipants.householdId, householdId), eq(financeParticipants.memberSlot, 1)))
            .limit(1),
        );
        const userId = rows[0]?.userId;
        if (!userId) return yield* new Internal();
        return userId;
      });

      const assignParticipants = Effect.fn("FinanceParticipants.assignParticipants")(function* (
        householdId: string,
        assignment: readonly ParticipantAssignmentEntry[],
      ) {
        if (assignment.length !== 2) return yield* participantsRequired();
        const slots = new Set(assignment.map((entry) => entry.memberSlot));
        if (!slots.has(1) || !slots.has(2)) return yield* participantsRequired();
        const [first, second] = assignment as [ParticipantAssignmentEntry, ParticipantAssignmentEntry];
        if (first.userId === second.userId) return yield* participantsRequired();
        const incomingIds = [first.userId, second.userId];

        const members = yield* database.use((db) =>
          db
            .select({
              userId: householdMembers.userId,
              name: users.name,
              email: users.email,
              passwordHash: users.passwordHash,
            })
            .from(householdMembers)
            .innerJoin(users, eq(users.id, householdMembers.userId))
            .where(and(eq(householdMembers.householdId, householdId), inArray(householdMembers.userId, incomingIds))),
        );
        if (members.length !== 2) {
          return yield* new ApiFailure({
            status: 422,
            code: "finance_participants_required",
            text: "server.finance.participantNotMember",
          });
        }

        // A placeholder (ADR 0006, plan m3b decision 6) may only take slot 2: slot 1 anchors the balance
        // sign and is the viewer-side default, and a person who cannot log in cannot be that anchor.
        const slotOneIndex = assignment.findIndex((entry) => entry.memberSlot === 1);
        const slotOneMember = members.find((candidate) => candidate.userId === assignment[slotOneIndex]?.userId);
        if (slotOneMember && isPlaceholderUser({ email: slotOneMember.email, passwordHash: slotOneMember.passwordHash })) {
          return yield* new ValidationFailed({
            details: [
              {
                path: `participants.${slotOneIndex}.userId`,
                code: "custom",
                message: serverText(DEFAULT_LOCALE, "server.finance.placeholderSlotOne"),
                i18n: { key: "server.finance.placeholderSlotOne" },
              },
            ],
            text: "server.finance.placeholderSlotOne",
          });
        }

        const current = yield* database.use((db) =>
          db.select().from(financeParticipants).where(eq(financeParticipants.householdId, householdId)),
        );
        const currentById = new Map(current.map((row) => [row.userId, row]));
        const outgoing = current.filter((row) => !incomingIds.includes(row.userId));
        const outgoingIds = outgoing.map((row) => row.userId);

        if (outgoingIds.length > 0) {
          // Any transaction row involves both slots, so a replaced participant would silently inherit
          // the outgoing one's share of every row (SPEC D3: refused while the ledger has rows).
          const transactionRows = yield* database.use((db) =>
            db
              .select({ id: financeTransactions.id })
              .from(financeTransactions)
              .where(eq(financeTransactions.householdId, householdId))
              .limit(1),
          );
          const incomeRows = yield* database.use((db) =>
            db
              .select({ id: financeIncomes.id })
              .from(financeIncomes)
              .where(and(eq(financeIncomes.householdId, householdId), inArray(financeIncomes.personId, outgoingIds)))
              .limit(1),
          );
          if (transactionRows.length > 0 || incomeRows.length > 0) return yield* participantInUse();
        }

        const timestamp = yield* financeTimeMillis;
        const rows = assignment.map((entry) => {
          const kept = currentById.get(entry.userId);
          const member = members.find((candidate) => candidate.userId === entry.userId);
          // `users.name` first: a placeholder (ADR 0006) has a name and a NULL e-mail, so the e-mail
          // fallback (an account whose name is blank) can never write a NULL into `display_name`.
          const name = (member?.name ?? "").trim().slice(0, DISPLAY_NAME_MAX);
          return {
            householdId,
            userId: entry.userId,
            memberSlot: entry.memberSlot,
            displayName: kept?.displayName ?? (name.length > 0 ? name : (member?.email ?? "").slice(0, DISPLAY_NAME_MAX)),
            joinedAt: kept?.joinedAt ?? timestamp,
          };
        });

        // Delete-then-insert: rewriting the slots in place would trip the
        // (household_id, member_slot) unique index halfway through a swap.
        yield* database
          .use(async (db) => {
            await db.delete(financeParticipants).where(eq(financeParticipants.householdId, householdId));
            await db.insert(financeParticipants).values(rows);
          })
          .pipe(
            Effect.catchTag("DatabaseError", (error) =>
              Effect.fail(isUniqueViolation(error.cause) ? participantInUse() : error),
            ),
          );

        // The plan's payer follows its slot when the payer leaves the budget.
        const plans = yield* database.use((db) =>
          db
            .select({ payerId: financeFixedCostPlans.payerId })
            .from(financeFixedCostPlans)
            .where(eq(financeFixedCostPlans.householdId, householdId))
            .limit(1),
        );
        const payerId = plans[0]?.payerId;
        const leavingPayer = outgoing.find((row) => row.userId === payerId);
        if (leavingPayer) {
          const successor = assignment.find((entry) => entry.memberSlot === leavingPayer.memberSlot);
          if (successor) {
            yield* database.use((db) =>
              db
                .update(financeFixedCostPlans)
                .set({ payerId: successor.userId, updatedAt: timestamp })
                .where(eq(financeFixedCostPlans.householdId, householdId)),
            );
          }
        }
      });

      const assertParticipantMayLeave = Effect.fn("FinanceParticipants.assertParticipantMayLeave")(function* (
        householdId: string,
        userId: string,
      ) {
        const seat = yield* participantSlotOf(householdId, userId);
        if (seat === null) return;
        const transactionRows = yield* database.use((db) =>
          db
            .select({ id: financeTransactions.id })
            .from(financeTransactions)
            .where(eq(financeTransactions.householdId, householdId))
            .limit(1),
        );
        const incomeRows = yield* database.use((db) =>
          db
            .select({ id: financeIncomes.id })
            .from(financeIncomes)
            .where(and(eq(financeIncomes.householdId, householdId), eq(financeIncomes.personId, userId)))
            .limit(1),
        );
        if (transactionRows.length > 0 || incomeRows.length > 0) {
          return yield* new Conflict({ code: "member_has_ledger", text: "server.household.memberHasLedger" });
        }

        const remaining = yield* otherMemberId(householdId, userId);
        yield* database.use((db) =>
          db
            .delete(financeParticipants)
            .where(and(eq(financeParticipants.householdId, householdId), eq(financeParticipants.userId, userId))),
        );
        if (remaining) {
          if (seat === 1) {
            yield* database.use((db) =>
              db
                .update(financeParticipants)
                .set({ memberSlot: 1 })
                .where(
                  and(
                    eq(financeParticipants.householdId, householdId),
                    eq(financeParticipants.userId, remaining),
                    eq(financeParticipants.memberSlot, 2),
                  ),
                ),
            );
          }
          const timestamp = yield* financeTimeMillis;
          yield* database.use((db) =>
            db
              .update(financeFixedCostPlans)
              .set({ payerId: remaining, updatedAt: timestamp })
              .where(and(eq(financeFixedCostPlans.householdId, householdId), eq(financeFixedCostPlans.payerId, userId))),
          );
        }
      });

      const saveParticipants = Effect.fn("FinanceParticipants.saveParticipants")(function* (
        householdId: string,
        assignment: readonly ParticipantAssignmentEntry[],
      ) {
        yield* database.transaction(assignParticipants(householdId, assignment));
      });

      const updateParticipantDisplayName = Effect.fn("FinanceParticipants.updateParticipantDisplayName")(function* (
        householdId: string,
        userId: string,
        displayName: string,
      ) {
        yield* getParticipant(householdId, userId);
        yield* database.use((db) =>
          db
            .update(financeParticipants)
            .set({ displayName })
            .where(and(eq(financeParticipants.householdId, householdId), eq(financeParticipants.userId, userId))),
        );
        return yield* getParticipant(householdId, userId);
      });

      const renamePlaceholderParticipant = Effect.fn("FinanceParticipants.renamePlaceholderParticipant")(function* (
        householdId: string,
        userId: string,
        displayName: string,
      ) {
        const target = yield* getParticipant(householdId, userId);
        if (target.hasAccount) return yield* new Forbidden();
        yield* database.use((db) =>
          db
            .update(financeParticipants)
            .set({ displayName })
            .where(and(eq(financeParticipants.householdId, householdId), eq(financeParticipants.userId, userId))),
        );
        return yield* getParticipant(householdId, userId);
      });

      return FinanceParticipants.of({
        listParticipants,
        getParticipant,
        participantSlotOf,
        otherMemberId,
        requireOtherMemberId,
        slot1UserId,
        assignParticipants,
        assertParticipantMayLeave,
        saveParticipants,
        updateParticipantDisplayName,
        renamePlaceholderParticipant,
      });
    }),
  );
}
