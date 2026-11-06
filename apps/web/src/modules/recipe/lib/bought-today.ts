/**
 * "Heute gekauft" means TODAY on the device's calendar (docs/API.md, `?since` on the list
 * index: day grouping happens client-side). The list detail's `bought` array is every log
 * row past the per-list watermark ("Gekauftes leeren"), which can span several days; the
 * section shows only today's, and the older rows stay in the history (panel and
 * `/recipe/shopping/history`), grouped by the day they were really bought.
 */
import type { ShoppingBoughtItem } from "@toon/shared";
import { toPlanDate } from "@toon/shared";

/** Local midnight of `now` as an ISO instant: the `since` the list index counts from. */
export function startOfLocalDayIso(now: Date = new Date()): string {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return midnight.toISOString();
}

/** True when `boughtAt` falls on the same local calendar day as `now`. */
export function isBoughtToday(boughtAt: string, now: Date = new Date()): boolean {
  const date = new Date(boughtAt);
  if (Number.isNaN(date.getTime())) return false;
  return toPlanDate(date) === toPlanDate(now);
}

/** The entries of `entries` bought today, order kept. */
export function boughtToday(
  entries: readonly ShoppingBoughtItem[],
  now: Date = new Date(),
): ShoppingBoughtItem[] {
  return entries.filter((entry) => isBoughtToday(entry.boughtAt, now));
}
