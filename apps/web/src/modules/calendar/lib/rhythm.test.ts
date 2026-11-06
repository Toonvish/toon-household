/** A rhythm in words for every freq, the preview dates and the rotation's pick (plan m8 M8-T13). */
import { afterAll, describe, expect, test } from "bun:test";
import { DEFAULT_LOCALE, type CalendarRepeat } from "@toon/shared";
import { setLocaleForTest } from "@/lib/i18n";
import { nextAssignment, nextDates, rhythmLabel, rotationPick, seriesOf, weeklyDays } from "./rhythm";

afterAll(() => setLocaleForTest(DEFAULT_LOCALE));

const repeat = (partial: Partial<CalendarRepeat> & Pick<CalendarRepeat, "freq">): CalendarRepeat => ({
  interval: 1,
  weekdays: [],
  until: null,
  ...partial,
});

describe("rhythmLabel (de)", () => {
  test("every freq, interval 1 and more", () => {
    setLocaleForTest("de");
    expect(rhythmLabel(repeat({ freq: "none" }), "2026-11-11")).toBe("einmalig");
    expect(rhythmLabel(repeat({ freq: "daily" }), "2026-11-11")).toBe("täglich");
    expect(rhythmLabel(repeat({ freq: "daily", interval: 3 }), "2026-11-11")).toBe("alle 3 Tage");
    expect(rhythmLabel(repeat({ freq: "weekly", weekdays: ["TH", "MO"] }), "2026-11-11")).toBe("jeden Mo, Do");
    expect(rhythmLabel(repeat({ freq: "weekly" }), "2026-11-14")).toBe("jeden Sa");
    expect(rhythmLabel(repeat({ freq: "weekly", interval: 2 }), "2026-11-14")).toBe("alle 2 Wochen: Sa");
    expect(rhythmLabel(repeat({ freq: "monthly" }), "2026-11-13")).toBe("monatlich am 13.");
    expect(rhythmLabel(repeat({ freq: "monthly", interval: 3 }), "2026-11-13")).toBe("alle 3 Monate am 13.");
    expect(rhythmLabel(repeat({ freq: "yearly" }), "2026-11-13")).toBe("jährlich am 13.11.");
    expect(rhythmLabel(repeat({ freq: "daily", until: "2026-12-31" }), "2026-11-11")).toBe("täglich bis Do 31.12.");
  });

  test("English", () => {
    setLocaleForTest("en");
    expect(rhythmLabel(repeat({ freq: "daily", interval: 3 }), "2026-11-11")).toBe("every 3 days");
    expect(rhythmLabel(repeat({ freq: "weekly", weekdays: ["MO", "TH"] }), "2026-11-11")).toBe("every Mon, Thu");
    expect(rhythmLabel(repeat({ freq: "yearly" }), "2026-11-13")).toBe("yearly on 13/11");
  });
});

describe("dates and the rotation", () => {
  const entry = {
    startDate: "2026-11-01",
    endDate: "2026-11-01",
    repeat: repeat({ freq: "daily", interval: 3 }),
    assigneeMode: "rotate" as const,
    assigneeIds: ["a", "b", "c"],
  };

  test("weekly days default to the start's weekday and come in ISO order", () => {
    expect(weeklyDays({ weekdays: [] }, "2026-11-11")).toEqual(["WE"]);
    expect(weeklyDays({ weekdays: ["SU", "MO"] }, "2026-11-11")).toEqual(["MO", "SU"]);
  });

  test("the preview's next dates", () => {
    expect(nextDates(seriesOf(entry), "2026-11-11", 3)).toEqual(["2026-11-13", "2026-11-16", "2026-11-19"]);
  });

  test("the next person of a rotation counts every occurrence since the start", () => {
    // 2026-11-13 is the fifth occurrence (ordinal 4): 4 mod 3 = 1 -> "b"
    expect(nextAssignment(entry, "2026-11-11")).toEqual({ date: "2026-11-13", ordinal: 4, userId: "b" });
    expect(nextAssignment({ ...entry, assigneeMode: "fixed", assigneeIds: ["k"] }, "2026-11-11")?.userId).toBe("k");
    expect(nextAssignment({ ...entry, assigneeMode: "none", assigneeIds: [] }, "2026-11-11")?.userId).toBeNull();
    expect(nextAssignment({ ...entry, repeat: repeat({ freq: "none" }) }, "2026-11-11")).toBeNull();
    expect(rotationPick([], 3)).toBeNull();
    expect(rotationPick(["a", "b"], 5)).toBe("b");
  });
});
