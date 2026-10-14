/**
 * Shared test helpers for the import pipeline. NOT a test file.
 *
 * Everything here is offline: a fake `OcrEngine`, a scripted `fetch`, and fixture
 * loading. Real Tesseract is never started in tests (it would download ~15 MB of
 * language data and take minutes).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "../../src/lib/errors.ts";
import type { OcrEngine, OcrOptions, OcrResult } from "../../src/modules/recipe/services/ocr/types.ts";

/**
 * Awaits a promise that MUST reject with an `ApiError` and returns it typed.
 * Keeps the tests free of `.catch((e) => e as ApiError)` union noise.
 */
export async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw new Error(`Expected an ApiError, got: ${String(error)}`);
  }
  throw new Error("Expected the promise to reject with an ApiError, but it resolved");
}

export const FIXTURE_DIR = join(import.meta.dir, "..", "fixtures", "import");

/** Reads a fixture from apps/api/test/fixtures/import. */
export function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

/* ------------------------------- fake OCR --------------------------------- */

export interface FakeOcrEngineOptions {
  /** Text returned for every recognise call, or one entry per call. */
  text: string | string[];
  confidence?: number;
  /** Throw instead of returning (to test the error paths). */
  fail?: Error;
  /** Delay per call in ms — used to exercise the timeout. */
  delayMs?: number;
}

export interface FakeOcrEngine extends OcrEngine {
  /** How many times recognise() was called. */
  readonly calls: number;
  /** Options each call received. */
  readonly callOptions: OcrOptions[];
  readonly shutdownCalls: number;
}

/** A deterministic in-memory `OcrEngine` for tests. */
export function createFakeOcrEngine(options: FakeOcrEngineOptions): FakeOcrEngine {
  let calls = 0;
  let shutdownCalls = 0;
  const callOptions: OcrOptions[] = [];

  const engine = {
    name: "fake-ocr",
    get calls() {
      return calls;
    },
    get callOptions() {
      return callOptions;
    },
    get shutdownCalls() {
      return shutdownCalls;
    },
    async recognize(_input: Uint8Array, opts: OcrOptions = {}): Promise<OcrResult> {
      const index = calls;
      calls += 1;
      callOptions.push(opts);
      if (options.delayMs !== undefined && options.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      opts.signal?.throwIfAborted();
      if (options.fail) throw options.fail;
      const text = Array.isArray(options.text) ? (options.text[index] ?? options.text.at(-1) ?? "") : options.text;
      return {
        text,
        confidence: options.confidence ?? 0.85,
        engine: "fake-ocr",
        langs: "deu+eng",
      };
    },
    async shutdown(): Promise<void> {
      shutdownCalls += 1;
    },
  };
  return engine as FakeOcrEngine;
}

/* ----------------------------- scripted fetch ----------------------------- */

export interface ScriptedResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Shortcut for a 302 with a Location header. */
  redirectTo?: string;
}

export interface ScriptedFetch {
  fetch: typeof fetch;
  /** URLs requested, in order. */
  readonly requests: string[];
}

/**
 * A `fetch` implementation driven by a URL -> response map. Any URL that is not
 * in the map throws, which makes an accidental real network call fail loudly.
 */
export function createScriptedFetch(routes: Record<string, ScriptedResponse>): ScriptedFetch {
  const requests: string[] = [];

  const impl = (async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    const route = routes[url] ?? routes[url.replace(/\/$/, "")];
    if (route === undefined) {
      throw new Error(`ScriptedFetch: no route for ${url}`);
    }
    if (route.redirectTo !== undefined) {
      return new Response(null, {
        status: route.status ?? 302,
        headers: { location: route.redirectTo, ...(route.headers ?? {}) },
      });
    }
    return new Response(route.body ?? "", {
      status: route.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...(route.headers ?? {}) },
    });
  }) as unknown as typeof fetch;

  return {
    fetch: impl,
    get requests() {
      return requests;
    },
  };
}

/** A DNS resolver stub: every host maps to a public address unless overridden. */
export function createResolver(map: Record<string, string> = {}): (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>> {
  return async (hostname: string) => {
    const address = map[hostname] ?? "93.184.216.34";
    return [{ address, family: address.includes(":") ? 6 : 4 }];
  };
}

/**
 * A REAL, decodable PNG produced by sharp — needed wherever the code under test
 * runs the sharp preprocessing step (a hand-written byte array would not decode).
 */
export async function makeTestPng(width = 320, height = 200): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 250, g: 250, b: 250 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

/** MediaBox of {@link makeTextlessPdf}, in PDF points. */
export const TEXTLESS_PDF_SIZE = { width: 595, height: 842 } as const;

/**
 * A REAL, minimal, single-page PDF with NO text layer — just a filled rectangle.
 * Hand-built so the rasterize+OCR fallback can be exercised without a binary
 * fixture. pdf.js opens it, extractText() returns "".
 */
export function makeTextlessPdf(): Uint8Array {
  const content = "0 0 0 rg 100 100 300 400 re f\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${TEXTLESS_PDF_SIZE.width} ${TEXTLESS_PDF_SIZE.height}] /Contents 4 0 R /Resources << >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}
