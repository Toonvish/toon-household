/**
 * The default mailer: writes the message to the log and sends nothing.
 *
 * This is what makes "no mail configured" a first-class, working setup rather
 * than a broken one — `bun run dev` prints the invite/reset link straight into
 * the terminal, and `bun test` never opens a socket.
 */
import type { MailMessage, Mailer } from "./types.ts";

export class ConsoleMailer implements Mailer {
  readonly name = "console";

  /** Everything sent through this instance, newest last. Handy in tests. */
  readonly sent: MailMessage[] = [];

  constructor(private readonly log: (message: string) => void = console.info) {}

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    const lines = [
      "",
      "┌─ [mail] NOT SENT — MAIL_TRANSPORT is not configured",
      `│  To:      ${message.to}`,
      `│  Subject: ${message.subject}`,
      "│",
      ...message.text.split(/\r?\n/).map((line) => `│  ${line}`),
      "└─────────────────────────────────────────────────────────────",
      "",
    ];
    this.log(lines.join("\n"));
  }
}
