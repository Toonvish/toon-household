/**
 * Client-side permission checks.
 *
 * These only decide what to SHOW — the API is the real gate (`requireHouseholdRole`), and
 * every screen still handles a 403 gracefully. When the role is unknown (session still
 * loading) the UI stays optimistic rather than flashing a disabled state.
 */
import type { HouseholdRole } from "@toon/shared";
import { roleAtLeast } from "@toon/shared";

export function hasAtLeast(role: HouseholdRole | null | undefined, required: HouseholdRole): boolean {
  if (!role) return false;
  return roleAtLeast(role, required);
}
