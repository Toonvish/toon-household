/** Colours and names (plan m8 P9a, M8-T13). */
import { afterAll, describe, expect, test } from "bun:test";
import { DEFAULT_LOCALE, type HouseholdMember } from "@toon/shared";
import { setLocaleForTest } from "@/lib/i18n";
import {
  calendarMembersFromHousehold,
  memberMap,
  memberName,
  occurrencePeople,
  personColorClass,
  wasteColorClass,
} from "./people";

afterAll(() => setLocaleForTest(DEFAULT_LOCALE));

function member(userId: string, name: string, createdAt: string, hasAccount = true): HouseholdMember {
  return {
    id: `m-${userId}`,
    householdId: "h",
    userId,
    role: "member",
    createdAt,
    user: { id: userId, name, email: hasAccount ? `${userId}@x.test` : null },
    hasAccount,
  };
}

describe("colours", () => {
  test("literal utilities for person and waste colours", () => {
    expect(personColorClass(1)).toBe("bg-person-1");
    expect(personColorClass(6)).toBe("bg-person-6");
    expect(personColorClass(0)).toBe("bg-person-1");
    expect(wasteColorClass("waste_yellow")).toBe("bg-waste-yellow");
  });

  test("the core members list sorted by join time, coloured by position (the API's rule)", () => {
    const members = calendarMembersFromHousehold([
      member("c", "Kim", "2026-01-03T00:00:00.000Z", false),
      member("a", "Eric", "2026-01-01T00:00:00.000Z"),
      member("b", "Robin", "2026-01-01T00:00:00.000Z"),
    ]);
    expect(members.map((m) => [m.name, m.colorIndex, m.hasAccount])).toEqual([
      ["Eric", 1, true],
      ["Robin", 2, true],
      ["Kim", 3, false],
    ]);
  });
});

describe("names", () => {
  test("a known member by name, an unknown id as a former member", () => {
    setLocaleForTest("de");
    const map = memberMap([{ userId: "a", name: "Eric", colorIndex: 1, hasAccount: true }]);
    expect(memberName(map, "a")).toBe("Eric");
    expect(memberName(map, "gone")).toBe("Ehemaliges Mitglied");
  });

  test("a task names its assignee, an event or booking its attendees", () => {
    expect(occurrencePeople({ kind: "task", assigneeId: "a", memberIds: [] })).toEqual(["a"]);
    expect(occurrencePeople({ kind: "task", assigneeId: null, memberIds: [] })).toEqual([]);
    expect(occurrencePeople({ kind: "event", assigneeId: null, memberIds: ["a", "b"] })).toEqual(["a", "b"]);
  });
});
