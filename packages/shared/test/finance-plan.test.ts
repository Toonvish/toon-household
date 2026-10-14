import { describe, expect, test } from "bun:test";
import { activeItemsIn, computePlanForPeriod, formatQuote, incomeIn, type FixedCostItem, type IncomeEntry } from "../src/modules/finance/plan.ts";
import {
  FIXED_COST_ITEMS,
  FIXED_COST_TOTAL_CENTS,
  INCOMES,
  INCOME_TOTAL_CENTS,
  SHARE_P1_CENTS,
  SHARE_P2_CENTS,
} from "./fixtures/haushalt-xlsx.ts";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const PERIOD = "2025-09";

function sheetItems(): FixedCostItem[] {
  return FIXED_COST_ITEMS.map((item) => ({ amountCents: item.amountCents, activeFrom: PERIOD, activeTo: null }));
}

function sheetIncomes(): IncomeEntry[] {
  return [
    { personId: P1, amountCents: INCOMES.p1Cents, validFrom: PERIOD, validTo: null },
    { personId: P2, amountCents: INCOMES.p2Cents, validFrom: PERIOD, validTo: null },
  ];
}

test("costTotal from the six seed items === 118 750 ct", () => {
  const total = sheetItems().reduce((sum, item) => sum + item.amountCents, 0);
  expect(total).toBe(FIXED_COST_TOTAL_CENTS);
  expect(total).toBe(118_750);
});

test("incomeTotal from both salaries === 500 000 ct", () => {
  const total = INCOMES.p1Cents + INCOMES.p2Cents;
  expect(total).toBe(INCOME_TOTAL_CENTS);
  expect(total).toBe(500_000);
});

describe("computePlanForPeriod — the worked example from docs/ledger-spec.md §4.2", () => {
  test("P1 pays, P2's share is booked", () => {
    const result = computePlanForPeriod({
      period: PERIOD,
      items: sheetItems(),
      incomes: sheetIncomes(),
      payerId: P1,
      otherId: P2,
    });

    expect(result.costTotalCents).toBe(118_750);
    expect(result.incomeTotalCents).toBe(500_000);
    expect(result.quoteNumerator).toBe(118_750);
    expect(result.quoteDenominator).toBe(500_000);
    expect(result.bookableCents).toBe(SHARE_P2_CENTS);
    expect(result.bookableCents).toBe(47_086);

    const payerShare = result.shares.find((s) => s.personId === P1)!;
    const otherShare = result.shares.find((s) => s.personId === P2)!;
    expect(otherShare.shareCents).toBe(47_086);
    expect(payerShare.shareCents).toBe(SHARE_P1_CENTS);
    expect(payerShare.shareCents).toBe(71_664);

    // The two shares always reconstruct the total exactly — no second rounding.
    expect(payerShare.shareCents + otherShare.shareCents).toBe(result.costTotalCents);
  });

  test("quote formats as de-DE percent from the exact fraction, never a float", () => {
    // Intl's de-DE percent format uses U+00A0 (non-breaking space) before "%", not a plain space.
    expect(formatQuote(118_750, 500_000)).toBe("23,75 %");
  });

  test("the payer absorbs the residual cent (costTotal = 100 001, incomes 50 000 / 50 000)", () => {
    const result = computePlanForPeriod({
      period: PERIOD,
      items: [{ amountCents: 100_001, activeFrom: PERIOD, activeTo: null }],
      incomes: [
        { personId: P1, amountCents: 50_000, validFrom: PERIOD, validTo: null },
        { personId: P2, amountCents: 50_000, validFrom: PERIOD, validTo: null },
      ],
      payerId: P1,
      otherId: P2,
    });
    expect(result.bookableCents).toBe(50_001); // half away from zero
    const payerShare = result.shares.find((s) => s.personId === P1)!.shareCents;
    expect(payerShare).toBe(50_000);
    expect(payerShare + result.bookableCents).toBe(100_001);
  });

  test("a disabled/empty plan (no active items) books nothing", () => {
    const result = computePlanForPeriod({
      period: PERIOD,
      items: [],
      incomes: sheetIncomes(),
      payerId: P1,
      otherId: P2,
    });
    expect(result.costTotalCents).toBe(0);
    expect(result.bookableCents).toBe(0);
  });

  test("no income data at all never divides by zero", () => {
    const result = computePlanForPeriod({
      period: PERIOD,
      items: sheetItems(),
      incomes: [],
      payerId: P1,
      otherId: P2,
    });
    expect(result.incomeTotalCents).toBe(0);
    expect(result.bookableCents).toBe(0);
  });
});

describe("activeItemsIn", () => {
  const items: FixedCostItem[] = [
    { amountCents: 100, activeFrom: "2025-01", activeTo: "2025-06" },
    { amountCents: 200, activeFrom: "2025-07", activeTo: null },
  ];

  test("selects items whose [activeFrom, activeTo] covers the period, inclusive", () => {
    expect(activeItemsIn(items, "2025-01")).toEqual([items[0]!]);
    expect(activeItemsIn(items, "2025-06")).toEqual([items[0]!]);
    expect(activeItemsIn(items, "2025-07")).toEqual([items[1]!]);
    expect(activeItemsIn(items, "2024-12")).toEqual([]);
  });

  test("an open activeTo (null) covers every later period", () => {
    expect(activeItemsIn(items, "2030-01")).toEqual([items[1]!]);
  });
});

describe("incomeIn", () => {
  const incomes: IncomeEntry[] = [
    { personId: P1, amountCents: 300_000, validFrom: "2025-01", validTo: "2025-08" },
    { personId: P1, amountCents: 301_745, validFrom: "2025-09", validTo: null },
  ];

  test("a period is computed from the salary valid IN that period, not today's", () => {
    // docs/ledger-spec.md §8.6 vector 51: salary corrected from 2025-09, booking 2026-02 uses the OLD salary
    // if that salary's validFrom/validTo still covers 2026-02 — here we assert the temporal lookup itself.
    expect(incomeIn(incomes, P1, "2025-05")?.amountCents).toBe(300_000);
    expect(incomeIn(incomes, P1, "2026-02")?.amountCents).toBe(301_745);
  });

  test("returns null when nothing covers the period", () => {
    expect(incomeIn(incomes, P1, "2024-12")).toBeNull();
    expect(incomeIn(incomes, P2, "2025-09")).toBeNull();
  });
});
