/**
 * The calendar module's HTTP surface (plan m8 P1, P27, section 5.2; docs/EFFECT.md E7): the `HttpApi`s and handler
 * layers of the two lanes, merged for the manifest's `householdApi` (`ModuleHttpApi`):
 *
 *   calendarHouseholdApis()      calendarCoreApis() (entries, occurrences, resources; `./core.index.ts`)
 *                                + calendarWasteApis() (waste; `./waste.index.ts`), each built with
 *                                householdModuleApi("calendar", …): /api/households/:householdId/calendar/…, behind
 *                                ApiErrorBoundary -> RequireSession -> RequireHouseholdMember -> RequireModule; every
 *                                group attaches chain(RequireVerifiedEmail) itself
 *                                + calendarFeedApis() (the member's subscription link, M9; `./feed.index.ts`)
 *   calendarHouseholdHandlers()  the handler layers of those lists merged
 *   calendarPublicApis()         calendarFeedPublicApis(): the subscription feed GET /api/calendar/feed/:file, built
 *                                with publicModuleApi("calendar", …): ApiErrorBoundary only, no session (ADR 0017)
 *   calendarPublicHandlers()     its handler layer
 *
 * No user API: the calendar has no user-scoped routes (ADR 0016). The lists are computed in hoisted functions and read
 * by the manifest lazily (a getter, `Layer.suspend`), never at module scope (the import cycle). This file is the
 * foundation's; the lanes edit only their own `*.index.ts`.
 */
import { Layer } from "effect";
import type { AnyHttpApi } from "../../types.ts";
import { calendarCoreApis, calendarCoreHandlers } from "./core.index.ts";
import {
  calendarFeedApis,
  calendarFeedHandlers,
  calendarFeedPublicApis,
  calendarFeedPublicHandlers,
} from "./feed.index.ts";
import { calendarWasteApis, calendarWasteHandlers } from "./waste.index.ts";

/** The calendar module's household APIs: the core lane's, the waste lane's, then the feed's management API (M9). */
export function calendarHouseholdApis(): ReadonlyArray<AnyHttpApi> {
  return [...calendarCoreApis(), ...calendarWasteApis(), ...calendarFeedApis()];
}

/** The handlers of every group of `calendarHouseholdApis()`. */
export function calendarHouseholdHandlers() {
  return Layer.mergeAll(calendarCoreHandlers(), calendarWasteHandlers(), calendarFeedHandlers());
}

/** The calendar module's public APIs (ADR 0017): the subscription feed. */
export function calendarPublicApis(): ReadonlyArray<AnyHttpApi> {
  return [...calendarFeedPublicApis()];
}

/** The handlers of every group of `calendarPublicApis()`. */
export function calendarPublicHandlers() {
  return calendarFeedPublicHandlers();
}
