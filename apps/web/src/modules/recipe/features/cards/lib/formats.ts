/**
 * Symbology names for the UI, and the mapping from what zxing reports back.
 *
 * The labels are CATALOG KEYS, never resolved strings. A `Record<BarcodeFormat,
 * string>` built at module scope would freeze at whichever locale loaded first and
 * then keep rendering it after a language switch — the same trap that removed
 * `roleLabels`/`difficultyLabels` from lib/format.ts (see CLAUDE.md). Components
 * resolve these with `useT()` so they re-render.
 */
import { BARCODE_FORMATS, type BarcodeFormat } from "@toon/shared";
import type { MessageKey } from "@/lib/i18n/catalogs/index.ts";

/** Catalog key of each symbology's display name. */
export const CARD_FORMAT_LABEL_KEYS = {
  qr: "recipe.cards.format.qr",
  ean13: "recipe.cards.format.ean13",
  ean8: "recipe.cards.format.ean8",
  upca: "recipe.cards.format.upca",
  code128: "recipe.cards.format.code128",
  code39: "recipe.cards.format.code39",
  itf: "recipe.cards.format.itf",
} as const satisfies Record<BarcodeFormat, MessageKey>;

/**
 * The order the picker offers them in: what a German loyalty card is most likely
 * to be, first. NOT the wire order of `BARCODE_FORMATS`, and not alphabetical —
 * scrolling past ITF to reach EAN-13 would be the wrong default for every user.
 */
export const CARD_FORMAT_ORDER: readonly BarcodeFormat[] = [
  "ean13",
  "qr",
  "code128",
  "code39",
  "ean8",
  "upca",
  "itf",
];

/** Every supported format appears in the picker — asserted by a unit test. */
export function allFormatsOffered(): boolean {
  return BARCODE_FORMATS.every((format) => CARD_FORMAT_ORDER.includes(format));
}

/**
 * zxing's format name -> ours.
 *
 * zxing-wasm 3 reports the compact spelling (`"EAN13"`, `"Code128"`, `"QRCode"`),
 * but older and newer builds have used the human-readable one (`"EAN-13"`,
 * `"Code 128"`, `"QR Code"`), so BOTH are listed rather than normalised by a regex
 * — a rename in the library should show up as "code type not supported" (which
 * tells the user to type the number) instead of a mis-mapped symbology.
 *
 * `UPCA` maps to `upca`; note that zxing legitimately reports a UPC-A symbol as
 * `EAN13` with a leading zero, because that is bit-for-bit what it is. Storing it
 * as `ean13` re-encodes to the identical bars, so both readings are correct.
 */
const ZXING_FORMATS: Readonly<Record<string, BarcodeFormat>> = {
  QRCode: "qr",
  "QR Code": "qr",
  QRCodeModel2: "qr",
  EAN13: "ean13",
  "EAN-13": "ean13",
  EAN8: "ean8",
  "EAN-8": "ean8",
  UPCA: "upca",
  "UPC-A": "upca",
  Code128: "code128",
  "Code 128": "code128",
  Code39: "code39",
  "Code 39": "code39",
  Code39Std: "code39",
  ITF: "itf",
  ITF14: "itf",
  "ITF-14": "itf",
};

/**
 * The format a scan can be SAVED as, or `null` for a code this app cannot draw
 * (Data Matrix, PDF417, Aztec, UPC-E …).
 *
 * Deliberately not "store it anyway and worry later": a saved card that cannot be
 * rendered is a card that fails at the till, which is the one outcome this feature
 * exists to prevent.
 */
export function cardFormatFromScan(zxingFormat: string): BarcodeFormat | null {
  return ZXING_FORMATS[zxingFormat] ?? null;
}
