/**
 * REGRESSION TEST — the ONLY import test that uses the REAL rasterizer.
 *
 * It needs poppler's `pdftoppm` on the machine, which the Docker image and CI
 * install. It fails loudly rather than skipping when the binary is missing: the
 * whole point is to notice that the rasterize+OCR fallback is dead, and a silent
 * skip is how it stayed dead the first time.
 *
 * ORIGINAL BACKGROUND, kept because the assertion below is shaped by it: the
 * rasterizer used to be `pdf-to-img` (pdfjs-dist 5), while `unpdf` (text layer)
 * bundles pdf.js 6 and installs `globalThis.pdfjsWorker`. pdfjs-dist 5
 * version-checks that global and refuses to start, and since `pdfToText()` always
 * probes the text layer FIRST, the fallback required by the brief (5c) was
 * completely dead in the real server while every other test passed — because they
 * all stubbed the rasterizer away. Rasterization is now a poppler SUBPROCESS, so
 * there is one pdf.js in the process and no global to collide over.
 *
 * Two rules survive that:
 *   - never stub the rasterizer in THIS file (use `setPdfRasterizer` elsewhere), and
 *   - keep asserting the rendered page SIZE, so a stub leaking in from another file
 *     cannot make this pass.
 */
import { describe, expect, test } from "bun:test";
import {
  RASTER_SCALE,
  extractPdfTextLayer,
  isUsableTextLayer,
  pdfToText,
  rasterizePdf,
} from "../../src/modules/recipe/services/ocr/pdf.ts";
import { TEXTLESS_PDF_SIZE, createFakeOcrEngine, makeTextlessPdf } from "./helpers.ts";

/** Width/height of a PNG, straight out of the IHDR chunk. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * PDF user space is 72 dpi, so rendering at RASTER_DPI scales the MediaBox by
 * exactly RASTER_SCALE. A stubbed rasterizer returns some other size.
 */
const EXPECTED = {
  width: TEXTLESS_PDF_SIZE.width * RASTER_SCALE,
  height: TEXTLESS_PDF_SIZE.height * RASTER_SCALE,
};

describe("PDF rasterization with the real pdftoppm", () => {
  test("a PDF without a text layer yields no usable text", async () => {
    const layer = await extractPdfTextLayer(makeTextlessPdf());
    expect(layer).toBeDefined();
    expect(layer?.totalPages).toBe(1);
    expect(isUsableTextLayer(layer?.text ?? "")).toBe(false);
  });

  test("rasterizes a page at the expected resolution", async () => {
    const bytes = makeTextlessPdf();
    // Order matters: this is the exact sequence pdfToText() performs, and it is
    // the sequence that used to break.
    await extractPdfTextLayer(bytes);

    const pages = await rasterizePdf(bytes);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.pageNumber).toBe(1);
    expect(pngSize(pages[0]!.bytes)).toEqual(EXPECTED);
  });

  test("text extraction still works after a rasterization in the same process", async () => {
    const bytes = makeTextlessPdf();
    await extractPdfTextLayer(bytes);
    await rasterizePdf(bytes);

    const again = await extractPdfTextLayer(bytes);
    expect(again).toBeDefined();
    expect(again?.totalPages).toBe(1);
  });

  test("concurrent extract + rasterize do not corrupt each other", async () => {
    const bytes = makeTextlessPdf();
    const results = await Promise.all([
      rasterizePdf(bytes),
      extractPdfTextLayer(bytes),
      rasterizePdf(bytes),
      extractPdfTextLayer(bytes),
    ]);
    expect((results[0] as Awaited<ReturnType<typeof rasterizePdf>>).length).toBe(1);
    expect((results[2] as Awaited<ReturnType<typeof rasterizePdf>>).length).toBe(1);
    expect(results[1]).toBeDefined();
    expect(results[3]).toBeDefined();
  });

  test("the temp directory is cleaned up rather than accumulating renders", async () => {
    // pdftoppm writes real files; a leaked temp dir per import would silently fill
    // a small server's disk. Rendering repeatedly must not grow the temp dir count.
    const { readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const countTempDirs = async () =>
      (await readdir(tmpdir())).filter((name) => name.startsWith("toon-pdf-")).length;

    const before = await countTempDirs();
    await rasterizePdf(makeTextlessPdf());
    await rasterizePdf(makeTextlessPdf());
    expect(await countTempDirs()).toBe(before);
  });

  test("pdfToText falls back from the empty text layer to OCR", async () => {
    const engine = createFakeOcrEngine({
      text: "Apfelkuchen\nZutaten\n300 g Mehl\n4 Eier\nZubereitung\n1. Alles verruehren.",
      confidence: 0.82,
    });

    const result = await pdfToText(makeTextlessPdf(), engine);

    expect(result.method).toBe("ocr");
    expect(result.pages).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(engine.calls).toBe(1);
    expect(result.text).toContain("Apfelkuchen");
  });
});
