/**
 * The feed's event mapper (plan `docs/plans/m9-calendar-feed.md` P12): one occurrence, its entry's notes and
 * `updated_at`, the household's member and car names, and a locale -> the fields of one `VEVENT` (`IcsEvent` of
 * `./ics.ts`). Pure: no Effect, no service, no `Date`.
 *
 * Interface words come from the server catalog `server.calendar.feed.*` in `locale` (the token user's `users.locale`,
 * else the deployment default; P10). Content (titles, notes, locations, people's and cars' names, the household's
 * name) is never translated.
 *
 * - event: `SUMMARY` = the title; `DESCRIPTION` "For: everybody" without attendees, else "For: <names>".
 * - task: `SUMMARY` = the title, plus " · <assignee>" when the occurrence has one (`withPeople`); a done occurrence gets
 *   the check mark (`done`); `DESCRIPTION` "Assigned: <name>" when assigned.
 * - car booking: `SUMMARY` = "<car>: <title or carDefaultTitle>" (`carSummary`), plus " · <people>"; `DESCRIPTION`
 *   "Car: <car>" and "For: <names>" (a booking that lost its person has no "For" line). A car the household no longer
 *   lists is `unknownCar`.
 * - waste pickup: `SUMMARY` = the waste type's label (`waste.withCleaning` for `bio_cleaning`), done -> the check mark;
 *   `DESCRIPTION` "Assigned: <name>" when assigned.
 * - A user id that is no household member any more renders `formerMember`; names are joined with ", ". `DESCRIPTION`
 *   is the people and car lines, then an empty line and the entry's notes when it has any; `null` when empty.
 * - `TRANSP` is TRANSPARENT for an all-day task (every waste pickup is one), OPAQUE otherwise.
 */
import {
  type CalendarFeedScope,
  type CalendarOccurrence,
  type Locale,
  type MessageValues,
  type ServerKey,
  serverText,
} from "@toon/shared";
import type { IcsEvent } from "./ics.ts";

/** The names an event mentions, by id. */
export interface FeedNames {
  /** Household members (placeholders included) by user id. */
  readonly members: ReadonlyMap<string, string>;
  /** The household's cars (archived ones included) by resource id. */
  readonly cars: ReadonlyMap<string, string>;
}

/** One occurrence with what the mapper reads of its entry. */
export interface FeedOccurrence {
  readonly occurrence: CalendarOccurrence;
  /** The entry's notes (content), or `null`. */
  readonly notes: string | null;
  /** The entry's `updated_at` (unix ms): `DTSTAMP` and `LAST-MODIFIED`. */
  readonly updatedAt: number;
}

/** The `UID` of an occurrence: stable across fetches, unique per entry and occurrence start. */
export function feedUid(entryId: string, date: string): string {
  return `${entryId}-${date}@toon-household`;
}

/** `X-WR-CALNAME`: "Household · <name>", scope `mine` with its marker. */
export function feedCalendarName(householdName: string, scope: CalendarFeedScope, locale: Locale): string {
  const key: ServerKey = scope === "mine" ? "server.calendar.feed.calendarNameMine" : "server.calendar.feed.calendarName";
  return serverText(locale, { key, values: { household: householdName } });
}

/** The fields of the occurrence's `VEVENT`. */
export function feedEvent(input: FeedOccurrence, names: FeedNames, locale: Locale): IcsEvent {
  const { occurrence } = input;
  const text = (key: ServerKey, values?: MessageValues): string =>
    serverText(locale, values === undefined ? key : { key, values });
  const nameOf = (userId: string): string => names.members.get(userId) ?? text("server.calendar.feed.formerMember");
  const joined = (ids: ReadonlyArray<string>): string => ids.map(nameOf).join(", ");
  const withPeople = (summary: string, ids: ReadonlyArray<string>): string =>
    ids.length === 0 ? summary : text("server.calendar.feed.withPeople", { summary, names: joined(ids) });
  const done = (summary: string): string =>
    occurrence.status === "done" ? text("server.calendar.feed.done", { summary }) : summary;
  const assigned = occurrence.assigneeId === null ? [] : [occurrence.assigneeId];

  let summary: string;
  const lines: string[] = [];
  if (occurrence.category !== null) {
    const label = text(`server.calendar.feed.waste.${occurrence.category}`);
    summary = done(
      occurrence.categoryDetail === "bio_cleaning" ? text("server.calendar.feed.waste.withCleaning", { label }) : label,
    );
    if (assigned.length > 0) lines.push(text("server.calendar.feed.assignee", { names: joined(assigned) }));
  } else if (occurrence.kind === "task") {
    summary = done(withPeople(occurrence.title ?? "", assigned));
    if (assigned.length > 0) lines.push(text("server.calendar.feed.assignee", { names: joined(assigned) }));
  } else if (occurrence.kind === "car") {
    const car =
      (occurrence.resourceId === null ? undefined : names.cars.get(occurrence.resourceId)) ??
      text("server.calendar.feed.unknownCar");
    const title = occurrence.title ?? text("server.calendar.feed.carDefaultTitle");
    summary = withPeople(text("server.calendar.feed.carSummary", { car, title }), occurrence.memberIds);
    lines.push(text("server.calendar.feed.car", { car }));
    if (occurrence.memberIds.length > 0) lines.push(text("server.calendar.feed.for", { names: joined(occurrence.memberIds) }));
  } else {
    summary = occurrence.title ?? "";
    const people =
      occurrence.memberIds.length === 0 ? text("server.calendar.feed.everybody") : joined(occurrence.memberIds);
    lines.push(text("server.calendar.feed.for", { names: people }));
  }

  const notes = input.notes?.trim() ?? "";
  const description = notes === "" ? lines.join("\n") : [...lines, ...(lines.length > 0 ? [""] : []), notes].join("\n");
  return {
    uid: feedUid(occurrence.entryId, occurrence.date),
    updatedAt: input.updatedAt,
    allDay: occurrence.allDay,
    date: occurrence.date,
    endDate: occurrence.endDate,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime,
    transparent: occurrence.kind === "task" && occurrence.allDay,
    summary,
    description: description === "" ? null : description,
    location: occurrence.location,
  };
}
