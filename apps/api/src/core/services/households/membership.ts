/**
 * Household membership role checks.
 *
 * The request-level check lives in the auth agent's `requireHouseholdRole`
 * middleware; the helpers here cover the finer-grained rules the services need
 * on top of it (ownership transfer, last-owner protection, author-or-admin).
 *
 * `checkRole` and `checkCanModifyOwned` are service-free Effects (docs/EFFECT.md E7; plan
 * `docs/plans/e2-api-core-services.md` P1, P2): they read no database and no time, so the sync bridges
 * `assertRole` and `assertCanModifyOwned` that the recipe module keeps calling until E3 stay SYNCHRONOUS with a
 * `void` return type through `Effect.runSync`; a refusal throws the `Forbidden` itself. The owner counting guard
 * `countOwners` is a method of the `Households` service.
 */
import type { HouseholdRole } from "@toon/shared";
import { roleAtLeast } from "@toon/shared";
import { Effect } from "effect";
import { Forbidden } from "../../../lib/errors.ts";
import type { Membership } from "../../../lib/types.ts";

/** Parses a role column value; unknown values degrade to the weakest role. */
export function toHouseholdRole(value: string): HouseholdRole {
  return value === "owner" || value === "admin" ? value : "member";
}

/** Fails with 403 unless `membership.role` satisfies `required`. */
export const checkRole = Effect.fnUntraced(function* (
  membership: Membership,
  required: HouseholdRole,
): Effect.fn.Return<void, Forbidden> {
  if (!roleAtLeast(membership.role, required)) {
    return yield* new Forbidden({
      text: required === "owner" ? "server.group.ownerOnly" : "server.group.adminOnly",
    });
  }
});

/**
 * Author or admin+ may change/delete a row the household owns.
 *
 * The one definition of that rule. Recipes, collections and shopping lists each
 * used to inline it, which is three places to keep in step the day it grows an
 * exception — and a permission rule that has silently diverged between two
 * resources is not the kind of bug a test tends to be looking for.
 */
export const checkCanModifyOwned = Effect.fnUntraced(function* (
  membership: Membership,
  row: { createdBy: string },
): Effect.fn.Return<void, Forbidden> {
  if (row.createdBy === membership.userId) return;
  yield* checkRole(membership, "admin");
});

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

// Both stay SYNCHRONOUS with a `void` return type (plan e2 P1): `Effect.runSync` over a service-free effect throws
// the `Forbidden` refusal itself, as the old `throw ApiError.forbidden(...)` did.

/** Throws 403 unless `membership.role` satisfies `required`. Callers: `recipe/services/recipes/recipes.service.ts` (E3). */
export function assertRole(membership: Membership, required: HouseholdRole): void {
  Effect.runSync(checkRole(membership, required));
}

/** Callers: `recipe/services/recipes/{recipes,collections}.service.ts`, `shopping/lists.service.ts` (E3). */
export function assertCanModifyOwned(membership: Membership, row: { createdBy: string }): void {
  Effect.runSync(checkCanModifyOwned(membership, row));
}
