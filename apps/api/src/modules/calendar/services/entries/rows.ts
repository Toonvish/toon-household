/**
 * The entries area's shared row handling (plan m8 M8-T05, P5, P9b, P10): the entry loader (a series with its attendees
 * and assignees in order), the row -> DTO mappers, the series view the shared recurrence reads, and the occurrence
 * builder `CalendarOccurrences` and `CalendarEntries` share.
 *
 * Plain functions over the `Database` service handed in by the caller (the service yields it inside its method, so the
 * CURRENT executor, an open transaction included, is the one these statements use). No `Date`: timestamps are the
 * stored unix milliseconds rendered with `toIso`.
 */
import {
  type CalendarEntry,
  type CalendarOccurrence,
  type CalendarSeries,
  type CalendarWeekday,
  CALENDAR_WEEKDAYS,
  DEFAULT_LOCALE,
  type ServerKey,
  WASTE_CATEGORIES,
  addCalendarDays,
  calendarDaysBetween,
  compareDateTime,
  serverText,
} from "@toon/shared";
import { type SQL, and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import type { Database } from "../../../../db/database.ts";
import { ApiFailure, type DatabaseError, NotFound } from "../../../../lib/errors.ts";
import { toIso } from "../../../../lib/http.ts";
import {
  type CalendarEntryRow,
  type CalendarOccurrenceStateRow,
  calendarEntries,
  calendarEntryMembers,
  calendarOccurrenceStates,
} from "../../schema.ts";

type DatabaseService = Database["Service"];

/** A series as stored, with its attendees and its assignees (rotation order). */
export interface EntryRecord {
  readonly row: CalendarEntryRow;
  readonly attendeeIds: ReadonlyArray<string>;
  readonly assigneeIds: ReadonlyArray<string>;
}

type Freq = CalendarSeries["repeat"]["freq"];
type Mode = CalendarEntry["assigneeMode"];

const FREQS: ReadonlyArray<Freq> = ["none", "daily", "weekly", "monthly", "yearly"];
const MODES: ReadonlyArray<Mode> = ["none", "fixed", "rotate"];

function freqOf(value: string): Freq {
  return FREQS.find((freq) => freq === value) ?? "none";
}

function modeOf(value: string): Mode {
  return MODES.find((mode) => mode === value) ?? "none";
}

/** `MO,TH` -> `["MO", "TH"]` (unknown codes dropped, ISO order kept as stored). */
export function weekdaysOf(stored: string | null): Array<CalendarWeekday> {
  if (stored === null || stored === "") return [];
  return stored
    .split(",")
    .flatMap((code) => CALENDAR_WEEKDAYS.filter((weekday) => weekday === code));
}

/** `["TH", "MO"]` -> `MO,TH` (ISO order), or null for none. */
export function weekdaysToColumn(weekdays: ReadonlyArray<string>): string | null {
  const sorted = CALENDAR_WEEKDAYS.filter((weekday) => weekdays.includes(weekday));
  return sorted.length === 0 ? null : sorted.join(",");
}

/** The view of a row the shared recurrence reads. */
export function seriesOf(row: Pick<CalendarEntryRow, "startDate" | "endDate" | "repeatFreq" | "repeatInterval" | "repeatWeekdays" | "repeatUntil">): CalendarSeries {
  return {
    startDate: row.startDate,
    endDate: row.endDate,
    repeat: {
      freq: freqOf(row.repeatFreq),
      interval: row.repeatInterval,
      weekdays: weekdaysOf(row.repeatWeekdays),
      until: row.repeatUntil,
    },
  };
}

/** The wire form of a series (P5: nullable fields are `null`). */
export function toEntryDto(record: EntryRecord): CalendarEntry {
  const { row } = record;
  const series = seriesOf(row);
  return {
    id: row.id,
    householdId: row.householdId,
    kind: row.kind === "task" || row.kind === "car" ? row.kind : "event",
    title: row.title,
    notes: row.notes,
    location: row.location,
    allDay: row.allDay,
    startDate: row.startDate,
    startTime: row.startTime,
    endDate: row.endDate,
    endTime: row.endTime,
    repeat: {
      freq: series.repeat.freq,
      interval: series.repeat.interval,
      weekdays: [...series.repeat.weekdays],
      until: series.repeat.until,
    },
    attendeeIds: [...record.attendeeIds],
    assigneeMode: modeOf(row.assigneeMode),
    assigneeIds: [...record.assigneeIds],
    resourceId: row.resourceId,
    category: WASTE_CATEGORIES.find((category) => category === row.category) ?? null,
    categoryDetail: row.categoryDetail === "bio_cleaning" ? "bio_cleaning" : null,
    wasteImportId: row.wasteImportId,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** A task's assignee for the occurrence at `ordinal`: the fixed one, the rotation's pick, or nobody. */
export function assigneeFor(record: EntryRecord, ordinal: number): string | null {
  const ids = record.assigneeIds;
  if (ids.length === 0) return null;
  const mode = modeOf(record.row.assigneeMode);
  if (mode === "fixed") return ids[0] ?? null;
  if (mode === "rotate") return ids[ordinal % ids.length] ?? null;
  return null;
}

/** One occurrence of `record` on `date` (its start), with its state row if one exists. */
export function toOccurrenceDto(
  record: EntryRecord,
  occurrence: { readonly date: string; readonly ordinal: number },
  state: Pick<CalendarOccurrenceStateRow, "status" | "doneBy"> | undefined,
): CalendarOccurrence {
  const { row } = record;
  const duration = Math.max(0, calendarDaysBetween(row.startDate, row.endDate));
  const status = state?.status === "done" || state?.status === "skipped" ? state.status : "open";
  return {
    id: `${row.id}:${occurrence.date}`,
    entryId: row.id,
    kind: row.kind === "task" || row.kind === "car" ? row.kind : "event",
    title: row.title,
    category: WASTE_CATEGORIES.find((category) => category === row.category) ?? null,
    categoryDetail: row.categoryDetail === "bio_cleaning" ? "bio_cleaning" : null,
    date: occurrence.date,
    endDate: addCalendarDays(occurrence.date, duration),
    allDay: row.allDay,
    startTime: row.startTime,
    endTime: row.endTime,
    location: row.location,
    recurring: row.repeatFreq !== "none",
    memberIds: [...record.attendeeIds],
    assigneeId: assigneeFor(record, occurrence.ordinal),
    resourceId: row.resourceId,
    status,
    doneBy: status === "done" ? (state?.doneBy ?? null) : null,
  };
}

/** The P10 order: date, all-day first, time, waste before the rest, category order or title, entry id. */
export function compareOccurrences(a: CalendarOccurrence, b: CalendarOccurrence): number {
  const byMoment = compareDateTime(a.date, a.allDay ? null : a.startTime, b.date, b.allDay ? null : b.startTime);
  if (byMoment !== 0) return byMoment;
  const aWaste = a.category !== null;
  const bWaste = b.category !== null;
  if (aWaste !== bWaste) return aWaste ? -1 : 1;
  if (aWaste && bWaste) {
    const byCategory = WASTE_CATEGORIES.indexOf(a.category!) - WASTE_CATEGORIES.indexOf(b.category!);
    if (byCategory !== 0) return byCategory;
  } else {
    const aTitle = a.title ?? "";
    const bTitle = b.title ?? "";
    if (aTitle !== bTitle) return aTitle < bTitle ? -1 : 1;
  }
  return a.entryId === b.entryId ? 0 : a.entryId < b.entryId ? -1 : 1;
}

/** The `422 calendar_range_too_large` of P4, its one detail at `to`. */
export function rangeTooLarge(key: ServerKey): ApiFailure {
  return new ApiFailure({
    status: 422,
    code: "calendar_range_too_large",
    text: key,
    details: [{ path: "to", code: "custom", message: serverText(DEFAULT_LOCALE, key), i18n: { key } }],
  });
}

/**
 * The household's series matching `where` (ANDed with the household filter), with their members, in a stable order
 * (start date, start time, id).
 */
export const loadEntryRecords = Effect.fnUntraced(function* (
  database: DatabaseService,
  householdId: string,
  where?: SQL,
): Effect.fn.Return<Array<EntryRecord>, DatabaseError> {
  const filter = where === undefined ? eq(calendarEntries.householdId, householdId) : and(eq(calendarEntries.householdId, householdId), where);
  const rows = yield* database.use((db) =>
    db
      .select()
      .from(calendarEntries)
      .where(filter)
      .orderBy(asc(calendarEntries.startDate), asc(calendarEntries.startTime), asc(calendarEntries.id)),
  );
  return yield* withMembers(database, rows);
});

/** Attaches the attendees and assignees (by `position`) to each row. */
export const withMembers = Effect.fnUntraced(function* (
  database: DatabaseService,
  rows: ReadonlyArray<CalendarEntryRow>,
): Effect.fn.Return<Array<EntryRecord>, DatabaseError> {
  if (rows.length === 0) return [];
  const members = new Map<string, Array<{ userId: string; role: string; position: number }>>();
  const ids = rows.map((row) => row.id);
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500);
    const found = yield* database.use((db) =>
      db
        .select({
          entryId: calendarEntryMembers.entryId,
          userId: calendarEntryMembers.userId,
          role: calendarEntryMembers.role,
          position: calendarEntryMembers.position,
        })
        .from(calendarEntryMembers)
        .where(inArray(calendarEntryMembers.entryId, chunk)),
    );
    for (const member of found) {
      const list = members.get(member.entryId) ?? [];
      list.push(member);
      members.set(member.entryId, list);
    }
  }
  return rows.map((row): EntryRecord => {
    const list = (members.get(row.id) ?? []).sort((a, b) => a.position - b.position || (a.userId < b.userId ? -1 : 1));
    return {
      row,
      attendeeIds: list.filter((member) => member.role === "attendee").map((member) => member.userId),
      assigneeIds: list.filter((member) => member.role === "assignee").map((member) => member.userId),
    };
  });
});

/** One series of the household, or `404 not_found` (D8: another household's id is not found). */
export const loadEntryOr404 = Effect.fnUntraced(function* (
  database: DatabaseService,
  householdId: string,
  entryId: string,
): Effect.fn.Return<EntryRecord, NotFound | DatabaseError> {
  const rows = yield* database.use((db) =>
    db
      .select()
      .from(calendarEntries)
      .where(and(eq(calendarEntries.id, entryId), eq(calendarEntries.householdId, householdId)))
      .limit(1),
  );
  const row = rows[0];
  if (row === undefined) return yield* new NotFound();
  const [record] = yield* withMembers(database, [row]);
  return record!;
});

/** The state rows of the given entries (any date), keyed `<entryId>:<date>`. */
export const loadStates = Effect.fnUntraced(function* (
  database: DatabaseService,
  entryIds: ReadonlyArray<string>,
  where?: SQL,
): Effect.fn.Return<Map<string, CalendarOccurrenceStateRow>, DatabaseError> {
  const states = new Map<string, CalendarOccurrenceStateRow>();
  for (let index = 0; index < entryIds.length; index += 500) {
    const chunk = entryIds.slice(index, index + 500);
    const filter = where === undefined
      ? inArray(calendarOccurrenceStates.entryId, chunk)
      : and(inArray(calendarOccurrenceStates.entryId, chunk), where);
    const rows = yield* database.use((db) => db.select().from(calendarOccurrenceStates).where(filter));
    for (const row of rows) states.set(`${row.entryId}:${row.occurrenceDate}`, row);
  }
  return states;
});
