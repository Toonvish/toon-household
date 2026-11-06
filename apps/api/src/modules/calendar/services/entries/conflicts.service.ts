/**
 * `CalendarCarConflicts` (plan m8 P11): which other bookings of the same car overlap a candidate booking.
 *
 * Two bookings conflict when their half-open wall-time intervals overlap; an all-day booking covers
 * `[date 00:00, endDate+1 00:00)`. A recurring candidate is checked over its occurrences in `[startDate, min(until,
 * startDate + 366 days)]` (`CALENDAR_LIMITS.conflictHorizonDays`), every other booking of that car expanded over the
 * same window. An occurrence marked `skipped` blocks nothing (the other booking's, and on a PATCH the candidate's own).
 * `excludeEntryId` leaves the entry itself out on a PATCH.
 *
 * `check` answers the conflicts (at most `CALENDAR_LIMITS.conflictDetailsMax`, by date, time, entry id); the caller
 * decides (`CalendarEntries`: `409 calendar_car_conflict` unless `allowConflict`). Pure arithmetic over the shared
 * recurrence and day numbers: no `Date`.
 *
 * A leaf over `Database`; its static `layer` references only `effect` exports and its own class.
 */
import {
  CALENDAR_LIMITS,
  type CalendarCarConflict,
  type CalendarSeries,
  addCalendarDays,
  calendarDayNumber,
  expandOccurrences,
} from "@toon/shared";
import { and, eq, ne } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { calendarEntries, calendarOccurrenceStates } from "../../schema.ts";
import { loadEntryRecords, loadStates, seriesOf } from "./rows.ts";

/** What the check reads of the candidate booking (a create body or a merged PATCH). */
export interface CarBookingCandidate {
  readonly resourceId: string;
  readonly allDay: boolean;
  readonly startDate: string;
  readonly startTime: string | null;
  readonly endDate: string;
  readonly endTime: string | null;
  readonly repeat: CalendarSeries["repeat"];
}

const MINUTES_PER_DAY = 24 * 60;

function minutesOf(time: string | null): number {
  if (time === null) return 0;
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** The half-open interval in minutes since the day-number epoch of one occurrence. */
export function occurrenceInterval(
  booking: { readonly allDay: boolean; readonly startTime: string | null; readonly endTime: string | null },
  date: string,
  endDate: string,
): { readonly start: number; readonly end: number } {
  const startDay = calendarDayNumber(date);
  const endDay = calendarDayNumber(endDate);
  if (booking.allDay) return { start: startDay * MINUTES_PER_DAY, end: (endDay + 1) * MINUTES_PER_DAY };
  const start = startDay * MINUTES_PER_DAY + minutesOf(booking.startTime);
  // A timed car booking always has an end time (P6); a missing one is read as the end of its last day.
  const end = booking.endTime === null ? (endDay + 1) * MINUTES_PER_DAY : endDay * MINUTES_PER_DAY + minutesOf(booking.endTime);
  return { start, end: Math.max(end, start + 1) };
}

export class CalendarCarConflicts extends Context.Service<
  CalendarCarConflicts,
  {
    readonly check: (
      householdId: string,
      candidate: CarBookingCandidate,
      excludeEntryId: string | null,
    ) => Effect.Effect<Array<CalendarCarConflict>, DatabaseError>;
  }
>()("toon/api/modules/calendar/services/entries/conflicts.service/CalendarCarConflicts") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const check = Effect.fn("CalendarCarConflicts.check")(function* (
        householdId: string,
        candidate: CarBookingCandidate,
        excludeEntryId: string | null,
      ) {
        const horizon = addCalendarDays(candidate.startDate, CALENDAR_LIMITS.conflictHorizonDays);
        const windowEnd =
          candidate.repeat.freq === "none"
            ? candidate.startDate
            : candidate.repeat.until !== null && candidate.repeat.until < horizon
              ? candidate.repeat.until
              : horizon;
        const own = expandOccurrences(
          { startDate: candidate.startDate, endDate: candidate.endDate, repeat: candidate.repeat },
          candidate.startDate,
          windowEnd,
          Number.MAX_SAFE_INTEGER,
        ).occurrences.filter((occurrence) => occurrence.date >= candidate.startDate);

        let ownOccurrences = own;
        if (excludeEntryId !== null && own.length > 0) {
          const ownStates = yield* loadStates(database, [excludeEntryId], eq(calendarOccurrenceStates.status, "skipped"));
          ownOccurrences = own.filter((occurrence) => !ownStates.has(`${excludeEntryId}:${occurrence.date}`));
        }
        if (ownOccurrences.length === 0) return [];

        const intervals = ownOccurrences.map((occurrence) => occurrenceInterval(candidate, occurrence.date, occurrence.endDate));
        const from = ownOccurrences[0]!.date;
        const to = ownOccurrences.reduce((last, occurrence) => (occurrence.endDate > last ? occurrence.endDate : last), from);

        const where =
          excludeEntryId === null
            ? and(eq(calendarEntries.kind, "car"), eq(calendarEntries.resourceId, candidate.resourceId))
            : and(
                eq(calendarEntries.kind, "car"),
                eq(calendarEntries.resourceId, candidate.resourceId),
                ne(calendarEntries.id, excludeEntryId),
              );
        const others = yield* loadEntryRecords(database, householdId, where);
        if (others.length === 0) return [];
        const skipped = yield* loadStates(
          database,
          others.map((record) => record.row.id),
          eq(calendarOccurrenceStates.status, "skipped"),
        );

        const conflicts: Array<CalendarCarConflict> = [];
        for (const record of others) {
          const { row } = record;
          const expansion = expandOccurrences(seriesOf(row), from, to, Number.MAX_SAFE_INTEGER);
          for (const occurrence of expansion.occurrences) {
            if (skipped.has(`${row.id}:${occurrence.date}`)) continue;
            const other = occurrenceInterval(row, occurrence.date, occurrence.endDate);
            if (intervals.some((mine) => mine.start < other.end && other.start < mine.end)) {
              conflicts.push({
                entryId: row.id,
                date: occurrence.date,
                startTime: row.allDay ? null : row.startTime,
                endTime: row.allDay ? null : row.endTime,
                title: row.title,
                memberIds: [...record.attendeeIds],
              });
            }
          }
        }
        conflicts.sort(
          (a, b) =>
            (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
            ((a.startTime ?? "") < (b.startTime ?? "") ? -1 : (a.startTime ?? "") > (b.startTime ?? "") ? 1 : 0) ||
            (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0),
        );
        return conflicts.slice(0, CALENDAR_LIMITS.conflictDetailsMax);
      });

      return CalendarCarConflicts.of({ check });
    }),
  );
}
