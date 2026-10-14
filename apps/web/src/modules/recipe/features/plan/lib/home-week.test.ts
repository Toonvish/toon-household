import { describe, expect, test } from "bun:test";
import { planWeek } from "@toon/shared";
import { activeShoppingList, homeWeekDays, upcomingEntries } from "./home-week";

// 2026-10-12 is a Monday.
const week = planWeek("2026-10-12");
const e = (plannedOn: string, position = 0, id = `${plannedOn}-${position}`) => ({ id, plannedOn, position });

describe("homeWeekDays", () => {
  test("always seven days, Monday first", () => {
    const days = homeWeekDays([], week, "2026-10-14");
    expect(days).toHaveLength(7);
    expect(days[0]!.date).toBe("2026-10-12");
    expect(days[6]!.date).toBe("2026-10-18");
  });

  test("an empty week: only today is not empty", () => {
    const days = homeWeekDays([], week, "2026-10-14");
    expect(days.map((d) => d.state)).toEqual(["empty", "empty", "today", "empty", "empty", "empty", "empty"]);
    expect(days.every((d) => d.count === 0)).toBe(true);
  });

  test("today on Monday", () => {
    const days = homeWeekDays([e("2026-10-13")], week, "2026-10-12");
    expect(days[0]!.state).toBe("today");
    expect(days[1]!.state).toBe("planned");
  });

  test("today on Sunday", () => {
    const days = homeWeekDays([e("2026-10-18")], week, "2026-10-18");
    expect(days[6]).toEqual({ date: "2026-10-18", state: "today", count: 1 });
  });

  test("several entries on one day are counted, and today wins over planned", () => {
    const days = homeWeekDays([e("2026-10-14", 0), e("2026-10-14", 1), e("2026-10-15", 0), e("2026-10-15", 1), e("2026-10-15", 2)], week, "2026-10-14");
    expect(days[2]).toEqual({ date: "2026-10-14", state: "today", count: 2 });
    expect(days[3]).toEqual({ date: "2026-10-15", state: "planned", count: 3 });
  });

  test("a day before today keeps its planned state", () => {
    expect(homeWeekDays([e("2026-10-12")], week, "2026-10-14")[0]!.state).toBe("planned");
  });
});

describe("upcomingEntries", () => {
  test("drops past days, sorts by day then position, caps at max", () => {
    const entries = [e("2026-10-16", 0), e("2026-10-13", 0), e("2026-10-14", 1), e("2026-10-14", 0), e("2026-10-17", 0)];
    expect(upcomingEntries(entries, "2026-10-14").map((x) => x.id)).toEqual(["2026-10-14-0", "2026-10-14-1", "2026-10-16-0"]);
    expect(upcomingEntries(entries, "2026-10-14", 2)).toHaveLength(2);
  });

  test("empty input and nothing upcoming", () => {
    expect(upcomingEntries([], "2026-10-14")).toEqual([]);
    expect(upcomingEntries([e("2026-10-01")], "2026-10-14")).toEqual([]);
  });

  test("does not mutate its input", () => {
    const entries = [e("2026-10-16"), e("2026-10-15")];
    upcomingEntries(entries, "2026-10-14");
    expect(entries.map((x) => x.id)).toEqual(["2026-10-16-0", "2026-10-15-0"]);
  });
});

describe("activeShoppingList", () => {
  test("the first list", () => {
    expect(activeShoppingList([{ id: "a" }, { id: "b" }])?.id).toBe("a");
  });
  test("no lists", () => {
    expect(activeShoppingList([])).toBeNull();
  });
});
