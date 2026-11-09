/**
 * The feed's iCalendar writer and event mapper (plan `docs/plans/m9-calendar-feed.md` M9-T03, P11, P12): TEXT escaping,
 * folding at 75 octets without splitting a UTF-8 sequence, CRLF only, the header and the VTIMEZONE verbatim, all-day
 * (single and multi-day, exclusive DTEND), timed with TZID (with and without an end, multi-day), UID stability, the UTC
 * stamp, TRANSP, and per kind the SUMMARY and DESCRIPTION in `de` and `en`. Pure functions, no database.
 */
import { describe, expect, test } from "bun:test";
import type { CalendarOccurrence } from "@toon/shared";
import {
  type IcsEvent,
  VTIMEZONE_EUROPE_BERLIN,
  foldLine,
  icsCalendar,
  icsText,
  icsUtcStamp,
  veventLines,
} from "../src/modules/calendar/services/feed/ics.ts";
import { type FeedNames, feedCalendarName, feedEvent, feedUid } from "../src/modules/calendar/services/feed/vevent.ts";

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

/** RFC 5545 §3.1 unfolding: every CRLF followed by one space or tab disappears. */
function unfold(text: string): string {
  return text.replace(/\r\n[ \t]/g, "");
}

function octets(text: string): number {
  return encoder.encode(text).length;
}

/** Every physical line of a folded line: at most 75 octets, valid UTF-8 on its own, continuations start with a space. */
function expectWellFolded(folded: string): void {
  const physical = folded.split("\r\n");
  for (const [index, line] of physical.entries()) {
    expect(octets(line)).toBeLessThanOrEqual(75);
    expect(() => strictDecoder.decode(encoder.encode(line))).not.toThrow();
    if (index > 0) expect(line.startsWith(" ")).toBe(true);
  }
}

describe("icsText (RFC 5545 TEXT)", () => {
  test("escapes backslash, semicolon, comma and every line break", () => {
    expect(icsText("a\\b")).toBe("a\\\\b");
    expect(icsText("a;b")).toBe("a\\;b");
    expect(icsText("a,b")).toBe("a\\,b");
    expect(icsText("a\nb")).toBe("a\\nb");
    expect(icsText("a\r\nb")).toBe("a\\nb");
    expect(icsText("a\rb")).toBe("a\\nb");
    expect(icsText("C:\\Pfad; eins, zwei\r\ndrei")).toBe("C:\\\\Pfad\\; eins\\, zwei\\ndrei");
  });

  test("leaves a colon, quotes and non-ASCII text alone", () => {
    expect(icsText('Zahnarzt: "Dr. Müller" 10:30 €')).toBe('Zahnarzt: "Dr. Müller" 10:30 €');
  });
});

describe("foldLine (75 octets, UTF-8 safe)", () => {
  test("a line of 75 octets stays one line; 76 folds", () => {
    expect(foldLine("x".repeat(75))).toBe("x".repeat(75));
    expect(foldLine("x".repeat(76))).toBe(`${"x".repeat(75)}\r\n x`);
  });

  test("continuation lines hold the space plus at most 74 octets", () => {
    const line = `DESCRIPTION:${"y".repeat(300)}`;
    const folded = foldLine(line);
    expectWellFolded(folded);
    const physical = folded.split("\r\n");
    expect(octets(physical[0]!)).toBe(75);
    for (const continuation of physical.slice(1, -1)) expect(octets(continuation)).toBe(75);
    expect(unfold(folded)).toBe(line);
  });

  for (const [label, char, size] of [
    ["an ä (2 octets)", "ä", 2],
    ["a € (3 octets)", "€", 3],
    ["an emoji (4 octets)", "🗑", 4],
  ] as const) {
    test(`${label} across the 75-octet boundary moves whole to the next line`, () => {
      expect(octets(char)).toBe(size);
      // The character's first octet would be the 75th: it does not fit, so it starts the continuation line.
      const line = `${"a".repeat(74)}${char}${"b".repeat(80)}`;
      const folded = foldLine(line);
      expectWellFolded(folded);
      const [first, second] = folded.split("\r\n");
      expect(first).toBe("a".repeat(74));
      expect(second!.startsWith(` ${char}`)).toBe(true);
      expect(encoder.encode(unfold(folded))).toEqual(encoder.encode(line));
    });

    test(`${label}: every offset around the boundary folds without splitting a sequence`, () => {
      for (let prefix = 60; prefix <= 80; prefix += 1) {
        const line = `${"a".repeat(prefix)}${char.repeat(40)}z`;
        const folded = foldLine(line);
        expectWellFolded(folded);
        expect(encoder.encode(unfold(folded))).toEqual(encoder.encode(line));
      }
    });
  }

  test("a whole German description folds and unfolds byte for byte", () => {
    const line = `DESCRIPTION:${icsText("Für: Ömer, Jürgen, Anaïs\n\nBitte die grüne Tonne raus; Schlüssel liegt beim Nachbarn. Größe: 240 l, Gebühr 12,50 €. 🗑️")}`;
    const folded = foldLine(line);
    expectWellFolded(folded);
    expect(unfold(folded)).toBe(line);
  });
});

describe("icsUtcStamp", () => {
  test("unix milliseconds in UTC, seconds kept, milliseconds dropped", () => {
    expect(icsUtcStamp(Date.UTC(2027, 2, 14, 7, 30, 5, 999))).toBe("20270314T073005Z");
    expect(icsUtcStamp(0)).toBe("19700101T000000Z");
  });
});

/** An event of the writer with defaults. */
function icsEvent(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: "e1-2027-03-14@toon-household",
    updatedAt: Date.UTC(2027, 0, 2, 9, 0, 0),
    allDay: true,
    date: "2027-03-14",
    endDate: "2027-03-14",
    startTime: null,
    endTime: null,
    transparent: false,
    summary: "Elternabend",
    description: null,
    location: null,
    ...overrides,
  };
}

describe("the calendar file", () => {
  const body = icsCalendar({ name: "Haushalt · Familie, Süd", events: [icsEvent(), icsEvent({ uid: "e2-2027-03-15@toon-household" })] });

  test("CRLF only, ending in CRLF", () => {
    expect(body.endsWith("\r\n")).toBe(true);
    expect(body.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  test("the header lines and the VTIMEZONE, verbatim and in order", () => {
    const lines = unfold(body).split("\r\n");
    expect(lines.slice(0, 9)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//toon-household//Kalender//DE",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Haushalt · Familie\\, Süd",
      "X-WR-TIMEZONE:Europe/Berlin",
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H",
    ]);
    expect(lines.slice(9, 9 + VTIMEZONE_EUROPE_BERLIN.length)).toEqual([
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Berlin",
      "X-LIC-LOCATION:Europe/Berlin",
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
    ]);
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(lines.at(-1)).toBe("");
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(2);
    expect(lines.some((line) => line.startsWith("RRULE:") && !line.includes("BYMONTH"))).toBe(false);
  });

  test("an empty calendar is valid: header, timezone, end", () => {
    const empty = icsCalendar({ name: "Haushalt · Leer", events: [] });
    expect(empty).toContain("END:VTIMEZONE\r\nEND:VCALENDAR\r\n");
    expect(empty).not.toContain("VEVENT");
  });

  test("the same input renders the same bytes", () => {
    expect(icsCalendar({ name: "X", events: [icsEvent()] })).toBe(icsCalendar({ name: "X", events: [icsEvent()] }));
  });
});

describe("VEVENT times", () => {
  test("all-day, one day: DATE values, exclusive DTEND the next day", () => {
    const lines = veventLines(icsEvent());
    expect(lines).toContain("DTSTART;VALUE=DATE:20270314");
    expect(lines).toContain("DTEND;VALUE=DATE:20270315");
  });

  test("all-day, multi-day across a month end: DTEND is the day after the last day", () => {
    const lines = veventLines(icsEvent({ date: "2027-02-26", endDate: "2027-03-01" }));
    expect(lines).toContain("DTSTART;VALUE=DATE:20270226");
    expect(lines).toContain("DTEND;VALUE=DATE:20270302");
  });

  test("timed with an end: local times with TZID=Europe/Berlin", () => {
    const lines = veventLines(icsEvent({ allDay: false, startTime: "19:30", endTime: "21:00" }));
    expect(lines).toContain("DTSTART;TZID=Europe/Berlin:20270314T193000");
    expect(lines).toContain("DTEND;TZID=Europe/Berlin:20270314T210000");
    expect(lines.some((line) => line.includes("VALUE=DATE"))).toBe(false);
  });

  test("timed without an end: no DTEND", () => {
    const lines = veventLines(icsEvent({ allDay: false, startTime: "10:30", endTime: null }));
    expect(lines).toContain("DTSTART;TZID=Europe/Berlin:20270314T103000");
    expect(lines.some((line) => line.startsWith("DTEND"))).toBe(false);
  });

  test("a timed multi-day car booking ends on its end date at its end time", () => {
    const lines = veventLines(
      icsEvent({ allDay: false, date: "2027-03-27", endDate: "2027-03-29", startTime: "08:00", endTime: "17:00" }),
    );
    expect(lines).toContain("DTSTART;TZID=Europe/Berlin:20270327T080000");
    expect(lines).toContain("DTEND;TZID=Europe/Berlin:20270329T170000");
  });

  test("UID, DTSTAMP and LAST-MODIFIED from the entry's updated time; TRANSP both ways; LOCATION escaped", () => {
    const lines = veventLines(icsEvent({ transparent: true, location: "Schule, Raum 3" }));
    expect(lines[0]).toBe("BEGIN:VEVENT");
    expect(lines).toContain("UID:e1-2027-03-14@toon-household");
    expect(lines).toContain("DTSTAMP:20270102T090000Z");
    expect(lines).toContain("LAST-MODIFIED:20270102T090000Z");
    expect(lines).toContain("TRANSP:TRANSPARENT");
    expect(lines).toContain("LOCATION:Schule\\, Raum 3");
    expect(lines.at(-1)).toBe("END:VEVENT");
    expect(veventLines(icsEvent())).toContain("TRANSP:OPAQUE");
    expect(veventLines(icsEvent()).some((line) => line.startsWith("DESCRIPTION") || line.startsWith("LOCATION"))).toBe(false);
  });
});

/* ------------------------------- the mapper ------------------------------- */

const names: FeedNames = {
  members: new Map([
    ["u-eric", "Eric"],
    ["u-robin", "Robin"],
    ["u-kim", "Kim"],
  ]),
  cars: new Map([["car-1", "Familienauto"]]),
};

function occurrence(overrides: Partial<CalendarOccurrence> = {}): CalendarOccurrence {
  return {
    id: "entry-1:2027-03-14",
    entryId: "entry-1",
    kind: "event",
    title: "Elternabend",
    category: null,
    categoryDetail: null,
    date: "2027-03-14",
    endDate: "2027-03-14",
    allDay: false,
    startTime: "19:30",
    endTime: null,
    location: null,
    recurring: false,
    memberIds: [],
    assigneeId: null,
    resourceId: null,
    status: "open",
    doneBy: null,
    ...overrides,
  };
}

function mapped(overrides: Partial<CalendarOccurrence>, locale: "de" | "en" = "de", notes: string | null = null) {
  return feedEvent({ occurrence: occurrence(overrides), notes, updatedAt: Date.UTC(2027, 0, 2) }, names, locale);
}

describe("feedEvent (P12)", () => {
  test("UID is <entryId>-<date>@toon-household, stable for the same input", () => {
    expect(mapped({}).uid).toBe("entry-1-2027-03-14@toon-household");
    expect(mapped({}).uid).toBe(mapped({}).uid);
    expect(feedUid("abc", "2027-01-01")).toBe("abc-2027-01-01@toon-household");
    expect(mapped({ date: "2027-03-21", endDate: "2027-03-21" }).uid).toBe("entry-1-2027-03-21@toon-household");
  });

  test("event for everybody, and for named people; a former member; notes after an empty line", () => {
    expect(mapped({})).toMatchObject({ summary: "Elternabend", description: "Für: Alle", transparent: false });
    expect(mapped({}, "en").description).toBe("For: Everybody");
    expect(mapped({ memberIds: ["u-robin", "u-gone"] }).description).toBe("Für: Robin, Ehemaliges Mitglied");
    expect(mapped({ memberIds: ["u-robin", "u-gone"] }, "en").description).toBe("For: Robin, Former member");
    expect(mapped({ memberIds: ["u-kim"] }, "de", "Mappe mitbringen").description).toBe("Für: Kim\n\nMappe mitbringen");
  });

  test("task: title · assignee (the rotation's pick of THIS occurrence), done with the check mark", () => {
    const task = { kind: "task" as const, title: "Blumen gießen", allDay: true, startTime: null, assigneeId: "u-robin" };
    expect(mapped(task)).toMatchObject({
      summary: "Blumen gießen · Robin",
      description: "Zuständig: Robin",
      transparent: true,
    });
    expect(mapped({ ...task, status: "done", doneBy: "u-robin" }).summary).toBe("✓ Blumen gießen · Robin");
    expect(mapped({ ...task, assigneeId: "u-kim" }, "en")).toMatchObject({
      summary: "Blumen gießen · Kim",
      description: "Assigned: Kim",
    });
    expect(mapped({ ...task, assigneeId: null })).toMatchObject({ summary: "Blumen gießen", description: null });
    expect(mapped({ ...task, allDay: false, startTime: "18:00" }).transparent).toBe(false);
  });

  test("car booking: car: title (or the default) · person; car and people lines", () => {
    const car = { kind: "car" as const, title: null, resourceId: "car-1", memberIds: ["u-robin"], endTime: "17:00" };
    expect(mapped(car)).toMatchObject({
      summary: "Familienauto: Autobuchung · Robin",
      description: "Auto: Familienauto\nFür: Robin",
      transparent: false,
    });
    expect(mapped({ ...car, title: "Baumarkt" }, "en")).toMatchObject({
      summary: "Familienauto: Baumarkt · Robin",
      description: "Car: Familienauto\nFor: Robin",
    });
    expect(mapped({ ...car, memberIds: [] })).toMatchObject({
      summary: "Familienauto: Autobuchung",
      description: "Auto: Familienauto",
    });
    expect(mapped({ ...car, resourceId: "car-gone" }).summary).toBe("Auto: Autobuchung · Robin");
  });

  test("waste pickup: the label, with cleaning, done; the assignee in the description only", () => {
    const pickup = {
      kind: "task" as const,
      title: null,
      category: "waste_bio" as const,
      allDay: true,
      startTime: null,
      assigneeId: "u-eric",
    };
    expect(mapped(pickup)).toMatchObject({ summary: "Biotonne", description: "Zuständig: Eric", transparent: true });
    expect(mapped({ ...pickup, categoryDetail: "bio_cleaning" }).summary).toBe("Biotonne + Reinigung");
    expect(mapped({ ...pickup, categoryDetail: "bio_cleaning" }, "en").summary).toBe("Organic bin + cleaning");
    expect(mapped({ ...pickup, status: "done" }).summary).toBe("✓ Biotonne");
    expect(mapped({ ...pickup, category: "waste_yellow", assigneeId: null })).toMatchObject({
      summary: "Gelber Sack",
      description: null,
    });
    expect(mapped({ ...pickup, category: "waste_rest" }, "de", "Tonne steht im Hof").description).toBe(
      "Zuständig: Eric\n\nTonne steht im Hof",
    );
  });

  test("the occurrence's times and location pass through", () => {
    expect(mapped({ location: "Schule", endDate: "2027-03-15", endTime: "08:00" })).toMatchObject({
      date: "2027-03-14",
      endDate: "2027-03-15",
      startTime: "19:30",
      endTime: "08:00",
      allDay: false,
      location: "Schule",
    });
  });

  test("X-WR-CALNAME: the household's name, scope mine with its marker", () => {
    expect(feedCalendarName("Familie", "all", "de")).toBe("Haushalt · Familie");
    expect(feedCalendarName("Familie", "mine", "de")).toBe("Haushalt · Familie (meine Termine)");
    expect(feedCalendarName("Familie", "mine", "en")).toBe("Household · Familie (my events)");
  });

  test("a mapped event writes a VEVENT whose description escapes its line breaks", () => {
    const lines = veventLines(mapped({ memberIds: ["u-kim"] }, "de", "Eins; zwei, drei"));
    expect(lines).toContain("SUMMARY:Elternabend");
    expect(lines).toContain("DESCRIPTION:Für: Kim\\n\\nEins\\; zwei\\, drei");
  });
});
