/**
 * [IMPORT] Date resolution for imported rows (docs/ledger-spec.md §6.3): most
 * rows have no date of their own, many labels embed one, and the rows in
 * each column are append-only (so row order is chronological at month
 * granularity — that is what makes "carry from the nearest anchor" safe).
 *
 * Two passes, run per column (each of A/B, D/E, G/H has its own anchor set):
 *
 *   Pass 1 — find "anchors": rows whose label yields a date with an
 *   explicit year (patterns R1-R4, plus R6 promoted when it also carries an
 *   explicit, in-range 4-digit year). An anchor outside
 *   `[moveIn, importDate]` is rejected (there is exactly one in the real
 *   data: a `05.08.16` typo for `05.08.26`) and falls through to pass 2.
 *
 *   Pass 2 — every other row is bracketed by the nearest anchor above
 *   (`prev`, or `moveIn` if none) and below (`next`, or `importDate` if
 *   none), and resolved by, in order: R5 (day.month, year inferred from the
 *   bracket), R6 (German month name, day := 15, year inferred the same way),
 *   R7 (carry `prev` forward, precision "estimated").
 *
 * Each row is resolved INDEPENDENTLY inside its bracket, and deliberately so.
 * It is tempting to also force the output to be non-decreasing — two rows in
 * one bracket can otherwise come out inverted, an earlier "5.3" taking 2022
 * (2021-03 is before `lo`) while a later "20.12" fits 2021. That reads like a
 * bug until you check the workbook: column A rows 18/20/28 are `Obi 02.10`,
 * `Obi 30.09`, `Lutz 29.09` — the September-2021 move-in shopping, typed in
 * whatever order it was remembered, descending. "Append-only" holds at the
 * scale of the sheet, NOT row to row. A monotonic floor was measured against
 * the real corpus and pushed `Obi 30.09` from 2021-09-30 to 2022-09-30,
 * cascading a full-year shift onto the 18 rows below it and costing 4 rows
 * their `day` precision. Ordering within a bracket carries no information
 * here; the label does. Do not re-add the clamp.
 */

export type DatePrecision = "day" | "month" | "estimated";

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface ResolvedDate extends CalendarDate {
  precision: DatePrecision;
  /** True for a pass-1 anchor — only anchors are used as pass-2 brackets. */
  isAnchor: boolean;
}

function dateKey(d: CalendarDate): number {
  return d.year * 10000 + d.month * 100 + d.day;
}

function compareDates(a: CalendarDate, b: CalendarDate): number {
  return dateKey(a) - dateKey(b);
}

function inRange(d: CalendarDate, lo: CalendarDate, hi: CalendarDate): boolean {
  return compareDates(d, lo) >= 0 && compareDates(d, hi) <= 0;
}

const GERMAN_MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  märz: 3,
  maerz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};
const MONTH_NAME_RE = new RegExp(`\\b(${Object.keys(GERMAN_MONTHS).join("|")})\\b`, "iu");
/** An exact 4-digit year (`(?<!\d)` / `(?!\d)` so `20026` never matches as `2002`). */
const YEAR_RE = /(?<!\d)((?:19|20)\d{2})(?!\d)/;

interface PatternMatch {
  date: CalendarDate;
  precision: DatePrecision;
  /** Kept so a rejected day.month.year anchor can still seed an R5 attempt in pass 2 (§6.3, `Fressnapf 05.08.16`). */
  salvageDayMonth?: { day: number; month: number };
}

/** R1: `DD.MM.YYYY`. */
function matchR1(label: string): PatternMatch | null {
  const m = /(?<!\d)(\d{1,2})\.(\d{1,2})\.((?:19|20)\d{2})(?!\d)/.exec(label);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  return { date: { year, month, day }, precision: "day", salvageDayMonth: { day, month } };
}

/** R2: `DD.MM.YY` (20YY; no leading `\s` requirement — `Amazon27.01.23` is real data). */
function matchR2(label: string): PatternMatch | null {
  const m = /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{2})(?!\d)/.exec(label);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = 2000 + Number(m[3]);
  return { date: { year, month, day }, precision: "day", salvageDayMonth: { day, month } };
}

/** R3: `D.YYYY`, first number ≤ 12 (a month). */
function matchR3(label: string): PatternMatch | null {
  const re = /(?<!\d)(\d{1,2})\.((?:19|20)\d{2})(?!\d)/g;
  for (const m of label.matchAll(re)) {
    const month = Number(m[1]);
    if (month < 1 || month > 12) continue;
    const year = Number(m[2]);
    return { date: { year, month, day: 15 }, precision: "month" };
  }
  return null;
}

/** R4: `D.YY` where the second number is 13-99 (can't be a month, so it's a 2-digit year). */
function matchR4(label: string): PatternMatch | null {
  const re = /(?<!\d)(\d{1,2})\.(\d{1,2})(?!\.?\d)/g;
  for (const m of label.matchAll(re)) {
    const month = Number(m[1]);
    const yy = Number(m[2]);
    if (yy < 13 || yy > 99) continue;
    if (month < 1 || month > 12) continue;
    return { date: { year: 2000 + yy, month, day: 15 }, precision: "month" };
  }
  return null;
}

/** R6 promoted to pass 1: a German month name with an explicit, exact 4-digit year. */
function matchR6WithYear(label: string): PatternMatch | null {
  const monthMatch = MONTH_NAME_RE.exec(label);
  if (!monthMatch) return null;
  const yearMatch = YEAR_RE.exec(label);
  if (!yearMatch) return null;
  const month = GERMAN_MONTHS[monthMatch[1]!.toLowerCase()]!;
  const year = Number(yearMatch[1]);
  return { date: { year, month, day: 15 }, precision: "month" };
}

/** Pass 1, in order: first pattern that matches the label wins. */
function matchAnchorPattern(label: string): PatternMatch | null {
  return matchR1(label) ?? matchR2(label) ?? matchR3(label) ?? matchR4(label) ?? matchR6WithYear(label);
}

/** R5: `day.month`, year unknown — try every year in `[lo.year, hi.year]`, smallest first, that lands in `[lo, hi]`. */
function matchR5(label: string, lo: CalendarDate, hi: CalendarDate): CalendarDate | null {
  const re = /(?<!\d)(\d{1,2})\.(\d{1,2})(?!\.?\d)/g;
  for (const m of label.matchAll(re)) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) continue; // day.month convention only
    if (day < 1 || day > 31) continue;
    const found = yearInBracket(day, month, lo, hi);
    if (found) return found;
  }
  return null;
}

function yearInBracket(day: number, month: number, lo: CalendarDate, hi: CalendarDate): CalendarDate | null {
  for (let year = lo.year; year <= hi.year; year++) {
    const candidate: CalendarDate = { year, month, day };
    if (inRange(candidate, lo, hi)) return candidate;
  }
  return null;
}

/** R6 in pass 2: month name, day := 15, year inferred the same way as R5. */
function matchR6(label: string, lo: CalendarDate, hi: CalendarDate): CalendarDate | null {
  const monthMatch = MONTH_NAME_RE.exec(label);
  if (!monthMatch) return null;
  const month = GERMAN_MONTHS[monthMatch[1]!.toLowerCase()]!;
  return yearInBracket(15, month, lo, hi);
}

/** One row's label plus its position, for `resolveColumnDates`. */
export interface LabelledRow {
  row: number;
  label: string;
}

/**
 * Resolves every row of one sheet column to a date (docs/ledger-spec.md
 * §6.3). `rows` must already be in ascending sheet-row order (the append-only
 * property the whole heuristic relies on).
 */
export function resolveColumnDates(
  rows: readonly LabelledRow[],
  moveIn: CalendarDate,
  importDate: CalendarDate,
): Map<number, ResolvedDate> {
  // Pass 1.
  interface RowState {
    row: number;
    label: string;
    anchor: CalendarDate | null;
    anchorPrecision: DatePrecision | null;
    salvage: { day: number; month: number } | null;
    rejected: boolean;
  }

  const states: RowState[] = rows.map(({ row, label }) => {
    const match = matchAnchorPattern(label);
    if (!match) return { row, label, anchor: null, anchorPrecision: null, salvage: null, rejected: false };

    if (inRange(match.date, moveIn, importDate)) {
      return { row, label, anchor: match.date, anchorPrecision: match.precision, salvage: null, rejected: false };
    }
    // Out-of-range anchor: rejected, but the day/month pair (if any) survives
    // into pass 2 as an R5 candidate — §6.3's "Fressnapf 05.08.16" case.
    return { row, label, anchor: null, anchorPrecision: null, salvage: match.salvageDayMonth ?? null, rejected: true };
  });

  /** Nearest confirmed anchor above/below row `index` (by array position, which is row order). */
  function bracketFor(index: number): { lo: CalendarDate; hi: CalendarDate } {
    let lo = moveIn;
    for (let i = index - 1; i >= 0; i--) {
      const anchor = states[i]!.anchor;
      if (anchor) {
        lo = anchor;
        break;
      }
    }
    let hi = importDate;
    for (let i = index + 1; i < states.length; i++) {
      const anchor = states[i]!.anchor;
      if (anchor) {
        hi = anchor;
        break;
      }
    }
    return { lo, hi };
  }

  const result = new Map<number, ResolvedDate>();
  for (let i = 0; i < states.length; i++) {
    const s = states[i]!;
    if (s.anchor) {
      result.set(s.row, { ...s.anchor, precision: s.anchorPrecision!, isAnchor: true });
      continue;
    }

    const { lo, hi } = bracketFor(i);

    if (s.salvage) {
      const found = yearInBracket(s.salvage.day, s.salvage.month, lo, hi);
      if (found) {
        result.set(s.row, { ...found, precision: "day", isAnchor: false });
        continue;
      }
    }

    const r5 = matchR5(s.label, lo, hi);
    if (r5) {
      result.set(s.row, { ...r5, precision: "day", isAnchor: false });
      continue;
    }

    const r6 = matchR6(s.label, lo, hi);
    if (r6) {
      result.set(s.row, { ...r6, precision: "month", isAnchor: false });
      continue;
    }

    // R7: carry `lo` (the nearest anchor above, or move-in) forward.
    result.set(s.row, { ...lo, precision: "estimated", isAnchor: false });
  }

  return result;
}

/** `CalendarDate` -> `'YYYY-MM'`. */
export function toPeriod(d: CalendarDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}`;
}

/** `CalendarDate` -> `'YYYY-MM-DD'`. */
export function toIsoDate(d: CalendarDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

const BERLIN = "Europe/Berlin";

/** The offset (ms) `timeZone` is ahead of UTC at instant `utcMs` — mirrors `packages/shared/src/period.ts`'s private helper. */
function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const value = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return asUtc - utcMs;
}

/** Local midnight of `d` in `Europe/Berlin`, as unix ms — the `bookedAt` every imported row uses. */
export function dateStartMsBerlin(d: CalendarDate): number {
  const utcGuess = Date.UTC(d.year, d.month - 1, d.day, 0, 0, 0);
  const offset = timeZoneOffsetMs(utcGuess, BERLIN);
  return utcGuess - offset;
}
