#!/usr/bin/env bun
/**
 * `bun run auth:reset-password <email> [--send]`
 *
 * The operator escape hatch for a locked-out password-only account. Mints exactly
 * the same token as `POST /api/auth/password/forgot` and prints the reset URL, so
 * it works on an install with NO mail configured at all — which is the point.
 *
 * It does NOT set a password itself. Whoever runs this can already read the
 * database, but a printed link still leaves the new password known only to the
 * user, and it leaves the same audit row behind as the self-service flow.
 *
 * `--send` additionally tries to mail the link (no-op beyond a log line when
 * MAIL_TRANSPORT is unset).
 *
 * Runs against DATABASE_URL from the root .env, like every other script here.
 */
import { isLocale } from "@toon/shared";
import { db } from "../src/db/client.ts";
import { env } from "../src/env.ts";
import { webUrl } from "../src/lib/oauth.ts";
import {
  PASSWORD_RESET_TTL_MINUTES,
  createPasswordResetToken,
} from "../src/core/services/auth/passwordReset.ts";
import { findUserByEmail } from "../src/core/services/auth/users.ts";
import { isMailConfigured, passwordResetMail, trySendMail } from "../src/core/services/mail/index.ts";

function usage(): never {
  console.error(
    [
      "Usage: bun run auth:reset-password <email> [--send]",
      "",
      "  <email>    account to mint a reset link for",
      "  --send     also try to email the link (needs MAIL_TRANSPORT)",
    ].join("\n"),
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const email = args.find((value) => !value.startsWith("-"));
const send = args.includes("--send");
if (email === undefined || email.length === 0) usage();

const user = await findUserByEmail(db, email);
// `user.email === null` cannot happen (a lookup by e-mail never finds a placeholder, ADR 0006);
// the guard narrows the type and keeps the message honest if it ever did.
if (!user || user.email === null) {
  // An operator on a terminal is not an enumeration risk — unlike the HTTP
  // endpoint, this MUST say plainly that the address is unknown, otherwise the
  // answer to "why did the link not work?" is unfindable.
  console.error(`No account with the address ${email} found (DB: ${env.databaseKind}).`);
  process.exit(2);
}

const { token, expiresAt } = await createPasswordResetToken(db, user.id, { requestedIp: "cli" });
const resetUrl = webUrl(`/reset-password/${token}`);

console.log("");
console.log(`Account:  ${user.name} <${user.email}>`);
console.log(`Valid:    ${PASSWORD_RESET_TTL_MINUTES} minutes (until ${new Date(expiresAt).toISOString()})`);
if (!user.passwordHash) {
  console.log("Note:     This account had no password so far (OAuth only).");
}
console.log("");
console.log(resetUrl);
console.log("");
console.log("The link can be used exactly ONCE and signs out every device afterwards.");

if (send) {
  const result = await trySendMail(
    passwordResetMail({
      to: user.email,
      name: user.name,
      resetUrl,
      expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
      locale: isLocale(user.locale) ? user.locale : env.defaultLocale,
    }),
  );
  console.log(
    result.delivered
      ? `Sent by email (${result.transport}).`
      : `Not sent (${result.transport}${result.error ? `: ${result.error}` : ""}).${
          isMailConfigured() ? "" : " MAIL_TRANSPORT is not configured."
        }`,
  );
}

process.exit(0);
