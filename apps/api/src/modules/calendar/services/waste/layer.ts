/**
 * The calendar module's waste area (plan m8 P27): `WastePdfText` and `WasteFlyerFetch` (leaves), then `CalendarWaste`.
 *
 * FOUNDATION STUB (M8-T02): the lane api-waste (M8-T12) replaces this file with the real area; until then it provides
 * nothing. The function and type names are the contract `../../layer.ts` composes.
 */
import { Layer } from "effect";

/** Every service `calendarWasteAreaLayer()` provides (api-waste: the three waste services). */
export type CalendarWasteAreaServices = never;

export function calendarWasteAreaLayer() {
  return Layer.empty;
}
