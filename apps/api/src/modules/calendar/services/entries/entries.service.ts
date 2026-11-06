/**
 * `CalendarEntries` (plan m8 P6-P9b, P11): the household's series.
 *
 * - `list(householdId, query)`: every non-waste series (P9b), optionally of one `kind`, optionally only recurring
 *   (`recurring=true`) or only single ones (`false`); waste entries are the import's (P8) and never listed.
 * - `get`: one series with its members (`404 not_found` for another household's id, D8).
 * - `create(householdId, userId, body)`: the body was decoded with `CreateCalendarEntryRequestSchema` (the P6 struct
 *   rules); the service adds the database's rules: every member id a member of THIS household (`422` at its path),
 *   a car of this household that is not archived (`404` / `422`), and for a car booking the P11 conflict check
 *   (`409 calendar_car_conflict` with the conflicts as `details`, unless `allowConflict`).
 * - `update(householdId, entryId, body)`: P7 merge-then-validate. The body (decoded with the partial update schema) is
 *   merged onto the stored entry and the RESULT decoded with the create schema, so every P6 rule applies to the merged
 *   entry; then the member, resource and conflict checks (the resource only when it changed, the conflicts only when
 *   the schedule or the car changed). When the schedule changed, occurrence states whose date is no longer an
 *   occurrence start are deleted in the same `Database.transaction`. An imported waste entry (P8) takes only `notes`,
 *   `assigneeMode` and `assigneeIds`; any other key is `409 calendar_entry_imported`.
 * - `remove`: `409 calendar_entry_imported` for a waste entry (the import is the unit), else the series with its
 *   members and states.
 *
 * Over `Database`, `CalendarMembers`, `CalendarResources` and `CalendarCarConflicts` (yielded at build, the area's
 * outer step); the Clock stamps `created_at` / `updated_at`.
 */
import {
  type CalendarEntry,
  type CalendarEntryListQuery,
  type CreateCalendarEntryRequest,
  CreateCalendarEntryRequestSchema,
  type UpdateCalendarEntryRequest,
  occurrenceOrdinal,
} from "@toon/shared";
import { type SQL, and, eq, isNull, ne } from "drizzle-orm";
import { Clock, Context, Effect, Layer, type Schema } from "effect";
import { Database } from "../../../../db/database.ts";
import { ApiFailure, type DatabaseError, type NotFound, type ValidationFailed } from "../../../../lib/errors.ts";
import { decode } from "../../../../lib/validate.ts";
import { type NewCalendarEntryMemberRow, calendarEntries, calendarEntryMembers, calendarOccurrenceStates } from "../../schema.ts";
import { CalendarMembers } from "../members.ts";
import { CalendarCarConflicts } from "./conflicts.service.ts";
import { CalendarResources } from "./resources.service.ts";
import { type EntryRecord, loadEntryOr404, loadEntryRecords, loadStates, seriesOf, toEntryDto, weekdaysToColumn } from "./rows.ts";

/** The keys a PATCH of an imported waste entry may carry (P8); `allowConflict` and `today` are context, not fields. */
const WASTE_PATCH_KEYS: ReadonlySet<string> = new Set(["notes", "assigneeMode", "assigneeIds", "allowConflict", "today"]);

/** The create-shaped fields the merge of P7 overlays (every create field but `kind` and the flag). */
const MERGE_KEYS = [
  "title",
  "allDay",
  "startDate",
  "startTime",
  "endDate",
  "endTime",
  "repeat",
  "location",
  "notes",
  "attendeeIds",
  "assigneeMode",
  "assigneeIds",
  "resourceId",
] as const;

/** A decoded create body, normalised to what is stored. */
interface NormalisedEntry {
  readonly kind: "event" | "task" | "car";
  readonly title: string;
  readonly allDay: boolean;
  readonly startDate: string;
  readonly startTime: string | null;
  readonly endDate: string;
  readonly endTime: string | null;
  readonly repeat: { freq: "none" | "daily" | "weekly" | "monthly" | "yearly"; interval: number; weekdays: Array<"MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU">; until: string | null };
  readonly location: string | null;
  readonly notes: string | null;
  readonly attendeeIds: ReadonlyArray<string>;
  readonly assigneeMode: "none" | "fixed" | "rotate";
  readonly assigneeIds: ReadonlyArray<string>;
  readonly resourceId: string | null;
  readonly allowConflict: boolean;
}

function emptyToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value;
}

function normalise(body: CreateCalendarEntryRequest): NormalisedEntry {
  const repeat = body.repeat ?? { freq: "none" as const, interval: 1, weekdays: [], until: null };
  return {
    kind: body.kind,
    title: body.title,
    allDay: body.allDay,
    startDate: body.startDate,
    startTime: body.allDay ? null : (body.startTime ?? null),
    endDate: body.endDate ?? body.startDate,
    endTime: body.allDay ? null : (body.endTime ?? null),
    repeat: {
      freq: repeat.freq,
      interval: repeat.freq === "none" ? 1 : repeat.interval,
      weekdays: repeat.freq === "weekly" ? [...repeat.weekdays] : [],
      until: repeat.freq === "none" ? null : repeat.until,
    },
    location: emptyToNull(body.location),
    notes: emptyToNull(body.notes),
    attendeeIds: body.attendeeIds ?? [],
    assigneeMode: body.kind === "task" ? (body.assigneeMode ?? "none") : "none",
    assigneeIds: body.assigneeIds ?? [],
    resourceId: body.resourceId ?? null,
    allowConflict: body.allowConflict ?? false,
  };
}

/** The stored series as a create body (the base of the P7 merge). */
function storedAsCreate(record: EntryRecord): Record<string, unknown> {
  const { row } = record;
  const series = seriesOf(row);
  return {
    kind: row.kind,
    // A waste entry has no title (its label is the catalog's): its category stands in so the create schema can check
    // the assignee rules; the stored title stays null (P8).
    title: row.title ?? row.category ?? "",
    allDay: row.allDay,
    startDate: row.startDate,
    startTime: row.startTime,
    endDate: row.endDate,
    endTime: row.endTime,
    repeat: { freq: series.repeat.freq, interval: series.repeat.interval, weekdays: [...series.repeat.weekdays], until: series.repeat.until },
    location: row.location,
    notes: row.notes,
    attendeeIds: [...record.attendeeIds],
    assigneeMode: row.assigneeMode,
    assigneeIds: [...record.assigneeIds],
    resourceId: row.resourceId,
  };
}

function memberRows(entryId: string, entry: Pick<NormalisedEntry, "attendeeIds" | "assigneeIds">): Array<NewCalendarEntryMemberRow> {
  return [
    ...entry.attendeeIds.map((userId, position) => ({ entryId, userId, role: "attendee", position })),
    ...entry.assigneeIds.map((userId, position) => ({ entryId, userId, role: "assignee", position })),
  ];
}

function scheduleOf(entry: {
  readonly allDay: boolean;
  readonly startDate: string;
  readonly startTime: string | null;
  readonly endDate: string;
  readonly endTime: string | null;
  readonly repeat: { readonly freq: string; readonly interval: number; readonly weekdays: ReadonlyArray<string>; readonly until: string | null };
}): string {
  return JSON.stringify([
    entry.allDay,
    entry.startDate,
    entry.startTime,
    entry.endDate,
    entry.endTime,
    entry.repeat.freq,
    entry.repeat.interval,
    weekdaysToColumn(entry.repeat.weekdays),
    entry.repeat.until,
  ]);
}

export type EntryWriteError = NotFound | ValidationFailed | ApiFailure | Schema.SchemaError | DatabaseError;

export class CalendarEntries extends Context.Service<
  CalendarEntries,
  {
    readonly list: (householdId: string, query: CalendarEntryListQuery) => Effect.Effect<Array<CalendarEntry>, DatabaseError>;
    readonly get: (householdId: string, entryId: string) => Effect.Effect<CalendarEntry, NotFound | DatabaseError>;
    readonly create: (
      householdId: string,
      userId: string,
      body: CreateCalendarEntryRequest,
    ) => Effect.Effect<CalendarEntry, EntryWriteError>;
    readonly update: (
      householdId: string,
      entryId: string,
      body: UpdateCalendarEntryRequest,
    ) => Effect.Effect<CalendarEntry, EntryWriteError>;
    readonly remove: (householdId: string, entryId: string) => Effect.Effect<void, NotFound | ApiFailure | DatabaseError>;
  }
>()("toon/api/modules/calendar/services/entries/entries.service/CalendarEntries") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const members = yield* CalendarMembers;
      const resources = yield* CalendarResources;
      const conflicts = yield* CalendarCarConflicts;

      /** The database's rules of P6 (members, the car) and P11 (conflicts) for a decoded entry. */
      const checkEntry = Effect.fnUntraced(function* (
        householdId: string,
        entry: NormalisedEntry,
        options: {
          readonly resourceChanged: boolean;
          readonly scheduleChanged: boolean;
          readonly excludeEntryId: string | null;
          /** The client's today: a recurring booking is checked from here on (P11). */
          readonly today: string | null;
        },
      ) {
        yield* members.assertMembers(householdId, entry.attendeeIds, "attendeeIds");
        yield* members.assertMembers(householdId, entry.assigneeIds, "assigneeIds");
        if (entry.kind !== "car" || entry.resourceId === null) return;
        if (options.resourceChanged) yield* resources.assertBookable(householdId, entry.resourceId);
        if (entry.allowConflict || !(options.resourceChanged || options.scheduleChanged)) return;
        const found = yield* conflicts.check(
          householdId,
          { ...entry, resourceId: entry.resourceId },
          options.excludeEntryId,
          options.today,
        );
        if (found.length > 0) {
          return yield* new ApiFailure({ status: 409, code: "calendar_car_conflict", text: "server.calendar.carConflict", details: found });
        }
      });

      const list = Effect.fn("CalendarEntries.list")(function* (householdId: string, query: CalendarEntryListQuery) {
        const filters: Array<SQL> = [isNull(calendarEntries.wasteImportId)];
        if (query.kind !== undefined) filters.push(eq(calendarEntries.kind, query.kind));
        if (query.recurring === "true") filters.push(ne(calendarEntries.repeatFreq, "none"));
        if (query.recurring === "false") filters.push(eq(calendarEntries.repeatFreq, "none"));
        const records = yield* loadEntryRecords(database, householdId, and(...filters));
        return records.map(toEntryDto);
      });

      const get = Effect.fn("CalendarEntries.get")(function* (householdId: string, entryId: string) {
        return toEntryDto(yield* loadEntryOr404(database, householdId, entryId));
      });

      const create = Effect.fn("CalendarEntries.create")(function* (
        householdId: string,
        userId: string,
        body: CreateCalendarEntryRequest,
      ) {
        const entry = normalise(body);
        yield* checkEntry(householdId, entry, {
          resourceChanged: true,
          scheduleChanged: true,
          excludeEntryId: null,
          today: body.today ?? null,
        });
        const now = yield* Clock.currentTimeMillis;
        const id = crypto.randomUUID();
        yield* database.transaction(
          Effect.gen(function* () {
            yield* database.use((db) =>
              db.insert(calendarEntries).values({
                id,
                householdId,
                kind: entry.kind,
                title: entry.title,
                notes: entry.notes,
                location: entry.location,
                allDay: entry.allDay,
                startDate: entry.startDate,
                startTime: entry.startTime,
                endDate: entry.endDate,
                endTime: entry.endTime,
                repeatFreq: entry.repeat.freq,
                repeatInterval: entry.repeat.interval,
                repeatWeekdays: weekdaysToColumn(entry.repeat.weekdays),
                repeatUntil: entry.repeat.until,
                resourceId: entry.kind === "car" ? entry.resourceId : null,
                assigneeMode: entry.assigneeMode,
                category: null,
                categoryDetail: null,
                wasteImportId: null,
                createdBy: userId,
                createdAt: now,
                updatedAt: now,
              }),
            );
            const rows = memberRows(id, entry);
            if (rows.length > 0) yield* database.use((db) => db.insert(calendarEntryMembers).values(rows));
          }),
        );
        return toEntryDto(yield* loadEntryOr404(database, householdId, id));
      });

      const update = Effect.fn("CalendarEntries.update")(function* (
        householdId: string,
        entryId: string,
        body: UpdateCalendarEntryRequest,
      ) {
        const record = yield* loadEntryOr404(database, householdId, entryId);
        const { row } = record;
        const patch: Record<string, unknown> = body;
        const isWaste = row.wasteImportId !== null;
        if (isWaste && Object.keys(patch).some((key) => patch[key] !== undefined && !WASTE_PATCH_KEYS.has(key))) {
          return yield* new ApiFailure({ status: 409, code: "calendar_entry_imported", text: "server.calendar.entryImported" });
        }

        const merged = storedAsCreate(record);
        for (const key of MERGE_KEYS) {
          if (patch[key] !== undefined) merged[key] = patch[key];
        }
        const decoded = yield* decode(CreateCalendarEntryRequestSchema, merged);
        const entry = normalise({ ...decoded, allowConflict: body.allowConflict ?? false });
        const scheduleChanged =
          scheduleOf(entry) !==
          scheduleOf({
            allDay: row.allDay,
            startDate: row.startDate,
            startTime: row.startTime,
            endDate: row.endDate,
            endTime: row.endTime,
            repeat: seriesOf(row).repeat,
          });
        const resourceChanged = entry.resourceId !== row.resourceId;
        yield* checkEntry(householdId, entry, { resourceChanged, scheduleChanged, excludeEntryId: entryId, today: body.today ?? null });

        const now = yield* Clock.currentTimeMillis;
        yield* database.transaction(
          Effect.gen(function* () {
            yield* database.use((db) =>
              db
                .update(calendarEntries)
                .set(
                  isWaste
                    ? { notes: entry.notes, assigneeMode: entry.assigneeMode, updatedAt: now }
                    : {
                        title: entry.title,
                        notes: entry.notes,
                        location: entry.location,
                        allDay: entry.allDay,
                        startDate: entry.startDate,
                        startTime: entry.startTime,
                        endDate: entry.endDate,
                        endTime: entry.endTime,
                        repeatFreq: entry.repeat.freq,
                        repeatInterval: entry.repeat.interval,
                        repeatWeekdays: weekdaysToColumn(entry.repeat.weekdays),
                        repeatUntil: entry.repeat.until,
                        resourceId: entry.kind === "car" ? entry.resourceId : null,
                        assigneeMode: entry.assigneeMode,
                        updatedAt: now,
                      },
                )
                .where(and(eq(calendarEntries.id, entryId), eq(calendarEntries.householdId, householdId))),
            );
            yield* database.use((db) => db.delete(calendarEntryMembers).where(eq(calendarEntryMembers.entryId, entryId)));
            const rows = memberRows(entryId, isWaste ? { attendeeIds: [], assigneeIds: entry.assigneeIds } : entry);
            if (rows.length > 0) yield* database.use((db) => db.insert(calendarEntryMembers).values(rows));
            if (scheduleChanged) {
              const series = { startDate: entry.startDate, endDate: entry.endDate, repeat: entry.repeat };
              const states = yield* loadStates(database, [entryId]);
              for (const state of states.values()) {
                if (occurrenceOrdinal(series, state.occurrenceDate) === null) {
                  yield* database.use((db) =>
                    db
                      .delete(calendarOccurrenceStates)
                      .where(
                        and(
                          eq(calendarOccurrenceStates.entryId, entryId),
                          eq(calendarOccurrenceStates.occurrenceDate, state.occurrenceDate),
                        ),
                      ),
                  );
                }
              }
            }
          }),
        );
        return toEntryDto(yield* loadEntryOr404(database, householdId, entryId));
      });

      const remove = Effect.fn("CalendarEntries.remove")(function* (householdId: string, entryId: string) {
        const record = yield* loadEntryOr404(database, householdId, entryId);
        if (record.row.wasteImportId !== null) {
          return yield* new ApiFailure({ status: 409, code: "calendar_entry_imported", text: "server.calendar.entryImported" });
        }
        yield* database.use((db) =>
          db.delete(calendarEntries).where(and(eq(calendarEntries.id, entryId), eq(calendarEntries.householdId, householdId))),
        );
      });

      return CalendarEntries.of({ list, get, create, update, remove });
    }),
  );
}
