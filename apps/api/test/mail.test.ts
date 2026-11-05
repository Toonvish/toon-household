/**
 * The mail seam: adapter selection, the "a failed send never breaks the action"
 * contract, and the German templates.
 *
 * No test here opens a socket. `ResendMailer` is exercised against a stubbed
 * `fetch`, everything else against the ConsoleMailer.
 *
 * `trySendMail` is exercised through the `MailerService` (E2-T04) and, once, through the sync-adapter bridge that the
 * routes still call; the `setMailer` seam is what installs a fake in both.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect, Layer } from "effect";
import { AppConfig } from "../src/config.ts";
import { VerifiedEmail, setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import {
  ConsoleMailer,
  MailerService,
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
import { recordingMailer, runTest, withMailer } from "./support/effect.ts";

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

/** A mailer whose `send` THROWS synchronously instead of returning a rejected promise. */
class ThrowingMailer implements Mailer {
  readonly name = "throwing";
  send(): Promise<void> {
    throw new Error("sofort kaputt");
  }
}

const trySend = (message: MailMessage) => MailerService.use((mailer) => mailer.trySendMail(message));

describe("trySendMail", () => {
  test("reports delivery and records the message", async () => {
    const recorder = new ConsoleMailer(() => undefined);

    const result = await runTest(
      withMailer(recorder, trySend({ to: "a@b.de", subject: "Hallo", text: "Text" })),
    );

    expect(result).toEqual({ delivered: true, transport: "console" });
    expect(recorder.sent).toHaveLength(1);
    expect(recorder.sent[0]?.subject).toBe("Hallo");
  });

  test("NEVER throws — a broken transport is data, not an exception", async () => {
    const result = await runTest(
      withMailer(new BrokenMailer(), trySend({ to: "a@b.de", subject: "Hallo", text: "Text" })),
    );

    expect(result.delivered).toBe(false);
    expect(result.transport).toBe("broken");
    expect(result.error).toContain("verifiziert");
  });

  test("survives a transport whose send() THROWS synchronously, and logs the [mail] line", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await runTest(
        withMailer(new ThrowingMailer(), trySend({ to: "maxine@b.de", subject: "Hallo", text: "Text" })),
      );

      expect(result).toEqual({ delivered: false, transport: "throwing", error: "sofort kaputt" });
      expect(logged).toHaveBeenCalledWith("[mail] Sending to m***@b.de failed (throwing): sofort kaputt");

      // The Promise bridge (its one caller is this test, E8 removes it) has the same contract.
      setMailer(new ThrowingMailer());
      expect(await trySendMail({ to: "a@b.de", subject: "Hallo", text: "Text" })).toEqual({
        delivered: false,
        transport: "throwing",
        error: "sofort kaputt",
      });
    } finally {
      logged.mockRestore();
    }
  });

  test("a rejection with a non-Error value is reported as its string", async () => {
    const odd: Mailer = { name: "odd", send: () => Promise.reject("nur ein Text") };
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await runTest(withMailer(odd, trySend({ to: "a@b.de", subject: "s", text: "t" })));
      expect(result).toEqual({ delivered: false, transport: "odd", error: "nur ein Text" });
    } finally {
      logged.mockRestore();
    }
  });

  test("send() fails with a MailError carrying the transport and the reason (outside the API family)", async () => {
    const failing = recordingMailer({ name: "relay", fail: "relay down" });
    const error = await runTest(
      withMailer(failing, Effect.flip(MailerService.use((mailer) => mailer.send({ to: "a@b.de", subject: "s", text: "t" })))),
    );
    expect(error._tag).toBe("MailError");
    expect(error.transport).toBe("relay");
    expect(error.reason).toBe("relay down");
    expect(failing.messages).toHaveLength(1);
  });

  test("the service reports the name of the installed transport", async () => {
    const name = await runTest(withMailer(recordingMailer({ name: "relay" }), MailerService.use((mailer) => Effect.succeed(mailer.name))));
    expect(name).toBe("relay");
    expect(await runTest(MailerService.use((mailer) => Effect.succeed(mailer.name)))).toBe("console");
  });
});

describe("MailerService layers", () => {
  const BASE = { DATABASE_URL: "file:./data/x.db", SESSION_SECRET: "0123456789abcdef", NODE_ENV: "development" };
  const nameUnder = (values: Record<string, string>) =>
    Effect.runPromise(
      MailerService.use((mailer) => Effect.succeed(mailer.name)).pipe(
        Effect.provide(MailerService.layer.pipe(Layer.provide(AppConfig.layerFrom({ ...BASE, ...values })))),
      ),
    );

  test("MAIL_TRANSPORT picks the transport; unset is the console", async () => {
    expect(await nameUnder({})).toBe("console");
    expect(await nameUnder({ MAIL_TRANSPORT: "smtp", MAIL_HOST: "smtp.test", MAIL_FROM: "a@b.de" })).toBe("smtp");
    expect(await nameUnder({ MAIL_TRANSPORT: "resend", MAIL_API_KEY: "re_k", MAIL_FROM: "a@b.de" })).toBe("resend");
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

describe("VerifiedEmail follows the mailer (E2-T04)", () => {
  const BASE = { DATABASE_URL: "file:./data/x.db", SESSION_SECRET: "0123456789abcdef", NODE_ENV: "development" };
  const requiredUnder = (values: Record<string, string>) =>
    Effect.runPromise(
      VerifiedEmail.use((gate) => gate.isRequired).pipe(
        Effect.provide(
          VerifiedEmail.layer.pipe(
            Layer.provide(MailerService.layer),
            Layer.provideMerge(AppConfig.layerFrom({ ...BASE, ...values })),
          ),
        ),
      ),
    );

  afterEach(() => setVerifiedEmailRequired(null));

  test("off for the console transport, on once a transport that can deliver is configured", async () => {
    expect(await requiredUnder({})).toBe(false);
    expect(await requiredUnder({ MAIL_TRANSPORT: "smtp", MAIL_HOST: "smtp.test", MAIL_FROM: "a@b.de" })).toBe(true);
  });

  test("always off under the test env, even with a transport installed", async () => {
    const required = await runTest(
      withMailer(recordingMailer({ name: "relay" }), VerifiedEmail.use((gate) => gate.isRequired)),
    );
    expect(required).toBe(false);
  });

  test("the override seam wins: assertVerified fails with 403 email_unverified for an unconfirmed account", async () => {
    setVerifiedEmailRequired(true);
    const error = await runTest(
      Effect.flip(VerifiedEmail.use((gate) => gate.assertVerified({ emailVerifiedAt: null }))),
    );
    expect(error._tag).toBe("ApiFailure");
    expect(error.status).toBe(403);
    expect(error.code).toBe("email_unverified");
    await runTest(VerifiedEmail.use((gate) => gate.assertVerified({ emailVerifiedAt: 1 })));
  });
});
