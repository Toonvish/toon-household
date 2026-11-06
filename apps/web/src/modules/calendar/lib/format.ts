/**
 * Date, time and label rendering of the calendar (design §4, §5.6). Pure functions over `YYYY-MM-DD` / `HH:MM`
 * strings and the shared date arithmetic: no `Date`, no time zone, so a label never shifts by a day in the evening.
 * The words come from the module catalogs (`calendar.weekday.*`, `calendar.month.*`, `calendar.format.*`) at the
 * ambient locale (`translate`, as `@/lib/format` does), so these work inside and outside React.
 *
 * Content (an entry's title) is never translated; a waste entry has no title and is labelled from the catalog by
 * its category (design §5.6).
 */
import {
  CALENDAR_WEEKDAYS,
  addCalendarDays,
  calendarDateParts,
  calendarWeekday,
  type CalendarWasteCategory,
  type CalendarWasteDetail,
} from "@toon/shared";
import { translate, type MessageKey } from "@/lib/i18n";

type MonthNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

function weekdayCode(date: string): (typeof CALENDAR_WEEKDAYS)[number] {
  return CALENDAR_WEEKDAYS[calendarWeekday(date)] ?? "MO";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `Mo` / `Mon` for a weekday code. */
export function weekdayShortName(code: (typeof CALENDAR_WEEKDAYS)[number]): string {
  return translate(`calendar.weekday.short.${code}`);
}

/** `Mo` / `Mon` of a date. */
export function weekdayShort(date: string): string {
  return weekdayShortName(weekdayCode(date));
}

/** `Montag` / `Monday` of a date. */
export function weekdayLong(date: string): string {
  return translate(`calendar.weekday.long.${weekdayCode(date)}`);
}

/** `November` for 11. */
export function monthName(month: number): string {
  const key = `calendar.month.${Math.min(12, Math.max(1, month)) as MonthNumber}` as const;
  return translate(key);
}

/** `Fr 13.11.`; with the year when it is not `today`'s (`Fr 13.11.2028`). */
export function formatShortDate(date: string, today?: string): string {
  const { year, month, day } = calendarDateParts(date);
  const values = { weekday: weekdayShort(date), day: pad2(day), month: pad2(month), year: String(year) };
  if (today !== undefined && today.slice(0, 4) !== date.slice(0, 4)) {
    return translate("calendar.format.shortDateYear", values);
  }
  return translate("calendar.format.shortDate", values);
}

/** `13.11.` / `13/11`: a day of the year without the weekday (the yearly rhythm). */
export function formatDayMonth(date: string): string {
  const { month, day } = calendarDateParts(date);
  return translate("calendar.format.dayMonth", { day: pad2(day), month: pad2(month) });
}

/** `Mittwoch, 11. November`. */
export function formatLongDate(date: string): string {
  const { month, day } = calendarDateParts(date);
  return translate("calendar.format.longDate", { weekday: weekdayLong(date), day: String(day), month: monthName(month) });
}

/**
 * A day heading (design §4.2): `Heute · Mittwoch, 11. November`, `Morgen · Do 12.11.`, else `Fr 13.11.`. The
 * caller renders it as an `.eyebrow` (upper case is the utility's, never the string's).
 */
export function formatDayHeading(date: string, today: string): string {
  if (date === today) {
    return translate("calendar.format.relativeDay", {
      relative: translate("calendar.common.today"),
      date: formatLongDate(date),
    });
  }
  if (date === addCalendarDays(today, 1)) {
    return translate("calendar.format.relativeDay", {
      relative: translate("calendar.common.tomorrow"),
      date: formatShortDate(date, today),
    });
  }
  return formatShortDate(date, today);
}

/** `November 2026` for `2026-11`. */
export function formatMonthTitle(month: string): string {
  return translate("calendar.format.monthTitle", { month: monthName(Number(month.slice(5, 7))), year: month.slice(0, 4) });
}

/** `08:00–17:00`, or `08:00` without an end. */
export function formatTimeRange(start: string | null, end: string | null): string {
  if (start === null) return "";
  if (end === null) return start;
  return translate("calendar.common.timeRange", { start, end });
}

/** What the calendar knows about when something happens: an occurrence or a conflict. */
export interface WhenLike {
  readonly date: string;
  readonly endDate?: string | null | undefined;
  readonly allDay?: boolean | undefined;
  readonly startTime: string | null;
  readonly endTime: string | null;
}

/**
 * The time column of a row: `ganztägig`, `08:00`, `08:00–17:00`. A multi-day span names its dates
 * (`Fr 13.11. bis So 15.11.`), with the times when it has them.
 */
export function formatWhen(when: WhenLike, today?: string): string {
  const endDate = when.endDate ?? when.date;
  const allDay = when.allDay ?? when.startTime === null;
  if (endDate !== when.date) {
    const from = allDay || when.startTime === null ? formatShortDate(when.date, today) : `${formatShortDate(when.date, today)} ${when.startTime}`;
    const to = allDay || when.endTime === null ? formatShortDate(endDate, today) : `${formatShortDate(endDate, today)} ${when.endTime}`;
    return translate("calendar.common.dateRange", { from, to });
  }
  if (allDay || when.startTime === null) return translate("calendar.common.allDay");
  return formatTimeRange(when.startTime, when.endTime);
}

const WASTE_TYPE_KEYS = {
  waste_rest: "calendar.waste.type.waste_rest",
  waste_yellow: "calendar.waste.type.waste_yellow",
  waste_bio: "calendar.waste.type.waste_bio",
  waste_paper: "calendar.waste.type.waste_paper",
  waste_tree: "calendar.waste.type.waste_tree",
} as const satisfies Record<CalendarWasteCategory, MessageKey>;

/** `Restmüll`, `Biotonne + Reinigung` (design §5.6). */
export function wasteLabel(category: CalendarWasteCategory, detail: CalendarWasteDetail | null = null): string {
  const label = translate(WASTE_TYPE_KEYS[category]);
  return detail === "bio_cleaning" ? translate("calendar.waste.withCleaning", { label }) : label;
}

/** The label of an occurrence or entry: its title, a waste type from the catalog, or `Ohne Titel`. */
export function entryTitle(item: {
  readonly title: string | null;
  readonly category: CalendarWasteCategory | null;
  readonly categoryDetail: CalendarWasteDetail | null;
}): string {
  if (item.title !== null && item.title.length > 0) return item.title;
  if (item.category !== null) return wasteLabel(item.category, item.categoryDetail);
  return translate("calendar.common.untitled");
}

/** Several pickups of one day as ONE label: `Restmüll · Gelber Sack`. */
export function wasteListLabel(
  pickups: ReadonlyArray<{ readonly category: CalendarWasteCategory; readonly detail?: CalendarWasteDetail | null }>,
): string {
  return pickups.map((pickup) => wasteLabel(pickup.category, pickup.detail ?? null)).join(" · ");
}
