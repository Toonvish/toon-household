/**
 * The calendar module's entries area (plan m8 P27): `CalendarResources` and `CalendarCarConflicts` (leaves over
 * `Database`), then `CalendarEntries` and `CalendarOccurrences` in an outer `Layer.provideMerge` step (they yield the
 * leaves and `CalendarMembers`, which `../../layer.ts` provides under both areas). Requirements stay open
 * (`Database`, `CalendarMembers`) and are satisfied by `calendarLayer()` and the core under it.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import, and the services are
 * read inside the function body.
 */
import { Layer } from "effect";
import { CalendarCarConflicts } from "./conflicts.service.ts";
import { CalendarEntries } from "./entries.service.ts";
import { CalendarOccurrences } from "./occurrences.service.ts";
import { CalendarResources } from "./resources.service.ts";

/** Every service `calendarEntriesAreaLayer()` provides. */
export type CalendarEntriesAreaServices = CalendarResources | CalendarCarConflicts | CalendarEntries | CalendarOccurrences;

export function calendarEntriesAreaLayer() {
  return Layer.mergeAll(CalendarEntries.layer, CalendarOccurrences.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(CalendarResources.layer, CalendarCarConflicts.layer)),
  );
}
