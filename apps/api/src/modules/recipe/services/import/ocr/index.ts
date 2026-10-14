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
import { ApiError } from "../../../../../lib/errors.ts";
import { type OcrEngine, getOcrEngine, withOcrTimeout } from "../../ocr/index.ts";
import { PDF_NO_TEXT_LAYER_MESSAGE, pdfToText } from "../../ocr/pdf.ts";
import { preprocessImage } from "../../ocr/preprocess.ts";
import { type SniffedMime, deleteUpload, storeUpload } from "../files.ts";
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
  /** Injectable for tests — never runs real Tesseract there. */
  engine?: OcrEngine;
  timeoutMs?: number;
  /** Set false to skip persisting the upload (used by unit tests). */
  store?: boolean;
}

/**
 * Photo -> draft payload: store, preprocess (sharp), OCR, segment.
 *
 * @throws ApiError 415 when the image cannot be decoded, 422 `ocr_failed` when
 *   recognition fails or yields nothing usable, 504 on the OCR timeout.
 */
export async function importFromImage(
  bytes: Uint8Array,
  options: ImageImportOptions,
): Promise<TextImportResult> {
  const startedAt = Date.now();
  const engine = options.engine ?? getOcrEngine();

  const stored = options.store === false ? undefined : await storeUpload(bytes, options.mimeType);

  // Any failure from here on means NO draft is created, so the file we just
  // stored would leak — nothing would ever reference (or clean up) it.
  let rawText: string;
  let confidence: number;
  let engineName: string;
  let langs: string;
  try {
    const result = await withOcrTimeout(async (signal) => {
      const prepared = await preprocessImage(bytes);
      return await engine.recognize(prepared.bytes, { layout: "page", signal });
    }, options.timeoutMs);

    rawText = clampRawText(result.text.trim());
    confidence = result.confidence;
    engineName = result.engine;
    langs = result.langs;

    if (rawText.replace(/\s+/g, "").length < 10) {
      throw new ApiError(422, "ocr_failed", "server.ocr.noTextDetected", { engine: engineName, langs });
    }
  } catch (error) {
    await deleteUpload(stored?.filename);
    throw error;
  }

  const parsed = parseRecipeText(rawText, { source: "ocr", ocrConfidence: confidence });

  const sourceMeta: ImportSourceMeta = {
    method: "ocr",
    mimeType: options.mimeType,
    engine: engineName,
    langs,
    durationMs: Date.now() - startedAt,
    ...(options.originalName === undefined ? {} : { filename: options.originalName.slice(0, 300) }),
    ...(stored === undefined ? {} : { storedPath: stored.filename }),
  };

  return { parsed, rawText, sourceMeta };
}

/* ---------------------------------- PDFs ---------------------------------- */

export interface PdfImportOptions {
  originalName?: string;
  engine?: OcrEngine;
  timeoutMs?: number;
  maxPages?: number;
  /** Set false to force the rasterize+OCR path (tests). */
  useTextLayer?: boolean;
  store?: boolean;
}

/**
 * PDF -> draft payload: embedded text layer first, rasterize + OCR as fallback.
 *
 * @throws ApiError 422 `pdf_no_text_layer` when there is no text layer AND
 *   rasterization is unavailable, 504 on the OCR timeout.
 */
export async function importFromPdf(bytes: Uint8Array, options: PdfImportOptions = {}): Promise<TextImportResult> {
  const startedAt = Date.now();
  const engine = options.engine ?? getOcrEngine();

  const stored = options.store === false ? undefined : await storeUpload(bytes, "application/pdf");

  // As for images: a failure means no draft, so the stored PDF must not leak.
  let result: Awaited<ReturnType<typeof pdfToText>>;
  let rawText: string;
  try {
    result = await withOcrTimeout(
      async (signal) =>
        await pdfToText(bytes, engine, {
          signal,
          ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
          ...(options.useTextLayer === undefined ? {} : { useTextLayer: options.useTextLayer }),
        }),
      options.timeoutMs,
      "server.ocr.pdfProcessingTimedOut",
    );

    rawText = clampRawText(result.text.trim());
    if (rawText.replace(/\s+/g, "").length < 10) {
      throw new ApiError(422, "pdf_no_text_layer", PDF_NO_TEXT_LAYER_MESSAGE, {
        reason: "empty_result",
      });
    }
  } catch (error) {
    await deleteUpload(stored?.filename);
    throw error;
  }

  const parsed = parseRecipeText(rawText, {
    source: result.method === "pdf-text" ? "pdf-text" : "ocr",
    ocrConfidence: result.confidence,
  });

  const sourceMeta: ImportSourceMeta = {
    method: result.method,
    mimeType: "application/pdf",
    pages: result.pages > 0 ? result.pages : 1,
    durationMs: Date.now() - startedAt,
    ...(options.originalName === undefined ? {} : { filename: options.originalName.slice(0, 300) }),
    ...(stored === undefined ? {} : { storedPath: stored.filename }),
    ...(result.engine === undefined ? {} : { engine: result.engine }),
    ...(result.langs === undefined ? {} : { langs: result.langs }),
  };

  return { parsed, rawText, sourceMeta };
}

/* ------------------------------- pasted text ------------------------------ */

export interface TextPasteOptions {
  /** Optional title from the form; overrides the detected one. */
  title?: string;
}

/** Pasted text -> draft payload. Synchronous: no OCR, no I/O. */
export function importFromText(rawText: string, options: TextPasteOptions = {}): TextImportResult {
  const text = clampRawText(rawText.trim());
  if (text.length === 0) throw ApiError.badRequest("server.import.pastedTextEmpty");

  const parsed = parseRecipeText(text, {
    source: "manual",
    ...(options.title === undefined ? {} : { titleOverride: options.title }),
  });

  const startedAt = Date.now();
  return {
    parsed,
    rawText: text,
    sourceMeta: { method: "manual", durationMs: Date.now() - startedAt },
  };
}
