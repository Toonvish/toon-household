/**
 * The mail seam. Deliberately tiny: one method, no template engine, no
 * attachments — everything this app sends is a short German notice with one link.
 *
 * Mirrors `OcrEngine` (services/ocr/types.ts) so both swappable backends look the
 * same to a reader: an interface here, adapters next door, selection + a test
 * override in index.ts.
 */

export interface MailMessage {
  /** A single recipient address. */
  to: string;
  subject: string;
  /** Plain-text body. ALWAYS present — some clients never render the HTML part. */
  text: string;
  /** Optional HTML alternative. */
  html?: string;
}

export interface Mailer {
  /**
   * Delivers `message`. May reject: every caller wraps this in a try/catch and
   * treats a failure as non-fatal (see the note on {@link MailSendResult}).
   */
  send(message: MailMessage): Promise<void>;
  /** Short label for logs and diagnostics ("console", "resend"). */
  readonly name: string;
}

/**
 * What a caller reports back to the UI.
 *
 * Sending is NEVER allowed to fail the surrounding action: creating an invite
 * must still return its `inviteUrl` (the link is the source of truth, e-mail is a
 * convenience), and a failed reset mail must not tell the caller that the address
 * exists. So callers use {@link import("./index.ts").trySendMail} and surface
 * `delivered: false` as a soft warning at most.
 */
export interface MailSendResult {
  delivered: boolean;
  /** Adapter that handled (or refused) the message. */
  transport: string;
  /** German, log-safe reason when `delivered` is false. */
  error?: string;
}
