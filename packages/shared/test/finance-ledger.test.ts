import { describe, expect, test } from "bun:test";
import {
  computeBalance,
  computeBreakdown,
  deltaForTransaction,
  isExpense,
  kindToStorage,
  projectKind,
  type BalanceTransaction,
} from "../src/modules/finance/ledger.ts";
import {
  COLUMN_B,
  COLUMN_E,
  COLUMN_H,
  RENT_SERIES,
  RENT_SERIES_ROW_COUNT,
  RENT_SERIES_SUM_CENTS,
  REFERENCE_BALANCES,
  SAMPLE_ROWS,
  TOTAL_IMPORTED_TRANSACTIONS,
  TRANSFER_TOTAL_CENTS,
} from "./fixtures/haushalt-xlsx.ts";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

describe("deltaForTransaction: one row per kind", () => {
  test.each<[BalanceTransaction, number]>([
    [{ payerId: P1, splitMode: "SPLIT_EQUAL", amountCents: 10_001 }, 5_000],
    [{ payerId: P2, splitMode: "SPLIT_EQUAL", amountCents: 10_001 }, -5_000],
    [{ payerId: P1, splitMode: "OTHER_ONLY", amountCents: 10_001 }, 10_001],
    [{ payerId: P2, splitMode: "OTHER_ONLY", amountCents: 10_001 }, -10_001],
    [{ payerId: P2, splitMode: "SETTLEMENT", amountCents: 10_001 }, -10_001],
    [{ payerId: P1, splitMode: "SPLIT_EQUAL", amountCents: -30_000 }, -15_000],
    [{ payerId: P1, splitMode: "OTHER_ONLY", amountCents: SAMPLE_ROWS.h47 }, SAMPLE_ROWS.h47],
  ])("delta(%o) === %i", (tx, expected) => {
    expect(deltaForTransaction(tx, P1)).toBe(expected);
  });
});

describe("computeBalance / computeBreakdown", () => {
  test("empty ledger is zero", () => {
    expect(computeBalance([], P1)).toBe(0);
    expect(computeBreakdown([], P1)).toEqual({
      balanceCents: 0,
      splitOtherCents: 0,
      forOtherCents: 0,
      settledCents: 0,
      transactionCount: 0,
    });
  });

  test("is antisymmetric: computeBalance(txs, p1) === -computeBalance(txs, p2)", () => {
    const txs: BalanceTransaction[] = [
      { payerId: P1, splitMode: "SPLIT_EQUAL", amountCents: 12_345 },
      { payerId: P2, splitMode: "SPLIT_EQUAL", amountCents: 6_789 },
      { payerId: P1, splitMode: "OTHER_ONLY", amountCents: 50_000 },
      { payerId: P2, splitMode: "SETTLEMENT", amountCents: 20_000 },
    ];
    expect(computeBalance(txs, P1)).toBe(-computeBalance(txs, P2));
  });

  test("is order-independent", () => {
    const txs: BalanceTransaction[] = [
      { payerId: P1, splitMode: "SPLIT_EQUAL", amountCents: 999 },
      { payerId: P2, splitMode: "OTHER_ONLY", amountCents: 4_321 },
      { payerId: P1, splitMode: "SETTLEMENT", amountCents: 1_000 },
      { payerId: P2, splitMode: "SPLIT_EQUAL", amountCents: -555 },
    ];
    const shuffled = [txs[3]!, txs[0]!, txs[2]!, txs[1]!];
    expect(computeBalance(txs, P1)).toBe(computeBalance(shuffled, P1));
  });
});

describe("column aggregates match the sheet (docs/ledger-spec.md §1.2, §3.3)", () => {
  test("Σ B and Σ per-transaction halves of B", () => {
    expect(COLUMN_B.sumCents).toBe(2_874_355);
    expect(COLUMN_B.sumHalvedCents).toBe(1_437_161);
  });

  test("Σ E and Σ per-transaction halves of E", () => {
    expect(COLUMN_E.sumCents).toBe(198_437);
    expect(COLUMN_E.sumHalvedCents).toBe(99_214);
  });

  test("Σ H including and excluding the H79 text cell", () => {
    expect(COLUMN_H.sumCentsIncludingH79).toBe(492_618);
    expect(COLUMN_H.sumCentsExcludingH79).toBe(489_471);
    expect(COLUMN_H.sumCentsIncludingH79 - COLUMN_H.sumCentsExcludingH79).toBe(3_147);
  });
});

describe("rent series expansion (docs/ledger-spec.md §6.5)", () => {
  test("50 rows, 2 307 376 ct total", () => {
    const totalMonths = RENT_SERIES.reduce((sum, [, months]) => sum + months, 0);
    const totalCents = RENT_SERIES.reduce((sum, [amount, months]) => sum + amount * months, 0);
    expect(totalMonths).toBe(RENT_SERIES_ROW_COUNT);
    expect(totalMonths).toBe(50);
    expect(totalCents).toBe(RENT_SERIES_SUM_CENTS);
    expect(totalCents).toBe(2_307_376);
  });
});

test("K4 settlement and total imported row count", () => {
  expect(TRANSFER_TOTAL_CENTS).toBe(4_128_099);
  expect(TOTAL_IMPORTED_TRANSACTIONS).toBe(310);
});

describe("end-to-end balance, both importer modes (docs/ledger-spec.md §6.7)", () => {
  function forThemTotal(hSum: number): number {
    return hSum + RENT_SERIES_SUM_CENTS;
  }

  function endToEndBalance(hSum: number): number {
    return COLUMN_B.sumHalvedCents + forThemTotal(hSum) - COLUMN_E.sumHalvedCents - TRANSFER_TOTAL_CENTS;
  }

  test("importer default (H79 recovered) === 9 842 ct", () => {
    expect(endToEndBalance(COLUMN_H.sumCentsIncludingH79)).toBe(REFERENCE_BALANCES.importerDefaultCents);
    expect(REFERENCE_BALANCES.importerDefaultCents).toBe(9_842);
  });

  test("--excel-text-quirk (H79 excluded) === 6 695 ct", () => {
    expect(endToEndBalance(COLUMN_H.sumCentsExcludingH79)).toBe(REFERENCE_BALANCES.excelTextQuirkCents);
    expect(REFERENCE_BALANCES.excelTextQuirkCents).toBe(6_695);
  });

  test("delta of --excel-text-quirk vs. the sheet's own K21 is inside the 25 ct tolerance", () => {
    const delta = REFERENCE_BALANCES.excelTextQuirkCents - REFERENCE_BALANCES.sheetK21Cents;
    expect(delta).toBeCloseTo(-12.5, 5);
    expect(Math.abs(delta)).toBeLessThanOrEqual(25);
  });

  test("delta of default vs. --excel-text-quirk is exactly +3 147 ct (the recovered H79)", () => {
    expect(REFERENCE_BALANCES.importerDefaultCents - REFERENCE_BALANCES.excelTextQuirkCents).toBe(3_147);
  });
});

test("isExpense excludes settlements — a settlement never changes category totals", () => {
  expect(isExpense({ splitMode: "SPLIT_EQUAL" })).toBe(true);
  expect(isExpense({ splitMode: "OTHER_ONLY" })).toBe(true);
  expect(isExpense({ splitMode: "SETTLEMENT" })).toBe(false);

  const txs: BalanceTransaction[] = [
    { payerId: P1, splitMode: "SPLIT_EQUAL", amountCents: 5_000 },
    { payerId: P2, splitMode: "SETTLEMENT", amountCents: 999_999 },
  ];
  const expenseTotal = txs.filter(isExpense).reduce((sum, tx) => sum + tx.amountCents, 0);
  expect(expenseTotal).toBe(5_000);
});

describe("kindToStorage / projectKind round-trip (docs/ledger-spec.md §2.2)", () => {
  test.each([
    ["MINE_SPLIT", P1, "SPLIT_EQUAL"],
    ["THEIRS_SPLIT", P2, "SPLIT_EQUAL"],
    ["FOR_THEM", P1, "OTHER_ONLY"],
    ["TRANSFER", P2, "SETTLEMENT"],
  ] as const)("%s -> (payer=%s, splitMode=%s), and projects back from the viewer's login", (kind, expectedPayer, expectedSplitMode) => {
    const stored = kindToStorage(kind, P1, P2);
    expect(stored).toEqual({ payerId: expectedPayer, splitMode: expectedSplitMode });
    expect(projectKind(stored, P1)).toBe(kind);
  });

  test("reading the same row from the OTHER login flips MINE_SPLIT/THEIRS_SPLIT", () => {
    const stored = kindToStorage("MINE_SPLIT", P1, P2);
    expect(projectKind(stored, P1)).toBe("MINE_SPLIT");
    expect(projectKind(stored, P2)).toBe("THEIRS_SPLIT");
  });

  test("a TRANSFER read from the payer's own login has no name in the four-kind enum", () => {
    const stored = kindToStorage("TRANSFER", P1, P2); // payer = P2 (the other person paid P1)
    expect(projectKind(stored, P2)).toBeNull(); // from P2's own login: "I paid a settlement" has no button
  });

  test("an OTHER_ONLY row paid by the OTHER person (THEIRS_FOR_ME) has no name in the four-kind enum", () => {
    const stored = { payerId: P1, splitMode: "OTHER_ONLY" } as const;
    expect(projectKind(stored, P1)).toBe("FOR_THEM");
    expect(projectKind(stored, P2)).toBeNull();
  });
});
