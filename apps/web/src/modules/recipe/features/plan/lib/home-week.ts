/**
 * Pure helpers behind the Home card's week strip (SPEC §5, D5; plan m4-design-pass M4-T04).
 *
 * No React, no registry, no layout: the card is in the manifest's static import graph, so
 * everything it needs to decide lives here as plain functions over the plan and list data.
 */
import type { MealPlanEntry, PlanDate, ShoppingList } from "@toon/shared";

export type HomeDayState = "today" | "planned" | "empty";

export interface HomeWeekDay {
  date: PlanDate;
  state: HomeDayState;
  /** How many entries are planned on the day (drives the dots on a planned cell). */
  count: number;
}

type EntryDay = Pick<MealPlanEntry, "plannedOn">;
type EntryOrder = Pick<MealPlanEntry, "plannedOn" | "position">;

/** The seven day cells of `week`; today wins over planned (R redesign SPEC §4.1). */
export function homeWeekDays(entries: readonly EntryDay[], week: readonly PlanDate[], today: PlanDate): HomeWeekDay[] {
  const counts = new Map<PlanDate, number>();
  for (const entry of entries) counts.set(entry.plannedOn, (counts.get(entry.plannedOn) ?? 0) + 1);
  return week.map((date) => {
    const count = counts.get(date) ?? 0;
    const state: HomeDayState = date === today ? "today" : count > 0 ? "planned" : "empty";
    return { date, state, count };
  });
}

/** Entries from today on, by day then position, at most `max`. Plan dates compare as strings. */
export function upcomingEntries<T extends EntryOrder>(entries: readonly T[], today: PlanDate, max = 3): T[] {
  return entries
    .filter((entry) => entry.plannedOn >= today)
    .sort((a, b) => a.plannedOn.localeCompare(b.plannedOn) || a.position - b.position)
    .slice(0, max);
}

/** The list `/recipe/shopping` shows first, or `null` when there is none. */
export function activeShoppingList<T extends Pick<ShoppingList, "id">>(lists: readonly T[]): T | null {
  return lists[0] ?? null;
}
