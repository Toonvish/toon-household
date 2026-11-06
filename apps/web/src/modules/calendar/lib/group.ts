/**
 * Grouping of an occurrence list for the screens (design §4.2-§4.4, §5.6). Pure: the list arrives in the API's
 * order (plan m8 P10: date, all-day before timed, time, waste before other entries, title), and nothing here
 * re-sorts within a day.
 *
 * Waste pickups of one day render as ONE row (the labels joined by a middle dot) at the position of the day's first pickup.
 */
import {
  WASTE_CATEGORIES,
  addCalendarDays,
  calendarDayNumber,
  calendarWeekday,
  daysInCalendarMonth,
  formatCalendarDate,
  type CalendarOccurrence,
  type CalendarWasteCategory,
} from "@toon/shared";

/** A waste pickup (a task with a category). */
export function isWaste(occurrence: Pick<CalendarOccurrence, "category">): boolean {
  return occurrence.category !== null;
}

/** One line of a day: an occurrence, or the day's pickups merged. */
export type AgendaRow =
  | { readonly type: "occurrence"; readonly key: string; readonly occurrence: CalendarOccurrence }
  | { readonly type: "waste"; readonly key: string; readonly date: string; readonly occurrences: ReadonlyArray<CalendarOccurrence> };

/** One day of the agenda with its rows. */
export interface AgendaDay {
  readonly date: string;
  readonly rows: ReadonlyArray<AgendaRow>;
}

/** The rows of ONE day's occurrences (already in API order): every pickup of the day merged into one row. */
export function agendaRows(items: ReadonlyArray<CalendarOccurrence>): AgendaRow[] {
  const rows: AgendaRow[] = [];
  const wasteByDate = new Map<string, CalendarOccurrence[]>();
  for (const occurrence of items) {
    if (!isWaste(occurrence)) {
      rows.push({ type: "occurrence", key: occurrence.id, occurrence });
      continue;
    }
    const bucket = wasteByDate.get(occurrence.date);
    if (bucket) {
      bucket.push(occurrence);
      continue;
    }
    const merged = [occurrence];
    wasteByDate.set(occurrence.date, merged);
    rows.push({ type: "waste", key: `waste:${occurrence.date}`, date: occurrence.date, occurrences: merged });
  }
  return rows;
}

/** True when the occurrence covers `date` (its start, its end or a day between). */
export function coversDate(occurrence: Pick<CalendarOccurrence, "date" | "endDate">, date: string): boolean {
  return occurrence.date <= date && occurrence.endDate >= date;
}

/**
 * The bookings of one car that still hold it on or after `from`, in list order. A skipped occurrence holds nothing
 * (plan m8 P11: the server's conflict check ignores it, so the car is free for another booking).
 */
export function carBookingsFrom(items: ReadonlyArray<CalendarOccurrence>, carId: string, from: string): CalendarOccurrence[] {
  return items.filter(
    (occurrence) =>
      occurrence.kind === "car" && occurrence.resourceId === carId && occurrence.status !== "skipped" && occurrence.endDate >= from,
  );
}

/** The bookings that hold one car on `date` (a skipped occurrence holds nothing), in list order. */
export function carBookingsOn(items: ReadonlyArray<CalendarOccurrence>, carId: string, date: string): CalendarOccurrence[] {
  return carBookingsFrom(items, carId, date).filter((occurrence) => coversDate(occurrence, date));
}

/** The occurrences that cover `date`, in list order. */
export function occurrencesOn(items: ReadonlyArray<CalendarOccurrence>, date: string): CalendarOccurrence[] {
  return items.filter((occurrence) => coversDate(occurrence, date));
}

/**
 * The days from `from` to `to` that have something, each with its rows. An occurrence is listed on its start
 * date, or on `from` when it started earlier and still runs. Empty days are skipped (design §4.2).
 */
export function groupByDay(items: ReadonlyArray<CalendarOccurrence>, from: string, to: string): AgendaDay[] {
  const byDay = new Map<string, CalendarOccurrence[]>();
  for (const occurrence of items) {
    if (occurrence.endDate < from || occurrence.date > to) continue;
    const day = occurrence.date < from ? from : occurrence.date;
    const bucket = byDay.get(day);
    if (bucket) bucket.push(occurrence);
    else byDay.set(day, [occurrence]);
  }
  return [...byDay.keys()]
    .sort()
    .map((date) => ({ date, rows: agendaRows(byDay.get(date) ?? []) }));
}

/**
 * What goes out tonight (design §5.6): the waste types collected TOMORROW, in display order, without a pickup
 * marked skipped.
 */
export function tonightPickups(items: ReadonlyArray<CalendarOccurrence>, today: string): CalendarWasteCategory[] {
  const tomorrow = addCalendarDays(today, 1);
  const categories = new Set<CalendarWasteCategory>();
  for (const occurrence of items) {
    if (occurrence.category === null || occurrence.date !== tomorrow || occurrence.status === "skipped") continue;
    categories.add(occurrence.category);
  }
  return WASTE_CATEGORIES.filter((category) => categories.has(category));
}

/** Open task occurrences before today, at most `days` back (design §4.2, the overdue section); pickups are not chores to catch up on. */
export function overdueTasks(items: ReadonlyArray<CalendarOccurrence>, today: string, days = 7): CalendarOccurrence[] {
  const earliest = addCalendarDays(today, -days);
  return items.filter(
    (occurrence) =>
      occurrence.kind === "task" &&
      !isWaste(occurrence) &&
      occurrence.status === "open" &&
      occurrence.date < today &&
      occurrence.date >= earliest,
  );
}

/** `YYYY-MM` of a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** True for a well-formed `YYYY-MM` between 1900 and 2199. */
export function isCalendarMonth(value: string | undefined): value is string {
  if (value === undefined || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 1900 && year <= 2199;
}

/** The month before or after `month` (`2026-12` + 1 is `2027-01`). */
export function addMonths(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * The days a month grid shows (design §4.3): whole ISO weeks, Monday first, from the week of the 1st to the week
 * of the last day (35 or 42 days, 28 for a February that starts on a Monday in a common year).
 */
export function monthGridDays(month: string): string[] {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const first = formatCalendarDate(year, monthNumber, 1);
  const last = formatCalendarDate(year, monthNumber, daysInCalendarMonth(year, monthNumber));
  const start = addCalendarDays(first, -calendarWeekday(first));
  const end = addCalendarDays(last, 6 - calendarWeekday(last));
  const count = calendarDayNumber(end) - calendarDayNumber(start) + 1;
  return Array.from({ length: count }, (_, index) => addCalendarDays(start, index));
}

/** True for Saturday and Sunday (the grid's `--bg-sunken` cells). */
export function isWeekend(date: string): boolean {
  return calendarWeekday(date) >= 5;
}

/**
 * The member filter, client side, with the API's rule (plan m8 P10): an occurrence stays when its attendees
 * contain the member, when the member is its assignee, or when it names nobody (an event for everybody, an
 * unassigned task or pickup). `undefined` keeps everything. Filtering the one fetched list (instead of a second
 * request per chip) keeps the Today card and the agenda on one cache entry, offline too.
 */
export function matchesMember(
  occurrence: Pick<CalendarOccurrence, "memberIds" | "assigneeId">,
  memberId: string | undefined,
): boolean {
  if (memberId === undefined) return true;
  if (occurrence.memberIds.length === 0 && occurrence.assigneeId === null) return true;
  return occurrence.memberIds.includes(memberId) || occurrence.assigneeId === memberId;
}
