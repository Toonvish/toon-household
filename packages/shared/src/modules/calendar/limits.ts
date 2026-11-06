/**
 * The calendar module's caps and fixed vocabularies (docs/modules/calendar.md, plan m8 P4, P6, P11, P17).
 * Pure constants: the API enforces them, the web mirrors them in its forms.
 */

export const CALENDAR_LIMITS = {
  /** A read range (`from` … `to`, inclusive) spans at most this many days (P4). */
  maxRangeDays: 400,
  /** One entry may expand to at most this many occurrences per request; more is `422 calendar_range_too_large` (P4). */
  maxOccurrencesPerEntry: 2000,
  /** A recurring car booking is checked for conflicts this many days past its start (P11). */
  conflictHorizonDays: 366,
  /** A `409 calendar_car_conflict` lists at most this many conflicts (P11). */
  conflictDetailsMax: 10,
  titleMax: 200,
  locationMax: 200,
  notesMax: 2000,
  /** A car's name, 1-60 characters after trimming (P13). */
  resourceNameMax: 60,
  /** Attendees of one event (none = everybody). */
  attendeesMax: 20,
  /** Members of one rotation (2-12). */
  rotationMax: 12,
  /** `repeat.interval` is 1 … 99. */
  intervalMax: 99,
  /** The waste flyer: at most 10 MiB, by `Content-Length` and by the streamed count (P17). */
  wastePdfMaxBytes: 10_485_760,
  /** The waste flyer: at most this many pages (P18). */
  wastePdfMaxPages: 6,
  /** The whole fetch, and the whole text extraction, each under 20 s (P17, P18). */
  wasteTimeoutMs: 20_000,
  /** At most this many redirect hops while fetching the flyer (P17). */
  wasteRedirectsMax: 5,
} as const;

/** The weekdays of a weekly rhythm, ISO order: index 0 is Monday (`calendarWeekday`). */
export const CALENDAR_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/** The number of person colour tokens (`--person-1` … `--person-6`, design §4.6). */
export const CALENDAR_PERSON_COLORS = 6;
