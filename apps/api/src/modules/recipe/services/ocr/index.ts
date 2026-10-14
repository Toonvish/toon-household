/**
 * The single place the rest of the API gets an `OcrEngine` from.
 *
 * `getOcrEngine()` returns the process-wide TesseractEngine; `setOcrEngine()`
 * replaces it, which is how tests inject a fake engine and never run real
 * Tesseract. `shutdownOcr()` is now a formality — the native engine holds no
 * worker between calls — but it stays on the interface so an engine that DOES own
 * a handle (a sidecar, a cloud client with a keep-alive pool) can be dropped in
 * without changing any caller.
 */
import { env } from "../../../../env.ts";
import { ApiError, type ErrorText } from "../../../../lib/errors.ts";
import { preprocessImage } from "./preprocess.ts";
import { TesseractEngine } from "./tesseract.ts";
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
 * Runs `operation` with a hard timeout that is REALLY hard.
 *
 * The signal is only PARTLY honoured downstream, so this must stay a
 * `Promise.race`. The native OCR engine does respect it (aborting kills the
 * `tesseract` child), but `unpdf`'s extractText still ignores it entirely — and
 * awaiting the operation while merely relabelling its rejection meant a stuck
 * extraction held the request open forever, however loudly the constant was named
 * OCR_TIMEOUT_MS. So: the client always gets an answer at `timeoutMs`, and the
 * abandoned work is still aborted (best effort) so it stops burning CPU.
 *
 * @throws ApiError 504 `ocr_failed` when the budget is exhausted.
 */
export async function withOcrTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = OCR_TIMEOUT_MS,
  message: ErrorText = "server.ocr.recognitionTimedOut",
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("ocr_timeout"));
      reject(new ApiError(504, "ocr_failed", message, { timeoutMs }));
    }, timeoutMs);
  });

  const work = (async () => operation(controller.signal))();
  // Nothing may await `work` after the race is lost, or bun reports an unhandled
  // rejection when the abandoned operation eventually fails.
  work.catch(() => undefined);

  try {
    return await Promise.race([work, deadline]);
  } catch (error) {
    if (timedOut && !(error instanceof ApiError)) {
      throw new ApiError(504, "ocr_failed", message, { timeoutMs });
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/* --------------------------- concurrency gate ----------------------------- */

/**
 * How many OCR/PDF pipelines may run at the same time, process-wide.
 *
 * Each one holds up to 15 MB of image bytes, runs sharp, and spawns a `tesseract`
 * process. SINCE THE ENGINE WENT NATIVE THIS IS THE ONLY BOUND ON OCR CONCURRENCY:
 * the tesseract.js engine also serialized internally, because one WASM worker
 * cannot run two recognitions at once, whereas separate processes can. So this
 * number is directly the peak number of concurrent tesseract processes — i.e. the
 * app's memory ceiling. Raise it only with a measurement (`docker stats` during
 * two parallel photo imports).
 *
 * IT IS `IMPORT_OCR_CONCURRENCY` AND IT DEFAULTS TO 1. It used to be a hardcoded 2
 * — which docs/deployment.md already told operators to lower, naming a variable
 * that did not exist. One job saturates a one-core VPS on its own, and two peaked
 * past what a 1 GB box has, so the small deployment gets the safe number by
 * default and a bigger box opts into more.
 */
export function ocrConcurrencyLimit(): number {
  return concurrencyOverride ?? env.ocrConcurrency;
}

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

/**
 * How many may wait at once, as a multiple of the slot count. Each waiter is
 * already holding its buffered upload (the body is read before the slot is taken),
 * so the queue costs memory too: at the default that is 2 × 15 MB worst case.
 * Beyond this the answer is an immediate 429 rather than an unbounded backlog.
 */
const MAX_WAITERS_PER_SLOT = 2;

interface SlotWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
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

function tooManyError(): ApiError {
  return new ApiError(429, "rate_limited", "server.ocr.tooManyConcurrentRecognitions", {
    maxConcurrent: ocrConcurrencyLimit(),
  });
}

/**
 * Runs `operation` while holding one of {@link ocrConcurrencyLimit} slots, waiting
 * up to `waitMs` for one to free up.
 *
 * @param waitMs override for the wait budget. Tests only — a route must use the
 *   documented {@link OCR_SLOT_WAIT_MS} so the behaviour is the same everywhere.
 * @throws ApiError 429 `rate_limited` when the queue is full or the wait expires.
 */
export async function withOcrSlot<T>(
  operation: () => Promise<T>,
  waitMs: number = OCR_SLOT_WAIT_MS,
): Promise<T> {
  await acquireOcrSlot(waitMs);
  try {
    return await operation();
  } finally {
    releaseOcrSlot();
  }
}

function acquireOcrSlot(waitMs: number): Promise<void> {
  if (inFlightOcr < ocrConcurrencyLimit()) {
    inFlightOcr += 1;
    return Promise.resolve();
  }
  if (waiting.length >= ocrConcurrencyLimit() * MAX_WAITERS_PER_SLOT) {
    return Promise.reject(tooManyError());
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: SlotWaiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = waiting.indexOf(waiter);
        if (index >= 0) waiting.splice(index, 1);
        reject(tooManyError());
      }, waitMs),
    };
    waiting.push(waiter);
  });
}

/**
 * Frees the slot — by HANDING IT TO THE NEXT WAITER rather than decrementing and
 * letting whoever calls next win the race. Without the baton pass a request that
 * arrived while somebody was queued could take the slot in front of them, which on
 * a busy box is how a waiter reaches its 30 s deadline with slots repeatedly
 * passing it by.
 */
function releaseOcrSlot(): void {
  const next = waiting.shift();
  if (next === undefined) {
    inFlightOcr -= 1;
    return;
  }
  clearTimeout(next.timer);
  next.resolve();
}

/** Convenience: preprocess + recognise in one call. */
export async function recognizeImage(
  bytes: Uint8Array,
  options: OcrOptions = {},
  ocrEngine: OcrEngine = getOcrEngine(),
): Promise<OcrResult> {
  const prepared = await preprocessImage(bytes);
  return await ocrEngine.recognize(prepared.bytes, options);
}
