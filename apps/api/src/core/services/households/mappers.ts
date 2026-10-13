/**
 * Row -> contract mappers for households, members and invites.
 * Timestamps become ISO strings here and nowhere else.
 */
import type {
  Household,
  HouseholdInvite,
  HouseholdMember,
  HouseholdRole,
  HouseholdWithRole,
  InvitableRole,
  InviteStatus,
  PublicUser,
} from "@toon/shared";
import type { HouseholdInviteRow, HouseholdMemberRow, HouseholdRow, UserRow } from "../../../db/schema.ts";
import { toIso, toIsoOrNull } from "../../../lib/http.ts";
import { signUploadUrl } from "../../../lib/uploadUrls.ts";
import { toHouseholdRole } from "./membership.ts";

export function toHousehold(row: HouseholdRow): Household {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // Signed on the way out — see toRecipe() and lib/uploadUrls.ts.
    imageUrl: signUploadUrl(row.imageUrl),
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function toHouseholdWithRole(
  row: HouseholdRow,
  role: HouseholdRole,
  memberCount: number,
  modules: readonly string[],
): HouseholdWithRole {
  return { ...toHousehold(row), role, memberCount, modules: [...modules] };
}

export function toPublicUser(row: Pick<UserRow, "id" | "name" | "email" | "avatarUrl">): PublicUser {
  return { id: row.id, name: row.name, email: row.email, avatarUrl: signUploadUrl(row.avatarUrl) };
}

export function toHouseholdMember(
  row: HouseholdMemberRow,
  user: Pick<UserRow, "id" | "name" | "email" | "avatarUrl">,
): HouseholdMember {
  return {
    id: row.id,
    householdId: row.householdId,
    userId: row.userId,
    role: toHouseholdRole(row.role),
    createdAt: toIso(row.createdAt),
    user: toPublicUser(user),
  };
}

/** Invites can only ever hand out admin/member (never owner). */
export function toInvitableRole(value: string): InvitableRole {
  return value === "admin" ? "admin" : "member";
}

export function toInviteStatus(value: string, expiresAt: number, now = Date.now()): InviteStatus {
  if (value === "accepted" || value === "revoked") return value;
  if (value === "expired" || expiresAt <= now) return "expired";
  return "pending";
}

export function toHouseholdInvite(row: HouseholdInviteRow, invitedByName: string): HouseholdInvite {
  return {
    id: row.id,
    householdId: row.householdId,
    email: row.email,
    role: toInvitableRole(row.role),
    token: row.token,
    status: toInviteStatus(row.status, row.expiresAt),
    invitedBy: row.invitedBy,
    invitedByName,
    expiresAt: toIso(row.expiresAt),
    createdAt: toIso(row.createdAt),
    acceptedAt: toIsoOrNull(row.acceptedAt),
  };
}
