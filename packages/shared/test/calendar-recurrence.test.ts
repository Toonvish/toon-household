/**
 * Recurrence (plan m8 P3): every freq, intervals, weekday sets, the 31st and 29 February, multi-day overlap at both
 * range edges, `until`, ordinals against a naive day-by-day enumerator, the overflow cap and `occurrenceOrdinal`.
 */
import { describe, expect, test } from "bun:test";
import {
  CALENDAR_LIMITS,
  CALENDAR_WEEKDAYS,
  addCalendarDays,
  calendarDayNumber,
  calendarWeekday,
  expandOccurrences,
  fromDayNumber,
  nextOccurrences,
  occurrenceOrdinal,
  type CalendarSeries,
} from "../src/index.ts";

type Weekday = (typeof CALENDAR_WEEKDAYS)[number];
type Freq = CalendarSeries["repeat"]["freq"];

function series(
  startDate: string,
  freq: Freq,
  options: { interval?: number; weekdays?: Weekday[]; until?: string | null; endDate?: string } = {},
): CalendarSeries {
  return {
    startDate,
    endDate: options.endDate ?? startDate,
    repeat: { freq, interval: options.interval ?? 1, weekdays: options.weekdays ?? [], until: options.until ?? null },
  };
}

function dates(s: CalendarSeries, from: string, to: string): string[] {
  return expandOccurrences(s, from, to).occurrences.map((o) => o.date);
}

/**
 * The oracle: walks EVERY day from the start and asks a direct rule whether an occurrence starts there; the
 * running count is the ordinal. Written independently of the module's arithmetic.
 */
function naive(s: CalendarSeries, to: string): Array<{ date: string; ordinal: number }> {
  const out: Array<{ date: string; ordinal: number }> = [];
  const [sy, sm, sd] = s.startDate.split("-").map(Number) as [number, number, number];
  const startWeekday = calendarWeekday(s.startDate);
  const listed = s.repeat.weekdays.length > 0 ? s.repeat.weekdays.map((w) => CALENDAR_WEEKDAYS.indexOf(w)) : [startWeekday];
  const mondayOfStart = calendarDayNumber(s.startDate) - startWeekday;
  const last = s.repeat.until !== null && s.repeat.until < to ? s.repeat.until : to;
  for (let day = calendarDayNumber(s.startDate); day <= calendarDayNumber(last); day += 1) {
    const date = fromDayNumber(day);
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const months = (y - sy) * 12 + (m - sm);
    let hit = false;
    switch (s.repeat.freq) {
      case "none":
        hit = date === s.startDate;
        break;
      case "daily":
        hit = (day - calendarDayNumber(s.startDate)) % s.repeat.interval === 0;
        break;
      case "weekly":
        hit = Math.floor((day - mondayOfStart) / 7) % s.repeat.interval === 0 && listed.includes(calendarWeekday(date));
        break;
      case "monthly":
        hit = d === sd && months % s.repeat.interval === 0;
        break;
      case "yearly":
        hit = d === sd && m === sm && (y - sy) % s.repeat.interval === 0;
        break;
    }
    if (hit) out.push({ date, ordinal: out.length });
  }
  return out;
}

describe("freq none", () => {
  test("one occurrence, inside or outside the window", () => {
    const s = series("2027-03-10", "none");
    expect(expandOccurrences(s, "2027-03-01", "2027-03-31")).toEqual({
      occurrences: [{ date: "2027-03-10", endDate: "2027-03-10", ordinal: 0 }],
      overflow: false,
    });
    expect(dates(s, "2027-03-11", "2027-04-30")).toEqual([]);
    expect(dates(s, "2027-01-01", "2027-03-09")).toEqual([]);
  });
});

describe("daily", () => {
  test("interval 1 and 3", () => {
    expect(dates(series("2027-01-30", "daily"), "2027-01-30", "2027-02-02")).toEqual([
      "2027-01-30",
      "2027-01-31",
      "2027-02-01",
      "2027-02-02",
    ]);
    const every3 = series("2027-01-01", "daily", { interval: 3 });
    expect(dates(every3, "2027-01-05", "2027-01-15")).toEqual(["2027-01-07", "2027-01-10", "2027-01-13"]);
    expect(expandOccurrences(every3, "2027-01-05", "2027-01-08").occurrences[0]?.ordinal).toBe(2);
  });

  test("never before the start", () => {
    expect(dates(series("2027-01-10", "daily"), "2027-01-01", "2027-01-11")).toEqual(["2027-01-10", "2027-01-11"]);
  });
});

describe("weekly", () => {
  test("default weekday is the start's", () => {
    // 2027-01-07 is a Thursday.
    expect(dates(series("2027-01-07", "weekly"), "2027-01-01", "2027-01-31")).toEqual([
      "2027-01-07",
      "2027-01-14",
      "2027-01-21",
      "2027-01-28",
    ]);
  });

  test("listed weekdays before the start date in week 0 are not occurrences", () => {
    // Wednesday 2027-01-06; Monday and Thursday listed: week 0 has only Thursday 07.
    const s = series("2027-01-06", "weekly", { weekdays: ["MO", "TH"] });
    expect(expandOccurrences(s, "2027-01-01", "2027-01-19").occurrences).toEqual([
      { date: "2027-01-07", endDate: "2027-01-07", ordinal: 0 },
      { date: "2027-01-11", endDate: "2027-01-11", ordinal: 1 },
      { date: "2027-01-14", endDate: "2027-01-14", ordinal: 2 },
      { date: "2027-01-18", endDate: "2027-01-18", ordinal: 3 },
    ]);
  });

  test("interval 2 counts ISO weeks from the start's week", () => {
    // Sunday 2027-01-10 is in the week of Monday 2027-01-04; selected weeks: 04, 18, 01 Feb.
    const s = series("2027-01-10", "weekly", { interval: 2, weekdays: ["MO", "SU"] });
    expect(dates(s, "2027-01-01", "2027-02-07")).toEqual(["2027-01-10", "2027-01-18", "2027-01-24", "2027-02-01", "2027-02-07"]);
  });

  test("weekday order in the input does not matter", () => {
    const a = series("2027-01-04", "weekly", { weekdays: ["FR", "MO", "WE"] });
    const b = series("2027-01-04", "weekly", { weekdays: ["MO", "WE", "FR"] });
    expect(expandOccurrences(a, "2027-01-01", "2027-03-01")).toEqual(expandOccurrences(b, "2027-01-01", "2027-03-01"));
  });
});

describe("monthly", () => {
  test("the 31st skips months without it, and a skipped month is no occurrence", () => {
    const s = series("2027-01-31", "monthly");
    expect(expandOccurrences(s, "2027-01-01", "2027-08-31").occurrences).toEqual([
      { date: "2027-01-31", endDate: "2027-01-31", ordinal: 0 },
      { date: "2027-03-31", endDate: "2027-03-31", ordinal: 1 },
      { date: "2027-05-31", endDate: "2027-05-31", ordinal: 2 },
      { date: "2027-07-31", endDate: "2027-07-31", ordinal: 3 },
      { date: "2027-08-31", endDate: "2027-08-31", ordinal: 4 },
    ]);
  });

  test("interval 3", () => {
    expect(dates(series("2027-01-15", "monthly", { interval: 3 }), "2027-02-01", "2028-01-31")).toEqual([
      "2027-04-15",
      "2027-07-15",
      "2027-10-15",
      "2028-01-15",
    ]);
  });
});

describe("yearly", () => {
  test("29 February only in leap years", () => {
    const s = series("2024-02-29", "yearly");
    expect(expandOccurrences(s, "2024-01-01", "2033-12-31").occurrences.map((o) => [o.date, o.ordinal])).toEqual([
      ["2024-02-29", 0],
      ["2028-02-29", 1],
      ["2032-02-29", 2],
    ]);
  });

  test("interval 2", () => {
    expect(dates(series("2027-06-01", "yearly", { interval: 2 }), "2027-01-01", "2032-12-31")).toEqual([
      "2027-06-01",
      "2029-06-01",
      "2031-06-01",
    ]);
  });

  test("2100 is no leap year", () => {
    expect(dates(series("2096-02-29", "yearly", { interval: 4 }), "2096-01-01", "2105-12-31")).toEqual(["2096-02-29", "2104-02-29"]);
  });
});

describe("until (inclusive, bounds the start date)", () => {
  test("on an occurrence", () => {
    expect(dates(series("2027-01-01", "daily", { interval: 2, until: "2027-01-07" }), "2027-01-01", "2027-01-31")).toEqual([
      "2027-01-01",
      "2027-01-03",
      "2027-01-05",
      "2027-01-07",
    ]);
  });

  test("off an occurrence", () => {
    expect(dates(series("2027-01-01", "daily", { interval: 2, until: "2027-01-06" }), "2027-01-01", "2027-01-31")).toEqual([
      "2027-01-01",
      "2027-01-03",
      "2027-01-05",
    ]);
    expect(dates(series("2027-01-31", "monthly", { until: "2027-04-30" }), "2027-01-01", "2027-12-31")).toEqual(["2027-01-31", "2027-03-31"]);
  });

  test("a multi-day occurrence starting on until still runs past it", () => {
    const s = series("2027-01-01", "weekly", { until: "2027-01-08", endDate: "2027-01-03" });
    expect(expandOccurrences(s, "2027-01-09", "2027-01-31").occurrences).toEqual([
      { date: "2027-01-08", endDate: "2027-01-10", ordinal: 1 },
    ]);
  });
});

describe("multi-day entries overlap the window at both edges", () => {
  // Friday to Sunday, weekly.
  const s = series("2027-01-01", "weekly", { endDate: "2027-01-03" });

  test("an occurrence that started before `from` and ends inside is included", () => {
    expect(expandOccurrences(s, "2027-01-10", "2027-01-14").occurrences).toEqual([
      { date: "2027-01-08", endDate: "2027-01-10", ordinal: 1 },
    ]);
  });

  test("ending exactly on `from - 1` is excluded", () => {
    expect(dates(s, "2027-01-11", "2027-01-14")).toEqual([]);
  });

  test("starting on `to` is included", () => {
    expect(dates(s, "2027-01-11", "2027-01-15")).toEqual(["2027-01-15"]);
  });

  test("a single multi-day event", () => {
    const trip = series("2027-07-30", "none", { endDate: "2027-08-03" });
    expect(dates(trip, "2027-08-01", "2027-08-31")).toEqual(["2027-07-30"]);
    expect(expandOccurrences(trip, "2027-08-01", "2027-08-31").occurrences[0]?.endDate).toBe("2027-08-03");
    expect(dates(trip, "2027-08-04", "2027-08-31")).toEqual([]);
  });
});

describe("ordinals against the naive enumerator (seeded property loop)", () => {
  let seed = 20_271_106;
  const random = (n: number): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % n;
  };
  const freqs: Freq[] = ["daily", "weekly", "monthly", "yearly", "none"];

  test("10-year-old daily, weekly and monthly series", () => {
    const cases: CalendarSeries[] = [
      series("2017-03-31", "daily", { interval: 3 }),
      series("2017-03-31", "weekly", { interval: 2, weekdays: ["TU", "FR", "SU"] }),
      series("2017-01-31", "monthly"),
      series("2017-06-29", "monthly", { interval: 5 }),
    ];
    for (const s of cases) {
      const oracle = naive(s, "2027-12-31").filter((o) => o.date >= "2027-11-01");
      const got = expandOccurrences(s, "2027-11-01", "2027-12-31").occurrences.map((o) => ({ date: o.date, ordinal: o.ordinal }));
      expect(got).toEqual(oracle);
      expect(got.length).toBeGreaterThan(0);
    }
  });

  test("400 random series and windows", () => {
    for (let round = 0; round < 400; round += 1) {
      const freq = freqs[random(freqs.length)]!;
      const start = fromDayNumber(calendarDayNumber("2020-01-01") + random(2000));
      const weekdays = CALENDAR_WEEKDAYS.filter(() => random(3) === 0);
      const interval = 1 + random(freq === "yearly" ? 3 : 6);
      const until = random(3) === 0 ? addCalendarDays(start, random(1500)) : null;
      const s = series(start, freq, { interval, weekdays: freq === "weekly" ? [...weekdays] : [], until });
      const from = addCalendarDays(start, random(1200) - 100);
      const to = addCalendarDays(from, random(400));
      const oracle = naive(s, to).filter((o) => o.date >= from);
      const got = expandOccurrences(s, from, to).occurrences.map((o) => ({ date: o.date, ordinal: o.ordinal }));
      expect(got, JSON.stringify({ s, from, to })).toEqual(oracle);
      for (const hit of oracle.slice(0, 5)) expect(occurrenceOrdinal(s, hit.date)).toBe(hit.ordinal);
    }
  });
});

describe("overflow at the limit", () => {
  const daily = series("2027-01-01", "daily");

  test("exactly the limit is no overflow", () => {
    const result = expandOccurrences(daily, "2027-01-01", "2027-01-10", 10);
    expect(result.occurrences).toHaveLength(10);
    expect(result.overflow).toBe(false);
  });

  test("one more is an overflow, and at most `limit` are returned", () => {
    const result = expandOccurrences(daily, "2027-01-01", "2027-01-11", 10);
    expect(result.occurrences).toHaveLength(10);
    expect(result.overflow).toBe(true);
  });

  test("the default limit is maxOccurrencesPerEntry", () => {
    expect(CALENDAR_LIMITS.maxOccurrencesPerEntry).toBe(2000);
    expect(expandOccurrences(daily, "2027-01-01", addCalendarDays("2027-01-01", 1999)).overflow).toBe(false);
    expect(expandOccurrences(daily, "2027-01-01", addCalendarDays("2027-01-01", 2000)).overflow).toBe(true);
  });
});

describe("occurrenceOrdinal", () => {
  test("on and off an occurrence", () => {
    const s = series("2027-01-01", "daily", { interval: 3, until: "2027-01-31" });
    expect(occurrenceOrdinal(s, "2027-01-01")).toBe(0);
    expect(occurrenceOrdinal(s, "2027-01-10")).toBe(3);
    expect(occurrenceOrdinal(s, "2027-01-11")).toBeNull();
    expect(occurrenceOrdinal(s, "2026-12-29")).toBeNull();
    expect(occurrenceOrdinal(s, "2027-02-03")).toBeNull(); // past until
  });

  test("a single entry", () => {
    const s = series("2027-05-05", "none");
    expect(occurrenceOrdinal(s, "2027-05-05")).toBe(0);
    expect(occurrenceOrdinal(s, "2027-05-06")).toBeNull();
  });

  test("a multi-day occurrence is addressed by its START date only", () => {
    const s = series("2027-01-01", "weekly", { endDate: "2027-01-03" });
    expect(occurrenceOrdinal(s, "2027-01-08")).toBe(1);
    expect(occurrenceOrdinal(s, "2027-01-09")).toBeNull();
  });

  test("a skipped month of the 31st is no occurrence", () => {
    expect(occurrenceOrdinal(series("2027-01-31", "monthly"), "2027-04-30")).toBeNull();
    expect(occurrenceOrdinal(series("2027-01-31", "monthly"), "2027-05-31")).toBe(2);
  });
});

describe("nextOccurrences", () => {
  test("starts on or after `from`, at most `count`", () => {
    const s = series("2027-01-04", "weekly", { weekdays: ["MO", "TH"] });
    expect(nextOccurrences(s, "2027-01-08", 3).map((o) => o.date)).toEqual(["2027-01-11", "2027-01-14", "2027-01-18"]);
    expect(nextOccurrences(s, "2027-01-08", 0)).toEqual([]);
  });

  test("stops at until", () => {
    expect(nextOccurrences(series("2027-01-01", "daily", { until: "2027-01-02" }), "2026-12-01", 5).map((o) => o.date)).toEqual([
      "2027-01-01",
      "2027-01-02",
    ]);
  });
});
