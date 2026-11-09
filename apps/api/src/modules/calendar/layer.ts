/**
 * The calendar module's one composition (plan m8 P27; docs/EFFECT.md E7):
 *
 *   feed area                   (M9: the subscription links and the render; yields the entries area's services)
 *   over entries area + waste area   (independent: waste writes its entries with its own statements)
 *   over CalendarMembers        (a leaf over `Database`; every area may yield it)
 *
 * What `calendarLayer()` leaves open is `ModuleRequirements` (`Database` and whatever core service an area yields):
 * the runtime nests the module over the core and the infrastructure (`src/runtime.ts`), and the manifest exports it as
 * `layer: Layer.suspend(calendarLayer)`. The hooks (`./hooks.ts`, `./seed.ts`) use `Database` only and need none of
 * these services, so there is no `withCalendarServices` (P14).
 *
 * Import cycle (CLAUDE.md "API import cycle"): hoisted functions and types only; nothing runs at import.
 */
import { Layer } from "effect";
import { type CalendarEntriesAreaServices, calendarEntriesAreaLayer } from "./services/entries/layer.ts";
import { type CalendarFeedAreaServices, calendarFeedAreaLayer } from "./services/feed/layer.ts";
import { CalendarMembers } from "./services/members.ts";
import { type CalendarWasteAreaServices, calendarWasteAreaLayer } from "./services/waste/layer.ts";

/** Every service the calendar module provides (`src/modules/index.ts` `ModuleServices`). */
export type CalendarServices =
  | CalendarMembers
  | CalendarEntriesAreaServices
  | CalendarWasteAreaServices
  | CalendarFeedAreaServices;

/** Every calendar service: the feed area over the two areas over the members service. */
export function calendarLayer() {
  return calendarFeedAreaLayer().pipe(
    Layer.provideMerge(Layer.mergeAll(calendarEntriesAreaLayer(), calendarWasteAreaLayer())),
    Layer.provideMerge(CalendarMembers.layer),
  );
}
