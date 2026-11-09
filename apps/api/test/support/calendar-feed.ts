/**
 * Helpers of the subscription-feed tests (plan `docs/plans/m9-calendar-feed.md` M9-T04, M9-T05): a waste pickup written
 * straight into the shared test `db` (as an import writes it: an all-day `task` with a `category` and a
 * `waste_import_id`), a tolerant reader of the iCalendar body (unfolds, splits the VEVENTs, unescapes TEXT), and the
 * token of a feed url.
 */
import { CALENDAR_FEED_PATH_PREFIX, type WasteCategory } from "@toon/shared";
import { db } from "../../src/db/client.ts";
import { calendarEntries, calendarEntryMembers, calendarWasteImports } from "../../src/modules/calendar/schema.ts";

/** One parsed VEVENT: every property by name (the last one wins), parameters kept in the key (`DTSTART;VALUE=DATE`). */
export interface ParsedEvent {
  readonly raw: ReadonlyMap<string, string>;
  readonly uid: string;
  readonly summary: string;
  readonly description: string | undefined;
  /** The value of whichever `DTSTART…` line the event has. */
  readonly dtstart: string;
}

/** RFC 5545 §3.1 unfolding. */
export function unfoldIcs(body: string): string {
  return body.replace(/\r\n[ \t]/g, "");
}

/** TEXT unescaping (the inverse of `icsText`). */
export function unescapeIcsText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_match, char: string) => (char === "n" || char === "N" ? "\n" : char));
}

/** The VEVENTs of a body, in order. */
export function parseIcsEvents(body: string): ParsedEvent[] {
  const lines = unfoldIcs(body).split("\r\n");
  const events: ParsedEvent[] = [];
  let current: Map<string, string> | undefined;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = new Map();
    } else if (line === "END:VEVENT" && current !== undefined) {
      const raw = current;
      const dtstartKey = [...raw.keys()].find((key) => key === "DTSTART" || key.startsWith("DTSTART;"));
      const description = raw.get("DESCRIPTION");
      events.push({
        raw,
        uid: raw.get("UID") ?? "",
        summary: unescapeIcsText(raw.get("SUMMARY") ?? ""),
        description: description === undefined ? undefined : unescapeIcsText(description),
        dtstart: dtstartKey === undefined ? "" : (raw.get(dtstartKey) ?? ""),
      });
      current = undefined;
    } else if (current !== undefined) {
      const colon = line.indexOf(":");
      current.set(line.slice(0, colon), line.slice(colon + 1));
    }
  }
  return events;
}

/** The `X-WR-CALNAME` of a body, unescaped. */
export function calendarNameOf(body: string): string | undefined {
  const line = unfoldIcs(body)
    .split("\r\n")
    .find((candidate) => candidate.startsWith("X-WR-CALNAME:"));
  return line === undefined ? undefined : unescapeIcsText(line.slice("X-WR-CALNAME:".length));
}

/** `https://…/api/calendar/feed/<token>.ics` -> `<token>.ics` (the route's `:file`). */
export function feedFileOf(url: string): string {
  const index = url.indexOf(CALENDAR_FEED_PATH_PREFIX);
  if (index < 0) throw new Error(`not a feed url: ${url}`);
  return url.slice(index + CALENDAR_FEED_PATH_PREFIX.length);
}

/** `https://…/api/calendar/feed/<token>.ics` -> `/api/calendar/feed/<token>.ics` (for `app.request`). */
export function feedPathOf(url: string): string {
  return `${CALENDAR_FEED_PATH_PREFIX}${feedFileOf(url)}`;
}

/** The fake import years of `insertWastePickup`, one per call. */
let nextFakeYear = 1000;

/**
 * Writes one waste pickup the way an import does (its own import row per call, a year that cannot collide) and returns
 * the entry id; `assigneeId` stores it as `fixed` with that one person.
 */
export async function insertWastePickup(
  householdId: string,
  createdBy: string,
  pickup: { readonly date: string; readonly category: WasteCategory; readonly assigneeId?: string | null; readonly notes?: string },
): Promise<string> {
  const importId = crypto.randomUUID();
  await db.insert(calendarWasteImports).values({
    id: importId,
    householdId,
    provider: "hattingen",
    // The unique key is (household, provider, year): a distinct fake year per call.
    year: (nextFakeYear += 1),
    tour: 4,
    source: "upload",
    sourceName: "feed-test",
    entryCount: 1,
    importedAt: 0,
    importedBy: createdBy,
  });
  const entryId = crypto.randomUUID();
  await db.insert(calendarEntries).values({
    id: entryId,
    householdId,
    kind: "task",
    title: null,
    notes: pickup.notes ?? null,
    allDay: true,
    startDate: pickup.date,
    endDate: pickup.date,
    category: pickup.category,
    assigneeMode: pickup.assigneeId ? "fixed" : "none",
    wasteImportId: importId,
    createdBy,
    createdAt: 0,
    updatedAt: 0,
  });
  if (pickup.assigneeId) {
    await db.insert(calendarEntryMembers).values({ entryId, userId: pickup.assigneeId, role: "assignee", position: 0 });
  }
  return entryId;
}
