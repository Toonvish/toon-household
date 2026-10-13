/**
 * The mail seam: adapter selection, the "a failed send never breaks the action"
 * contract, and the German templates.
 *
 * No test here opens a socket. `ResendMailer` is exercised against a stubbed
 * `fetch`, everything else against the ConsoleMailer.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ConsoleMailer,
  ResendMailer,
  getMailer,
  inviteMail,
  isMailConfigured,
  isMailerOverridden,
  passwordResetMail,
  redactAddress,
  setMailer,
  trySendMail,
  verifyEmailMail,
} from "../src/core/services/mail/index.ts";
import type { MailMessage, Mailer } from "../src/core/services/mail/index.ts";

// Every file shares one process, so restore the configured adapter around each
// test instead of trusting whatever ran before.
beforeEach(() => setMailer(null));
afterEach(() => setMailer(null));

/** A mailer that always fails, to prove callers survive it. */
class BrokenMailer implements Mailer {
  readonly name = "broken";
  async send(): Promise<void> {
    throw new Error("Domain ist nicht verifiziert");
  }
}

describe("mailer selection", () => {
  test("defaults to the ConsoleMailer, so an install without mail still works", () => {
    expect(getMailer().name).toBe("console");
    expect(isMailConfigured()).toBe(false);
    expect(isMailerOverridden()).toBe(false);
  });

  test("setMailer() swaps the adapter and null restores the default", () => {
    const fake = new ConsoleMailer(() => undefined);
    setMailer(fake);
    expect(getMailer()).toBe(fake);
    expect(isMailerOverridden()).toBe(true);

    setMailer(null);
    expect(getMailer().name).toBe("console");
    expect(isMailerOverridden()).toBe(false);
  });
});

describe("trySendMail", () => {
  test("reports delivery and records the message", async () => {
    const recorder = new ConsoleMailer(() => undefined);
    setMailer(recorder);

    const result = await trySendMail({ to: "a@b.de", subject: "Hallo", text: "Text" });

    expect(result).toEqual({ delivered: true, transport: "console" });
    expect(recorder.sent).toHaveLength(1);
    expect(recorder.sent[0]?.subject).toBe("Hallo");
  });

  test("NEVER throws — a broken transport is data, not an exception", async () => {
    setMailer(new BrokenMailer());

    const result = await trySendMail({ to: "a@b.de", subject: "Hallo", text: "Text" });

    expect(result.delivered).toBe(false);
    expect(result.transport).toBe("broken");
    expect(result.error).toContain("verifiziert");
  });
});

describe("redactAddress", () => {
  test("keeps the domain but not the local part (API logs are long-lived)", () => {
    expect(redactAddress("maxine@beispiel.de")).toBe("m***@beispiel.de");
    expect(redactAddress("kaputt")).toBe("***");
  });
});

describe("ResendMailer", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("posts the message and sends the key only in the Authorization header", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    }) as unknown as typeof fetch;

    await new ResendMailer("re_secret", "Rezepte <no@reply.de>").send({
      to: "gast@beispiel.de",
      subject: "Betreff",
      text: "Nur Text",
      html: "<p>HTML</p>",
    });

    expect(seen?.url).toBe("https://api.resend.com/emails");
    const headers = seen?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_secret");
    const payload = JSON.parse(String(seen?.init.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      from: "Rezepte <no@reply.de>",
      to: ["gast@beispiel.de"],
      subject: "Betreff",
      text: "Nur Text",
      html: "<p>HTML</p>",
    });
  });

  test("rejects with the provider's reason on a non-2xx", async () => {
    globalThis.fetch = (async () =>
      new Response("The domain is not verified", { status: 403 })) as unknown as typeof fetch;

    const mailer = new ResendMailer("re_secret", "a@b.de");
    await expect(mailer.send({ to: "x@y.de", subject: "s", text: "t" })).rejects.toThrow(
      /403.*not verified/,
    );
  });

  test("omits html when there is none", async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: unknown, init: RequestInit = {}) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await new ResendMailer("k", "a@b.de").send({ to: "x@y.de", subject: "s", text: "t" });
    expect("html" in body).toBe(false);
  });
});

describe("templates", () => {
  /** Every template must fill BOTH parts and put the link in the plain text too. */
  function assertShape(message: MailMessage, url: string): void {
    expect(message.text).toContain(url);
    expect(message.html).toContain(url);
    expect(message.subject.length).toBeGreaterThan(0);
  }

  test("invite mail names the group and the inviter, in German", () => {
    const message = inviteMail({
      to: "gast@beispiel.de",
      groupName: "Familie",
      invitedByName: "Maxine",
      inviteUrl: "https://app.test/invite/tok",
      expiresInDays: 14,
      locale: "de",
    });

    expect(message.to).toBe("gast@beispiel.de");
    expect(message.subject).toContain("Familie");
    expect(message.text).toContain("Maxine");
    expect(message.text).toContain("14 Tage");
    assertShape(message, "https://app.test/invite/tok");
  });

  test("reset mail states the one-time, all-devices consequence", () => {
    const message = passwordResetMail({
      to: "max@beispiel.de",
      name: "Max",
      resetUrl: "https://app.test/reset-password/tok",
      expiresInMinutes: 60,
      locale: "de",
    });

    expect(message.text).toContain("60 Minuten");
    expect(message.text).toContain("abgemeldet");
    expect(message.text).toContain("einmal verwendet");
    assertShape(message, "https://app.test/reset-password/tok");
  });

  test("verification mail is German and time-bounded", () => {
    const message = verifyEmailMail({
      to: "max@beispiel.de",
      name: "Max",
      verifyUrl: "https://app.test/verify-email/tok",
      expiresInHours: 24,
      locale: "de",
    });

    expect(message.subject).toContain("bestätige");
    expect(message.text).toContain("24 Stunden");
    assertShape(message, "https://app.test/verify-email/tok");
  });

  test("escapes HTML so a group name can never inject markup", () => {
    const message = inviteMail({
      to: "gast@beispiel.de",
      groupName: '<img src=x onerror="alert(1)">',
      invitedByName: "Maxine",
      inviteUrl: "https://app.test/invite/tok",
      expiresInDays: 14,
      locale: "de",
    });

    expect(message.html).not.toContain("<img src=x");
    expect(message.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
