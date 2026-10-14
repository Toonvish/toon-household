/**
 * Ingredient line parsing. Pure, German-first, no I/O.
 *
 * The parser never throws and never loses information: whatever it cannot
 * classify stays in `name`, and the untouched source line is kept in `raw`.
 */
import type { RecipeIngredient, RecipeStep } from "./schemas/recipe.ts";
import { QUANTITY_TOKEN, parseNumberToken, parseQuantityRange, roundQuantity } from "./numbers.ts";
import { NON_SCALING_UNITS, isKnownUnit, normalizeUnit } from "./units.ts";

/** Spelled-out amounts we accept at the start of a line. */
const WORD_NUMBERS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  einer: 1,
  eins: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  zwoelf: 12,
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** Leading hedges: kept as a note, stripped from the amount. */
const APPROX_WORDS: Record<string, string> = {
  ca: "ca.",
  "ca.": "ca.",
  circa: "ca.",
  zirka: "ca.",
  etwa: "ca.",
  ungefähr: "ca.",
  ungefaehr: "ca.",
  about: "ca.",
  approx: "ca.",
  knapp: "knapp",
  gut: "gut",
  reichlich: "reichlich",
  etwas: "etwas",
  optional: "optional",
  evtl: "evtl.",
  "evtl.": "evtl.",
  "mind.": "mind.",
  mind: "mind.",
  "max.": "max.",
  max: "max.",
};

/** Trailing phrases that are always a note, even without a comma. */
const TRAILING_NOTE_RE =
  /\s+(nach\s+Geschmack|nach\s+Belieben|nach\s+Wunsch|zum\s+Abschmecken|zum\s+Servieren|zum\s+Garnieren|zum\s+Bestreuen|zum\s+Bestäuben|zum\s+Einfetten|zum\s+Frittieren|zum\s+Anbraten|zum\s+Braten|zum\s+Bepinseln|to\s+taste|for\s+serving|for\s+garnish|optional)\.?$/iu;

/** Words that mark the text after a comma as a preparation note. */
const PREP_HINTS = [
  "gehackt",
  "gewürfelt",
  "geschnitten",
  "gerieben",
  "geschält",
  "gepresst",
  "gemahlen",
  "zerlassen",
  "geschmolzen",
  "gesiebt",
  "entkernt",
  "abgetropft",
  "aufgetaut",
  "halbiert",
  "geviertelt",
  "püriert",
  "eingelegt",
  "getrocknet",
  "weich",
  "zimmerwarm",
  "lauwarm",
  "flüssig",
  "frisch",
  "fein",
  "grob",
  "optional",
  "chopped",
  "sliced",
  "diced",
  "grated",
  "melted",
  "softened",
  "peeled",
  "drained",
];

const QT = QUANTITY_TOKEN;
const RANGE_RE = new RegExp(`^(${QT})\\s*(?:-|–|—|bis|to)\\s*(${QT})(?=\\s|$|[\\p{L}])`, "iu");
const SINGLE_QTY_RE = new RegExp(`^(${QT})`, "u");
const MULTIPLIER_RE = new RegExp(`^(\\d+)\\s*[x×]\\s*(?=${QT})`, "u");
const PER_UNIT_RE = new RegExp(`^à\\s*(${QT})\\s*([\\p{L}]+\\.?)?\\s*`, "iu");
const LEADING_UNIT_RE = /^([\p{L}]+\.?)/u;

// Both ends strip the SAME characters. They used to disagree — the trailing class
// omitted ".", "-", "–" and "—" — so "1 Pck. Vanillezucker." kept its full stop and
// "250 g Butter -" its dash, straight into the stored name and every screen that
// renders it. The note beside it was already trimmed, so one line could show a
// cleaned note next to an uncleaned name.
const NAME_EDGE_RE = /^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g;

function cleanupName(value: string): string {
  return value
    .replace(NAME_EDGE_RE, "")
    .replace(/\s+/g, " ")
    .replace(/^von\s+/i, "")
    .trim();
}

/** True when the text after a comma reads like a preparation note, not another ingredient. */
function looksLikeNote(rest: string): boolean {
  const trimmed = rest.trim();
  if (trimmed.length === 0) return false;
  const firstWord = trimmed.split(/\s+/, 1)[0] ?? "";
  const lower = trimmed.toLowerCase();
  if (PREP_HINTS.some((hint) => lower.includes(hint))) return true;
  if (/^(in|zum|zur|für|à|davon|ohne|mit|am|als|plus|ca\.|etwa|evtl\.|z\.b\.)\b/i.test(trimmed)) return true;
  const firstChar = firstWord[0] ?? "";
  // German nouns are capitalised, so a lowercase start means "description".
  return firstChar === firstChar.toLowerCase() && firstChar !== firstChar.toUpperCase();
}

/** Splits "Zwiebel, fein gehackt" into name + note; leaves "Salz, Pfeffer" alone. */
function splitTrailingNote(value: string): { name: string; note?: string } {
  let searchFrom = 0;
  while (searchFrom < value.length) {
    const index = value.indexOf(",", searchFrom);
    if (index === -1) break;
    const head = value.slice(0, index);
    const tail = value.slice(index + 1);
    if (head.trim().length > 0 && looksLikeNote(tail)) {
      return { name: head, note: tail.trim() };
    }
    searchFrom = index + 1;
  }
  return { name: value };
}

/**
 * Parses one ingredient line into the contract shape.
 *
 * Handles: German + English units, glued units ("250g"), decimal commas,
 * ascii and unicode fractions ("1 1/2", "1½"), ranges ("2-3 Eier" =>
 * quantity 2 / quantityMax 3), multipliers ("2 x 400 g"), per-unit sizes
 * ("2 Dosen à 400 g"), hedges ("ca.", "etwas"), parenthetical notes and
 * trailing notes ("Salz und Pfeffer nach Geschmack").
 *
 * `position` is passed through so callers can map over a list.
 * Blank lines should be filtered by the caller (use parseIngredientBlock).
 */
export function parseIngredientLine(line: string, position = 0): RecipeIngredient {
  const raw = line.replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
  let work = raw.replace(/^[\s\-–—•*▪▫◦‣·▢□☐+]+/u, "").trim();

  const notes: string[] = [];

  // 1. parenthetical / bracketed notes
  work = work
    .replace(/[([{]([^)\]}]{1,200})[)\]}]/gu, (_match, inner: string) => {
      const text = inner.trim();
      if (text.length > 0) notes.push(text);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  // 2. trailing "nach Geschmack" style notes
  for (;;) {
    const match = TRAILING_NOTE_RE.exec(work);
    if (!match) break;
    notes.push(match[1]!.replace(/\s+/g, " ").trim());
    work = work.slice(0, match.index).trim();
  }

  // 3. leading hedges ("ca. 200 ml", "etwas Öl")
  for (;;) {
    const match = /^([\p{L}]+\.?)\s+/u.exec(work);
    if (!match) break;
    const hedge = APPROX_WORDS[match[1]!.toLowerCase()];
    if (hedge === undefined) break;
    notes.unshift(hedge);
    work = work.slice(match[0].length).trim();
  }

  // 4. multiplier ("2 x 400 g Tomaten")
  let multiplier = 1;
  const multiplierMatch = MULTIPLIER_RE.exec(work);
  if (multiplierMatch) {
    multiplier = Number(multiplierMatch[1]);
    work = work.slice(multiplierMatch[0].length).trim();
  }

  // 5. quantity (range first, then single, then spelled-out)
  let quantity: number | undefined;
  let quantityMax: number | undefined;
  const rangeMatch = RANGE_RE.exec(work);
  if (rangeMatch) {
    const low = parseNumberToken(rangeMatch[1]!);
    const high = parseNumberToken(rangeMatch[2]!);
    if (low !== undefined && high !== undefined && high > low) {
      quantity = low;
      quantityMax = high;
      work = work.slice(rangeMatch[0].length).trim();
    }
  }
  if (quantity === undefined) {
    const single = SINGLE_QTY_RE.exec(work);
    if (single) {
      const value = parseNumberToken(single[1]!);
      if (value !== undefined) {
        quantity = value;
        work = work.slice(single[0].length).trim();
      }
    }
  }
  if (quantity === undefined) {
    const word = /^([\p{L}]+)\s+/u.exec(work);
    const wordValue = word ? WORD_NUMBERS[word[1]!.toLowerCase()] : undefined;
    // Only trust a spelled-out number when a real unit or ingredient follows.
    if (word && wordValue !== undefined && work.slice(word[0].length).trim().length > 0) {
      quantity = wordValue;
      work = work.slice(word[0].length).trim();
    }
  }
  if (quantity !== undefined && multiplier > 1) {
    notes.push(`${multiplier} x ${quantity}${quantityMax !== undefined ? `-${quantityMax}` : ""}`);
    quantity *= multiplier;
    if (quantityMax !== undefined) quantityMax *= multiplier;
  }

  // 6. unit directly after the quantity (also handles glued "250g")
  let unit: string | undefined;
  if (quantity !== undefined) {
    const unitMatch = LEADING_UNIT_RE.exec(work);
    if (unitMatch && isKnownUnit(unitMatch[1]!)) {
      unit = normalizeUnit(unitMatch[1]!);
      work = work.slice(unitMatch[0].length).trim();
    }
  }

  // 7. per-unit size ("2 Dosen à 400 g Tomaten")
  const perUnit = PER_UNIT_RE.exec(work);
  if (perUnit) {
    const size = perUnit[1]!.trim();
    const sizeUnit = perUnit[2] ? normalizeUnit(perUnit[2]) : "";
    notes.push(`à ${size}${sizeUnit ? ` ${sizeUnit}` : ""}`.trim());
    work = work.slice(perUnit[0].length).trim();
  }

  // 8. name + trailing note
  const split = splitTrailingNote(work);
  let name = cleanupName(split.name);
  if (split.note) notes.push(split.note);
  if (name.length === 0) {
    const fallback = notes.shift();
    name = cleanupName(fallback ?? raw);
  }

  const note = notes.length > 0 ? notes.join(", ").slice(0, 300) : undefined;

  return {
    position,
    quantity: quantity !== undefined ? roundQuantity(quantity) : undefined,
    quantityMax: quantityMax !== undefined ? roundQuantity(quantityMax) : undefined,
    unit,
    name: name.slice(0, 300),
    note,
    raw: raw.slice(0, 500),
  };
}

const SECTION_HEADING_RE = /^(?:\*\*)?([^:]{2,80}):\s*(?:\*\*)?$/u;

/**
 * Parses a whole ingredient block (one line per ingredient, optional
 * "Für den Teig:" headings). Blank lines are dropped, positions are assigned,
 * headings become the `section` of the following ingredients.
 */
export function parseIngredientBlock(text: string): RecipeIngredient[] {
  const out: RecipeIngredient[] = [];
  let section: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const heading = SECTION_HEADING_RE.exec(line);
    if (heading) {
      section = heading[1]!.trim();
      continue;
    }
    const ingredient = parseIngredientLine(line, out.length);
    out.push(section ? { ...ingredient, section } : ingredient);
  }
  return out;
}

/**
 * Splits a preparation block into steps. Recognises "1." / "1)" / "Schritt 1"
 * numbering, otherwise falls back to blank-line separated paragraphs, then to
 * single lines.
 */
export function parseStepBlock(text: string): RecipeStep[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return [];

  const numbered = normalized.split(/\n(?=\s*(?:Schritt\s*)?\d{1,2}\s*[.)]\s)/iu);
  const chunks =
    numbered.length > 1
      ? numbered
      : normalized.includes("\n\n")
        ? normalized.split(/\n{2,}/)
        : normalized.split(/\n/);

  const steps: RecipeStep[] = [];
  let section: string | undefined;
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (trimmed.length === 0) continue;
    const heading = SECTION_HEADING_RE.exec(trimmed);
    if (heading) {
      section = heading[1]!.trim();
      continue;
    }
    const cleaned = trimmed
      .replace(/^\s*(?:Schritt\s*)?\d{1,2}\s*[.)]\s*/iu, "")
      .replace(/^[\s\-–—•*]+/u, "")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (cleaned.length === 0) continue;
    steps.push(section ? { position: steps.length, section, text: cleaned } : { position: steps.length, text: cleaned });
  }
  return steps;
}

export interface ScaleOptions {
  /**
   * Leave "Prise"/"Msp."/"Spritzer"/"Schuss" amounts untouched
   * (a pinch stays a pinch). Default false: everything is scaled.
   */
  keepNonScalingUnits?: boolean;
}

/**
 * Scales every quantity by `factor`, rounding to human-friendly values.
 * `unit`, `name`, `note` and `raw` are preserved verbatim — `raw` still shows
 * the original amount, which is intentional (it is the provenance field).
 *
 * @throws RangeError when factor is not a finite number > 0.
 */
export function scaleIngredients<T extends RecipeIngredient>(
  ingredients: readonly T[],
  factor: number,
  options: ScaleOptions = {},
): T[] {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(`scaleIngredients: factor must be a finite number > 0, got ${factor}`);
  }
  return ingredients.map((ingredient) => {
    const skip =
      options.keepNonScalingUnits === true &&
      typeof ingredient.unit === "string" &&
      NON_SCALING_UNITS.includes(normalizeUnit(ingredient.unit));
    if (skip) return { ...ingredient };
    const patch: Partial<RecipeIngredient> = {};
    if (typeof ingredient.quantity === "number") {
      patch.quantity = roundQuantity(ingredient.quantity * factor);
    }
    if (typeof ingredient.quantityMax === "number") {
      patch.quantityMax = roundQuantity(ingredient.quantityMax * factor);
    }
    return { ...ingredient, ...patch };
  });
}

/** Convenience wrapper: scale from one servings count to another. */
export function scaleIngredientsToServings<T extends RecipeIngredient>(
  ingredients: readonly T[],
  fromServings: number,
  toServings: number,
  options: ScaleOptions = {},
): T[] {
  if (!Number.isFinite(fromServings) || fromServings <= 0) {
    throw new RangeError(`scaleIngredientsToServings: fromServings must be > 0, got ${fromServings}`);
  }
  return scaleIngredients(ingredients, toServings / fromServings, options);
}

/** Renders an ingredient back to a display line ("250 g Mehl (gesiebt)"). */
export function formatIngredient(
  ingredient: RecipeIngredient,
  formatNumber: (value: number) => string = (value) => String(value),
): string {
  const parts: string[] = [];
  if (typeof ingredient.quantity === "number") {
    const amount =
      typeof ingredient.quantityMax === "number"
        ? `${formatNumber(ingredient.quantity)}-${formatNumber(ingredient.quantityMax)}`
        : formatNumber(ingredient.quantity);
    parts.push(amount);
  }
  if (ingredient.unit) parts.push(ingredient.unit);
  parts.push(ingredient.name);
  const line = parts.join(" ").trim();
  return ingredient.note ? `${line} (${ingredient.note})` : line;
}

export { parseQuantityRange };
