/**
 * Household invites.
 *
 * `POST /api/households/:householdId/invites` mails the link AND returns it. The mail is a
 * convenience; the returned `inviteUrl` is the source of truth, because a
 * self-hosted install may well have no MAIL_TRANSPORT at all (then the
 * ConsoleMailer logs it) and because a provider outage must not stop an admin from
 * inviting somebody over WhatsApp. `mailDelivery` in the response says which of the
 * three happened, so the UI can tell "forward it yourself" apart from "your relay
 * is broken" instead of calling both a success.
 *
 * The token IS the secret, so anybody holding the link may accept it (a person
 * often registers with a different address than the one they were invited with).
 */
import type {
  AcceptInviteResponse,
  HouseholdInvite,
  HouseholdInviteListResponse,
  HouseholdInviteResponse,
  HouseholdRole,
  InvitePreviewResponse,
  PaginationQuery,
} from "@toon/shared";
import { type Locale, isLocale } from "@toon/shared";
import { type SQL, and, count, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "../../../db/client.ts";
import { householdInvites, householdMembers, households, users } from "../../../db/schema.ts";
import { env } from "../../../env.ts";
import { ApiError } from "../../../lib/errors.ts";
import { toIso } from "../../../lib/http.ts";
import { inviteMail, mailDeliveryOf, trySendMail } from "../mail/index.ts";
import { getHouseholdWithRole, getMember, isPlaceholderMember } from "./households.service.ts";
import { toHouseholdInvite, toInvitableRole, toInviteStatus } from "./mappers.ts";
import { toHouseholdRole } from "./membership.ts";
import { type DbLike, eqFolded, nowMs, withTransaction } from "./support.ts";

/** Invite lifetime — docs/API.md: 32-byte token, 14 days. */
export const INVITE_TTL_DAYS = 14;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

/** 32 random bytes, URL-safe base64 (43 chars). */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** `${WEB_ORIGIN}/invite/<token>` — the link the admin copies. */
export function buildInviteUrl(token: string): string {
  const origin = env.webOrigins[0] ?? "";
  return `${origin.replace(/\/+$/, "")}/invite/${token}`;
}

/* -------------------------------------------------------------------------- */
/* admin side                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Creates an invite. Any older pending invite for the same (household, e-mail) is
 * revoked in the same transaction so only the newest link works.
 *
 * A CLAIM invite (`claimsUserId`, ADR 0006 decision 3, toon-finance `createInvite`) names a
 * placeholder member: `404` for a user who is not a member of this household, `409
 * member_has_account` for a member who already has an account (a link that could write a
 * password onto a real account must not exist even for a second). Its role is always
 * `member`; older pending claim invites of the same placeholder are revoked in the same
 * transaction (one open claim link per placeholder); it is mailed only when an `email` was
 * given, otherwise the response carries `emailSent: false` and no `mailDelivery`.
 */
export async function createInvite(
  db: Database,
  householdId: string,
  invitedBy: string,
  input: { email?: string | undefined; role: "admin" | "member"; claimsUserId?: string | undefined },
): Promise<HouseholdInviteResponse> {
  const claimsUserId = input.claimsUserId ?? null;
  const email = input.email ?? null;

  if (claimsUserId !== null) {
    await getMember(db, householdId, claimsUserId);
    if (!(await isPlaceholderMember(db, householdId, claimsUserId))) {
      throw ApiError.conflict("member_has_account", "server.household.memberHasAccount");
    }
  } else {
    if (email === null) throw ApiError.badRequest();
    const alreadyMember = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(and(eq(householdMembers.householdId, householdId), eqFolded(users.email, email)))
      .limit(1);
    if (alreadyMember.length > 0) {
      throw ApiError.conflict("conflict", "server.group.alreadyMember");
    }
  }

  const timestamp = nowMs();
  const id = crypto.randomUUID();
  const token = generateInviteToken();
  // One open link per address for a plain invite (R's rule), one per placeholder for a claim
  // invite; a plain invite never revokes a claim link that happens to carry the same address.
  const supersedes: SQL | undefined =
    claimsUserId !== null
      ? eq(householdInvites.claimsUserId, claimsUserId)
      : and(isNull(householdInvites.claimsUserId), eqFolded(householdInvites.email, email ?? ""));

  await withTransaction(db, async (tx) => {
    await tx
      .update(householdInvites)
      .set({ status: "revoked" })
      .where(
        and(
          eq(householdInvites.householdId, householdId),
          eq(householdInvites.status, "pending"),
          supersedes,
        ),
      );
    await tx.insert(householdInvites).values({
      id,
      householdId,
      email,
      role: claimsUserId !== null ? "member" : input.role,
      token,
      status: "pending",
      invitedBy,
      expiresAt: timestamp + INVITE_TTL_MS,
      createdAt: timestamp,
      claimsUserId,
    });
  });

  const invite = await loadInvite(db, { inviteId: id });
  const inviteUrl = buildInviteUrl(token);

  // A claim link without an address is handed over by the admin (copy, share); nothing to mail.
  if (email === null) return { invite, inviteUrl, emailSent: false };

  // AFTER the row is committed, and never able to fail the request: an invite that
  // exists but was not mailed is useful (copy the link); a 500 that leaves a
  // committed invite behind is not. trySendMail() swallows and logs.
  const [household] = await db
    .select({ name: households.name })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);
  // The invitee usually has no account (and so no locale preference) yet, so the
  // INVITER's own `users.locale` is the closest proxy — a household invites its
  // own household (docs/i18n.md §8).
  const [inviter] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, invitedBy)).limit(1);
  const locale: Locale = isLocale(inviter?.locale) ? inviter.locale : env.defaultLocale;
  const sent = await trySendMail(
    inviteMail({
      to: email,
      groupName: household?.name ?? "Rezepte",
      invitedByName: invite.invitedByName,
      inviteUrl,
      expiresInDays: INVITE_TTL_DAYS,
      locale,
    }),
  );

  // `sent.delivered` is TRUE for the ConsoleMailer (it logged the link, which is
  // all it promises), so it cannot be `emailSent` on its own — that is what made
  // the invite panel announce a mail on an install with no MAIL_TRANSPORT.
  const mailDelivery = mailDeliveryOf(sent);
  return { invite, inviteUrl, emailSent: mailDelivery === "sent", mailDelivery };
}

/** One invite in contract shape, resolved by id or token. */
async function loadInvite(
  db: DbLike,
  selector: { inviteId?: string; token?: string },
): Promise<HouseholdInvite> {
  const where = selector.inviteId
    ? eq(householdInvites.id, selector.inviteId)
    : eq(householdInvites.token, selector.token ?? "");
  const [row] = await db
    .select({ invite: householdInvites, invitedByName: users.name })
    .from(householdInvites)
    .innerJoin(users, eq(users.id, householdInvites.invitedBy))
    .where(where)
    .limit(1);
  if (!row) throw ApiError.notFound("server.invite.notFound");
  return toHouseholdInvite(row.invite, row.invitedByName);
}

/** Paginated invite list for admins (tokens included so links can be re-copied). */
export async function listInvites(
  db: DbLike,
  householdId: string,
  pagination: PaginationQuery,
): Promise<HouseholdInviteListResponse> {
  const rows = await db
    .select({ invite: householdInvites, invitedByName: users.name })
    .from(householdInvites)
    .innerJoin(users, eq(users.id, householdInvites.invitedBy))
    .where(eq(householdInvites.householdId, householdId))
    .orderBy(desc(householdInvites.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  const [totals] = await db
    .select({ value: count() })
    .from(householdInvites)
    .where(eq(householdInvites.householdId, householdId));

  return {
    items: rows.map((row) => toHouseholdInvite(row.invite, row.invitedByName)),
    total: Number(totals?.value ?? 0),
    limit: pagination.limit,
    offset: pagination.offset,
  };
}

/** Revokes a pending invite (idempotent for already revoked ones). */
export async function revokeInvite(db: DbLike, householdId: string, inviteId: string): Promise<void> {
  const [row] = await db
    .select({ id: householdInvites.id, status: householdInvites.status })
    .from(householdInvites)
    .where(and(eq(householdInvites.id, inviteId), eq(householdInvites.householdId, householdId)))
    .limit(1);
  if (!row) throw ApiError.notFound("server.invite.notFound");
  if (row.status === "accepted") {
    throw ApiError.conflict("conflict", "server.invite.alreadyAccepted");
  }
  await db.update(householdInvites).set({ status: "revoked" }).where(eq(householdInvites.id, inviteId));
}

/* -------------------------------------------------------------------------- */
/* invitee side                                                               */
/* -------------------------------------------------------------------------- */

interface InviteContext {
  invite: typeof householdInvites.$inferSelect;
  householdName: string;
  invitedByName: string;
}

/** Loads an invite by token and rejects unusable ones (404/409). */
async function loadUsableInvite(db: DbLike, token: string): Promise<InviteContext> {
  const [row] = await db
    .select({ invite: householdInvites, householdName: households.name, invitedByName: users.name })
    .from(householdInvites)
    .innerJoin(households, eq(households.id, householdInvites.householdId))
    .innerJoin(users, eq(users.id, householdInvites.invitedBy))
    .where(eq(householdInvites.token, token))
    .limit(1);

  if (!row) throw ApiError.notFound("server.invite.invalid");
  const status = toInviteStatus(row.invite.status, row.invite.expiresAt);
  if (status === "revoked") throw ApiError.notFound("server.invite.revoked");
  if (status === "expired") {
    throw ApiError.conflict("invite_expired", "server.invite.expired");
  }
  return { invite: row.invite, householdName: row.householdName, invitedByName: row.invitedByName };
}

/** Public landing-page preview ("Du wurdest zu <Gruppe> eingeladen"). */
export async function previewInvite(db: DbLike, token: string): Promise<InvitePreviewResponse> {
  const { invite, householdName, invitedByName } = await loadUsableInvite(db, token);
  return {
    householdName,
    invitedByName,
    // As stored: NULL for a claim invite created without an address (ADR 0006).
    email: invite.email,
    role: toInvitableRole(invite.role),
    status: toInviteStatus(invite.status, invite.expiresAt),
    expiresAt: toIso(invite.expiresAt),
    // The placeholder's name (ADR 0006): what the landing page says the account is created for.
    claimsDisplayName: await claimsDisplayNameOf(db, invite.claimsUserId),
  };
}

/** `users.name` of the user a claim invite hands over; `null` for a plain invite. */
async function claimsDisplayNameOf(db: DbLike, claimsUserId: string | null): Promise<string | null> {
  if (claimsUserId === null) return null;
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, claimsUserId)).limit(1);
  return row?.name ?? null;
}

/**
 * Accepts an invite: the caller becomes a member with the invited role, the
 * invite is marked accepted and the household becomes the caller's active household.
 * Accepting twice is idempotent when the caller already is a member.
 */
export async function acceptInvite(
  db: Database,
  userId: string,
  token: string,
): Promise<AcceptInviteResponse> {
  const { invite } = await loadUsableInvite(db, token);

  const [existing] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, invite.householdId), eq(householdMembers.userId, userId)))
    .limit(1);

  const timestamp = nowMs();

  // A CLAIM invite is redeemed only by registering onto the placeholder (ADR 0006 decision 3,
  // toon-finance `acceptInvite`): an existing account accepting it would burn the link or merge
  // two user ids, neither is a feature. The one caller let through is the claimed user itself,
  // replaying its accept. A spent claim link is no capability for anyone else (F gotcha 55).
  if (invite.claimsUserId !== null && invite.claimsUserId !== userId) {
    if (invite.status === "accepted") throw ApiError.notFound("server.invite.alreadyUsed");
    throw ApiError.conflict("invite_claim_requires_register", "server.invite.claimRequiresRegister");
  }

  if (!existing && invite.status === "accepted") {
    throw ApiError.notFound("server.invite.alreadyUsed");
  }

  const role: HouseholdRole = existing ? toHouseholdRole(existing.role) : toInvitableRole(invite.role);

  await withTransaction(db, async (tx) => {
    if (!existing) {
      await tx.insert(householdMembers).values({
        id: crypto.randomUUID(),
        householdId: invite.householdId,
        userId,
        role,
        createdAt: timestamp,
      });
    }
    await tx
      .update(householdInvites)
      .set({ status: "accepted", acceptedBy: userId, acceptedAt: timestamp })
      .where(eq(householdInvites.id, invite.id));
    await tx
      .update(users)
      .set({ activeHouseholdId: invite.householdId, updatedAt: timestamp })
      .where(eq(users.id, userId));
  });

  const [household, member] = await Promise.all([
    getHouseholdWithRole(db, invite.householdId, role),
    getMember(db, invite.householdId, userId),
  ]);

  return { household, member };
}
