/**
 * A series' rhythm in words and its rotation (design §1.3, §4.4, §4.5). Pure, over the shared recurrence: the
 * preview line of the form (`calendar.entries.repeat.preview`) and the rotation's next person use the very `nextOccurrences` and
 * ordinals the API expands with, so the screen and the server never disagree.
 */
import {
  CALENDAR_WEEKDAYS,
  calendarDateParts,
  calendarWeekday,
  nextOccurrences,
  type CalendarEntry,
  type CalendarRepeat,
  type CalendarSeries,
  type CalendarWeekday,
} from "@toon/shared";
import { translate } from "@/lib/i18n";
import { formatDayMonth, formatShortDate, weekdayShortName } from "./format";

/** The recurrence input of an entry (or of a form's draft). */
export function seriesOf(entry: {
  readonly startDate: string;
  readonly endDate: string;
  readonly repeat: CalendarRepeat;
}): CalendarSeries {
  return {
    startDate: entry.startDate,
    endDate: entry.endDate,
    repeat: {
      freq: entry.repeat.freq,
      interval: entry.repeat.interval,
      weekdays: entry.repeat.weekdays,
      until: entry.repeat.until,
    },
  };
}

/** The weekdays a weekly rhythm uses: the listed ones in ISO order, else the start date's. */
export function weeklyDays(repeat: Pick<CalendarRepeat, "weekdays">, startDate: string): CalendarWeekday[] {
  if (repeat.weekdays.length === 0) return [CALENDAR_WEEKDAYS[calendarWeekday(startDate)] ?? "MO"];
  return CALENDAR_WEEKDAYS.filter((code) => repeat.weekdays.includes(code));
}

/**
 * The rhythm in words (`calendar.rhythm.*`): once, every n days, the weekdays of a weekly rhythm, the day of
 * month or of the year, plus the end date when the series ends.
 */
export function rhythmLabel(repeat: CalendarRepeat, startDate: string, today?: string): string {
  const count = repeat.interval;
  let text: string;
  switch (repeat.freq) {
    case "none":
      return translate("calendar.rhythm.once");
    case "daily":
      text = translate("calendar.rhythm.daily", { count });
      break;
    case "weekly": {
      const days = weeklyDays(repeat, startDate).map(weekdayShortName).join(", ");
      text = translate("calendar.rhythm.weekly", { count, days });
      break;
    }
    case "monthly":
      text = translate("calendar.rhythm.monthly", { count, day: calendarDateParts(startDate).day });
      break;
    case "yearly":
      text = translate("calendar.rhythm.yearly", { count, date: formatDayMonth(startDate) });
      break;
  }
  return repeat.until === null ? text : translate("calendar.rhythm.until", { rhythm: text, date: formatShortDate(repeat.until, today) });
}

/** The start dates of the next `count` occurrences on or after `from` (the form's preview line). */
export function nextDates(series: CalendarSeries, from: string, count: number): string[] {
  return nextOccurrences(series, from, count).map((occurrence) => occurrence.date);
}

/** Who has the occurrence with this ordinal in a rotation (`assigneeIds[ordinal mod n]`). */
export function rotationPick(assigneeIds: ReadonlyArray<string>, ordinal: number): string | null {
  if (assigneeIds.length === 0) return null;
  return assigneeIds[ordinal % assigneeIds.length] ?? null;
}

/**
 * The next occurrence on or after `from` and its person (Aufgaben "Wiederkehrend"): the fixed assignee, the
 * rotation's pick for that ordinal, or nobody. `null` when the series has no occurrence left.
 */
export function nextAssignment(
  entry: Pick<CalendarEntry, "startDate" | "endDate" | "repeat" | "assigneeMode" | "assigneeIds">,
  from: string,
): { readonly date: string; readonly ordinal: number; readonly userId: string | null } | null {
  const next = nextOccurrences(seriesOf(entry), from, 1)[0];
  if (next === undefined) return null;
  const userId =
    entry.assigneeMode === "rotate"
      ? rotationPick(entry.assigneeIds, next.ordinal)
      : entry.assigneeMode === "fixed"
        ? (entry.assigneeIds[0] ?? null)
        : null;
  return { date: next.date, ordinal: next.ordinal, userId };
}
