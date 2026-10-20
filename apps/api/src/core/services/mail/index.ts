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
import { Cause, Context, DateTime, Effect, Layer, Predicate, Schema } from "effect";
import { AppConfig, type Env } from "../../../config.ts";
import { env } from "../../../env.ts";
import { ConsoleMailer } from "./console.ts";
import { ResendMailer } from "./resend.ts";
import { SmtpMailer, type SmtpConfig } from "./smtp.ts";
import type { MailMessage, MailSendResult, Mailer } from "./types.ts";

export type { MailMessage, MailSendResult, Mailer } from "./types.ts";
export { ConsoleMailer } from "./console.ts";
export { ResendMailer } from "./resend.ts";
export { SmtpMailer, type SmtpConfig, type SmtpSecurity } from "./smtp.ts";
export * from "./templates.ts";

/**
 * A transport failed to deliver a message (`reason` is the log-safe text of whatever it threw or rejected with).
 * Deliberately OUTSIDE the API error family (plan e2 P8): it never reaches the wire, because every caller goes
 * through `trySendMail`, which turns it into a `MailSendResult`.
 */
export class MailError extends Schema.TaggedError<MailError>()("MailError", {
  transport: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

/** The one-line reason a failed send logs and reports: an `Error`'s message, otherwise the value as a string. */
function reasonOf(error: unknown): string {
  return Predicate.isError(error) ? error.message : String(error);
}

/**
 * What the `MailerService` layers wrap: a name and a send that is handed the Clock's time (only the SMTP `Date:` header
 * uses it). The legacy `Mailer` interface of `types.ts` (what `setMailer` fakes implement) is unchanged.
 */
interface Transport {
  readonly name: string;
  readonly send: (message: MailMessage, now: Date) => Promise<void>;
}

/** A transport that ignores the time: console, Resend, a `setMailer` fake. */
function plain(transport: Mailer): Transport {
  return { name: transport.name, send: (message) => transport.send(message) };
}

/**
 * The service: `send` fails with `MailError`, `trySendMail` NEVER fails (it catches the whole cause, a transport
 * that throws synchronously included, and logs `[mail] Sending to <redacted> failed (<transport>): <reason>`). `name`
 * is the name of the transport that would send right now (a `setMailer` override wins), so `VerifiedEmail` and
 * `isMailConfigured` read the same fact. The class is called `MailerService` because `Mailer` is, and stays, the
 * transport interface that the `setMailer` fakes implement (`types.ts`).
 */
export class MailerService extends Context.Service<
  MailerService,
  {
    readonly name: string;
    readonly send: (message: MailMessage) => Effect.Effect<void, MailError>;
    readonly trySendMail: (message: MailMessage) => Effect.Effect<MailSendResult>;
  }
>()("toon/api/core/services/mail/index/Mailer") {
  /** The configured transport is the console, silent under `NODE_ENV=test`. */
  static readonly layerConsole = Layer.effect(
    MailerService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      return makeMailer(plain(config.isTest ? new ConsoleMailer(() => undefined) : new ConsoleMailer()));
    }),
  );

  /** SMTP; the `Date:` header carries the `Clock`'s time. */
  static layerSmtp(config: SmtpConfig): Layer.Layer<MailerService> {
    return Layer.sync(MailerService, () => {
      const smtp = new SmtpMailer(config);
      return makeMailer({ name: smtp.name, send: (message, now) => smtp.send(message, now) });
    });
  }

  /** Resend over `fetch`. */
  static layerResend(apiKey: string, from: string): Layer.Layer<MailerService> {
    return Layer.sync(MailerService, () => makeMailer(plain(new ResendMailer(apiKey, from))));
  }

  /** The transport `MAIL_TRANSPORT` selects (console when unset), chosen at build from the `AppConfig`. */
  static readonly layer: Layer.Layer<MailerService, never, AppConfig> = Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* AppConfig;
      if (config.mailTransport === "resend") {
        // env.ts already refused to boot without the key/sender, so these are set.
        return MailerService.layerResend(config.MAIL_API_KEY ?? "", config.mailFrom);
      }
      if (config.mailTransport === "smtp") return MailerService.layerSmtp(smtpConfigOf(config));
      return MailerService.layerConsole;
    }),
  );
}

/** The `Mailer` service over `base`; a `setMailer` override is consulted at send time, so it wins over `base`. */
function makeMailer(base: Transport): MailerService["Service"] {
  const active = (): Transport => (overridden && mailer !== null ? plain(mailer) : base);

  const send = Effect.fn("Mailer.send")(function* (message: MailMessage) {
    const transport = active();
    const now = yield* DateTime.nowAsDate;
    return yield* Effect.tryPromise({
      try: () => transport.send(message, now),
      catch: (cause) => new MailError({ transport: transport.name, reason: reasonOf(cause) }),
    });
  });

  const trySendMail = Effect.fn("Mailer.trySendMail")(function* (message: MailMessage) {
    const transport = active();
    return yield* send(message).pipe(
      Effect.as<MailSendResult>({ delivered: true, transport: transport.name }),
      // The WHOLE cause, defects included: the old `try/catch` saw everything (plan e2 P2).
      Effect.catchCause((cause) => {
        const reason = reasonOf(Cause.squash(cause));
        console.error(`[mail] Sending to ${redactAddress(message.to)} failed (${transport.name}): ${reason}`);
        return Effect.succeed<MailSendResult>({ delivered: false, transport: transport.name, error: reason });
      }),
    );
  });

  return {
    get name() {
      return active().name;
    },
    send,
    trySendMail,
  };
}

/** The `MAIL_*` fields every transport choice reads (`AppConfig`'s value or the process `env`). */
type MailConfig = Pick<
  Env,
  | "isTest"
  | "mailTransport"
  | "MAIL_API_KEY"
  | "MAIL_HOST"
  | "MAIL_USER"
  | "MAIL_PASSWORD"
  | "MAIL_TLS_INSECURE"
  | "mailPort"
  | "mailSecurity"
  | "mailFrom"
>;

function smtpConfigOf(config: MailConfig): SmtpConfig {
  // Same story as the key: MAIL_HOST and MAIL_FROM were checked at boot, and the
  // credentials-over-plaintext combination was refused there.
  return {
    host: config.MAIL_HOST ?? "",
    port: config.mailPort,
    security: config.mailSecurity,
    user: config.MAIL_USER,
    password: config.MAIL_PASSWORD,
    from: config.mailFrom,
    allowInsecureTls: config.MAIL_TLS_INSECURE === true,
  };
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

let mailer: Mailer | null = null;
/** True while a test-provided mailer is installed. */
let overridden = false;

function buildMailer(): Mailer {
  if (env.mailTransport === "resend") {
    // env.ts already refused to boot without the key/sender, so these are set.
    return new ResendMailer(env.MAIL_API_KEY ?? "", env.mailFrom);
  }
  if (env.mailTransport === "smtp") return new SmtpMailer(smtpConfigOf(env));
  // Silent under `bun test`: dozens of invite/reset mails printed in full would
  // bury the actual test output. Tests that care read `ConsoleMailer.sent`.
  return env.isTest ? new ConsoleMailer(() => undefined) : new ConsoleMailer();
}

/** The shared mailer, created on first use. Callers: `trySendMail` below, the tests, `isMailConfigured`. */
export function getMailer(): Mailer {
  mailer ??= buildMailer();
  return mailer;
}

/** Replaces the shared mailer; every `MailerService` consults it at send time. Pass `null` to restore the configured adapter. */
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
 *
 * The bridge over `MailerService`'s logic for the callers that hold no runtime (core routes until E2-T10, the
 * `auth:reset-password` script): it sends through `getMailer()`, which honours `setMailer`.
 */
export function trySendMail(message: MailMessage): Promise<MailSendResult> {
  const service = makeMailer(plain(getMailer()));
  return Effect.runPromise(service.trySendMail(message));
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
