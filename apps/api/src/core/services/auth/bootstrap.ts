/**
 * OWNER: auth agent.
 *
 * Builds the `AuthSessionResponse` / `MeResponse` payload: the user, every household
 * they belong to (with role + counts + enabled modules) and the effective active
 * household.
 *
 * NOTE: `GET /api/households` (households service) returns the same `HouseholdWithRole`
 * shape; both read it through `listHouseholdsForUser`, so the two stay in step.
 */
import type { AuthSessionResponse, HouseholdWithRole } from "@toon/shared";
import type { Database } from "../../../db/client.ts";
import type { UserRow } from "../../../db/schema.ts";
import { listHouseholdsForUser } from "../households/households.service.ts";
import { setActiveHousehold, toUserDto } from "./users.ts";

/** Every household of a user, alphabetically, with role, member count and enabled modules. */
export async function loadUserHouseholds(
  database: Database,
  userId: string,
): Promise<HouseholdWithRole[]> {
  return listHouseholdsForUser(database, userId);
}

/**
 * The one bootstrap payload used by register, login and GET /api/auth/me.
 * A stale `users.active_household_id` (household deleted, membership removed) is healed
 * here: it falls back to the first household and is persisted.
 */
export async function buildAuthSession(
  database: Database,
  user: UserRow,
): Promise<AuthSessionResponse> {
  const userHouseholds = await loadUserHouseholds(database, user.id);
  const stored = user.activeHouseholdId ?? null;
  const isValid = stored !== null && userHouseholds.some((household) => household.id === stored);
  const effective = isValid ? stored : (userHouseholds[0]?.id ?? null);

  if (effective !== stored) {
    await setActiveHousehold(database, user.id, effective);
  }

  return {
    user: toUserDto(user, effective),
    households: userHouseholds,
    activeHouseholdId: effective,
  };
}
