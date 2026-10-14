/**
 * [IMPORT] Builds a real `.xlsx` on disk with the SHAPE of `Haushalt.xlsx` and
 * invented numbers, so the importer's write path can be exercised in CI.
 *
 * The real workbook is the operator's household finances and is gitignored, so
 * a fresh clone has no input for `readWorkbook` at all. What that costs is
 * worth being precise about, because it is easy to overclaim here:
 *
 *   - What CI CAN check with this file: that the pipeline reads a workbook of
 *     this shape correctly, that `writeImportRecords` is idempotent on
 *     `(householdId, externalKey)` and scoped per household, that the plan
 *     seed comes out of `R8`'s FORMULA rather than its cached value, that the
 *     `--excel-text-quirk` switch changes exactly one cell, and that the CLI
 *     entry point wires all of it together.
 *   - What it CANNOT check, ever: that
 *     `packages/shared/test/fixtures/haushalt-xlsx.ts` still agrees with the
 *     real sheet. A workbook generated from the fixture would only prove the
 *     fixture equals itself. That cross-check needs the real file and stays in
 *     the block that skips without it.
 *
 * The numbers below are deliberately small and hand-checkable — every expected
 * total in the test that uses them is derived in a comment there, not copied
 * out of a run. Each one exists to exercise a specific hazard the real sheet
 * contains: an odd cent, a negative amount, a row with a label but no amount,
 * a formula cell whose cached value is what counts, a TEXT-typed amount cell
 * (the `H79` quirk), and `R8`, whose formula text is the only place the
 * individual fixed-cost items exist.
 *
 * The archive is written with ZIP compression method 0 (stored). `xlsx-reader`
 * supports it, and it keeps this file free of a deflate implementation — the
 * point is a valid container, not a small one.
 */
import { writeFileSync } from "node:fs";

/* -------------------------------------------------------------------------- */
/* the invented sheet                                                         */
/* -------------------------------------------------------------------------- */

/** Index into the shared-string table for the one TEXT-typed amount cell (`H4` here, `H79` in the real sheet). */
const SHARED_STRINGS = ["31,47"] as const;

export const SYNTHETIC = {
  /** A/B — P1 paid, split 50/50. Row 5 has a label and NO amount. */
  ab: [
    { row: 3, label: "Sofa 10.05.2023", amount: "100" },
    { row: 4, label: "Lampe", amount: "50.01" }, // odd cent: halfForOther -> 2500, payer keeps 2501
    { row: 5, label: "Nur Text ohne Betrag", amount: null }, // skipped_no_amount
    { row: 6, label: "Erstattung", amount: "-20" }, // negative amounts are valid and meaningful
  ],
  /** D/E — P2 paid, split 50/50. Row 4 is a formula whose CACHED value is authoritative. */
  de: [
    { row: 3, label: "Einkauf 02.06.2023", amount: "30" },
    { row: 4, label: "Pfanne", amount: "25", formula: "(20 + 5)" },
  ],
  /** G/H — P1 paid FOR P2 (OTHER_ONLY). Row 4 is the text-cell quirk. */
  gh: [
    { row: 3, label: "Extra 03.07.2023", amount: "40" },
    { row: 4, label: "Textzelle", amount: null, sharedStringIndex: 0 }, // "31,47"
  ],
  /** M/N — `(amount, months)` rent pairs, plain numeric cells only. */
  rent: [
    { row: 23, amount: "100", months: 2 }, // 2022-06, 2022-07
    { row: 24, amount: "200", months: 3 }, // 2022-08 .. 2022-10  <- trailing run of equal amounts
  ],
  /** K4 — the single lump settlement. */
  transfer: "500",
  /** R5/R6 — the two salaries. R8 — the fixed costs, as a FORMULA. */
  plan: {
    ownerSalary: "3000",
    partnerSalary: "2000",
    fixedCostFormula: "600+100+50.5",
    /** R8's cached value. Deliberately DIFFERENT arithmetic is impossible here,
     * but it is the value a naive reader would take instead of the formula. */
    fixedCostCachedValue: "750.5",
  },
} as const;

/* -------------------------------------------------------------------------- */
/* XML                                                                        */
/* -------------------------------------------------------------------------- */

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A plain numeric cell — no `t` attribute, which is what `extractRentSeries` requires of M/N. */
function numberCell(ref: string, value: string): string {
  return `<c r="${ref}"><v>${value}</v></c>`;
}

/** A shared-string cell (`t="s"`), the shape Excel writes every label in. */
function stringCell(ref: string, index: number): string {
  return `<c r="${ref}" t="s"><v>${index}</v></c>`;
}

/** A formula cell: the importer reads the CACHED `<v>`, never re-evaluates `<f>` — except for R8. */
function formulaCell(ref: string, formula: string, cachedValue: string): string {
  return `<c r="${ref}"><f>${escapeXml(formula)}</f><v>${cachedValue}</v></c>`;
}

function buildSheetXml(): string {
  // Labels go into the shared-string table exactly as Excel does it, so the
  // `t="s"` -> index -> table lookup is exercised rather than bypassed.
  const strings: string[] = [...SHARED_STRINGS];
  const stringIndex = (text: string): number => {
    const existing = strings.indexOf(text);
    if (existing >= 0) return existing;
    strings.push(text);
    return strings.length - 1;
  };

  const rows = new Map<number, string[]>();
  const push = (row: number, cell: string): void => {
    const list = rows.get(row) ?? [];
    list.push(cell);
    rows.set(row, list);
  };

  // Rows 1-2 are the sheet's own headers; data starts at row 3 (DATA_START_ROW).
  push(1, stringCell("A1", stringIndex("Kostenrechnung")));
  push(2, stringCell("A2", stringIndex("Ausgaben")));
  push(2, stringCell("D2", stringIndex("Partner gezahlt")));
  push(2, stringCell("G2", stringIndex("Partner Extra")));

  for (const entry of SYNTHETIC.ab) {
    push(entry.row, stringCell(`A${entry.row}`, stringIndex(entry.label)));
    if (entry.amount !== null) push(entry.row, numberCell(`B${entry.row}`, entry.amount));
  }
  for (const entry of SYNTHETIC.de) {
    push(entry.row, stringCell(`D${entry.row}`, stringIndex(entry.label)));
    push(
      entry.row,
      "formula" in entry && entry.formula
        ? formulaCell(`E${entry.row}`, entry.formula, entry.amount)
        : numberCell(`E${entry.row}`, entry.amount),
    );
  }
  for (const entry of SYNTHETIC.gh) {
    push(entry.row, stringCell(`G${entry.row}`, stringIndex(entry.label)));
    if (entry.amount !== null) {
      push(entry.row, numberCell(`H${entry.row}`, entry.amount));
    } else {
      // The `H79` hazard: an amount typed with a German decimal comma, which
      // Excel stores as TEXT and silently omits from its own SUM.
      push(entry.row, stringCell(`H${entry.row}`, entry.sharedStringIndex));
    }
  }
  for (const pair of SYNTHETIC.rent) {
    push(pair.row, numberCell(`M${pair.row}`, pair.amount));
    push(pair.row, numberCell(`N${pair.row}`, String(pair.months)));
  }

  push(4, numberCell("K4", SYNTHETIC.transfer));
  push(5, numberCell("R5", SYNTHETIC.plan.ownerSalary));
  push(6, numberCell("R6", SYNTHETIC.plan.partnerSalary));
  push(8, formulaCell("R8", SYNTHETIC.plan.fixedCostFormula, SYNTHETIC.plan.fixedCostCachedValue));

  const rowXml = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, cells]) => `<row r="${row}">${cells.join("")}</row>`)
    .join("");

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
  const sharedStringsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((text) => `<si><t>${escapeXml(text)}</t></si>`).join("") +
    `</sst>`;

  return JSON.stringify({ sheet, sharedStringsXml });
}

/* -------------------------------------------------------------------------- */
/* ZIP (stored, method 0)                                                     */
/* -------------------------------------------------------------------------- */

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipInput {
  name: string;
  data: Buffer;
}

/** A minimal, valid ZIP with every entry STORED — enough for `xlsx-reader`, and a real archive. */
function buildZip(entries: readonly ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method 0 = stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01) — deterministic, no clock in the fixture
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); // method 0
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // relative offset of local header
    centrals.push(central, name);

    offset += local.length + name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, eocd]);
}

/** Writes the synthetic workbook to `filePath` and returns it. */
export function writeSyntheticWorkbook(filePath: string): string {
  const { sheet, sharedStringsXml } = JSON.parse(buildSheetXml()) as { sheet: string; sharedStringsXml: string };
  const zip = buildZip([
    { name: "xl/sharedStrings.xml", data: Buffer.from(sharedStringsXml, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet, "utf8") },
  ]);
  writeFileSync(filePath, zip);
  return filePath;
}
