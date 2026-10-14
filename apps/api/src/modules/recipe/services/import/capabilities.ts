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
 */
import type { ServerFeatures } from "@toon/shared";
import { env } from "../../../../env.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { isVerifiedEmailRequired } from "../../../../core/services/auth/verifiedEmail.ts";

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

/**
 * Guard for the photo endpoints. Call it FIRST in the handler — before the rate
 * limiter and before the multipart body is read — so a disabled server does not
 * accept 15 MB it is only going to throw away.
 */
export function assertOcrImportEnabled(): void {
  if (isOcrImportEnabled()) return;
  throw new ApiError(501, "ocr_disabled", "server.import.ocrDisabled");
}

/**
 * Guard for the PDF endpoints.
 *
 * The MESSAGE depends on the other flag, because the two configurations need
 * different advice: on a lean server (neither) the broad "photo or PDF is off,
 * use a web address" is the true one, while on the image-only build the user
 * should be told that photos DO work. Same `ocr_disabled` code either way — it is
 * a wire contract, and the client's handling is identical.
 */
export function assertPdfImportEnabled(): void {
  if (isPdfImportEnabled()) return;
  throw new ApiError(
    501,
    "ocr_disabled",
    isOcrImportEnabled() ? "server.import.pdfDisabled" : "server.import.ocrDisabled",
  );
}

/**
 * Guard for `/imports/file`, which accepts either kind. It can only rule out the
 * case where NEITHER is available — that is the one worth catching early, since
 * it is the whole lean deployment. Which specific kind arrived is not known until
 * the body has been sniffed, so the per-kind guard runs after the read.
 */
export function assertAnyUploadImportEnabled(): void {
  if (isOcrImportEnabled() || isPdfImportEnabled()) return;
  throw new ApiError(501, "ocr_disabled", "server.import.ocrDisabled");
}

/**
 * The capability block `/api/health` reports, so the UI can hide what is off.
 *
 * `verifiedEmailRequired` is the odd one out — it is an AUTHORISATION rule, not a
 * build-time capability, and it lives in core/services/auth/verifiedEmail.ts. It rides
 * along because `features` is already the "what is this server" probe the client
 * reads once, and splitting it into a second field would mean a second request
 * for one boolean.
 *
 * In toon-household `/api/health` assembles the same block itself: the core's
 * `verifiedEmailRequired` plus every module's `healthFeatures()` — the recipe
 * manifest (modules/recipe/index.ts) reports the two flags above. This function
 * stays as toon-recipe's one-call form of that block.
 */
export function serverFeatures(): ServerFeatures {
  return {
    ocrImport: isOcrImportEnabled(),
    pdfImport: isPdfImportEnabled(),
    verifiedEmailRequired: isVerifiedEmailRequired(),
  };
}
