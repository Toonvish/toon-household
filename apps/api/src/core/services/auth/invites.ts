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
 *
 * A CLAIM invite (`claims_user_id`, ADR 0006) is the exception to "join": it is redeemed only
 * by registration, onto the placeholder it names (`claimInvite`), never by an existing account.
 *
 * The `AuthInvites` service (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P2, P7) reads the current
 * executor of `Database` on every call and its time from the `Clock`; refusals are typed failures of the error
 * family with the old status, code and text. The pure `generateInviteToken` and `INVITE_TTL_MS` stay plain; the
 * service has no legacy bridge (the auth routes and the scripts use the service or the pure exports).
 */
import { and, eq } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../db/database.ts";
import { type HouseholdInviteRow, householdInvites, householdMembers, users } from "../../../db/schema.ts";
import { ApiFailure, Conflict, type DatabaseError } from "../../../lib/errors.ts";
import { type ClaimPlaceholderInput, Users } from "./users.ts";

/** Invite links are valid for 14 days (docs/API.md). */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Random URL-safe invite token (32 bytes). */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export interface AcceptedInvite {
  invite: HouseholdInviteRow;
  householdId: string;
  memberId: string;
  role: "admin" | "member" | "owner";
  /** True when the user already was a member — accepting stays idempotent. */
  alreadyMember: boolean;
}

/** `404 invite_invalid` with the given text (unknown, revoked, spent or no claim invite). */
function inviteInvalid(
  text: "server.invite.invalid" | "server.invite.alreadyUsed" = "server.invite.invalid",
): ApiFailure {
  return new ApiFailure({ status: 404, code: "invite_invalid", text });
}

/** `409 invite_expired`. */
function inviteExpired(): Conflict {
  return new Conflict({ code: "invite_expired", text: "server.invite.expired" });
}

/** Invite redemption: the token lookup, the redeemability check, joining and the placeholder claim. */
export class AuthInvites extends Context.Service<
  AuthInvites,
  {
    /** Raw invite row for a token, or undefined. */
    readonly findInviteByToken: (token: string) => Effect.Effect<HouseholdInviteRow | undefined, DatabaseError>;
    /**
     * Validates an invite for redemption.
     * 404 `invite_invalid` — unknown, revoked or already redeemed by someone else
     * 409 `invite_expired` — past `expires_at` (the row is flagged `expired`)
     */
    readonly loadRedeemableInvite: (
      token: string,
    ) => Effect.Effect<HouseholdInviteRow, ApiFailure | Conflict | DatabaseError>;
    /**
     * Redeems an invite for `userId`, inserting the membership when needed.
     * Idempotent: calling it twice (or with a user who is already a member) succeeds
     * and reports `alreadyMember: true` without downgrading an existing role.
     */
    readonly acceptInvite: (
      token: string,
      userId: string,
    ) => Effect.Effect<AcceptedInvite, ApiFailure | Conflict | DatabaseError>;
    /**
     * Redeems a CLAIM invite at registration (ADR 0006 decision 3; toon-finance `claimInvite`):
     * writes the new credentials onto the placeholder the invite names (`claimPlaceholderUser`,
     * ONE conditional UPDATE, gotcha 72), marks the invite accepted by that very user id and points
     * the account's active household at the invite's household, all in one transaction. Succeeds with
     * the claimed user's id; the caller mails the confirmation link and starts the session.
     *
     * `invite` comes from `loadRedeemableInvite` (revoked: 404, expired: 409). A spent claim link
     * (`accepted`) is `404 invite_invalid` (toon-finance gotcha 55: an accepted token stops being a
     * capability), and a token that is no claim invite is `404 invite_invalid` too: `register`
     * decides between the two paths by `claimsUserId` before calling this.
     */
    readonly claimInvite: (
      invite: HouseholdInviteRow,
      input: ClaimPlaceholderInput,
    ) => Effect.Effect<string, ApiFailure | Conflict | DatabaseError>;
  }
>()("toon/api/core/services/auth/invites/AuthInvites") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const usersService = yield* Users;

      const findInviteByToken = Effect.fn("AuthInvites.findInviteByToken")(function* (token: string) {
        if (token.length === 0 || token.length > 200) return undefined;
        const rows = yield* database.use((db) =>
          db.select().from(householdInvites).where(eq(householdInvites.token, token)).limit(1),
        );
        return rows[0];
      });

      const loadRedeemableInvite = Effect.fn("AuthInvites.loadRedeemableInvite")(function* (token: string) {
        const invite = yield* findInviteByToken(token);
        if (!invite || invite.status === "revoked") return yield* inviteInvalid();
        const now = yield* Clock.currentTimeMillis;
        if (invite.expiresAt <= now) {
          if (invite.status === "pending") {
            yield* database.use((db) =>
              db.update(householdInvites).set({ status: "expired" }).where(eq(householdInvites.id, invite.id)),
            );
          }
          return yield* inviteExpired();
        }
        if (invite.status === "expired") return yield* inviteExpired();
        return invite;
      });

      const acceptInvite = Effect.fn("AuthInvites.acceptInvite")(function* (token: string, userId: string) {
        const invite = yield* loadRedeemableInvite(token);

        // A claim invite is redeemed by `claimInvite` (registration) only; the claimed user itself
        // replaying is the one exception (ADR 0006, toon-finance `acceptInvite`).
        if (invite.claimsUserId !== null && invite.claimsUserId !== userId) {
          if (invite.status === "accepted") return yield* inviteInvalid();
          return yield* new Conflict({
            code: "invite_claim_requires_register",
            text: "server.invite.claimRequiresRegister",
          });
        }

        const existing = yield* database.use((db) =>
          db
            .select()
            .from(householdMembers)
            .where(and(eq(householdMembers.householdId, invite.householdId), eq(householdMembers.userId, userId)))
            .limit(1),
        );

        const now = yield* Clock.currentTimeMillis;
        const current = existing[0];

        if (current) {
          if (invite.status === "pending") {
            yield* database.use((db) =>
              db
                .update(householdInvites)
                .set({ status: "accepted", acceptedBy: userId, acceptedAt: now })
                .where(eq(householdInvites.id, invite.id)),
            );
          }
          const accepted: AcceptedInvite = {
            invite,
            householdId: invite.householdId,
            memberId: current.id,
            role: current.role as AcceptedInvite["role"],
            alreadyMember: true,
          };
          return accepted;
        }

        // A pending invite may only be redeemed once.
        if (invite.status === "accepted") return yield* inviteInvalid("server.invite.alreadyUsed");

        const role = invite.role === "admin" ? "admin" : "member";
        const memberId = crypto.randomUUID();
        yield* database.use((db) =>
          db.insert(householdMembers).values({
            id: memberId,
            householdId: invite.householdId,
            userId,
            role,
            createdAt: now,
          }),
        );
        yield* database.use((db) =>
          db
            .update(householdInvites)
            .set({ status: "accepted", acceptedBy: userId, acceptedAt: now })
            .where(eq(householdInvites.id, invite.id)),
        );

        const accepted: AcceptedInvite = {
          invite,
          householdId: invite.householdId,
          memberId,
          role,
          alreadyMember: false,
        };
        return accepted;
      });

      const claimInvite = Effect.fn("AuthInvites.claimInvite")(function* (
        invite: HouseholdInviteRow,
        input: ClaimPlaceholderInput,
      ) {
        const userId = invite.claimsUserId;
        if (userId === null || invite.status !== "pending") return yield* inviteInvalid();
        const now = yield* Clock.currentTimeMillis;
        yield* database.transaction(
          Effect.gen(function* () {
            yield* usersService.claimPlaceholderUser(userId, input);
            yield* database.use((tx) =>
              tx
                .update(householdInvites)
                .set({ status: "accepted", acceptedBy: userId, acceptedAt: now })
                .where(eq(householdInvites.id, invite.id)),
            );
            yield* database.use((tx) =>
              tx
                .update(users)
                .set({ activeHouseholdId: invite.householdId, updatedAt: now })
                .where(eq(users.id, userId)),
            );
          }),
        );
        return userId;
      });

      return AuthInvites.of({ findInviteByToken, loadRedeemableInvite, acceptInvite, claimInvite });
    }),
  );
}
