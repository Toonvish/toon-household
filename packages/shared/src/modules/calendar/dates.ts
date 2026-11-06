/**
 * Calendar arithmetic on `YYYY-MM-DD` and `HH:MM` strings (plan m8 P2), with Howard Hinnant's days-from-civil
 * algorithm (proleptic Gregorian calendar): no `Date`, no clock and no local time zone anywhere, so the API's
 * services and the parser may use it (CLAUDE.md idioms rules (11), (19)) and the web gets the same answers.
 *
 * A day number counts days since 1970-01-01 (that day is 0). Every function takes a REAL date; feed it only
 * values that passed `isCalendarDate` (the shared schemas do that on the wire).
 */

/** A wall-clock date, `YYYY-MM-DD`, no time zone. */
export type CalendarDateString = string;
/** A wall-clock time, `HH:MM` (00:00 … 23:59), no time zone. */
export type CalendarTimeString = string;

/** The earliest and the latest date the calendar accepts on the wire (`CalendarDateSchema`). */
export const CALENDAR_DATE_MIN = "1900-01-01";
export const CALENDAR_DATE_MAX = "2199-12-31";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True for a Gregorian leap year. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** The number of days of `month` (1-12) in `year`. */
export function daysInCalendarMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_DAYS[month - 1] ?? 0;
}

/** True for a well-formed AND real date (`2027-02-29` is false, `2028-02-29` true). */
export function isCalendarDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInCalendarMonth(year, month);
}

/** True for `HH:MM` between 00:00 and 23:59. */
export function isCalendarTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** The year, month (1-12) and day of a date. */
export function calendarDateParts(date: CalendarDateString): { readonly year: number; readonly month: number; readonly day: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) };
}

/** Days since 1970-01-01 of a civil date (days_from_civil). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** Formats a year, month (1-12) and day as `YYYY-MM-DD`. */
export function formatCalendarDate(year: number, month: number, day: number): CalendarDateString {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** The day number of a date: days since 1970-01-01. */
export function calendarDayNumber(date: CalendarDateString): number {
  const { year, month, day } = calendarDateParts(date);
  return daysFromCivil(year, month, day);
}

/** The date of a day number (civil_from_days). */
export function fromDayNumber(dayNumber: number): CalendarDateString {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return formatCalendarDate(year, month, day);
}

/** `date` plus `days` (negative goes back). */
export function addCalendarDays(date: CalendarDateString, days: number): CalendarDateString {
  return fromDayNumber(calendarDayNumber(date) + days);
}

/** The number of days from `from` to `to` (negative when `to` is earlier); `calendarDaysBetween(d, d)` is 0. */
export function calendarDaysBetween(from: CalendarDateString, to: CalendarDateString): number {
  return calendarDayNumber(to) - calendarDayNumber(from);
}

/** The weekday of a day number: 0 = Monday … 6 = Sunday (1970-01-01 was a Thursday). */
export function weekdayOfDayNumber(dayNumber: number): number {
  return (((dayNumber + 3) % 7) + 7) % 7;
}

/** The weekday of a date: 0 = Monday … 6 = Sunday (ISO order, `CALENDAR_WEEKDAYS`). */
export function calendarWeekday(date: CalendarDateString): number {
  return weekdayOfDayNumber(calendarDayNumber(date));
}

/**
 * Orders two wall-clock moments: by date, then by time, where a missing time (`null`, an all-day entry) comes
 * BEFORE every time of the same day. Negative, 0 or positive, as `Array.prototype.sort` wants.
 */
export function compareDateTime(
  aDate: CalendarDateString,
  aTime: CalendarTimeString | null,
  bDate: CalendarDateString,
  bTime: CalendarTimeString | null,
): number {
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  if (aTime === bTime) return 0;
  if (aTime === null) return -1;
  if (bTime === null) return 1;
  return aTime < bTime ? -1 : 1;
}
