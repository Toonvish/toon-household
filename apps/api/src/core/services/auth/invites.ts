/**
 * OWNER: auth agent.
 *
 * Redeeming a household invite token. Used by
 *   - POST /api/auth/register            (inviteToken in the body)
 *   - POST /api/households/invites/accept (households service — may import this)
 *
 * The token is the capability: whoever holds the link may join with the role it
 * carries. The invited e-mail is informational (it is what the UI shows), it is
 * deliberately NOT enforced, otherwise forwarding an invite would break.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.ts";
import { type HouseholdInviteRow, householdInvites, householdMembers } from "../../../db/schema.ts";
import { ApiError } from "../../../lib/errors.ts";

/** Invite links are valid for 14 days (docs/API.md). */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Random URL-safe invite token (32 bytes). */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** Raw invite row for a token, or undefined. */
export async function findInviteByToken(
  database: Database,
  token: string,
): Promise<HouseholdInviteRow | undefined> {
  if (token.length === 0 || token.length > 200) return undefined;
  const rows = await database
    .select()
    .from(householdInvites)
    .where(eq(householdInvites.token, token))
    .limit(1);
  return rows[0];
}

/**
 * Validates an invite for redemption.
 * 404 `invite_invalid` — unknown, revoked or already redeemed by someone else
 * 409 `invite_expired` — past `expires_at` (the row is flagged `expired`)
 */
export async function loadRedeemableInvite(
  database: Database,
  token: string,
): Promise<HouseholdInviteRow> {
  const invite = await findInviteByToken(database, token);
  if (!invite || invite.status === "revoked") {
    throw new ApiError(404, "invite_invalid", "server.invite.invalid");
  }
  if (invite.expiresAt <= Date.now()) {
    if (invite.status === "pending") {
      await database
        .update(householdInvites)
        .set({ status: "expired" })
        .where(eq(householdInvites.id, invite.id));
    }
    throw new ApiError(409, "invite_expired", "server.invite.expired");
  }
  if (invite.status === "expired") {
    throw new ApiError(409, "invite_expired", "server.invite.expired");
  }
  return invite;
}

export interface AcceptedInvite {
  invite: HouseholdInviteRow;
  householdId: string;
  memberId: string;
  role: "admin" | "member" | "owner";
  /** True when the user already was a member — accepting stays idempotent. */
  alreadyMember: boolean;
}

/**
 * Redeems an invite for `userId`, inserting the membership when needed.
 * Idempotent: calling it twice (or with a user who is already a member) succeeds
 * and reports `alreadyMember: true` without downgrading an existing role.
 */
export async function acceptInvite(
  database: Database,
  token: string,
  userId: string,
): Promise<AcceptedInvite> {
  const invite = await loadRedeemableInvite(database, token);

  const existing = await database
    .select()
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, invite.householdId), eq(householdMembers.userId, userId)))
    .limit(1);

  const now = Date.now();
  const current = existing[0];

  if (current) {
    if (invite.status === "pending") {
      await database
        .update(householdInvites)
        .set({ status: "accepted", acceptedBy: userId, acceptedAt: now })
        .where(eq(householdInvites.id, invite.id));
    }
    return {
      invite,
      householdId: invite.householdId,
      memberId: current.id,
      role: current.role as AcceptedInvite["role"],
      alreadyMember: true,
    };
  }

  // A pending invite may only be redeemed once.
  if (invite.status === "accepted") {
    throw new ApiError(404, "invite_invalid", "server.invite.alreadyUsed");
  }

  const role = invite.role === "admin" ? "admin" : "member";
  const memberId = crypto.randomUUID();
  await database.insert(householdMembers).values({
    id: memberId,
    householdId: invite.householdId,
    userId,
    role,
    createdAt: now,
  });
  await database
    .update(householdInvites)
    .set({ status: "accepted", acceptedBy: userId, acceptedAt: now })
    .where(eq(householdInvites.id, invite.id));

  return { invite, householdId: invite.householdId, memberId, role, alreadyMember: false };
}
