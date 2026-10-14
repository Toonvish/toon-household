import { describe, expect, test } from "bun:test";
import {
  formatIngredient,
  parseIngredientBlock,
  parseIngredientLine,
  parseStepBlock,
  scaleIngredients,
  scaleIngredientsToServings,
} from "../src/modules/recipe/ingredients.ts";
import { RecipeIngredientSchema } from "../src/modules/recipe/schemas/recipe.ts";
import { formatQuantity } from "../src/modules/recipe/numbers.ts";

describe("parseIngredientLine — German basics", () => {
  test("250 g Mehl", () => {
    expect(parseIngredientLine("250 g Mehl")).toMatchObject({
      quantity: 250,
      unit: "g",
      name: "Mehl",
      raw: "250 g Mehl",
      position: 0,
    });
  });

  test("glued unit: 250g Mehl", () => {
    expect(parseIngredientLine("250g Mehl")).toMatchObject({ quantity: 250, unit: "g", name: "Mehl" });
  });

  test("decimal comma: 1,5 kg Kartoffeln", () => {
    expect(parseIngredientLine("1,5 kg Kartoffeln")).toMatchObject({
      quantity: 1.5,
      unit: "kg",
      name: "Kartoffeln",
    });
  });

  test("unicode fraction: ½ TL Salz", () => {
    expect(parseIngredientLine("½ TL Salz")).toMatchObject({ quantity: 0.5, unit: "TL", name: "Salz" });
  });

  test("mixed unicode fraction: 1½ EL Öl", () => {
    expect(parseIngredientLine("1½ EL Öl")).toMatchObject({ quantity: 1.5, unit: "EL", name: "Öl" });
  });

  test("ascii fraction: 1/2 TL Zimt", () => {
    expect(parseIngredientLine("1/2 TL Zimt")).toMatchObject({ quantity: 0.5, unit: "TL", name: "Zimt" });
  });

  test("mixed ascii fraction: 1 1/2 Tassen Milch", () => {
    expect(parseIngredientLine("1 1/2 Tassen Milch")).toMatchObject({
      quantity: 1.5,
      unit: "Tasse",
      name: "Milch",
    });
  });

  test("range: 2-3 Eier", () => {
    expect(parseIngredientLine("2-3 Eier")).toMatchObject({
      quantity: 2,
      quantityMax: 3,
      name: "Eier",
      unit: undefined,
    });
  });

  test("range with en dash and unit: 2 – 3 EL Zucker", () => {
    expect(parseIngredientLine("2 – 3 EL Zucker")).toMatchObject({
      quantity: 2,
      quantityMax: 3,
      unit: "EL",
      name: "Zucker",
    });
  });

  test('range with "bis": 1 bis 2 Prisen Salz', () => {
    expect(parseIngredientLine("1 bis 2 Prisen Salz")).toMatchObject({
      quantity: 1,
      quantityMax: 2,
      unit: "Prise",
      name: "Salz",
    });
  });

  test('hedge "ca." becomes a note', () => {
    expect(parseIngredientLine("ca. 200 ml Milch")).toMatchObject({
      quantity: 200,
      unit: "ml",
      name: "Milch",
      note: "ca.",
    });
  });

  test('"etwas Öl zum Braten"', () => {
    const result = parseIngredientLine("etwas Öl zum Braten");
    expect(result.name).toBe("Öl");
    expect(result.quantity).toBeUndefined();
    expect(result.note).toContain("etwas");
    expect(result.note).toContain("zum Braten");
  });

  test("Salz und Pfeffer nach Geschmack", () => {
    expect(parseIngredientLine("Salz und Pfeffer nach Geschmack")).toMatchObject({
      quantity: undefined,
      unit: undefined,
      name: "Salz und Pfeffer",
      note: "nach Geschmack",
    });
  });

  test("parenthetical note", () => {
    expect(parseIngredientLine("200 g Zucker (oder Honig)")).toMatchObject({
      quantity: 200,
      unit: "g",
      name: "Zucker",
      note: "oder Honig",
    });
  });

  test("can size in parentheses", () => {
    expect(parseIngredientLine("1 Dose (400 g) gehackte Tomaten")).toMatchObject({
      quantity: 1,
      unit: "Dose",
      name: "gehackte Tomaten",
      note: "400 g",
    });
  });

  test("trailing comma note is split off", () => {
    expect(parseIngredientLine("1 Zwiebel, fein gehackt")).toMatchObject({
      quantity: 1,
      name: "Zwiebel",
      note: "fein gehackt",
    });
  });

  test("comma between two ingredients is NOT a note", () => {
    expect(parseIngredientLine("Salz, Pfeffer")).toMatchObject({ name: "Salz, Pfeffer", note: undefined });
  });

  test("spelled out amount: eine Prise Muskat", () => {
    expect(parseIngredientLine("eine Prise Muskat")).toMatchObject({
      quantity: 1,
      unit: "Prise",
      name: "Muskat",
    });
  });

  test("bullet and checkbox prefixes are stripped", () => {
    expect(parseIngredientLine("▢ 500 g Nudeln")).toMatchObject({ quantity: 500, unit: "g", name: "Nudeln" });
    expect(parseIngredientLine("- 2 EL Sojasauce")).toMatchObject({ quantity: 2, unit: "EL", name: "Sojasauce" });
    expect(parseIngredientLine("• 1 Bund Petersilie")).toMatchObject({
      quantity: 1,
      unit: "Bund",
      name: "Petersilie",
    });
  });

  test("multiplier: 2 x 400 g Kichererbsen", () => {
    const result = parseIngredientLine("2 x 400 g Kichererbsen");
    expect(result).toMatchObject({ quantity: 800, unit: "g", name: "Kichererbsen" });
    expect(result.note).toContain("2 x 400");
  });

  test("per-unit size: 2 Dosen à 400 g Tomaten", () => {
    const result = parseIngredientLine("2 Dosen à 400 g Tomaten");
    expect(result).toMatchObject({ quantity: 2, unit: "Dose", name: "Tomaten" });
    expect(result.note).toContain("à 400 g");
  });

  test("Pck. Vanillezucker", () => {
    expect(parseIngredientLine("1 Pck. Vanillezucker")).toMatchObject({
      quantity: 1,
      unit: "Pck.",
      name: "Vanillezucker",
    });
  });

  test("Zehen Knoblauch", () => {
    expect(parseIngredientLine("3 Zehen Knoblauch")).toMatchObject({
      quantity: 3,
      unit: "Zehe",
      name: "Knoblauch",
    });
  });

  test("no quantity at all", () => {
    expect(parseIngredientLine("Zitronenschale")).toMatchObject({
      quantity: undefined,
      unit: undefined,
      name: "Zitronenschale",
    });
  });

  test("English line still parses", () => {
    expect(parseIngredientLine("2 cups flour, sifted")).toMatchObject({
      quantity: 2,
      unit: "Tasse",
      name: "flour",
      note: "sifted",
    });
  });

  test("position is passed through", () => {
    expect(parseIngredientLine("1 Ei", 7).position).toBe(7);
  });

  test("every parsed line satisfies the contract schema", () => {
    const lines = [
      "250 g Mehl",
      "2-3 Eier",
      "ca. 200 ml Milch",
      "Salz und Pfeffer nach Geschmack",
      "1 Zwiebel, fein gehackt",
      "½ TL Backpulver",
    ];
    for (const line of lines) {
      const parsed = RecipeIngredientSchema.safeParse(parseIngredientLine(line));
      expect(parsed.success).toBe(true);
    }
  });
});

describe("parseIngredientBlock", () => {
  test("assigns positions and sections", () => {
    const block = [
      "Für den Teig:",
      "300 g Mehl",
      "1 Pck. Trockenhefe",
      "",
      "Für den Belag:",
      "200 g Tomaten",
    ].join("\n");
    const result = parseIngredientBlock(block);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ position: 0, section: "Für den Teig", name: "Mehl" });
    expect(result[1]).toMatchObject({ position: 1, section: "Für den Teig", unit: "Pck." });
    expect(result[2]).toMatchObject({ position: 2, section: "Für den Belag", name: "Tomaten" });
  });
});

describe("parseStepBlock", () => {
  test("splits numbered steps", () => {
    const text = "1. Mehl und Hefe mischen.\n2. Wasser zugeben und kneten.\n3. 60 Minuten gehen lassen.";
    const steps = parseStepBlock(text);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ position: 0, text: "Mehl und Hefe mischen." });
    expect(steps[2]!.text).toBe("60 Minuten gehen lassen.");
  });

  test("splits paragraphs when there is no numbering", () => {
    const steps = parseStepBlock("Zwiebeln anbraten.\n\nTomaten zugeben und köcheln lassen.");
    expect(steps).toHaveLength(2);
  });
});

describe("scaleIngredients", () => {
  const base = [
    parseIngredientLine("250 g Mehl", 0),
    parseIngredientLine("2-3 Eier", 1),
    parseIngredientLine("1 Prise Salz", 2),
    parseIngredientLine("Zitronenschale", 3),
  ];

  test("doubles quantities", () => {
    const scaled = scaleIngredients(base, 2);
    expect(scaled[0]!.quantity).toBe(500);
    expect(scaled[1]!.quantity).toBe(4);
    expect(scaled[1]!.quantityMax).toBe(6);
    expect(scaled[2]!.quantity).toBe(2);
    expect(scaled[3]!.quantity).toBeUndefined();
  });

  test("halves into readable fractions", () => {
    const scaled = scaleIngredients([parseIngredientLine("1 TL Salz")], 0.5);
    expect(scaled[0]!.quantity).toBe(0.5);
    expect(formatQuantity(scaled[0]!.quantity!)).toBe("½");
  });

  test("does not mutate the input", () => {
    scaleIngredients(base, 3);
    expect(base[0]!.quantity).toBe(250);
  });

  test("keepNonScalingUnits leaves a Prise alone", () => {
    const scaled = scaleIngredients(base, 4, { keepNonScalingUnits: true });
    expect(scaled[0]!.quantity).toBe(1000);
    expect(scaled[2]!.quantity).toBe(1);
  });

  test("rejects invalid factors", () => {
    expect(() => scaleIngredients(base, 0)).toThrow(RangeError);
    expect(() => scaleIngredients(base, -1)).toThrow(RangeError);
    expect(() => scaleIngredients(base, Number.NaN)).toThrow(RangeError);
  });

  test("scaleIngredientsToServings 4 -> 6", () => {
    const scaled = scaleIngredientsToServings([parseIngredientLine("200 g Reis")], 4, 6);
    expect(scaled[0]!.quantity).toBe(300);
  });
});

describe("formatIngredient", () => {
  test("round-trips a German line", () => {
    const ingredient = parseIngredientLine("250 g Mehl");
    expect(formatIngredient(ingredient, formatQuantity)).toBe("250 g Mehl");
  });

  test("renders ranges and notes", () => {
    const ingredient = parseIngredientLine("2-3 Eier (Größe M)");
    expect(formatIngredient(ingredient, formatQuantity)).toBe("2-3 Eier (Größe M)");
  });
});

describe("cleanupName trims the same characters at both ends", () => {
  // The trailing character class used to omit "." "-" "–" "—", so a line ending in a
  // German abbreviation kept its full stop in the STORED name. Shopping-list merging
  // hid it (nameKey re-strips independently); the recipe's own ingredient list did not.
  test("drops a trailing full stop", () => {
    expect(parseIngredientLine("1 Pck. Vanillezucker.").name).toBe("Vanillezucker");
    expect(parseIngredientLine("1 Prise Salz.").name).toBe("Salz");
  });

  test("drops a trailing dash", () => {
    expect(parseIngredientLine("250 g Butter -").name).toBe("Butter");
    expect(parseIngredientLine("3 Eier –").name).toBe("Eier");
  });

  test("leaves an interior dot or hyphen alone", () => {
    expect(parseIngredientLine("200 g Crème fraîche").name).toBe("Crème fraîche");
    expect(parseIngredientLine("1 Dose Tomaten-Passata").name).toBe("Tomaten-Passata");
  });

  test("still strips leading punctuation, as it always did", () => {
    expect(parseIngredientLine("- 250 g Mehl").name).toBe("Mehl");
  });
});
