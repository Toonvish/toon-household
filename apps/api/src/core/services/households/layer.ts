/**
 * The households services tier (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P3). A stub until
 * E2-T09: then `Layer.mergeAll(HouseholdInvites.layer, AuthBootstrap.layer).pipe(Layer.provideMerge(
 * Households.layer))` (both need `Households`, so it sits in the outer step).
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";

export function householdServicesLayer() {
  return Layer.empty;
}
