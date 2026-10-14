import { describe, expect, test } from "bun:test";
import { parseIngredientLine, scaleIngredientsToServings } from "../src/modules/recipe/ingredients.ts";
import { formatQuantity } from "../src/modules/recipe/numbers.ts";
import {
  addAmounts,
  FREQUENT_CHIP_COUNT,
  formatShoppingAmount,
  ingredientToShoppingItem,
  isVagueAmount,
  mergeNotes,
  mergeShoppingItems,
  recipeToShoppingItems,
  selectMostBoughtEntries,
  shoppingItemKey,
  shoppingProgressPercent,
  sortEntriesByFoldedName,
  unitBucket,
  type ShoppingDraftItem,
} from "../src/modules/recipe/shopping.ts";
import { nameKey } from "../src/core/text.ts";
import { areUnitsCompatible, convertUnit, preferredDisplayUnit } from "../src/modules/recipe/units.ts";

function draft(
  name: string,
  quantity: number | null = null,
  unit: string | null = null,
  note: string | null = null,
  sourceRecipeIds: string[] = [],
): ShoppingDraftItem {
  return { name, quantity, unit, note, sourceRecipeIds };
}

describe("nameKey", () => {
  test.each([
    ["Mehl", "mehl"],
    ["  Mehl  ", "mehl"],
    ["MEHL,", "mehl"],
    ["Möhren", "mohren"],
    ["Grieß", "griess"],
    ["Crème fraîche", "creme fraiche"],
    ["passierte   Tomaten", "passierte tomaten"],
  ])("%s -> %s", (input, expected) => {
    expect(nameKey(input)).toBe(expected);
  });

  test("folds spellings onto the same key", () => {
    expect(nameKey("Möhren")).toBe(nameKey("mohren"));
    expect(nameKey("Grieß")).toBe(nameKey("Griess"));
  });
});

describe("convertUnit", () => {
  test.each([
    [1, "kg", "g", 1000],
    [1500, "g", "kg", 1.5],
    [1, "l", "ml", 1000],
    [250, "ml", "l", 0.25],
    [1, "cl", "ml", 10],
    [1, "cm", "mm", 10],
  ])("%s %s -> %s %s", (value, from, to, expected) => {
    expect(convertUnit(value, from, to)).toBeCloseTo(expected, 6);
  });

  test("accepts alias spellings on both sides", () => {
    expect(convertUnit(1, "Kilogramm", "Gramm")).toBe(1000);
  });

  test("refuses across kinds and for units without a fixed ratio", () => {
    expect(convertUnit(1, "g", "ml")).toBeUndefined();
    expect(convertUnit(1, "EL", "ml")).toBeUndefined();
    expect(convertUnit(1, "Dose", "g")).toBeUndefined();
    // A cup has no standard size in German recipes, so it stays incomparable.
    expect(convertUnit(1, "Tasse", "ml")).toBeUndefined();
  });
});

describe("areUnitsCompatible", () => {
  test("same token, and same convertible kind", () => {
    expect(areUnitsCompatible("g", "g")).toBe(true);
    expect(areUnitsCompatible("g", "kg")).toBe(true);
    expect(areUnitsCompatible("ml", "l")).toBe(true);
    expect(areUnitsCompatible("EL", "EL")).toBe(true);
  });

  test("two missing units are compatible (3 Eier + 2 Eier)", () => {
    expect(areUnitsCompatible(null, null)).toBe(true);
    expect(areUnitsCompatible(null, "")).toBe(true);
  });

  test("a missing unit never merges with a present one", () => {
    expect(areUnitsCompatible(null, "g")).toBe(false);
    expect(areUnitsCompatible("g", undefined)).toBe(false);
  });

  test("different kinds and unconvertible tokens stay apart", () => {
    expect(areUnitsCompatible("g", "ml")).toBe(false);
    expect(areUnitsCompatible("g", "EL")).toBe(false);
    expect(areUnitsCompatible("EL", "TL")).toBe(false);
  });
});

describe("preferredDisplayUnit", () => {
  test.each([
    [1200, "g", 1.2, "kg"],
    [800, "g", 800, "g"],
    [1000, "g", 1, "kg"],
    [1500, "ml", 1.5, "l"],
    [0.5, "kg", 500, "g"],
    [0.2, "g", 0.2, "g"],
  ])("%s %s -> %s %s", (quantity, unit, expectedQuantity, expectedUnit) => {
    const result = preferredDisplayUnit(quantity, unit);
    expect(result.quantity).toBeCloseTo(expectedQuantity, 6);
    expect(result.unit).toBe(expectedUnit);
  });

  test("leaves unconvertible units alone", () => {
    expect(preferredDisplayUnit(5, "EL")).toEqual({ quantity: 5, unit: "EL" });
    expect(preferredDisplayUnit(3, "Dose")).toEqual({ quantity: 3, unit: "Dose" });
  });
});

describe("unitBucket / shoppingItemKey", () => {
  test("convertible units share a bucket, others do not", () => {
    expect(unitBucket("g")).toBe(unitBucket("kg"));
    expect(unitBucket("ml")).toBe(unitBucket("l"));
    expect(unitBucket("EL")).not.toBe(unitBucket("TL"));
    expect(unitBucket("g")).not.toBe(unitBucket("ml"));
    expect(unitBucket(null)).toBe("");
  });

  test("same key for spellings and convertible units", () => {
    expect(shoppingItemKey("Mehl", "g")).toBe(shoppingItemKey("mehl", "kg"));
    expect(shoppingItemKey("Möhren", null)).toBe(shoppingItemKey("mohren", ""));
  });

  test("different key for different units or names", () => {
    expect(shoppingItemKey("Mehl", "g")).not.toBe(shoppingItemKey("Mehl", "EL"));
    expect(shoppingItemKey("Mehl", "g")).not.toBe(shoppingItemKey("Mehl", null));
    expect(shoppingItemKey("Mehl", "g")).not.toBe(shoppingItemKey("Zucker", "g"));
  });

  /**
   * Guards the separator choice: with a space, a name that happens to END in the
   * bucket text would collide with the same name measured in that kind.
   */
  test("a name containing the bucket text does not collide", () => {
    expect(shoppingItemKey("Tomaten kind:g", null)).not.toBe(shoppingItemKey("Tomaten", "g"));
  });
});

describe("addAmounts", () => {
  test("same unit sums", () => {
    expect(addAmounts({ quantity: 200, unit: "g" }, { quantity: 200, unit: "g" })).toEqual({
      quantity: 400,
      unit: "g",
    });
  });

  test("converts and picks the nicest unit", () => {
    expect(addAmounts({ quantity: 1, unit: "kg" }, { quantity: 200, unit: "g" })).toEqual({
      quantity: 1.2,
      unit: "kg",
    });
    expect(addAmounts({ quantity: 200, unit: "g" }, { quantity: 1, unit: "kg" })).toEqual({
      quantity: 1.2,
      unit: "kg",
    });
    expect(addAmounts({ quantity: 500, unit: "ml" }, { quantity: 750, unit: "ml" })).toEqual({
      quantity: 1.25,
      unit: "l",
    });
  });

  test("unitless amounts sum", () => {
    expect(addAmounts({ quantity: 3, unit: null }, { quantity: 2, unit: null })).toEqual({
      quantity: 5,
      unit: null,
    });
  });

  test("two unknown amounts stay unknown, never 0", () => {
    expect(addAmounts({ quantity: null, unit: null }, { quantity: null, unit: null })).toEqual({
      quantity: null,
      unit: null,
    });
  });

  test("refuses incompatible units instead of guessing", () => {
    expect(addAmounts({ quantity: 200, unit: "g" }, { quantity: 2, unit: "EL" })).toBeUndefined();
    expect(addAmounts({ quantity: 200, unit: "g" }, { quantity: 1, unit: null })).toBeUndefined();
  });
});

describe("mergeShoppingItems", () => {
  test("merges the same ingredient and keeps its position", () => {
    const merged = mergeShoppingItems(
      [draft("Mehl", 200, "g"), draft("Zucker", 100, "g")],
      [draft("mehl", 200, "g")],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ name: "Mehl", quantity: 400, unit: "g" });
    expect(merged[1]).toMatchObject({ name: "Zucker", quantity: 100 });
  });

  test("appends genuinely new lines in arrival order", () => {
    const merged = mergeShoppingItems([draft("Mehl", 200, "g")], [
      draft("Hefe", 1, "Pck."),
      draft("Salz", null, null),
    ]);
    expect(merged.map((item) => item.name)).toEqual(["Mehl", "Hefe", "Salz"]);
  });

  test("keeps incompatible units as separate lines", () => {
    const merged = mergeShoppingItems([draft("Öl", 200, "ml")], [draft("Öl", 2, "EL")]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ quantity: 200, unit: "ml" });
    expect(merged[1]).toMatchObject({ quantity: 2, unit: "EL" });
  });

  test("an amount-less line does not swallow a measured one", () => {
    const merged = mergeShoppingItems([draft("Mehl", 200, "g")], [draft("Mehl")]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.quantity).toBe(200);
    expect(merged[1]!.quantity).toBeNull();
  });

  test("unions provenance and notes", () => {
    const merged = mergeShoppingItems(
      [draft("Butter", 100, "g", "zimmerwarm", ["r1"])],
      [draft("Butter", 50, "g", "geschmolzen", ["r2"])],
    );
    expect(merged[0]).toMatchObject({ quantity: 150, unit: "g" });
    expect(merged[0]!.sourceRecipeIds).toEqual(["r1", "r2"]);
    expect(merged[0]!.note).toBe("zimmerwarm, geschmolzen");
  });

  test("does not mutate its inputs", () => {
    const existing = [draft("Mehl", 200, "g", null, ["r1"])];
    const additions = [draft("Mehl", 100, "g", null, ["r2"])];
    mergeShoppingItems(existing, additions);
    expect(existing[0]!.quantity).toBe(200);
    expect(existing[0]!.sourceRecipeIds).toEqual(["r1"]);
    expect(additions[0]!.sourceRecipeIds).toEqual(["r2"]);
  });
});

describe("mergeNotes", () => {
  test.each([
    [null, null, null],
    ["gesiebt", null, "gesiebt"],
    [null, "gesiebt", "gesiebt"],
    ["gesiebt", "gesiebt", "gesiebt"],
    ["gesiebt", "GESIEBT", "gesiebt"],
    ["ca.", "gehackt", "ca., gehackt"],
    ["ca., gehackt", "gehackt", "ca., gehackt"],
  ])("%s + %s -> %s", (a, b, expected) => {
    expect(mergeNotes(a, b)).toBe(expected);
  });
});

describe("ingredientToShoppingItem", () => {
  test("takes the UPPER bound of a range", () => {
    const item = ingredientToShoppingItem(parseIngredientLine("2-3 Eier"), "r1");
    expect(item).toMatchObject({ name: "Eier", quantity: 3 });
  });

  test("drops the section and the stale raw line", () => {
    const parsed = { ...parseIngredientLine("250 g Mehl"), section: "Für den Teig" };
    const item = ingredientToShoppingItem(parsed, "r1");
    expect(item).toEqual({
      name: "Mehl",
      quantity: 250,
      unit: "g",
      note: null,
      sourceRecipeIds: ["r1"],
    });
  });

  test("keeps a parsed note and records provenance", () => {
    const item = ingredientToShoppingItem(parseIngredientLine("1 Zwiebel, fein gehackt"), "r7");
    expect(item.name).toBe("Zwiebel");
    expect(item.note).toBe("fein gehackt");
    expect(item.sourceRecipeIds).toEqual(["r7"]);
  });

  /** Scaling produces amounts no author wrote; the list should read naturally. */
  test("re-expresses a scaled amount in its nicest unit", () => {
    const scaled = scaleIngredientsToServings([parseIngredientLine("500 ml Milch")], 2, 6);
    expect(ingredientToShoppingItem(scaled[0]!, "r1")).toMatchObject({
      quantity: 1.5,
      unit: "l",
    });
  });

  test("leaves unconvertible units as they are", () => {
    expect(ingredientToShoppingItem(parseIngredientLine("1 Prise Salz"), "r1")).toMatchObject({
      quantity: 1,
      unit: "Prise",
    });
    expect(ingredientToShoppingItem(parseIngredientLine("3 Dosen Tomaten"), "r1")).toMatchObject({
      quantity: 3,
      unit: "Dose",
    });
  });

  test("a hand-typed item has no provenance", () => {
    expect(ingredientToShoppingItem(parseIngredientLine("Klopapier"), null).sourceRecipeIds).toEqual(
      [],
    );
  });
});

describe("recipeToShoppingItems", () => {
  const lines = [
    "250 g Mehl",
    "1 Prise Salz",
    "2 EL Öl",
    "100 g Mehl",  // same ingredient twice in one recipe
    "1 Zwiebel",
  ];

  test("merges duplicates inside one recipe", () => {
    const items = recipeToShoppingItems(
      lines.map((line, index) => parseIngredientLine(line, index)),
      "r1",
    );
    const mehl = items.filter((item) => nameKey(item.name) === "mehl");
    expect(mehl).toHaveLength(1);
    expect(mehl[0]).toMatchObject({ quantity: 350, unit: "g" });
    expect(items).toHaveLength(4);
  });

  test("skips blank names", () => {
    const items = recipeToShoppingItems(
      [{ position: 0, name: "   ", raw: "   " }, parseIngredientLine("1 Ei", 1)],
      "r1",
    );
    expect(items.map((item) => item.name)).toEqual(["Ei"]);
  });

  /**
   * The scaling contract: the caller scales, this function only converts. Scaling
   * inside would apply the factor twice.
   */
  test("reflects the servings the caller scaled to", () => {
    const parsed = [parseIngredientLine("250 g Mehl", 0), parseIngredientLine("1 Prise Salz", 1)];
    const scaled = scaleIngredientsToServings(parsed, 2, 6, { keepNonScalingUnits: true });
    const items = recipeToShoppingItems(scaled, "r1");
    expect(items[0]).toMatchObject({ name: "Mehl", quantity: 750, unit: "g" });
    // A pinch stays a pinch.
    expect(items[1]).toMatchObject({ name: "Salz", quantity: 1, unit: "Prise" });
  });
});

describe("formatShoppingAmount", () => {
  test.each([
    [400, "g", "400 g"],
    [1.5, "kg", "1½ kg"],
    [3, null, "3"],
    [null, null, ""],
    [null, "g", "g"],
  ])("%s %s -> %s", (quantity, unit, expected) => {
    expect(formatShoppingAmount({ quantity, unit }, formatQuantity)).toBe(expected);
  });
});

describe("isVagueAmount", () => {
  test("flags amounts that say nothing to a shopper", () => {
    expect(isVagueAmount({ quantity: 1, unit: "Prise" })).toBe(true);
    expect(isVagueAmount({ quantity: 1, unit: "Msp." })).toBe(true);
    expect(isVagueAmount({ quantity: 200, unit: "g" })).toBe(false);
    expect(isVagueAmount({ quantity: 2, unit: null })).toBe(false);
  });
});

describe("shoppingProgressPercent", () => {
  test.each([
    [10, 4, 29], // the mock's "10 to buy · 4 bought today" -> 29%
    [0, 0, 0], // nothing on the list at all: 0, not NaN
    [0, 7, 100], // everything already bought
    [7, 0, 0], // nothing bought yet
  ])("(%i, %i) -> %i", (toBuy, bought, expected) => {
    expect(shoppingProgressPercent(toBuy, bought)).toBe(expected);
  });
});

interface CatalogFixture {
  name: string;
  useCount: number;
  lastUsedAt: string;
}

function entry(name: string, useCount: number, lastUsedAt: string): CatalogFixture {
  return { name, useCount, lastUsedAt };
}

describe("sortEntriesByFoldedName", () => {
  test("orders by folded name, not raw codepoint order", () => {
    const entries = [entry("Zwiebel", 1, "2026-01-01T00:00:00.000Z"), entry("Äpfel", 1, "2026-01-01T00:00:00.000Z"), entry("Brot", 1, "2026-01-01T00:00:00.000Z")];
    expect(sortEntriesByFoldedName(entries).map((e) => e.name)).toEqual(["Äpfel", "Brot", "Zwiebel"]);
  });
});

describe("selectMostBoughtEntries", () => {
  test("ranks by useCount then lastUsedAt, caps at the limit, and does not alphabetise", () => {
    const entries = [
      entry("Zwiebel", 5, "2026-01-01T00:00:00.000Z"),
      entry("Äpfel", 9, "2026-01-02T00:00:00.000Z"),
      entry("Brot", 9, "2026-01-03T00:00:00.000Z"), // same useCount as Äpfel, more recent
      entry("Milch", 1, "2026-01-04T00:00:00.000Z"),
    ];
    const selected = selectMostBoughtEntries(entries, 3);
    expect(selected.map((e) => e.name)).toEqual(["Brot", "Äpfel", "Zwiebel"]);
    expect(selected).toHaveLength(3);
  });

  test("defaults its limit to FREQUENT_CHIP_COUNT", () => {
    expect(FREQUENT_CHIP_COUNT).toBe(8);
    const entries = Array.from({ length: 12 }, (_, i) => entry(`Item ${i}`, 12 - i, "2026-01-01T00:00:00.000Z"));
    expect(selectMostBoughtEntries(entries)).toHaveLength(FREQUENT_CHIP_COUNT);
  });
});
