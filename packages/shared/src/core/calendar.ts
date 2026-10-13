/**
 * Calendar dates (YYYY-MM-DD), for the meal planner. Pure, no I/O.
 *
 * A PlanDate is a DATE, not an instant: it has no time and no timezone, which is
 * exactly why the planner stores one (see meal_plan_entries in apps/api/src/db/schema.ts).
 *
 * TWO RULES, and they are the whole file:
 *  1. `todayPlanDate()` / `toPlanDate(date)` read the LOCAL calendar of whoever calls
 *     them — that is the user's Thursday. Only a client may call them. Never
 *     `date.toISOString().slice(0,10)`: that is the UTC calendar, and it is off by a
 *     day every evening east of Greenwich.
 *  2. All arithmetic is done in UTC on the parsed Y/M/D (`Date.UTC`), because a
 *     local-time `+ 86_400_000` lands on 23:00 the day before across a spring-forward
 *     boundary (Europe/Berlin, 2026-03-29). A PlanDate has no time, so UTC math on it
 *     cannot be wrong.
 */

export type PlanDate = string; // "YYYY-MM-DD"

const PLAN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a syntactically valid AND real date ("2026-02-31" is neither). */
export function isPlanDate(value: string): boolean {
  if (!PLAN_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC normalises an out-of-range day/month (e.g. Feb 31 -> Mar 3), so a
  // mismatch after round-tripping is exactly what marks the input as unreal.
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function fromParts(year: number, month: number, day: number): PlanDate {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function toParts(value: PlanDate): [number, number, number] {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return [year, month, day];
}

/** The LOCAL calendar date of `date` (default: now). Clients only — see rule 1. */
export function toPlanDate(date: Date = new Date()): PlanDate {
  return fromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** `toPlanDate()` with no argument, named for the call sites that read better. */
export function todayPlanDate(): PlanDate {
  return toPlanDate();
}

/** UTC-noon `Date` for the value — for `Intl.DateTimeFormat` weekday rendering only. */
export function planDateToDate(value: PlanDate): Date {
  const [year, month, day] = toParts(value);
  // Noon, not midnight: a UTC-midnight instant renders as the PREVIOUS day in
  // every timezone west of Greenwich, which is exactly the bug this file exists
  // to prevent. Noon has no timezone within +/-12h that crosses to another date.
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/** Calendar arithmetic, DST-proof (see rule 2). */
export function addPlanDays(value: PlanDate, delta: number): PlanDate {
  const [year, month, day] = toParts(value);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return fromParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Whole days from `a` to `b` (b - a). Negative when b is earlier. */
export function planDaysBetween(a: PlanDate, b: PlanDate): number {
  const [ay, am, ad] = toParts(a);
  const [by, bm, bd] = toParts(b);
  const msPerDay = 86_400_000;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / msPerDay);
}

/** The MONDAY of the week containing `value`. Monday is fixed, see below. */
export function startOfPlanWeek(value: PlanDate): PlanDate {
  const [year, month, day] = toParts(value);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  // Monday is hardcoded on purpose: the strip runs MON 1 .. SUN 7, the app is
  // German-first, ISO-8601's week starts on Monday, and it is a SHARED planner —
  // an `en` user of a German recipe box gets the same week as their flatmate. This
  // is not wired to the viewer's locale; there is deliberately no `weekStartsOn`
  // parameter for anything to set.
  const deltaToMonday = weekday === 0 ? -6 : 1 - weekday;
  return addPlanDays(value, deltaToMonday);
}

/** The 7 PlanDates Mon..Sun of the week containing `value`. */
export function planWeek(value: PlanDate): PlanDate[] {
  const monday = startOfPlanWeek(value);
  return Array.from({ length: 7 }, (_, i) => addPlanDays(monday, i));
}

/** `weekStart` shifted by whole weeks (negative = earlier). `weekStart` need not itself be a Monday. */
export function shiftPlanWeek(weekStart: PlanDate, weeks: number): PlanDate {
  return addPlanDays(weekStart, weeks * 7);
}

/** The Monday..Sunday range containing `date` (default: now), as plan-date bounds. */
export function planWeekRange(date: Date = new Date()): { from: PlanDate; to: PlanDate } {
  const week = planWeek(toPlanDate(date));
  return { from: week[0]!, to: week[6]! };
}

/** Midnight (device local) of the day containing `at`, as unix ms. */
export function startOfLocalDay(at: Date | number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Groups rows into day buckets keyed by the LOCAL calendar day of `at(row)`,
 * preserving each row's original order within its bucket. `at(row)` must return
 * something `new Date()` can parse (an ISO instant is the usual case — bought
 * logs, cook logs). Buckets themselves are ordered by first appearance, which is
 * how a newest-first row list stays newest-first bucket-by-bucket.
 */
export function groupByLocalDay<T>(
  rows: readonly T[],
  at: (row: T) => string,
): Array<{ dayKey: PlanDate; rows: T[] }> {
  const buckets = new Map<PlanDate, T[]>();
  for (const row of rows) {
    const dayKey = toPlanDate(new Date(at(row)));
    const bucket = buckets.get(dayKey);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(dayKey, [row]);
    }
  }
  return Array.from(buckets, ([dayKey, bucketRows]) => ({ dayKey, rows: bucketRows }));
}
