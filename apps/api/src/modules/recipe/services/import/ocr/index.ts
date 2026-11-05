/**
 * Image / PDF / pasted-text import pipelines.
 *
 * All three end in `segmentRecipeText()`, so a photo, a scanned PDF and a block
 * of text pasted from WhatsApp all produce the same normalized ParsedRecipe.
 *
 * The uploaded file is stored BEFORE recognition so the review screen can always
 * show the source next to the parsed fields — even when OCR produced garbage.
 * `sourceMeta.storedPath` carries the filename; the draft's DELETE unlinks it.
 */
import type { ImportSourceMeta, ParsedRecipe } from "@toon/shared";
import { Clock, Context, Effect, Layer } from "effect";
import { ApiFailure, BadRequest } from "../../../../../lib/errors.ts";
import { runtime } from "../../../../../runtime.ts";
import { Ocr } from "../../ocr/index.ts";
import { PDF_NO_TEXT_LAYER_MESSAGE, PdfText } from "../../ocr/pdf.ts";
import type { OcrFailure } from "../../ocr/seam.ts";
import { type SniffedMime, ImportFiles } from "../files.ts";
import { finalizeParsed } from "../parsed.ts";
import { type SegmentTextOptions, segmentRecipeText } from "./segment.ts";

export { repairIngredientLine, repairOcrText, repairUnitToken } from "./quantity-fix.ts";
export {
  findTitle,
  prepareLines,
  scanMeta,
  scoreSegmentation,
  segmentBlocks,
  segmentRecipeText,
  mergeWrappedSteps,
} from "./segment.ts";
export type { SegmentTextOptions, SegmentTextResult } from "./segment.ts";

/** Everything a draft row needs from a text-based import. */
export interface TextImportResult {
  parsed: ParsedRecipe;
  rawText: string;
  sourceMeta: ImportSourceMeta;
}

/**
 * Segments raw text into a contract-valid ParsedRecipe.
 * Pure — no I/O — and the single place where segmentation meets the contract.
 */
export function parseRecipeText(rawText: string, options: SegmentTextOptions = {}): ParsedRecipe {
  const { fields, confidence } = segmentRecipeText(rawText, options);
  return finalizeParsed(fields, confidence);
}

/** Raw text is capped at the column's practical limit (contract: 100 000). */
const MAX_RAW_TEXT = 100_000;

function clampRawText(text: string): string {
  return text.length > MAX_RAW_TEXT ? text.slice(0, MAX_RAW_TEXT) : text;
}

/* --------------------------------- images --------------------------------- */

export interface ImageImportOptions {
  mimeType: SniffedMime;
  originalName?: string;
  timeoutMs?: number;
  /** Set false to skip persisting the upload (used by unit tests). */
  store?: boolean;
}

/* ---------------------------------- PDFs ---------------------------------- */

export interface PdfImportOptions {
  originalName?: string;
  timeoutMs?: number;
  maxPages?: number;
  /** Set false to force the rasterize+OCR path (tests). */
  useTextLayer?: boolean;
  store?: boolean;
}

/* ------------------------------- pasted text ------------------------------ */

export interface TextPasteOptions {
  /** Optional title from the form; overrides the detected one. */
  title?: string;
}

/**
 * Pasted text -> draft payload, as a service-free effect: no OCR, no I/O, no service. NOT pure (the duration reads the
 * `Clock`), and it stays reachable synchronously through the bridge `importFromText` at the end of the file. The steps
 * run in today's order: clamp the trimmed text, refuse an empty one, parse, and only then read the clock twice.
 */
export const importFromTextEffect = Effect.fnUntraced(function* (
  rawText: string,
  options: TextPasteOptions = {},
): Effect.fn.Return<TextImportResult, BadRequest> {
  const text = clampRawText(rawText.trim());
  if (text.length === 0) return yield* new BadRequest({ text: "server.import.pastedTextEmpty" });

  const parsed = parseRecipeText(text, {
    source: "manual",
    ...(options.title === undefined ? {} : { titleOverride: options.title }),
  });

  const startedAt = yield* Clock.currentTimeMillis;
  return {
    parsed,
    rawText: text,
    sourceMeta: { method: "manual", durationMs: (yield* Clock.currentTimeMillis) - startedAt },
  };
});

/** The image, PDF and pasted-text import pipelines as a service. */
export class OcrImporter extends Context.Service<
  OcrImporter,
  {
    /**
     * Photo -> draft payload: store, preprocess (sharp), OCR, segment. Fails `415` when the image cannot be decoded,
     * `422 ocr_failed` when recognition fails or yields nothing usable, `504` on the OCR timeout; the stored upload is
     * deleted on ANY failure, a defect or an interruption included. The engine is the `setOcrEngine` seam's.
     */
    readonly importFromImage: (
      bytes: Uint8Array,
      options: ImageImportOptions,
    ) => Effect.Effect<TextImportResult, OcrFailure>;
    /**
     * PDF -> draft payload: embedded text layer first, rasterize + OCR as fallback. Fails `422 pdf_no_text_layer` when
     * there is no text layer AND rasterization is unavailable, `504` on the OCR timeout; the stored upload is deleted
     * on ANY failure.
     */
    readonly importFromPdf: (
      bytes: Uint8Array,
      options?: PdfImportOptions,
    ) => Effect.Effect<TextImportResult, OcrFailure>;
    /** Pasted text -> draft payload; `400` for an empty text. */
    readonly importFromText: (rawText: string, options?: TextPasteOptions) => Effect.Effect<TextImportResult, BadRequest>;
  }
>()("toon/api/modules/recipe/services/import/ocr/index/OcrImporter") {
  static readonly layer = Layer.effect(
    OcrImporter,
    Effect.gen(function* () {
      const ocr = yield* Ocr;
      const pdf = yield* PdfText;
      const files = yield* ImportFiles;

      const importFromImage = Effect.fn("OcrImporter.importFromImage")(function* (
        bytes: Uint8Array,
        options: ImageImportOptions,
      ): Effect.fn.Return<TextImportResult, OcrFailure> {
        const startedAt = yield* Clock.currentTimeMillis;

        const stored = options.store === false ? undefined : yield* files.storeUpload(bytes, options.mimeType);

        // Any failure from here on means NO draft is created, so the file we just
        // stored would leak — nothing would ever reference (or clean up) it.
        const recognized = yield* Effect.gen(function* () {
          const result = yield* ocr.withOcrTimeout(ocr.recognize(bytes, { layout: "page" }), options.timeoutMs);

          const rawText = clampRawText(result.text.trim());
          if (rawText.replace(/\s+/g, "").length < 10) {
            return yield* new ApiFailure({
              status: 422,
              code: "ocr_failed",
              text: "server.ocr.noTextDetected",
              details: { engine: result.engine, langs: result.langs },
            });
          }
          return { rawText, confidence: result.confidence, engine: result.engine, langs: result.langs };
        }).pipe(Effect.onError(() => files.deleteUpload(stored?.filename)));

        const parsed = parseRecipeText(recognized.rawText, { source: "ocr", ocrConfidence: recognized.confidence });

        const sourceMeta: ImportSourceMeta = {
          method: "ocr",
          mimeType: options.mimeType,
          engine: recognized.engine,
          langs: recognized.langs,
          durationMs: (yield* Clock.currentTimeMillis) - startedAt,
          ...(options.originalName === undefined ? {} : { filename: options.originalName.slice(0, 300) }),
          ...(stored === undefined ? {} : { storedPath: stored.filename }),
        };

        return { parsed, rawText: recognized.rawText, sourceMeta };
      });

      const importFromPdf = Effect.fn("OcrImporter.importFromPdf")(function* (
        bytes: Uint8Array,
        options: PdfImportOptions = {},
      ): Effect.fn.Return<TextImportResult, OcrFailure> {
        const startedAt = yield* Clock.currentTimeMillis;

        const stored = options.store === false ? undefined : yield* files.storeUpload(bytes, "application/pdf");

        // As for images: a failure means no draft, so the stored PDF must not leak.
        const extracted = yield* Effect.gen(function* () {
          const result = yield* ocr.withOcrTimeout(
            pdf.pdfToText(bytes, {
              ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
              ...(options.useTextLayer === undefined ? {} : { useTextLayer: options.useTextLayer }),
            }),
            options.timeoutMs,
            "server.ocr.pdfProcessingTimedOut",
          );

          const rawText = clampRawText(result.text.trim());
          if (rawText.replace(/\s+/g, "").length < 10) {
            return yield* new ApiFailure({
              status: 422,
              code: "pdf_no_text_layer",
              text: PDF_NO_TEXT_LAYER_MESSAGE,
              details: { reason: "empty_result" },
            });
          }
          return { result, rawText };
        }).pipe(Effect.onError(() => files.deleteUpload(stored?.filename)));
        const { result, rawText } = extracted;

        const parsed = parseRecipeText(rawText, {
          source: result.method === "pdf-text" ? "pdf-text" : "ocr",
          ocrConfidence: result.confidence,
        });

        const sourceMeta: ImportSourceMeta = {
          method: result.method,
          mimeType: "application/pdf",
          pages: result.pages > 0 ? result.pages : 1,
          durationMs: (yield* Clock.currentTimeMillis) - startedAt,
          ...(options.originalName === undefined ? {} : { filename: options.originalName.slice(0, 300) }),
          ...(stored === undefined ? {} : { storedPath: stored.filename }),
          ...(result.engine === undefined ? {} : { engine: result.engine }),
          ...(result.langs === undefined ? {} : { langs: result.langs }),
        };

        return { parsed, rawText, sourceMeta };
      });

      return OcrImporter.of({ importFromImage, importFromPdf, importFromText: importFromTextEffect });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/**
 * Photo -> draft payload. A refusal rejects with the tagged error itself, any other failure with the original error.
 * Callers: `apps/api/src/modules/recipe/routes/imports.ts` (E3-T11).
 */
export function importFromImage(bytes: Uint8Array, options: ImageImportOptions): Promise<TextImportResult> {
  return runtime.runPromise(OcrImporter.use((importer) => importer.importFromImage(bytes, options)));
}

/** PDF -> draft payload. Callers: `apps/api/src/modules/recipe/routes/imports.ts` (E3-T11). */
export function importFromPdf(bytes: Uint8Array, options: PdfImportOptions = {}): Promise<TextImportResult> {
  return runtime.runPromise(OcrImporter.use((importer) => importer.importFromPdf(bytes, options)));
}

/**
 * Pasted text -> draft payload. SYNCHRONOUS and throwing the `400` refusal itself (an `ApiError` instance) for an empty
 * text (plan e3 P11): `Effect.runSync` over the service-free {@link importFromTextEffect}, whose clock is the default
 * one. Callers: `apps/api/src/modules/recipe/routes/imports.ts` (E3-T11), `apps/api/test/import/ocr-disabled.test.ts`
 * (pinned, E8) and `apps/api/test/import/ocr-segment.test.ts`.
 */
export function importFromText(rawText: string, options: TextPasteOptions = {}): TextImportResult {
  return Effect.runSync(importFromTextEffect(rawText, options));
}
