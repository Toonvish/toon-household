/**
 * Last-resort adapter for pages with no structured data and no known plugin.
 *
 * Strategy: find the "Zutaten" heading and read the list under it, find the
 * "Zubereitung" heading and read the text under it. If there is no ingredient
 * heading, fall back to the list in the document whose items look most like
 * ingredients (highest share of lines that parse with a quantity AND a unit) —
 * which is a surprisingly strong signal on hand-written blog markup.
 */
import { parseIngredientLine } from "@toon/shared";
import { cleanText } from "../../html/entities.ts";
import { type ElementNode, queryAll, queryOne, textOf, walkElements } from "../../html/parse.ts";
import { type ParsedFields, buildIngredients, buildSteps } from "../../parsed.ts";
import { readDifficulty, readLabelledTimes, readServings } from "../../times.ts";
import { itemsOfList, listAfterHeading, textAfterHeading } from "../sections.ts";
import type { AdapterContext, SiteAdapter } from "./types.ts";

const INGREDIENT_HEADING_RE = /^\s*(zutaten|ingredients|einkaufsliste|du brauchst|was du brauchst)\b/i;
const STEP_HEADING_RE = /^\s*(zubereitung|anleitung|zubereitungsschritte|und so geht'?s|so geht'?s|arbeitsschritte|instructions|preparation|schritt f(?:ü|u)r schritt)\b/i;
const NOTES_HEADING_RE = /^\s*(tipps?|hinweise?|anmerkungen?|notizen|variationen?|gut zu wissen)\b/i;

/** Fraction of lines that parse into a quantity + unit — the "is a shopping list" score. */
function ingredientScore(lines: readonly string[]): number {
  if (lines.length < 2) return 0;
  let hits = 0;
  for (const line of lines) {
    if (line.length > 160) continue;
    const parsed = parseIngredientLine(line);
    if (typeof parsed.quantity === "number" && typeof parsed.unit === "string") hits += 1.2;
    else if (typeof parsed.quantity === "number") hits += 0.8;
  }
  return hits / lines.length;
}

/** The `<ul>`/`<ol>` in the document that reads most like an ingredient list. */
function bestIngredientList(doc: ElementNode): string[] {
  let best: string[] = [];
  let bestScore = 0;
  walkElements(doc, (element) => {
    if (element.tag !== "ul" && element.tag !== "ol") return;
    // Ignore nav/footer/menu lists.
    if (element.classList.some((className) => /(nav|menu|breadcrumb|social|share|widget|pagination)/i.test(className))) {
      return;
    }
    const items = itemsOfList(element);
    if (items.length < 3 || items.length > 120) return;
    const score = ingredientScore(items);
    if (score > bestScore) {
      bestScore = score;
      best = items;
    }
  });
  return bestScore >= 0.5 ? best : [];
}

export const genericAdapter: SiteAdapter = {
  id: "generic",
  siteName: "",
  hosts: [],

  extract(doc: ElementNode, context: AdapterContext): ParsedFields {
    const fields: ParsedFields = { sourceUrl: context.url };

    const h1 = cleanText(textOf(queryOne(doc, "h1, .entry-title, .post-title")));
    if (h1.length > 0) fields.title = h1;

    const headingList = listAfterHeading(doc, INGREDIENT_HEADING_RE);
    const ingredientLines = headingList.length > 0 ? headingList : bestIngredientList(doc);
    if (ingredientLines.length > 0) {
      const ingredients = buildIngredients(ingredientLines);
      if (ingredients.length > 0) fields.ingredients = ingredients;
    }

    const stepsText = textAfterHeading(doc, STEP_HEADING_RE);
    if (stepsText.length > 0) {
      const steps = buildSteps(
        stepsText
          .split(/\n+/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => ({ text: line })),
      );
      if (steps.length > 0) fields.steps = steps;
    }

    const notesText = textAfterHeading(doc, NOTES_HEADING_RE);
    if (notesText.length > 0) fields.notes = cleanText(notesText).slice(0, 10000);

    // Times / servings / difficulty from the visible "meta" line of the page.
    const metaText = cleanText(
      [
        textOf(queryOne(doc, ".recipe-meta, .recipe-details, .entry-meta, .recipe-info")),
        ...queryAll(doc, "h1, h2, h3")
          .slice(0, 8)
          .map((element) => textOf(element.parent ?? element))
          .slice(0, 3),
      ].join(" | "),
    ).slice(0, 4000);
    const { labelled: _labelled, restMinutes: _restMinutes, ...times } = readLabelledTimes(metaText);
    Object.assign(fields, times);
    const { servings } = readServings(metaText);
    if (servings) fields.servings = servings;
    const difficulty = readDifficulty(metaText);
    if (difficulty) fields.difficulty = difficulty;

    return fields;
  },
};
