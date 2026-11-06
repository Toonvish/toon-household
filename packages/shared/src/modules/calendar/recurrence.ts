/**
 * Recurrence (design §1.3, plan m8 P3): a small RRULE subset over wall-clock dates, pure and shared by the API
 * and the web.
 *
 * - `none`: one occurrence on the start date.
 * - `daily`: every `interval` days from the start date.
 * - `weekly`: the ISO week (Monday first) of the start date is week 0; weeks `0, interval, 2·interval, …` hold an
 *   occurrence on each listed weekday that is not before the start date (no weekdays listed: the start date's).
 * - `monthly`: the start's day of month every `interval` months; a month WITHOUT that day (the 31st in April) is
 *   skipped and is not an occurrence.
 * - `yearly`: the start's month and day every `interval` years (29 February only in leap years).
 * - `until` (inclusive) bounds the occurrence START date.
 *
 * Every occurrence keeps the series' duration (`endDate - startDate` days). `ordinal` counts occurrences from the
 * series start (0-based); every occurrence counts, whatever its state, so a skipped day never shifts a rotation.
 * The first ordinal of a window is computed arithmetically for daily and weekly series and by month or year
 * stepping (bounded by the series' age) for monthly and yearly ones, never by walking the series day by day.
 */
import type { CalendarDateString } from "./dates.ts";
import {
  calendarDayNumber,
  calendarDateParts,
  daysInCalendarMonth,
  formatCalendarDate,
  fromDayNumber,
  weekdayOfDayNumber,
} from "./dates.ts";
import { CALENDAR_LIMITS, CALENDAR_WEEKDAYS } from "./limits.ts";

type Weekday = (typeof CALENDAR_WEEKDAYS)[number];
type Freq = "none" | "daily" | "weekly" | "monthly" | "yearly";

/** What the expansion reads of an entry: its first occurrence's dates and its rhythm. */
export interface CalendarSeries {
  readonly startDate: CalendarDateString;
  readonly endDate: CalendarDateString;
  readonly repeat: {
    readonly freq: Freq;
    readonly interval: number;
    readonly weekdays: ReadonlyArray<Weekday>;
    readonly until: CalendarDateString | null;
  };
}

/** One occurrence: its start and end date and its 0-based position in the series. */
export interface CalendarOccurrenceDate {
  readonly date: CalendarDateString;
  readonly endDate: CalendarDateString;
  readonly ordinal: number;
}

/** How many month or year steps a search may take without finding an occurrence before it gives up (a guard). */
const MAX_EMPTY_STEPS = 10_000;

interface Hit {
  readonly day: number;
  readonly ordinal: number;
}

function intervalOf(series: CalendarSeries): number {
  const interval = Math.trunc(series.repeat.interval);
  return interval >= 1 ? interval : 1;
}

/** The selected weekdays as sorted indices 0 (Monday) … 6; none listed means the start date's weekday. */
function weekdayIndices(series: CalendarSeries, startDay: number): ReadonlyArray<number> {
  const listed = new Set<number>();
  for (const code of series.repeat.weekdays) {
    const index = CALENDAR_WEEKDAYS.indexOf(code);
    if (index >= 0) listed.add(index);
  }
  if (listed.size === 0) listed.add(weekdayOfDayNumber(startDay));
  return [...listed].sort((a, b) => a - b);
}

function countBelow(sorted: ReadonlyArray<number>, value: number): number {
  let count = 0;
  for (const item of sorted) if (item < value) count += 1;
  return count;
}

/**
 * Every occurrence whose start day is `>= fromDay`, in order, with its ordinal. Lazy and unbounded unless the
 * series has an `until`; callers stop it.
 */
function* occurrencesFrom(series: CalendarSeries, fromDay: number): Generator<Hit> {
  const startDay = calendarDayNumber(series.startDate);
  const untilDay = series.repeat.until === null ? Number.POSITIVE_INFINITY : calendarDayNumber(series.repeat.until);
  const firstDay = Math.max(fromDay, startDay);
  const interval = intervalOf(series);

  switch (series.repeat.freq) {
    case "none": {
      if (startDay >= fromDay) yield { day: startDay, ordinal: 0 };
      return;
    }
    case "daily": {
      let ordinal = Math.ceil((firstDay - startDay) / interval);
      for (let day = startDay + ordinal * interval; day <= untilDay; day += interval, ordinal += 1) {
        yield { day, ordinal };
      }
      return;
    }
    case "weekly": {
      const weekdays = weekdayIndices(series, startDay);
      const perWeek = weekdays.length;
      const weekZero = startDay - weekdayOfDayNumber(startDay);
      const beforeStart = countBelow(weekdays, weekdayOfDayNumber(startDay));
      // The first selected week that can hold `firstDay`.
      let week = Math.floor((firstDay - weekZero) / 7);
      week = Math.ceil(week / interval) * interval;
      for (; ; week += interval) {
        const monday = weekZero + week * 7;
        if (monday > untilDay) return;
        const selected = week / interval;
        for (let position = 0; position < perWeek; position += 1) {
          const day = monday + weekdays[position]!;
          if (day < firstDay) continue;
          if (day > untilDay) return;
          yield { day, ordinal: selected * perWeek + position - beforeStart };
        }
      }
    }
    case "monthly":
    case "yearly": {
      const start = calendarDateParts(series.startDate);
      const monthsPerStep = series.repeat.freq === "monthly" ? interval : interval * 12;
      const first = calendarDateParts(fromDayNumber(firstDay));
      const monthsToFirst = (first.year - start.year) * 12 + (first.month - start.month);
      // Steps before the window: the step holding `firstDay`'s month may still start before it, so begin one earlier.
      let step = Math.max(0, Math.floor(monthsToFirst / monthsPerStep) - 1);
      let ordinal = 0;
      for (let earlier = 0; earlier < step; earlier += 1) {
        if (stepDay(start, earlier * monthsPerStep) !== null) ordinal += 1;
      }
      let empty = 0;
      for (; ; step += 1) {
        const day = stepDay(start, step * monthsPerStep);
        if (day === null) {
          empty += 1;
          if (empty > MAX_EMPTY_STEPS) return;
          continue;
        }
        empty = 0;
        if (day > untilDay) return;
        if (day >= firstDay) yield { day, ordinal };
        ordinal += 1;
      }
    }
  }
}

/** The day number of the start's day of month `months` months after the start, or null when that month lacks it. */
function stepDay(start: { readonly year: number; readonly month: number; readonly day: number }, months: number): number | null {
  const index = start.month - 1 + months;
  const year = start.year + Math.floor(index / 12);
  const month = (index % 12) + 1;
  if (start.day > daysInCalendarMonth(year, month)) return null;
  return calendarDayNumber(formatCalendarDate(year, month, start.day));
}

function durationOf(series: CalendarSeries): number {
  return Math.max(0, calendarDayNumber(series.endDate) - calendarDayNumber(series.startDate));
}

function toOccurrence(hit: Hit, duration: number): CalendarOccurrenceDate {
  return { date: fromDayNumber(hit.day), endDate: fromDayNumber(hit.day + duration), ordinal: hit.ordinal };
}

/**
 * Every occurrence that OVERLAPS `[from, to]` (both inclusive): `date <= to` and `endDate >= from`. At most
 * `limit` occurrences; `overflow` is true when the window holds more (the API refuses that, P4: no silent
 * truncation).
 */
export function expandOccurrences(
  series: CalendarSeries,
  from: CalendarDateString,
  to: CalendarDateString,
  limit: number = CALENDAR_LIMITS.maxOccurrencesPerEntry,
): { readonly occurrences: ReadonlyArray<CalendarOccurrenceDate>; readonly overflow: boolean } {
  const duration = durationOf(series);
  const toDay = calendarDayNumber(to);
  const occurrences: Array<CalendarOccurrenceDate> = [];
  for (const hit of occurrencesFrom(series, calendarDayNumber(from) - duration)) {
    if (hit.day > toDay) break;
    if (occurrences.length >= limit) return { occurrences, overflow: true };
    occurrences.push(toOccurrence(hit, duration));
  }
  return { occurrences, overflow: false };
}

/** The ordinal of the occurrence that STARTS on `date`, or null when no occurrence starts that day. */
export function occurrenceOrdinal(series: CalendarSeries, date: CalendarDateString): number | null {
  const day = calendarDayNumber(date);
  for (const hit of occurrencesFrom(series, day)) return hit.day === day ? hit.ordinal : null;
  return null;
}

/** The next `count` occurrences that start on or after `from` (the preview line of the entry form). */
export function nextOccurrences(
  series: CalendarSeries,
  from: CalendarDateString,
  count: number,
): ReadonlyArray<CalendarOccurrenceDate> {
  const duration = durationOf(series);
  const result: Array<CalendarOccurrenceDate> = [];
  if (count <= 0) return result;
  for (const hit of occurrencesFrom(series, calendarDayNumber(from))) {
    result.push(toOccurrence(hit, duration));
    if (result.length >= count) break;
  }
  return result;
}
