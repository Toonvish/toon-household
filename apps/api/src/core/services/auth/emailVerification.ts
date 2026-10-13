/**
 * OWNER: auth agent.
 *
 * E-mail confirmation: mint a token, confirm it, and set the ONLY thing that
 * counts as proof — `users.email_verified_at`.
 *
 * READ THIS BEFORE TOUCHING OAUTH. The reason this file exists is that
 * `emailVerified` used to default to `true` on self-registration, and
 * `loginWithOAuthProfile()` auto-linked a provider identity to any account with a
 * matching verified address. Together that was an account takeover: register a
 * victim's address, wait for them to click "Mit Google anmelden", and their login
 * lands in your account. Registration therefore stores false, and linking is an
 * explicit authenticated action (`GET /api/auth/oauth/:provider/link`).
 *
 * A confirmation click sets a real timestamp here, which is the flag a future
 * auto-link may be gated on — the boolean alone must never be enough again.
 * Auto-linking is still OFF; see services/auth/oauthAccounts.ts.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import type { Database } from "../../../db/client.ts";
import {
  type EmailVerificationTokenRow,
  type UserRow,
  emailVerificationTokens,
  users,
} from "../../../db/schema.ts";
import { ApiError } from "../../../lib/errors.ts";
import { assertSpendableToken, generateOpaqueToken, hashToken } from "./tokens.ts";
import { findUserById } from "./users.ts";

/** 24 hours — long enough for "I'll do it tonight", short enough to matter. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_VERIFICATION_TTL_HOURS = EMAIL_VERIFICATION_TTL_MS / (60 * 60 * 1000);

/** One error for unknown/expired/used/wrong-address, same reasoning as the reset flow. */
function invalidToken(): ApiError {
  return new ApiError(
    400,
    "verification_token_invalid",
    "server.auth.verificationLinkInvalid",
  );
}

export interface CreatedEmailVerification {
  token: string;
  expiresAt: number;
  /** Address the token is bound to (the account's address at mint time). */
  email: string;
}

/**
 * Mints a confirmation token for `user`, invalidating any outstanding one.
 *
 * @throws ApiError 409 when the address is already confirmed — re-confirming is a
 *   no-op and silently sending another mail would be confusing.
 */
export async function createEmailVerificationToken(
  db: Database,
  user: UserRow,
  options: { requestedIp?: string | null } = {},
): Promise<CreatedEmailVerification> {
  if (user.emailVerifiedAt !== null) {
    throw ApiError.conflict("conflict", "server.auth.emailAlreadyVerified");
  }

  const now = Date.now();
  const token = generateOpaqueToken();

  await db
    .update(emailVerificationTokens)
    .set({ usedAt: now })
    .where(
      and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt)),
    );

  const expiresAt = now + EMAIL_VERIFICATION_TTL_MS;
  await db.insert(emailVerificationTokens).values({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: hashToken(token),
    email: user.email,
    expiresAt,
    usedAt: null,
    requestedIp: options.requestedIp ?? null,
    createdAt: now,
  });

  void sweepExpiredVerificationTokens(db);
  return { token, expiresAt, email: user.email };
}

/** Resolves a raw token, or throws 400 `verification_token_invalid`. */
export async function findUsableEmailVerification(
  db: Database,
  token: string,
): Promise<EmailVerificationTokenRow> {
  const rows = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, hashToken(token)))
    .limit(1);

  return assertSpendableToken(rows[0], invalidToken);
}

/**
 * Spends a token and marks the address verified.
 *
 * The token is bound to the address it was issued for: if the account's e-mail
 * changed in between, the token is rejected rather than used to vouch for an
 * address nobody confirmed.
 */
export async function confirmEmailVerification(
  db: Database,
  token: string,
): Promise<{ user: UserRow }> {
  const row = await findUsableEmailVerification(db, token);
  const now = Date.now();

  const claimed = await db
    .update(emailVerificationTokens)
    .set({ usedAt: now })
    .where(
      and(eq(emailVerificationTokens.id, row.id), isNull(emailVerificationTokens.usedAt)),
    )
    .returning({ id: emailVerificationTokens.id });
  if (claimed.length === 0) throw invalidToken();

  const user = await findUserById(db, row.userId);
  if (!user) throw invalidToken();
  if (user.email !== row.email) throw invalidToken();

  return { user: await markEmailVerified(db, user.id, now) };
}

/**
 * THE ONLY writer of the verified pair.
 *
 * Both columns move together: `email_verified` is what the UI reads,
 * `email_verified_at` is the evidence. Setting one without the other is how the
 * old takeover became possible, so no caller may write them individually.
 */
export async function markEmailVerified(
  db: Database,
  userId: string,
  at: number = Date.now(),
): Promise<UserRow> {
  await db
    .update(users)
    .set({ emailVerified: true, emailVerifiedAt: at, updatedAt: at })
    .where(eq(users.id, userId));
  const row = await findUserById(db, userId);
  if (!row) throw ApiError.notFound("server.auth.userNotFound");
  return row;
}

/** Best-effort cleanup of long-expired rows. Never rejects. */
export async function sweepExpiredVerificationTokens(db: Database): Promise<void> {
  try {
    await db
      .delete(emailVerificationTokens)
      .where(lt(emailVerificationTokens.expiresAt, Date.now()));
  } catch {
    // A failed cleanup must never break the request that triggered it.
  }
}
