import { describe, expect, test } from "bun:test";
import { BARCODE_FORMATS } from "@toon/shared";
import { CATALOGS } from "@/lib/i18n/catalogs/index.ts";
import {
  CARD_FORMAT_LABEL_KEYS,
  CARD_FORMAT_ORDER,
  allFormatsOffered,
  cardFormatFromScan,
} from "./formats.ts";

describe("CARD_FORMAT_ORDER", () => {
  test("offers every symbology the contract allows", () => {
    // A format the API accepts but the picker omits is a card nobody can save.
    expect(allFormatsOffered()).toBe(true);
    expect([...CARD_FORMAT_ORDER].sort()).toEqual([...BARCODE_FORMATS].sort());
  });

  test("leads with EAN-13, which is what a German loyalty card usually is", () => {
    expect(CARD_FORMAT_ORDER[0]).toBe("ean13");
  });
});

describe("CARD_FORMAT_LABEL_KEYS", () => {
  test("every format has a label key that exists in BOTH catalogs", () => {
    for (const format of BARCODE_FORMATS) {
      const key = CARD_FORMAT_LABEL_KEYS[format];
      expect(CATALOGS.de[key]).toBeDefined();
      expect(CATALOGS.en[key]).toBeDefined();
    }
  });
});

describe("cardFormatFromScan", () => {
  test("maps zxing's compact and human-readable spellings alike", () => {
    expect(cardFormatFromScan("EAN13")).toBe("ean13");
    expect(cardFormatFromScan("EAN-13")).toBe("ean13");
    expect(cardFormatFromScan("QRCode")).toBe("qr");
    expect(cardFormatFromScan("QR Code")).toBe("qr");
    expect(cardFormatFromScan("Code128")).toBe("code128");
    expect(cardFormatFromScan("Code 128")).toBe("code128");
    expect(cardFormatFromScan("ITF")).toBe("itf");
    expect(cardFormatFromScan("UPCA")).toBe("upca");
  });

  test("null for a code this app cannot draw", () => {
    // Storing one would be a card that fails at the till, which is the single
    // outcome the whole feature exists to avoid.
    for (const format of ["PDF417", "Aztec", "DataMatrix", "UPCE", "MaxiCode", ""]) {
      expect(cardFormatFromScan(format)).toBeNull();
    }
  });
});
