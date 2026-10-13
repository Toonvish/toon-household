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
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.ts";
import { type UserRow, oauthAccounts } from "../../../db/schema.ts";
import { ApiError } from "../../../lib/errors.ts";
import type { OAuthProfile } from "../../../lib/oauth.ts";
import {
  DEFAULT_HOUSEHOLD_NAME,
  createOwnedHousehold,
  createUser,
  displayNameFromEmail,
  findUserByEmail,
  findUserById,
  updateUser,
} from "./users.ts";

export type OAuthOutcome = "login" | "linked" | "created";

export interface OAuthLoginResult {
  user: UserRow;
  outcome: OAuthOutcome;
}

/**
 * The existing row for `(provider, provider_user_id)` — the identity's unique key,
 * and the ONLY thing either entry point is allowed to match on. Matching an
 * e-mail instead is the takeover described in the module header.
 */
async function findLinkByIdentity(database: Database, profile: OAuthProfile) {
  const rows = await database
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, profile.provider),
        eq(oauthAccounts.providerUserId, profile.providerUserId),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Resolves (or creates) the local account for an OAuth profile. */
export async function loginWithOAuthProfile(
  database: Database,
  profile: OAuthProfile,
): Promise<OAuthLoginResult> {
  const link = await findLinkByIdentity(database, profile);
  if (link) {
    const user = await findUserById(database, link.userId);
    if (!user) {
      // Orphaned link (user row gone): drop it and fall through to creation.
      await database.delete(oauthAccounts).where(eq(oauthAccounts.id, link.id));
    } else {
      if ((profile.email ?? null) !== (link.providerEmail ?? null)) {
        await database
          .update(oauthAccounts)
          .set({ providerEmail: profile.email })
          .where(eq(oauthAccounts.id, link.id));
      }
      const patched = await refreshProfileFields(database, user, profile);
      return { user: patched, outcome: "login" };
    }
  }

  const email = profile.email;
  if (email) {
    // NEVER silently adopt an address that already has a local account, however
    // well the provider vouched for it — see the file header.
    const existingUser = await findUserByEmail(database, email);
    if (existingUser) {
      throw ApiError.conflict("email_taken", "server.auth.oauthEmailTaken");
    }
  }

  const created = await createUser(database, {
    // Providers that hide the address (GitHub without user:email) still get a
    // usable, unique local identity.
    email: email ?? `${profile.provider}-${profile.providerUserId}@oauth.local`,
    name: profile.name ?? (email ? displayNameFromEmail(email) : "Nutzer"),
    avatarUrl: profile.avatarUrl,
    passwordHash: null,
    emailVerified: profile.emailVerified,
  });
  await insertLink(database, created.id, profile);
  await createOwnedHousehold(database, created.id, DEFAULT_HOUSEHOLD_NAME);
  const withGroup = (await findUserById(database, created.id)) ?? created;
  return { user: withGroup, outcome: "created" };
}

async function insertLink(
  database: Database,
  userId: string,
  profile: OAuthProfile,
): Promise<void> {
  await database.insert(oauthAccounts).values({
    id: crypto.randomUUID(),
    userId,
    provider: profile.provider,
    providerUserId: profile.providerUserId,
    providerEmail: profile.email,
    createdAt: Date.now(),
  });
}

/** Fills in a missing avatar/name from the provider, but never overwrites one. */
async function refreshProfileFields(
  database: Database,
  user: UserRow,
  profile: OAuthProfile,
): Promise<UserRow> {
  const patch: Partial<Pick<UserRow, "avatarUrl" | "name">> = {};
  if (!user.avatarUrl && profile.avatarUrl) patch.avatarUrl = profile.avatarUrl;
  if (user.name.trim().length === 0 && profile.name) patch.name = profile.name;
  if (Object.keys(patch).length === 0) return user;
  return updateUser(database, user.id, patch);
}

/** OAuth identities of a user (used by the profile screen). */
export async function listOAuthAccounts(database: Database, userId: string) {
  return database.select().from(oauthAccounts).where(eq(oauthAccounts.userId, userId));
}

/**
 * Attaches a provider identity to an ALREADY AUTHENTICATED user — the only way a
 * password account and an OAuth identity ever end up on the same row.
 *
 * Idempotent when the identity is already linked to this very user.
 *
 * @throws ApiError 409 `oauth_already_linked` when the identity belongs to
 *   someone else, or when this user already linked a different identity of the
 *   same provider.
 */
export async function linkOAuthAccount(
  database: Database,
  userId: string,
  profile: OAuthProfile,
): Promise<void> {
  const link = await findLinkByIdentity(database, profile);
  if (link) {
    if (link.userId === userId) return;
    throw ApiError.conflict("oauth_already_linked", "server.auth.oauthLinkedElsewhere");
  }

  const mine = await database
    .select()
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, profile.provider)))
    .limit(1);
  if (mine[0]) {
    throw ApiError.conflict("oauth_already_linked", "server.auth.oauthProviderAlreadyLinked");
  }

  await insertLink(database, userId, profile);
}

/**
 * Detaches a provider identity.
 *
 * @throws ApiError 404 when nothing is linked, 409 `last_login_method` when
 *   removing it would lock the user out (no password and no other provider).
 */
export async function unlinkOAuthAccount(
  database: Database,
  user: UserRow,
  provider: OAuthProfile["provider"],
): Promise<void> {
  const links = await listOAuthAccounts(database, user.id);
  const target = links.find((row) => row.provider === provider);
  if (!target) throw ApiError.notFound("server.auth.oauthNothingLinked");

  const remaining = links.length - 1;
  if (remaining === 0 && !user.passwordHash) {
    throw ApiError.conflict("last_login_method", "server.auth.oauthLastLoginMethod");
  }

  await database.delete(oauthAccounts).where(eq(oauthAccounts.id, target.id));
}
