/**
 * The calendar module's waste routes (plan m8 section 5.2, lane api-waste): the `HttpApi` of `waste.api.ts` and its
 * handler layer.
 *
 * FOUNDATION STUB (M8-T02): the lane api-waste (M8-T12) replaces this file; until then it contributes no route. Both
 * functions are hoisted and read lazily by `./index.ts`.
 */
import { Layer } from "effect";
import type { AnyHttpApi } from "../../types.ts";

/** The api-waste lane's household APIs. */
export function calendarWasteApis(): ReadonlyArray<AnyHttpApi> {
  return [];
}

/** The handlers of every group of `calendarWasteApis()`. */
export function calendarWasteHandlers() {
  // The stub provides nothing. `Layer`'s output is contravariant, so `Layer.empty` (output `never`) would not fit the
  // manifest's `handlers: Layer<any, never, any>`; `unknown` does. The real layer (M8-T12) needs no cast.
  return Layer.empty as Layer.Layer<unknown>;
}
