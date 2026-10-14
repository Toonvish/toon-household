/**
 * Shared building blocks for turning *any* extracted source (JSON-LD, microdata,
 * site selectors, OCR text, PDF text layer) into the one normalized
 * `ParsedRecipe` shape from @toon/shared.
 *
 * Every importer produces `ParsedFields`, they get merged (first source wins per
 * field), and `finalizeParsed()` clamps everything to the contract's limits so a
 * hostile page can never produce a draft that fails `ParsedRecipeSchema`.
 */
import {
  type Difficulty,
  type ParsedRecipe,
  type ParsedRecipeConfidence,
  type RecipeIngredient,
  type RecipeStep,
  type Servings,
  parseIngredientLine,
} from "@toon/shared";
import { cleanText, truncate } from "./html/entities.ts";

/** Everything a source can contribute, all optional. */
export type ParsedFields = {
  title?: string;
  description?: string;
  imageUrl?: string;
  sourceUrl?: string;
  sourceName?: string;
  servings?: Servings;
  prepMinutes?: number;
  cookMinutes?: number;
  totalMinutes?: number;
  difficulty?: Difficulty;
  ingredients?: RecipeIngredient[];
  steps?: RecipeStep[];
  tags?: string[];
  notes?: string;
  language?: string;
};

/* ------------------------------ contract limits --------------------------- */

const LIMITS = {
  title: 300,
  description: 5000,
  imageUrl: 2000,
  sourceUrl: 2000,
  sourceName: 200,
  notes: 10000,
  section: 120,
  ingredientName: 300,
  ingredientNote: 300,
  ingredientRaw: 500,
  stepText: 5000,
  tag: 60,
  servingsUnit: 40,
  maxIngredients: 300,
  maxSteps: 300,
  maxTags: 30,
  maxMinutes: 100000,
} as const;

/* --------------------------- ingredient assembly -------------------------- */

/**
 * Lines that are a *heading* inside an ingredient list rather than an
 * ingredient: "Für den Teig:", "Für die Sauce", "Zum Garnieren", "TOPPING".
 */
const SECTION_HEADING_RES: readonly RegExp[] = [
  /^(?:f(?:ü|u)r|fuer)\s+(?:den|die|das|dem|alle|ca\.?|\d)/iu,
  /^(?:zum|zur)\s+(?:garnieren|servieren|bestreuen|best(?:ä|a)uben|dekorieren|anrichten|einfetten|abschmecken|f(?:ü|u)llen|tr(?:ä|a)nken|beträufeln|betr(?:ä|a)ufeln)\b/iu,
  /^(?:teig|f(?:ü|u)llung|belag|creme|guss|glasur|sauce|so(?:ß|ss)e|dressing|marinade|topping|streusel|boden|au(?:ß|ss)erdem|dazu|beilage|ausserdem)\s*:?\s*$/iu,
  /^zutaten(?:\s+f(?:ü|u)r.*)?:?\s*$/iu,
  /^ingredients?\s*:?\s*$/iu,
  /^for\s+the\s+/iu,
];

/** German words that appear in headings but never start an ingredient line. */
const HEADING_STOP_RE = /^(?:und\s+)?(?:so\s+geht|zubereitung|anleitung|schritte?|tipps?|hinweis)/iu;

/**
 * True when a raw list entry should become the `section` of the entries that
 * follow instead of an ingredient of its own.
 */
export function isIngredientSectionHeading(line: string): boolean {
  const text = line.trim().replace(/^[-–—•*\s]+/u, "").trim();
  if (text.length === 0 || text.length > 80) return false;
  if (HEADING_STOP_RE.test(text)) return false;

  const withoutColon = text.replace(/\s*:\s*$/, "");
  const endsWithColon = text !== withoutColon;

  // A heading never carries a quantity ("250 g Mehl:" is an ingredient).
  const probe = parseIngredientLine(withoutColon);
  const hasAmount = typeof probe.quantity === "number" || typeof probe.unit === "string";

  if (SECTION_HEADING_RES.some((pattern) => pattern.test(withoutColon))) return !hasAmount;
  if (endsWithColon && !hasAmount && /\p{L}/u.test(withoutColon) && withoutColon.split(/\s+/).length <= 8) return true;
  // Short SHOUTED lines ("TOPPING") are headings on scanned pages.
  return (
    !hasAmount &&
    withoutColon.length >= 3 &&
    withoutColon.length <= 40 &&
    withoutColon === withoutColon.toUpperCase() &&
    /\p{Lu}/u.test(withoutColon) &&
    withoutColon.split(/\s+/).length <= 4
  );
}

/** Normalises a heading for use as `section`. */
export function normalizeSection(line: string): string {
  const text = cleanText(line).replace(/^[-–—•*\s]+/u, "").replace(/\s*:\s*$/, "").trim();
  const cased = text === text.toUpperCase() && text.length > 2 ? titleCaseGerman(text) : text;
  return truncate(cased, LIMITS.section);
}

function titleCaseGerman(text: string): string {
  return text
    .toLocaleLowerCase("de-DE")
    .replace(/(^|\s)(\p{L})/gu, (_match, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase("de-DE"));
}

export interface BuildIngredientsOptions {
  /** Section applied to entries before the first heading. */
  initialSection?: string;
  /** Optional per-line repair (OCR digit confusions) applied before parsing. */
  repairLine?: (line: string) => string;
}

/**
 * Parses raw ingredient lines into contract shape, promoting "Für den Teig:"
 * style entries to `section` and dropping empty/noise lines.
 */
export function buildIngredients(
  lines: readonly string[],
  options: BuildIngredientsOptions = {},
): RecipeIngredient[] {
  const out: RecipeIngredient[] = [];
  let section = options.initialSection;

  for (const rawLine of lines) {
    const line = cleanText(rawLine);
    if (line.length === 0) continue;
    // Bullet-only or separator-only leftovers.
    if (!/\p{L}|\d/u.test(line)) continue;

    if (isIngredientSectionHeading(line)) {
      section = normalizeSection(line) || undefined;
      continue;
    }

    const repaired = options.repairLine ? options.repairLine(line) : line;
    const ingredient = parseIngredientLine(repaired, out.length);
    if (ingredient.name.length === 0) continue;

    out.push(
      clampIngredient({
        ...ingredient,
        // Keep the ORIGINAL line as provenance, not the repaired one.
        raw: line,
        section: section ?? null,
      }),
    );
    if (out.length >= LIMITS.maxIngredients) break;
  }
  return out;
}

function clampIngredient(ingredient: RecipeIngredient): RecipeIngredient {
  return {
    position: ingredient.position,
    section: ingredient.section ? truncate(ingredient.section, LIMITS.section) : null,
    quantity: normalizeQuantity(ingredient.quantity),
    quantityMax: normalizeQuantity(ingredient.quantityMax),
    unit: ingredient.unit ? truncate(ingredient.unit, 40) : null,
    name: truncate(ingredient.name, LIMITS.ingredientName) || "?",
    note: ingredient.note ? truncate(ingredient.note, LIMITS.ingredientNote) : null,
    raw: ingredient.raw.slice(0, LIMITS.ingredientRaw),
  };
}

function normalizeQuantity(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/* ------------------------------ step assembly ----------------------------- */

export interface RawStep {
  text: string;
  section?: string | null;
}

/** Cleans, de-numbers, de-duplicates and clamps a list of instruction texts. */
export function buildSteps(rawSteps: readonly RawStep[]): RecipeStep[] {
  const out: RecipeStep[] = [];
  const seen = new Set<string>();
  for (const raw of rawSteps) {
    const text = cleanText(raw.text)
      .replace(/^\s*(?:Schritt\s*)?\d{1,2}\s*[.):]\s*/iu, "")
      .replace(/^[-–—•*\s]+/u, "")
      .trim();
    if (text.length === 0) continue;
    if (!/\p{L}/u.test(text)) continue;
    const key = `${raw.section ?? ""}::${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      position: out.length,
      section: raw.section ? truncate(normalizeSection(raw.section), LIMITS.section) || null : null,
      text: truncate(text, LIMITS.stepText),
    });
    if (out.length >= LIMITS.maxSteps) break;
  }
  return out;
}

/* --------------------------------- merging -------------------------------- */

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Fills gaps in `base` from `extra`. The FIRST source that produced a value
 * wins, which is how the pipeline expresses "JSON-LD beats microdata beats
 * site selectors".
 */
export function mergeParsedFields(base: ParsedFields, extra: ParsedFields): ParsedFields {
  const merged: ParsedFields = { ...base };
  for (const [key, value] of Object.entries(extra) as Array<[keyof ParsedFields, unknown]>) {
    if (isEmptyValue(value)) continue;
    if (isEmptyValue(merged[key])) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  // Tags are additive rather than "first wins" — more keywords is strictly better.
  const tags = [...(base.tags ?? []), ...(extra.tags ?? [])];
  if (tags.length > 0) merged.tags = dedupeTags(tags);
  return merged;
}

/**
 * Copies ingredient GROUP headings from `donor` onto `target` by matching
 * ingredient names.
 *
 * Why: schema.org `recipeIngredient` is a flat array, so JSON-LD always loses
 * "Für den Teig" / "Für die Sauce" — but the page markup (chefkoch's table
 * `<th>`, WPRM's `.wprm-recipe-ingredient-group-name`) still has them. The
 * pipeline keeps the better JSON-LD ingredient lines and adopts the sections
 * from the adapter's parse when they clearly describe the same list.
 *
 * @returns true when sections were adopted (>= 60 % of the donor list matched).
 */
export function adoptIngredientSections(
  target: RecipeIngredient[],
  donor: readonly RecipeIngredient[],
): boolean {
  if (target.length === 0 || donor.length === 0) return false;
  if (target.some((ingredient) => typeof ingredient.section === "string" && ingredient.section.length > 0)) return false;
  const donorSections = donor.filter(
    (ingredient) => typeof ingredient.section === "string" && ingredient.section.length > 0,
  );
  if (donorSections.length === 0) return false;

  // Same length => the two parses describe the same list in the same order, so
  // align by INDEX. Name matching would misplace a duplicate ingredient (e.g.
  // "Pflanzenmilch" appearing in both the dough and the glaze group).
  if (target.length === donor.length) {
    for (const [index, ingredient] of target.entries()) {
      const section = donor[index]?.section;
      if (typeof section === "string" && section.length > 0) target[index] = { ...ingredient, section };
    }
    return true;
  }

  const key = (name: string): string =>
    name
      .toLocaleLowerCase("de-DE")
      .replace(/[^\p{L}\p{N}]+/gu, "")
      .slice(0, 40);

  const sectionByName = new Map<string, string>();
  for (const ingredient of donor) {
    if (typeof ingredient.section !== "string" || ingredient.section.length === 0) continue;
    const nameKey = key(ingredient.name);
    if (nameKey.length > 0 && !sectionByName.has(nameKey)) sectionByName.set(nameKey, ingredient.section);
  }

  let matched = 0;
  const patch = new Array<string | null>(target.length).fill(null);
  for (const [index, ingredient] of target.entries()) {
    const section = sectionByName.get(key(ingredient.name));
    if (section === undefined) continue;
    patch[index] = section;
    matched += 1;
  }
  if (matched / Math.max(1, donorSections.length) < 0.6) return false;

  // Fill unmatched entries with the previous section: group headings apply to a
  // run of ingredients, so a single unmatched line belongs to its neighbours.
  let previous: string | null = null;
  for (const [index, ingredient] of target.entries()) {
    const section: string | null = patch[index] ?? previous;
    if (section !== null) target[index] = { ...ingredient, section };
    previous = section;
  }
  return true;
}

/** Normalises, de-duplicates (case-insensitively) and caps a tag list. */
export function dedupeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const clean = truncate(cleanText(tag).replace(/^#/, "").trim(), LIMITS.tag);
    if (clean.length === 0) continue;
    const key = clean.toLocaleLowerCase("de-DE");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= LIMITS.maxTags) break;
  }
  return out;
}

/* ------------------------------- finalization ----------------------------- */

function clampMinutes(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const rounded = Math.round(value);
  return rounded > LIMITS.maxMinutes ? LIMITS.maxMinutes : rounded;
}

function clampServings(servings: Servings | undefined): Servings | undefined {
  if (!servings) return undefined;
  const amount = servings.amount;
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = truncate(cleanText(servings.unit) || "Portionen", LIMITS.servingsUnit);
  return { amount: Math.round(Math.min(amount, 10000) * 100) / 100, unit: unit.length > 0 ? unit : "Portionen" };
}

function optionalString(value: string | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = truncate(value.trim(), max);
  return clean.length > 0 ? clean : undefined;
}

/**
 * Produces the final, contract-valid `ParsedRecipe`. Positions on ingredients
 * and steps are re-assigned so the review screen always sees 0..n-1.
 */
export function finalizeParsed(fields: ParsedFields, confidence: ParsedRecipeConfidence): ParsedRecipe {
  const ingredients = (fields.ingredients ?? [])
    .slice(0, LIMITS.maxIngredients)
    .map((ingredient, index) => clampIngredient({ ...ingredient, position: index }));
  const steps = (fields.steps ?? []).slice(0, LIMITS.maxSteps).map((step, index) => ({
    position: index,
    section: step.section ? truncate(step.section, LIMITS.section) : null,
    text: truncate(step.text, LIMITS.stepText),
  }));

  const parsed: ParsedRecipe = {
    ingredients,
    steps,
    tags: dedupeTags(fields.tags ?? []),
    confidence: clampConfidence(confidence),
  };

  const title = optionalString(fields.title, LIMITS.title);
  if (title) parsed.title = title;
  const description = optionalString(fields.description, LIMITS.description);
  if (description) parsed.description = description;
  const imageUrl = optionalString(fields.imageUrl, LIMITS.imageUrl);
  if (imageUrl) parsed.imageUrl = imageUrl;
  const sourceUrl = optionalString(fields.sourceUrl, LIMITS.sourceUrl);
  if (sourceUrl) parsed.sourceUrl = sourceUrl;
  const sourceName = optionalString(fields.sourceName, LIMITS.sourceName);
  if (sourceName) parsed.sourceName = sourceName;
  const notes = optionalString(fields.notes, LIMITS.notes);
  if (notes) parsed.notes = notes;

  const servings = clampServings(fields.servings);
  if (servings) parsed.servings = servings;

  const prepMinutes = clampMinutes(fields.prepMinutes);
  if (prepMinutes !== undefined) parsed.prepMinutes = prepMinutes;
  const cookMinutes = clampMinutes(fields.cookMinutes);
  if (cookMinutes !== undefined) parsed.cookMinutes = cookMinutes;
  const totalMinutes = clampMinutes(fields.totalMinutes);
  if (totalMinutes !== undefined) parsed.totalMinutes = totalMinutes;

  if (fields.difficulty) parsed.difficulty = fields.difficulty;
  parsed.language = optionalString(fields.language, 10) ?? "de";

  return parsed;
}

function clamp01(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

/** Clamps every confidence value into [0,1] and guarantees `overall`. */
export function clampConfidence(confidence: ParsedRecipeConfidence): ParsedRecipeConfidence {
  const out: ParsedRecipeConfidence = { overall: clamp01(confidence.overall) ?? 0 };
  for (const key of ["title", "description", "ingredients", "steps", "servings", "times", "image"] as const) {
    const value = clamp01(confidence[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Maps a free-text difficulty ("leicht", "anspruchsvoll") onto the enum. */
export function normalizeDifficulty(value: string | null | undefined): Difficulty | undefined {
  if (typeof value !== "string") return undefined;
  const text = cleanText(value).toLocaleLowerCase("de-DE");
  if (text.length === 0) return undefined;
  if (/(einfach|leicht|simpel|easy|anf(ä|a)nger|schnell|beginner)/u.test(text)) return "einfach";
  if (/(schwer|schwierig|anspruchsvoll|profi|hard|difficult|expert|aufwendig)/u.test(text)) return "schwer";
  if (/(mittel|normal|medium|fortgeschritten|moderate)/u.test(text)) return "mittel";
  return undefined;
}

/**
 * Weighted overall score. Ingredients and steps dominate because a draft
 * without them is useless, whatever else was recognised.
 */
export function computeOverallConfidence(parts: Omit<ParsedRecipeConfidence, "overall">): number {
  const weights: Array<[number | undefined, number]> = [
    [parts.ingredients, 0.4],
    [parts.steps, 0.32],
    [parts.title, 0.16],
    [parts.servings, 0.06],
    [parts.times, 0.06],
  ];
  let sum = 0;
  let weight = 0;
  for (const [value, factor] of weights) {
    if (value === undefined) continue;
    sum += value * factor;
    weight += factor;
  }
  if (weight === 0) return 0;
  return Math.min(1, Math.max(0, Math.round((sum / weight) * 100) / 100));
}
