/**
 * Locale-aware formatting. The one thing worth pinning hard is `formatCurrency`:
 * a wrong grouping/decimal separator here is invisible in a screenshot review
 * but wrong on every single amount in the app.
 *
 * `Intl.NumberFormat`'s de-DE currency/percent output uses U+00A0 (non-breaking
 * space) before the unit, not a regular space — expectations below spell that
 * out with ` ` rather than a literal space so a diff shows the real
 * character instead of two visually identical strings that never compare equal.
 */
import { describe, expect, test } from "bun:test";
import { formatCurrency, formatPercent, formatPeriod } from "./format";

const NBSP = " ";

describe("formatCurrency", () => {
  test("de-DE: comma decimal, euro sign after a non-breaking space", () => {
    expect(formatCurrency(1250, "de")).toBe(`12,50${NBSP}€`);
    expect(formatCurrency(-1250, "de")).toBe(`-12,50${NBSP}€`);
    expect(formatCurrency(0, "de")).toBe(`0,00${NBSP}€`);
  });

  test("en-GB: euro sign before, dot decimal", () => {
    expect(formatCurrency(1250, "en")).toBe("€12.50");
  });

  test("large amounts from the imported ledger (31 482,17 €)", () => {
    expect(formatCurrency(2_874_355, "de")).toBe(`28.743,55${NBSP}€`);
  });
});

describe("formatPeriod", () => {
  test("'YYYY-MM' becomes a localized month name", () => {
    expect(formatPeriod("2026-08", "de")).toBe("August 2026");
    expect(formatPeriod("2026-08", "en")).toBe("August 2026");
  });

  test("an unparsable period is returned unchanged rather than throwing", () => {
    expect(formatPeriod("not-a-period", "de")).toBe("not-a-period");
  });
});

describe("formatPercent", () => {
  test("the fixed-cost quote from the sheet: 118 750 / 500 000 = 23,75 %", () => {
    expect(formatPercent(118_750, 500_000, "de")).toBe(`23,75${NBSP}%`);
  });

  test("a zero denominator does not throw", () => {
    expect(formatPercent(100, 0, "de")).toBe(`0${NBSP}%`);
  });
});
