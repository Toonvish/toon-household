/**
 * The calendar module's feed area (plan `docs/plans/m9-calendar-feed.md` P13; ADR 0017):
 *
 *   CalendarFeedTokens + CalendarFeed   (the links, and the render; over Database, AppConfig, RateLimiter,
 *                                        HouseholdModules, and the entries area's CalendarOccurrences and
 *                                        CalendarResources)
 *
 * The two services do not need each other. `CalendarFeed` yields services of the entries area, so `../../layer.ts`
 * puts this area in an OUTER `Layer.provideMerge` step over the entries and waste areas, never beside them in a
 * `Layer.mergeAll` (CLAUDE.md "One composition point").
 *
 * Hoisted, nothing runs at import.
 */
import { Layer } from "effect";
import { CalendarFeed } from "./feed.service.ts";
import { CalendarFeedTokens } from "./tokens.service.ts";

/** Every service `calendarFeedAreaLayer()` provides. */
export type CalendarFeedAreaServices = CalendarFeedTokens | CalendarFeed;

/** The feed area. */
export function calendarFeedAreaLayer() {
  return Layer.mergeAll(CalendarFeedTokens.layer, CalendarFeed.layer);
}
