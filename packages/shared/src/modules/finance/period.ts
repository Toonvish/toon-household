/**
 * Period ('YYYY-MM') arithmetic — the unit of the fixed-cost plan
 * (docs/ledger-spec.md §4). Pure: every function that needs "now" takes it as
 * a parameter (a unix-ms timestamp) instead of reading the clock itself. The
 * clock SEAM (`nowMs()` / `setClockForTest()`) belongs to `apps/api/src/lib/clock.ts`
 * — this module never imports it and never calls `Date.now()`.
 *
 * All periods and day boundaries are `Europe/Berlin`, hard-coded
 * (docs/spec.md §8.1 #6) — there is no household timezone column.
 */

const BERLIN = "Europe/Berlin";

/** A calendar month, `'YYYY-MM'`. Lexicographically sortable == chronologically sortable. */
export type Period = string;

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPeriod(value: string): value is Period {
  return PERIOD_RE.test(value);
}

function assertPeriod(period: string): asserts period is Period {
  if (!isPeriod(period)) {
    throw new Error(`invalid period: "${period}" (expected YYYY-MM)`);
  }
}

function splitPeriod(period: Period): { year: number; month: number } {
  const [year, month] = period.split("-");
  return { year: Number(year), month: Number(month) };
}

function formatPeriod(year: number, month: number): Period {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The `YYYY-MM` period containing the instant `ms`, in `timeZone` (default `Europe/Berlin`). */
export function periodOf(ms: number, timeZone: string = BERLIN): Period {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(ms));
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  if (!year || !month) throw new Error(`could not resolve period for ms=${ms} in ${timeZone}`);
  return `${year}-${month}`;
}

/**
 * The current period for a given "now" (docs/spec.md task brief: take "now"
 * as a PARAMETER, never read the clock). `nowMs` is a unix-ms timestamp,
 * typically `nowMs()` from `apps/api/src/lib/clock.ts`.
 */
export function currentPeriod(nowMs: number, timeZone: string = BERLIN): Period {
  return periodOf(nowMs, timeZone);
}

export function nextPeriod(period: Period): Period {
  assertPeriod(period);
  const { year, month } = splitPeriod(period);
  return month === 12 ? formatPeriod(year + 1, 1) : formatPeriod(year, month + 1);
}

export function previousPeriod(period: Period): Period {
  assertPeriod(period);
  const { year, month } = splitPeriod(period);
  return month === 1 ? formatPeriod(year - 1, 12) : formatPeriod(year, month - 1);
}

/** `-1` / `0` / `1` — plain string comparison is chronological for `YYYY-MM`. */
export function comparePeriods(a: Period, b: Period): number {
  assertPeriod(a);
  assertPeriod(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every period from `from` to `to`, inclusive, in order. Empty if `to < from`. */
export function periodsInclusive(from: Period, to: Period): Period[] {
  assertPeriod(from);
  assertPeriod(to);
  const result: Period[] = [];
  if (comparePeriods(from, to) > 0) return result;
  let cursor = from;
  for (;;) {
    result.push(cursor);
    if (comparePeriods(cursor, to) === 0) break;
    cursor = nextPeriod(cursor);
  }
  return result;
}

/** The offset (ms) that `timeZone` is ahead of UTC at instant `utcMs`. */
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

/**
 * The unix-ms instant of local midnight on the first day of `period`, in
 * `timeZone` (default `Europe/Berlin`). Used for `bookedAt` of every
 * plan-generated transaction.
 */
export function periodStartMs(period: Period, timeZone: string = BERLIN): number {
  assertPeriod(period);
  const { year, month } = splitPeriod(period);
  const utcGuess = Date.UTC(year, month - 1, 1, 0, 0, 0);
  const offsetMs = timeZoneOffsetMs(utcGuess, timeZone);
  return utcGuess - offsetMs;
}
