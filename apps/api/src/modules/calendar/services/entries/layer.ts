/**
 * The calendar module's entries area (plan m8 P27): `CalendarResources` and `CalendarCarConflicts` (leaves over
 * `Database`), then `CalendarEntries` and `CalendarOccurrences` in an outer `Layer.provideMerge` step.
 *
 * FOUNDATION STUB (M8-T02): the lane api-core (M8-T05) replaces this file with the real area; until then it provides
 * nothing. The function and type names are the contract `../../layer.ts` composes.
 */
import { Layer } from "effect";

/** Every service `calendarEntriesAreaLayer()` provides (api-core: the four entry services). */
export type CalendarEntriesAreaServices = never;

export function calendarEntriesAreaLayer() {
  return Layer.empty;
}
