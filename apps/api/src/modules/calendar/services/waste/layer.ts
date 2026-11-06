/**
 * The calendar module's waste area (plan m8 P27):
 *
 *   CalendarWaste                       (over CalendarMembers, Database, RateLimiter and the two leaves)
 *   WastePdfText + WasteFlyerFetch      (leaves; `WasteFlyerFetch.layer` provides `FetchHttpClient.layer` itself,
 *                                        `HttpClient` is no `ModuleRequirements` service)
 *
 * `CalendarWaste` needs the leaves of the step below it, so it sits in an outer `Layer.provideMerge` step, never beside
 * them in a `Layer.mergeAll` (CLAUDE.md "One composition point"). `CalendarMembers` comes from `../../layer.ts`, which
 * provides it to both areas. The area does not depend on the entries area (it writes its entries itself).
 *
 * The function and type names are the contract `../../layer.ts` composes. Hoisted, nothing runs at import.
 */
import { Layer } from "effect";
import { WasteFlyerFetch } from "./fetch.ts";
import { WastePdfText } from "./pdf-text.ts";
import { CalendarWaste } from "./waste.service.ts";

/** Every service `calendarWasteAreaLayer()` provides. */
export type CalendarWasteAreaServices = WastePdfText | WasteFlyerFetch | CalendarWaste;

/** The waste area. */
export function calendarWasteAreaLayer() {
  return CalendarWaste.layer.pipe(Layer.provideMerge(Layer.mergeAll(WastePdfText.layer, WasteFlyerFetch.layer)));
}
