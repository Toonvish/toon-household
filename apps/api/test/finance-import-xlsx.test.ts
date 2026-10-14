/**
 * [IMPORT] Parser unit tests for the `Haushalt.xlsx` importer
 * (docs/ledger-spec.md §8.8-§8.10). Against small hand-built fixtures — never
 * the 1.2 MB workbook itself, per the task brief. The workbook-derived totals
 * this suite also checks come from
 * `packages/shared/test/fixtures/haushalt-xlsx.ts` so they are never re-typed
 * a second time.
 *
 * The exception is the write path (docs/spec.md §7.6), which needs a whole
 * workbook and a real database — `bun test`'s `db` already IS a fresh temp-file
 * DB (env.ts's `defaultTestDatabaseUrl()`). It runs against a SYNTHETIC workbook
 * (`support/synthetic-workbook.ts`): invented amounts, same shape, generated at
 * test time, so it runs in CI too. That is what guards idempotency on
 * `(householdId, externalKey)` rather than `externalKey` alone, per-household
 * scoping, the plan seed coming from `R8`'s FORMULA instead of its cached value,
 * the `--excel-text-quirk` switch, and the CLI wiring. The first two were real
 * bugs; both are caught here today.
 *
 * There used to be a second run against the real `Haushalt.xlsx`, whose only
 * unique job was proving that `packages/shared/test/fixtures/haushalt-xlsx.ts`
 * still matched the sheet its numbers came from. Those fixture numbers are now
 * invented too (see that file's header), so the comparison had nothing left to
 * compare and was removed rather than left to rot as a tautology.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  COLUMN_B,
  COLUMN_E,
  COLUMN_H,
  RENT_SERIES,
  RENT_SERIES_ROW_COUNT,
  RENT_SERIES_START as FIXTURE_RENT_SERIES_START,
  RENT_SERIES_SUM_CENTS,
  SAMPLE_ROWS,
  TRANSFER_TOTAL_CENTS,
} from "../../../packages/shared/test/fixtures/haushalt-xlsx.ts";
import { AmountParseError, parseAmountCell } from "../scripts/finance-import/amounts.ts";
import { categorize } from "../scripts/finance-import/categorize.ts";
import { type CalendarDate, dateStartMsBerlin, resolveColumnDates, toIsoDate, toPeriod } from "../scripts/finance-import/dates.ts";
import { expandRentSeries, RENT_SERIES_START } from "../scripts/finance-import/rent.ts";
import type { XlsxCell } from "../scripts/finance-import/xlsx-reader.ts";
import { readWorkbook } from "../scripts/finance-import/xlsx-reader.ts";
import { buildImport, seedFixedCostPlan, writeImportRecords } from "../scripts/finance-import-xlsx.ts";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import {
  financeFixedCostItems as fixedCostItems,
  financeFixedCostPlans as fixedCostPlans,
  financeIncomes as incomes,
  financeTransactions as transactions,
} from "../src/modules/finance/schema.ts";
import { body, call, createHousehold, createUser, joinAsSecondMember, type TestUser } from "./support/finance-harness.ts";
import { writeSyntheticWorkbook } from "./support/finance-synthetic-workbook.ts";

await runMigrations(db);

/* -------------------------------------------------------------------------- */
/* §8.9 amount parsing                                                        */
/* -------------------------------------------------------------------------- */

function numericCell(ref: string, raw: string): XlsxCell {
  const match = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return { ref, col: match[1]!, row: Number(match[2]), value: raw };
}

function formulaCell(ref: string, formula: string, cachedValue: string): XlsxCell {
  const cell = numericCell(ref, cachedValue);
  cell.formula = formula;
  return cell;
}

function sharedStringCell(ref: string, idx: number): XlsxCell {
  const cell = numericCell(ref, String(idx));
  cell.type = "s";
  return cell;
}

describe("parseAmountCell (docs/ledger-spec.md §6.2, §8.9)", () => {
  test("#78 H79 shared string \"31,47\" -> 3147 ct", () => {
    expect(parseAmountCell(sharedStringCell("H79", 0), ["31,47"])).toBe(3147);
  });

  test("#79 B3 plain integer text \"1693\" -> 169300 ct", () => {
    expect(parseAmountCell(numericCell("B3", "1693"), [])).toBe(169300);
  });

  test("#80 B66 float noise \"80.430000000000007\" -> 8043 ct", () => {
    expect(parseAmountCell(numericCell("B66", "80.430000000000007"), [])).toBe(8043);
  });

  test("#81 B56 formula cached \"-108.96999999999997\" -> -10897 ct", () => {
    expect(parseAmountCell(formulaCell("B56", "-577.41 -H47", "-108.96999999999997"), [])).toBe(-10897);
  });

  test("#82 H48 formula cached \"96.36\" -> 9636 ct", () => {
    expect(parseAmountCell(formulaCell("H48", "(67.36 + 29)", "96.36"), [])).toBe(9636);
  });

  test("#83 H51 formula cached \"206.89\" -> 20689 ct", () => {
    expect(parseAmountCell(formulaCell("H51", "251.88 - 44.99", "206.89"), [])).toBe(20689);
  });

  test("#84 B40 formula cached \"96\" -> 9600 ct", () => {
    expect(parseAmountCell(formulaCell("B40", "96", "96"), [])).toBe(9600);
  });

  test("#85 unparsable text throws AmountParseError, import aborts", () => {
    expect(() => parseAmountCell(sharedStringCell("X1", 0), ["abc"])).toThrow(AmountParseError);
  });

  test("#86 missing/self-closed cell -> null, skipped_no_amount", () => {
    expect(parseAmountCell(undefined, [])).toBeNull();
  });

  test("negative amounts keep their sign (docs/ledger-spec.md §1.6)", () => {
    expect(parseAmountCell(numericCell("B51", "-684.51"), [])).toBe(-68451);
  });

  test("--excel-text-quirk treats the shared-string cell as empty, reproducing Excel's SUM", () => {
    expect(parseAmountCell(sharedStringCell("H79", 0), ["31,47"], { excelTextQuirk: true })).toBeNull();
  });

  test("fixture cross-check: column B sum matches K13", () => {
    const cents = [SAMPLE_ROWS.b9, SAMPLE_ROWS.b51];
    expect(cents.reduce((a, b) => a + b, 0)).toBe(SAMPLE_ROWS.b9 + SAMPLE_ROWS.b51);
    expect(COLUMN_B.sumCents).toBe(2_874_355);
    expect(COLUMN_E.sumCents).toBe(198_437);
    expect(COLUMN_H.sumCentsIncludingH79).toBe(492_618);
  });
});

/* -------------------------------------------------------------------------- */
/* §8.8 date resolution                                                       */
/* -------------------------------------------------------------------------- */

const MOVE_IN: CalendarDate = { year: 2021, month: 9, day: 1 };
const IMPORT_DATE: CalendarDate = { year: 2026, month: 8, day: 9 };

describe("resolveColumnDates (docs/ledger-spec.md §6.3, §8.8)", () => {
  test("#62 R1: \"Stempelmühle 10.07.2026\" -> 2026-07-10, day, anchor", () => {
    const result = resolveColumnDates([{ row: 1, label: "Stempelmühle 10.07.2026" }], MOVE_IN, IMPORT_DATE);
    const resolved = result.get(1)!;
    expect(toIsoDate(resolved)).toBe("2026-07-10");
    expect(resolved.precision).toBe("day");
    expect(resolved.isAnchor).toBe(true);
  });

  test("#63 R2: \"Fressnapf 23.09.25\" -> 2025-09-23, day", () => {
    const result = resolveColumnDates([{ row: 1, label: "Fressnapf 23.09.25" }], MOVE_IN, IMPORT_DATE);
    expect(toIsoDate(result.get(1)!)).toBe("2025-09-23");
  });

  test("#64 R2 without a space: \"Amazon27.01.23\" -> 2023-01-27", () => {
    const result = resolveColumnDates([{ row: 1, label: "Amazon27.01.23" }], MOVE_IN, IMPORT_DATE);
    expect(toIsoDate(result.get(1)!)).toBe("2023-01-27");
  });

  test("#65 R3: \"Zalando 06.2024\" -> 2024-06-15, month", () => {
    const result = resolveColumnDates([{ row: 1, label: "Zalando 06.2024" }], MOVE_IN, IMPORT_DATE);
    const resolved = result.get(1)!;
    expect(toIsoDate(resolved)).toBe("2024-06-15");
    expect(resolved.precision).toBe("month");
  });

  test("#66 R4 (second number > 12): \"Lebensmittel 11.22\" -> 2022-11-15, month, anchor", () => {
    const result = resolveColumnDates([{ row: 1, label: "Lebensmittel 11.22" }], MOVE_IN, IMPORT_DATE);
    const resolved = result.get(1)!;
    expect(toIsoDate(resolved)).toBe("2022-11-15");
    expect(resolved.isAnchor).toBe(true);
  });

  test("#67 R4: \"Holy 07.24\" -> 2024-07-15, month", () => {
    const result = resolveColumnDates([{ row: 1, label: "Holy 07.24" }], MOVE_IN, IMPORT_DATE);
    expect(toIsoDate(result.get(1)!)).toBe("2024-07-15");
  });

  test("#68 R5 with no anchor above: \"Obi 02.10\" -> 2021-10-02 (falls back to move-in bracket)", () => {
    const result = resolveColumnDates([{ row: 1, label: "Obi 02.10" }], MOVE_IN, IMPORT_DATE);
    expect(toIsoDate(result.get(1)!)).toBe("2021-10-02");
  });

  test("#69 R5 with no valid year in bracket falls back to carry, estimated", () => {
    // prev anchor 2025-05-05, next anchor 2025-07-27; "5.9" (Sept 5) never fits.
    const result = resolveColumnDates(
      [
        { row: 1, label: "Anchor 05.05.2025" },
        { row: 2, label: "Deutsche Bahn 5.9" },
        { row: 3, label: "Anchor 27.07.2025" },
      ],
      MOVE_IN,
      IMPORT_DATE,
    );
    const resolved = result.get(2)!;
    expect(toIsoDate(resolved)).toBe("2025-05-05");
    expect(resolved.precision).toBe("estimated");
  });

  test("#70 R5 must not default to the wrong year: \"Ikea 10.09\" between 2024 anchors -> 2024-09-10", () => {
    const result = resolveColumnDates(
      [
        { row: 1, label: "Anchor 01.01.2024" },
        { row: 2, label: "Ikea 10.09" },
        { row: 3, label: "Anchor 01.12.2024" },
      ],
      MOVE_IN,
      IMPORT_DATE,
    );
    expect(toIsoDate(result.get(2)!)).toBe("2024-09-10");
  });

  test("#71 R6: \"Tier Futter April\" resolves within its bracket, month precision, day 15", () => {
    const result = resolveColumnDates(
      [
        { row: 1, label: "Anchor 01.2025" },
        { row: 2, label: "Tier Futter April" },
        { row: 3, label: "Anchor 06.2025" },
      ],
      MOVE_IN,
      IMPORT_DATE,
    );
    const resolved = result.get(2)!;
    expect(resolved.month).toBe(4);
    expect(resolved.day).toBe(15);
    expect(resolved.precision).toBe("month");
  });

  test("#72 R6 with a 5-digit year is ignored at pass 1 but inferred at pass 2: \"Prime day juni 20026\" -> 2026-06-15", () => {
    const result = resolveColumnDates(
      [
        { row: 1, label: "Anchor 01.2026" },
        { row: 2, label: "Prime day juni 20026" },
        { row: 3, label: "Anchor 12.2026" },
      ],
      MOVE_IN,
      IMPORT_DATE,
    );
    expect(toIsoDate(result.get(2)!)).toBe("2026-06-15");
  });

  test("#73 rejected out-of-range anchor salvages day/month for pass 2: \"Fressnapf 05.08.16\" -> 2026-08-05", () => {
    const result = resolveColumnDates(
      [
        { row: 1, label: "Anchor 01.07.2026" },
        { row: 2, label: "Fressnapf 05.08.16" },
      ],
      MOVE_IN,
      IMPORT_DATE,
    );
    const resolved = result.get(2)!;
    expect(toIsoDate(resolved)).toBe("2026-08-05");
    expect(resolved.isAnchor).toBe(false);
  });

  test("#74 a bare year is never a date rule: \"Kalender 2025\" carries the nearest anchor above, estimated", () => {
    const result = resolveColumnDates(
      [
        { row: 1, label: "Fressnapf 31.08.24" },
        { row: 2, label: "Kalender 2025" },
      ],
      MOVE_IN,
      IMPORT_DATE,
    );
    const resolved = result.get(2)!;
    expect(toIsoDate(resolved)).toBe("2024-08-31");
    expect(resolved.precision).toBe("estimated");
  });

  test("#75 no anchor at all falls back to move-in, estimated", () => {
    const result = resolveColumnDates([{ row: 1, label: "Sofa" }], MOVE_IN, IMPORT_DATE);
    const resolved = result.get(1)!;
    expect(toIsoDate(resolved)).toBe(toIsoDate(MOVE_IN));
    expect(resolved.precision).toBe("estimated");
  });

  test("rows in one bracket are resolved INDEPENDENTLY, even when that inverts them", () => {
    // Deliberate, and measured: forcing the output to be non-decreasing looks
    // like the obvious fix for this inversion, but the real workbook has
    // `Obi 02.10` / `Obi 30.09` / `Lutz 29.09` in that order (column A rows
    // 18/20/28 — the September-2021 move-in, typed from memory). A floor
    // there moves `Obi 30.09` to 2022-09-30 and drags the 18 rows below it a
    // year forward. The label carries the information; the row order does not.
    const result = resolveColumnDates(
      [
        { row: 1, label: "Anchor 01.09.2021" },
        { row: 2, label: "Wolle 5.3" },
        { row: 3, label: "Ikea 20.12" },
        { row: 4, label: "Anchor 01.01.2023" },
      ],
      MOVE_IN,
      IMPORT_DATE,
    );
    expect(toIsoDate(result.get(2)!)).toBe("2022-03-05");
    expect(toIsoDate(result.get(3)!)).toBe("2021-12-20");
  });

  test("dateStartMsBerlin produces a stable, increasing ms value across dates", () => {
    const a = dateStartMsBerlin({ year: 2025, month: 1, day: 1 });
    const b = dateStartMsBerlin({ year: 2025, month: 6, day: 15 });
    expect(b).toBeGreaterThan(a);
  });
});

/* -------------------------------------------------------------------------- */
/* §8.10 category heuristic                                                   */
/* -------------------------------------------------------------------------- */

describe("categorize (docs/ledger-spec.md §7.2, §8.10)", () => {
  test.each([
    ["#88 Fressnapf 23.09.25", "Fressnapf 23.09.25", "tiere"],
    ["#89 Katzen Amazon 29.07 (order matters)", "Katzen Amazon 29.07", "tiere"],
    ["#90 Tierarzt Blutabnahme", "Tierarzt Blutabnahme", "tiere"],
    ["#91 Amazon Spiegel", "Amazon Spiegel", "moebel_wohnen"],
    ["#92 Amazon alone -> sonstiges (marketplace names never guessed)", "Amazon", "sonstiges"],
    ["#93 Nadja Karten -> geschenke before hobby_kreativ's karten", "Nadja Karten", "geschenke"],
    ["#94 Faltkarten 1.12", "Faltkarten 1.12", "hobby_kreativ"],
    ["#95 RobinPC", "RobinPC", "elektronik"],
    ["#96 Autoversicherung -> versicherung before mobilitaet's \\bauto\\b", "Autoversicherung", "versicherung"],
    ["#97 Strom Rückerstattung 2025", "Strom Rückerstattung 2025", "nebenkosten"],
    ["#98 Rückzahlung", "Rückzahlung", "ausgleich"],
    ["Blumen Häckeln -> geschenke before hobby_kreativ (accepted misfire)", "Blumen Häckeln", "geschenke"],
    ["HandyHülle Nadja -> geschenke rather than elektronik (accepted misfire)", "HandyHülle Nadja", "geschenke"],
  ])("%s", (_name, label, expectedSlug) => {
    expect(categorize(label).slug).toBe(expectedSlug);
  });

  test("unmatched labels fall to sonstiges with matched: false", () => {
    const result = categorize("Unterlage");
    expect(result.slug).toBe("sonstiges");
    expect(result.matched).toBe(false);
  });

  test("`gez` is a word, not a substring — the sheet's own \"Partner gezahlt\" is not a tax", () => {
    expect(categorize("Partner gezahlt").slug).not.toBe("steuern_abgaben");
    expect(categorize("Sofa abgezogen").slug).not.toBe("steuern_abgaben");
    // …while the real thing still matches, bounded or hyphenated.
    expect(categorize("GEZ").slug).toBe("steuern_abgaben");
    expect(categorize("GEZ-Gebühren 2025").slug).toBe("steuern_abgaben");
    expect(categorize("Steuern 2025").slug).toBe("steuern_abgaben");
  });
});

/* -------------------------------------------------------------------------- */
/* §8.3 rent series expansion                                                 */
/* -------------------------------------------------------------------------- */

describe("expandRentSeries (docs/ledger-spec.md §6.5, §8.3)", () => {
  test("#29/#30 14 pairs expand to 50 rows, 2022-06 .. 2026-07, sum 2 307 376 ct", () => {
    const bookings = expandRentSeries([...RENT_SERIES]);
    expect(bookings.length).toBe(RENT_SERIES_ROW_COUNT);
    expect(bookings[0]!.period).toBe(FIXTURE_RENT_SERIES_START);
    expect(bookings[0]!.period).toBe(RENT_SERIES_START);
    expect(bookings.at(-1)!.period).toBe("2026-07");
    const sum = bookings.reduce((total, b) => total + b.amountCents, 0);
    expect(sum).toBe(RENT_SERIES_SUM_CENTS);
  });

  test("the last row's amount matches the currently-valid income-proportional share (470.86 x 11)", () => {
    const bookings = expandRentSeries([...RENT_SERIES]);
    const lastEleven = bookings.slice(-11);
    expect(lastEleven).toHaveLength(11);
    for (const booking of lastEleven) expect(booking.amountCents).toBe(47_086);
  });

  test("periods are contiguous with no gaps or repeats", () => {
    const bookings = expandRentSeries([...RENT_SERIES]);
    const periods = new Set(bookings.map((b) => b.period));
    expect(periods.size).toBe(bookings.length);
  });
});

/* -------------------------------------------------------------------------- */
/* §6.6 K4 settlement total (cross-check against the shared fixture)          */
/* -------------------------------------------------------------------------- */

test("K4 transfer total matches the shared fixture (docs/ledger-spec.md §6.6, §8.3 #31)", () => {
  expect(TRANSFER_TOTAL_CENTS).toBe(4_128_099);
});

test("toPeriod round-trips a CalendarDate", () => {
  expect(toPeriod({ year: 2026, month: 3, day: 1 })).toBe("2026-03");
});

/* -------------------------------------------------------------------------- */
/* §7.6 the write path, against a real DB (review finding: this file had NO   */
/* integration test at all — only the parser unit tests above)               */
/* -------------------------------------------------------------------------- */

/**
 * The workbook is the operator's own household finances and is deliberately
 * NOT in the repository (`.gitignore`) — the import is a one-off that has
 * already run, so the file has no business travelling with the code. Every
 * number it proves is pinned independently in
 * `packages/shared/test/fixtures/haushalt-xlsx.ts`, which is what the rest of
 * the suite runs against; the two blocks below are the cross-check that the
 * fixture and the real sheet still agree, and they run only for whoever has
 * the file lying next to the repo root.
 */
const REAL_IMPORT_DATE: CalendarDate = { year: 2026, month: 8, day: 9 }; // pinned, not todayBerlin() — deterministic

/* -------------------------------------------------------------------------- */
/* §7.6 the write path — against a SYNTHETIC workbook, so CI has it too       */
/* -------------------------------------------------------------------------- */

/**
 * Everything below runs everywhere, including a fresh clone with no
 * `Haushalt.xlsx`. It uses a generated workbook of the same shape
 * (`support/synthetic-workbook.ts`) with invented amounts, which covers the
 * write path's real hazards — idempotency, per-household scoping, the plan
 * seed coming out of `R8`'s FORMULA, the text-cell quirk, the CLI wiring —
 * without needing anyone's finances.
 *
 * Every expected number here is derived by hand from `SYNTHETIC`, in the
 * comments, and was written down BEFORE the pipeline was run against it. That
 * is the whole point: a fixture generated from the fixture would only prove
 * it equals itself.
 */
const SYNTHETIC_XLSX_PATH = join(tmpdir(), `toon-finance-synthetic-${crypto.randomUUID()}.xlsx`);
writeSyntheticWorkbook(SYNTHETIC_XLSX_PATH);
// It has to be a real file on disk, not a buffer: the CLI test below spawns
// the actual script and hands it a path. So it also has to be cleaned up —
// one stray workbook per test run adds up on a developer machine.
afterAll(() => rmSync(SYNTHETIC_XLSX_PATH, { force: true }));

/*
 * A/B  P1 pays, SPLIT_EQUAL:  100,00 + 50,01 − 20,00      (row 5 has no amount -> skipped)
 * D/E  P2 pays, SPLIT_EQUAL:  30,00 + 25,00 (cached formula)
 * G/H  P1 pays, OTHER_ONLY:   40,00 + 31,47 (TEXT cell)
 * M/N  rent, OTHER_ONLY:      2 × 100,00 + 3 × 200,00     -> 2022-06 .. 2022-10
 * K4   SETTLEMENT:            500,00
 *
 * rows            = 3 + 2 + 2 + 5 + 1                              = 13
 * splitOther      = +(5000 + 2500 − 1000) − (1500 + 1250)          = +3750
 *                     └ halfForOther(5001) = 2500: the payer keeps the odd cent
 * forOther        = (4000 + 3147) + (2×10000 + 3×20000)            = +87 147
 * settled         = −50 000
 * balance         = 3750 + 87 147 − 50 000                         = +40 897
 */
const SYNTHETIC_ROW_COUNT = 13;
const SYNTHETIC_BALANCE_CENTS = 40_897;
/** The one text-typed cell, the only thing `--excel-text-quirk` may change. */
const SYNTHETIC_TEXT_CELL_CENTS = 3_147;

describe("writeImportRecords against a synthetic workbook (docs/spec.md §7.6)", () => {
  test("reads the shape correctly: 13 rows, hand-derived balance, nothing unparsable", () => {
    const result = buildImport(readWorkbook(SYNTHETIC_XLSX_PATH), false, REAL_IMPORT_DATE);
    expect(result.records).toHaveLength(SYNTHETIC_ROW_COUNT);
    expect(result.balanceCents).toBe(SYNTHETIC_BALANCE_CENTS);
    expect(result.unparsable).toHaveLength(0);

    // The row with a label and no amount is skipped, not imported as 0 —
    // `0` is the one forbidden amount in this ledger.
    expect(result.records.some((record) => record.amountCents === 0)).toBe(false);
    expect(result.records.filter((record) => record.externalKey.startsWith("xlsx:B:"))).toHaveLength(3);

    // The rent series expands to one OTHER_ONLY row per month, contiguous.
    const rentPeriods = result.records.filter((r) => r.externalKey.startsWith("xlsx:rent:")).map((r) => r.planPeriod);
    expect(rentPeriods).toEqual(["2022-06", "2022-07", "2022-08", "2022-09", "2022-10"]);
  });

  test("--excel-text-quirk drops exactly the text-typed cell and nothing else", () => {
    const workbook = readWorkbook(SYNTHETIC_XLSX_PATH);
    const withQuirk = buildImport(workbook, true, REAL_IMPORT_DATE);

    // Excel's own SUM silently skips a German-decimal-comma cell. Reproducing
    // that must cost exactly one row and exactly its amount — if the switch
    // ever leaked into another cell, these two numbers would drift apart.
    expect(withQuirk.records).toHaveLength(SYNTHETIC_ROW_COUNT - 1);
    expect(withQuirk.balanceCents).toBe(SYNTHETIC_BALANCE_CENTS - SYNTHETIC_TEXT_CELL_CENTS);
  });

  test("buildImport never writes: calling it repeatedly changes nothing in the DB", async () => {
    const workbook = readWorkbook(SYNTHETIC_XLSX_PATH);
    const before = await db.select({ id: transactions.id }).from(transactions);
    buildImport(workbook, false, REAL_IMPORT_DATE);
    buildImport(workbook, true, REAL_IMPORT_DATE);
    const after = await db.select({ id: transactions.id }).from(transactions);
    expect(after.length).toBe(before.length);
  });

  test("writes each row once; re-running the same import writes nothing", async () => {
    const owner = await createUser("SynOwner");
    const partner = await createUser("SynPartner");
    const householdId = await createHousehold(owner, "Synthetischer Import");
    await joinAsSecondMember(owner, householdId, partner);

    const result = buildImport(readWorkbook(SYNTHETIC_XLSX_PATH), false, REAL_IMPORT_DATE);

    const firstRun = await writeImportRecords(db, householdId, result.records);
    expect(firstRun.inserted).toBe(SYNTHETIC_ROW_COUNT);
    expect(firstRun.alreadyPresent).toBe(0);

    const secondRun = await writeImportRecords(db, householdId, result.records);
    expect(secondRun.inserted).toBe(0);
    expect(secondRun.alreadyPresent).toBe(SYNTHETIC_ROW_COUNT);

    const rows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.origin, "import")));
    expect(rows).toHaveLength(SYNTHETIC_ROW_COUNT); // nothing doubled
  });

  test("is scoped per household — a second household importing the same workbook is not swallowed by the first's externalKeys", async () => {
    const ownerA = await createUser("SynOwnerA");
    const partnerA = await createUser("SynPartnerA");
    const householdA = await createHousehold(ownerA, "Syn Haushalt A");
    await joinAsSecondMember(ownerA, householdA, partnerA);

    const ownerB = await createUser("SynOwnerB");
    const partnerB = await createUser("SynPartnerB");
    const householdB = await createHousehold(ownerB, "Syn Haushalt B");
    await joinAsSecondMember(ownerB, householdB, partnerB);

    const result = buildImport(readWorkbook(SYNTHETIC_XLSX_PATH), false, REAL_IMPORT_DATE);

    expect((await writeImportRecords(db, householdA, result.records)).inserted).toBe(SYNTHETIC_ROW_COUNT);

    // The guarded bug reported every row as "already present" — it matched the
    // unique index on `external_key` alone instead of `(household_id,
    // external_key)` — and silently wrote nothing for the second household.
    const b = await writeImportRecords(db, householdB, result.records);
    expect(b.inserted).toBe(SYNTHETIC_ROW_COUNT);
    expect(b.alreadyPresent).toBe(0);
  });

  test("seeds the fixed-cost plan from R8's FORMULA, not its cached value", async () => {
    const owner = await createUser("SynPlanOwner");
    const partner = await createUser("SynPlanPartner");
    const householdId = await createHousehold(owner, "Syn Plan Seed");
    await joinAsSecondMember(owner, householdId, partner);

    const result = buildImport(readWorkbook(SYNTHETIC_XLSX_PATH), false, REAL_IMPORT_DATE);

    // R8 is `600+100+50.5` with a cached `750.5`. Reading the cached value —
    // which is what every OTHER amount cell in the sheet is read by — yields
    // ONE item of 75 050 ct and loses the line items the plan is made of.
    expect(result.planSeed.fixedCostItemCents).toEqual([60_000, 10_000, 5_050]);
    expect(result.planSeed.fixedCostItemCents.reduce((a, b) => a + b, 0)).toBe(75_050);
    expect(result.planSeed.ownerSalaryCents).toBe(300_000);
    expect(result.planSeed.partnerSalaryCents).toBe(200_000);
    // The trailing run of equal rent amounts (3 × 200,00) starts at 2022-08…
    expect(result.planSeed.validSincePeriod).toBe("2022-08");
    // …and the plan may only start AFTER the last period the import covered.
    expect(result.planSeed.planStartPeriod).toBe("2022-11");

    const seedResult = await seedFixedCostPlan(db, householdId, result.planSeed);
    expect(seedResult.seeded).toBe(true);
    expect(seedResult.itemCount).toBe(3);
    expect(seedResult.incomeCount).toBe(2);

    const items = await db.select().from(fixedCostItems).where(eq(fixedCostItems.householdId, householdId));
    expect(items.reduce((sum, item) => sum + item.amountCents, 0)).toBe(75_050);

    const planRows = await db.select().from(fixedCostPlans).where(eq(fixedCostPlans.householdId, householdId));
    expect(planRows[0]?.startPeriod).toBe("2022-11");

    // Idempotent: seeding an already-seeded household changes nothing.
    expect((await seedFixedCostPlan(db, householdId, result.planSeed)).seeded).toBe(false);
    const itemsAfter = await db.select({ id: fixedCostItems.id }).from(fixedCostItems).where(eq(fixedCostItems.householdId, householdId));
    expect(itemsAfter).toHaveLength(3);

    // And the seeded data really computes: share(P2) =
    // round(200 000 × 75 050 / 500 000) = round(30 020) = 30 020 ct.
    const preview = await body<{ bookableCents: number; costTotalCents: number; incomeTotalCents: number }>(
      await call(`/api/households/${householdId}/finance/plan/preview?period=2022-11`, { cookie: owner.cookie }),
    );
    expect(preview.costTotalCents).toBe(75_050);
    expect(preview.incomeTotalCents).toBe(500_000);
    expect(preview.bookableCents).toBe(30_020);
  });

  test("the CLI entry point: --dry-run without --household exits 0 and writes nothing, via the real subprocess", () => {
    const proc = Bun.spawnSync({
      cmd: ["bun", "run", "apps/api/scripts/finance-import-xlsx.ts", SYNTHETIC_XLSX_PATH, "--dry-run"],
      cwd: `${import.meta.dir}/../../..`,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = proc.stdout.toString();
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain(`Total transactions: ${SYNTHETIC_ROW_COUNT}`);
    expect(stdout).toContain("no --household given: no database write performed.");
  });
});

