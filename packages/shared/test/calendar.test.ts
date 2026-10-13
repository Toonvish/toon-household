import { describe, expect, test } from "bun:test";
import {
  addPlanDays,
  groupByLocalDay,
  isPlanDate,
  planDaysBetween,
  planWeek,
  startOfPlanWeek,
  toPlanDate,
} from "../src/core/calendar.ts";

describe("toPlanDate — the toISOString() trap", () => {
  test("reads the LOCAL calendar day, not the UTC one, late in the evening", () => {
    // 23:30 local: toISOString() would already have rolled to the next UTC day
    // east of Greenwich. toPlanDate must still report the 8th.
    expect(toPlanDate(new Date(2026, 8, 8, 23, 30))).toBe("2026-09-08");
  });

  test("reads the LOCAL calendar day just after local midnight", () => {
    // 00:30 local: toISOString() would still show the PREVIOUS UTC day west of
    // Greenwich. toPlanDate must still report the 8th.
    expect(toPlanDate(new Date(2026, 8, 8, 0, 30))).toBe("2026-09-08");
  });
});

describe("addPlanDays — DST-proof arithmetic", () => {
  test("Europe/Berlin spring-forward (2026-03-29): one day at a time", () => {
    expect(addPlanDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addPlanDays("2026-03-29", 1)).toBe("2026-03-30");
  });

  test("Europe/Berlin autumn-back (2026-10-25): one day at a time", () => {
    expect(addPlanDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addPlanDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  test("month boundary", () => {
    expect(addPlanDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  test("year boundary", () => {
    expect(addPlanDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  test("leap-year February boundary (2028 is a leap year)", () => {
    expect(addPlanDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addPlanDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  test("non-leap February boundary (2026 is not a leap year)", () => {
    expect(addPlanDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  test("negative delta", () => {
    expect(addPlanDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("startOfPlanWeek — Monday for all seven days of a week", () => {
  // 2026-09-07 is a Monday.
  test.each([
    ["2026-09-07", "2026-09-07"], // Mon
    ["2026-09-08", "2026-09-07"], // Tue
    ["2026-09-09", "2026-09-07"], // Wed
    ["2026-09-10", "2026-09-07"], // Thu
    ["2026-09-11", "2026-09-07"], // Fri
    ["2026-09-12", "2026-09-07"], // Sat
    ["2026-09-13", "2026-09-07"], // Sun
  ])("%s -> Monday %s", (input, expected) => {
    expect(startOfPlanWeek(input)).toBe(expected);
  });
});

describe("planWeek", () => {
  test("returns 7 ascending dates starting Monday", () => {
    const week = planWeek("2026-09-10"); // a Thursday
    expect(week).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });
});

describe("isPlanDate", () => {
  test.each([
    ["2026-09-08", true],
    ["2026-02-31", false], // real month, unreal day
    ["2026-2-3", false], // not zero-padded
    ["26-02-03", false], // two-digit year
    ["2026-02-03T00:00:00Z", false], // carries a time
    ["", false],
  ])("%s -> %s", (input, expected) => {
    expect(isPlanDate(input)).toBe(expected);
  });
});

describe("planDaysBetween", () => {
  test("signed forward", () => {
    expect(planDaysBetween("2026-09-08", "2026-09-13")).toBe(5);
  });

  test("signed backward", () => {
    expect(planDaysBetween("2026-09-13", "2026-09-08")).toBe(-5);
  });

  test("0 for equal dates", () => {
    expect(planDaysBetween("2026-09-08", "2026-09-08")).toBe(0);
  });
});

describe("groupByLocalDay", () => {
  test("preserves newest-first order within a bucket", () => {
    // Deliberately no "Z"/offset suffix: a bare "YYYY-MM-DDTHH:mm:ss" is parsed as
    // LOCAL time by every engine, so extracting the local date back out is a
    // round trip and gives the same bucket regardless of the runtime's TZ — an
    // instant with a "Z" would move which local day 09:00/18:00/20:00 fall on as
    // the process TZ changes, which is exactly the flake this file must avoid.
    const rows = [
      { id: "a", at: "2026-09-08T20:00:00" },
      { id: "b", at: "2026-09-08T18:00:00" },
      { id: "c", at: "2026-09-08T09:00:00" },
      { id: "d", at: "2026-09-07T22:00:00" },
    ];
    const grouped = groupByLocalDay(rows, (row) => row.at);
    expect(grouped.map((bucket) => bucket.rows.map((row) => row.id))).toEqual([
      ["a", "b", "c"],
      ["d"],
    ]);
  });
});
