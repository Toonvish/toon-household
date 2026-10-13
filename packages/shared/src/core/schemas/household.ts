import { z } from "zod";

/**
 * Household DTOs (the renamed GroupSchema family) are ported by M1 (SPEC D1).
 */

/** owner > admin > member. Exactly one owner per household at any time. */
export const HouseholdRoleSchema = z.enum(["owner", "admin", "member"]);
export type HouseholdRole = z.infer<typeof HouseholdRoleSchema>;

/** Roles that can be handed out in an invite (never "owner"). */
export const InvitableRoleSchema = z.enum(["admin", "member"]);
export type InvitableRole = z.infer<typeof InvitableRoleSchema>;

export const ROLE_RANK: Record<HouseholdRole, number> = { member: 1, admin: 2, owner: 3 };

/** True when `role` satisfies `required` (owner satisfies admin, etc.). */
export function roleAtLeast(role: HouseholdRole, required: HouseholdRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
