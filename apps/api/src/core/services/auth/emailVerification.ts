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
 *
 * The `EmailVerification` service (docs/EFFECT.md E6, E7; plan `docs/plans/e2-api-core-services.md` P2, P7) reads
 * the current executor of `Database` on every call and its time from the `Clock`, inside each method. The token
 * lookup runs through `spendableToken` (`tokens.ts`), so unknown, used and expired stay one indistinguishable
 * refusal. `markEmailVerified` takes the timestamp as an argument (it has no default: the caller passes the
 * Clock's value). The expired-token sweep stays fire-and-forget and catch-all: a detached fiber whose whole cause is
 * ignored, never awaited by the request (plan e2 P2). The Promise bridges at the end of the file keep the old
 * exports working for the callers that are not converted yet.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import type { DrizzleDatabase } from "../../../db/client.ts";
import { Database } from "../../../db/database.ts";
import {
  type EmailVerificationTokenRow,
  type UserRow,
  emailVerificationTokens,
  users,
} from "../../../db/schema.ts";
import { ApiFailure, Conflict, type DatabaseError, NotFound, type Unauthorized } from "../../../lib/errors.ts";
import { runtime } from "../../../runtime.ts";
import { generateOpaqueToken, hashToken, spendableToken } from "./tokens.ts";
import { Users } from "./users.ts";

/** 24 hours — long enough for "I'll do it tonight", short enough to matter. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_VERIFICATION_TTL_HOURS = EMAIL_VERIFICATION_TTL_MS / (60 * 60 * 1000);

/** One error for unknown/expired/used/wrong-address, same reasoning as the reset flow. */
function invalidToken(): ApiFailure {
  return new ApiFailure({
    status: 400,
    code: "verification_token_invalid",
    text: "server.auth.verificationLinkInvalid",
  });
}

export interface CreatedEmailVerification {
  token: string;
  expiresAt: number;
  /** Address the token is bound to (the account's address at mint time). */
  email: string;
}

/** E-mail confirmation tokens: mint, resolve, confirm, the one writer of the verified pair, and the expired sweep. */
export class EmailVerification extends Context.Service<
  EmailVerification,
  {
    /**
     * Mints a confirmation token for `user`, invalidating any outstanding one. Fails with a 409 `conflict` when
     * the address is already confirmed — re-confirming is a no-op and silently sending another mail would be
     * confusing — and with `Unauthorized` for a placeholder (it has no address to confirm).
     */
    readonly createEmailVerificationToken: (
      user: UserRow,
      options?: { requestedIp?: string | null },
    ) => Effect.Effect<CreatedEmailVerification, Conflict | Unauthorized | DatabaseError>;
    /** Resolves a raw token, or fails with 400 `verification_token_invalid`. */
    readonly findUsableEmailVerification: (
      token: string,
    ) => Effect.Effect<EmailVerificationTokenRow, ApiFailure | DatabaseError>;
    /**
     * Spends a token and marks the address verified.
     *
     * The token is bound to the address it was issued for: if the account's e-mail changed in between, the token is
     * rejected rather than used to vouch for an address nobody confirmed.
     */
    readonly confirmEmailVerification: (
      token: string,
    ) => Effect.Effect<{ user: UserRow }, ApiFailure | NotFound | DatabaseError>;
    /**
     * THE ONLY writer of the verified pair.
     *
     * Both columns move together: `email_verified` is what the UI reads, `email_verified_at` is the evidence. Setting
     * one without the other is how the old takeover became possible, so no caller may write them individually.
     */
    readonly markEmailVerified: (userId: string, at: number) => Effect.Effect<UserRow, NotFound | DatabaseError>;
    /** Best-effort cleanup of long-expired rows. Never fails: the whole cause of the delete is ignored. */
    readonly sweepExpiredVerificationTokens: () => Effect.Effect<void>;
  }
>()("toon/api/core/services/auth/emailVerification/EmailVerification") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const userService = yield* Users;

      const sweepExpiredVerificationTokens = Effect.fn("EmailVerification.sweepExpiredVerificationTokens")(
        function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* database.use((db) =>
            db.delete(emailVerificationTokens).where(lt(emailVerificationTokens.expiresAt, now)),
          );
        },
        // A failed cleanup must never break the request that triggered it: the WHOLE cause is ignored (plan e2 P2).
        Effect.ignoreCause,
      );

      const createEmailVerificationToken = Effect.fn("EmailVerification.createEmailVerificationToken")(function* (
        user: UserRow,
        options: { requestedIp?: string | null } = {},
      ) {
        if (user.emailVerifiedAt !== null) {
          return yield* new Conflict({ code: "conflict", text: "server.auth.emailAlreadyVerified" });
        }

        // Only an account is ever asked to confirm (a placeholder has no session, ADR 0006).
        const email = yield* userService.accountEmail(user);
        const now = yield* Clock.currentTimeMillis;
        const token = generateOpaqueToken();

        yield* database.use((db) =>
          db
            .update(emailVerificationTokens)
            .set({ usedAt: now })
            .where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt))),
        );

        const expiresAt = now + EMAIL_VERIFICATION_TTL_MS;
        yield* database.use((db) =>
          db.insert(emailVerificationTokens).values({
            id: crypto.randomUUID(),
            userId: user.id,
            tokenHash: hashToken(token),
            email,
            expiresAt,
            usedAt: null,
            requestedIp: options.requestedIp ?? null,
            createdAt: now,
          }),
        );

        // Fire-and-forget: a detached fiber the request never awaits (plan e2 P2).
        yield* Effect.forkDetach(sweepExpiredVerificationTokens(), { startImmediately: true });
        return { token, expiresAt, email };
      });

      const findUsableEmailVerification = Effect.fn("EmailVerification.findUsableEmailVerification")(function* (
        token: string,
      ) {
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(emailVerificationTokens)
            .where(eq(emailVerificationTokens.tokenHash, hashToken(token)))
            .limit(1),
        );
        return yield* spendableToken(rows[0], invalidToken);
      });

      const markEmailVerified = Effect.fn("EmailVerification.markEmailVerified")(function* (
        userId: string,
        at: number,
      ) {
        yield* database.use((db) =>
          db.update(users).set({ emailVerified: true, emailVerifiedAt: at, updatedAt: at }).where(eq(users.id, userId)),
        );
        const row = yield* userService.findUserById(userId);
        if (!row) return yield* new NotFound({ text: "server.auth.userNotFound" });
        return row;
      });

      const confirmEmailVerification = Effect.fn("EmailVerification.confirmEmailVerification")(function* (
        token: string,
      ) {
        const row = yield* findUsableEmailVerification(token);
        const now = yield* Clock.currentTimeMillis;

        const claimed = yield* database.use((db) =>
          db
            .update(emailVerificationTokens)
            .set({ usedAt: now })
            .where(and(eq(emailVerificationTokens.id, row.id), isNull(emailVerificationTokens.usedAt)))
            .returning({ id: emailVerificationTokens.id }),
        );
        if (claimed.length === 0) return yield* invalidToken();

        const user = yield* userService.findUserById(row.userId);
        if (!user) return yield* invalidToken();
        if (user.email !== row.email) return yield* invalidToken();

        return { user: yield* markEmailVerified(user.id, now) };
      });

      return EmailVerification.of({
        createEmailVerificationToken,
        findUsableEmailVerification,
        confirmEmailVerification,
        markEmailVerified,
        sweepExpiredVerificationTokens,
      });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/** Callers: `core/routes/auth.ts` (E2-T10). */
export function createEmailVerificationToken(
  database: DrizzleDatabase,
  user: UserRow,
  options: { requestedIp?: string | null } = {},
): Promise<CreatedEmailVerification> {
  return runtime.runPromise(
    EmailVerification.use((service) => service.createEmailVerificationToken(user, options)).pipe(
      Database.withExecutor(database),
    ),
  );
}

/** Callers: `apps/api/test/password-reset.test.ts` (until its rewrite onto the service). */
export function findUsableEmailVerification(
  database: DrizzleDatabase,
  token: string,
): Promise<EmailVerificationTokenRow> {
  return runtime.runPromise(
    EmailVerification.use((service) => service.findUsableEmailVerification(token)).pipe(
      Database.withExecutor(database),
    ),
  );
}

/** Callers: `core/routes/auth.ts` (E2-T10). */
export function confirmEmailVerification(database: DrizzleDatabase, token: string): Promise<{ user: UserRow }> {
  return runtime.runPromise(
    EmailVerification.use((service) => service.confirmEmailVerification(token)).pipe(Database.withExecutor(database)),
  );
}

/**
 * Callers: `apps/api/test/verified-email-gate.test.ts` (until its rewrite onto the service), `scripts/seed.ts`
 * comment only. Without `at` the Clock's time is used (the service itself has no default).
 */
export function markEmailVerified(database: DrizzleDatabase, userId: string, at?: number): Promise<UserRow> {
  return runtime.runPromise(
    EmailVerification.use((service) =>
      Effect.gen(function* () {
        return yield* service.markEmailVerified(userId, at ?? (yield* Clock.currentTimeMillis));
      }),
    ).pipe(Database.withExecutor(database)),
  );
}

/** Callers: none outside this file's own export (kept for its old export; E2-T13 prunes). */
export function sweepExpiredVerificationTokens(database: DrizzleDatabase): Promise<void> {
  return runtime
    .runPromise(
      EmailVerification.use((service) => service.sweepExpiredVerificationTokens()).pipe(
        Database.withExecutor(database),
      ),
    )
    .catch(() => undefined);
}
