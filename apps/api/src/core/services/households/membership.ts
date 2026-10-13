/**
 * Household membership lookups and role assertions.
 *
 * The request-level check lives in the auth agent's `requireHouseholdRole`
 * middleware; the helpers here cover the finer-grained rules the services need
 * on top of it (ownership transfer, last-owner protection, author-or-admin).
 */
import type { HouseholdRole } from "@toon/shared";
import { roleAtLeast } from "@toon/shared";
import { and, eq } from "drizzle-orm";
import { householdMembers } from "../../../db/schema.ts";
import { ApiError } from "../../../lib/errors.ts";
import type { Membership } from "../../../lib/types.ts";
import type { DbLike } from "./support.ts";

/** Parses a role column value; unknown values degrade to the weakest role. */
export function toHouseholdRole(value: string): HouseholdRole {
  return value === "owner" || value === "admin" ? value : "member";
}

/** Throws 403 unless `membership.role` satisfies `required`. */
export function assertRole(membership: Membership, required: HouseholdRole): void {
  if (!roleAtLeast(membership.role, required)) {
    throw ApiError.forbidden(required === "owner" ? "server.group.ownerOnly" : "server.group.adminOnly");
  }
}

/**
 * Author or admin+ may change/delete a row the household owns.
 *
 * The one definition of that rule. Recipes, collections and shopping lists each
 * used to inline it, which is three places to keep in step the day it grows an
 * exception — and a permission rule that has silently diverged between two
 * resources is not the kind of bug a test tends to be looking for.
 */
export function assertCanModifyOwned(membership: Membership, row: { createdBy: string }): void {
  if (row.createdBy === membership.userId) return;
  assertRole(membership, "admin");
}

/** Number of owners in a household — the guard behind the `last_owner` conflict. */
export async function countOwners(db: DbLike, householdId: string): Promise<number> {
  const rows = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.role, "owner")));
  return rows.length;
}
