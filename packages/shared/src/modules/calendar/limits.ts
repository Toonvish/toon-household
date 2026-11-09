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

/**
 * The subscription feed `GET /api/calendar/feed/<token>.ics` (plan m9 P3-P8, ADR 0017). The token is 32 random bytes in
 * base64url without padding (43 characters); the database stores only its SHA-256 hex.
 */
export const CALENDAR_FEED_LIMITS = {
  /** Random bytes per token. */
  tokenBytes: 32,
  /** Characters of the base64url token (no padding). */
  tokenLength: 43,
  /** The feed's window starts this many days before the server's today in `timeZone` (P8). */
  pastDays: 30,
  /** … and ends this many days after it (inclusive): 396 days, under `CALENDAR_LIMITS.maxRangeDays`. */
  futureDays: 365,
  /** Fetches per token and hour; more is `429 rate_limited` with `Retry-After` (P5). */
  fetchesPerHour: 60,
  /** `last_used_at` is written at most once per this many milliseconds and token (P7). */
  lastUsedResolutionMs: 3_600_000,
  /** `Cache-Control: private, max-age=<this>` on the feed (P6). */
  maxAgeSeconds: 300,
  /** The household's time zone: the feed's today and every timed `DTSTART` / `DTEND` (`TZID`). */
  timeZone: "Europe/Berlin",
} as const;

/** Where the feed lives; the full URL is `<first WEB_ORIGIN><prefix><token>.ics` (P13). */
export const CALENDAR_FEED_PATH_PREFIX = "/api/calendar/feed/";

/** The feed route's `:file`: a 43-character base64url token plus `.ics`; group 1 is the token. Anything else is `404`. */
export const CALENDAR_FEED_FILE_PATTERN = /^([A-Za-z0-9_-]{43})\.ics$/;
