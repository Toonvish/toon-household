/**
 * Person colours (plan m8 P9a, design §4.6): a member's colour is derived from their position in the household's
 * member list sorted by join time (`household_members.created_at`, then `user_id`): position 0 is `--person-1`,
 * position 6 is `--person-1` again. The API sends `colorIndex` with every occurrence list; the web uses the same
 * function on the core members query.
 */
import { CALENDAR_PERSON_COLORS } from "./limits.ts";

/** The colour index (1-6) of the member at `position` (0-based) of the sorted list. */
export function calendarColorIndex(position: number): number {
  return (((position % CALENDAR_PERSON_COLORS) + CALENDAR_PERSON_COLORS) % CALENDAR_PERSON_COLORS) + 1;
}

/**
 * The colour index (1-6) of every member, keyed by `userId`. `members` must already be sorted by join time;
 * a user id listed twice keeps its first position.
 */
export function calendarPersonColors(members: ReadonlyArray<{ readonly userId: string }>): ReadonlyMap<string, number> {
  const colors = new Map<string, number>();
  members.forEach((member, position) => {
    if (!colors.has(member.userId)) colors.set(member.userId, calendarColorIndex(position));
  });
  return colors;
}
