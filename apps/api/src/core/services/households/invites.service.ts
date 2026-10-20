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
 *
 * The `HouseholdInvites` service (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P2, P7) reads the
 * current executor of `Database` on every call, takes its time from the `Clock`, sends the mail through
 * `Mailer.trySendMail` (never fails) and reads the household reads and the membership join through `Households`.
 * The service has no legacy bridge (the invite routes use it).
 */
import type {
  AcceptInviteResponse,
  HouseholdInviteListResponse,
  HouseholdInviteResponse,
  HouseholdRole,
  InvitePreviewResponse,
  PaginationQuery,
} from "@toon/shared";
import { type Locale, isLocale } from "@toon/shared";
import { type SQL, and, count, desc, eq, isNull } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { AppConfig } from "../../../config.ts";
import { Database } from "../../../db/database.ts";
import { householdInvites, householdMembers, households, users } from "../../../db/schema.ts";
import { env } from "../../../env.ts";
import { BadRequest, Conflict, type DatabaseError, NotFound } from "../../../lib/errors.ts";
import { toIso } from "../../../lib/http.ts";
import { inviteMail, mailDeliveryOf, MailerService } from "../mail/index.ts";
import { Households } from "./households.service.ts";
import { toHouseholdInvite, toInvitableRole, toInviteStatus } from "./mappers.ts";
import { toHouseholdRole } from "./membership.ts";
import { eqFolded } from "./support.ts";

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

/** `${origin}/invite/<token>` — the link the admin copies; `origin` is the first `WEB_ORIGIN` entry. */
function inviteUrlOf(origin: string | undefined, token: string): string {
  return `${(origin ?? "").replace(/\/+$/, "")}/invite/${token}`;
}

/** `${WEB_ORIGIN}/invite/<token>` — the link the admin copies. */
export function buildInviteUrl(token: string): string {
  return inviteUrlOf(env.webOrigins[0], token);
}

interface InviteContext {
  invite: typeof householdInvites.$inferSelect;
  householdName: string;
  invitedByName: string;
}

/** Household invites: creating, listing and revoking (admin side), previewing and accepting (invitee side). */
export class HouseholdInvites extends Context.Service<
  HouseholdInvites,
  {
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
    readonly createInvite: (
      householdId: string,
      invitedBy: string,
      input: { email?: string | undefined; role: "admin" | "member"; claimsUserId?: string | undefined },
    ) => Effect.Effect<HouseholdInviteResponse, BadRequest | Conflict | NotFound | DatabaseError>;
    /** Paginated invite list for admins (tokens included so links can be re-copied). */
    readonly listInvites: (
      householdId: string,
      pagination: PaginationQuery,
    ) => Effect.Effect<HouseholdInviteListResponse, DatabaseError>;
    /** Revokes a pending invite (idempotent for already revoked ones). */
    readonly revokeInvite: (
      householdId: string,
      inviteId: string,
    ) => Effect.Effect<void, Conflict | NotFound | DatabaseError>;
    /** Public landing-page preview ("Du wurdest zu <Gruppe> eingeladen"). */
    readonly previewInvite: (
      token: string,
    ) => Effect.Effect<InvitePreviewResponse, Conflict | NotFound | DatabaseError>;
    /**
     * Accepts an invite: the caller becomes a member with the invited role, the
     * invite is marked accepted and the household becomes the caller's active household.
     * Accepting twice is idempotent when the caller already is a member.
     */
    readonly acceptInvite: (
      userId: string,
      token: string,
    ) => Effect.Effect<AcceptInviteResponse, Conflict | NotFound | DatabaseError>;
  }
>()("toon/api/core/services/households/invites.service/HouseholdInvites") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const config = yield* AppConfig;
      const mailer = yield* MailerService;
      const householdsService = yield* Households;

      /** One invite in contract shape, resolved by id. */
      const loadInvite = Effect.fnUntraced(function* (inviteId: string) {
        const [row] = yield* database.use((db) =>
          db
            .select({ invite: householdInvites, invitedByName: users.name })
            .from(householdInvites)
            .innerJoin(users, eq(users.id, householdInvites.invitedBy))
            .where(eq(householdInvites.id, inviteId))
            .limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.invite.notFound" });
        const now = yield* Clock.currentTimeMillis;
        return toHouseholdInvite(row.invite, row.invitedByName, now);
      });

      const createInvite = Effect.fn("HouseholdInvites.createInvite")(function* (
        householdId: string,
        invitedBy: string,
        input: { email?: string | undefined; role: "admin" | "member"; claimsUserId?: string | undefined },
      ) {
        const claimsUserId = input.claimsUserId ?? null;
        const email = input.email ?? null;

        if (claimsUserId !== null) {
          yield* householdsService.getMember(householdId, claimsUserId);
          if (!(yield* householdsService.isPlaceholderMember(householdId, claimsUserId))) {
            return yield* new Conflict({ code: "member_has_account", text: "server.household.memberHasAccount" });
          }
        } else {
          if (email === null) return yield* new BadRequest();
          const alreadyMember = yield* database.use((db) =>
            db
              .select({ userId: householdMembers.userId })
              .from(householdMembers)
              .innerJoin(users, eq(users.id, householdMembers.userId))
              .where(and(eq(householdMembers.householdId, householdId), eqFolded(users.email, email)))
              .limit(1),
          );
          if (alreadyMember.length > 0) {
            return yield* new Conflict({ code: "conflict", text: "server.group.alreadyMember" });
          }
        }

        const timestamp = yield* Clock.currentTimeMillis;
        const id = crypto.randomUUID();
        const token = generateInviteToken();
        // One open link per address for a plain invite (R's rule), one per placeholder for a claim
        // invite; a plain invite never revokes a claim link that happens to carry the same address.
        const supersedes: SQL | undefined =
          claimsUserId !== null
            ? eq(householdInvites.claimsUserId, claimsUserId)
            : and(isNull(householdInvites.claimsUserId), eqFolded(householdInvites.email, email ?? ""));

        yield* database.transaction(
          Effect.gen(function* () {
            yield* database.use((tx) =>
              tx
                .update(householdInvites)
                .set({ status: "revoked" })
                .where(
                  and(
                    eq(householdInvites.householdId, householdId),
                    eq(householdInvites.status, "pending"),
                    supersedes,
                  ),
                ),
            );
            yield* database.use((tx) =>
              tx.insert(householdInvites).values({
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
              }),
            );
          }),
        );

        const invite = yield* loadInvite(id);
        const inviteUrl = inviteUrlOf(config.webOrigins[0], token);

        // A claim link without an address is handed over by the admin (copy, share); nothing to mail.
        if (email === null) return { invite, inviteUrl, emailSent: false } satisfies HouseholdInviteResponse;

        // AFTER the row is committed, and never able to fail the request: an invite that
        // exists but was not mailed is useful (copy the link); a 500 that leaves a
        // committed invite behind is not. trySendMail() swallows and logs.
        const [household] = yield* database.use((db) =>
          db.select({ name: households.name }).from(households).where(eq(households.id, householdId)).limit(1),
        );
        // The invitee usually has no account (and so no locale preference) yet, so the
        // INVITER's own `users.locale` is the closest proxy — a household invites its
        // own household (docs/i18n.md §8).
        const [inviter] = yield* database.use((db) =>
          db.select({ locale: users.locale }).from(users).where(eq(users.id, invitedBy)).limit(1),
        );
        const locale: Locale = isLocale(inviter?.locale) ? inviter.locale : config.defaultLocale;
        const sent = yield* mailer.trySendMail(
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
        return { invite, inviteUrl, emailSent: mailDelivery === "sent", mailDelivery } satisfies HouseholdInviteResponse;
      });

      const listInvites = Effect.fn("HouseholdInvites.listInvites")(function* (
        householdId: string,
        pagination: PaginationQuery,
      ) {
        const rows = yield* database.use((db) =>
          db
            .select({ invite: householdInvites, invitedByName: users.name })
            .from(householdInvites)
            .innerJoin(users, eq(users.id, householdInvites.invitedBy))
            .where(eq(householdInvites.householdId, householdId))
            .orderBy(desc(householdInvites.createdAt))
            .limit(pagination.limit)
            .offset(pagination.offset),
        );

        const [totals] = yield* database.use((db) =>
          db.select({ value: count() }).from(householdInvites).where(eq(householdInvites.householdId, householdId)),
        );

        const now = yield* Clock.currentTimeMillis;
        return {
          items: rows.map((row) => toHouseholdInvite(row.invite, row.invitedByName, now)),
          total: Number(totals?.value ?? 0),
          limit: pagination.limit,
          offset: pagination.offset,
        } satisfies HouseholdInviteListResponse;
      });

      const revokeInvite = Effect.fn("HouseholdInvites.revokeInvite")(function* (householdId: string, inviteId: string) {
        const [row] = yield* database.use((db) =>
          db
            .select({ id: householdInvites.id, status: householdInvites.status })
            .from(householdInvites)
            .where(and(eq(householdInvites.id, inviteId), eq(householdInvites.householdId, householdId)))
            .limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.invite.notFound" });
        if (row.status === "accepted") {
          return yield* new Conflict({ code: "conflict", text: "server.invite.alreadyAccepted" });
        }
        yield* database.use((db) =>
          db.update(householdInvites).set({ status: "revoked" }).where(eq(householdInvites.id, inviteId)),
        );
      });

      /** Loads an invite by token and rejects unusable ones (404/409). */
      const loadUsableInvite = Effect.fnUntraced(function* (token: string) {
        const [row] = yield* database.use((db) =>
          db
            .select({ invite: householdInvites, householdName: households.name, invitedByName: users.name })
            .from(householdInvites)
            .innerJoin(households, eq(households.id, householdInvites.householdId))
            .innerJoin(users, eq(users.id, householdInvites.invitedBy))
            .where(eq(householdInvites.token, token))
            .limit(1),
        );

        if (!row) return yield* new NotFound({ text: "server.invite.invalid" });
        const now = yield* Clock.currentTimeMillis;
        const status = toInviteStatus(row.invite.status, row.invite.expiresAt, now);
        if (status === "revoked") return yield* new NotFound({ text: "server.invite.revoked" });
        if (status === "expired") {
          return yield* new Conflict({ code: "invite_expired", text: "server.invite.expired" });
        }
        return {
          invite: row.invite,
          householdName: row.householdName,
          invitedByName: row.invitedByName,
        } satisfies InviteContext;
      });

      /** `users.name` of the user a claim invite hands over; `null` for a plain invite. */
      const claimsDisplayNameOf = Effect.fnUntraced(function* (claimsUserId: string | null) {
        if (claimsUserId === null) return null;
        const [row] = yield* database.use((db) =>
          db.select({ name: users.name }).from(users).where(eq(users.id, claimsUserId)).limit(1),
        );
        return row?.name ?? null;
      });

      const previewInvite = Effect.fn("HouseholdInvites.previewInvite")(function* (token: string) {
        const { invite, householdName, invitedByName } = yield* loadUsableInvite(token);
        const now = yield* Clock.currentTimeMillis;
        return {
          householdName,
          invitedByName,
          // As stored: NULL for a claim invite created without an address (ADR 0006).
          email: invite.email,
          role: toInvitableRole(invite.role),
          status: toInviteStatus(invite.status, invite.expiresAt, now),
          expiresAt: toIso(invite.expiresAt),
          // The placeholder's name (ADR 0006): what the landing page says the account is created for.
          claimsDisplayName: yield* claimsDisplayNameOf(invite.claimsUserId),
        } satisfies InvitePreviewResponse;
      });

      const acceptInvite = Effect.fn("HouseholdInvites.acceptInvite")(function* (userId: string, token: string) {
        const { invite } = yield* loadUsableInvite(token);

        const [existing] = yield* database.use((db) =>
          db
            .select({ role: householdMembers.role })
            .from(householdMembers)
            .where(and(eq(householdMembers.householdId, invite.householdId), eq(householdMembers.userId, userId)))
            .limit(1),
        );

        const timestamp = yield* Clock.currentTimeMillis;

        // A CLAIM invite is redeemed only by registering onto the placeholder (ADR 0006 decision 3,
        // toon-finance `acceptInvite`): an existing account accepting it would burn the link or merge
        // two user ids, neither is a feature. The one caller let through is the claimed user itself,
        // replaying its accept. A spent claim link is no capability for anyone else (F gotcha 55).
        if (invite.claimsUserId !== null && invite.claimsUserId !== userId) {
          if (invite.status === "accepted") return yield* new NotFound({ text: "server.invite.alreadyUsed" });
          return yield* new Conflict({
            code: "invite_claim_requires_register",
            text: "server.invite.claimRequiresRegister",
          });
        }

        if (!existing && invite.status === "accepted") {
          return yield* new NotFound({ text: "server.invite.alreadyUsed" });
        }

        const role: HouseholdRole = existing ? toHouseholdRole(existing.role) : toInvitableRole(invite.role);

        yield* database.transaction(
          Effect.gen(function* () {
            if (!existing) {
              yield* database.use((tx) =>
                tx.insert(householdMembers).values({
                  id: crypto.randomUUID(),
                  householdId: invite.householdId,
                  userId,
                  role,
                  createdAt: timestamp,
                }),
              );
            }
            yield* database.use((tx) =>
              tx
                .update(householdInvites)
                .set({ status: "accepted", acceptedBy: userId, acceptedAt: timestamp })
                .where(eq(householdInvites.id, invite.id)),
            );
            yield* database.use((tx) =>
              tx
                .update(users)
                .set({ activeHouseholdId: invite.householdId, updatedAt: timestamp })
                .where(eq(users.id, userId)),
            );
          }),
        );

        const [household, member] = yield* Effect.all(
          [
            householdsService.getHouseholdWithRole(invite.householdId, role),
            householdsService.getMember(invite.householdId, userId),
          ],
          { concurrency: "unbounded" },
        );

        return { household, member } satisfies AcceptInviteResponse;
      });

      return HouseholdInvites.of({ createInvite, listInvites, revokeInvite, previewInvite, acceptInvite });
    }),
  );
}
