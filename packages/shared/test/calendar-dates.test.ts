/** The calendar's date arithmetic without `Date` (plan m8 P2), checked against `Date.UTC` as an oracle. */
import { describe, expect, test } from "bun:test";
import {
  addCalendarDays,
  calendarDayNumber,
  calendarDaysBetween,
  calendarWeekday,
  compareDateTime,
  daysInCalendarMonth,
  fromDayNumber,
  isCalendarDate,
  isCalendarTime,
  isLeapYear,
} from "../src/index.ts";

const DAY_MS = 86_400_000;

/** The oracle: what `Date.UTC` says (tests may use `Date`; the module may not). */
function utcDayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

describe("calendarDayNumber / fromDayNumber", () => {
  test("1970-01-01 is day 0", () => {
    expect(calendarDayNumber("1970-01-01")).toBe(0);
    expect(fromDayNumber(0)).toBe("1970-01-01");
  });

  test("agrees with Date.UTC on every day from 1899 to 2201 and round-trips", () => {
    const first = utcDayNumber("1899-01-01");
    const last = utcDayNumber("2201-12-31");
    for (let day = first; day <= last; day += 1) {
      const iso = new Date(day * DAY_MS).toISOString().slice(0, 10);
      expect(fromDayNumber(day)).toBe(iso);
      expect(calendarDayNumber(iso)).toBe(day);
    }
  });

  test("days before the epoch are negative", () => {
    expect(calendarDayNumber("1969-12-31")).toBe(-1);
    expect(fromDayNumber(-1)).toBe("1969-12-31");
  });
});

describe("addCalendarDays / calendarDaysBetween", () => {
  test("crosses months, years and leap days", () => {
    expect(addCalendarDays("2027-12-31", 1)).toBe("2028-01-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addCalendarDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(addCalendarDays("2026-03-28", 2)).toBe("2026-03-30"); // the DST weekend in Europe/Berlin is no special case
  });

  test("between is the difference of day numbers, inclusive ranges add one", () => {
    expect(calendarDaysBetween("2027-01-01", "2027-01-01")).toBe(0);
    expect(calendarDaysBetween("2027-01-01", "2027-12-31")).toBe(364);
    expect(calendarDaysBetween("2028-01-01", "2028-12-31")).toBe(365);
    expect(calendarDaysBetween("2027-01-10", "2027-01-01")).toBe(-9);
  });
});

describe("calendarWeekday (0 = Monday)", () => {
  test.each([
    ["2027-01-04", 0],
    ["2027-01-05", 1],
    ["2027-01-01", 4],
    ["2027-01-03", 6],
    ["1970-01-01", 3],
    ["2000-02-29", 1],
  ] as const)("%s is %i", (date, weekday) => {
    expect(calendarWeekday(date)).toBe(weekday);
  });

  test("agrees with Date#getUTCDay over four years", () => {
    for (let day = utcDayNumber("2026-01-01"); day <= utcDayNumber("2029-12-31"); day += 1) {
      const date = new Date(day * DAY_MS);
      expect(calendarWeekday(date.toISOString().slice(0, 10))).toBe((date.getUTCDay() + 6) % 7);
    }
  });
});

describe("leap years and month lengths", () => {
  test("Gregorian leap rule", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2027)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
  });

  test("days per month", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInCalendarMonth(2027, m))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
    expect(daysInCalendarMonth(2028, 2)).toBe(29);
  });
});

describe("isCalendarDate / isCalendarTime", () => {
  test.each(["2027-01-01", "2028-02-29", "2027-12-31", "1900-01-01"])("%s is a date", (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  test.each(["2027-02-29", "2027-04-31", "2027-13-01", "2027-00-10", "2027-01-00", "27-01-01", "2027-1-1", "2027-01-01T00:00", "", "0000-01-01"])(
    "%s is not",
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );

  test.each(["00:00", "08:05", "23:59", "12:30"])("%s is a time", (value) => {
    expect(isCalendarTime(value)).toBe(true);
  });

  test.each(["24:00", "8:05", "08:60", "08:5", "08:05:00", ""])("%s is not", (value) => {
    expect(isCalendarTime(value)).toBe(false);
  });
});

describe("compareDateTime", () => {
  test("date first, then all-day before timed, then time", () => {
    expect(compareDateTime("2027-01-01", "23:00", "2027-01-02", null)).toBeLessThan(0);
    expect(compareDateTime("2027-01-02", null, "2027-01-02", "00:00")).toBeLessThan(0);
    expect(compareDateTime("2027-01-02", "09:00", "2027-01-02", "08:00")).toBeGreaterThan(0);
    expect(compareDateTime("2027-01-02", "09:00", "2027-01-02", "09:00")).toBe(0);
    expect(compareDateTime("2027-01-02", null, "2027-01-02", null)).toBe(0);
  });
});
