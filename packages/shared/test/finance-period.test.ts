import { describe, expect, test } from "bun:test";
import {
  comparePeriods,
  currentPeriod,
  isPeriod,
  nextPeriod,
  periodOf,
  periodStartMs,
  periodsInclusive,
  previousPeriod,
} from "../src/modules/finance/period.ts";

describe("isPeriod", () => {
  test.each(["2026-01", "2026-12", "1999-06"])("%s is a valid period", (value) => {
    expect(isPeriod(value)).toBe(true);
  });

  test.each(["2026-13", "2026-00", "2026-1", "26-01", "2026/01", "", "not-a-period"])(
    "%s is not a valid period",
    (value) => {
      expect(isPeriod(value)).toBe(false);
    },
  );
});

describe("the accepted period window (toon-finance 1715207)", () => {
  test("the whole window is a bounded walk: 1212 months from 2000-01 to 2100-12", async () => {
    const { MAX_PERIOD, MIN_PERIOD } = await import("../src/modules/finance/schemas/common.ts");
    expect(isPeriod(MIN_PERIOD) && isPeriod(MAX_PERIOD)).toBe(true);
    // Year 1 would have been ~24 000 months in ONE boot transaction.
    expect(periodsInclusive(MIN_PERIOD, MAX_PERIOD)).toHaveLength(1212);
  });
});

describe("nextPeriod / previousPeriod", () => {
  test("cross the year boundary forward", () => {
    expect(nextPeriod("2025-12")).toBe("2026-01");
  });

  test("cross the year boundary backward", () => {
    expect(previousPeriod("2026-01")).toBe("2025-12");
  });

  test("stay within a year otherwise", () => {
    expect(nextPeriod("2026-03")).toBe("2026-04");
    expect(previousPeriod("2026-03")).toBe("2026-02");
  });

  test("throw on a malformed period", () => {
    expect(() => nextPeriod("2026-13")).toThrow();
    expect(() => previousPeriod("nope")).toThrow();
  });
});

describe("comparePeriods", () => {
  test("orders lexicographically == chronologically", () => {
    expect(comparePeriods("2025-12", "2026-01")).toBeLessThan(0);
    expect(comparePeriods("2026-01", "2025-12")).toBeGreaterThan(0);
    expect(comparePeriods("2026-01", "2026-01")).toBe(0);
  });
});

describe("periodsInclusive", () => {
  test("every period from -> to, inclusive, crossing a year boundary", () => {
    expect(periodsInclusive("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  test("a single period when from === to", () => {
    expect(periodsInclusive("2026-05", "2026-05")).toEqual(["2026-05"]);
  });

  test("empty when to < from", () => {
    expect(periodsInclusive("2026-05", "2026-01")).toEqual([]);
  });

  test("catch-up from lastBookedPeriod = 2026-03 to now = 2026-08 books 5 periods", () => {
    // docs/ledger-spec.md §8.6 vector 49 — the periods AFTER the last booked one.
    const from = nextPeriod("2026-03");
    expect(periodsInclusive(from, "2026-08")).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
  });
});

describe("periodOf / currentPeriod (Europe/Berlin)", () => {
  test("resolves a UTC instant to its Berlin calendar month", () => {
    // 2026-08-09T10:00:00Z is well inside CEST (UTC+2) but the same month either way.
    expect(periodOf(Date.UTC(2026, 7, 9, 10, 0, 0))).toBe("2026-08");
  });

  test("31.12. 23:30 UTC is already 01.01. local time in Berlin (UTC+1 in winter)", () => {
    const nowMs = Date.UTC(2025, 11, 31, 23, 30, 0);
    expect(currentPeriod(nowMs)).toBe("2026-01");
  });

  test("currentPeriod is a pure function of the ms it is given, never the wall clock", () => {
    const nowMs = Date.UTC(2026, 2, 15, 12, 0, 0);
    expect(currentPeriod(nowMs)).toBe(currentPeriod(nowMs));
    expect(currentPeriod(nowMs)).toBe("2026-03");
  });
});

describe("periodStartMs", () => {
  test("local midnight 2026-01-01 Berlin (winter, UTC+1) is 2025-12-31T23:00:00Z", () => {
    expect(periodStartMs("2026-01")).toBe(Date.UTC(2025, 11, 31, 23, 0, 0));
  });

  test("local midnight 2026-08-01 Berlin (summer, UTC+2) is 2026-07-31T22:00:00Z", () => {
    expect(periodStartMs("2026-08")).toBe(Date.UTC(2026, 6, 31, 22, 0, 0));
  });

  test("round-trips through periodOf", () => {
    expect(periodOf(periodStartMs("2026-05"))).toBe("2026-05");
  });
});
