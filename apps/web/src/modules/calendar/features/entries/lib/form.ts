/**
 * The entry form's state and its mapping to the wire (design §4.5; plan m8 P6-P8, P11). Pure, so the form's rules
 * are tested without a DOM: the draft state, the create body (decoded with the shared
 * `CreateCalendarEntryRequestSchema` before it is sent, so a refusal reads like the server's), the update body
 * (an imported waste entry sends only what P8 allows), and the car conflict details of a 409.
 */
import {
  addCalendarDays,
  calendarDaysBetween,
  isCalendarDate,
  type CalendarAssigneeMode,
  type CalendarCarConflict,
  type CalendarEntry,
  type CalendarEntryKind,
  type CalendarRepeatFreq,
  type CalendarWeekday,
  type CreateCalendarEntryRequest,
  type UpdateCalendarEntryRequest,
} from "@toon/shared";
import { isApiError } from "@/modules/calendar/lib/api";

export interface EntryFormState {
  kind: CalendarEntryKind;
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  /** `""`: the start date (a single-day entry). */
  endDate: string;
  endTime: string;
  freq: CalendarRepeatFreq;
  /** A text field: the decode refuses anything but 1-99. */
  interval: string;
  weekdays: CalendarWeekday[];
  /** `""`: open-ended. */
  until: string;
  attendeeIds: string[];
  assigneeMode: CalendarAssigneeMode;
  assigneeIds: string[];
  resourceId: string;
  location: string;
  notes: string;
}

/** The kinds of the segmented control, in order. */
export const ENTRY_KINDS = ["event", "task", "car"] as const satisfies ReadonlyArray<CalendarEntryKind>;

export function isEntryKind(value: string | undefined): value is CalendarEntryKind {
  return value === "event" || value === "task" || value === "car";
}

/** Times a fresh draft of each kind starts with. */
const DEFAULT_TIMES: Record<CalendarEntryKind, { allDay: boolean; startTime: string; endTime: string }> = {
  event: { allDay: false, startTime: "09:00", endTime: "" },
  task: { allDay: true, startTime: "", endTime: "" },
  car: { allDay: false, startTime: "08:00", endTime: "17:00" },
};

/** A fresh draft for `/calendar/new?kind=&date=` (an invalid date falls back to `today`). */
export function emptyFormState(kind: CalendarEntryKind, date: string | undefined, today: string): EntryFormState {
  return {
    kind,
    title: "",
    ...DEFAULT_TIMES[kind],
    startDate: date !== undefined && isCalendarDate(date) ? date : today,
    endDate: "",
    freq: "none",
    interval: "1",
    weekdays: [],
    until: "",
    attendeeIds: [],
    assigneeMode: "none",
    assigneeIds: [],
    resourceId: "",
    location: "",
    notes: "",
  };
}

/** Switching the kind of a draft keeps title, date, rhythm, place and note, and resets times and people. */
export function withKind(state: EntryFormState, kind: CalendarEntryKind): EntryFormState {
  return {
    ...state,
    kind,
    ...DEFAULT_TIMES[kind],
    endDate: kind === "task" ? "" : state.endDate,
    attendeeIds: [],
    assigneeMode: "none",
    assigneeIds: [],
    resourceId: "",
  };
}

/** The stored series as a draft (Bearbeiten). */
export function formStateFromEntry(entry: CalendarEntry): EntryFormState {
  return {
    kind: entry.kind,
    title: entry.title ?? "",
    allDay: entry.allDay,
    startDate: entry.startDate,
    startTime: entry.startTime ?? "",
    endDate: entry.endDate === entry.startDate ? "" : entry.endDate,
    endTime: entry.endTime ?? "",
    freq: entry.repeat.freq,
    interval: String(entry.repeat.interval),
    weekdays: [...entry.repeat.weekdays],
    until: entry.repeat.until ?? "",
    attendeeIds: [...entry.attendeeIds],
    assigneeMode: entry.assigneeMode,
    assigneeIds: [...entry.assigneeIds],
    resourceId: entry.resourceId ?? "",
    location: entry.location ?? "",
    notes: entry.notes ?? "",
  };
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** The interval as the number the schema checks (`NaN` and `0` are refused there, at `repeat.interval`). */
function intervalOf(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

/**
 * The create body (P6): times only when not all-day, the end date only for events and car bookings, weekdays
 * only for a weekly rhythm, attendees for events (none = everybody) and the car's one driver, assignees only for
 * tasks, the car only for a booking.
 */
export function toCreateBody(state: EntryFormState): CreateCalendarEntryRequest {
  const timed = !state.allDay;
  return {
    kind: state.kind,
    title: state.title,
    allDay: state.allDay,
    startDate: state.startDate,
    startTime: timed ? textOrNull(state.startTime) : null,
    endDate: state.kind === "task" ? null : textOrNull(state.endDate),
    endTime: timed ? textOrNull(state.endTime) : null,
    repeat: {
      freq: state.freq,
      interval: state.freq === "none" ? 1 : intervalOf(state.interval),
      weekdays: state.freq === "weekly" ? [...state.weekdays] : [],
      until: state.freq === "none" ? null : textOrNull(state.until),
    },
    location: textOrNull(state.location),
    notes: textOrNull(state.notes),
    attendeeIds: state.kind === "task" ? [] : [...state.attendeeIds],
    assigneeMode: state.kind === "task" ? state.assigneeMode : "none",
    assigneeIds: state.kind === "task" && state.assigneeMode !== "none" ? [...state.assigneeIds] : [],
    resourceId: state.kind === "car" ? textOrNull(state.resourceId) : null,
  };
}

/** The PATCH body: every field of the create body but `kind`; an imported waste entry only notes and assignees (P8). */
export function toUpdateBody(state: EntryFormState, imported: boolean): UpdateCalendarEntryRequest {
  const { kind: _kind, ...rest } = toCreateBody(state);
  if (imported) return { notes: rest.notes, assigneeMode: rest.assigneeMode, assigneeIds: rest.assigneeIds };
  return rest;
}

/** The series a draft describes, for the next-dates preview (null while the draft is not a valid rhythm). */
export function draftSeries(state: EntryFormState) {
  if (state.freq === "none" || !isCalendarDate(state.startDate)) return null;
  const interval = intervalOf(state.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) return null;
  const endDate = state.kind !== "task" && isCalendarDate(state.endDate) && state.endDate >= state.startDate ? state.endDate : state.startDate;
  const until = isCalendarDate(state.until) && state.until >= state.startDate ? state.until : null;
  return {
    startDate: state.startDate,
    endDate,
    repeat: { freq: state.freq, interval, weekdays: state.freq === "weekly" ? state.weekdays : [], until },
  };
}

/** The day the preview starts from: today, or the start date when that is later. */
export function previewFrom(state: EntryFormState, today: string): string {
  return isCalendarDate(state.startDate) && state.startDate > today ? state.startDate : today;
}

/** The conflicts of a `409 calendar_car_conflict` (P11), or null for any other failure. */
export function carConflicts(error: unknown): CalendarCarConflict[] | null {
  if (!isApiError(error) || error.code !== "calendar_car_conflict") return null;
  const details = Array.isArray(error.details) ? (error.details as unknown[]) : [];
  return details.flatMap((item): CalendarCarConflict[] => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.entryId !== "string" || typeof record.date !== "string") return [];
    const text = (value: unknown) => (typeof value === "string" ? value : null);
    return [
      {
        entryId: record.entryId,
        date: record.date,
        startTime: text(record.startTime),
        endTime: text(record.endTime),
        title: text(record.title),
        memberIds: Array.isArray(record.memberIds) ? record.memberIds.filter((id): id is string => typeof id === "string") : [],
      },
    ];
  });
}

/** The first error at `path` or below it (`attendeeIds.1` shows at `attendeeIds`). */
export function errorAt(errors: Readonly<Record<string, string>>, path: string): string | undefined {
  if (errors[path] !== undefined) return errors[path];
  const prefix = `${path}.`;
  for (const [key, message] of Object.entries(errors)) if (key.startsWith(prefix)) return message;
  return undefined;
}

/** The end of the occurrence that starts on `date` (an entry keeps its length in every occurrence). */
export function occurrenceEnd(entry: Pick<CalendarEntry, "startDate" | "endDate">, date: string): string {
  return addCalendarDays(date, calendarDaysBetween(entry.startDate, entry.endDate));
}
