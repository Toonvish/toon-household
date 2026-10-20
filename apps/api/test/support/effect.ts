/**
 * Running Effect programs in `bun test` (docs/EFFECT.md E9; plan `docs/plans/e2-api-core-services.md` P13).
 *
 * `runTest` and `runTestExit` run an effect on the APP `runtime` (`src/runtime.ts`), the one the routes use: its
 * `Database` is the shared temp file DB of ADR 0009, so a row a test writes through a service is the row
 * `app.request` sees. The runtime is never disposed here (every test file shares one process and one runtime).
 * `options.clock: "test"` provides `TestClock.layer()` around the effect: `Clock.currentTimeMillis` and
 * `DateTime.now` start at epoch 0 and move only with `TestClock.adjust` / `TestClock.setTime`.
 *
 * `itEffect(name, effect, timeoutMs?)` is `test(name, () => runTest(effect), timeoutMs)`; pass a thunk when the
 * effect must be built inside the test (after a `beforeAll`). A typed failure rejects with the error itself (the
 * squashed cause); assert one with `await runTest(Effect.flip(effect))`.
 *
 * `recordingMailer()` is a mail transport that records every message (and can be told to fail), `withMailer(mailer,
 * effect)` installs it through the `setMailer` seam for the length of one run and restores the configured adapter
 * afterwards, however the run ends (plan e2 P8, P13).
 */
import { test } from "bun:test";
import { Effect, type Exit } from "effect";
import { TestClock } from "effect/testing";
import { type MailMessage, type Mailer, setMailer } from "../../src/core/services/mail/index.ts";
import { type AppLayerError, type AppServices, runtime } from "../../src/runtime.ts";

export type { AppServices };

export interface RunTestOptions {
  /** `"test"` provides `TestClock.layer()` around the effect; the default is the live clock. */
  readonly clock?: "live" | "test";
}

function prepare<A, E>(effect: Effect.Effect<A, E, AppServices>, options?: RunTestOptions): Effect.Effect<A, E, AppServices> {
  return options?.clock === "test" ? effect.pipe(Effect.provide(TestClock.layer())) : effect;
}

/** Runs `effect` on the app runtime; a failure rejects with the squashed cause (the typed error itself). */
export function runTest<A, E>(effect: Effect.Effect<A, E, AppServices>, options?: RunTestOptions): Promise<A> {
  return runtime.runPromise(prepare(effect, options));
}

/** Runs `effect` on the app runtime and resolves with its `Exit` (never rejects). */
export function runTestExit<A, E>(
  effect: Effect.Effect<A, E, AppServices>,
  options?: RunTestOptions,
): Promise<Exit.Exit<A, E | AppLayerError>> {
  return runtime.runPromiseExit(prepare(effect, options));
}

/** A `bun:test` test whose body is an effect run by {@link runTest}. */
export function itEffect<A, E>(
  name: string,
  effect: Effect.Effect<A, E, AppServices> | (() => Effect.Effect<A, E, AppServices>),
  timeoutMs?: number,
  options?: RunTestOptions,
): void {
  test(
    name,
    async () => {
      await runTest(Effect.isEffect(effect) ? effect : effect(), options);
    },
    timeoutMs,
  );
}

/** A mail transport that records what it was asked to send. */
export interface RecordingMailer extends Mailer {
  /** Every message handed to `send`, in order, the failed ones included. */
  readonly messages: MailMessage[];
}

/**
 * A `Mailer` transport that records `MailMessage`s. `fail` makes `send` reject with `Error(fail)` (a string) or with
 * the given error; `name` defaults to `"recording"` (a non-console name, so `isMailConfigured()` is true while it is
 * installed).
 */
export function recordingMailer(options: { readonly name?: string; readonly fail?: string | Error } = {}): RecordingMailer {
  const messages: MailMessage[] = [];
  return {
    name: options.name ?? "recording",
    messages,
    async send(message: MailMessage): Promise<void> {
      messages.push(message);
      if (options.fail !== undefined) throw typeof options.fail === "string" ? new Error(options.fail) : options.fail;
    },
  };
}

/** Runs `effect` with `mailer` installed through `setMailer`, and restores the configured adapter afterwards. */
export function withMailer<A, E, R>(mailer: Mailer, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(() => setMailer(mailer)),
    () => effect,
    () => Effect.sync(() => setMailer(null)),
  );
}
