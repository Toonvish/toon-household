/**
 * OWNER: auth agent.
 *
 * Whether an account with an UNCONFIRMED e-mail address may write.
 *
 * WHY IT EXISTS. Registration is open, so anybody can mint an account and start
 * filling a group with recipes, imports and shopping lines. Requiring a confirmed
 * address before the first write costs a real spammer a working mailbox per
 * account and costs an honest user one click, so an unconfirmed account is
 * READ-ONLY: every GET works, accepting an invite works, and every write answers
 * 403 `email_unverified`.
 *
 * IT FOLLOWS THE MAILER, AND THAT IS THE WHOLE SAFETY STORY. `MAIL_TRANSPORT` is
 * unset by default — in `docker-compose.yml` too — so a fresh self-hosted stack
 * runs the ConsoleMailer and a confirmation link only ever reaches the server log.
 * Gating writes on clicking a link that was never mailed would turn `docker
 * compose up` into a permanently read-only app whose only way out is grepping the
 * log, so {@link isVerifiedEmailRequired} keys off {@link isMailConfigured} — the
 * same transport-name rule `mailDeliveryOf()` uses. No mail, no gate; configure
 * SMTP or Resend and it switches itself on. There is deliberately NO env variable
 * for this: the one people would set is the one that bricks the install.
 *
 * IT IS AN AUTHORISATION CHECK, NOT A CAPABILITY. Unlike
 * `services/import/capabilities.ts` the client is told the answer up front
 * (`features.verifiedEmailRequired` on `/api/health`) only so the UI can explain
 * itself; `requireVerifiedEmail()` in src/middleware/verifiedEmail.ts is what
 * actually enforces it.
 *
 * THE TIMESTAMP IS THE EVIDENCE, never the boolean — same rule as everywhere else
 * in this codebase, and for the same reason (see the header of
 * services/auth/emailVerification.ts): `email_verified` was once true for every
 * self-registration, so a gate reading it would have been open to exactly the
 * accounts it is meant to stop.
 *
 * THE SEAM ({@link setVerifiedEmailRequired}) exists because a test that wants the
 * gate ON would otherwise have to install a fake SMTP transport. Same discipline
 * as `setMailer` / `setOcrImportEnabled`: `bun test` runs every file in ONE
 * process, so a file that overrides this MUST hand it back
 * (`afterAll(() => setVerifiedEmailRequired(null))`) or the next file inherits it.
 */
import { Context, Effect, Layer } from "effect";
import { AppConfig } from "../../../config.ts";
import type { UserRow } from "../../../db/schema.ts";
import { env } from "../../../env.ts";
import { ApiFailure } from "../../../lib/errors.ts";
import { MailerService, isMailConfigured } from "../mail/index.ts";

/** Test override; `null` means "ask the mailer". */
let override: boolean | null = null;

/**
 * The rule itself, on plain values so the service and the sync bridge share it. OFF under `bun test` unless a file
 * asks for it. Deriving an AUTHORISATION rule from the installed mailer is right in production and poison in the
 * suite: `bun test` runs every file in one process, so any file that installs a non-console transport for its own
 * reasons (uploads.test.ts uses one named "test") would otherwise switch this gate on for every test after it and
 * turn unrelated writes into 403s. Same `isTest` escape services/mail/index.ts already takes to force a silent
 * ConsoleMailer.
 */
function requiredWhen(isTest: boolean, mailConfigured: () => boolean): boolean {
  if (override !== null) return override;
  if (isTest) return false;
  return mailConfigured();
}

/**
 * The gate as a service (plan e2 P2 table: depends on `AppConfig` and `Mailer`). `isRequired` follows the mailer that
 * would send right now (`MailerService.name` honours `setMailer`), `assertVerified` fails with `403
 * email_unverified` for an unconfirmed account where the gate is on.
 */
export class VerifiedEmail extends Context.Service<
  VerifiedEmail,
  {
    /** True when this deployment holds unconfirmed accounts to read-only. */
    readonly isRequired: Effect.Effect<boolean>;
    /** Fails with `403 email_unverified` when `user` may not write on this deployment. */
    readonly assertVerified: (user: { emailVerifiedAt?: number | string | null }) => Effect.Effect<void, ApiFailure>;
  }
>()("toon/api/core/services/auth/verifiedEmail/VerifiedEmail") {
  static readonly layer = Layer.effect(
    VerifiedEmail,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const mailer = yield* MailerService;
      const isRequired = Effect.sync(() => requiredWhen(config.isTest, () => mailer.name !== "console"));
      return VerifiedEmail.of({
        isRequired,
        assertVerified: (user) => Effect.flatMap(isRequired, (required) => verifyIn(required, user)),
      });
    }),
  );
}

/** `403 email_unverified` unless the gate is off or the account is confirmed. */
function verifyIn(
  required: boolean,
  user: { emailVerifiedAt?: number | string | null },
): Effect.Effect<void, ApiFailure> {
  if (!required || hasVerifiedEmail(user)) return Effect.void;
  return Effect.fail(
    new ApiFailure({ status: 403, code: "email_unverified", text: "server.auth.emailUnverified" }),
  );
}

/**
 * Forces the gate for a test. Pass `null` to restore the mail-derived value —
 * and do it in `afterAll`, or every later test file inherits this one's setting.
 */
export function setVerifiedEmailRequired(value: boolean | null): void {
  override = value;
}

/**
 * The only thing that counts as a confirmed address.
 *
 * `emailVerified` is the boolean the UI renders; `emailVerifiedAt` is the proof.
 * They are written together by `markEmailVerified()` and by nothing else, so
 * reading the timestamp here is belt and braces rather than paranoia — but it is
 * the half that was never true by default.
 */
export function hasVerifiedEmail(user: {
  emailVerifiedAt?: number | string | null;
}): boolean {
  // `!= null`, not `!== null`. The DTO types this `nullish()` so an OLD client's
  // round-tripped user can arrive `undefined`, and `!== null` would read the
  // absence of the field as proof the address was confirmed — the failure
  // direction that hands a spammer exactly what the gate exists to withhold.
  return user.emailVerifiedAt != null;
}

/** Narrowing helper so callers holding a full row read the same way. */
export type VerifiableUser = Pick<UserRow, "emailVerifiedAt">;

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/**
 * True when this deployment holds unconfirmed accounts to read-only.
 *
 * Follows {@link isMailConfigured} rather than an env variable — see the file
 * header for why an operator must not be able to switch this on without a
 * transport that can deliver the link it demands. Synchronous, as before.
 * Callers: `apps/api/src/core/health.ts`, recipe's import `capabilities.ts`, `assertEmailVerified`, the tests.
 */
export function isVerifiedEmailRequired(): boolean {
  return requiredWhen(env.isTest, isMailConfigured);
}

/**
 * Throws 403 `email_unverified` (synchronously) when `user` may not write on this deployment.
 *
 * Takes the DTO shape as well as the row, because the middleware only ever has
 * `c.get("user")` (an ISO string) while a service may hold a {@link UserRow}
 * (unix ms). Both are non-null exactly when the address is confirmed.
 * Callers: `apps/api/src/middleware/verifiedEmail.ts`.
 */
export function assertEmailVerified(user: { emailVerifiedAt?: number | string | null }): void {
  Effect.runSync(verifyIn(isVerifiedEmailRequired(), user));
}
