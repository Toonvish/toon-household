/**
 * OWNER: auth agent.
 *
 * Builds the `AuthSessionResponse` / `MeResponse` payload: the user, every household
 * they belong to (with role + counts + enabled modules) and the effective active
 * household.
 *
 * NOTE: `GET /api/households` (households service) returns the same `HouseholdWithRole`
 * shape; both read it through `listHouseholdsForUser`, so the two stay in step.
 *
 * The `AuthBootstrap` service (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P2, P3) stands on
 * `Households` and `Users`; it has no legacy bridge (the auth routes use the service).
 */
import type { AuthSessionResponse, HouseholdWithRole } from "@toon/shared";
import { Context, Effect, Layer } from "effect";
import type { UserRow } from "../../../db/schema.ts";
import type { DatabaseError, Unauthorized } from "../../../lib/errors.ts";
import { Households } from "../households/households.service.ts";
import { Users } from "./users.ts";

/** The bootstrap payload of register, login and `GET /api/auth/me`. */
export class AuthBootstrap extends Context.Service<
  AuthBootstrap,
  {
    /** Every household of a user, alphabetically, with role, member count and enabled modules. */
    readonly loadUserHouseholds: (userId: string) => Effect.Effect<HouseholdWithRole[], DatabaseError>;
    /**
     * The one bootstrap payload used by register, login and GET /api/auth/me.
     * A stale `users.active_household_id` (household deleted, membership removed) is healed
     * here: it falls back to the first household and is persisted.
     */
    readonly buildAuthSession: (user: UserRow) => Effect.Effect<AuthSessionResponse, Unauthorized | DatabaseError>;
  }
>()("toon/api/core/services/auth/bootstrap/AuthBootstrap") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const households = yield* Households;
      const usersService = yield* Users;

      const loadUserHouseholds = Effect.fn("AuthBootstrap.loadUserHouseholds")(function* (userId: string) {
        return yield* households.listHouseholdsForUser(userId);
      });

      const buildAuthSession = Effect.fn("AuthBootstrap.buildAuthSession")(function* (user: UserRow) {
        const userHouseholds = yield* loadUserHouseholds(user.id);
        const stored = user.activeHouseholdId ?? null;
        const isValid = stored !== null && userHouseholds.some((household) => household.id === stored);
        const effective = isValid ? stored : (userHouseholds[0]?.id ?? null);

        if (effective !== stored) {
          yield* usersService.setActiveHousehold(user.id, effective);
        }

        return {
          user: yield* usersService.userDto(user, effective),
          households: userHouseholds,
          activeHouseholdId: effective,
        } satisfies AuthSessionResponse;
      });

      return AuthBootstrap.of({ loadUserHouseholds, buildAuthSession });
    }),
  );
}
