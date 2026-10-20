/**
 * The core services tier of the `AppLayer` (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P3).
 *
 * `coreServicesLayer()` puts the auth and households tiers over the base tier: `Layer.mergeAll` feeds no member's
 * output into another member's input, so a service that needs a sibling of the same step sits in an OUTER step
 * (`Layer.provideMerge`), never beside it. Requirements left open here (`Database`, `AppConfig`, …) travel outward
 * to `src/runtime.ts`, which satisfies them from `infraLayer()`.
 *
 * E2-T03 stubbed every tier with `Layer.empty`; E2-T05 to E2-T09 fill them (P3 spells out each final form). Since
 * E2-T06 the base tier is `Users` over `HouseholdModules`, `Passwords` and `UploadReferences` (`Users` needs
 * `HouseholdModules`, so it sits in the outer step). `CoreServices` names what this file provides; `src/runtime.ts`
 * adds it to `AppServices`.
 *
 * Import cycle (CLAUDE.md "API import cycle"): hoisted functions only; nothing runs at import.
 */
import { Layer } from "effect";
import { authServicesLayer } from "./auth/layer.ts";
import { Passwords } from "./auth/passwords.ts";
import { Users } from "./auth/users.ts";
import { householdServicesLayer } from "./households/layer.ts";
import { HouseholdModules } from "./households/modules.ts";
import { UploadReferences } from "./media/references.ts";

/** Every service `coreServicesLayer()` provides. */
export type CoreServices = UploadReferences | HouseholdModules | Passwords | Users;

/** The core services: the auth and households tiers over the base tier. */
export function coreServicesLayer() {
  return Layer.mergeAll(authServicesLayer(), householdServicesLayer()).pipe(Layer.provideMerge(baseServicesLayer()));
}

/** The base tier (E2-T05 `UploadReferences`; E2-T06 `HouseholdModules`, `Passwords`, `Users`; E2-T07 the rest). */
export function baseServicesLayer() {
  return Users.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(HouseholdModules.layer, Passwords.layer, UploadReferences.layer)),
  );
}
