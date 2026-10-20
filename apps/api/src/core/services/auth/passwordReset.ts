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
 *
 * The `PasswordReset` service (docs/EFFECT.md E6, E7; plan `docs/plans/e2-api-core-services.md` P2, P7) reads the
 * current executor of `Database` on every call and its time from the `Clock`, inside each method; the token lookup
 * runs through `spendableToken` (`tokens.ts`). The expired-token sweep stays fire-and-forget and catch-all (a
 * detached fiber whose whole cause is ignored, plan e2 P2). The Promise bridges at the end of the file keep the old
 * exports working for the callers that are not converted yet.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import type { DrizzleDatabase } from "../../../db/client.ts";
import { Database } from "../../../db/database.ts";
import { type PasswordResetTokenRow, passwordResetTokens, users } from "../../../db/schema.ts";
import { ApiFailure, type DatabaseError } from "../../../lib/errors.ts";
import { runtime } from "../../../runtime.ts";
import { Passwords } from "./passwords.ts";
import { Sessions } from "./sessions.ts";
import { generateOpaqueToken, hashToken, spendableToken } from "./tokens.ts";
import { Users } from "./users.ts";

/**
 * 1 hour. Much shorter than the invites' 14 days because the blast radius is
 * different: an invite grants household membership, this grants the account.
 */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** For the mail template, which talks in minutes. */
export const PASSWORD_RESET_TTL_MINUTES = PASSWORD_RESET_TTL_MS / 60_000;

/** The one error every rejection path uses. Never say WHY. */
function invalidToken(): ApiFailure {
  return new ApiFailure({ status: 400, code: "reset_token_invalid", text: "server.auth.resetLinkInvalid" });
}

export interface CreatedPasswordReset {
  /** The raw token — exists only in memory and in the link. Never stored. */
  token: string;
  expiresAt: number;
}

/** Password-reset tokens: mint, resolve, consume once, and the expired sweep. */
export class PasswordReset extends Context.Service<
  PasswordReset,
  {
    /**
     * Mints a reset token for `userId`.
     *
     * Any outstanding unused token of that user is marked used first, so "request a new link" reliably kills the
     * previous one instead of leaving several live secrets lying in a mailbox.
     */
    readonly createPasswordResetToken: (
      userId: string,
      options?: { requestedIp?: string | null },
    ) => Effect.Effect<CreatedPasswordReset, DatabaseError>;
    /**
     * Resolves a raw token to its row, or fails with 400 `reset_token_invalid`. Read-only — `consumePasswordReset`
     * is what actually spends it.
     */
    readonly findUsablePasswordReset: (
      token: string,
    ) => Effect.Effect<PasswordResetTokenRow, ApiFailure | DatabaseError>;
    /**
     * Spends a token and applies the new password.
     *
     * Order matters and is the point of the whole feature:
     *   1. mark the token used  — so a replay of the same link cannot set a password again even if step 2 or 3
     *      fails,
     *   2. write the new hash,
     *   3. delete EVERY session of that user — a thief holding a stolen cookie is the reason someone resets in the
     *      first place, so the reset must log them out.
     *
     * NOT wrapped in a transaction on purpose: this order is safe when interrupted at any step — the worst case is a
     * spent token with the old password still in place, which the user fixes by asking for a new link.
     */
    readonly consumePasswordReset: (
      token: string,
      newPassword: string,
    ) => Effect.Effect<{ userId: string }, ApiFailure | DatabaseError>;
    /** Best-effort cleanup of long-expired rows. Never fails: the whole cause of the delete is ignored. */
    readonly sweepExpiredResetTokens: () => Effect.Effect<void>;
  }
>()("toon/api/core/services/auth/passwordReset/PasswordReset") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const userService = yield* Users;
      const sessions = yield* Sessions;
      const passwords = yield* Passwords;

      const sweepExpiredResetTokens = Effect.fn("PasswordReset.sweepExpiredResetTokens")(
        function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* database.use((db) => db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, now)));
        },
        // A failed cleanup must never break the request that triggered it: the WHOLE cause is ignored (plan e2 P2).
        Effect.ignoreCause,
      );

      const createPasswordResetToken = Effect.fn("PasswordReset.createPasswordResetToken")(function* (
        userId: string,
        options: { requestedIp?: string | null } = {},
      ) {
        const now = yield* Clock.currentTimeMillis;
        const token = generateOpaqueToken();

        yield* database.use((db) =>
          db
            .update(passwordResetTokens)
            .set({ usedAt: now })
            .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt))),
        );

        const expiresAt = now + PASSWORD_RESET_TTL_MS;
        yield* database.use((db) =>
          db.insert(passwordResetTokens).values({
            id: crypto.randomUUID(),
            userId,
            tokenHash: hashToken(token),
            expiresAt,
            usedAt: null,
            requestedIp: options.requestedIp ?? null,
            createdAt: now,
          }),
        );

        // Fire-and-forget: a detached fiber the request never awaits (plan e2 P2).
        yield* Effect.forkDetach(sweepExpiredResetTokens(), { startImmediately: true });
        return { token, expiresAt };
      });

      const findUsablePasswordReset = Effect.fn("PasswordReset.findUsablePasswordReset")(function* (token: string) {
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(passwordResetTokens)
            .where(eq(passwordResetTokens.tokenHash, hashToken(token)))
            .limit(1),
        );
        return yield* spendableToken(rows[0], invalidToken);
      });

      const consumePasswordReset = Effect.fn("PasswordReset.consumePasswordReset")(function* (
        token: string,
        newPassword: string,
      ) {
        const row = yield* findUsablePasswordReset(token);
        const now = yield* Clock.currentTimeMillis;

        // Conditional on usedAt still being NULL, so two simultaneous submissions of
        // the same link cannot both proceed.
        const claimed = yield* database.use((db) =>
          db
            .update(passwordResetTokens)
            .set({ usedAt: now })
            .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
            .returning({ id: passwordResetTokens.id }),
        );
        if (claimed.length === 0) return yield* invalidToken();

        const user = yield* userService.findUserById(row.userId);
        // The FK cascades, so this only happens if the account vanished mid-flow.
        if (!user) return yield* invalidToken();

        const passwordHash = yield* passwords.hashPassword(newPassword);
        yield* database.use((db) =>
          db.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, row.userId)),
        );

        // No session is kept: the caller has no session to keep (this endpoint is
        // unauthenticated), and the user signs in again with the new password.
        yield* sessions.deleteOtherSessions(row.userId);

        return { userId: row.userId };
      });

      return PasswordReset.of({
        createPasswordResetToken,
        findUsablePasswordReset,
        consumePasswordReset,
        sweepExpiredResetTokens,
      });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/** Callers: `core/routes/auth.ts` (E2-T10), `scripts/reset-password.ts` (E5). */
export function createPasswordResetToken(
  database: DrizzleDatabase,
  userId: string,
  options: { requestedIp?: string | null } = {},
): Promise<CreatedPasswordReset> {
  return runtime.runPromise(
    PasswordReset.use((service) => service.createPasswordResetToken(userId, options)).pipe(
      Database.withExecutor(database),
    ),
  );
}

/** Callers: none outside this file's own export (kept for its old export; E2-T13 prunes). */
export function findUsablePasswordReset(database: DrizzleDatabase, token: string): Promise<PasswordResetTokenRow> {
  return runtime.runPromise(
    PasswordReset.use((service) => service.findUsablePasswordReset(token)).pipe(Database.withExecutor(database)),
  );
}

/** Callers: `core/routes/auth.ts` (E2-T10). */
export function consumePasswordReset(
  database: DrizzleDatabase,
  token: string,
  newPassword: string,
): Promise<{ userId: string }> {
  return runtime.runPromise(
    PasswordReset.use((service) => service.consumePasswordReset(token, newPassword)).pipe(
      Database.withExecutor(database),
    ),
  );
}

/** Callers: none outside this file's own export (kept for its old export; E2-T13 prunes). */
export function sweepExpiredResetTokens(database: DrizzleDatabase): Promise<void> {
  return runtime
    .runPromise(
      PasswordReset.use((service) => service.sweepExpiredResetTokens()).pipe(Database.withExecutor(database)),
    )
    .catch(() => undefined);
}
