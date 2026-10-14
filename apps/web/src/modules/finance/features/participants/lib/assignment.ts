/**
 * Pure helpers for choosing the two finance participants (M3 decision 4): shared by the enable
 * dialog and the settings section. No React, no I/O: the components own the state, this file
 * owns the rules, so they are testable without a DOM.
 *
 * Slot 1 anchors the balance (`finance.participants.description`); the viewer is preselected
 * for it when the household has no participants yet.
 */
import type { FinanceParticipantResponse, HouseholdMember, UpdateFinanceParticipantsRequest } from "@toon/shared";

/** A person who can be seated: the household member's user id and the name shown for them. */
export interface AssignableMember {
  userId: string;
  name: string;
}

/** The two selects' values; an empty string means "not chosen yet". */
export interface Assignment {
  slot1: string;
  slot2: string;
}

export interface AssignmentOption {
  value: string;
  label: string;
}

/** Core household members (`householdMembersQuery`) to the helpers' minimal shape. */
export function toAssignable(members: readonly HouseholdMember[]): AssignableMember[] {
  return members.map((member) => ({ userId: member.userId, name: member.user.name }));
}

/**
 * The starting values of the two selects.
 *
 *  - Two participants exist: their slots, exactly (a re-enable or the settings section).
 *  - Otherwise: the viewer in slot 1 (the first member when the viewer is not a member, which
 *    cannot happen in the UI but must not throw), slot 2 empty so the person chooses, unless
 *    exactly one other member exists, which is then the only sensible choice.
 */
export function initialAssignment(
  members: readonly AssignableMember[],
  viewerId: string | null,
  current?: readonly FinanceParticipantResponse[] | null,
): Assignment {
  const first = current?.find((item) => item.memberSlot === 1);
  const second = current?.find((item) => item.memberSlot === 2);
  if (first && second) return { slot1: first.userId, slot2: second.userId };

  const viewer = members.find((member) => member.userId === viewerId) ?? members[0];
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

/** The PUT / enable body, or null while the assignment is incomplete or invalid. */
export function assignmentBody(assignment: Assignment): UpdateFinanceParticipantsRequest | null {
  if (!isAssignmentComplete(assignment)) return null;
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
 * member (their display name), so the select never shows a value it cannot list.
 */
export function assignmentOptions(
  members: readonly AssignableMember[],
  current?: readonly FinanceParticipantResponse[] | null,
): AssignmentOption[] {
  const options = members.map((member) => ({ value: member.userId, label: member.name }));
  for (const item of current ?? []) {
    if (!options.some((option) => option.value === item.userId)) {
      options.push({ value: item.userId, label: item.displayName });
    }
  }
  return options;
}
