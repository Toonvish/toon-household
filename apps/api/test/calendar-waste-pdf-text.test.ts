/**
 * `WastePdfText` (plan m8 P18, M8-T09): the real extraction of the committed flyer equals the recorded items, and the
 * four refusals (`notPdf`, `encrypted`, `pages`, `timeout`) are `422 calendar_waste_unparseable` naming their check.
 *
 * The encrypted and the many-pages files are built here as tiny hand-written PDFs: an `/Encrypt` dictionary of the
 * Standard handler (R2) whose `/U` and `/O` match neither the empty user nor the empty owner password is exactly what a
 * flyer with a non-empty user password looks like to pdf.js (it asks for a password); its content needs no encryption.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { type WasteTextItem, WastePdfText } from "../src/modules/calendar/services/waste/pdf-text.ts";
import { FLYER_ITEMS, FLYER_PDF, itemsJson } from "./fixtures/calendar/record-items.ts";

/** pdf.js on a 1.6 MB flyer takes about a second alone, far more beside parallel suites. */
const PDF_TEST_TIMEOUT_MS = 60_000;

const extract = (bytes: Uint8Array, layer = WastePdfText.layer) =>
  Effect.runPromise(WastePdfText.use((pdfText) => pdfText.extract(bytes)).pipe(Effect.provide(layer)));

const refusal = (bytes: Uint8Array, layer = WastePdfText.layer) =>
  Effect.runPromise(Effect.flip(WastePdfText.use((pdfText) => pdfText.extract(bytes))).pipe(Effect.provide(layer)));

/** A minimal valid PDF: `pages` empty pages, optionally with an `/Encrypt` dictionary no empty password opens. */
function tinyPdf(options: { readonly pages: number; readonly encrypted?: boolean }): Uint8Array {
  const objects: string[] = [];
  const pageIds = Array.from({ length: options.pages }, (_, index) => 3 + index);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${options.pages} >>`);
  for (let index = 0; index < options.pages; index += 1) objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>");
  const encryptId = objects.length + 1;
  if (options.encrypted) {
    const hex = (seed: number) => Array.from({ length: 32 }, (_, i) => ((i * 37 + seed) % 256).toString(16).padStart(2, "0")).join("");
    objects.push(`<< /Filter /Standard /V 1 /R 2 /O <${hex(11)}> /U <${hex(97)}> /P -4 >>`);
  }
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  const id = "<0123456789abcdef0123456789abcdef>";
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${options.encrypted ? ` /Encrypt ${encryptId} 0 R /ID [${id} ${id}]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

const checkOf = (error: unknown): unknown => (error as { details: Array<{ check: string }> }).details[0]?.check;

describe("WastePdfText (P18)", () => {
  test(
    "a fresh extraction of the committed flyer equals the recorded items (deterministic, sorted, 0.1 pt)",
    async () => {
      const items = await extract(new Uint8Array(readFileSync(FLYER_PDF)));
      const recorded = JSON.parse(readFileSync(FLYER_ITEMS, "utf8")) as WasteTextItem[];
      expect(items.length).toBe(recorded.length);
      expect(items).toEqual(recorded);
      expect(itemsJson(items)).toBe(readFileSync(FLYER_ITEMS, "utf8"));
    },
    PDF_TEST_TIMEOUT_MS,
  );

  test("the recording separates the hidden grid copies into sections (design §5.3)", () => {
    const recorded = JSON.parse(readFileSync(FLYER_ITEMS, "utf8")) as WasteTextItem[];
    const januar = recorded.filter((item) => item.page === 2 && item.str === "Januar");
    // Two copies of the January grid, 14.4 pt apart, each in its own placed-PDF section.
    expect(januar.length).toBe(2);
    expect(new Set(januar.map((item) => item.section)).size).toBe(2);
    expect(januar.every((item) => item.section > 0)).toBe(true);
    // Every item has the documented shape, blank runs are dropped, numbers are rounded to 0.1 pt.
    for (const item of recorded) {
      expect(Object.keys(item)).toEqual(["str", "x", "y", "width", "page", "section"]);
      expect(item.str.trim()).toBe(item.str);
      expect(item.str.length).toBeGreaterThan(0);
      expect(Math.round(item.x * 10) / 10).toBe(item.x);
    }
  });

  test("bytes without the %PDF- header are `notPdf` (nothing is handed to pdf.js)", async () => {
    const error = await refusal(new TextEncoder().encode("hello, this is not a pdf at all"));
    expect(error).toMatchObject({ status: 422, code: "calendar_waste_unparseable" });
    expect(checkOf(error)).toBe("notPdf");
    expect((error as { details: unknown[] }).details[0]).toMatchObject({
      check: "notPdf",
      i18n: { key: "server.calendar.wasteCheck.notPdf" },
    });
  });

  test("a %PDF- header with garbage after it is `notPdf` (pdf.js refuses it; a rejection is a typed failure)", async () => {
    const error = await refusal(new TextEncoder().encode("%PDF-1.7\nthis is not a document\n"));
    expect(checkOf(error)).toBe("notPdf");
  });

  test("a PDF with a non-empty user password is `encrypted`", async () => {
    const error = await refusal(tinyPdf({ pages: 1, encrypted: true }));
    expect(error).toMatchObject({ status: 422, code: "calendar_waste_unparseable" });
    expect(checkOf(error)).toBe("encrypted");
  });

  test("six pages are read, seven are `pages`", async () => {
    expect(await extract(tinyPdf({ pages: 6 }))).toEqual([]);
    const error = await refusal(tinyPdf({ pages: 7 }));
    expect(checkOf(error)).toBe("pages");
  });

  test(
    "an extraction over its budget is `timeout` (the budget is the layer's; 20 s in production)",
    async () => {
      const error = await refusal(new Uint8Array(readFileSync(FLYER_PDF)), WastePdfText.layerWith({ timeoutMs: 1 }));
      expect(checkOf(error)).toBe("timeout");
    },
    PDF_TEST_TIMEOUT_MS,
  );

  test(
    "extractions are serialised through one permit and each still succeeds",
    async () => {
      const bytes = new Uint8Array(readFileSync(FLYER_PDF));
      const both = await Effect.runPromise(
        WastePdfText.use((pdfText) =>
          Effect.all([pdfText.extract(bytes), pdfText.extract(tinyPdf({ pages: 2 }))], { concurrency: 2 }),
        ).pipe(Effect.provide(WastePdfText.layer)),
      );
      expect(both[0].length).toBeGreaterThan(6000);
      expect(both[1]).toEqual([]);
    },
    PDF_TEST_TIMEOUT_MS,
  );
});
