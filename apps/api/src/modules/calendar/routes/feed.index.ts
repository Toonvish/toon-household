/**
 * The calendar module's subscription-feed routes (plan m9 P2, P13; ADR 0017): the household-scoped management group
 * `calendar.feed` (`feed.api.ts`, built with `householdModuleApi("calendar", …)`, behind `chain(RequireVerifiedEmail)`)
 * and the PUBLIC group `calendar.feedPublic` (`feed-public.api.ts`, built with `publicModuleApi("calendar", …)`: the
 * boundary only, no session), with their handler layers.
 *
 * All four functions are hoisted and read lazily by `./index.ts` (the API import cycle, CLAUDE.md "Middleware, APIs and
 * handler layers are TDZ-safe"); the services are yielded inside the handlers.
 */
import type { AnyHttpApi } from "../../types.ts";
import { CalendarFeedPublicApi } from "./feed-public.api.ts";
import { calendarFeedPublicGroupHandlers } from "./feed-public.ts";
import { CalendarFeedApi } from "./feed.api.ts";
import { calendarFeedGroupHandlers } from "./feed.ts";

/** The management API (household-scoped). */
export function calendarFeedApis(): ReadonlyArray<AnyHttpApi> {
  return [CalendarFeedApi];
}

/** The handlers of `calendarFeedApis()`. */
export function calendarFeedHandlers() {
  return calendarFeedGroupHandlers;
}

/** The public feed API (no session; ADR 0017). */
export function calendarFeedPublicApis(): ReadonlyArray<AnyHttpApi> {
  return [CalendarFeedPublicApi];
}

/** The handlers of `calendarFeedPublicApis()`. */
export function calendarFeedPublicHandlers() {
  return calendarFeedPublicGroupHandlers;
}
