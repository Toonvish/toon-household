/**
 * Every message this app can send, as pure functions: input -> `MailMessage`.
 *
 * No I/O and no URL building here — the caller passes the finished link, because
 * only the caller knows whether it points at the web app (`WEB_ORIGIN`) or at
 * something an operator printed on a terminal. That keeps these testable and
 * keeps the "which origin?" decision in one place per feature.
 *
 * All copy is resolved through the server catalog for the recipient's `locale`
 * (docs/i18n.md §8) — German stays the byte-identical default, English is the
 * second locale. Both parts are always filled: `text` is what most mail clients
 * actually show for a short notice, `html` only makes the link tappable.
 */
import { type Locale, SERVER_CATALOGS, createTranslator } from "@toon/shared";
import type { Translator } from "@toon/shared";
import type { MailMessage } from "./types.ts";

/** Both locale catalogs share the same key/placeholder shape (§2); pick one as the type. */
type ServerTranslator = Translator<typeof SERVER_CATALOGS.de>;

/** Escapes the four characters that can break out of HTML text or an attribute. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function translatorFor(locale: Locale): ServerTranslator {
  return createTranslator(SERVER_CATALOGS[locale], locale) as ServerTranslator;
}

/**
 * One shared HTML skeleton: a heading, paragraphs, a button and a plain copy of
 * the link. Inline styles only — mail clients drop <style> blocks.
 */
function htmlDocument(options: {
  locale: Locale;
  heading: string;
  paragraphs: readonly string[];
  action: { label: string; url: string };
  footer: string;
}): string {
  const t = translatorFor(options.locale);
  const paragraphs = options.paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#3b3733">${escapeHtml(text)}</p>`,
    )
    .join("");
  const url = escapeHtml(options.action.url);
  return [
    `<div style="margin:0 auto;max-width:520px;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#faf5ee">`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#1f1c19">${escapeHtml(options.heading)}</h1>`,
    paragraphs,
    `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#c2532c;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">${escapeHtml(options.action.label)}</a></p>`,
    `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#6b635b">${escapeHtml(t("server.mail.buttonFallback"))}<br><span style="word-break:break-all">${url}</span></p>`,
    `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#8a8078">${escapeHtml(options.footer)}</p>`,
    `</div>`,
  ].join("");
}

/* -------------------------------------------------------------------------- */
/* group invite                                                               */
/* -------------------------------------------------------------------------- */

export interface InviteMailInput {
  to: string;
  groupName: string;
  invitedByName: string;
  inviteUrl: string;
  /** Days until the link stops working (INVITE_TTL_DAYS). */
  expiresInDays: number;
  locale: Locale;
}

export function inviteMail(input: InviteMailInput): MailMessage {
  const t = translatorFor(input.locale);
  const heading = t("server.mail.invite.heading", {
    invitedByName: input.invitedByName,
    groupName: input.groupName,
  });
  const paragraphs = [
    t("server.mail.invite.body1", { invitedByName: input.invitedByName, groupName: input.groupName }),
    t("server.mail.invite.body2"),
  ];
  const footer = t("server.mail.invite.footer", { days: input.expiresInDays });
  return {
    to: input.to,
    subject: t("server.mail.invite.subject", { groupName: input.groupName }),
    text: [heading, "", ...paragraphs, "", input.inviteUrl, "", footer].join("\n"),
    html: htmlDocument({
      locale: input.locale,
      heading,
      paragraphs,
      action: { label: t("server.mail.invite.actionLabel"), url: input.inviteUrl },
      footer,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* password reset                                                             */
/* -------------------------------------------------------------------------- */

export interface PasswordResetMailInput {
  to: string;
  name: string;
  resetUrl: string;
  /** Minutes until the token expires (PASSWORD_RESET_TTL_MS). */
  expiresInMinutes: number;
  locale: Locale;
}

export function passwordResetMail(input: PasswordResetMailInput): MailMessage {
  const t = translatorFor(input.locale);
  const heading = t("server.mail.passwordReset.heading");
  const paragraphs = [
    t("server.mail.passwordReset.body1", { name: input.name }),
    t("server.mail.passwordReset.body2"),
  ];
  const footer = t("server.mail.passwordReset.footer", { minutes: input.expiresInMinutes });
  return {
    to: input.to,
    subject: t("server.mail.passwordReset.subject"),
    text: [heading, "", ...paragraphs, "", input.resetUrl, "", footer].join("\n"),
    html: htmlDocument({
      locale: input.locale,
      heading,
      paragraphs,
      action: { label: t("server.mail.passwordReset.actionLabel"), url: input.resetUrl },
      footer,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* e-mail verification                                                        */
/* -------------------------------------------------------------------------- */

export interface VerifyEmailMailInput {
  to: string;
  name: string;
  verifyUrl: string;
  /** Hours until the token expires (EMAIL_VERIFICATION_TTL_MS). */
  expiresInHours: number;
  locale: Locale;
}

export function verifyEmailMail(input: VerifyEmailMailInput): MailMessage {
  const t = translatorFor(input.locale);
  const heading = t("server.mail.verifyEmail.heading");
  const paragraphs = [
    t("server.mail.verifyEmail.body1", { name: input.name }),
    t("server.mail.verifyEmail.body2"),
  ];
  const footer = t("server.mail.verifyEmail.footer", { hours: input.expiresInHours });
  return {
    to: input.to,
    subject: t("server.mail.verifyEmail.subject"),
    text: [heading, "", ...paragraphs, "", input.verifyUrl, "", footer].join("\n"),
    html: htmlDocument({
      locale: input.locale,
      heading,
      paragraphs,
      action: { label: t("server.mail.verifyEmail.actionLabel"), url: input.verifyUrl },
      footer,
    }),
  };
}
