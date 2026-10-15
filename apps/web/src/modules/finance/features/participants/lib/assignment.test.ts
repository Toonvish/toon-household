import { describe, expect, test } from "bun:test";
import type { FinanceParticipantResponse, HouseholdMember } from "@toon/shared";
import {
  assignmentBody,
  assignmentChanged,
  assignmentError,
  assignmentOptions,
  initialAssignment,
  isAssignmentComplete,
  slotOneIsPlaceholder,
  toAssignable,
  withBadge,
  type AssignableMember,
} from "./assignment";

const anna: AssignableMember = { userId: "u-anna", name: "Anna" };
const ben: AssignableMember = { userId: "u-ben", name: "Ben" };
const cleo: AssignableMember = { userId: "u-cleo", name: "Cleo" };
/** A person without an account (ADR 0006): a core placeholder member. */
const pia: AssignableMember = { userId: "u-pia", name: "Pia", hasAccount: false };

function participant(userId: string, memberSlot: 1 | 2, displayName = userId): FinanceParticipantResponse {
  return {
    userId,
    memberSlot,
    displayName,
    name: displayName,
    email: `${userId}@x.test`,
    hasAccount: true,
    joinedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("initialAssignment", () => {
  test("viewer in slot 1, slot 2 empty when several others exist", () => {
    expect(initialAssignment([anna, ben, cleo], "u-ben")).toEqual({ slot1: "u-ben", slot2: "" });
  });

  test("the single other member is preselected for slot 2", () => {
    expect(initialAssignment([anna, ben], "u-anna")).toEqual({ slot1: "u-anna", slot2: "u-ben" });
  });

  test("a viewer who is not listed falls back to the first member", () => {
    expect(initialAssignment([anna, ben, cleo], "u-x")).toEqual({ slot1: "u-anna", slot2: "" });
  });

  test("no members yields empty slots", () => {
    expect(initialAssignment([], "u-anna")).toEqual({ slot1: "", slot2: "" });
  });

  test("existing participants win, by slot, not by array order", () => {
    const current = [participant("u-cleo", 2), participant("u-anna", 1)];
    expect(initialAssignment([anna, ben, cleo], "u-ben", current)).toEqual({ slot1: "u-anna", slot2: "u-cleo" });
  });

  test("fewer than two current participants are ignored", () => {
    expect(initialAssignment([anna, ben, cleo], "u-anna", [participant("u-ben", 1)])).toEqual({
      slot1: "u-anna",
      slot2: "",
    });
  });
});

describe("assignmentError", () => {
  test("the same person twice is sameMember", () => {
    expect(assignmentError({ slot1: "u-anna", slot2: "u-anna" })).toBe("finance.participants.sameMember");
  });

  test("two different people and unchosen slots are no error", () => {
    expect(assignmentError({ slot1: "u-anna", slot2: "u-ben" })).toBeNull();
    expect(assignmentError({ slot1: "u-anna", slot2: "" })).toBeNull();
    expect(assignmentError({ slot1: "", slot2: "" })).toBeNull();
  });
});

describe("assignmentBody / isAssignmentComplete", () => {
  test("builds the PUT body with slots 1 and 2", () => {
    expect(assignmentBody({ slot1: "u-anna", slot2: "u-ben" })).toEqual({
      participants: [
        { userId: "u-anna", memberSlot: 1 },
        { userId: "u-ben", memberSlot: 2 },
      ],
    });
  });

  test("is null while incomplete or invalid", () => {
    expect(assignmentBody({ slot1: "u-anna", slot2: "" })).toBeNull();
    expect(assignmentBody({ slot1: "u-anna", slot2: "u-anna" })).toBeNull();
    expect(isAssignmentComplete({ slot1: "u-anna", slot2: "u-ben" })).toBe(true);
    expect(isAssignmentComplete({ slot1: "", slot2: "u-ben" })).toBe(false);
  });
});

describe("assignmentChanged", () => {
  const current = [participant("u-anna", 1), participant("u-ben", 2)];

  test("false for the same seating, true for a swap or a replacement", () => {
    expect(assignmentChanged({ slot1: "u-anna", slot2: "u-ben" }, current)).toBe(false);
    expect(assignmentChanged({ slot1: "u-ben", slot2: "u-anna" }, current)).toBe(true);
    expect(assignmentChanged({ slot1: "u-anna", slot2: "u-cleo" }, current)).toBe(true);
  });

  test("true against no participants", () => {
    expect(assignmentChanged({ slot1: "u-anna", slot2: "u-ben" }, undefined)).toBe(true);
  });
});

describe("assignmentOptions", () => {
  test("lists the members", () => {
    expect(assignmentOptions([anna, ben])).toEqual([
      { value: "u-anna", label: "Anna" },
      { value: "u-ben", label: "Ben" },
    ]);
  });

  test("adds a participant who left the household, by display name", () => {
    const options = assignmentOptions([anna], [participant("u-anna", 1), participant("u-gone", 2, "Gone")]);
    expect(options).toEqual([
      { value: "u-anna", label: "Anna" },
      { value: "u-gone", label: "Gone" },
    ]);
  });
});

describe("placeholders (ADR 0006, plan m3b decision 6): slot 2 only", () => {
  test("toAssignable carries hasAccount from the core member", () => {
    const member = { userId: "u-pia", user: { name: "Pia" }, hasAccount: false } as unknown as HouseholdMember;
    expect(toAssignable([member])).toEqual([{ userId: "u-pia", name: "Pia", hasAccount: false }]);
  });

  test("the slot-1 options leave a placeholder out, the slot-2 options mark it", () => {
    expect(assignmentOptions([anna, pia], null, 1)).toEqual([{ value: "u-anna", label: "Anna" }]);
    expect(assignmentOptions([anna, pia], null, 2)).toEqual([
      { value: "u-anna", label: "Anna" },
      { value: "u-pia", label: "Pia", placeholder: true },
    ]);
    // the default is slot 2, so the existing two-argument callers are unchanged
    expect(assignmentOptions([anna, pia])).toEqual(assignmentOptions([anna, pia], null, 2));
  });

  test("withBadge appends the badge to a placeholder only", () => {
    expect(withBadge(assignmentOptions([anna, pia]), "ohne Konto")).toEqual([
      { value: "u-anna", label: "Anna" },
      { value: "u-pia", label: "Pia (ohne Konto)" },
    ]);
  });

  test("a placeholder participant who is no longer listed follows the same rule", () => {
    const gone = { ...participant("u-gone", 2, "Gone"), hasAccount: false };
    expect(assignmentOptions([anna], [participant("u-anna", 1), gone], 1)).toEqual([
      { value: "u-anna", label: "Anna" },
    ]);
    expect(assignmentOptions([anna], [participant("u-anna", 1), gone], 2)).toEqual([
      { value: "u-anna", label: "Anna" },
      { value: "u-gone", label: "Gone", placeholder: true },
    ]);
  });

  test("the viewer takes slot 1 and the one placeholder slot 2", () => {
    expect(initialAssignment([anna, pia], "u-anna")).toEqual({ slot1: "u-anna", slot2: "u-pia" });
  });

  test("a viewer who is not listed falls back to the first member WITH an account", () => {
    expect(initialAssignment([pia, anna, ben], "u-x")).toEqual({ slot1: "u-anna", slot2: "" });
  });

  test("a placeholder is never preselected for slot 1, even for a placeholder viewer id", () => {
    expect(initialAssignment([pia, anna], "u-pia").slot1).toBe("u-anna");
  });

  test("a placeholder alone in slot 1 (ADR 0004 re-seat) is moved to slot 2 by the preselection", () => {
    const alone = [{ ...participant("u-pia", 1, "Pia"), hasAccount: false }];
    expect(initialAssignment([anna, pia], "u-anna", alone)).toEqual({ slot1: "u-anna", slot2: "u-pia" });
    expect(assignmentChanged({ slot1: "u-anna", slot2: "u-pia" }, alone)).toBe(true);
  });

  test("slotOneIsPlaceholder reads the members, then the participants", () => {
    expect(slotOneIsPlaceholder({ slot1: "u-pia", slot2: "u-anna" }, [anna, pia])).toBe(true);
    expect(slotOneIsPlaceholder({ slot1: "u-anna", slot2: "u-pia" }, [anna, pia])).toBe(false);
    const gone = { ...participant("u-gone", 1, "Gone"), hasAccount: false };
    expect(slotOneIsPlaceholder({ slot1: "u-gone", slot2: "u-anna" }, [anna], [gone])).toBe(true);
  });

  test("the body refuses a placeholder in slot 1 and accepts it in slot 2", () => {
    expect(assignmentBody({ slot1: "u-pia", slot2: "u-anna" }, [anna, pia])).toBeNull();
    expect(assignmentBody({ slot1: "u-anna", slot2: "u-pia" }, [anna, pia])).toEqual({
      participants: [
        { userId: "u-anna", memberSlot: 1 },
        { userId: "u-pia", memberSlot: 2 },
      ],
    });
    // without the members the body is built as before (callers that cannot know)
    expect(assignmentBody({ slot1: "u-pia", slot2: "u-anna" })).not.toBeNull();
  });
});
