/**
 * Client-side permission checks.
 *
 * These only decide what to SHOW — the API is the real gate (`requireHouseholdRole`), and
 * every screen still handles a 403 gracefully. When the role is unknown (session still
 * loading) the UI stays optimistic rather than flashing a disabled state.
 */
import { hasAtLeast } from "@/lib/permissions";
import type { HouseholdRole } from "@toon/shared";

/**
 * Recipes, collections and tags may be edited by their author or by an admin/owner
 * (docs/API.md → "group:member (author or admin)").
 */
export function canModifyOwn(
  role: HouseholdRole | null | undefined,
  userId: string | null | undefined,
  createdBy: string | null | undefined,
): boolean {
  if (userId && createdBy && userId === createdBy) return true;
  return hasAtLeast(role, "admin");
}
