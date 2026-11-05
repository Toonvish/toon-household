/**
 * The OCR service and the single place the rest of the API gets an `OcrEngine` from (docs/EFFECT.md E3, E7; plan
 * `docs/plans/e3-recipe-services.md` P11).
 *
 * `getOcrEngine()` returns the process-wide TesseractEngine; `setOcrEngine()` replaces it, which is how tests inject a
 * fake engine and never run real Tesseract. `shutdownOcr()` is now a formality — the native engine holds no worker
 * between calls — but it stays on the interface so an engine that DOES own a handle (a sidecar, a cloud client with a
 * keep-alive pool) can be dropped in without changing any caller.
 *
 * AS A SERVICE. `Ocr` has four methods. `recognize` preprocesses the image (sharp) and recognises it: with a test engine
 * installed it calls that engine (a Promise seam, read AT CALL TIME); otherwise it runs the native `tesseract` program
 * (`tesseractRecognize`), whose child process and temp directory are scoped to that one run. `withOcrTimeout` is the hard
 * deadline and `withOcrSlot` the process-wide concurrency gate; both wrap an effect, and neither method's shape names a
 * `Scope`. The engine override and the gate are module-level state with their seams (`setOcrEngine`,
 * `setOcrConcurrencyForTests`, `ocrInFlight`, `ocrQueued`): `bun test` runs every file in one process and the gate is the
 * app's memory ceiling, so there is exactly one of it however many layers are built.
 *
 * The bridge section at the end keeps the Promise `withOcrSlot` for `routes/imports.ts` until E3-T11.
 */
import { Context, Effect, Layer } from "effect";
import { AppConfig } from "../../../../config.ts";
import { env } from "../../../../env.ts";
import { ApiFailure, type ErrorText } from "../../../../lib/errors.ts";
import { runtime } from "../../../../runtime.ts";
import { preprocessImage } from "./preprocess.ts";
import { type OcrFailure, fromSeamPromise } from "./seam.ts";
import { TesseractEngine, normalizeLangs, tesseractRecognize } from "./tesseract.ts";
import type { OcrEngine, OcrOptions, OcrResult } from "./types.ts";

export type { OcrBlock, OcrEngine, OcrOptions, OcrResult } from "./types.ts";
export { TesseractEngine, normalizeLangs } from "./tesseract.ts";
export { preprocessImage, TARGET_WIDTH } from "./preprocess.ts";

let engine: OcrEngine | null = null;
/** True while a test-provided engine is installed. */
let overridden = false;

/** The shared OCR engine, created on first use. */
export function getOcrEngine(): OcrEngine {
  engine ??= new TesseractEngine(env.TESSERACT_LANGS);
  return engine;
}

/**
 * Replaces the shared engine (tests, or a future alternative backend).
 * Pass `null` to restore the default Tesseract engine.
 */
export function setOcrEngine(next: OcrEngine | null): void {
  engine = next;
  overridden = next !== null;
}

/** True when a non-default engine is installed (used by diagnostics/tests). */
export function isOcrEngineOverridden(): boolean {
  return overridden;
}

/** Terminates the shared engine. Safe to call repeatedly. */
export async function shutdownOcr(): Promise<void> {
  const current = engine;
  engine = null;
  overridden = false;
  if (current) await current.shutdown();
}

/** Default hard limit for a single OCR operation. */
export const OCR_TIMEOUT_MS = 60_000;

/**
 * How long a request waits for a slot before giving up with 429.
 *
 * A QUEUE, NOT AN IMMEDIATE REJECT — which reverses the earlier decision here, and
 * the reason is the concurrency default of 1. With two slots a collision needed
 * two simultaneous uploads and "try again" was a fair answer; with one slot a
 * second family member photographing a recipe collides routinely, and telling them
 * to retry a 30-second job is worse than making them wait for it. The old
 * objection — that a queue only moves the timeout somewhere the user cannot see it
 * — is answered by bounding the wait AND by the fact that OCR_TIMEOUT_MS starts
 * after acquisition, so queueing never eats the recognition's own budget.
 */
export const OCR_SLOT_WAIT_MS = 30_000;

/* --------------------------- concurrency gate ----------------------------- */

/**
 * How many OCR/PDF pipelines may run at the same time, process-wide (`AppConfig.ocrConcurrency`, the variable
 * `IMPORT_OCR_CONCURRENCY`, overridden by {@link setOcrConcurrencyForTests}).
 *
 * Each one holds up to 15 MB of image bytes, runs sharp, and spawns a `tesseract`
 * process. SINCE THE ENGINE WENT NATIVE THIS IS THE ONLY BOUND ON OCR CONCURRENCY:
 * the tesseract.js engine also serialized internally, because one WASM worker
 * cannot run two recognitions at once, whereas separate processes can. So this
 * number is directly the peak number of concurrent tesseract processes — i.e. the
 * app's memory ceiling. Raise it only with a measurement (`docker stats` during
 * two parallel photo imports).
 *
 * IT DEFAULTS TO 1. It used to be a hardcoded 2 — which docs/deployment.md already
 * told operators to lower, naming a variable that did not exist. One job saturates
 * a one-core VPS on its own, and two peaked past what a 1 GB box has, so the small
 * deployment gets the safe number by default and a bigger box opts into more.
 */

/**
 * How many may wait at once, as a multiple of the slot count. Each waiter is
 * already holding its buffered upload (the body is read before the slot is taken),
 * so the queue costs memory too: at the default that is 2 × 15 MB worst case.
 * Beyond this the answer is an immediate 429 rather than an unbounded backlog.
 */
const MAX_WAITERS_PER_SLOT = 2;

/** A request queued for a slot. `granted` is set by the baton pass, just before `resume`. */
interface SlotWaiter {
  granted: boolean;
  readonly resume: (effect: Effect.Effect<void, ApiFailure>) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

let inFlightOcr = 0;
let concurrencyOverride: number | null = null;
const waiting: SlotWaiter[] = [];

/** For diagnostics/tests: pipelines currently holding a slot. */
export function ocrInFlight(): number {
  return inFlightOcr;
}

/** For diagnostics/tests: requests currently waiting for a slot. */
export function ocrQueued(): number {
  return waiting.length;
}

/**
 * Forces the slot count for a test (`env` is frozen at module load). Pass `null`
 * to restore it — in `afterEach`/`afterAll`, or every later file inherits it.
 */
export function setOcrConcurrencyForTests(limit: number | null): void {
  concurrencyOverride = limit;
}

function tooManyError(maxConcurrent: number): ApiFailure {
  return new ApiFailure({
    status: 429,
    code: "rate_limited",
    text: "server.ocr.tooManyConcurrentRecognitions",
    details: { maxConcurrent },
  });
}

/**
 * Takes a slot: at once when one is free, with `429 rate_limited` at once when the queue is full, otherwise it queues a
 * waiter and the wait is bounded by `waitMs`.
 *
 * An `Effect.callback`, so that interrupting a QUEUED waiter runs the cancel effect it returns: the timer is cleared, the
 * waiter leaves the queue (`ocrQueued()` drops at once), and when the baton pass had already handed it the slot but the
 * fiber was interrupted before its release was registered (`granted`), the slot is handed on instead of leaking.
 */
function acquireSlot(waitMs: number, limit: () => number): Effect.Effect<void, ApiFailure> {
  return Effect.callback<void, ApiFailure>((resume) => {
    if (inFlightOcr < limit()) {
      inFlightOcr += 1;
      resume(Effect.void);
      return;
    }
    if (waiting.length >= limit() * MAX_WAITERS_PER_SLOT) {
      resume(Effect.fail(tooManyError(limit())));
      return;
    }
    const waiter: SlotWaiter = {
      granted: false,
      resume,
      timer: setTimeout(() => {
        const index = waiting.indexOf(waiter);
        if (index >= 0) waiting.splice(index, 1);
        resume(Effect.fail(tooManyError(limit())));
      }, waitMs),
    };
    waiting.push(waiter);
    return Effect.sync(() => {
      clearTimeout(waiter.timer);
      const index = waiting.indexOf(waiter);
      if (index >= 0) waiting.splice(index, 1);
      else if (waiter.granted) releaseSlot();
    });
  });
}

/**
 * Frees the slot — by HANDING IT TO THE NEXT WAITER rather than decrementing and
 * letting whoever calls next win the race. Without the baton pass a request that
 * arrived while somebody was queued could take the slot in front of them, which on
 * a busy box is how a waiter reaches its 30 s deadline with slots repeatedly
 * passing it by.
 */
function releaseSlot(): void {
  const next = waiting.shift();
  if (next === undefined) {
    inFlightOcr -= 1;
    return;
  }
  clearTimeout(next.timer);
  next.granted = true;
  next.resume(Effect.void);
}

/* -------------------------------- the service ------------------------------ */

/** The OCR service: recognition, the hard timeout and the concurrency gate. */
export class Ocr extends Context.Service<
  Ocr,
  {
    /**
     * Preprocesses `bytes` (sharp) and recognises the text: the installed test engine when there is one (read at call
     * time), otherwise the native `tesseract` run. Fails `415` for an undecodable image and `422 ocr_failed` for a
     * recognition failure; an unexpected rejection of a test engine is a defect.
     */
    readonly recognize: (bytes: Uint8Array, options?: OcrOptions) => Effect.Effect<OcrResult, OcrFailure>;
    /**
     * Runs `effect` while holding one of the concurrency slots, waiting up to `waitMs` for one to free up (tests only:
     * a route uses the documented {@link OCR_SLOT_WAIT_MS}). `429 rate_limited` when the queue is full or the wait
     * expires; an interrupted waiter leaves the queue at once.
     */
    readonly withOcrSlot: <A, E>(effect: Effect.Effect<A, E>, waitMs?: number) => Effect.Effect<A, E | ApiFailure>;
    /**
     * Runs `effect` with a hard timeout that is REALLY hard: the client always gets `504 ocr_failed` at `timeoutMs`, and
     * the abandoned work is interrupted (its signal aborted, its scoped child killed). `Effect.tryPromise` does not
     * await a Promise that ignores its signal (`unpdf`), so the deadline holds for it too.
     */
    readonly withOcrTimeout: <A, E>(
      effect: Effect.Effect<A, E>,
      timeoutMs?: number,
      text?: ErrorText,
    ) => Effect.Effect<A, E | ApiFailure>;
    /** Drops and shuts down the current engine ({@link shutdownOcr}); safe to run repeatedly. */
    readonly shutdown: () => Effect.Effect<void, unknown>;
  }
>()("toon/api/modules/recipe/services/ocr/index/Ocr") {
  static readonly layer = Layer.effect(
    Ocr,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const limit = (): number => concurrencyOverride ?? config.ocrConcurrency;
      const native = { bin: config.TESSERACT_BIN, langs: normalizeLangs(config.TESSERACT_LANGS) };

      const recognize = Effect.fn("Ocr.recognize")(function* (
        bytes: Uint8Array,
        options: OcrOptions = {},
      ): Effect.fn.Return<OcrResult, OcrFailure> {
        const prepared = yield* preprocessImage(bytes);
        const current = engine;
        if (overridden && current !== null) {
          return yield* fromSeamPromise((signal) => current.recognize(prepared.bytes, { ...options, signal }));
        }
        return yield* tesseractRecognize(prepared.bytes, options, native);
      });

      // NOT the bracketing form of acquire and release: its acquire runs uninterruptibly, so an interrupt would never
      // reach a queued waiter. `acquireRelease` with `interruptible` runs the acquire under `restore` and registers the release only
      // once the acquire succeeded (plan e3 P11).
      const withOcrSlot = <A, E>(effect: Effect.Effect<A, E>, waitMs: number = OCR_SLOT_WAIT_MS) =>
        Effect.scoped(
          Effect.andThen(
            Effect.acquireRelease(acquireSlot(waitMs, limit), () => Effect.sync(releaseSlot), { interruptible: true }),
            effect,
          ),
        );

      const withOcrTimeout = <A, E>(
        effect: Effect.Effect<A, E>,
        timeoutMs: number = OCR_TIMEOUT_MS,
        text: ErrorText = "server.ocr.recognitionTimedOut",
      ) =>
        Effect.timeoutOrElse(effect, {
          duration: timeoutMs,
          orElse: () => Effect.fail(new ApiFailure({ status: 504, code: "ocr_failed", text, details: { timeoutMs } })),
        });

      const shutdown = () => Effect.tryPromise({ try: () => shutdownOcr(), catch: (cause): unknown => cause });

      return Ocr.of({ recognize, withOcrSlot, withOcrTimeout, shutdown });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/**
 * Runs `operation` while holding one of the slots, waiting up to `waitMs` for one to free up. A failure of
 * `operation` rejects with the error itself. Callers: `apps/api/src/modules/recipe/routes/imports.ts` (the three
 * upload routes; E3-T11 moves them onto `Ocr.withOcrSlot`).
 */
export function withOcrSlot<T>(operation: () => Promise<T>, waitMs: number = OCR_SLOT_WAIT_MS): Promise<T> {
  return runtime.runPromise(
    Ocr.use((ocr) => ocr.withOcrSlot(Effect.tryPromise({ try: operation, catch: (cause): unknown => cause }), waitMs)),
  );
}
