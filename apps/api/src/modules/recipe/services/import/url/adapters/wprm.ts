/**
 * WP Recipe Maker adapter — this is the plugin biancazapatka.com/de/ uses, and
 * it powers a large share of German food blogs, so it doubles as a generic
 * adapter: `appliesTo()` matches ANY page carrying `.wprm-recipe-container`,
 * not just the registered hostname.
 *
 * WPRM emits JSON-LD too, but the markup is strictly richer:
 *   - ingredient GROUPS (`.wprm-recipe-ingredient-group-name`) — flattened away
 *     in JSON-LD,
 *   - amount/unit/name/notes as separate spans, so no line parsing guesswork,
 *   - instruction groups, and `.wprm-recipe-notes` (the blogger's tips).
 *
 * Two markup generations are handled for times/servings: a single
 * `.wprm-recipe-prep_time` span ("20 Minuten") and the split
 * `-hours` / `-minutes` spans with separate `-unit` spans ("1 Std 30 Min").
 */
import { parseDuration, parseServings, type RecipeIngredient } from "@toon/shared";
import { cleanText } from "../../html/entities.ts";
import { type ElementNode, attr, queryAll, queryOne, textOf } from "../../html/parse.ts";
import {
  type ParsedFields,
  type RawStep,
  buildIngredients,
  buildSteps,
  dedupeTags,
  normalizeSection,
} from "../../parsed.ts";
import { absoluteUrl } from "../schema-map.ts";
import type { AdapterContext, SiteAdapter } from "./types.ts";

/**
 * Matches for `selector`, dropping elements that are nested inside another
 * match — otherwise `<span class="x">20 <span class="x-unit">Min</span></span>`
 * would contribute "Min" twice.
 */
function outermost(doc: ElementNode, selector: string): ElementNode[] {
  const matches = queryAll(doc, selector);
  const set = new Set(matches);
  return matches.filter((element) => {
    let ancestor = element.parent;
    while (ancestor !== null) {
      if (set.has(ancestor)) return false;
      ancestor = ancestor.parent;
    }
    return true;
  });
}

/** Joined text of every `wprm-recipe-<field>` span, labels excluded. */
function wprmFieldText(doc: ElementNode, field: string): string {
  const elements = outermost(doc, `[class*="wprm-recipe-${field}"]`).filter(
    (element) => !element.classList.some((className) => className.endsWith("-label")),
  );
  return cleanText(elements.map(textOf).join(" "));
}

function readTime(doc: ElementNode, field: "prep_time" | "cook_time" | "total_time"): number | undefined {
  const text = wprmFieldText(doc, field);
  if (text.length === 0) return undefined;
  const minutes = parseDuration(text);
  return minutes !== undefined && minutes > 0 ? minutes : undefined;
}

/** One ingredient per `<li class="wprm-recipe-ingredient">`, groups honoured. */
function readIngredients(container: ElementNode): RecipeIngredient[] {
  const out: RecipeIngredient[] = [];
  const groups = queryAll(container, ".wprm-recipe-ingredient-group");
  const scopes: Array<{ scope: ElementNode; section?: string }> =
    groups.length > 0
      ? groups.map((group) => {
          const name = cleanText(textOf(queryOne(group, ".wprm-recipe-ingredient-group-name, .wprm-recipe-group-name")));
          return name.length > 0 ? { scope: group, section: normalizeSection(name) } : { scope: group };
        })
      : [{ scope: container }];

  for (const { scope, section } of scopes) {
    for (const item of queryAll(scope, ".wprm-recipe-ingredient")) {
      const amount = cleanText(textOf(queryOne(item, ".wprm-recipe-ingredient-amount")));
      const unit = cleanText(textOf(queryOne(item, ".wprm-recipe-ingredient-unit")));
      const name = cleanText(textOf(queryOne(item, ".wprm-recipe-ingredient-name")));
      const notes = cleanText(textOf(queryOne(item, ".wprm-recipe-ingredient-notes")));

      // Structured spans present: assemble a canonical line for the parser so
      // unit aliases ("Tasse", "EL") are normalised exactly once, centrally.
      const line =
        name.length > 0
          ? [amount, unit, name, notes.length > 0 ? `(${notes})` : ""].filter((part) => part.length > 0).join(" ")
          : cleanText(textOf(item));
      if (line.trim().length === 0) continue;

      const [parsed] = buildIngredients([line], section === undefined ? {} : { initialSection: section });
      if (!parsed) continue;
      out.push({ ...parsed, position: out.length });
    }
  }
  return out;
}

function readSteps(container: ElementNode): RawStep[] {
  const out: RawStep[] = [];
  const groups = queryAll(container, ".wprm-recipe-instruction-group");
  const scopes: Array<{ scope: ElementNode; section?: string }> =
    groups.length > 0
      ? groups.map((group) => {
          const name = cleanText(
            textOf(queryOne(group, ".wprm-recipe-instruction-group-name, .wprm-recipe-group-name")),
          );
          return name.length > 0 ? { scope: group, section: normalizeSection(name) } : { scope: group };
        })
      : [{ scope: container }];

  for (const { scope, section } of scopes) {
    for (const item of queryAll(scope, ".wprm-recipe-instruction")) {
      const textElement = queryOne(item, ".wprm-recipe-instruction-text");
      const text = cleanText(textOf(textElement ?? item));
      if (text.length === 0) continue;
      out.push({ text, section: section ?? null });
    }
  }
  return out;
}

/** The recipe card element, or the document when the card class is absent. */
function recipeContainer(doc: ElementNode): ElementNode {
  return queryOne(doc, ".wprm-recipe-container, .wprm-recipe") ?? doc;
}

export const wprmAdapter: SiteAdapter = {
  id: "wprm",
  // Deliberately empty: WPRM is a PLUGIN, not a site. og:site_name / the
  // hostname provide the real sourceName.
  siteName: "",
  hosts: ["biancazapatka.com"],

  appliesTo(doc: ElementNode): boolean {
    return queryOne(doc, ".wprm-recipe-container, .wprm-recipe-ingredient, .wprm-recipe-instruction") !== null;
  },

  extract(doc: ElementNode, context: AdapterContext): ParsedFields {
    const card = recipeContainer(doc);
    const fields: ParsedFields = { sourceUrl: context.url };

    const title =
      cleanText(textOf(queryOne(card, ".wprm-recipe-name"))) || cleanText(textOf(queryOne(doc, "h1.entry-title, h1")));
    if (title.length > 0) fields.title = title;

    const summary = cleanText(textOf(queryOne(card, ".wprm-recipe-summary")));
    if (summary.length > 0) fields.description = summary;

    const ingredients = readIngredients(card);
    if (ingredients.length > 0) fields.ingredients = ingredients;

    const steps = buildSteps(readSteps(card));
    if (steps.length > 0) fields.steps = steps;

    const servingsText = wprmFieldText(card, "servings");
    if (servingsText.length > 0) {
      const servings = parseServings(servingsText);
      if (servings) fields.servings = servings;
    }

    const prepMinutes = readTime(card, "prep_time");
    if (prepMinutes !== undefined) fields.prepMinutes = prepMinutes;
    const cookMinutes = readTime(card, "cook_time");
    if (cookMinutes !== undefined) fields.cookMinutes = cookMinutes;
    const totalMinutes = readTime(card, "total_time");
    if (totalMinutes !== undefined) fields.totalMinutes = totalMinutes;

    const image =
      attr(queryOne(card, ".wprm-recipe-image img"), "src") ??
      attr(queryOne(card, ".wprm-recipe-image img"), "data-src") ??
      attr(queryOne(card, ".wprm-recipe-image source"), "srcset")?.split(/[\s,]+/)[0];
    if (image !== undefined) fields.imageUrl = absoluteUrl(image, context.url);

    const notes = cleanText(textOf(queryOne(card, ".wprm-recipe-notes, .wprm-recipe-notes-container")));
    if (notes.length > 0) fields.notes = notes;

    const tags = dedupeTags([
      ...queryAll(card, ".wprm-recipe-course, .wprm-recipe-cuisine, .wprm-recipe-keyword")
        .map(textOf)
        .map(cleanText),
      ...queryAll(doc, ".post-categories a, .entry-categories a, .tags-links a")
        .map(textOf)
        .map(cleanText),
    ]);
    if (tags.length > 0) fields.tags = tags;

    return fields;
  },
};
