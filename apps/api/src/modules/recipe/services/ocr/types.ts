/**
 * The OCR abstraction. Everything downstream of this file talks to `OcrEngine`
 * and never to the tesseract binary, which is what makes the engine swappable (a
 * PaddleOCR sidecar, a cloud Vision API, or the fake engine used in tests).
 */

export interface OcrOptions {
  /** Tesseract language string, e.g. "deu+eng". Defaults to TESSERACT_LANGS. */
  langs?: string;
  /**
   * Hint about the page layout. "page" = a full cookbook page (default),
   * "block" = a single already-cropped column, "line" = one line.
   */
  layout?: "page" | "block" | "line" | "sparse";
  /** Abort signal; engines should reject with the signal's reason. */
  signal?: AbortSignal;
}

export interface OcrBlock {
  text: string;
  /** 0..100, as reported by the engine. */
  confidence: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  /** Recognised text with line breaks preserved. */
  text: string;
  /** Mean confidence over the page, normalised to 0..1. */
  confidence: number;
  blocks?: OcrBlock[];
  /** Engine identifier, stored in `sourceMeta.engine`. */
  engine: string;
  /** Languages actually used, stored in `sourceMeta.langs`. */
  langs: string;
}

export interface OcrEngine {
  /** Stable name for diagnostics, e.g. "tesseract-native". */
  readonly name: string;
  /** Recognises text in a raster image (PNG/JPEG/WEBP bytes). */
  recognize(input: Uint8Array, options?: OcrOptions): Promise<OcrResult>;
  /** Releases workers/native handles. Safe to call more than once. */
  shutdown(): Promise<void>;
}
