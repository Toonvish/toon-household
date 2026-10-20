/**
 * OWNER: auth agent.
 *
 * The login / create decision behind the OAuth callback:
 *
 *  1. `oauth_accounts(provider, provider_user_id)` already known  -> log that user in
 *  2. the address is free -> create a user (password_hash NULL) plus the first
 *     household, exactly like registration does
 *  3. the address belongs to an existing local account -> 409 `email_taken`
 *
 * WHY THERE IS NO AUTOMATIC LINK-ON-EMAIL-MATCH (this used to be case 2):
 * `POST /api/auth/register` cannot prove that the registrant owns the address, yet
 * `users.email_verified` used to be `true` for every self-registered row.
 * Auto-linking on that flag meant: attacker registers victim@gmail.com with a
 * password of their choosing, the victim later signs in with Google, and the
 * provider identity gets LINKED INTO THE ATTACKER'S account — full takeover of the
 * victim's households and recipes while the victim sees a perfectly normal login.
 * Registration now stores `email_verified: false`, and linking is an EXPLICIT,
 * authenticated action ({@link linkOAuthAccount} behind
 * `GET /api/auth/oauth/:provider/link`).
 *
 * A confirmation-mail flow DOES exist now (`POST /api/auth/email/verify/request` ->
 * `.../confirm`, services/auth/emailVerification.ts) and it writes a real
 * `users.email_verified_at`. Auto-linking is still deliberately OFF; if it ever
 * comes back it must be gated on that TIMESTAMP, never on the boolean, which an
 * OAuth provider can also set.
 *
 * The `OAuthAccounts` service (docs/EFFECT.md E6, E7; plan `docs/plans/e2-api-core-services.md` P2, P7) reads the
 * current executor of `Database` on every call and its time from the `Clock`, inside each method. The Promise
 * bridges at the end of the file keep the old exports working for the callers that are not converted yet.
 */
import { and, eq } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import type { DrizzleDatabase } from "../../../db/client.ts";
import { Database } from "../../../db/database.ts";
import { type OAuthAccountRow, type UserRow, oauthAccounts } from "../../../db/schema.ts";
import { Conflict, type DatabaseError, NotFound } from "../../../lib/errors.ts";
import type { OAuthProfile } from "../../../lib/oauth.ts";
import type { HookError } from "../../../modules/types.ts";
import { runtime } from "../../../runtime.ts";
import { DEFAULT_HOUSEHOLD_NAME, Users, displayNameFromEmail } from "./users.ts";

export type OAuthOutcome = "login" | "linked" | "created";

export interface OAuthLoginResult {
  user: UserRow;
  outcome: OAuthOutcome;
}

/** OAuth identities: the login / create decision, the explicit link and unlink, and the profile screen's list. */
export class OAuthAccounts extends Context.Service<
  OAuthAccounts,
  {
    /**
     * Resolves (or creates) the local account for an OAuth profile. Fails with 409 `email_taken` when the address
     * belongs to an existing local account (never an automatic link, see the file header).
     */
    readonly loginWithOAuthProfile: (profile: OAuthProfile) => Effect.Effect<OAuthLoginResult, HookError>;
    /** OAuth identities of a user (used by the profile screen). */
    readonly listOAuthAccounts: (userId: string) => Effect.Effect<OAuthAccountRow[], DatabaseError>;
    /**
     * Attaches a provider identity to an ALREADY AUTHENTICATED user — the only way a password account and an OAuth
     * identity ever end up on the same row. Idempotent when the identity is already linked to this very user. Fails
     * with 409 `oauth_already_linked` when the identity belongs to someone else, or when this user already linked a
     * different identity of the same provider.
     */
    readonly linkOAuthAccount: (userId: string, profile: OAuthProfile) => Effect.Effect<void, Conflict | DatabaseError>;
    /**
     * Detaches a provider identity. Fails with 404 when nothing is linked, 409 `last_login_method` when removing it
     * would lock the user out (no password and no other provider).
     */
    readonly unlinkOAuthAccount: (
      user: UserRow,
      provider: OAuthProfile["provider"],
    ) => Effect.Effect<void, NotFound | Conflict | DatabaseError>;
  }
>()("toon/api/core/services/auth/oauthAccounts/OAuthAccounts") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const users = yield* Users;

      /**
       * The existing row for `(provider, provider_user_id)` — the identity's unique key, and the ONLY thing either
       * entry point is allowed to match on. Matching an e-mail instead is the takeover described in the module header.
       */
      const findLinkByIdentity = Effect.fn("OAuthAccounts.findLinkByIdentity")(function* (profile: OAuthProfile) {
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(oauthAccounts)
            .where(
              and(
                eq(oauthAccounts.provider, profile.provider),
                eq(oauthAccounts.providerUserId, profile.providerUserId),
              ),
            )
            .limit(1),
        );
        return rows[0];
      });

      const insertLink = Effect.fn("OAuthAccounts.insertLink")(function* (userId: string, profile: OAuthProfile) {
        const now = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db.insert(oauthAccounts).values({
            id: crypto.randomUUID(),
            userId,
            provider: profile.provider,
            providerUserId: profile.providerUserId,
            providerEmail: profile.email,
            createdAt: now,
          }),
        );
      });

      /** Fills in a missing avatar/name from the provider, but never overwrites one. */
      const refreshProfileFields = Effect.fn("OAuthAccounts.refreshProfileFields")(function* (
        user: UserRow,
        profile: OAuthProfile,
      ) {
        const patch: Partial<Pick<UserRow, "avatarUrl" | "name">> = {};
        if (!user.avatarUrl && profile.avatarUrl) patch.avatarUrl = profile.avatarUrl;
        if (user.name.trim().length === 0 && profile.name) patch.name = profile.name;
        if (Object.keys(patch).length === 0) return user;
        return yield* users.updateUser(user.id, patch);
      });

      const loginWithOAuthProfile = Effect.fn("OAuthAccounts.loginWithOAuthProfile")(function* (
        profile: OAuthProfile,
      ) {
        const link = yield* findLinkByIdentity(profile);
        if (link) {
          const user = yield* users.findUserById(link.userId);
          if (!user) {
            // Orphaned link (user row gone): drop it and fall through to creation.
            yield* database.use((db) => db.delete(oauthAccounts).where(eq(oauthAccounts.id, link.id)));
          } else {
            if ((profile.email ?? null) !== (link.providerEmail ?? null)) {
              yield* database.use((db) =>
                db.update(oauthAccounts).set({ providerEmail: profile.email }).where(eq(oauthAccounts.id, link.id)),
              );
            }
            const patched = yield* refreshProfileFields(user, profile);
            const result: OAuthLoginResult = { user: patched, outcome: "login" };
            return result;
          }
        }

        const email = profile.email;
        if (email) {
          // NEVER silently adopt an address that already has a local account, however
          // well the provider vouched for it — see the file header.
          const existingUser = yield* users.findUserByEmail(email);
          if (existingUser) {
            return yield* new Conflict({ code: "email_taken", text: "server.auth.oauthEmailTaken" });
          }
        }

        const created = yield* users.createUser({
          // Providers that hide the address (GitHub without user:email) still get a
          // usable, unique local identity.
          email: email ?? `${profile.provider}-${profile.providerUserId}@oauth.local`,
          name: profile.name ?? (email ? displayNameFromEmail(email) : "Nutzer"),
          avatarUrl: profile.avatarUrl,
          passwordHash: null,
          emailVerified: profile.emailVerified,
        });
        yield* insertLink(created.id, profile);
        yield* users.createOwnedHousehold(created.id, DEFAULT_HOUSEHOLD_NAME);
        const withGroup = (yield* users.findUserById(created.id)) ?? created;
        const result: OAuthLoginResult = { user: withGroup, outcome: "created" };
        return result;
      });

      const listOAuthAccounts = Effect.fn("OAuthAccounts.listOAuthAccounts")(function* (userId: string) {
        return yield* database.use((db) => db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, userId)));
      });

      const linkOAuthAccount = Effect.fn("OAuthAccounts.linkOAuthAccount")(function* (
        userId: string,
        profile: OAuthProfile,
      ) {
        const link = yield* findLinkByIdentity(profile);
        if (link) {
          if (link.userId === userId) return;
          return yield* new Conflict({ code: "oauth_already_linked", text: "server.auth.oauthLinkedElsewhere" });
        }

        const mine = yield* database.use((db) =>
          db
            .select()
            .from(oauthAccounts)
            .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, profile.provider)))
            .limit(1),
        );
        if (mine[0]) {
          return yield* new Conflict({ code: "oauth_already_linked", text: "server.auth.oauthProviderAlreadyLinked" });
        }

        yield* insertLink(userId, profile);
      });

      const unlinkOAuthAccount = Effect.fn("OAuthAccounts.unlinkOAuthAccount")(function* (
        user: UserRow,
        provider: OAuthProfile["provider"],
      ) {
        const links = yield* listOAuthAccounts(user.id);
        const target = links.find((row) => row.provider === provider);
        if (!target) return yield* new NotFound({ text: "server.auth.oauthNothingLinked" });

        const remaining = links.length - 1;
        if (remaining === 0 && !user.passwordHash) {
          return yield* new Conflict({ code: "last_login_method", text: "server.auth.oauthLastLoginMethod" });
        }

        yield* database.use((db) => db.delete(oauthAccounts).where(eq(oauthAccounts.id, target.id)));
      });

      return OAuthAccounts.of({ loginWithOAuthProfile, listOAuthAccounts, linkOAuthAccount, unlinkOAuthAccount });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/** Callers: `core/routes/auth.ts` (E2-T10), `core/services/auth/index.ts`. */
export function loginWithOAuthProfile(database: DrizzleDatabase, profile: OAuthProfile): Promise<OAuthLoginResult> {
  return runtime.runPromise(
    OAuthAccounts.use((service) => service.loginWithOAuthProfile(profile)).pipe(Database.withExecutor(database)),
  );
}

/** Callers: `core/routes/auth.ts` (E2-T10), `core/services/auth/index.ts`. */
export function listOAuthAccounts(database: DrizzleDatabase, userId: string): Promise<OAuthAccountRow[]> {
  return runtime.runPromise(
    OAuthAccounts.use((service) => service.listOAuthAccounts(userId)).pipe(Database.withExecutor(database)),
  );
}

/** Callers: `core/routes/auth.ts` (E2-T10). */
export function linkOAuthAccount(database: DrizzleDatabase, userId: string, profile: OAuthProfile): Promise<void> {
  return runtime.runPromise(
    OAuthAccounts.use((service) => service.linkOAuthAccount(userId, profile)).pipe(Database.withExecutor(database)),
  );
}

/** Callers: `core/routes/auth.ts` (E2-T10). */
export function unlinkOAuthAccount(
  database: DrizzleDatabase,
  user: UserRow,
  provider: OAuthProfile["provider"],
): Promise<void> {
  return runtime.runPromise(
    OAuthAccounts.use((service) => service.unlinkOAuthAccount(user, provider)).pipe(Database.withExecutor(database)),
  );
}
