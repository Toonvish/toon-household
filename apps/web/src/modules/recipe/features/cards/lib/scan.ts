/**
 * Camera scanning — the ONLY place in the app that touches zxing-wasm.
 *
 * ## Why a WebAssembly decoder at all
 *
 * Reading a barcode off a camera frame and DRAWING one are completely different
 * problems, and this app answers them differently on purpose:
 *
 *  - **Drawing** is done by `@toon/shared`'s own encoders (a few kB of pure JS,
 *    always in the bundle, works in airplane mode). That is the path a card takes
 *    at a till, so it may not depend on anything that can fail to load.
 *  - **Reading** happens ONCE per card, at home, while adding it. `BarcodeDetector`
 *    would have been free — but Safari does not implement it, and an iPhone is the
 *    single most likely device to be holding this app in a supermarket. So the
 *    decoder is zxing-wasm, ~1.1 MB, `import()`ed the first time the scanner opens
 *    and never before.
 *
 * The wasm is deliberately NOT in the service worker's precache (`globPatterns` in
 * vite.config.ts lists no `wasm`): it would add a megabyte to every install and
 * every update for a feature used once per card, and it is the one part of this
 * feature that legitimately needs a connection. Typing the number always works
 * offline, which is what the scanner's error copy points at.
 *
 * ## Structure
 *
 * `loadDecoder()` owns the wasm module and is memoised for the tab;
 * `scanFromCamera()` owns the camera stream and the polling loop. Both are plain
 * async functions rather than a hook, because the scanner dialog has to tear them
 * down from an effect's cleanup without a re-render in between.
 */
import type { BarcodeFormat } from "@toon/shared";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { cardFormatFromScan } from "./formats.ts";

/** What a successful scan yields — exactly the two fields the form needs. */
export interface ScanResult {
  format: BarcodeFormat;
  value: string;
}

/** Why scanning cannot continue. Each maps to one line of catalog copy. */
export type ScanFailure =
  /** getUserMedia refused: no permission, or the user dismissed the prompt. */
  | "permission"
  /** No camera on this device, or the browser exposes none. */
  | "unavailable"
  /** The decoder itself could not be fetched (offline, blocked). */
  | "load"
  /** A code was read, but it is a symbology this app cannot draw. */
  | "unsupported";

export class ScanError extends Error {
  readonly failure: ScanFailure;

  constructor(failure: ScanFailure, cause?: unknown) {
    super(`scan failed: ${failure}`, cause === undefined ? undefined : { cause });
    this.name = "ScanError";
    this.failure = failure;
  }
}

/* -------------------------------------------------------------------------- */
/* the decoder                                                                */
/* -------------------------------------------------------------------------- */

type ReadBarcodes = (
  input: ImageData,
  options?: { tryHarder?: boolean; maxNumberOfSymbols?: number },
) => Promise<Array<{ text: string; format: string; isValid?: boolean }>>;

/**
 * The loaded module, kept for the lifetime of the tab.
 *
 * A promise, not a value, so two dialogs opened in quick succession share ONE
 * fetch. Reset to null when the load fails, so "try again" really retries instead
 * of resolving the old rejection forever.
 */
let decoderPromise: Promise<ReadBarcodes> | null = null;

async function loadDecoder(): Promise<ReadBarcodes> {
  if (decoderPromise === null) {
    decoderPromise = (async () => {
      const { prepareZXingModule, readBarcodes } = await import("zxing-wasm/reader");
      // Without this the module fetches its wasm from a CDN, which would be an
      // external request from an app that has none, and would break behind a
      // strict CSP. `wasmUrl` is the hashed asset Vite emitted from our own
      // node_modules copy, so the bytes are same-origin and version-locked to
      // the glue code that loads them.
      prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });
      return readBarcodes as unknown as ReadBarcodes;
    })().catch((cause: unknown) => {
      decoderPromise = null;
      throw new ScanError("load", cause);
    });
  }
  return decoderPromise;
}

/* -------------------------------------------------------------------------- */
/* the camera                                                                */
/* -------------------------------------------------------------------------- */

/** How often a frame is decoded. 250 ms is well inside "feels instant". */
const FRAME_INTERVAL_MS = 250;
/** Longest edge of the frame handed to the decoder, in pixels. */
const MAX_FRAME_EDGE = 1024;

export interface CameraScan {
  /** Resolves with the first supported code, or rejects with a {@link ScanError}. */
  result: Promise<ScanResult>;
  /** Stops the camera and the decode loop. Safe to call twice. */
  stop: () => void;
}

/** True when this browser can even be asked for a camera. */
export function isCameraAvailable(): boolean {
  return typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia !== undefined;
}

/**
 * Opens the rear camera into `video` and decodes its frames until something
 * readable turns up.
 *
 * THE CALLER SUPPLIES THE ELEMENT, and it must be the one on screen. Decoding from
 * an off-document `<video>` created here looked cleaner and is a trap: Safari
 * refuses to play a detached element, so `videoWidth` stays 0, every frame is
 * skipped and the scanner "just never finds anything" — on the one browser this
 * whole WebAssembly decoder exists for (see the header).
 *
 * The caller must call `stop()` on unmount. A camera left running is a battery
 * drain and a privacy problem, and an indicator light that stays on after a dialog
 * closes reads as a bug.
 */
export async function scanFromCamera(video: HTMLVideoElement): Promise<CameraScan> {
  if (!isCameraAvailable()) throw new ScanError("unavailable");

  // Load the decoder BEFORE asking for the camera: a megabyte over a slow
  // connection behind a live viewfinder looks like a frozen picture.
  const readBarcodes = await loadDecoder();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (cause) {
    // NotFoundError/OverconstrainedError = there is no such camera; everything
    // else (NotAllowedError, SecurityError) is a permission problem.
    const name = cause instanceof DOMException ? cause.name : "";
    throw new ScanError(
      name === "NotFoundError" || name === "OverconstrainedError" ? "unavailable" : "permission",
      cause,
    );
  }

  video.srcObject = stream;
  // Both are required for autoplay without a user gesture on iOS; the dialog sets
  // them as JSX attributes too, and setting them here keeps this function correct
  // whoever calls it.
  video.muted = true;
  video.playsInline = true;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };

  const result = new Promise<ScanResult>((resolve, reject) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      stop();
      reject(new ScanError("load"));
      return;
    }

    /**
     * One frame. A code that decodes to a symbology we cannot draw REJECTS rather
     * than being skipped: silently ignoring it would leave the user pointing the
     * camera at their card forever with no idea why nothing happens.
     */
    const tick = async (): Promise<void> => {
      if (stopped) return;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width > 0 && height > 0) {
        const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(width, height));
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        const found = await readBarcodes(frame, { tryHarder: true, maxNumberOfSymbols: 1 });
        const hit = found.find((candidate) => candidate.text.length > 0);
        if (hit !== undefined) {
          const format = cardFormatFromScan(hit.format);
          stop();
          if (format === null) reject(new ScanError("unsupported"));
          else resolve({ format, value: hit.text });
          return;
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), FRAME_INTERVAL_MS);
    };

    // Fire-and-forget: a rejected `play()` (an autoplay policy, a backgrounded tab)
    // must not abort the scan — the loop simply finds `videoWidth === 0` until
    // there are frames, and the dialog's own copy tells the user what is happening.
    void video.play().catch(() => undefined);
    timer = setTimeout(() => void tick(), FRAME_INTERVAL_MS);
  });

  return { result, stop };
}
