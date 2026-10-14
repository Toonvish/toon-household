import { describe, expect, test } from "bun:test";
import {
  BARCODE_FORMATS,
  BarcodeValueError,
  checkBarcodeValue,
  encodeBarcode,
  gs1CheckDigit,
  isMatrixBarcode,
  normalizeBarcodeValue,
  type BarcodeFormat,
} from "../src/modules/recipe/barcode.ts";

/** `true` -> "1", for comparing a symbol against a spec pattern by eye. */
function bits(modules: readonly boolean[]): string {
  return modules.map((dark) => (dark ? "1" : "0")).join("");
}

describe("gs1CheckDigit", () => {
  test.each([
    ["405912345678", 8],
    ["401234567890", 1],
    ["978020137962", 4],
    ["9638507", 4],
    ["03600029145", 2],
  ])("%s -> %i", (payload, expected) => {
    expect(gs1CheckDigit(payload)).toBe(expected);
  });
});

describe("normalizeBarcodeValue", () => {
  test("strips the separators a card prints for legibility", () => {
    expect(normalizeBarcodeValue("ean13", "4 059 123 456 788")).toBe("4059123456788");
    expect(normalizeBarcodeValue("ean13", "4059-1234-56788")).toBe("4059123456788");
  });

  test("completes a missing check digit for the EAN/UPC family", () => {
    // The 12 digits printed under a Payback barcode are enough to type in.
    expect(normalizeBarcodeValue("ean13", "405912345678")).toBe("4059123456788");
    expect(normalizeBarcodeValue("ean8", "9638507")).toBe("96385074");
    expect(normalizeBarcodeValue("upca", "03600029145")).toBe("036000291452");
  });

  test("does not touch a complete code", () => {
    expect(normalizeBarcodeValue("ean13", "4059123456788")).toBe("4059123456788");
  });

  test("pads an odd ITF value, because ITF encodes digit PAIRS", () => {
    expect(normalizeBarcodeValue("itf", "1234567")).toBe("01234567");
    expect(normalizeBarcodeValue("itf", "12345678")).toBe("12345678");
  });

  test("upper-cases code39 (the symbology has no lower case)", () => {
    expect(normalizeBarcodeValue("code39", " mitglied-42 ")).toBe("MITGLIED-42");
  });

  test("keeps code128 and qr as typed, apart from surrounding space", () => {
    expect(normalizeBarcodeValue("code128", " aB12-x ")).toBe("aB12-x");
    expect(normalizeBarcodeValue("qr", " https://example.com/x ")).toBe("https://example.com/x");
  });
});

describe("checkBarcodeValue", () => {
  test("accepts a valid value for every format", () => {
    expect(checkBarcodeValue("ean13", "4059123456788")).toBeNull();
    expect(checkBarcodeValue("ean8", "96385074")).toBeNull();
    expect(checkBarcodeValue("upca", "036000291452")).toBeNull();
    expect(checkBarcodeValue("code128", "AB-123456")).toBeNull();
    expect(checkBarcodeValue("code39", "MITGLIED-42")).toBeNull();
    expect(checkBarcodeValue("itf", "12345678")).toBeNull();
    expect(checkBarcodeValue("qr", "https://example.com/x")).toBeNull();
  });

  test("rejects a wrong check digit — the one save-time evidence of a typo", () => {
    expect(checkBarcodeValue("ean13", "4059123456789")).toBe("check_digit");
    expect(checkBarcodeValue("ean8", "96385079")).toBe("check_digit");
    expect(checkBarcodeValue("upca", "036000291459")).toBe("check_digit");
  });

  test("reports why, one reason per problem", () => {
    expect(checkBarcodeValue("ean13", "")).toBe("empty");
    expect(checkBarcodeValue("ean13", "40591234567")).toBe("wrong_length");
    expect(checkBarcodeValue("ean13", "40591234567AB")).toBe("digits_only");
    expect(checkBarcodeValue("itf", "1234567")).toBe("odd_length");
    expect(checkBarcodeValue("code39", "Kunde")).toBe("charset");
    expect(checkBarcodeValue("code128", "ok")).toBe("charset");
    expect(checkBarcodeValue("qr", "x".repeat(513))).toBe("too_long");
    expect(checkBarcodeValue("code128", "x".repeat(49))).toBe("too_long");
  });

  test("every format has a length ceiling and rejects the empty string", () => {
    for (const format of BARCODE_FORMATS) {
      expect(checkBarcodeValue(format, "")).toBe("empty");
    }
  });
});

describe("encodeBarcode", () => {
  test("EAN-13 is 95 modules with the spec's guard patterns", () => {
    const symbol = encodeBarcode("ean13", "4059123456788");
    expect(symbol.modules).toHaveLength(95);
    const pattern = bits(symbol.modules);
    expect(pattern.startsWith("101")).toBe(true);
    expect(pattern.endsWith("101")).toBe(true);
    expect(pattern.slice(45, 50)).toBe("01010"); // centre guard
    expect(symbol.text).toBe("4059123456788");
  });

  test("EAN-13 encodes the first digit as the left group's parity", () => {
    // First digit 0 means all six left digits use the L set, so the left half of
    // "0000000000000" is six copies of L(0) = 0001101.
    const symbol = encodeBarcode("ean13", "0000000000000");
    expect(bits(symbol.modules).slice(3, 45)).toBe("0001101".repeat(6));
  });

  test("EAN-8 is 67 modules", () => {
    expect(encodeBarcode("ean8", "96385074").modules).toHaveLength(67);
  });

  test("UPC-A is EAN-13 of the same digits with a leading zero", () => {
    const upc = encodeBarcode("upca", "036000291452");
    const ean = encodeBarcode("ean13", "0036000291452");
    expect(bits(upc.modules)).toBe(bits(ean.modules));
    // …but it prints its own twelve digits, not thirteen.
    expect(upc.text).toBe("036000291452");
  });

  test("Code 39 frames the data with the * start/stop character", () => {
    const one = encodeBarcode("code39", "A");
    const three = encodeBarcode("code39", "AAA");
    // Every character is 9 elements (3 of them wide -> 12 modules) plus a
    // narrow gap, so each extra character costs 13 modules.
    expect(three.modules.length - one.modules.length).toBe(26);
    expect(one.modules[0]).toBe(true);
    expect(one.modules.at(-1)).toBe(true);
  });

  test("Code 128 switches to code set C for a long digit run", () => {
    // Sixteen digits as eight pairs is far shorter than sixteen single symbols.
    const numeric = encodeBarcode("code128", "1234567890123456");
    const alpha = encodeBarcode("code128", "ABCDEFGHIJKLMNOP");
    expect(numeric.modules.length).toBeLessThan(alpha.modules.length);
  });

  test("ITF pairs its digits, so two more digits cost one symbol's width", () => {
    const four = encodeBarcode("itf", "1234");
    const six = encodeBarcode("itf", "123456");
    expect(six.modules.length - four.modules.length).toBe(
      // one interleaved pair: five bars + five spaces, two of each wide
      2 * (5 + 2),
    );
  });

  test("refuses a value that never passed validation", () => {
    expect(() => encodeBarcode("ean13", "4059123456789")).toThrow(BarcodeValueError);
    try {
      encodeBarcode("ean13", "4059123456789");
    } catch (error) {
      expect((error as BarcodeValueError).reason).toBe("check_digit");
      expect((error as BarcodeValueError).format).toBe("ean13");
    }
  });

  test("refuses the matrix format — that is encodeQr's job", () => {
    expect(() => encodeBarcode("qr" as BarcodeFormat, "x")).toThrow(BarcodeValueError);
  });

  test("every linear format produces bars and a quiet zone", () => {
    const samples: Record<Exclude<BarcodeFormat, "qr">, string> = {
      ean13: "4059123456788",
      ean8: "96385074",
      upca: "036000291452",
      code128: "AB-123456",
      code39: "MITGLIED-42",
      itf: "12345678",
    };
    for (const [format, value] of Object.entries(samples)) {
      const symbol = encodeBarcode(format as BarcodeFormat, value);
      expect(symbol.modules.length).toBeGreaterThan(20);
      expect(symbol.quietZone).toBeGreaterThanOrEqual(7);
      expect(symbol.modules.some((dark) => dark)).toBe(true);
    }
  });
});

describe("isMatrixBarcode", () => {
  test("qr is the only matrix format", () => {
    for (const format of BARCODE_FORMATS) {
      expect(isMatrixBarcode(format)).toBe(format === "qr");
    }
  });
});
