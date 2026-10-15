/**
 * Pure helpers for choosing the two finance participants (M3 decision 4): shared by the enable
 * dialog and the settings section. No React, no I/O: the components own the state, this file
 * owns the rules, so they are testable without a DOM.
 *
 * Slot 1 anchors the balance (`finance.participants.description`); the viewer is preselected
 * for it when the household has no participants yet. A PLACEHOLDER (a member without an account,
 * `hasAccount: false`, ADR 0006) may only hold slot 2: slot 1 is the viewer-side default and the
 * balance anchor, and the server refuses a placeholder there (`server.finance.placeholderSlotOne`),
 * so the slot-1 select never lists one and a body naming one is never built.
 */
import type { FinanceParticipantResponse, HouseholdMember, UpdateFinanceParticipantsRequest } from "@toon/shared";

/**
 * A person who can be seated: the household member's user id and the name shown for them.
 * `hasAccount` is read as "has an account unless `false`", so a caller that does not know
 * (the tests' minimal shape) gets the old behaviour.
 */
export interface AssignableMember {
  userId: string;
  name: string;
  hasAccount?: boolean;
}

/** The two selects' values; an empty string means "not chosen yet". */
export interface Assignment {
  slot1: string;
  slot2: string;
}

export interface AssignmentOption {
  value: string;
  label: string;
  /** Present (and true) only for a person without an account: the component adds the badge. */
  placeholder?: true;
}

function isPlaceholder(member: { hasAccount?: boolean }): boolean {
  return member.hasAccount === false;
}

/** Core household members (`householdMembersQuery`) to the helpers' minimal shape. */
export function toAssignable(members: readonly HouseholdMember[]): AssignableMember[] {
  return members.map((member) => ({ userId: member.userId, name: member.user.name, hasAccount: member.hasAccount }));
}

/**
 * The starting values of the two selects.
 *
 *  - Two participants exist: their slots, exactly (a re-enable or the settings section).
 *  - Otherwise: the viewer in slot 1 (the first member WITH AN ACCOUNT when the viewer is not a
 *    member, which cannot happen in the UI but must not throw), slot 2 empty so the person
 *    chooses, unless exactly one other member exists, which is then the only sensible choice.
 *    This also covers a placeholder left ALONE in slot 1 (an account in slot 1 left an empty
 *    ledger, ADR 0004): the preselection moves the viewer to slot 1 and the placeholder, when it
 *    is the one other member, to slot 2, which is the way out of that state.
 */
export function initialAssignment(
  members: readonly AssignableMember[],
  viewerId: string | null,
  current?: readonly FinanceParticipantResponse[] | null,
): Assignment {
  const first = current?.find((item) => item.memberSlot === 1);
  const second = current?.find((item) => item.memberSlot === 2);
  if (first && second) return { slot1: first.userId, slot2: second.userId };

  const viewer =
    members.find((member) => member.userId === viewerId && !isPlaceholder(member)) ??
    members.find((member) => !isPlaceholder(member));
  const slot1 = viewer?.userId ?? "";
  const others = members.filter((member) => member.userId !== slot1);
  const only = others.length === 1 ? others[0] : undefined;
  return { slot1, slot2: only?.userId ?? "" };
}

/** `finance.participants.sameMember` when both slots name one person; null otherwise. */
export function assignmentError(assignment: Assignment): "finance.participants.sameMember" | null {
  if (assignment.slot1 !== "" && assignment.slot1 === assignment.slot2) {
    return "finance.participants.sameMember";
  }
  return null;
}

/** Both slots chosen and valid, i.e. the form may be submitted. */
export function isAssignmentComplete(assignment: Assignment): boolean {
  return assignment.slot1 !== "" && assignment.slot2 !== "" && assignmentError(assignment) === null;
}

/** True when slot 1 names a person without an account (the server answers 422 for it). */
export function slotOneIsPlaceholder(
  assignment: Assignment,
  members: readonly AssignableMember[],
  current?: readonly FinanceParticipantResponse[] | null,
): boolean {
  const member = members.find((item) => item.userId === assignment.slot1);
  if (member) return isPlaceholder(member);
  const participant = current?.find((item) => item.userId === assignment.slot1);
  return participant !== undefined && !participant.hasAccount;
}

/**
 * The PUT / enable body, or null while the assignment is incomplete or invalid. With `members`
 * given, a placeholder in slot 1 is refused here too (the select never offers one; this guards
 * a stale preselection).
 */
export function assignmentBody(
  assignment: Assignment,
  members?: readonly AssignableMember[],
  current?: readonly FinanceParticipantResponse[] | null,
): UpdateFinanceParticipantsRequest | null {
  if (!isAssignmentComplete(assignment)) return null;
  if (members && slotOneIsPlaceholder(assignment, members, current)) return null;
  return {
    participants: [
      { userId: assignment.slot1, memberSlot: 1 },
      { userId: assignment.slot2, memberSlot: 2 },
    ],
  };
}

/** True when `assignment` differs from what the participants currently are (the Save gate). */
export function assignmentChanged(
  assignment: Assignment,
  current: readonly FinanceParticipantResponse[] | null | undefined,
): boolean {
  const first = current?.find((item) => item.memberSlot === 1)?.userId ?? "";
  const second = current?.find((item) => item.memberSlot === 2)?.userId ?? "";
  return assignment.slot1 !== first || assignment.slot2 !== second;
}

/**
 * Options for one select: every household member, plus a current participant who is no longer a
 * member (their display name), so the select never shows a value it cannot list. For slot 1
 * (`slot = 1`) people without an account are left out (slot 2 lists everyone, the default).
 */
export function assignmentOptions(
  members: readonly AssignableMember[],
  current?: readonly FinanceParticipantResponse[] | null,
  slot: 1 | 2 = 2,
): AssignmentOption[] {
  const options: AssignmentOption[] = [];
  for (const member of members) {
    if (isPlaceholder(member)) {
      if (slot === 2) options.push({ value: member.userId, label: member.name, placeholder: true });
    } else {
      options.push({ value: member.userId, label: member.name });
    }
  }
  for (const item of current ?? []) {
    if (members.some((member) => member.userId === item.userId)) continue;
    if (!item.hasAccount) {
      if (slot === 2) options.push({ value: item.userId, label: item.displayName, placeholder: true });
    } else {
      options.push({ value: item.userId, label: item.displayName });
    }
  }
  return options;
}

/**
 * The options as a select takes them: a person without an account gets `(badge)` after the name,
 * so the slot-2 list tells them apart. The badge text is the caller's (a catalog value).
 */
export function withBadge(options: readonly AssignmentOption[], badge: string): { value: string; label: string }[] {
  return options.map((option) => ({
    value: option.value,
    label: option.placeholder ? `${option.label} (${badge})` : option.label,
  }));
}
