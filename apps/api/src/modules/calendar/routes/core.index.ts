/**
 * The calendar module's entries, occurrences and resources routes (plan m8 section 5.2, lane api-core): the `HttpApi`s
 * of `entries.api.ts`, `occurrences.api.ts` and `resources.api.ts` (each built with `householdModuleApi("calendar", …)`,
 * each group behind `chain(RequireVerifiedEmail)`) and their handler layers.
 *
 * Both functions are hoisted and read lazily by `./index.ts` (the API import cycle, CLAUDE.md "Middleware, APIs and
 * handler layers are TDZ-safe"); the services are yielded inside the handlers.
 */
import { Layer } from "effect";
import type { AnyHttpApi } from "../../types.ts";
import { CalendarEntriesApi } from "./entries.api.ts";
import { calendarEntriesHandlers } from "./entries.ts";
import { CalendarOccurrencesApi } from "./occurrences.api.ts";
import { calendarOccurrencesHandlers } from "./occurrences.ts";
import { CalendarResourcesApi } from "./resources.api.ts";
import { calendarResourcesHandlers } from "./resources.ts";

/** The api-core lane's household APIs. */
export function calendarCoreApis(): ReadonlyArray<AnyHttpApi> {
  return [CalendarOccurrencesApi, CalendarEntriesApi, CalendarResourcesApi];
}

/** The handlers of every group of `calendarCoreApis()`. */
export function calendarCoreHandlers() {
  return Layer.mergeAll(calendarOccurrencesHandlers, calendarEntriesHandlers, calendarResourcesHandlers);
}
