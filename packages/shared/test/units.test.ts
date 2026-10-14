import { describe, expect, test } from "bun:test";
import { isKnownUnit, normalizeUnit, unitKind } from "../src/modules/recipe/units.ts";

describe("normalizeUnit", () => {
  test.each([
    ["g", "g"],
    ["Gramm", "g"],
    ["gr", "g"],
    ["G", "g"],
    ["kg", "kg"],
    ["Kilogramm", "kg"],
    ["ml", "ml"],
    ["Milliliter", "ml"],
    ["l", "l"],
    ["Liter", "l"],
    ["EL", "EL"],
    ["el", "EL"],
    ["Esslöffel", "EL"],
    ["tbsp", "EL"],
    ["TL", "TL"],
    ["Teelöffel", "TL"],
    ["tsp", "TL"],
    ["Msp.", "Msp."],
    ["Messerspitze", "Msp."],
    ["Prise", "Prise"],
    ["Prisen", "Prise"],
    ["pinch", "Prise"],
    ["Bund", "Bund"],
    ["Pck.", "Pck."],
    ["Packung", "Pck."],
    ["Päckchen", "Päckchen"],
    ["Stück", "Stück"],
    ["Stk", "Stück"],
    ["Dose", "Dose"],
    ["Dosen", "Dose"],
    ["Zehen", "Zehe"],
    ["Scheiben", "Scheibe"],
    ["cup", "Tasse"],
    ["Tassen", "Tasse"],
    ["cm", "cm"],
  ])("normalizes %s -> %s", (input, expected) => {
    expect(normalizeUnit(input)).toBe(expected);
  });

  test("keeps unknown units instead of dropping them", () => {
    expect(normalizeUnit("Schöpfkelle")).toBe("Schöpfkelle");
    expect(normalizeUnit("  Spitzer  ")).toBe("Spitzer");
  });

  test("empty input stays empty", () => {
    expect(normalizeUnit("   ")).toBe("");
  });
});

describe("isKnownUnit", () => {
  test("recognises German abbreviations with and without dots", () => {
    expect(isKnownUnit("EL")).toBe(true);
    expect(isKnownUnit("Pck.")).toBe(true);
    expect(isKnownUnit("Msp")).toBe(true);
    expect(isKnownUnit("Mehl")).toBe(false);
    expect(isKnownUnit("Eier")).toBe(false);
  });
});

describe("unitKind", () => {
  test("classifies units", () => {
    expect(unitKind("g")).toBe("mass");
    expect(unitKind("Gramm")).toBe("mass");
    expect(unitKind("ml")).toBe("volume");
    expect(unitKind("EL")).toBe("spoon");
    expect(unitKind("Zehe")).toBe("count");
    expect(unitKind("cm")).toBe("length");
    expect(unitKind("Schöpfkelle")).toBe("unknown");
  });
});
