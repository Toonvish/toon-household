/**
 * The calendar module's HTTP surface (plan m8 P1, P27, section 5.2; docs/EFFECT.md E7): the `HttpApi`s and handler
 * layers of the two lanes, merged for the manifest's `householdApi` (`ModuleHttpApi`):
 *
 *   calendarHouseholdApis()      calendarCoreApis() (entries, occurrences, resources; `./core.index.ts`)
 *                                + calendarWasteApis() (waste; `./waste.index.ts`), each built with
 *                                householdModuleApi("calendar", …): /api/households/:householdId/calendar/…, behind
 *                                ApiErrorBoundary -> RequireSession -> RequireHouseholdMember -> RequireModule; every
 *                                group attaches chain(RequireVerifiedEmail) itself
 *   calendarHouseholdHandlers()  the two lanes' handler layers merged
 *
 * No user API: the calendar has no user-scoped routes (ADR 0016). The lists are computed in hoisted functions and read
 * by the manifest lazily (a getter, `Layer.suspend`), never at module scope (the import cycle). This file is the
 * foundation's; the lanes edit only their own `*.index.ts`.
 */
import { Layer } from "effect";
import type { AnyHttpApi } from "../../types.ts";
import { calendarCoreApis, calendarCoreHandlers } from "./core.index.ts";
import { calendarWasteApis, calendarWasteHandlers } from "./waste.index.ts";

/** The calendar module's household APIs: the core lane's, then the waste lane's. */
export function calendarHouseholdApis(): ReadonlyArray<AnyHttpApi> {
  return [...calendarCoreApis(), ...calendarWasteApis()];
}

/** The handlers of every group of `calendarHouseholdApis()`. */
export function calendarHouseholdHandlers() {
  return Layer.mergeAll(calendarCoreHandlers(), calendarWasteHandlers());
}
