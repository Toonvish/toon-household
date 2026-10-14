import { describe, expect, test } from "bun:test";
import { emptyParsedRecipe, parseIngredientLine } from "@toon/shared";
import {
  confidenceLevel,
  countRowsNeedingCheck,
  fieldNeedsCheck,
  formatConfidence,
  ingredientCheck,
  stepCheck,
} from "./confidence";

describe("confidenceLevel", () => {
  test("maps values to levels", () => {
    expect(confidenceLevel(undefined)).toBe("unknown");
    expect(confidenceLevel(0.2)).toBe("low");
    expect(confidenceLevel(0.6)).toBe("medium");
    expect(confidenceLevel(0.9)).toBe("high");
  });

  test("formats percentages", () => {
    expect(formatConfidence(0.62)).toBe("62 %");
    expect(formatConfidence(null)).toBe("unbekannt");
  });
});

describe("fieldNeedsCheck", () => {
  test("uses the parser confidence when present", () => {
    const draft = emptyParsedRecipe({ title: "Kuchen", confidence: { overall: 1, title: 0.4 } });
    expect(fieldNeedsCheck(draft, "title")).toBe(true);

    const good = emptyParsedRecipe({ title: "Kuchen", confidence: { overall: 1, title: 0.95 } });
    expect(fieldNeedsCheck(good, "title")).toBe(false);
  });

  test("falls back to emptiness when the parser has no opinion", () => {
    const draft = emptyParsedRecipe({ confidence: { overall: 1 } });
    expect(fieldNeedsCheck(draft, "title")).toBe(true);
    expect(fieldNeedsCheck(draft, "servings")).toBe(true);
    expect(fieldNeedsCheck(draft, "times")).toBe(true);
    expect(fieldNeedsCheck(draft, "ingredients")).toBe(true);

    const filled = emptyParsedRecipe({
      title: "Kuchen",
      servings: { amount: 4, unit: "Portionen" },
      totalMinutes: 45,
      ingredients: [parseIngredientLine("250 g Mehl")],
      confidence: { overall: 1 },
    });
    expect(fieldNeedsCheck(filled, "title")).toBe(false);
    expect(fieldNeedsCheck(filled, "servings")).toBe(false);
    expect(fieldNeedsCheck(filled, "times")).toBe(false);
    expect(fieldNeedsCheck(filled, "ingredients")).toBe(false);
  });
});

describe("ingredientCheck", () => {
  test("a clean row is not flagged", () => {
    expect(ingredientCheck(parseIngredientLine("250 g Mehl")).needsCheck).toBe(false);
  });

  test("flags an unknown unit", () => {
    const row = { ...parseIngredientLine("2 Mehl"), unit: "gr0mm" };
    const check = ingredientCheck(row);
    expect(check.needsCheck).toBe(true);
    expect(check.reasons.join(" ")).toContain("gr0mm");
  });

  test("flags a digit in the raw line without a parsed quantity", () => {
    const row = { ...parseIngredientLine("Mehl"), raw: "25O g Mehl" };
    expect(ingredientCheck(row).needsCheck).toBe(true);
  });

  test("flags OCR noise and missing names", () => {
    expect(ingredientCheck({ position: 0, name: "M|ehl", raw: "M|ehl" }).needsCheck).toBe(true);
    expect(ingredientCheck({ position: 0, name: "", raw: "" }).needsCheck).toBe(true);
  });

  test("flags a quantity that is still stuck in the name", () => {
    const check = ingredientCheck({ position: 0, name: "Mehl 250 g", raw: "Mehl 250 g" });
    expect(check.needsCheck).toBe(true);
  });

  test("propagates a low list confidence to otherwise clean rows", () => {
    const clean = parseIngredientLine("250 g Mehl");
    expect(ingredientCheck(clean, 0.3).needsCheck).toBe(true);
    expect(ingredientCheck(clean, 0.9).needsCheck).toBe(false);
  });
});

describe("stepCheck", () => {
  test("flags empty and very short steps", () => {
    expect(stepCheck({ position: 0, text: "" }).needsCheck).toBe(true);
    expect(stepCheck({ position: 0, text: "Backen" }).needsCheck).toBe(true);
    expect(stepCheck({ position: 0, text: "Den Teig 30 Minuten ruhen lassen." }).needsCheck).toBe(false);
  });
});

describe("countRowsNeedingCheck", () => {
  test("counts both lists", () => {
    const draft = emptyParsedRecipe({
      ingredients: [parseIngredientLine("250 g Mehl"), { position: 1, name: "", raw: "" }],
      steps: [{ position: 0, text: "Kurz" }, { position: 1, text: "Alles gut vermengen und ruhen lassen." }],
      confidence: { overall: 0.8 },
    });
    expect(countRowsNeedingCheck(draft)).toEqual({ ingredients: 1, steps: 1 });
  });
});
