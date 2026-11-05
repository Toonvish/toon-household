/**
 * Which import sources this deployment offers.
 *
 * WHY THIS EXISTS. URL and text import are pure fetch-and-parse: no native
 * binaries, nothing large resident. Photo and PDF import are the opposite — they
 * need `tesseract` and `pdftoppm` installed (~120 MB of packages plus language
 * data), and while a job runs they hold `sharp`, a preprocessed bitmap and, for a
 * PDF, `unpdf`'s whole parsed document in memory. On a small VPS that is the
 * difference between comfortable and swapping, so it is opt-in: `IMPORT_OCR_ENABLED`
 * is **off unless set**.
 *
 * TWO FLAGS, NOT ONE. `IMPORT_OCR_ENABLED` is photos and `IMPORT_PDF_ENABLED` is
 * PDFs, because a one-core box can serve the first and provably cannot serve the
 * second (see `isPdfImportEnabled`). The PDF flag DEFAULTS to the photo flag, so a
 * deployment that never asks for the split behaves exactly as it did before.
 *
 * WHAT THEY GATE. Only the three upload endpoints (`/imports/image`, `/imports/pdf`,
 * `/imports/file`), which answer **501 `ocr_disabled`** when off. Everything
 * else is untouched: `/imports/url`, `/imports/text`, drafts, review and commit all
 * work, and a draft created earlier by OCR stays reviewable and committable. The
 * services themselves are NOT gated — they keep their unit tests, and a route that
 * is never reached never loads sharp, unpdf or spawns tesseract.
 *
 * IT IS A CAPABILITY, NOT AN AUTHORISATION CHECK. The client is told the answer up
 * front (`features.ocrImport` on `/api/health`) so the UI can stop offering photo
 * and PDF import, but the 501 is what actually enforces it — an installed PWA can
 * be running a bundle from before the flag was flipped, and it will still POST.
 *
 * THE SEAM (`setOcrImportEnabled`) exists because `env` is validated once and
 * frozen at module load, so a test cannot flip the variable. Same discipline as
 * `setMailer` / `setOcrEngine` / `setPdfRasterizer`: `bun test` runs every file in
 * ONE process, so a file that overrides this MUST hand it back
 * (`afterAll(() => setOcrImportEnabled(null))`) or the next file inherits it.
 *
 * AS A SERVICE (docs/EFFECT.md E7; plan `docs/plans/e3-recipe-services.md` P7). `ImportCapabilities`
 * reads the two flags from `AppConfig` (captured when the layer is built) under the seams above,
 * which are read on every call, so a test still flips them between requests. `capabilityFlags` is
 * the service-free form `/api/health` uses (the manifest's `healthFeatures`). The sync reads
 * `isOcrImportEnabled()` / `isPdfImportEnabled()` stay plain functions over `env`.
 */
import { Context, Effect, Layer } from "effect";
import { AppConfig } from "../../../../config.ts";
import { env } from "../../../../env.ts";
import { ApiFailure } from "../../../../lib/errors.ts";

/** Test overrides; `null` means "ask env". */
let override: boolean | null = null;
let pdfOverride: boolean | null = null;

/** True when PHOTO import is available on this deployment. */
export function isOcrImportEnabled(): boolean {
  return override ?? env.ocrImportEnabled;
}

/**
 * True when PDF import is available.
 *
 * SEPARATE FROM PHOTOS ON PURPOSE. A photo is one tesseract run on one bitmap; a
 * scanned PDF is up to MAX_PDF_PAGES of them plus poppler, and even a digital one
 * hands `unpdf` the whole parsed document. On a one-core VPS the scan cannot
 * finish inside OCR_TIMEOUT_MS however much RAM it has, so "photos yes, PDFs no"
 * is a real deployment and not a half-configured one. `IMPORT_PDF_ENABLED` unset
 * follows `IMPORT_OCR_ENABLED`, so nothing changes for a deployment that never
 * asks for the split.
 */
export function isPdfImportEnabled(): boolean {
  return pdfOverride ?? env.pdfImportEnabled;
}

/**
 * Forces the photo flag for a test. Pass `null` to restore the environment's
 * value — and do it in `afterAll`, or every later test file inherits this one's
 * setting.
 */
export function setOcrImportEnabled(value: boolean | null): void {
  override = value;
}

/** Forces the PDF flag for a test. Same `afterAll` discipline as above. */
export function setPdfImportEnabled(value: boolean | null): void {
  pdfOverride = value;
}

/** The two flags as `AppConfig` holds them under the seams, read at call time. */
function flagsOf(config: { readonly ocrImportEnabled: boolean; readonly pdfImportEnabled: boolean }): {
  ocrImport: boolean;
  pdfImport: boolean;
} {
  return { ocrImport: override ?? config.ocrImportEnabled, pdfImport: pdfOverride ?? config.pdfImportEnabled };
}

/** `501 ocr_disabled` with the given catalog text (a wire contract: same code for photos and PDFs). */
function ocrDisabled(text: "server.import.ocrDisabled" | "server.import.pdfDisabled"): ApiFailure {
  return new ApiFailure({ status: 501, code: "ocr_disabled", text });
}

/**
 * Guard for the photo endpoints. Call it FIRST in the handler — before the rate
 * limiter and before the multipart body is read — so a disabled server does not
 * accept 15 MB it is only going to throw away.
 */
const checkOcr = Effect.fnUntraced(function* (flags: { ocrImport: boolean }) {
  if (flags.ocrImport) return;
  return yield* ocrDisabled("server.import.ocrDisabled");
});

/**
 * Guard for the PDF endpoints.
 *
 * The MESSAGE depends on the other flag, because the two configurations need
 * different advice: on a lean server (neither) the broad "photo or PDF is off,
 * use a web address" is the true one, while on the image-only build the user
 * should be told that photos DO work. Same `ocr_disabled` code either way — it is
 * a wire contract, and the client's handling is identical.
 */
const checkPdf = Effect.fnUntraced(function* (flags: { ocrImport: boolean; pdfImport: boolean }) {
  if (flags.pdfImport) return;
  return yield* ocrDisabled(flags.ocrImport ? "server.import.pdfDisabled" : "server.import.ocrDisabled");
});

/**
 * Guard for `/imports/file`, which accepts either kind. It can only rule out the
 * case where NEITHER is available — that is the one worth catching early, since
 * it is the whole lean deployment. Which specific kind arrived is not known until
 * the body has been sniffed, so the per-kind guard runs after the read.
 */
const checkAnyUpload = Effect.fnUntraced(function* (flags: { ocrImport: boolean; pdfImport: boolean }) {
  if (flags.ocrImport || flags.pdfImport) return;
  return yield* ocrDisabled("server.import.ocrDisabled");
});

/**
 * The capability block the recipe manifest's `healthFeatures` reports on `/api/health`
 * (`features.ocrImport`, `features.pdfImport`), so the UI can hide what is off. The core adds
 * `verifiedEmailRequired` ahead of it (`src/core/health.ts`).
 */
export const capabilityFlags: Effect.Effect<{ ocrImport: boolean; pdfImport: boolean }, never, AppConfig> =
  Effect.gen(function* () {
    return flagsOf(yield* AppConfig);
  });

/** Which import sources this deployment offers, as a service (plan e3 P7). */
export class ImportCapabilities extends Context.Service<
  ImportCapabilities,
  {
    /** True when PHOTO import is available. */
    readonly ocrImportEnabled: Effect.Effect<boolean>;
    /** True when PDF import is available. */
    readonly pdfImportEnabled: Effect.Effect<boolean>;
    /** `501 ocr_disabled` (`server.import.ocrDisabled`) unless photo import is on. */
    readonly checkOcrImportEnabled: Effect.Effect<void, ApiFailure>;
    /** `501 ocr_disabled` unless PDF import is on; the text depends on the photo flag. */
    readonly checkPdfImportEnabled: Effect.Effect<void, ApiFailure>;
    /** `501 ocr_disabled` (`server.import.ocrDisabled`) when neither kind is on. */
    readonly checkAnyUploadImportEnabled: Effect.Effect<void, ApiFailure>;
  }
>()("toon/api/modules/recipe/services/import/capabilities/ImportCapabilities") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const flags = Effect.sync(() => flagsOf(config));
      return ImportCapabilities.of({
        ocrImportEnabled: Effect.map(flags, (current) => current.ocrImport),
        pdfImportEnabled: Effect.map(flags, (current) => current.pdfImport),
        checkOcrImportEnabled: Effect.flatMap(flags, checkOcr),
        checkPdfImportEnabled: Effect.flatMap(flags, checkPdf),
        checkAnyUploadImportEnabled: Effect.flatMap(flags, checkAnyUpload),
      });
    }),
  );
}
