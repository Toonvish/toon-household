/**
 * The core services tier of the `AppLayer` (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P3).
 *
 * `coreServicesLayer()` puts the auth and households tiers over the base tier: `Layer.mergeAll` feeds no member's
 * output into another member's input, so a service that needs a sibling of the same step sits in an OUTER step
 * (`Layer.provideMerge`), never beside it. Requirements left open here (`Database`, `AppConfig`, …) travel outward
 * to `src/runtime.ts`, which satisfies them from `infraLayer()`.
 *
 * E2-T03 stubs every tier with `Layer.empty`; E2-T05 to E2-T09 fill them (P3 spells out each final form).
 *
 * Import cycle (CLAUDE.md "API import cycle"): hoisted functions only; nothing runs at import.
 */
import { Layer } from "effect";
import { authServicesLayer } from "./auth/layer.ts";
import { householdServicesLayer } from "./households/layer.ts";

/** The core services: the auth and households tiers over the base tier. */
export function coreServicesLayer() {
  return Layer.mergeAll(authServicesLayer(), householdServicesLayer()).pipe(Layer.provideMerge(baseServicesLayer()));
}

/** The base tier (E2-T05 `UploadReferences`; E2-T06 `HouseholdModules`, `Passwords`, `Users`; E2-T07 the rest). */
export function baseServicesLayer() {
  return Layer.empty;
}
