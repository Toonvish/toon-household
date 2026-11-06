/**
 * The calendar module's entries, occurrences and resources routes (plan m8 section 5.2, lane api-core): the
 * `HttpApi`s of `entries.api.ts`, `occurrences.api.ts` and `resources.api.ts` and their handler layer.
 *
 * FOUNDATION STUB (M8-T02): the lane api-core (M8-T06) replaces this file; until then it contributes no route. Both
 * functions are hoisted and read lazily by `./index.ts` (the API import cycle, CLAUDE.md "Middleware, APIs and
 * handler layers are TDZ-safe").
 */
import { Layer } from "effect";
import type { AnyHttpApi } from "../../types.ts";

/** The api-core lane's household APIs. */
export function calendarCoreApis(): ReadonlyArray<AnyHttpApi> {
  return [];
}

/** The handlers of every group of `calendarCoreApis()`. */
export function calendarCoreHandlers() {
  // The stub provides nothing. `Layer`'s output is contravariant, so `Layer.empty` (output `never`) would not fit the
  // manifest's `handlers: Layer<any, never, any>`; `unknown` does. The real layer (M8-T06) needs no cast.
  return Layer.empty as Layer.Layer<unknown>;
}
