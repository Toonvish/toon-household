/**
 * The households services tier (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P3):
 * `Layer.mergeAll(HouseholdInvites.layer, AuthBootstrap.layer).pipe(Layer.provideMerge(Households.layer))`, because
 * both need `Households` and so sit in the outer step. `Households` itself needs `Database`, `HouseholdModules` and
 * `Users` of the base tier, `HouseholdInvites` also `AppConfig` and the `Mailer`; those requirements travel outward
 * to `src/core/services/layer.ts` and `src/runtime.ts`.
 *
 * Import cycle (CLAUDE.md "API import cycle"): a hoisted function only; nothing runs at import.
 */
import { Layer } from "effect";
import { AuthBootstrap } from "../auth/bootstrap.ts";
import { Households } from "./households.service.ts";
import { HouseholdInvites } from "./invites.service.ts";

export function householdServicesLayer() {
  return Layer.mergeAll(HouseholdInvites.layer, AuthBootstrap.layer).pipe(Layer.provideMerge(Households.layer));
}
