/**
 * OWNER: auth agent.
 *
 * Password-reset tokens: create (invalidating any outstanding one), consume once,
 * and reject unknown/expired/used tokens with an INDISTINGUISHABLE error.
 *
 * Why "indistinguishable" matters: three different messages ("unbekannt",
 * "abgelaufen", "schon benutzt") would tell an attacker holding a guessed or
 * sniffed token which of those it was, i.e. whether it ever existed. So all three
 * answer 400 `reset_token_invalid` with one sentence.
 *
 * Everything that mints a token goes through here — the mailed flow
 * (`POST /api/auth/password/forgot`) and the operator CLI
 * (`bun run auth:reset-password`) share this file, which is why building the CLI
 * first was never wasted work.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import type { Database } from "../../../db/client.ts";
import { type PasswordResetTokenRow, passwordResetTokens, users } from "../../../db/schema.ts";
import { ApiError } from "../../../lib/errors.ts";
import { deleteOtherSessions } from "./sessions.ts";
import { assertSpendableToken, generateOpaqueToken, hashToken } from "./tokens.ts";
import { findUserById } from "./users.ts";
import { hashPassword } from "./passwords.ts";

/**
 * 1 hour. Much shorter than the invites' 14 days because the blast radius is
 * different: an invite grants household membership, this grants the account.
 */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** For the mail template, which talks in minutes. */
export const PASSWORD_RESET_TTL_MINUTES = PASSWORD_RESET_TTL_MS / 60_000;

/** The one error every rejection path uses. Never say WHY. */
function invalidToken(): ApiError {
  return new ApiError(400, "reset_token_invalid", "server.auth.resetLinkInvalid");
}

export interface CreatedPasswordReset {
  /** The raw token — exists only in memory and in the link. Never stored. */
  token: string;
  expiresAt: number;
}

/**
 * Mints a reset token for `userId`.
 *
 * Any outstanding unused token of that user is marked used first, so "request a
 * new link" reliably kills the previous one instead of leaving several live
 * secrets lying in a mailbox.
 */
export async function createPasswordResetToken(
  db: Database,
  userId: string,
  options: { requestedIp?: string | null } = {},
): Promise<CreatedPasswordReset> {
  const now = Date.now();
  const token = generateOpaqueToken();

  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));

  const expiresAt = now + PASSWORD_RESET_TTL_MS;
  await db.insert(passwordResetTokens).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    usedAt: null,
    requestedIp: options.requestedIp ?? null,
    createdAt: now,
  });

  void sweepExpiredResetTokens(db);
  return { token, expiresAt };
}

/**
 * Resolves a raw token to its row, or throws 400 `reset_token_invalid`.
 * Read-only — {@link consumePasswordReset} is what actually spends it.
 */
export async function findUsablePasswordReset(
  db: Database,
  token: string,
): Promise<PasswordResetTokenRow> {
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashToken(token)))
    .limit(1);

  return assertSpendableToken(rows[0], invalidToken);
}

/**
 * Spends a token and applies the new password.
 *
 * Order matters and is the point of the whole feature:
 *   1. mark the token used  — so a replay of the same link cannot set a password
 *      again even if step 2 or 3 fails,
 *   2. write the new hash,
 *   3. delete EVERY session of that user — a thief holding a stolen cookie is the
 *      reason someone resets in the first place, so the reset must log them out.
 *
 * NOT wrapped in a transaction on purpose: `withTransaction()` degrades to
 * sequential statements on a memory DB anyway (see the libSQL note in CLAUDE.md),
 * and this order is safe when interrupted at any step — the worst case is a spent
 * token with the old password still in place, which the user fixes by asking for
 * a new link.
 */
export async function consumePasswordReset(
  db: Database,
  token: string,
  newPassword: string,
): Promise<{ userId: string }> {
  const row = await findUsablePasswordReset(db, token);
  const now = Date.now();

  // Conditional on usedAt still being NULL, so two simultaneous submissions of
  // the same link cannot both proceed.
  const claimed = await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
    .returning({ id: passwordResetTokens.id });
  if (claimed.length === 0) throw invalidToken();

  const user = await findUserById(db, row.userId);
  // The FK cascades, so this only happens if the account vanished mid-flow.
  if (!user) throw invalidToken();

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: now })
    .where(eq(users.id, row.userId));

  // No session is kept: the caller has no session to keep (this endpoint is
  // unauthenticated), and the user signs in again with the new password.
  await deleteOtherSessions(db, row.userId);

  return { userId: row.userId };
}

/** Best-effort cleanup of long-expired rows. Never rejects. */
export async function sweepExpiredResetTokens(db: Database): Promise<void> {
  try {
    await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, Date.now()));
  } catch {
    // A failed cleanup must never break the request that triggered it.
  }
}
