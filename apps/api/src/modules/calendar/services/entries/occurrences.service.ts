/**
 * `CalendarOccurrences` (plan m8 P4, P9a, P10, P12): the expanded calendar and the occurrence states.
 *
 * - `list(householdId, query)`: every occurrence that OVERLAPS `[from, to]` (both inclusive, the client's dates: the
 *   server never decides "today"), filtered (`memberId`: an occurrence naming that member as attendee or assignee, or
 *   naming nobody; `kind`) and in P10 order, plus the household's members (P9a). A range above 400 days, or an entry
 *   expanding to more than 2000 occurrences in it, is `422 calendar_range_too_large` at `to` (P4: never truncated).
 * - `expand(householdId, query)` (plan m9 P9): the same expansion, states, caps, filters and order as `list`, each item
 *   with the `EntryRecord` it came from (the subscription feed reads the entry's notes and `updated_at`); `list` is
 *   `expand` mapped to its occurrences, behaviour unchanged.
 * - `setStatus(householdId, entryId, date, status, userId)`: `done` (tasks only, else `409 calendar_not_a_task`) or
 *   `skipped` (any kind) upserts the state row, `null` deletes it; `date` must be an occurrence START of the series
 *   (else `404 not_found`). Answers that occurrence.
 *
 * Over `Database` and `CalendarMembers`; the Clock stamps a state's `updated_at`.
 */
import {
  CALENDAR_LIMITS,
  type CalendarOccurrence,
  type CalendarOccurrenceListResponse,
  type CalendarOccurrenceQuery,
  calendarDaysBetween,
  expandOccurrences,
  isCalendarDate,
  occurrenceOrdinal,
} from "@toon/shared";
import { type SQL, and, eq, gte, lte, ne, or } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { ApiFailure, type DatabaseError, NotFound } from "../../../../lib/errors.ts";
import { calendarEntries, calendarOccurrenceStates } from "../../schema.ts";
import { CalendarMembers } from "../members.ts";
import {
  type EntryRecord,
  compareOccurrences,
  loadEntryOr404,
  loadEntryRecords,
  loadStates,
  rangeTooLarge,
  seriesOf,
  toOccurrenceDto,
} from "./rows.ts";

/** One expanded occurrence with the series it belongs to (plan m9 P9). */
export interface ExpandedOccurrence {
  readonly occurrence: CalendarOccurrence;
  readonly entry: EntryRecord;
}

/** What `CalendarOccurrences.expand` answers: the occurrences with their entries, in P10 order, and the members. */
export interface ExpandedOccurrences {
  readonly items: Array<ExpandedOccurrence>;
  readonly members: CalendarOccurrenceListResponse["members"];
}

export class CalendarOccurrences extends Context.Service<
  CalendarOccurrences,
  {
    readonly list: (
      householdId: string,
      query: CalendarOccurrenceQuery,
    ) => Effect.Effect<CalendarOccurrenceListResponse, ApiFailure | DatabaseError>;
    /** `list` with each occurrence's `EntryRecord` (plan m9 P9: the subscription feed). */
    readonly expand: (
      householdId: string,
      query: CalendarOccurrenceQuery,
    ) => Effect.Effect<ExpandedOccurrences, ApiFailure | DatabaseError>;
    readonly setStatus: (
      householdId: string,
      entryId: string,
      date: string,
      status: "done" | "skipped" | null,
      userId: string,
    ) => Effect.Effect<CalendarOccurrence, NotFound | ApiFailure | DatabaseError>;
  }
>()("toon/api/modules/calendar/services/entries/occurrences.service/CalendarOccurrences") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const members = yield* CalendarMembers;

      const expand = Effect.fn("CalendarOccurrences.expand")(function* (householdId: string, query: CalendarOccurrenceQuery) {
        const { from, to } = query;
        if (calendarDaysBetween(from, to) + 1 > CALENDAR_LIMITS.maxRangeDays) {
          return yield* rangeTooLarge("server.calendar.rangeTooLarge");
        }
        const filters: Array<SQL | undefined> = [
          lte(calendarEntries.startDate, to),
          or(ne(calendarEntries.repeatFreq, "none"), gte(calendarEntries.endDate, from)),
        ];
        if (query.kind !== undefined) filters.push(eq(calendarEntries.kind, query.kind));
        const records = yield* loadEntryRecords(database, householdId, and(...filters));

        const expanded: Array<{ record: (typeof records)[number]; date: string; ordinal: number }> = [];
        let earliest = from;
        for (const record of records) {
          const expansion = expandOccurrences(seriesOf(record.row), from, to);
          if (expansion.overflow) return yield* rangeTooLarge("server.calendar.tooManyOccurrences");
          for (const occurrence of expansion.occurrences) {
            expanded.push({ record, date: occurrence.date, ordinal: occurrence.ordinal });
            if (occurrence.date < earliest) earliest = occurrence.date;
          }
        }
        const entryIds = [...new Set(expanded.map((item) => item.record.row.id))];
        const states =
          entryIds.length === 0
            ? new Map()
            : yield* loadStates(
                database,
                entryIds,
                and(gte(calendarOccurrenceStates.occurrenceDate, earliest), lte(calendarOccurrenceStates.occurrenceDate, to)),
              );

        const items = expanded
          .map(
            (item): ExpandedOccurrence => ({
              occurrence: toOccurrenceDto(item.record, item, states.get(`${item.record.row.id}:${item.date}`)),
              entry: item.record,
            }),
          )
          .filter(({ occurrence }) => {
            if (query.memberId === undefined) return true;
            if (occurrence.memberIds.length === 0 && occurrence.assigneeId === null) return true;
            return occurrence.memberIds.includes(query.memberId) || occurrence.assigneeId === query.memberId;
          })
          .sort((a, b) => compareOccurrences(a.occurrence, b.occurrence));
        return { items, members: yield* members.list(householdId) };
      });

      const list = Effect.fn("CalendarOccurrences.list")(function* (householdId: string, query: CalendarOccurrenceQuery) {
        const { items, members: householdMembers } = yield* expand(householdId, query);
        return { items: items.map((item) => item.occurrence), members: householdMembers };
      });

      const setStatus = Effect.fn("CalendarOccurrences.setStatus")(function* (
        householdId: string,
        entryId: string,
        date: string,
        status: "done" | "skipped" | null,
        userId: string,
      ) {
        const record = yield* loadEntryOr404(database, householdId, entryId);
        if (!isCalendarDate(date)) return yield* new NotFound();
        const ordinal = occurrenceOrdinal(seriesOf(record.row), date);
        if (ordinal === null) return yield* new NotFound();
        if (status === "done" && record.row.kind !== "task") {
          return yield* new ApiFailure({ status: 409, code: "calendar_not_a_task", text: "server.calendar.notATask" });
        }
        const key = and(eq(calendarOccurrenceStates.entryId, entryId), eq(calendarOccurrenceStates.occurrenceDate, date));
        if (status === null) {
          yield* database.use((db) => db.delete(calendarOccurrenceStates).where(key));
          return toOccurrenceDto(record, { date, ordinal }, undefined);
        }
        const now = yield* Clock.currentTimeMillis;
        const state = { status, doneBy: status === "done" ? userId : null };
        yield* database.use((db) =>
          db
            .insert(calendarOccurrenceStates)
            .values({ entryId, occurrenceDate: date, ...state, updatedAt: now })
            .onConflictDoUpdate({
              target: [calendarOccurrenceStates.entryId, calendarOccurrenceStates.occurrenceDate],
              set: { ...state, updatedAt: now },
            }),
        );
        return toOccurrenceDto(record, { date, ordinal }, state);
      });

      return CalendarOccurrences.of({ list, expand, setStatus });
    }),
  );
}
