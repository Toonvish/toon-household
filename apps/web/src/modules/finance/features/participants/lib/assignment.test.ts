import { describe, expect, test } from "bun:test";
import type { FinanceParticipantResponse } from "@toon/shared";
import {
  assignmentBody,
  assignmentChanged,
  assignmentError,
  assignmentOptions,
  initialAssignment,
  isAssignmentComplete,
  type AssignableMember,
} from "./assignment";

const anna: AssignableMember = { userId: "u-anna", name: "Anna" };
const ben: AssignableMember = { userId: "u-ben", name: "Ben" };
const cleo: AssignableMember = { userId: "u-cleo", name: "Cleo" };

function participant(userId: string, memberSlot: 1 | 2, displayName = userId): FinanceParticipantResponse {
  return { userId, memberSlot, displayName, name: displayName, email: `${userId}@x.test`, hasAccount: true, joinedAt: "2026-01-01T00:00:00.000Z" };
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
