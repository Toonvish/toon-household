/** Grouping for the agenda, the Today card and the month grid (plan m8 M8-T13). */
import { describe, expect, test } from "bun:test";
import type { CalendarOccurrence } from "@toon/shared";
import {
  addMonths,
  agendaRows,
  groupByDay,
  isCalendarMonth,
  isWeekend,
  matchesMember,
  monthGridDays,
  occurrencesOn,
  overdueTasks,
  tonightPickups,
} from "./group";

const ENTRY = "11111111-1111-4111-8111-111111111111";

function occ(partial: Partial<CalendarOccurrence> & { date: string; key?: string }): CalendarOccurrence {
  const entryId = partial.entryId ?? ENTRY;
  return {
    id: `${entryId}:${partial.date}${partial.key ?? ""}`,
    entryId,
    kind: "event",
    title: "x",
    category: null,
    categoryDetail: null,
    endDate: partial.date,
    allDay: true,
    startTime: null,
    endTime: null,
    location: null,
    recurring: false,
    memberIds: [],
    assigneeId: null,
    resourceId: null,
    status: "open",
    doneBy: null,
    ...partial,
  };
}

describe("agendaRows", () => {
  test("the pickups of one day merge into ONE row at the first pickup's position", () => {
    const rows = agendaRows([
      occ({ date: "2026-11-12", kind: "task", title: null, category: "waste_rest", key: "a" }),
      occ({ date: "2026-11-12", kind: "task", title: null, category: "waste_yellow", key: "b" }),
      occ({ date: "2026-11-12", allDay: false, startTime: "18:30", title: "Elternabend", key: "c" }),
    ]);
    expect(rows.map((row) => row.type)).toEqual(["waste", "occurrence"]);
    const waste = rows[0];
    expect(waste?.type === "waste" ? waste.occurrences.map((o) => o.category) : []).toEqual(["waste_rest", "waste_yellow"]);
  });
});

describe("groupByDay", () => {
  test("days in order, empty days skipped, a running span listed on `from`", () => {
    const days = groupByDay(
      [
        occ({ date: "2026-11-09", endDate: "2026-11-13", title: "Urlaub" }),
        occ({ date: "2026-11-12", title: "A" }),
        occ({ date: "2026-11-14", title: "B" }),
        occ({ date: "2026-11-30", title: "outside" }),
      ],
      "2026-11-11",
      "2026-11-24",
    );
    expect(days.map((day) => day.date)).toEqual(["2026-11-11", "2026-11-12", "2026-11-14"]);
  });

  test("occurrencesOn covers every day of a span", () => {
    const items = [occ({ date: "2026-11-09", endDate: "2026-11-13" }), occ({ date: "2026-11-14" })];
    expect(occurrencesOn(items, "2026-11-13")).toHaveLength(1);
    expect(occurrencesOn(items, "2026-11-14")).toHaveLength(1);
    expect(occurrencesOn(items, "2026-11-15")).toHaveLength(0);
  });
});

describe("tonightPickups (\"Heute Abend rausstellen\")", () => {
  test("tomorrow's types in display order, without skipped ones and without today's", () => {
    const items = [
      occ({ date: "2026-11-12", kind: "task", category: "waste_yellow", key: "y" }),
      occ({ date: "2026-11-12", kind: "task", category: "waste_rest", key: "r" }),
      occ({ date: "2026-11-12", kind: "task", category: "waste_paper", key: "p", status: "skipped" }),
      occ({ date: "2026-11-11", kind: "task", category: "waste_bio", key: "b" }),
    ];
    expect(tonightPickups(items, "2026-11-11")).toEqual(["waste_rest", "waste_yellow"]);
    expect(tonightPickups(items, "2026-11-12")).toEqual([]);
  });
});

describe("overdueTasks", () => {
  test("open tasks of the last 7 days, never pickups, never done or future ones", () => {
    const items = [
      occ({ date: "2026-11-10", kind: "task", title: "open", key: "1" }),
      occ({ date: "2026-11-04", kind: "task", title: "seven days back", key: "2" }),
      occ({ date: "2026-11-03", kind: "task", title: "too old", key: "3" }),
      occ({ date: "2026-11-10", kind: "task", title: "done", status: "done", key: "4" }),
      occ({ date: "2026-11-10", kind: "task", category: "waste_rest", title: null, key: "5" }),
      occ({ date: "2026-11-10", kind: "event", title: "event", key: "6" }),
      occ({ date: "2026-11-11", kind: "task", title: "today", key: "7" }),
    ];
    expect(overdueTasks(items, "2026-11-11").map((o) => o.title)).toEqual(["open", "seven days back"]);
  });
});

describe("month grid", () => {
  test("whole ISO weeks from Monday to Sunday", () => {
    const november = monthGridDays("2026-11");
    expect(november[0]).toBe("2026-10-26");
    expect(november.at(-1)).toBe("2026-12-06");
    expect(november).toHaveLength(42);
    const february = monthGridDays("2027-02");
    expect(february[0]).toBe("2027-02-01");
    expect(february).toHaveLength(28);
  });

  test("months step across years; only real months are months", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2027-03", -14)).toBe("2026-01");
    expect(isCalendarMonth("2027-13")).toBe(false);
    expect(isCalendarMonth("2027-1")).toBe(false);
    expect(isCalendarMonth("2027-01")).toBe(true);
    expect(isCalendarMonth(undefined)).toBe(false);
    expect(isWeekend("2026-11-14")).toBe(true);
    expect(isWeekend("2026-11-13")).toBe(false);
  });
});

describe("matchesMember (the P10 rule, client side)", () => {
  test("attendee, assignee, or nobody named", () => {
    expect(matchesMember({ memberIds: ["a"], assigneeId: null }, "a")).toBe(true);
    expect(matchesMember({ memberIds: ["b"], assigneeId: null }, "a")).toBe(false);
    expect(matchesMember({ memberIds: [], assigneeId: "a" }, "a")).toBe(true);
    expect(matchesMember({ memberIds: [], assigneeId: "b" }, "a")).toBe(false);
    expect(matchesMember({ memberIds: [], assigneeId: null }, "a")).toBe(true);
    expect(matchesMember({ memberIds: ["b"], assigneeId: null }, undefined)).toBe(true);
  });
});
