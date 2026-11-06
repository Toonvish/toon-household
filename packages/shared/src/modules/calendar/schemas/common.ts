/**
 * The calendar module's wire vocabulary (plan m8 section 5.1): dates, times, the enums and the member DTO. Built
 * from the core vocabulary (`packages/shared/src/core/schemas/checks.ts`, ADR 0013); a refusal carries a
 * `server.calendar.*` key.
 */
import { Schema, type Types } from "effect";
import { IdSchema } from "../../../core/schemas/common.ts";
import { Bool, Enum, Int, Str, keyed, max, min } from "../../../core/schemas/checks.ts";
import { CALENDAR_DATE_MAX, CALENDAR_DATE_MIN, isCalendarDate, isCalendarTime } from "../dates.ts";
import { CALENDAR_PERSON_COLORS, CALENDAR_WEEKDAYS } from "../limits.ts";
import { WASTE_CATEGORIES, WASTE_DETAILS, WASTE_PROVIDER_IDS } from "../waste.ts";

function isAcceptedDate(value: string): boolean {
  return isCalendarDate(value) && value >= CALENDAR_DATE_MIN && value <= CALENDAR_DATE_MAX;
}

/** A real wall-clock date `YYYY-MM-DD` between 1900-01-01 and 2199-12-31 (`2027-02-29` is refused). */
export const CalendarDateSchema = Str.check(keyed(isAcceptedDate, "server.calendar.invalidDate"));
export type CalendarDate = Types.DeepMutable<typeof CalendarDateSchema.Type>;

/** A wall-clock time `HH:MM`, 00:00 … 23:59. */
export const CalendarTimeSchema = Str.check(keyed(isCalendarTime, "server.calendar.invalidTime"));
export type CalendarTime = Types.DeepMutable<typeof CalendarTimeSchema.Type>;

/** Termin, Aufgabe, Autobuchung. */
export const CalendarEntryKindSchema = Enum(["event", "task", "car"]);
export type CalendarEntryKind = Types.DeepMutable<typeof CalendarEntryKindSchema.Type>;

export const CalendarRepeatFreqSchema = Enum(["none", "daily", "weekly", "monthly", "yearly"]);
export type CalendarRepeatFreq = Types.DeepMutable<typeof CalendarRepeatFreqSchema.Type>;

/** `MO` … `SU` (ISO order). */
export const CalendarWeekdaySchema = Enum(CALENDAR_WEEKDAYS);
export type CalendarWeekday = Types.DeepMutable<typeof CalendarWeekdaySchema.Type>;

/** A task's assignee rule: nobody, one fixed member, or a rotation over an ordered list. */
export const CalendarAssigneeModeSchema = Enum(["none", "fixed", "rotate"]);
export type CalendarAssigneeMode = Types.DeepMutable<typeof CalendarAssigneeModeSchema.Type>;

/** An occurrence's state: `open` has no row; `done` (tasks only) and `skipped` are stored. */
export const CalendarOccurrenceStatusSchema = Enum(["open", "done", "skipped"]);
export type CalendarOccurrenceStatus = Types.DeepMutable<typeof CalendarOccurrenceStatusSchema.Type>;

export const CalendarWasteCategorySchema = Enum(WASTE_CATEGORIES);
export type CalendarWasteCategory = Types.DeepMutable<typeof CalendarWasteCategorySchema.Type>;

export const CalendarWasteDetailSchema = Enum(WASTE_DETAILS);
export type CalendarWasteDetail = Types.DeepMutable<typeof CalendarWasteDetailSchema.Type>;

export const CalendarWasteProviderSchema = Enum(WASTE_PROVIDER_IDS);
export type CalendarWasteProvider = Types.DeepMutable<typeof CalendarWasteProviderSchema.Type>;

/**
 * A household member as the calendar shows them (plan m8 P9a): sorted by join time, `colorIndex` 1-6 from
 * `calendarPersonColors`, `hasAccount` false for a placeholder (ADR 0006).
 */
export const CalendarMemberSchema = Schema.Struct({
  userId: IdSchema,
  name: Str,
  colorIndex: Int.check(min(1), max(CALENDAR_PERSON_COLORS)),
  hasAccount: Bool,
});
export type CalendarMember = Types.DeepMutable<typeof CalendarMemberSchema.Type>;
