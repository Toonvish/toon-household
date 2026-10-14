import { describe, expect, test } from "bun:test";
import { emptyParsedRecipe, parseIngredientLine, type ParsedRecipe } from "@toon/shared";
import {
  addIngredient,
  addTag,
  appendIngredientFromLine,
  appendStepFromLine,
  canSplitIngredient,
  ingredientToStep,
  moveIngredient,
  moveItem,
  normalizeParsedRecipe,
  removeIngredient,
  renameIngredientSection,
  reparseAllIngredients,
  reparseIngredient,
  splitIngredient,
  splitIngredientLine,
  splitRawTextSections,
  splitStepText,
  stepToIngredient,
  updateIngredient,
  validateForCommit,
} from "./draftEdit";

function draftWithLines(lines: string[]): ParsedRecipe {
  return emptyParsedRecipe({
    title: "Testrezept",
    ingredients: lines.map((line, index) => parseIngredientLine(line, index)),
    confidence: { overall: 0.4 },
  });
}

describe("moveItem", () => {
  test("moves and clamps", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, 99)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 9, 0)).toEqual([1, 2, 3]);
  });
});

describe("splitIngredientLine", () => {
  test("splits an OCR-merged line at the next quantity", () => {
    expect(splitIngredientLine("250 g Mehl 100 g Zucker")).toEqual(["250 g Mehl", "100 g Zucker"]);
  });

  test("does not split a mixed fraction", () => {
    expect(splitIngredientLine("1 1/2 Tassen Mehl")).toEqual(["1 1/2 Tassen Mehl"]);
  });

  test("uses explicit separators first", () => {
    expect(splitIngredientLine("2 Eier; 1 Prise Salz")).toEqual(["2 Eier", "1 Prise Salz"]);
    expect(splitIngredientLine("Salz    Pfeffer")).toEqual(["Salz", "Pfeffer"]);
  });

  test("honours a manual split position", () => {
    expect(splitIngredientLine("Salz und Pfeffer", 4)).toEqual(["Salz", "und Pfeffer"]);
  });

  test("returns one element when nothing can be split", () => {
    expect(splitIngredientLine("1 Bund Petersilie")).toEqual(["1 Bund Petersilie"]);
    expect(canSplitIngredient(parseIngredientLine("1 Bund Petersilie"))).toBe(false);
  });
});

describe("ingredient rows", () => {
  test("splitIngredient replaces the row and reindexes", () => {
    const draft = draftWithLines(["250 g Mehl 100 g Zucker", "2 Eier"]);
    const next = splitIngredient(draft, 0);
    expect(next.ingredients.map((item) => item.name)).toEqual(["Mehl", "Zucker", "Eier"]);
    expect(next.ingredients.map((item) => item.position)).toEqual([0, 1, 2]);
    expect(next.ingredients[1]?.quantity).toBe(100);
  });

  test("reparseIngredient understands ranges", () => {
    const draft = draftWithLines(["Eier"]);
    const edited = updateIngredient(draft, 0, { raw: "2-3 Eier" });
    const next = reparseIngredient(edited, 0);
    expect(next.ingredients[0]?.quantity).toBe(2);
    expect(next.ingredients[0]?.quantityMax).toBe(3);
    expect(next.ingredients[0]?.name).toBe("Eier");
  });

  test("reparseIngredient keeps the section", () => {
    const draft = renameIngredientSection(draftWithLines(["100 g Butter"]), 0, "Für den Teig");
    const next = reparseIngredient(draft, 0, "150 g Butter, weich");
    expect(next.ingredients[0]?.section).toBe("Für den Teig");
    expect(next.ingredients[0]?.quantity).toBe(150);
    expect(next.ingredients[0]?.note).toContain("weich");
  });

  test("reparseAllIngredients re-parses every raw line", () => {
    const draft = draftWithLines(["Mehl", "Zucker"]);
    const edited = updateIngredient(updateIngredient(draft, 0, { raw: "250g Mehl" }), 1, { raw: "½ TL Zucker" });
    const next = reparseAllIngredients(edited);
    expect(next.ingredients[0]?.quantity).toBe(250);
    expect(next.ingredients[0]?.unit).toBe("g");
    expect(next.ingredients[1]?.quantity).toBe(0.5);
    expect(next.ingredients[1]?.unit).toBe("TL");
  });

  test("add / remove / move keep positions sequential", () => {
    let draft = draftWithLines(["1 Ei", "2 Äpfel", "3 Birnen"]);
    draft = addIngredient(draft, 0);
    expect(draft.ingredients.map((item) => item.position)).toEqual([0, 1, 2, 3]);
    draft = removeIngredient(draft, 1);
    expect(draft.ingredients.map((item) => item.position)).toEqual([0, 1, 2]);
    draft = moveIngredient(draft, 0, 2);
    expect(draft.ingredients.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  test("renameIngredientSection only touches the consecutive run", () => {
    let draft = draftWithLines(["100 g Mehl", "2 Eier", "1 Prise Salz"]);
    draft = updateIngredient(draft, 2, { section: "Für die Glasur" });
    draft = renameIngredientSection(draft, 0, "Für den Teig");
    expect(draft.ingredients.map((item) => item.section)).toEqual([
      "Für den Teig",
      "Für den Teig",
      "Für die Glasur",
    ]);
  });
});

describe("moving rows between lists", () => {
  test("ingredientToStep and back", () => {
    const draft = draftWithLines(["250 g Mehl", "Alles gut verrühren"]);
    const withStep = ingredientToStep(draft, 1);
    expect(withStep.ingredients).toHaveLength(1);
    expect(withStep.steps[0]?.text).toBe("Alles gut verrühren");

    const back = stepToIngredient(withStep, 0);
    expect(back.steps).toHaveLength(0);
    expect(back.ingredients[1]?.name).toContain("verrühren");
    expect(back.ingredients.map((item) => item.position)).toEqual([0, 1]);
  });

  test("raw lines can be appended to either list", () => {
    let draft = emptyParsedRecipe();
    draft = appendIngredientFromLine(draft, "  2 EL Olivenöl  ");
    draft = appendStepFromLine(draft, "Zwiebeln anbraten.");
    expect(draft.ingredients[0]?.quantity).toBe(2);
    expect(draft.ingredients[0]?.unit).toBe("EL");
    expect(draft.steps[0]?.text).toBe("Zwiebeln anbraten.");
    expect(appendIngredientFromLine(draft, "   ")).toBe(draft);
  });
});

describe("splitStepText", () => {
  test("splits on numbering and blank lines", () => {
    expect(splitStepText("1. Teig kneten\n2. Backen")).toEqual(["Teig kneten", "Backen"]);
    expect(splitStepText("Teig kneten\n\nBacken")).toEqual(["Teig kneten", "Backen"]);
  });

  test("falls back to sentences and keeps single steps intact", () => {
    expect(splitStepText("Teig kneten. Dann backen.")).toEqual(["Teig kneten.", "Dann backen."]);
    expect(splitStepText("Nur ein Schritt")).toEqual(["Nur ein Schritt"]);
  });
});

describe("splitRawTextSections", () => {
  test("uses the German headings", () => {
    const sections = splitRawTextSections(
      ["Apfelkuchen", "", "Zutaten", "250 g Mehl", "2 Eier", "", "Zubereitung", "1. Teig kneten", "2. Backen"].join("\n"),
    );
    expect(sections.title).toBe("Apfelkuchen");
    expect(sections.ingredientsText).toContain("250 g Mehl");
    expect(sections.stepsText).toContain("Teig kneten");
    expect(sections.ingredientsText).not.toContain("Teig kneten");
  });

  test("without headings everything becomes ingredient candidates", () => {
    const sections = splitRawTextSections("Pfannkuchen\n2 Eier\n300 ml Milch");
    expect(sections.title).toBe("Pfannkuchen");
    expect(sections.ingredientsText).toContain("2 Eier");
  });
});

describe("normalizeParsedRecipe", () => {
  test("drops empty rows, reindexes and repairs the payload", () => {
    const messy: ParsedRecipe = emptyParsedRecipe({
      title: "  Kuchen  ",
      description: "   ",
      servings: { amount: 0, unit: "  " },
      prepMinutes: 12.7,
      cookMinutes: -5,
      difficulty: "unbekannt" as never,
      tags: ["Süß", "süss", "süß", "  "],
      ingredients: [
        { position: 7, name: "  Mehl ", quantity: 250, unit: " g ", raw: " 250 g Mehl ", note: "  " },
        { position: 9, name: "   ", quantity: 1, unit: "EL", raw: "  " },
        { position: 3, name: "Eier", quantity: 3, quantityMax: 2, raw: "3 Eier" },
      ],
      steps: [
        { position: 4, text: "  Verrühren  " },
        { position: 5, text: "   " },
      ],
      confidence: { overall: 5, ingredients: -1 },
    });

    const normalized = normalizeParsedRecipe(messy);
    expect(normalized.title).toBe("Kuchen");
    expect(normalized.description).toBeUndefined();
    expect(normalized.servings).toBeUndefined();
    expect(normalized.prepMinutes).toBe(13);
    expect(normalized.cookMinutes).toBeUndefined();
    expect(normalized.difficulty).toBeUndefined();
    // All three collapse: foldText folds ß->ss and ü->u, so "Süß", "süss" and "süß"
    // are ONE tag — the same identity the server's getOrCreateTagIds computes. This
    // used to keep "süss" as a second tag, which the server then merged away on commit.
    expect(normalized.tags).toEqual(["Süß"]);
    expect(normalized.ingredients).toHaveLength(2);
    expect(normalized.ingredients.map((item) => item.position)).toEqual([0, 1]);
    expect(normalized.ingredients[0]?.name).toBe("Mehl");
    expect(normalized.ingredients[0]?.unit).toBe("g");
    expect(normalized.ingredients[0]?.note).toBeUndefined();
    // quantityMax <= quantity is meaningless and gets dropped
    expect(normalized.ingredients[1]?.quantityMax).toBeUndefined();
    expect(normalized.steps).toHaveLength(1);
    expect(normalized.steps[0]?.position).toBe(0);
    expect(normalized.confidence.overall).toBe(1);
    expect(normalized.confidence.ingredients).toBe(0);
    expect(normalized.language).toBe("de");
  });

  test("is idempotent", () => {
    const draft = draftWithLines(["250 g Mehl", "2-3 Eier"]);
    const once = normalizeParsedRecipe(draft);
    expect(normalizeParsedRecipe(once)).toEqual(once);
  });

  test("keeps a row whose name is empty but whose raw text survives", () => {
    const draft = emptyParsedRecipe({
      ingredients: [{ position: 0, name: "", raw: "etwas Öl zum Braten" }],
    });
    const normalized = normalizeParsedRecipe(draft);
    expect(normalized.ingredients[0]?.name).toBe("etwas Öl zum Braten");
  });
});

describe("tags and validation", () => {
  test("addTag dedupes case-insensitively", () => {
    let draft = emptyParsedRecipe();
    draft = addTag(draft, "Vegan");
    draft = addTag(draft, "vegan");
    draft = addTag(draft, "   ");
    expect(draft.tags).toEqual(["Vegan"]);
  });

  // The server keys tags by foldText(), so "Kase" IS "Käse" there. Deduping on
  // toLowerCase() here let both into the draft and had the server merge them on
  // commit — two chips in the review pane, one tag in the household.
  test("addTag dedupes with the server's umlaut folding, not toLowerCase", () => {
    let draft = emptyParsedRecipe();
    draft = addTag(draft, "Käse");
    draft = addTag(draft, "Kase");
    draft = addTag(draft, "KÄSE");
    expect(draft.tags).toEqual(["Käse"]);

    draft = addTag(draft, "Grieß");
    draft = addTag(draft, "griess");
    expect(draft.tags).toEqual(["Käse", "Grieß"]);
  });

  test("only a missing title blocks saving", () => {
    const withoutTitle = validateForCommit(emptyParsedRecipe());
    expect(withoutTitle.ok).toBe(false);
    expect(withoutTitle.problems).toHaveLength(1);

    const withTitle = validateForCommit(emptyParsedRecipe({ title: "Suppe" }));
    expect(withTitle.ok).toBe(true);
    expect(withTitle.warnings.length).toBeGreaterThan(0);
  });
});
