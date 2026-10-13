/**
 * Resend adapter — a plain `fetch` POST, no dependency.
 *
 * Chosen over SMTP because it needs nothing but an API key and a verified sender
 * domain. The trade-off is a third party in the delivery path; a self-hosted
 * install that would rather not have that keeps MAIL_TRANSPORT unset (see
 * console.ts) or adds an `smtp.ts` next to this file — the {@link Mailer}
 * interface is the whole contract.
 */
import type { MailMessage, Mailer } from "./types.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Hard cap on one delivery attempt. Without it a hanging provider would hold the
 * request that triggered the send (invite creation) open for the default fetch
 * timeout — and the invite must be fast whether or not mail works.
 */
const SEND_TIMEOUT_MS = 10_000;

export class ResendMailer implements Mailer {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The body carries the actionable part ("domain is not verified"), so keep
      // it — but bounded, and never the API key, which only travels in a header.
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`Resend antwortete ${response.status}${detail ? `: ${detail}` : ""}`);
    }
  }
}
