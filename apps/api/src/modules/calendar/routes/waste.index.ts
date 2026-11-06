/**
 * The calendar module's waste routes (plan m8 section 5.2, lane api-waste): the `HttpApi` of `waste.api.ts` and its
 * handler layer (`waste.ts`). Both functions are hoisted and read lazily by `./index.ts` (the API import cycle, CLAUDE.md
 * "Middleware, APIs and handler layers are TDZ-safe").
 */
import type { AnyHttpApi } from "../../types.ts";
import { calendarWasteHandlersLayer } from "./waste.ts";
import { CalendarWasteApi } from "./waste.api.ts";

/** The api-waste lane's household APIs. */
export function calendarWasteApis(): ReadonlyArray<AnyHttpApi> {
  return [CalendarWasteApi];
}

/** The handlers of every group of `calendarWasteApis()`. */
export function calendarWasteHandlers() {
  return calendarWasteHandlersLayer;
}
