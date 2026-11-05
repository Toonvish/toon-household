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
 *
 * An Effect program on the one `AppLayer` (docs/EFFECT.md E10; plan `docs/plans/e5-scripts.md` P1, P18): each
 * service is yielded once and its method called on the value; exits 1 and 2 are `ScriptExit` values, not
 * `process.exit` calls.
 */
import { isLocale } from "@toon/shared";
import { Console, Effect } from "effect";
import { AppLayer } from "../src/runtime.ts";
import { AppConfig } from "../src/config.ts";
import { webUrl } from "../src/lib/oauth.ts";
import { PASSWORD_RESET_TTL_MINUTES, PasswordReset } from "../src/core/services/auth/passwordReset.ts";
import { Users } from "../src/core/services/auth/users.ts";
import { MailerService, isMailConfigured, passwordResetMail } from "../src/core/services/mail/index.ts";
import { ScriptExit, runScript } from "./support/main.ts";

const USAGE = [
  "Usage: bun run auth:reset-password <email> [--send]",
  "",
  "  <email>    account to mint a reset link for",
  "  --send     also try to email the link (needs MAIL_TRANSPORT)",
].join("\n");

const resetPassword = Effect.gen(function* () {
  const args = process.argv.slice(2);
  const email = args.find((value) => !value.startsWith("-"));
  const send = args.includes("--send");
  if (email === undefined || email.length === 0) {
    yield* Console.error(USAGE);
    return yield* new ScriptExit({ code: 1 });
  }

  const config = yield* AppConfig;
  const users = yield* Users;
  const resets = yield* PasswordReset;
  const mailer = yield* MailerService;

  const user = yield* users.findUserByEmail(email);
  // `user.email === null` cannot happen (a lookup by e-mail never finds a placeholder, ADR 0006);
  // the guard narrows the type and keeps the message honest if it ever did.
  if (!user || user.email === null) {
    // An operator on a terminal is not an enumeration risk — unlike the HTTP
    // endpoint, this MUST say plainly that the address is unknown, otherwise the
    // answer to "why did the link not work?" is unfindable.
    yield* Console.error(`No account with the address ${email} found (DB: ${config.databaseKind}).`);
    return yield* new ScriptExit({ code: 2 });
  }

  const { token, expiresAt } = yield* resets.createPasswordResetToken(user.id, { requestedIp: "cli" });
  const resetUrl = webUrl(`/reset-password/${token}`);

  yield* Console.log("");
  yield* Console.log(`Account:  ${user.name} <${user.email}>`);
  yield* Console.log(`Valid:    ${PASSWORD_RESET_TTL_MINUTES} minutes (until ${new Date(expiresAt).toISOString()})`);
  if (!user.passwordHash) {
    yield* Console.log("Note:     This account had no password so far (OAuth only).");
  }
  yield* Console.log("");
  yield* Console.log(resetUrl);
  yield* Console.log("");
  yield* Console.log("The link can be used exactly ONCE and signs out every device afterwards.");

  if (send) {
    const result = yield* mailer.trySendMail(
      passwordResetMail({
        to: user.email,
        name: user.name,
        resetUrl,
        expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
        locale: isLocale(user.locale) ? user.locale : config.defaultLocale,
      }),
    );
    yield* Console.log(
      result.delivered
        ? `Sent by email (${result.transport}).`
        : `Not sent (${result.transport}${result.error ? `: ${result.error}` : ""}).${
            isMailConfigured() ? "" : " MAIL_TRANSPORT is not configured."
          }`,
    );
  }
});

if (import.meta.main) {
  runScript(resetPassword.pipe(Effect.provide(AppLayer)));
}
