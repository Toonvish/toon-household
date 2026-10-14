/**
 * Maps a schema.org `Recipe` node (from JSON-LD *or* microdata — both produce
 * the same loose object shape) onto `ParsedFields`.
 *
 * The whole point of this module is defensive shape handling. Every one of these
 * appears in the wild for a single property:
 *   image:               "u" | ["u1","u2"] | {url:"u"} | [{url:"u"}] | {"@list":[…]}
 *   recipeInstructions:  "text" | ["a","b"] | [HowToStep] | [HowToSection[HowToStep]]
 *                        | "<ol><li>…</li></ol>" | [{"@type":"HowToStep","itemListElement":…}]
 *   recipeYield:         "4 Portionen" | 4 | ["4","4 servings"]
 *   author:              "Name" | {name:"Name"} | [{name:"Name"}]
 *   keywords:            "a, b" | ["a","b"]
 *   prepTime:            "PT30M" | "30 Minuten" | 30
 */
import { type ParsedRecipeConfidence, parseDuration, parseServings } from "@toon/shared";
import { cleanMultilineText, cleanText } from "../html/entities.ts";
import {
  type ParsedFields,
  type RawStep,
  buildIngredients,
  buildSteps,
  computeOverallConfidence,
  dedupeTags,
  normalizeDifficulty,
} from "../parsed.ts";
import { hasType, isNodeReference, type JsonLdNode } from "./jsonld.ts";

/* ------------------------------ value readers ----------------------------- */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unwraps `{"@list":[…]}` / `{"@set":[…]}` and single-element arrays. */
function unwrap(value: unknown): unknown {
  if (isObject(value)) {
    if (Array.isArray(value["@list"])) return value["@list"];
    if (Array.isArray(value["@set"])) return value["@set"];
  }
  return value;
}

function toArray(value: unknown): unknown[] {
  const unwrapped = unwrap(value);
  if (unwrapped === undefined || unwrapped === null) return [];
  return Array.isArray(unwrapped) ? unwrapped : [unwrapped];
}

/**
 * Reads a scalar out of any JSON-LD value: plain string, number, `{"@value":…}`,
 * `{name:…}`, `{text:…}`, `{url:…}`, or the first usable entry of an array.
 */
export function scalar(value: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  const unwrapped = unwrap(value);
  if (typeof unwrapped === "string") {
    const text = unwrapped.trim();
    return text.length > 0 ? text : undefined;
  }
  if (typeof unwrapped === "number" && Number.isFinite(unwrapped)) return String(unwrapped);
  if (typeof unwrapped === "boolean") return undefined;
  if (Array.isArray(unwrapped)) {
    for (const entry of unwrapped) {
      const found = scalar(entry, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (isObject(unwrapped)) {
    // A bare `{"@id": …}` holds no text at all — its id is a @graph pointer, and
    // returning it would put a URL where a name belongs (`sourceName`, author).
    // `resolveNodeReferences` inlines the ones that CAN be resolved; this is the
    // fallback for a reference whose target the page never defines.
    if (isNodeReference(unwrapped)) return undefined;
    for (const key of ["@value", "text", "name", "url", "contentUrl", "@id", "description", "headline"]) {
      const found = scalar(unwrapped[key], depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** First usable value among several property aliases. */
function pick(node: JsonLdNode, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = node[key];
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) return value;
  }
  return undefined;
}

/* --------------------------------- images --------------------------------- */

/** Every image URL a node offers, best (usually largest/first) first. */
export function imageUrls(value: unknown): string[] {
  const out: string[] = [];
  const push = (candidate: unknown): void => {
    const text = scalar(candidate);
    if (text === undefined) return;
    const trimmed = text.trim();
    if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("data:image/")) {
      out.push(trimmed);
    }
  };
  for (const entry of toArray(value)) {
    if (isObject(entry)) {
      // `{"@id": …}` alone is a @graph reference, never a URL: taking it would make
      // the recipe PAGE the hero image. Skipping it lets `og:image` fill the gap.
      if (isNodeReference(entry)) continue;
      push(entry.contentUrl ?? entry.url ?? entry["@id"]);
      // ImageObject.thumbnail is a last resort
      if (out.length === 0) push(entry.thumbnailUrl);
      continue;
    }
    push(entry);
  }
  return [...new Set(out)];
}

/* ------------------------------ instructions ------------------------------ */

const MAX_INSTRUCTION_DEPTH = 6;

/**
 * Flattens `recipeInstructions` into ordered `{ text, section }` steps,
 * handling strings, arrays, HowToStep, HowToSection and HTML blobs.
 */
export function flattenInstructions(value: unknown, section?: string, depth = 0): RawStep[] {
  if (depth > MAX_INSTRUCTION_DEPTH) return [];
  const unwrapped = unwrap(value);
  if (unwrapped === undefined || unwrapped === null) return [];

  if (typeof unwrapped === "string" || typeof unwrapped === "number") {
    return splitInstructionText(String(unwrapped), section);
  }

  if (Array.isArray(unwrapped)) {
    return unwrapped.flatMap((entry) => flattenInstructions(entry, section, depth + 1));
  }

  if (!isObject(unwrapped)) return [];

  // HowToSection: its name becomes the section of the nested steps.
  if (hasType(unwrapped, "howtosection") || unwrapped.itemListElement !== undefined) {
    const nestedSection = cleanText(scalar(unwrapped.name) ?? "") || section;
    const nested = flattenInstructions(unwrapped.itemListElement, nestedSection, depth + 1);
    if (nested.length > 0) return nested;
  }

  // HowToStep / HowToTip / HowToDirection
  const text = scalar(unwrapped.text) ?? scalar(unwrapped.description) ?? scalar(unwrapped.name);
  if (text !== undefined) return splitInstructionText(text, section);

  return [];
}

/**
 * A single instruction value is often the WHOLE preparation as one blob, either
 * as HTML (`<ol><li>`) or with embedded newlines/numbering. Split it up.
 */
function splitInstructionText(input: string, section?: string): RawStep[] {
  const multiline = cleanMultilineText(input);
  if (multiline.length === 0) return [];

  const lines = multiline
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length > 1) return lines.map((line) => ({ text: line, section: section ?? null }));

  const single = lines[0]!;
  // "1. … 2. … 3. …" packed into one line.
  const numbered = single.split(/(?<=[.!?)])\s+(?=\d{1,2}\s*[.)]\s+\p{Lu})/u);
  if (numbered.length > 1) return numbered.map((part) => ({ text: part.trim(), section: section ?? null }));

  return [{ text: single, section: section ?? null }];
}

/* -------------------------------- yield/time ------------------------------ */

/**
 * `recipeYield` is often an array like `["12", "12 Stück"]`. Prefer the entry
 * that carries a real unit over the bare number (which parses to "Portionen").
 */
function readServings(value: unknown): ReturnType<typeof parseServings> {
  let fallback: ReturnType<typeof parseServings>;
  for (const entry of toArray(value)) {
    const text = scalar(entry);
    if (text === undefined) continue;
    const servings = parseServings(cleanText(text));
    if (!servings) continue;
    if (servings.unit !== "Portionen") return servings;
    fallback ??= servings;
  }
  return fallback;
}

function readMinutes(value: unknown): number | undefined {
  for (const entry of toArray(value)) {
    if (typeof entry === "number" && Number.isFinite(entry) && entry >= 0) return Math.round(entry);
    const text = scalar(entry);
    if (text === undefined) continue;
    const minutes = parseDuration(cleanText(text));
    if (minutes !== undefined && minutes > 0) return minutes;
  }
  return undefined;
}

/* -------------------------------- nutrition ------------------------------- */

const NUTRITION_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["calories", "Kalorien"],
  ["servingSize", "Portionsgröße"],
  ["proteinContent", "Protein"],
  ["fatContent", "Fett"],
  ["saturatedFatContent", "davon gesättigt"],
  ["carbohydrateContent", "Kohlenhydrate"],
  ["sugarContent", "Zucker"],
  ["fiberContent", "Ballaststoffe"],
  ["sodiumContent", "Natrium"],
  ["cholesterolContent", "Cholesterin"],
];

/** Renders a `NutritionInformation` node as a short German note block. */
export function formatNutrition(value: unknown): string | undefined {
  const node = toArray(value).find(isObject);
  if (!node) return undefined;
  const parts: string[] = [];
  for (const [key, label] of NUTRITION_LABELS) {
    const text = scalar(node[key]);
    if (text === undefined) continue;
    parts.push(`${label}: ${cleanText(text)}`);
  }
  if (parts.length === 0) return undefined;
  return `Nährwerte (pro Portion): ${parts.join(", ")}`;
}

/* ------------------------------- ingredients ------------------------------ */

function readIngredientLines(node: JsonLdNode): string[] {
  const value = pick(node, "recipeIngredient", "ingredients", "ingredient");
  const lines: string[] = [];
  for (const entry of toArray(value)) {
    if (typeof entry === "string") {
      // Some sites cram the whole list into one string with newlines.
      const multiline = cleanMultilineText(entry);
      for (const line of multiline.split(/\n+/)) {
        if (line.trim().length > 0) lines.push(line.trim());
      }
      continue;
    }
    const text = scalar(entry);
    if (text !== undefined) lines.push(cleanText(text));
  }
  return lines;
}

/* --------------------------------- mapping -------------------------------- */

export interface MapSchemaRecipeOptions {
  /** Page URL, used to absolutise relative image paths and as `sourceUrl`. */
  baseUrl?: string;
  /** Fallback source name (usually the hostname). */
  sourceName?: string;
}

/**
 * Reduces a locale to its primary subtag ("de-DE", "de_DE", "german" -> "de"),
 * which is what the `recipes.language` column stores.
 */
export function normalizeLanguage(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const primary = cleanText(value).toLowerCase().split(/[-_\s]/)[0] ?? "";
  if (primary.length < 2 || primary.length > 10) return undefined;
  if (primary === "german" || primary === "deutsch") return "de";
  if (primary === "english") return "en";
  return primary;
}

/** Resolves a possibly protocol-relative/relative URL against the page URL. */
export function absoluteUrl(candidate: string, baseUrl: string | undefined): string {
  const trimmed = candidate.trim();
  if (trimmed.startsWith("data:")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (baseUrl === undefined) return trimmed;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return trimmed;
  }
}

/**
 * The core schema.org -> ParsedFields mapping. Pure and synchronous, so it is
 * trivially unit-testable against fixture pages.
 */
export function mapSchemaRecipe(node: JsonLdNode, options: MapSchemaRecipeOptions = {}): ParsedFields {
  const fields: ParsedFields = {};

  const title = scalar(pick(node, "name", "headline"));
  if (title !== undefined) fields.title = cleanText(title);

  const description = scalar(pick(node, "description", "abstract"));
  if (description !== undefined) fields.description = cleanText(description);

  const images = imageUrls(pick(node, "image", "images", "photo", "thumbnailUrl"));
  if (images.length > 0) fields.imageUrl = absoluteUrl(images[0]!, options.baseUrl);

  const url = scalar(pick(node, "url", "mainEntityOfPage", "@id"));
  const sourceUrl = options.baseUrl ?? (url !== undefined && /^https?:\/\//i.test(url) ? url : undefined);
  if (sourceUrl !== undefined) fields.sourceUrl = sourceUrl;

  // `sourceName` is the SITE, so only a publisher/Organization qualifies. A
  // Person author becomes a note instead — `og:site_name` (see meta.ts) or the
  // hostname fill the gap, which reads far better than "Familienkoch77".
  const authorName = scalar(pick(node, "author", "creator"));
  const publisherName = scalar(node.publisher);
  if (publisherName !== undefined) fields.sourceName = cleanText(publisherName);

  const servings = readServings(pick(node, "recipeYield", "yield"));
  if (servings) fields.servings = servings;

  const prepMinutes = readMinutes(pick(node, "prepTime", "preparationTime"));
  if (prepMinutes !== undefined) fields.prepMinutes = prepMinutes;
  const cookMinutes = readMinutes(pick(node, "cookTime", "cookingTime", "performTime"));
  if (cookMinutes !== undefined) fields.cookMinutes = cookMinutes;
  const totalMinutes = readMinutes(pick(node, "totalTime"));
  if (totalMinutes !== undefined) fields.totalMinutes = totalMinutes;
  // Derive a total when only the parts are given.
  if (fields.totalMinutes === undefined && (prepMinutes !== undefined || cookMinutes !== undefined)) {
    fields.totalMinutes = (prepMinutes ?? 0) + (cookMinutes ?? 0);
  }

  const difficulty =
    normalizeDifficulty(scalar(pick(node, "difficulty", "recipeDifficulty"))) ??
    normalizeDifficulty(scalar((node.additionalProperty as JsonLdNode | undefined)?.value));
  if (difficulty) fields.difficulty = difficulty;

  const ingredientLines = readIngredientLines(node);
  if (ingredientLines.length > 0) fields.ingredients = buildIngredients(ingredientLines);

  const rawSteps = flattenInstructions(pick(node, "recipeInstructions", "instructions", "step", "steps"));
  if (rawSteps.length > 0) fields.steps = buildSteps(rawSteps);

  const tagSources: string[] = [];
  for (const key of ["keywords", "recipeCategory", "recipeCuisine", "suitableForDiet"]) {
    for (const entry of toArray(node[key])) {
      const text = scalar(entry);
      if (text === undefined) continue;
      // "vegan, schnell, Ofen" and "https://schema.org/VeganDiet"
      const normalized = cleanText(text).replace(/^https?:\/\/schema\.org\//i, "").replace(/Diet$/i, "");
      for (const part of normalized.split(/\s*[,;|]\s*/)) {
        if (part.trim().length > 1) tagSources.push(part.trim());
      }
    }
  }
  const tags = dedupeTags(tagSources);
  if (tags.length > 0) fields.tags = tags;

  const notes: string[] = [];
  const nutrition = formatNutrition(node.nutrition);
  if (nutrition !== undefined) notes.push(nutrition);
  if (authorName !== undefined) {
    const author = cleanText(authorName);
    const site = (options.sourceName ?? "").toLowerCase();
    if (author.length > 0 && author.toLowerCase() !== site) notes.push(`Rezept von ${author}`);
  }
  if (notes.length > 0) fields.notes = notes.join("\n\n");

  const language = normalizeLanguage(scalar(pick(node, "inLanguage", "language")));
  if (language !== undefined) fields.language = language;

  return fields;
}

/**
 * Confidence for a structured (JSON-LD/microdata) extraction: high by design,
 * reduced when the essentials are missing.
 */
export function scoreStructuredFields(fields: ParsedFields, base: number): ParsedRecipeConfidence {
  const ingredientCount = fields.ingredients?.length ?? 0;
  const stepCount = fields.steps?.length ?? 0;
  const withAmount = (fields.ingredients ?? []).filter(
    (ingredient) => typeof ingredient.quantity === "number" || typeof ingredient.unit === "string",
  ).length;

  const parts: Omit<ParsedRecipeConfidence, "overall"> = {
    title: fields.title ? base : 0,
    ingredients:
      ingredientCount === 0 ? 0 : Math.min(base, base * (0.6 + 0.4 * (withAmount / Math.max(1, ingredientCount)))),
    steps: stepCount === 0 ? 0 : stepCount === 1 ? base * 0.7 : base,
    servings: fields.servings ? base : 0,
    times:
      fields.totalMinutes !== undefined || fields.prepMinutes !== undefined || fields.cookMinutes !== undefined
        ? base
        : 0,
  };
  if (fields.description) parts.description = base;
  if (fields.imageUrl) parts.image = base;

  return { ...parts, overall: computeOverallConfidence(parts) };
}
