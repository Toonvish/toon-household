/**
 * Occurrences — wire contract (design §2, plan m8 P4, P9a, P10, P12). An occurrence is one expansion of a
 * series; its id is `<entryId>:<date>` (the occurrence's start date). The query checks only formats and the order
 * of `from` and `to`; the 400-day cap is the service's (`422 calendar_range_too_large`, P4).
 */
import { Schema, type Types } from "effect";
import { IdSchema } from "../../../core/schemas/common.ts";
import { Bool, Enum, Str, keyed } from "../../../core/schemas/checks.ts";
import {
  CalendarDateSchema,
  CalendarEntryKindSchema,
  CalendarMemberSchema,
  CalendarOccurrenceStatusSchema,
  CalendarTimeSchema,
  CalendarWasteCategorySchema,
  CalendarWasteDetailSchema,
} from "./common.ts";

/** GET `/occurrences?from=&to=[&memberId=][&kind=]`: both dates inclusive, `to >= from`. */
export const CalendarOccurrenceQuerySchema = Schema.Struct({
  from: CalendarDateSchema,
  to: CalendarDateSchema,
  memberId: Schema.optional(IdSchema),
  kind: Schema.optional(CalendarEntryKindSchema),
}).check(keyed((query: { readonly from: string; readonly to: string }) => query.to >= query.from, "server.calendar.rangeOrder", { path: ["to"] }));
export type CalendarOccurrenceQuery = Types.DeepMutable<typeof CalendarOccurrenceQuerySchema.Type>;

export const CalendarOccurrenceSchema = Schema.Struct({
  /** `<entryId>:<date>`. */
  id: Str,
  entryId: IdSchema,
  kind: CalendarEntryKindSchema,
  title: Schema.NullOr(Str),
  category: Schema.NullOr(CalendarWasteCategorySchema),
  categoryDetail: Schema.NullOr(CalendarWasteDetailSchema),
  date: CalendarDateSchema,
  endDate: CalendarDateSchema,
  allDay: Bool,
  startTime: Schema.NullOr(CalendarTimeSchema),
  endTime: Schema.NullOr(CalendarTimeSchema),
  location: Schema.NullOr(Str),
  /** The series repeats (`repeat.freq !== "none"`). */
  recurring: Bool,
  /** The attendees (events: none = everybody; car bookings: who needs the car). */
  memberIds: Schema.Array(IdSchema),
  /** A task's assignee for this occurrence: the fixed one, or the rotation's pick for its ordinal. */
  assigneeId: Schema.NullOr(IdSchema),
  resourceId: Schema.NullOr(IdSchema),
  status: CalendarOccurrenceStatusSchema,
  doneBy: Schema.NullOr(IdSchema),
});
export type CalendarOccurrence = Types.DeepMutable<typeof CalendarOccurrenceSchema.Type>;

/** The occurrences in P10 order plus the household's members (P9a), so a persisted list renders names offline. */
export const CalendarOccurrenceListResponseSchema = Schema.Struct({
  items: Schema.Array(CalendarOccurrenceSchema),
  members: Schema.Array(CalendarMemberSchema),
});
export type CalendarOccurrenceListResponse = Types.DeepMutable<typeof CalendarOccurrenceListResponseSchema.Type>;

/** PUT `/entries/:entryId/occurrences/:date` (P12): `done` (tasks only), `skipped`, or `null` to reset. */
export const SetCalendarOccurrenceStatusRequestSchema = Schema.Struct({
  status: Schema.NullOr(Enum(["done", "skipped"])),
});
export type SetCalendarOccurrenceStatusRequest = Types.DeepMutable<typeof SetCalendarOccurrenceStatusRequestSchema.Type>;
