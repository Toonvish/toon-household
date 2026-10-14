/**
 * chefkoch.de adapter.
 *
 * Chefkoch DOES ship JSON-LD, so this adapter is mostly a gap-filler — but the
 * gaps matter: the JSON-LD `recipeIngredient` array loses the "Für den Teig"
 * group headings that the HTML table encodes as `<th><h3>`, and the difficulty
 * ("simpel"/"normal"/"pfiffig") plus "Arbeitszeit ca. 20 Minuten" only exist in
 * the markup. It also has to stand alone when chefkoch A/B-tests its JSON-LD.
 *
 * Markup relied on (all of it optional, each lookup has a fallback):
 *   h1                                     -> title
 *   table.ingredients tr                   -> ingredients, th/h3 = section
 *   .recipe-servings / input#yield          -> servings
 *   .recipe-preptime / .recipe-difficulty   -> times / difficulty
 *   h2 "Zubereitung" + following text       -> steps
 */
import { parseServings } from "@toon/shared";
import { cleanText } from "../../html/entities.ts";
import { type ElementNode, attr, queryAll, queryOne, textOf } from "../../html/parse.ts";
import {
  type ParsedFields,
  buildIngredients,
  buildSteps,
  dedupeTags,
  normalizeDifficulty,
  normalizeSection,
} from "../../parsed.ts";
import { readLabelledTimes } from "../../times.ts";
import { absoluteUrl } from "../schema-map.ts";
import { textAfterHeading } from "../sections.ts";
import type { AdapterContext, SiteAdapter } from "./types.ts";

const STEP_HEADING_RE = /^\s*(zubereitung|und so geht'?s)\b/i;

/** Chefkoch's own difficulty vocabulary. */
function chefkochDifficulty(text: string): ParsedFields["difficulty"] {
  const value = cleanText(text).toLowerCase();
  if (value.includes("simpel")) return "einfach";
  if (value.includes("pfiffig")) return "schwer";
  if (value.includes("normal")) return "mittel";
  return normalizeDifficulty(value);
}

/**
 * Ingredients from the classic two-column table. A row whose only cell is a
 * `<th>`/`<h3>` is a group heading and becomes the `section` of the rows below.
 */
function ingredientsFromTable(doc: ElementNode): ParsedFields["ingredients"] {
  const tables = queryAll(doc, "table.ingredients, table.incredients, .ingredients table");
  let section: string | undefined;
  const sectioned: Array<{ line: string; section?: string }> = [];

  for (const table of tables) {
    for (const row of queryAll(table, "tr")) {
      const headerCells = queryAll(row, "th");
      const cells = queryAll(row, "td");
      if (cells.length === 0) {
        const headingText = cleanText(headerCells.map(textOf).join(" "));
        if (headingText.length > 0) section = normalizeSection(headingText) || undefined;
        continue;
      }
      const amount = cleanText(textOf(cells[0]));
      const name = cleanText(cells.slice(1).map(textOf).join(" "));
      const line = `${amount} ${name}`.trim();
      if (line.length === 0) continue;
      sectioned.push(section === undefined ? { line } : { line, section });
    }
  }
  if (sectioned.length === 0) return undefined;

  // Build per section run so headings survive.
  const out: NonNullable<ParsedFields["ingredients"]> = [];
  for (const entry of sectioned) {
    const [parsed] = buildIngredients([entry.line], { initialSection: entry.section });
    if (!parsed) continue;
    out.push({ ...parsed, position: out.length });
  }
  return out.length > 0 ? out : undefined;
}

function readServings(doc: ElementNode): ParsedFields["servings"] {
  const input = queryOne(doc, "input#yield, input[name=\"portionen\"], .recipe-servings input");
  const inputValue = attr(input, "value");
  const container = queryOne(doc, ".recipe-servings, .rds-recipe-meta__servings");
  const containerText = cleanText(textOf(container));

  if (inputValue !== undefined) {
    const unitMatch = /(portionen?|personen|st(?:ü|u)ck|gl(?:ä|a)ser|muffins?)/i.exec(containerText);
    const servings = parseServings(`${inputValue} ${unitMatch?.[1] ?? "Portionen"}`);
    if (servings) return servings;
  }
  if (containerText.length > 0) {
    const servings = parseServings(containerText);
    if (servings) return servings;
  }
  const heading = cleanText(textOf(queryOne(doc, ".ingredients-headline, .recipe-ingredients h2")));
  return heading.length > 0 ? parseServings(heading) : undefined;
}

export const chefkochAdapter: SiteAdapter = {
  id: "chefkoch",
  siteName: "Chefkoch",
  hosts: ["chefkoch.de"],

  extract(doc: ElementNode, context: AdapterContext): ParsedFields {
    const fields: ParsedFields = { sourceUrl: context.url, sourceName: "Chefkoch", language: "de" };

    const title = cleanText(textOf(queryOne(doc, "h1")));
    if (title.length > 0) fields.title = title;

    const ingredients = ingredientsFromTable(doc);
    if (ingredients && ingredients.length > 0) fields.ingredients = ingredients;

    const stepsText = textAfterHeading(doc, STEP_HEADING_RE);
    const stepsBlock =
      stepsText.length > 0 ? stepsText : cleanText(textOf(queryOne(doc, ".recipe-preparation, .ds-copy")));
    if (stepsBlock.length > 0) {
      const rawSteps = stepsBlock
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !/^(zutaten|zubereitung|n(?:ä|a)hrwerte)/i.test(line))
        .map((line) => ({ text: line }));
      const steps = buildSteps(rawSteps);
      if (steps.length > 0) fields.steps = steps;
    }

    const servings = readServings(doc);
    if (servings) fields.servings = servings;

    const metaText = [
      textOf(queryOne(doc, ".rds-recipe-meta")),
      textOf(queryOne(doc, ".recipe-meta")),
      textOf(queryOne(doc, ".recipe-preptime")),
      textOf(queryOne(doc, ".recipe-cookingtime")),
    ]
      .map(cleanText)
      .filter((text) => text.length > 0)
      .join(" | ");
    const { labelled: _labelled, restMinutes, ...times } = readLabelledTimes(metaText);
    Object.assign(fields, times);
    if (restMinutes !== undefined) fields.notes = `Ruhezeit: ca. ${restMinutes} Minuten`;

    const difficultyText = cleanText(textOf(queryOne(doc, ".recipe-difficulty, .rds-recipe-meta__difficulty")));
    const difficulty = chefkochDifficulty(difficultyText.length > 0 ? difficultyText : metaText);
    if (difficulty) fields.difficulty = difficulty;

    const image =
      attr(queryOne(doc, ".recipe-image img, .i-amphtml-fill-content, figure img, amp-img"), "src") ??
      attr(queryOne(doc, ".recipe-image img"), "data-src") ??
      attr(queryOne(doc, ".recipe-image source"), "srcset")?.split(/\s+/)[0];
    if (image !== undefined) fields.imageUrl = absoluteUrl(image, context.url);

    const tags = dedupeTags(
      queryAll(doc, ".recipe-tags a, .ds-tag, .recipe-category a")
        .map(textOf)
        .map(cleanText)
        .filter((tag) => tag.length > 1),
    );
    if (tags.length > 0) fields.tags = tags;

    return fields;
  },
};
