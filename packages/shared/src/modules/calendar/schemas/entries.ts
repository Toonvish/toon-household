/**
 * Entries (series) — wire contract (plan m8 P5, P6, P7, P9b, P11; design §1.2, §2).
 *
 * `CreateCalendarEntryRequestSchema` carries the P6 rules as ONE struct check that reports every broken rule at
 * its path with a `server.calendar.*` key; like every struct check it runs only when every field decoded
 * (ADR 0013, plan e1 P7). The member and resource checks need the database and are the service's.
 * `UpdateCalendarEntryRequestSchema` is the create fields minus `kind`, all optional: the service merges the
 * body onto the stored entry and decodes the RESULT with the create schema (P7).
 */
import { Effect, Schema, type Types } from "effect";
import type { ServerKey } from "../../../core/i18n/catalogs/index.ts";
import { IdSchema, IsoDateSchema } from "../../../core/schemas/common.ts";
import {
  Bool,
  Enum,
  Int,
  Str,
  keyedIssue,
  max,
  maxItems,
  maxLength,
  min,
  minLength,
  partial,
  trim,
} from "../../../core/schemas/checks.ts";
import { CALENDAR_LIMITS } from "../limits.ts";
import {
  CalendarAssigneeModeSchema,
  CalendarDateSchema,
  CalendarEntryKindSchema,
  CalendarRepeatFreqSchema,
  CalendarTimeSchema,
  CalendarWasteCategorySchema,
  CalendarWasteDetailSchema,
  CalendarWeekdaySchema,
} from "./common.ts";

/**
 * A rhythm. On a request `interval` defaults to 1, `weekdays` to `[]` (weekly: the start date's weekday) and
 * `until` to `null` (open-ended); a response always carries all four.
 */
export const CalendarRepeatSchema = Schema.Struct({
  freq: CalendarRepeatFreqSchema,
  interval: Int.check(min(1), max(CALENDAR_LIMITS.intervalMax)).pipe(Schema.withDecodingDefault(Effect.succeed(1))),
  weekdays: Schema.Array(CalendarWeekdaySchema)
    .check(maxItems(7))
    .pipe(Schema.withDecodingDefaultType(Effect.sync((): ReadonlyArray<"MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU"> => []))),
  until: Schema.NullOr(CalendarDateSchema).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type CalendarRepeat = Types.DeepMutable<typeof CalendarRepeatSchema.Type>;

const TitleSchema = Str.pipe(trim).check(minLength(1), maxLength(CALENDAR_LIMITS.titleMax));
const LocationSchema = Str.pipe(trim).check(maxLength(CALENDAR_LIMITS.locationMax));
const NotesSchema = Str.pipe(trim).check(maxLength(CALENDAR_LIMITS.notesMax));

/** The create fields; `kind` is fixed after creation, so the update schema is these minus `kind`. */
const entryFields = {
  title: TitleSchema,
  allDay: Bool,
  startDate: CalendarDateSchema,
  /** Required when `allDay` is false, absent or null when true. */
  startTime: Schema.optional(Schema.NullOr(CalendarTimeSchema)),
  /** Absent or null: the start date (a single-day entry). */
  endDate: Schema.optional(Schema.NullOr(CalendarDateSchema)),
  /** Absent or null: no end time (events and tasks); a timed car booking needs one. */
  endTime: Schema.optional(Schema.NullOr(CalendarTimeSchema)),
  /** Absent: `{ freq: "none" }`. */
  repeat: Schema.optional(CalendarRepeatSchema),
  location: Schema.optional(Schema.NullOr(LocationSchema)),
  notes: Schema.optional(Schema.NullOr(NotesSchema)),
  /** Event: 0-20 members (none = everybody); car: exactly the one member who needs it; task: none. */
  attendeeIds: Schema.optional(Schema.Array(IdSchema).check(maxItems(CALENDAR_LIMITS.attendeesMax))),
  /** Tasks only; absent is `none`. */
  assigneeMode: Schema.optional(CalendarAssigneeModeSchema),
  /** `fixed`: exactly 1; `rotate`: 2-12 in rotation order; `none`: empty. */
  assigneeIds: Schema.optional(Schema.Array(IdSchema).check(maxItems(CALENDAR_LIMITS.rotationMax))),
  /** Car bookings only: a car of this household that is not archived. */
  resourceId: Schema.optional(Schema.NullOr(IdSchema)),
  /** Car bookings: save even when the car is taken (the conflict notice offers this). */
  allowConflict: Schema.optional(Bool),
  /**
   * The client's today (the server never decides it): a recurring car booking is checked for conflicts from the later
   * of its start and this day (P11). Absent: from its start. Context, never stored.
   */
  today: Schema.optional(CalendarDateSchema),
};

type CreateFields = {
  readonly kind: "event" | "task" | "car";
  readonly allDay: boolean;
  readonly startDate: string;
  readonly startTime?: string | null | undefined;
  readonly endDate?: string | null | undefined;
  readonly endTime?: string | null | undefined;
  readonly repeat?: { readonly freq: string; readonly weekdays: ReadonlyArray<string>; readonly until: string | null } | undefined;
  readonly attendeeIds?: ReadonlyArray<string> | undefined;
  readonly assigneeMode?: "none" | "fixed" | "rotate" | undefined;
  readonly assigneeIds?: ReadonlyArray<string> | undefined;
  readonly resourceId?: string | null | undefined;
};

function hasDuplicates(ids: ReadonlyArray<string>): boolean {
  return new Set(ids).size !== ids.length;
}

/** The P6 table as a list of issues (empty when the entry is consistent). */
function calendarEntryIssues(entry: CreateFields): Array<Schema.FilterIssue> {
  const issues: Array<Schema.FilterIssue> = [];
  const add = (key: ServerKey, path: ReadonlyArray<string | number>) => issues.push(keyedIssue(key, path));
  const startTime = entry.startTime ?? null;
  const endTime = entry.endTime ?? null;
  const endDate = entry.endDate ?? entry.startDate;
  const attendees = entry.attendeeIds ?? [];
  const assignees = entry.assigneeIds ?? [];
  const mode = entry.assigneeMode ?? "none";
  const resourceId = entry.resourceId ?? null;

  // Time.
  if (entry.allDay) {
    if (startTime !== null) add("server.calendar.allDayNoTime", ["startTime"]);
    if (endTime !== null) add("server.calendar.allDayNoTime", ["endTime"]);
  } else {
    if (startTime === null) add("server.calendar.timeRequired", ["startTime"]);
    if (entry.kind === "car" && endTime === null) add("server.calendar.timeRequired", ["endTime"]);
  }
  if (endDate < entry.startDate) add("server.calendar.endBeforeStart", ["endDate"]);
  else if (!entry.allDay && startTime !== null && endTime !== null && endDate === entry.startDate && endTime <= startTime) {
    add("server.calendar.endBeforeStart", ["endTime"]);
  }
  if (entry.kind === "task" && endDate !== entry.startDate) add("server.calendar.taskSingleDay", ["endDate"]);

  // Rhythm.
  const repeat = entry.repeat;
  if (repeat !== undefined) {
    if (repeat.until !== null && repeat.until < entry.startDate) add("server.calendar.untilBeforeStart", ["repeat", "until"]);
    if (repeat.freq !== "weekly" && repeat.weekdays.length > 0) add("server.calendar.weekdaysOnlyWeekly", ["repeat", "weekdays"]);
  }

  // Who.
  if (hasDuplicates(attendees)) add("server.calendar.duplicateIds", ["attendeeIds"]);
  if (hasDuplicates(assignees)) add("server.calendar.duplicateIds", ["assigneeIds"]);
  if (entry.kind === "task") {
    if (attendees.length > 0) add("server.calendar.attendeesNotOnTasks", ["attendeeIds"]);
    if (mode === "none" && assignees.length > 0) add("server.calendar.assigneesForNone", ["assigneeIds"]);
    if (mode === "fixed" && assignees.length !== 1) add("server.calendar.fixedNeedsOne", ["assigneeIds"]);
    if (mode === "rotate" && assignees.length < 2) add("server.calendar.rotateNeedsTwo", ["assigneeIds"]);
  } else {
    if (mode !== "none") add("server.calendar.assigneesOnlyTasks", ["assigneeMode"]);
    if (assignees.length > 0) add("server.calendar.assigneesOnlyTasks", ["assigneeIds"]);
  }
  if (entry.kind === "car" && attendees.length !== 1) add("server.calendar.carNeedsOnePerson", ["attendeeIds"]);

  // Resource.
  if (entry.kind === "car") {
    if (resourceId === null) add("server.calendar.carNeedsResource", ["resourceId"]);
  } else if (resourceId !== null) {
    add("server.calendar.resourceOnlyCars", ["resourceId"]);
  }
  return issues;
}

/** POST `/entries` (P6). */
export const CreateCalendarEntryRequestSchema = Schema.Struct({ kind: CalendarEntryKindSchema, ...entryFields }).check(
  Schema.makeFilter((entry: CreateFields) => {
    const issues = calendarEntryIssues(entry);
    return issues.length === 0 ? undefined : issues;
  }, { expected: "a consistent calendar entry" }),
);
export type CreateCalendarEntryRequest = Types.DeepMutable<typeof CreateCalendarEntryRequestSchema.Type>;

/** PATCH `/entries/:entryId` (P7): every create field but `kind`, all optional; checked after the merge. */
export const UpdateCalendarEntryRequestSchema = partial(Schema.Struct(entryFields));
export type UpdateCalendarEntryRequest = Types.DeepMutable<typeof UpdateCalendarEntryRequestSchema.Type>;

/** A series as stored, with its members and resource (design §2; P5: nullable fields are `null`, never absent). */
export const CalendarEntrySchema = Schema.Struct({
  id: IdSchema,
  householdId: IdSchema,
  kind: CalendarEntryKindSchema,
  /** Null only on a waste entry: its label comes from the catalog by `category` (design §5.6). */
  title: Schema.NullOr(Str),
  notes: Schema.NullOr(Str),
  location: Schema.NullOr(Str),
  allDay: Bool,
  startDate: CalendarDateSchema,
  startTime: Schema.NullOr(CalendarTimeSchema),
  endDate: CalendarDateSchema,
  endTime: Schema.NullOr(CalendarTimeSchema),
  repeat: CalendarRepeatSchema,
  attendeeIds: Schema.Array(IdSchema),
  assigneeMode: CalendarAssigneeModeSchema,
  /** In rotation order. */
  assigneeIds: Schema.Array(IdSchema),
  resourceId: Schema.NullOr(IdSchema),
  category: Schema.NullOr(CalendarWasteCategorySchema),
  categoryDetail: Schema.NullOr(CalendarWasteDetailSchema),
  wasteImportId: Schema.NullOr(IdSchema),
  createdBy: Schema.NullOr(IdSchema),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type CalendarEntry = Types.DeepMutable<typeof CalendarEntrySchema.Type>;

/** GET `/entries` (P9b): the household's non-waste series, optionally of one kind, optionally only recurring ones. */
export const CalendarEntryListQuerySchema = Schema.Struct({
  kind: Schema.optional(CalendarEntryKindSchema),
  recurring: Schema.optional(Enum(["true", "false"])),
});
export type CalendarEntryListQuery = Types.DeepMutable<typeof CalendarEntryListQuerySchema.Type>;

export const CalendarEntryListResponseSchema = Schema.Struct({ items: Schema.Array(CalendarEntrySchema) });
export type CalendarEntryListResponse = Types.DeepMutable<typeof CalendarEntryListResponseSchema.Type>;

/** One item of a `409 calendar_car_conflict`'s `details` (P11): who has the car when. */
export const CalendarCarConflictSchema = Schema.Struct({
  entryId: IdSchema,
  date: CalendarDateSchema,
  startTime: Schema.NullOr(CalendarTimeSchema),
  endTime: Schema.NullOr(CalendarTimeSchema),
  title: Schema.NullOr(Str),
  memberIds: Schema.Array(IdSchema),
});
export type CalendarCarConflict = Types.DeepMutable<typeof CalendarCarConflictSchema.Type>;
