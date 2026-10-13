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
import type { UserRow } from "../../../db/schema.ts";
import { env } from "../../../env.ts";
import { ApiError } from "../../../lib/errors.ts";
import { isMailConfigured } from "../mail/index.ts";

/** Test override; `null` means "ask the mailer". */
let override: boolean | null = null;

/**
 * True when this deployment holds unconfirmed accounts to read-only.
 *
 * Follows {@link isMailConfigured} rather than an env variable — see the file
 * header for why an operator must not be able to switch this on without a
 * transport that can deliver the link it demands.
 */
export function isVerifiedEmailRequired(): boolean {
  if (override !== null) return override;
  // OFF under `bun test` unless a file asks for it. Deriving an AUTHORISATION
  // rule from the installed mailer is right in production and poison in the
  // suite: `bun test` runs every file in one process, so any file that installs
  // a non-console transport for its own reasons (uploads.test.ts uses one named
  // "test") would otherwise switch this gate on for every test after it and turn
  // unrelated writes into 403s. Same `env.isTest` escape services/mail/index.ts
  // already takes to force a silent ConsoleMailer.
  if (env.isTest) return false;
  return isMailConfigured();
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

/**
 * Throws 403 `email_unverified` when `user` may not write on this deployment.
 *
 * Takes the DTO shape as well as the row, because the middleware only ever has
 * `c.get("user")` (an ISO string) while a service may hold a {@link UserRow}
 * (unix ms). Both are non-null exactly when the address is confirmed.
 */
export function assertEmailVerified(user: {
  emailVerifiedAt?: number | string | null;
}): void {
  if (!isVerifiedEmailRequired()) return;
  if (hasVerifiedEmail(user)) return;
  throw new ApiError(403, "email_unverified", "server.auth.emailUnverified");
}

/** Narrowing helper so callers holding a full row read the same way. */
export type VerifiableUser = Pick<UserRow, "emailVerifiedAt">;
