/** The calendar's labels in both locales (plan m8 M8-T13): dates, day headings, times, waste labels. */
import { afterAll, describe, expect, test } from "bun:test";
import { DEFAULT_LOCALE } from "@toon/shared";
import { setLocaleForTest } from "@/lib/i18n";
import {
  entryTitle,
  formatDayHeading,
  formatDayMonth,
  formatLongDate,
  formatMonthTitle,
  formatShortDate,
  formatTimeRange,
  formatWhen,
  wasteLabel,
  wasteListLabel,
  weekdayLong,
  weekdayShort,
} from "./format";

afterAll(() => setLocaleForTest(DEFAULT_LOCALE));

describe("German", () => {
  test("weekdays and dates (2026-11-11 is a Wednesday)", () => {
    setLocaleForTest("de");
    expect(weekdayShort("2026-11-11")).toBe("Mi");
    expect(weekdayLong("2026-11-15")).toBe("Sonntag");
    expect(formatShortDate("2026-11-13")).toBe("Fr 13.11.");
    expect(formatShortDate("2028-01-03", "2027-12-30")).toBe("Mo 03.01.2028");
    expect(formatShortDate("2027-12-31", "2027-01-01")).toBe("Fr 31.12.");
    expect(formatLongDate("2026-11-11")).toBe("Mittwoch, 11. November");
    expect(formatDayMonth("2027-03-05")).toBe("05.03.");
    expect(formatMonthTitle("2027-03")).toBe("März 2027");
  });

  test("day headings: today long, tomorrow short, the rest short", () => {
    setLocaleForTest("de");
    expect(formatDayHeading("2026-11-11", "2026-11-11")).toBe("Heute · Mittwoch, 11. November");
    expect(formatDayHeading("2026-11-12", "2026-11-11")).toBe("Morgen · Do 12.11.");
    expect(formatDayHeading("2026-11-13", "2026-11-11")).toBe("Fr 13.11.");
    // across the turn of the year: tomorrow is in the next year
    expect(formatDayHeading("2027-01-01", "2026-12-31")).toBe("Morgen · Fr 01.01.2027");
  });

  test("times: all-day, start only, a range, several days", () => {
    setLocaleForTest("de");
    expect(formatTimeRange("08:00", "17:00")).toBe("08:00–17:00");
    expect(formatTimeRange("08:00", null)).toBe("08:00");
    expect(formatWhen({ date: "2026-11-12", allDay: true, startTime: null, endTime: null })).toBe("ganztägig");
    expect(formatWhen({ date: "2026-11-12", allDay: false, startTime: "18:30", endTime: null })).toBe("18:30");
    expect(
      formatWhen({ date: "2026-11-13", endDate: "2026-11-15", allDay: true, startTime: null, endTime: null }),
    ).toBe("Fr 13.11. bis So 15.11.");
    expect(
      formatWhen({ date: "2026-11-13", endDate: "2026-11-14", allDay: false, startTime: "18:00", endTime: "10:00" }),
    ).toBe("Fr 13.11. 18:00 bis Sa 14.11. 10:00");
  });

  test("waste labels from the catalog, the cleaning suffix, a merged day", () => {
    setLocaleForTest("de");
    expect(wasteLabel("waste_rest")).toBe("Restmüll");
    expect(wasteLabel("waste_bio", "bio_cleaning")).toBe("Biotonne + Reinigung");
    expect(wasteListLabel([{ category: "waste_rest" }, { category: "waste_yellow" }])).toBe("Restmüll · Gelber Sack");
    expect(entryTitle({ title: null, category: "waste_paper", categoryDetail: null })).toBe("Papiertonne");
    expect(entryTitle({ title: "Zahnarzt", category: null, categoryDetail: null })).toBe("Zahnarzt");
    expect(entryTitle({ title: null, category: null, categoryDetail: null })).toBe("Ohne Titel");
  });
});

describe("English", () => {
  test("the same values in English order", () => {
    setLocaleForTest("en");
    expect(formatShortDate("2026-11-13")).toBe("Fri 13/11");
    expect(formatLongDate("2026-11-11")).toBe("Wednesday, 11 November");
    expect(formatDayHeading("2026-11-11", "2026-11-11")).toBe("Today · Wednesday, 11 November");
    expect(formatDayHeading("2026-11-12", "2026-11-11")).toBe("Tomorrow · Thu 12/11");
    expect(formatWhen({ date: "2026-11-12", allDay: true, startTime: null, endTime: null })).toBe("all day");
    expect(wasteLabel("waste_bio", "bio_cleaning")).toBe("Organic bin + cleaning");
    expect(formatMonthTitle("2027-12")).toBe("December 2027");
  });
});
