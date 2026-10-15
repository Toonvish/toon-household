/**
 * Finance participants: the two household members who keep the household budget,
 * seated in slot 1 and slot 2 of `finance_participants` (SPEC D3, plan M3 decision 4).
 *
 * Replaces toon-finance's `services/households/members.service.ts` with the same
 * exported names for what the ledger uses (`otherMemberId`, `requireOtherMemberId`,
 * `slot1UserId`, F's bodies over `finance_participants`). In toon-finance the two slots
 * WERE the household; here a household has any number of core members
 * (`household_members`) and finance seats two of them, chosen by an owner/admin
 * (`assignParticipants`, used by the enable hook and by PUT …/finance/participants).
 *
 * Every timestamp comes from the module clock (`../../lib/clock.ts`), so a test that
 * pins it with `setClockForTest` sees the pinned `joined_at` (decision 4 "Clock").
 */
import type { FinanceParticipantResponse } from "@toon/shared";
import { DEFAULT_LOCALE, serverText } from "@toon/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../../../db/client.ts";
import { householdMembers, users } from "../../../../db/schema.ts";
import { isPlaceholderUser, isUniqueViolation } from "../../../../core/services/auth/users.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { toIso } from "../../../../lib/http.ts";
import { nowMs } from "../../lib/clock.ts";
import {
  financeFixedCostPlans,
  financeIncomes,
  financeParticipants,
  financeTransactions,
} from "../../schema.ts";
import { type DbLike, withTransaction } from "../support.ts";

/** One seat of an assignment: who sits in which slot. */
export interface ParticipantAssignmentEntry {
  userId: string;
  memberSlot: number;
}

/** Longest display name (F `DisplayNameSchema`, 1–80 characters). */
const DISPLAY_NAME_MAX = 80;

function asSlot(value: number): 1 | 2 {
  return value === 2 ? 2 : 1;
}

function participantsRequired(): ApiError {
  return new ApiError(422, "finance_participants_required", "server.finance.participantsRequired");
}

function participantInUse(): ApiError {
  return ApiError.conflict("finance_participant_in_use", "server.finance.participantInUse");
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

/** The participants of a household incl. their public user record — ONE joined query, by slot. */
export async function listParticipants(db: DbLike, householdId: string): Promise<FinanceParticipantResponse[]> {
  const rows = await db
    .select({ participant: financeParticipants, user: users })
    .from(financeParticipants)
    .innerJoin(users, eq(users.id, financeParticipants.userId))
    .where(eq(financeParticipants.householdId, householdId))
    .orderBy(asc(financeParticipants.memberSlot));
  return rows.map((row) => toParticipantResponse(row.participant, row.user));
}

/** The participant row of one user, mapped to the contract shape (404 if none). */
export async function getParticipant(
  db: DbLike,
  householdId: string,
  userId: string,
): Promise<FinanceParticipantResponse> {
  const rows = await db
    .select({ participant: financeParticipants, user: users })
    .from(financeParticipants)
    .innerJoin(users, eq(users.id, financeParticipants.userId))
    .where(and(eq(financeParticipants.householdId, householdId), eq(financeParticipants.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw ApiError.notFound();
  return toParticipantResponse(row.participant, row.user);
}

/** The slot `userId` holds in the household's budget, or `null` for a non-participant. */
export async function participantSlotOf(db: DbLike, householdId: string, userId: string): Promise<1 | 2 | null> {
  const rows = await db
    .select({ memberSlot: financeParticipants.memberSlot })
    .from(financeParticipants)
    .where(and(eq(financeParticipants.householdId, householdId), eq(financeParticipants.userId, userId)))
    .limit(1);
  const slot = rows[0]?.memberSlot;
  return slot === undefined ? null : asSlot(slot);
}

/**
 * The userId of the participant who is NOT `viewerId` — the unambiguous "other
 * person" a two-slot budget guarantees (docs/spec.md §2.4). Used by the ledger
 * (transactions/plan/settlements) to resolve `kindToStorage`/`computePlanForPeriod`
 * without ever trusting a client-picked id. `null` when the second seat is empty
 * (only reachable through a directly seeded one-participant ledger in H, M3
 * decision 18) — the caller decides whether that is fatal for the operation at hand.
 */
export async function otherMemberId(db: DbLike, householdId: string, viewerId: string): Promise<string | null> {
  const rows = await db
    .select({ userId: financeParticipants.userId })
    .from(financeParticipants)
    .where(eq(financeParticipants.householdId, householdId))
    .limit(2);
  const other = rows.find((row) => row.userId !== viewerId);
  return other?.userId ?? null;
}

/**
 * {@link otherMemberId}, but throws `409 conflict` (`server.household.
 * needsSecondMember`) instead of returning `null` — for operations that
 * genuinely cannot proceed without a second participant (booking a `THEIRS_SPLIT`/
 * `TRANSFER` row, running the fixed-cost plan).
 */
export async function requireOtherMemberId(db: DbLike, householdId: string, viewerId: string): Promise<string> {
  const other = await otherMemberId(db, householdId, viewerId);
  if (!other) throw ApiError.conflict("conflict", "server.household.needsSecondMember");
  return other;
}

/**
 * The userId seated at `member_slot 1` — the balance sign convention's anchor
 * (docs/spec.md §2.4: `balanceCents > 0` means slot 2 owes slot 1). Every
 * enabled finance household has a slot 1 (the enable hook refuses otherwise, and a slot-1
 * leaver's survivor is re-seated there, {@link assertParticipantMayLeave}), so
 * a missing row here is a programming error, not a user-facing state.
 */
export async function slot1UserId(db: DbLike, householdId: string): Promise<string> {
  const rows = await db
    .select({ userId: financeParticipants.userId })
    .from(financeParticipants)
    .where(and(eq(financeParticipants.householdId, householdId), eq(financeParticipants.memberSlot, 1)))
    .limit(1);
  const userId = rows[0]?.userId;
  if (!userId) throw ApiError.internal();
  return userId;
}

/**
 * Seats exactly two household members in slots 1 and 2 (plan M3 decision 4), on the
 * executor it is given — the enable hook passes the core's transaction; the PUT route
 * goes through {@link saveParticipants}, which opens one.
 *
 * Rules, checked here and not in a Zod refine (F gotcha 48: a refine cannot carry a code):
 * - exactly two entries, slots exactly {1, 2}, two different users, else
 *   `422 finance_participants_required` (`server.finance.participantsRequired`);
 * - both are core members of the household, else the same code with
 *   `server.finance.participantNotMember`;
 * - a placeholder (no account, ADR 0006) may hold slot 2 only: slot 1 answers
 *   `422 validation_failed` (`server.finance.placeholderSlotOne`, detail on the slot-1 entry);
 * - a user who LEAVES the budget (seated before, absent after) while the ledger has rows
 *   → `409 finance_participant_in_use`, nothing written. In the two-person ledger EVERY
 *   `finance_transactions` row involves both slots (SPLIT_EQUAL, OTHER_ONLY and SETTLEMENT
 *   store only the payer; the counterparty is "the other slot"), so ANY transaction row of
 *   the household blocks a replacement, not just one that names the outgoing user as payer;
 *   a `finance_incomes.person_id` naming the outgoing user blocks it too. Swapping the same
 *   two users between slots is allowed: nobody leaves, and every projection is computed at
 *   read time;
 * - when the plan's `payer_id` is an outgoing user (the ledger is empty, else 409 above), it
 *   moves to the incoming user of the same slot;
 * - a kept user keeps `display_name` and `joined_at`; a new one gets `users.name`
 *   (trimmed, ≤ 80) and `joined_at` = the module clock.
 *
 * A unique violation (a concurrent assignment won the race for a slot) answers the same
 * 409, never a 500 (`isUniqueViolation` walks drizzle's cause chain, F gotcha 51).
 */
export async function assignParticipants(
  db: DbLike,
  householdId: string,
  assignment: readonly ParticipantAssignmentEntry[],
): Promise<void> {
  if (assignment.length !== 2) throw participantsRequired();
  const slots = new Set(assignment.map((entry) => entry.memberSlot));
  if (!slots.has(1) || !slots.has(2)) throw participantsRequired();
  const [first, second] = assignment as [ParticipantAssignmentEntry, ParticipantAssignmentEntry];
  if (first.userId === second.userId) throw participantsRequired();
  const incomingIds = [first.userId, second.userId];

  const members = await db
    .select({ userId: householdMembers.userId, name: users.name, email: users.email, passwordHash: users.passwordHash })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(and(eq(householdMembers.householdId, householdId), inArray(householdMembers.userId, incomingIds)));
  if (members.length !== 2) {
    throw new ApiError(422, "finance_participants_required", "server.finance.participantNotMember");
  }

  // A placeholder (ADR 0006, plan m3b decision 6) may only take slot 2: slot 1 anchors the balance
  // sign and is the viewer-side default, and a person who cannot log in cannot be that anchor.
  const slotOneIndex = assignment.findIndex((entry) => entry.memberSlot === 1);
  const slotOneMember = members.find((candidate) => candidate.userId === assignment[slotOneIndex]?.userId);
  if (slotOneMember && isPlaceholderUser({ email: slotOneMember.email, passwordHash: slotOneMember.passwordHash })) {
    throw ApiError.validationFailed(
      [
        {
          path: `participants.${slotOneIndex}.userId`,
          code: "custom",
          message: serverText(DEFAULT_LOCALE, "server.finance.placeholderSlotOne"),
          i18n: { key: "server.finance.placeholderSlotOne" },
        },
      ],
      "server.finance.placeholderSlotOne",
    );
  }

  const current = await db
    .select()
    .from(financeParticipants)
    .where(eq(financeParticipants.householdId, householdId));
  const currentById = new Map(current.map((row) => [row.userId, row]));
  const outgoing = current.filter((row) => !incomingIds.includes(row.userId));
  const outgoingIds = outgoing.map((row) => row.userId);

  if (outgoingIds.length > 0) {
    // Any transaction row involves both slots, so a replaced participant would silently inherit
    // the outgoing one's share of every row (SPEC D3: refused while the ledger has rows).
    const transactionRows = await db
      .select({ id: financeTransactions.id })
      .from(financeTransactions)
      .where(eq(financeTransactions.householdId, householdId))
      .limit(1);
    const incomeRows = await db
      .select({ id: financeIncomes.id })
      .from(financeIncomes)
      .where(and(eq(financeIncomes.householdId, householdId), inArray(financeIncomes.personId, outgoingIds)))
      .limit(1);
    if (transactionRows.length > 0 || incomeRows.length > 0) throw participantInUse();
  }

  const timestamp = nowMs();
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

  try {
    // Delete-then-insert: rewriting the slots in place would trip the
    // (household_id, member_slot) unique index halfway through a swap.
    await db.delete(financeParticipants).where(eq(financeParticipants.householdId, householdId));
    await db.insert(financeParticipants).values(rows);
  } catch (error) {
    if (isUniqueViolation(error)) throw participantInUse();
    throw error;
  }

  // The plan's payer follows its slot when the payer leaves the budget.
  const plans = await db
    .select({ payerId: financeFixedCostPlans.payerId })
    .from(financeFixedCostPlans)
    .where(eq(financeFixedCostPlans.householdId, householdId))
    .limit(1);
  const payerId = plans[0]?.payerId;
  const leavingPayer = outgoing.find((row) => row.userId === payerId);
  if (leavingPayer) {
    const successor = assignment.find((entry) => entry.memberSlot === leavingPayer.memberSlot);
    if (successor) {
      await db
        .update(financeFixedCostPlans)
        .set({ payerId: successor.userId, updatedAt: timestamp })
        .where(eq(financeFixedCostPlans.householdId, householdId));
    }
  }
}

/**
 * The finance half of "a member leaves" (the module's `onMemberRemoving` hook; toon-finance
 * `removeMember`'s `member_has_ledger` guard, SPEC D13): a SEATED participant may not leave the
 * household while the ledger has rows, because their balance would hang off a member who no
 * longer exists, and {@link assignParticipants} would then refuse to replace them too (a dead
 * end no admin action could clear). Same predicate as the replacement rule: ANY
 * `finance_transactions` row of the household (every row involves both slots) or a
 * `finance_incomes.person_id` naming the leaver -> `409 member_has_ledger`. A member without a
 * seat may leave.
 *
 * A seated leaver with an empty ledger may leave too, and the seat goes with them (toon-finance:
 * a leaver's `household_members` row WAS the slot). Keeping the seat row would let the remaining
 * participant book against an ex-member, after which the ledger is non-empty and the seat can
 * never be replaced. With one seat left, a booking that needs the other slot answers
 * `409 conflict` (`server.household.needsSecondMember`) until an admin seats a second member
 * through `PUT .../participants`. A fixed-cost plan whose payer is the leaver moves to the
 * remaining participant (nobody else can be the payer of a two-person plan).
 *
 * When the leaver held slot 1 and the remaining participant holds slot 2, the survivor is moved
 * to slot 1 in the same call (ADR 0004, M4-T01): `slot1UserId`, the balance sign's anchor
 * (docs/spec.md §2.4), must always resolve, so the survivor of a slot-1 leave never sits alone
 * in slot 2. The slot is free once the leaver's row is deleted (unique index and CHECK allow it).
 * A slot-2 leaver leaves slot 1 untouched.
 *
 * Runs before the core deletes the membership row; the veto and the release share one executor.
 */
export async function assertParticipantMayLeave(db: DbLike, householdId: string, userId: string): Promise<void> {
  const seat = await participantSlotOf(db, householdId, userId);
  if (seat === null) return;
  const transactionRows = await db
    .select({ id: financeTransactions.id })
    .from(financeTransactions)
    .where(eq(financeTransactions.householdId, householdId))
    .limit(1);
  const incomeRows = await db
    .select({ id: financeIncomes.id })
    .from(financeIncomes)
    .where(and(eq(financeIncomes.householdId, householdId), eq(financeIncomes.personId, userId)))
    .limit(1);
  if (transactionRows.length > 0 || incomeRows.length > 0) {
    throw ApiError.conflict("member_has_ledger", "server.household.memberHasLedger");
  }

  const remaining = await otherMemberId(db, householdId, userId);
  await db
    .delete(financeParticipants)
    .where(and(eq(financeParticipants.householdId, householdId), eq(financeParticipants.userId, userId)));
  if (remaining) {
    if (seat === 1) {
      await db
        .update(financeParticipants)
        .set({ memberSlot: 1 })
        .where(
          and(
            eq(financeParticipants.householdId, householdId),
            eq(financeParticipants.userId, remaining),
            eq(financeParticipants.memberSlot, 2),
          ),
        );
    }
    await db
      .update(financeFixedCostPlans)
      .set({ payerId: remaining, updatedAt: nowMs() })
      .where(and(eq(financeFixedCostPlans.householdId, householdId), eq(financeFixedCostPlans.payerId, userId)));
  }
}

/** {@link assignParticipants} inside its own transaction (the PUT route's entry point). */
export async function saveParticipants(
  db: Database,
  householdId: string,
  assignment: readonly ParticipantAssignmentEntry[],
): Promise<void> {
  await withTransaction(db, (tx) => assignParticipants(tx, householdId, assignment));
}

/** Renames the caller's own display name inside the budget (F `updateMemberDisplayName`). */
export async function updateParticipantDisplayName(
  db: DbLike,
  householdId: string,
  userId: string,
  displayName: string,
): Promise<FinanceParticipantResponse> {
  await getParticipant(db, householdId, userId);
  await db
    .update(financeParticipants)
    .set({ displayName })
    .where(and(eq(financeParticipants.householdId, householdId), eq(financeParticipants.userId, userId)));
  return getParticipant(db, householdId, userId);
}

/**
 * Renames the OTHER seat when it is a placeholder (toon-finance b1b517d: "yourself or the
 * placeholder"; H plan m3b decision 6): `404` for a user without a seat in THIS household, `403
 * forbidden` for a seat with an account (their name is theirs to change, through `…/me`). The
 * household comes from the path only, so another household's user id is a 404.
 */
export async function renamePlaceholderParticipant(
  db: DbLike,
  householdId: string,
  userId: string,
  displayName: string,
): Promise<FinanceParticipantResponse> {
  const target = await getParticipant(db, householdId, userId);
  if (target.hasAccount) throw ApiError.forbidden();
  await db
    .update(financeParticipants)
    .set({ displayName })
    .where(and(eq(financeParticipants.householdId, householdId), eq(financeParticipants.userId, userId)));
  return getParticipant(db, householdId, userId);
}
