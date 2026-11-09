/**
 * The iCalendar writer of the subscription feed (RFC 5545; plan `docs/plans/m9-calendar-feed.md` P11, ADR 0017). Pure: no
 * Effect, no service, no `Date` (a UTC stamp is formatted from the stored unix milliseconds through `DateTime`).
 *
 * - `icsText(value)`: TEXT escaping (RFC 5545 §3.3.11): backslash, semicolon and comma get a backslash, every line break
 *   (`\r\n`, `\n`, `\r`) becomes the two characters `\n`.
 * - `foldLine(line)`: content-line folding (§3.1) at 75 OCTETS of UTF-8: the first physical line holds at most 75 octets,
 *   every continuation line a leading space plus at most 74; a fold never falls inside a UTF-8 sequence (the writer
 *   steps by code points). The physical lines are joined with CRLF + space.
 * - `icsCalendar({ name, events })`: the whole file, every line folded and ended by CRLF (the last one too):
 *   `VCALENDAR` with its header properties, the static `VTIMEZONE` of Europe/Berlin, one `VEVENT` per event in the
 *   given order. No `RRULE`: the feed carries expanded occurrences.
 *
 * Times: an all-day event is `DTSTART;VALUE=DATE` plus an EXCLUSIVE `DTEND;VALUE=DATE` (the day after its last day, so a
 * multi-day event spans exactly its days); a timed one is local wall time with `TZID=Europe/Berlin`, `DTEND` only with an
 * end time (§3.6.1: without one the event ends at its start). `DTSTAMP` and `LAST-MODIFIED` are the entry's `updated_at`
 * in UTC, so an unchanged calendar renders the same bytes (and the same ETag) on every fetch.
 */
import { addCalendarDays } from "@toon/shared";
import { DateTime } from "effect";

/** The feed's time zone, the zone of every timed `DTSTART` / `DTEND` (P8, P11). */
export const ICS_TIME_ZONE = "Europe/Berlin";

/** The `PRODID` of the feed. */
export const ICS_PRODID = "-//toon-household//Kalender//DE";

/** Octets per physical line before the CRLF (RFC 5545 §3.1). */
const MAX_LINE_OCTETS = 75;

const encoder = new TextEncoder();

/** RFC 5545 TEXT escaping: `\` `;` `,` escaped, every line break as `\n`. */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/** Folds one content line at 75 octets without splitting a UTF-8 sequence; physical lines joined by CRLF + space. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;
  const physical: string[] = [];
  let current = "";
  let octets = 0;
  // The first line may hold 75 octets; a continuation line holds the leading space plus 74.
  let budget = MAX_LINE_OCTETS;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > budget) {
      physical.push(current);
      current = "";
      octets = 0;
      budget = MAX_LINE_OCTETS - 1;
    }
    current += char;
    octets += size;
  }
  physical.push(current);
  return physical.join("\r\n ");
}

/** `2027-03-14` -> `20270314` (a DATE value). */
export function icsDate(date: string): string {
  return date.replace(/-/g, "");
}

/** `2027-03-14`, `08:30` -> `20270314T083000` (a local DATE-TIME, to be qualified with `TZID`). */
export function icsLocalDateTime(date: string, time: string): string {
  return `${icsDate(date)}T${time.replace(":", "")}00`;
}

/** Unix milliseconds -> `20270314T073000Z` (a UTC DATE-TIME), through `DateTime` (no `Date`). */
export function icsUtcStamp(unixMs: number): string {
  const iso = DateTime.formatIso(DateTime.makeUnsafe(unixMs));
  // `2027-03-14T07:30:00.000Z` -> `20270314T073000Z`
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/** One `VEVENT` of the feed, as the writer needs it (the mapper is `./vevent.ts`). */
export interface IcsEvent {
  /** `<entryId>-<occurrenceDate>@toon-household`, stable across fetches. */
  readonly uid: string;
  /** The entry's `updated_at` (unix ms): `DTSTAMP` and `LAST-MODIFIED`. */
  readonly updatedAt: number;
  readonly allDay: boolean;
  /** The occurrence's first day (`YYYY-MM-DD`). */
  readonly date: string;
  /** The occurrence's last day (`YYYY-MM-DD`, inclusive; equal to `date` for a one-day occurrence). */
  readonly endDate: string;
  /** `HH:MM` of a timed occurrence (ignored when `allDay`). */
  readonly startTime: string | null;
  /** `HH:MM` on `endDate`, or `null` (a timed occurrence without an end has no `DTEND`). */
  readonly endTime: string | null;
  /** `TRANSP:TRANSPARENT` (all-day tasks and waste pickups) or `OPAQUE`. */
  readonly transparent: boolean;
  readonly summary: string;
  /** Plain text (line breaks allowed); `null` writes no `DESCRIPTION`. */
  readonly description: string | null;
  /** Plain text; `null` writes no `LOCATION`. */
  readonly location: string | null;
}

/** The static `VTIMEZONE` of Europe/Berlin: CET/CEST with the EU rules (last Sunday of March / October). */
export const VTIMEZONE_EUROPE_BERLIN: ReadonlyArray<string> = [
  "BEGIN:VTIMEZONE",
  `TZID:${ICS_TIME_ZONE}`,
  `X-LIC-LOCATION:${ICS_TIME_ZONE}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** The content lines (unfolded) of one `VEVENT`. */
export function veventLines(event: IcsEvent): string[] {
  const stamp = icsUtcStamp(event.updatedAt);
  const lines = ["BEGIN:VEVENT", `UID:${event.uid}`, `DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`];
  if (event.allDay || event.startTime === null) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(event.date)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(addCalendarDays(event.endDate, 1))}`);
  } else {
    lines.push(`DTSTART;TZID=${ICS_TIME_ZONE}:${icsLocalDateTime(event.date, event.startTime)}`);
    if (event.endTime !== null) {
      lines.push(`DTEND;TZID=${ICS_TIME_ZONE}:${icsLocalDateTime(event.endDate, event.endTime)}`);
    }
  }
  lines.push(`SUMMARY:${icsText(event.summary)}`);
  if (event.description !== null && event.description !== "") lines.push(`DESCRIPTION:${icsText(event.description)}`);
  if (event.location !== null && event.location !== "") lines.push(`LOCATION:${icsText(event.location)}`);
  lines.push(`TRANSP:${event.transparent ? "TRANSPARENT" : "OPAQUE"}`);
  lines.push("END:VEVENT");
  return lines;
}

/** The calendar as the feed answers it. */
export interface IcsCalendar {
  /** `X-WR-CALNAME` (plain text, escaped by the writer). */
  readonly name: string;
  readonly events: ReadonlyArray<IcsEvent>;
}

/** The whole iCalendar file: every content line folded, every physical line ended by CRLF. */
export function icsCalendar(calendar: IcsCalendar): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${ICS_PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(calendar.name)}`,
    `X-WR-TIMEZONE:${ICS_TIME_ZONE}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...VTIMEZONE_EUROPE_BERLIN,
  ];
  for (const event of calendar.events) lines.push(...veventLines(event));
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
