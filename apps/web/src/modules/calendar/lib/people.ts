/**
 * People and colours of the calendar (design §1.1, §4.6; plan m8 P9a). A person's colour is their position in the
 * household's member list sorted by join time, through the shared `calendarPersonColors`; the API sends it with
 * every occurrence list (`members`), and the forms derive the same from the core members query. Colour is never
 * the only signal: the name is always written beside a dot.
 *
 * The Tailwind classes are LITERALS (Tailwind finds utilities by scanning the source): `bg-person-1` … and
 * `bg-waste-…`, mapped in `apps/web/src/styles/index.css`.
 */
import {
  calendarPersonColors,
  type CalendarMember,
  type CalendarOccurrence,
  type CalendarWasteCategory,
  type HouseholdMember,
} from "@toon/shared";
import { translate } from "@/lib/i18n";

const PERSON_DOT_CLASSES = [
  "bg-person-1",
  "bg-person-2",
  "bg-person-3",
  "bg-person-4",
  "bg-person-5",
  "bg-person-6",
] as const;

/** The background utility of a person colour (1-6); anything else falls back to the first. */
export function personColorClass(colorIndex: number): string {
  return PERSON_DOT_CLASSES[colorIndex - 1] ?? PERSON_DOT_CLASSES[0];
}

const WASTE_DOT_CLASSES = {
  waste_rest: "bg-waste-rest",
  waste_yellow: "bg-waste-yellow",
  waste_bio: "bg-waste-bio",
  waste_paper: "bg-waste-paper",
  waste_tree: "bg-waste-tree",
} as const satisfies Record<CalendarWasteCategory, string>;

/** The background utility of a waste type. */
export function wasteColorClass(category: CalendarWasteCategory): string {
  return WASTE_DOT_CLASSES[category];
}

/** Members by user id. */
export type MemberMap = ReadonlyMap<string, CalendarMember>;

export function memberMap(members: ReadonlyArray<CalendarMember>): MemberMap {
  return new Map(members.map((member) => [member.userId, member]));
}

/** A member's name, or `Ehemaliges Mitglied` for an id that left the household (plan m8 P14). */
export function memberName(members: MemberMap, userId: string): string {
  return members.get(userId)?.name ?? translate("calendar.common.formerMember");
}

/**
 * The core members list as calendar members: sorted by join time (`createdAt`, then `userId`), coloured by
 * position (the same rule as the API's `members`, P9a).
 */
export function calendarMembersFromHousehold(items: ReadonlyArray<HouseholdMember>): CalendarMember[] {
  const sorted = [...items].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1,
  );
  const colors = calendarPersonColors(sorted);
  return sorted.map((member) => ({
    userId: member.userId,
    name: member.user.name,
    colorIndex: colors.get(member.userId) ?? 1,
    hasAccount: member.hasAccount,
  }));
}

/**
 * Who an occurrence is for: a task's assignee for that day, else the attendees (an event's people, the car
 * booking's driver). Empty means everybody (an event) or nobody in particular (an unassigned task or pickup).
 */
export function occurrencePeople(occurrence: Pick<CalendarOccurrence, "kind" | "assigneeId" | "memberIds">): string[] {
  if (occurrence.kind === "task") return occurrence.assigneeId === null ? [] : [occurrence.assigneeId];
  return [...occurrence.memberIds];
}
