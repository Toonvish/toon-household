/**
 * The single place the rest of the API gets a `Mailer` from.
 *
 * Same shape as services/ocr/index.ts on purpose: `getMailer()` builds the
 * adapter selected by MAIL_TRANSPORT once, `setMailer()` replaces it (which is
 * how tests inject a fake and never open a socket), and `trySendMail()` is the
 * call every feature actually uses because a failed send may never break the
 * action that triggered it.
 */
import type { MailDelivery } from "@toon/shared";
import { env } from "../../../env.ts";
import { ConsoleMailer } from "./console.ts";
import { ResendMailer } from "./resend.ts";
import { SmtpMailer } from "./smtp.ts";
import type { MailMessage, MailSendResult, Mailer } from "./types.ts";

export type { MailMessage, MailSendResult, Mailer } from "./types.ts";
export { ConsoleMailer } from "./console.ts";
export { ResendMailer } from "./resend.ts";
export { SmtpMailer, type SmtpConfig, type SmtpSecurity } from "./smtp.ts";
export * from "./templates.ts";

let mailer: Mailer | null = null;
/** True while a test-provided mailer is installed. */
let overridden = false;

function buildMailer(): Mailer {
  if (env.mailTransport === "resend") {
    // env.ts already refused to boot without the key/sender, so these are set.
    return new ResendMailer(env.MAIL_API_KEY ?? "", env.mailFrom);
  }
  if (env.mailTransport === "smtp") {
    // Same story: MAIL_HOST and MAIL_FROM were checked at boot, and the
    // credentials-over-plaintext combination was refused there.
    return new SmtpMailer({
      host: env.MAIL_HOST ?? "",
      port: env.mailPort,
      security: env.mailSecurity,
      user: env.MAIL_USER,
      password: env.MAIL_PASSWORD,
      from: env.mailFrom,
      allowInsecureTls: env.MAIL_TLS_INSECURE === true,
    });
  }
  // Silent under `bun test`: dozens of invite/reset mails printed in full would
  // bury the actual test output. Tests that care read `ConsoleMailer.sent`.
  return env.isTest ? new ConsoleMailer(() => undefined) : new ConsoleMailer();
}

/** The shared mailer, created on first use. */
export function getMailer(): Mailer {
  mailer ??= buildMailer();
  return mailer;
}

/** Replaces the shared mailer. Pass `null` to restore the configured adapter. */
export function setMailer(next: Mailer | null): void {
  mailer = next;
  overridden = next !== null;
}

/** True when a non-default mailer is installed (tests, diagnostics). */
export function isMailerOverridden(): boolean {
  return overridden;
}

/**
 * True when this deployment can really deliver mail.
 *
 * Callers use it to decide what to TELL the user — e.g. the invite panel still
 * shows the copyable link, but only claims "wurde per E-Mail verschickt" when
 * this is true. It never gates whether an action is allowed.
 */
export function isMailConfigured(): boolean {
  return getMailer().name !== "console";
}

/**
 * Sends a message and NEVER throws.
 *
 * Every caller in this codebase is an action whose value does not depend on the
 * mail arriving: an invite is valid because the row exists and the link was
 * returned; `POST /password/forgot` answers 204 regardless so it cannot be used
 * to probe for accounts. So the failure is logged with its reason and reported
 * back as data, not raised.
 */
export async function trySendMail(message: MailMessage): Promise<MailSendResult> {
  const active = getMailer();
  try {
    await active.send(message);
    return { delivered: true, transport: active.name };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[mail] Sending to ${redactAddress(message.to)} failed (${active.name}): ${reason}`);
    return { delivered: false, transport: active.name, error: reason };
  }
}

/**
 * Turns a send result into the three-state status the contract exposes.
 *
 * The ConsoleMailer RESOLVES — it logged the message, that is its job — so
 * `delivered` alone reports "no mail configured" as a successful send, and a UI
 * built on it promises a mail that will never arrive. The transport name is what
 * separates the two, exactly as in {@link isMailConfigured}, and it lives here so
 * every endpoint answers the same way.
 */
export function mailDeliveryOf(result: MailSendResult): MailDelivery {
  if (result.transport === "console") return "not_configured";
  return result.delivered ? "sent" : "failed";
}

/**
 * `max@beispiel.de` -> `m***@beispiel.de`.
 *
 * hono's `logger()` and every reverse proxy keep API logs around for a long
 * time; a failed-send line should not be the place a full member list leaks from.
 */
export function redactAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}
