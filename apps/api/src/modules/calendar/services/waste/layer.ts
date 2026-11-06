/**
 * The calendar module's waste area (plan m8 P27): `WastePdfText` and `WasteFlyerFetch` (leaves; `WasteFlyerFetch.layer`
 * provides `FetchHttpClient.layer` itself, `HttpClient` is no `ModuleRequirements` service).
 *
 * The function and type names are the contract `../../layer.ts` composes. Hoisted, nothing runs at import.
 */
import { Layer } from "effect";
import { WasteFlyerFetch } from "./fetch.ts";
import { WastePdfText } from "./pdf-text.ts";

/** Every service `calendarWasteAreaLayer()` provides. */
export type CalendarWasteAreaServices = WastePdfText | WasteFlyerFetch;

/** The waste area. */
export function calendarWasteAreaLayer() {
  return Layer.mergeAll(WastePdfText.layer, WasteFlyerFetch.layer);
}
