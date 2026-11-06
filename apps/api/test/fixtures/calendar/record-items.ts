/**
 * Records the text items of the committed waste flyer fixture (plan m8 P18, M8-T09):
 *
 *   bun apps/api/test/fixtures/calendar/record-items.ts
 *
 * reads `hattingen-abfall-2027.pdf` (the Stadt Hattingen 2027 flyer, committed, read-only) through the REAL
 * `WastePdfText` service and writes `hattingen-2027.items.json` beside it: one item per line, in the service's
 * deterministic order (page, section, y descending, x, text), coordinates rounded to 0.1 pt. Run ONCE; the output is
 * committed, and `apps/api/test/calendar-waste-pdf-text.test.ts` compares a fresh extraction with it, so a pdf.js upgrade
 * that changes the text layer fails a test instead of silently feeding the parser tests stale items.
 * `--check` compares instead of writing (exit 1 on a difference).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { type WasteTextItem, WastePdfText } from "../../../src/modules/calendar/services/waste/pdf-text.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FLYER_PDF = join(HERE, "hattingen-abfall-2027.pdf");
export const FLYER_ITEMS = join(HERE, "hattingen-2027.items.json");

/** The JSON text of a list of items: an array with one compact item per line (reviewable diffs). */
export function itemsJson(items: ReadonlyArray<WasteTextItem>): string {
  return `[\n${items.map((item) => JSON.stringify(item)).join(",\n")}\n]\n`;
}

if (import.meta.main) {
  const bytes = new Uint8Array(readFileSync(FLYER_PDF));
  const items = await Effect.runPromise(
    WastePdfText.use((pdfText) => pdfText.extract(bytes)).pipe(Effect.provide(WastePdfText.layer)),
  );
  const text = itemsJson(items);
  if (process.argv.includes("--check")) {
    const same = readFileSync(FLYER_ITEMS, "utf8") === text;
    console.log(same ? "[record-items] OK: the recording matches the fixture" : "[record-items] DIFFERENT");
    process.exit(same ? 0 : 1);
  }
  writeFileSync(FLYER_ITEMS, text);
  console.log(`[record-items] wrote ${items.length} items to ${FLYER_ITEMS}`);
}
