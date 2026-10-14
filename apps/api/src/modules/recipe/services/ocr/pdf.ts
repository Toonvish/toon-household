/**
 * PDF text acquisition, in the order the brief demands:
 *
 *   1. TEXT LAYER first (`unpdf`). Digital PDFs (Thermomix exports, blog
 *      print-views, publisher PDFs) carry perfect text — OCR would only make it
 *      worse, so we never rasterize when a usable layer exists.
 *   2. If the layer is missing or too sparse (scanned page → the layer holds
 *      only a header or nothing at all), RASTERIZE with poppler's `pdftoppm` and
 *      OCR the pages.
 *   3. If rasterization is unavailable at runtime (no `pdftoppm` on the host, or a
 *      file poppler cannot open), fail with 422 `pdf_no_text_layer` and an
 *      actionable German message.
 *
 * Hard cap: 10 pages. A cookbook chapter dump would otherwise burn minutes of
 * OCR for a single recipe.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerKey } from "@toon/shared";
import { env } from "../../../../env.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { preprocessImage } from "./preprocess.ts";
import type { OcrEngine, OcrOptions, OcrResult } from "./types.ts";

export const MAX_PDF_PAGES = 10;
/** Below this many characters the "text layer" is scanner noise, not content. */
export const MIN_TEXT_LAYER_CHARS = 200;
/** …and it must contain at least this many alphanumeric words. */
export const MIN_TEXT_LAYER_WORDS = 20;
/** Rasterization resolution. 144 dpi is enough for Tesseract on an A4 page. */
export const RASTER_DPI = 144;
/**
 * The same number as a multiple of the MediaBox, which is what a rendered page
 * measures: PDF user space is 72 dpi, so 144 dpi is exactly 2x. Kept as its own
 * export because that is the invariant `pdf-rasterize.test.ts` asserts.
 */
export const RASTER_SCALE = RASTER_DPI / 72;

export const PDF_NO_TEXT_LAYER_MESSAGE: ServerKey = "server.ocr.pdfNoTextLayer";

export interface PdfTextLayer {
  /** Page texts, index 0 = page 1. */
  pages: string[];
  /** Pages in the document (may exceed `pages.length` because of the cap). */
  totalPages: number;
  text: string;
}

/** True when the extracted text is rich enough to skip OCR entirely. */
export function isUsableTextLayer(text: string): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < MIN_TEXT_LAYER_CHARS) return false;
  const words = trimmed.split(" ").filter((word) => /[\p{L}\p{N}]{2,}/u.test(word));
  return words.length >= MIN_TEXT_LAYER_WORDS;
}

/**
 * Extracts the embedded text layer.
 * @returns the layer, or undefined when the PDF cannot be opened at all.
 */
export async function extractPdfTextLayer(bytes: Uint8Array): Promise<PdfTextLayer | undefined> {
  return await withPdfTextLock(async () => {
    try {
      const { extractText } = await import("unpdf");
      // A fresh copy: pdf.js transfers/detaches the buffer it is handed.
      const result = await extractText(new Uint8Array(bytes), { mergePages: false });
      const pages = (Array.isArray(result.text) ? result.text : [String(result.text)])
        .slice(0, MAX_PDF_PAGES)
        .map((page) => normalizePdfText(page));
      return { pages, totalPages: result.totalPages, text: pages.join("\n\n").trim() };
    } catch (error) {
      // Expected for scanned/broken PDFs — the caller falls back to rasterizing.
      if (!env.isTest) {
        console.warn("[import] PDF text layer extraction failed:", error instanceof Error ? error.message : error);
      }
      return undefined;
    }
  });
}

/* ---------------------------- pdf.js text layer --------------------------- */

/**
 * Serializes text-layer extraction.
 *
 * HISTORY, because the reason changed: this lock used to exist because TWO
 * INCOMPATIBLE pdf.js COPIES shared the process — `unpdf` bundles pdf.js 6 and
 * installs `globalThis.pdfjsWorker`, while the old `pdf-to-img` rasterizer used
 * pdfjs-dist 5, which version-checks that global and refuses to start. Since the
 * text-layer probe always runs first, the rasterize+OCR fallback for scanned PDFs
 * was dead in the real server; the fix was to stash and restore those globals
 * around rasterization and serialize both phases through this lock.
 *
 * Rasterization is now poppler in a SUBPROCESS, so there is exactly one pdf.js in
 * the process and no global to swap. What remains is a plain concurrency bound:
 * `unpdf` holds a whole parsed document in memory, and this is the deployment that
 * has to fit in a few hundred megabytes. Rasterization deliberately runs OUTSIDE
 * this lock — a subprocess needs no protection from it.
 */
let pdfTextLock: Promise<unknown> = Promise.resolve();

function withPdfTextLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = pdfTextLock.then(operation, operation);
  pdfTextLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * pdf.js emits one text item per glyph run, so the naive join produces
 * "Z u t a t e n" style artefacts and lost line breaks. Repair the worst of it.
 */
export function normalizePdfText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/\u00ad/g, "")
    // hyphenation across line breaks: "Kar-\ntoffeln" -> "Kartoffeln"
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2")
    .replace(/[ \t]{2,}/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface RasterizedPage {
  pageNumber: number;
  /** PNG bytes. */
  bytes: Uint8Array;
}

export type PdfRasterizer = (bytes: Uint8Array, maxPages: number) => Promise<RasterizedPage[]>;

let rasterizer: PdfRasterizer | null = null;

/**
 * Replaces the rasterizer; `null` restores poppler.
 *
 * This exists so tests never have to `mock.module()` the rasterizer. That mattered:
 * `mock.module` is process-global, bun never restores it between files, and file
 * execution order is FILESYSTEM order rather than alphabetical — so a stub left
 * installed in one file broke `pdf-rasterize.test.ts` on whichever machine happened
 * to enumerate that file first, which is exactly how it passed locally and failed in
 * CI. An explicit seam cannot leak silently: it is reset in an `afterEach`, the same
 * rule as `setMailer(null)` and `setOcrEngine(null)`.
 */
export function setPdfRasterizer(next: PdfRasterizer | null): void {
  rasterizer = next;
}

/**
 * Renders PDF pages to PNG.
 *
 * @throws ApiError 422 `pdf_no_text_layer` when rasterization is unavailable (no
 *   `pdftoppm`) or the file cannot be opened — that is the documented fallback
 *   contract.
 */
export async function rasterizePdf(bytes: Uint8Array, maxPages = MAX_PDF_PAGES): Promise<RasterizedPage[]> {
  return await (rasterizer ?? rasterizeWithPoppler)(bytes, maxPages);
}

/**
 * poppler's `pdftoppm`, in a subprocess.
 *
 * It writes NUMBERED FILES (`page-1.png`, or `page-01.png` once the last page has
 * two digits — poppler pads to the width of `-l`), so the output has to be a
 * directory prefix and the page number is read back off the filename rather than
 * assumed from the loop counter. Both the input and the output live in a temp dir
 * that is removed in `finally`, so a crashed render leaves nothing behind.
 */
async function rasterizeWithPoppler(bytes: Uint8Array, maxPages: number): Promise<RasterizedPage[]> {
  const directory = await mkdtemp(join(tmpdir(), "toon-pdf-"));
  try {
    const input = join(directory, "in.pdf");
    await writeFile(input, bytes);
    const prefix = join(directory, "page");

    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn(
        [env.PDFTOPPM_BIN, "-png", "-r", String(RASTER_DPI), "-f", "1", "-l", String(maxPages), input, prefix],
        { stdout: "ignore", stderr: "pipe" },
      );
    } catch (error) {
      // ENOENT: poppler is not installed on this host.
      throw noTextLayerError(error);
    }

    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr as ReadableStream<Uint8Array>).text(),
    ]);
    if (exitCode !== 0) {
      throw noTextLayerError(new Error(stderr.trim() || `pdftoppm exited with ${exitCode}`));
    }

    const pages: RasterizedPage[] = [];
    for (const name of await readdir(directory)) {
      const match = /^page-(\d+)\.png$/.exec(name);
      if (match === null) continue;
      pages.push({
        pageNumber: Number(match[1]),
        bytes: new Uint8Array(await readFile(join(directory, name))),
      });
    }
    pages.sort((left, right) => left.pageNumber - right.pageNumber);

    if (pages.length === 0) throw noTextLayerError(new Error("rasterizer produced no pages"));
    return pages;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function noTextLayerError(error: unknown): ApiError {
  return new ApiError(422, "pdf_no_text_layer", PDF_NO_TEXT_LAYER_MESSAGE, {
    reason: "rasterization_unavailable",
    cause: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
  });
}

export interface PdfTextResult {
  text: string;
  /** How the text was obtained. */
  method: "pdf-text" | "ocr";
  /** Pages actually processed. */
  pages: number;
  /** Pages in the document. */
  totalPages: number;
  /** 0..1; 1 for a text layer (it is exact), engine confidence for OCR. */
  confidence: number;
  engine?: string;
  langs?: string;
}

export interface PdfToTextOptions extends OcrOptions {
  maxPages?: number;
  /** Set false to force OCR (used by tests). */
  useTextLayer?: boolean;
}

/**
 * Turns a PDF into text: layer first, OCR fallback, 422 when neither works.
 *
 * @throws ApiError 422 `pdf_no_text_layer` when there is no usable text layer
 *   AND rasterization is unavailable.
 */
export async function pdfToText(
  bytes: Uint8Array,
  engine: OcrEngine,
  options: PdfToTextOptions = {},
): Promise<PdfTextResult> {
  const maxPages = options.maxPages ?? MAX_PDF_PAGES;

  const layer = options.useTextLayer === false ? undefined : await extractPdfTextLayer(bytes);
  if (layer !== undefined && isUsableTextLayer(layer.text)) {
    return {
      text: layer.text,
      method: "pdf-text",
      pages: layer.pages.length,
      totalPages: layer.totalPages,
      confidence: 1,
    };
  }

  const rasterized = await rasterizePdf(bytes, maxPages);
  const texts: string[] = [];
  let confidenceSum = 0;
  let engineName: string | undefined;
  let langs: string | undefined;

  for (const page of rasterized) {
    options.signal?.throwIfAborted();
    const prepared = await preprocessImage(page.bytes);
    const result: OcrResult = await engine.recognize(prepared.bytes, {
      ...(options.langs === undefined ? {} : { langs: options.langs }),
      layout: options.layout ?? "page",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    texts.push(result.text.trim());
    confidenceSum += result.confidence;
    engineName = result.engine;
    langs = result.langs;
  }

  const text = texts.filter((part) => part.length > 0).join("\n\n").trim();
  if (text.length === 0) {
    throw new ApiError(422, "pdf_no_text_layer", PDF_NO_TEXT_LAYER_MESSAGE, { reason: "ocr_empty" });
  }

  return {
    text,
    method: "ocr",
    pages: rasterized.length,
    totalPages: layer?.totalPages ?? rasterized.length,
    confidence: rasterized.length > 0 ? confidenceSum / rasterized.length : 0,
    ...(engineName === undefined ? {} : { engine: engineName }),
    ...(langs === undefined ? {} : { langs }),
  };
}
