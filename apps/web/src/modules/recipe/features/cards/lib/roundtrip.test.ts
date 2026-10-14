/**
 * THE TEST THAT ACTUALLY PROVES THE ENCODERS ARE RIGHT.
 *
 * `@toon/shared`'s barcode and QR encoders are hand-rolled (see the headers of
 * `packages/shared/src/barcode.ts` and `qr.ts` for why the display path may own no
 * dependency). Their unit tests check structure — guard patterns, module counts,
 * check digits — but no amount of that can tell us a real scanner will read the
 * symbol, and the tables they are built on are spec data transcribed by hand: one
 * wrong entry in the Code 128 pattern table or the QR ECC-block table produces a
 * barcode that looks perfect and scans as nothing, or worse, as the wrong number.
 *
 * So this file ENCODES with our code and DECODES with zxing — the same decoder the
 * camera scanner uses, an independent implementation of the same standards. A
 * mistranscribed table fails here instead of at a till.
 *
 * It lives in `apps/web` because that is where zxing-wasm is a dependency, and the
 * wasm is loaded from `node_modules` as BYTES (`wasmBinary`), so the test needs no
 * network and no CDN.
 *
 * Coverage worth keeping:
 *  - every linear symbology, and for Code 39 / Code 128 the WHOLE character set in
 *    chunks — a single wrong pattern entry would otherwise hide behind a sample
 *    value that happens not to use it,
 *  - QR at several sizes and all four ECC levels, which is what exercises the
 *    version tables and the Reed–Solomon block layout.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  encodeBarcode,
  encodeQr,
  normalizeBarcodeValue,
  type BarcodeFormat,
  type QrEccLevel,
} from "@toon/shared";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

/** Scale and quiet zone of the rendered bitmaps — generous, this is not a stress test. */
const SCALE = 3;
const BAR_HEIGHT = 60;

beforeAll(async () => {
  // Bun.resolveSync honours the package's export map, so this keeps working if the
  // dependency moves the file. The bytes are handed to Emscripten directly —
  // `locateFile` would make it try to fetch, which a test must never do.
  const wasmPath = Bun.resolveSync("zxing-wasm/reader/zxing_reader.wasm", import.meta.dir);
  const wasm = await readFile(wasmPath);
  prepareZXingModule({
    overrides: { wasmBinary: wasm.buffer as ArrayBuffer } as never,
  });
});

/** An RGBA bitmap of a linear symbol, black bars on white. */
function linearBitmap(modules: readonly boolean[], quietZone: number): ImageData {
  const width = (modules.length + quietZone * 2) * SCALE;
  const data = new Uint8ClampedArray(width * BAR_HEIGHT * 4).fill(255);
  for (let index = 0; index < modules.length; index += 1) {
    if (modules[index] !== true) continue;
    for (let step = 0; step < SCALE; step += 1) {
      const x = (index + quietZone) * SCALE + step;
      for (let y = 0; y < BAR_HEIGHT; y += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
      }
    }
  }
  return { data, width, height: BAR_HEIGHT, colorSpace: "srgb" } as unknown as ImageData;
}

/** An RGBA bitmap of a QR matrix with its quiet zone. */
function matrixBitmap(modules: readonly boolean[][], quietZone = 4): ImageData {
  const size = modules.length;
  const side = (size + quietZone * 2) * SCALE;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (modules[row]?.[column] !== true) continue;
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          const x = (column + quietZone) * SCALE + dx;
          const y = (row + quietZone) * SCALE + dy;
          const offset = (y * side + x) * 4;
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
        }
      }
    }
  }
  return { data, width: side, height: side, colorSpace: "srgb" } as unknown as ImageData;
}

async function decode(bitmap: ImageData): Promise<{ text: string; format: string } | undefined> {
  const results = await readBarcodes(bitmap, { tryHarder: true });
  const hit = results.find((result) => result.text.length > 0);
  return hit === undefined ? undefined : { text: hit.text, format: hit.format };
}

/**
 * zxing's format spellings we accept per symbology.
 *
 * `upca` legitimately comes back as an EAN-13 with a leading zero, because a UPC-A
 * symbol IS that bit pattern — see `encodeBarcode`'s `upca` branch.
 */
const ZXING_NAMES: Record<Exclude<BarcodeFormat, "qr">, readonly string[]> = {
  ean13: ["EAN13", "EAN-13"],
  ean8: ["EAN8", "EAN-8"],
  upca: ["UPCA", "UPC-A", "EAN13", "EAN-13"],
  code128: ["Code128", "Code 128"],
  code39: ["Code39", "Code 39", "Code39Std"],
  itf: ["ITF"],
};

/** Encodes `raw` as `format` and asserts zxing reads the normalised value back. */
async function expectRoundTrip(format: Exclude<BarcodeFormat, "qr">, raw: string): Promise<void> {
  const value = normalizeBarcodeValue(format, raw);
  const symbol = encodeBarcode(format, value);
  const decoded = await decode(linearBitmap(symbol.modules, symbol.quietZone));
  expect(decoded, `${format} ${value} did not decode at all`).toBeDefined();
  expect(ZXING_NAMES[format]).toContain(decoded?.format ?? "");
  // UPC-A may be reported with the leading zero it structurally carries.
  expect([value, `0${value}`]).toContain(decoded?.text ?? "");
}

describe("linear barcodes decode with zxing", () => {
  test("EAN-13, including a value whose check digit we completed", async () => {
    await expectRoundTrip("ean13", "405912345678");
    await expectRoundTrip("ean13", "4012345678901");
    await expectRoundTrip("ean13", "9780201379624");
  });

  test("EAN-8", async () => {
    await expectRoundTrip("ean8", "9638507");
    await expectRoundTrip("ean8", "40123455");
  });

  test("UPC-A", async () => {
    await expectRoundTrip("upca", "03600029145");
    await expectRoundTrip("upca", "012345678905");
  });

  test("ITF, which encodes digit pairs", async () => {
    await expectRoundTrip("itf", "1234567890");
    await expectRoundTrip("itf", "00012345678905");
  });

  test("Code 39 across its ENTIRE character set", async () => {
    const charset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";
    for (let index = 0; index < charset.length; index += 10) {
      await expectRoundTrip("code39", charset.slice(index, index + 10));
    }
  });

  test("Code 128 across every printable ASCII character", async () => {
    let printable = "";
    for (let code = 32; code <= 126; code += 1) printable += String.fromCharCode(code);
    for (let index = 0; index < printable.length; index += 12) {
      await expectRoundTrip("code128", printable.slice(index, index + 12));
    }
  });

  test("Code 128 switching between code sets B and C", async () => {
    // Each of these takes a different path through `code128Symbols`: start in C,
    // start in B and switch, an odd digit run, and runs too short to switch for.
    for (const value of ["1234567890123456", "A1234567890B", "ABC12345", "12", "X", "AB12"]) {
      await expectRoundTrip("code128", value);
    }
  });
});

describe("QR codes decode with zxing", () => {
  test("a card number at every ECC level", async () => {
    for (const ecc of ["L", "M", "Q", "H"] as QrEccLevel[]) {
      const text = "4059123456788";
      const matrix = encodeQr(text, { ecc });
      const decoded = await decode(matrixBitmap(matrix.modules));
      expect(decoded?.text, `QR ${ecc} v${matrix.version}`).toBe(text);
    }
  });

  test("numeric, alphanumeric and byte mode", async () => {
    for (const text of [
      "9982371",
      "PAYBACK 4059 1234",
      "https://example.com/loyalty/9982371",
      "Müller & Söhne — Kundenkarte 4711",
    ]) {
      const matrix = encodeQr(text);
      const decoded = await decode(matrixBitmap(matrix.modules));
      expect(decoded?.text, `QR v${matrix.version} for ${text}`).toBe(text);
    }
  });

  test("a long payload, which is what exercises the version tables", async () => {
    // Digits chosen so the encoder has to climb well past version 10, i.e. through
    // the multi-block Reed-Solomon layout and the version-information block.
    for (const length of [120, 400, 900]) {
      const text = "7".repeat(length);
      const matrix = encodeQr(text, { ecc: "L" });
      expect(matrix.version).toBeGreaterThan(1);
      const decoded = await decode(matrixBitmap(matrix.modules));
      expect(decoded?.text, `QR v${matrix.version} (${length} digits)`).toBe(text);
    }
  });
});
