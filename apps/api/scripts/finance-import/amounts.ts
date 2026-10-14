/**
 * [IMPORT] Amount-cell parsing (docs/ledger-spec.md §6.2). One cell in, signed
 * integer cents out (or `null` for an empty cell, or a thrown
 * {@link AmountParseError} for text this parser refuses to guess at).
 *
 * This is deliberately narrower than `@toon/shared`'s `parseGermanAmount`
 * (the general-purpose UI input parser): a spreadsheet cell is either a
 * number, a formula's cached number, or — in exactly one known case (`H79`,
 * `"31,47"`) — a shared string holding a bare German-decimal-comma amount.
 * Anything else is a parsing bug, not a format this importer should guess
 * its way through (docs/ledger-spec.md §6.2: "a silently dropped amount is
 * exactly the bug the sheet already has").
 */
import type { XlsxCell } from "./xlsx-reader.ts";

export class AmountParseError extends Error {
  constructor(
    public readonly ref: string,
    public readonly raw: string,
  ) {
    super(`unparsable_amount at ${ref}: ${JSON.stringify(raw)}`);
    this.name = "AmountParseError";
  }
}

/** `-?\d+(?:[.,]\d{1,2})?` after stripping spaces and a trailing `€` — the only text shape this parser accepts. */
const TEXT_AMOUNT_RE = /^-?\d+(?:[.,]\d{1,2})?$/;

function toCentsHalfAwayFromZero(value: number, ref: string, raw: string): number {
  if (!Number.isFinite(value)) throw new AmountParseError(ref, raw);
  const cents = Math.sign(value) * Math.round(Math.abs(value) * 100);
  // Excel's cached doubles are all within 1e-9 of a 2-decimal value
  // (docs/ledger-spec.md §6.2); anything further off means this cell is not
  // actually a plain money amount and must fail loudly, not silently round.
  if (Math.abs(value * 100 - cents) >= 0.001) throw new AmountParseError(ref, raw);
  return cents;
}

function parseTextAmount(raw: string, ref: string): number {
  const trimmed = raw.trim().replace(/\s+/g, "").replace(/€$/u, "");
  if (!TEXT_AMOUNT_RE.test(trimmed)) throw new AmountParseError(ref, raw);
  return toCentsHalfAwayFromZero(Number(trimmed.replace(",", ".")), ref, raw);
}

export interface AmountCellOptions {
  /**
   * `--excel-text-quirk` (docs/ledger-spec.md §6.7): reproduce Excel's own
   * `SUM`, which silently skips text-typed operands. Any shared-string cell
   * that would otherwise be recovered (only `H79` in this workbook) is
   * treated as empty instead of parsed.
   */
  excelTextQuirk?: boolean;
}

/**
 * Reads one amount cell. `undefined`/self-closed cells and `t="s"` cells
 * under `excelTextQuirk` both resolve to `null` ("no amount here" —
 * §1.5's skip-not-zero rule); anything textual that isn't a recognisable
 * German-decimal-comma number throws.
 */
export function parseAmountCell(
  cell: XlsxCell | undefined,
  sharedStrings: readonly string[],
  options: AmountCellOptions = {},
): number | null {
  if (!cell) return null;

  // Formula cells: always read the cached <v>, never re-evaluate <f>.
  if (cell.formula !== undefined) {
    if (cell.value === undefined) return null;
    return toCentsHalfAwayFromZero(Number(cell.value), cell.ref, cell.value);
  }

  if (cell.type === "s") {
    if (options.excelTextQuirk) return null;
    const idx = Number(cell.value);
    const raw = sharedStrings[idx];
    if (raw === undefined) throw new AmountParseError(cell.ref, cell.value ?? "");
    return parseTextAmount(raw, cell.ref);
  }

  // A formula-string result ("str") — not used for any amount cell in this
  // workbook, but handled the same way as a shared string for safety.
  if (cell.type === "str") {
    if (cell.value === undefined) return null;
    return parseTextAmount(cell.value, cell.ref);
  }

  if (cell.value === undefined) return null; // self-closed / empty cell (§1.5)
  return toCentsHalfAwayFromZero(Number(cell.value), cell.ref, cell.value);
}
