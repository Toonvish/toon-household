/**
 * Every number this test suite needs from `Haushalt.xlsx`, extracted once
 * (docs/ledger-spec.md §1-§6, §8) so it appears exactly once in the codebase.
 * `money.test.ts`, `ledger.test.ts` and `plan.test.ts` all import from here;
 * the `[IMPORT]`-owned `import-*.test.ts` files do too, so the 14 rent pairs
 * and the two ledger totals are never re-typed a second time.
 *
 * **These amounts are INVENTED.** They were extracted from one household's
 * real workbook, which does not ship with this repository; the figures have
 * been replaced with a fabricated set of the same shape so that nothing here
 * discloses anyone's income or spending.
 *
 * What survived is every arithmetic RELATIONSHIP the tests exist to pin, because
 * the replacement was generated to satisfy them rather than typed by hand:
 *
 *   sumHalvedCents = (sumCents − Σ(amount % 2)) / 2      per column, via oddCentRows
 *   SHARE_P2       = divRoundHalfAwayFromZero(p2 × cost, incomeTotal)
 *   SHARE_P1       = FIXED_COST_TOTAL_CENTS − SHARE_P2   (exact complement)
 *   RENT_SERIES    last pair = SHARE_P2 × 11, Σ months = 50
 *   default        = (B.halved − E.halved) + (H.incl + rentΣ) − transfer
 *   quirk          = default − the H79 text cell
 *   sheet K21      = ROUND(B.sum/2) − E.sum/2 + …, i.e. exactly −12,5 ct away
 *
 * Change one number here and the rest stop agreeing. Regenerate the whole set;
 * do not patch a single value.
 *
 * The cell references below describe a workbook of this structure — they are no
 * longer reproducible against any file.
 */

/** `A/B "Ausgaben"` — P1 paid, split 50/50. Rows 3-117, 111 amounts. */
export const COLUMN_B = {
  /** `K13 = SUM(B3:B1048576)` */
  sumCents: 2_874_355,
  /** Σ of `halfForOther(amount)` applied to each of the 111 rows individually — NOT half of `sumCents`. */
  sumHalvedCents: 1_437_161,
  /** Rows whose amount is odd, so the payer keeps one more cent than the non-payer. */
  oddCentRows: 39,
} as const;

/** `D/E "Partner gezahlt"` — P2 paid, split 50/50. Rows 3-29, 27 amounts. */
export const COLUMN_E = {
  /** `K2 = SUM(E3:E300)` */
  sumCents: 198_437,
  sumHalvedCents: 99_214,
  oddCentRows: 9,
} as const;

/** `G/H "Partner Extra"` — P1 paid, 100% attributable to P2. Rows 3-123, 121 amounts. */
export const COLUMN_H = {
  /** Including `H79`'s shared-string `"31,47"`, recovered by the importer's default mode. */
  sumCentsIncludingH79: 492_618,
  /** Excel's own `SUM(H3:H300)` — silently skips the text cell. `--excel-text-quirk` reproduces this. */
  sumCentsExcludingH79: 489_471,
} as const;

/** Individual sheet rows used as `halfForOther`/`deltaForTransaction` test vectors. */
export const SAMPLE_ROWS = {
  /** `B51`, a negative row ("Rückzahlung 24"). */
  b51: -68_451,
  /** `B9`, an odd positive row. */
  b9: 35_477,
  /** `E4`, an odd positive row. */
  e4: 16_233,
  /** `H47`, a negative `OTHER_ONLY` row ("Rückzahlung"). */
  h47: -41_206,
} as const;

/**
 * `M23:M36`/`N23:N36` — 14 `(amountCents, months)` pairs, expanded into one
 * `OTHER_ONLY` transaction per month (docs/ledger-spec.md §6.5). Starts at
 * `RENT_SERIES_START`, contiguous, 50 months total.
 */
export const RENT_SERIES: ReadonlyArray<readonly [amountCents: number, months: number]> = [
  [46_100, 1],
  [46_450, 4],
  [45_900, 4],
  [45_200, 3],
  [45_780, 4],
  [47_020, 3],
  [45_330, 5],
  [45_910, 5],
  [46_240, 2],
  [45_870, 1],
  [45_600, 3],
  [48_300, 2],
  [43_100, 2],
  [47_086, 11],
];

/** `O16`'s label `"Robin Miete ab 01.06.2022"` is the only anchor for the series' start month. */
export const RENT_SERIES_START = "2022-06";
/** The last booked rent period before the live plan takes over at `2026-08`. */
export const RENT_SERIES_END = "2026-07";
/** `Σ months` across {@link RENT_SERIES} — the row count the importer writes for the rent series. */
export const RENT_SERIES_ROW_COUNT = 50;
/** `N21 = SUMPRODUCT(M23:M37, N23:N37)`. */
export const RENT_SERIES_SUM_CENTS = 2_307_376;

/** `K4` — the hand-maintained running total of every P2 -> P1 settlement ever made. */
export const TRANSFER_TOTAL_CENTS = 4_128_099;

/** `A6`, `A7`, `A10`, `A13` — label rows with no amount (docs/ledger-spec.md §1.5). Skipped, not zero-imported. */
export const SKIPPED_NO_AMOUNT_ROWS = 4;

/** `B/E/H` rows + the 50 expanded rent rows + the one `K4` settlement (docs/ledger-spec.md §6.1). */
export const TOTAL_IMPORTED_TRANSACTIONS = 111 + 27 + 121 + RENT_SERIES_ROW_COUNT + 1;

/**
 * The six fixed-cost items inlined in `R8` (docs/ledger-spec.md §4.1). Two
 * labels ("Nebenkosten", the two "Streaming" rows) are the importer's guess —
 * the sheet only names the total.
 */
export const FIXED_COST_ITEMS = [
  { label: "Miete", amountCents: 95_000 },
  { label: "Nebenkosten", amountCents: 15_000 },
  { label: "Strom", amountCents: 5_500 },
  { label: "Internet", amountCents: 2_250 },
  { label: "Streaming 1", amountCents: 500 },
  { label: "Streaming 2", amountCents: 500 },
] as const;

/** `R8` — the sum of {@link FIXED_COST_ITEMS}. */
export const FIXED_COST_TOTAL_CENTS = 118_750;

/** `R5`/`R6` — the two gross monthly incomes as of `2025-09`. */
export const INCOMES = {
  p1Cents: 301_745,
  p2Cents: 198_255,
} as const;

/** `R7` = `R5 + R6`. */
export const INCOME_TOTAL_CENTS = 500_000;

/** `R11` — P2's income-proportional share, rounded. Matches the last {@link RENT_SERIES} row (`470.86 x 11`). */
export const SHARE_P2_CENTS = 47_086;

/** `R10` — P1's share, the complement: `FIXED_COST_TOTAL_CENTS - SHARE_P2_CENTS`. */
export const SHARE_P1_CENTS = 71_664;

/**
 * The four reference figures from `§6.7`'s reconciliation. `sheetK21Cents` is
 * NOT an integer — the sheet's own `K3 = K2/2` is never rounded — so it is
 * kept as a plain `number` for comparison only, never as money.
 */
export const REFERENCE_BALANCES = {
  /** The importer's default mode: `H79`'s `"31,47"` recovered. */
  importerDefaultCents: 9_842,
  /** `--excel-text-quirk`: `H79` excluded, reproducing the sheet's own arithmetic. */
  excelTextQuirkCents: 6_695,
  /** `K21 = (K14 + K15 - K5)`, for reference only — never ground truth. */
  sheetK21Cents: 6707.5,
} as const;
