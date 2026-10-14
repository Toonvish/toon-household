/**
 * Pure editing operations on a `ParsedRecipe` draft.
 *
 * Everything in this module is side-effect free and DOM free so it can be unit
 * tested with `bun test` (see draftEdit.test.ts). The review screen keeps the
 * draft in React state and pipes every user action through these helpers, which
 * guarantees that positions stay sequential and that whatever we PATCH back to
 * the API always satisfies `ParsedRecipeSchema` (so the review screen can never
 * produce a 422 for structural reasons).
 */
import {
  foldText,
  formatIngredient,
  formatQuantity,
  parseIngredientBlock,
  parseIngredientLine,
  parseStepBlock,
  QUANTITY_TOKEN,
  type Difficulty,
  type ParsedRecipe,
  type ParsedRecipeConfidence,
  type RecipeIngredient,
  type RecipeStep,
} from "@toon/shared";
import { translate } from "@/lib/i18n";

/* -------------------------------------------------------------------------- */
/* limits mirrored from ParsedRecipeSchema                                     */
/* -------------------------------------------------------------------------- */

export const LIMITS = {
  title: 300,
  description: 5000,
  imageUrl: 2000,
  sourceUrl: 2000,
  sourceName: 200,
  notes: 10000,
  language: 10,
  section: 120,
  unit: 40,
  ingredientName: 300,
  ingredientNote: 300,
  raw: 500,
  stepText: 5000,
  servingsUnit: 40,
  minutes: 100000,
  maxIngredients: 300,
  maxSteps: 300,
  maxTags: 30,
  tagName: 60,
} as const;

const DIFFICULTIES: readonly Difficulty[] = ["einfach", "mittel", "schwer"];

/* -------------------------------------------------------------------------- */
/* small helpers                                                               */
/* -------------------------------------------------------------------------- */

function clip(value: string | null | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, max);
}

function clampNumber(value: unknown, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(value, max);
}

function clampMinutes(value: unknown): number | undefined {
  const numeric = clampNumber(value, LIMITS.minutes);
  return numeric === undefined ? undefined : Math.round(numeric);
}

function clamp01(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/** Moves an array element, returning a new array. Out-of-range moves are no-ops. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.min(Math.max(to, 0), next.length - 1);
  if (target === from) return next;
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(target, 0, item);
  return next;
}

function reindexIngredients(items: readonly RecipeIngredient[]): RecipeIngredient[] {
  return items.map((item, index) => (item.position === index ? item : { ...item, position: index }));
}

function reindexSteps(items: readonly RecipeStep[]): RecipeStep[] {
  return items.map((item, index) => (item.position === index ? item : { ...item, position: index }));
}

/** Display line for an ingredient, used whenever we need text again (raw is preferred). */
export function ingredientToLine(ingredient: RecipeIngredient): string {
  const raw = typeof ingredient.raw === "string" ? ingredient.raw.trim() : "";
  if (raw.length > 0) return raw;
  return formatIngredient(ingredient, formatQuantity);
}

/** An empty editable ingredient row. */
export function emptyIngredient(position: number, section?: string | null): RecipeIngredient {
  return {
    position,
    section: section ?? undefined,
    quantity: undefined,
    quantityMax: undefined,
    unit: undefined,
    name: "",
    note: undefined,
    raw: "",
  };
}

/** An empty editable step row. */
export function emptyStep(position: number, section?: string | null): RecipeStep {
  return { position, section: section ?? undefined, text: "" };
}

/* -------------------------------------------------------------------------- */
/* ingredient operations                                                       */
/* -------------------------------------------------------------------------- */

export function setIngredients(draft: ParsedRecipe, ingredients: readonly RecipeIngredient[]): ParsedRecipe {
  return { ...draft, ingredients: reindexIngredients(ingredients).slice(0, LIMITS.maxIngredients) };
}

export function setSteps(draft: ParsedRecipe, steps: readonly RecipeStep[]): ParsedRecipe {
  return { ...draft, steps: reindexSteps(steps).slice(0, LIMITS.maxSteps) };
}

export function updateIngredient(
  draft: ParsedRecipe,
  index: number,
  patch: Partial<RecipeIngredient>,
): ParsedRecipe {
  const current = draft.ingredients[index];
  if (current === undefined) return draft;
  return setIngredients(
    draft,
    draft.ingredients.map((item, i) => (i === index ? { ...item, ...patch } : item)),
  );
}

export function addIngredient(draft: ParsedRecipe, afterIndex?: number): ParsedRecipe {
  const at = afterIndex === undefined ? draft.ingredients.length : afterIndex + 1;
  const section = afterIndex === undefined ? undefined : draft.ingredients[afterIndex]?.section;
  const next = [...draft.ingredients];
  next.splice(at, 0, emptyIngredient(at, section ?? undefined));
  return setIngredients(draft, next);
}

export function removeIngredient(draft: ParsedRecipe, index: number): ParsedRecipe {
  return setIngredients(
    draft,
    draft.ingredients.filter((_item, i) => i !== index),
  );
}

export function moveIngredient(draft: ParsedRecipe, from: number, to: number): ParsedRecipe {
  return setIngredients(draft, moveItem(draft.ingredients, from, to));
}

/**
 * Re-runs `parseIngredientLine` on a row. `line` defaults to the row's raw text,
 * which is exactly what the user edits in the "Rohzeile" field. The old
 * `section` is kept because the parser knows nothing about headings.
 */
export function reparseIngredient(draft: ParsedRecipe, index: number, line?: string): ParsedRecipe {
  const current = draft.ingredients[index];
  if (current === undefined) return draft;
  const source = line !== undefined ? line : ingredientToLine(current);
  if (source.trim().length === 0) return draft;
  const parsed = parseIngredientLine(source, index);
  return setIngredients(
    draft,
    draft.ingredients.map((item, i) => (i === index ? { ...parsed, section: current.section ?? undefined } : item)),
  );
}

/** "Alle Zeilen neu parsen" — reparses every row from its raw/display text. */
export function reparseAllIngredients(draft: ParsedRecipe): ParsedRecipe {
  const next = draft.ingredients.map((item, index) => {
    const source = ingredientToLine(item);
    if (source.trim().length === 0) return item;
    return { ...parseIngredientLine(source, index), section: item.section ?? undefined };
  });
  return setIngredients(draft, next);
}

const EXPLICIT_SPLIT_RE = /\s{2,}|\s*;\s*|\s+\+\s+|\s*[•·]\s*|\s*\|\s*/u;
/**
 * Split before a quantity that follows a WORD (so "250 g Mehl 100 g Zucker"
 * splits, while "1 1/2 Tassen Mehl" does not, because "1/2" follows a digit).
 */
const IMPLICIT_SPLIT_RE = new RegExp(`(?<=\\p{L}|\\)|%)\\s+(?=${QUANTITY_TOKEN}\\s*\\p{L})`, "u");

/**
 * Splits an OCR line that merged several ingredients.
 * Returns a single-element array when no sensible split point exists, so callers
 * can tell the user "keine Trennstelle gefunden" instead of silently doing nothing.
 */
export function splitIngredientLine(line: string, splitAt?: number): string[] {
  const text = line.trim();
  if (text.length === 0) return [text];

  if (splitAt !== undefined && splitAt > 0 && splitAt < text.length) {
    const head = text.slice(0, splitAt).trim();
    const tail = text.slice(splitAt).trim();
    if (head.length > 0 && tail.length > 0) return [head, tail];
  }

  const explicit = text
    .split(EXPLICIT_SPLIT_RE)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (explicit.length > 1) return explicit;

  const parts: string[] = [];
  let rest = text;
  for (let guard = 0; guard < 20; guard += 1) {
    const match = IMPLICIT_SPLIT_RE.exec(rest);
    if (match === null || match.index <= 0) break;
    parts.push(rest.slice(0, match.index).trim());
    rest = rest.slice(match.index + match[0].length).trim();
  }
  if (parts.length > 0) {
    parts.push(rest);
    return parts.filter((part) => part.length > 0);
  }
  return [text];
}

/**
 * "Zeile teilen": replaces one ingredient row by the rows contained in its text.
 * Unchanged (same array identity semantics: new object, same content) when the
 * line cannot be split.
 */
export function splitIngredient(draft: ParsedRecipe, index: number, splitAt?: number): ParsedRecipe {
  const current = draft.ingredients[index];
  if (current === undefined) return draft;
  const pieces = splitIngredientLine(ingredientToLine(current), splitAt);
  if (pieces.length < 2) return draft;
  const parsed = pieces.map((piece, offset) => ({
    ...parseIngredientLine(piece, index + offset),
    section: current.section ?? undefined,
  }));
  const next = [...draft.ingredients];
  next.splice(index, 1, ...parsed);
  return setIngredients(draft, next);
}

/** True when `splitIngredient` would change anything (used to disable the button). */
export function canSplitIngredient(ingredient: RecipeIngredient): boolean {
  return splitIngredientLine(ingredientToLine(ingredient)).length > 1;
}

/** "Zutat zu Schritt verschieben". */
export function ingredientToStep(draft: ParsedRecipe, index: number, atStep?: number): ParsedRecipe {
  const current = draft.ingredients[index];
  if (current === undefined) return draft;
  const text = ingredientToLine(current).trim();
  if (text.length === 0) return removeIngredient(draft, index);
  const steps = [...draft.steps];
  const at = atStep === undefined ? steps.length : Math.min(Math.max(atStep, 0), steps.length);
  steps.splice(at, 0, { position: at, section: current.section ?? undefined, text: text.slice(0, LIMITS.stepText) });
  return setSteps(removeIngredient(draft, index), steps);
}

/** "Schritt zu Zutat verschieben" — the inverse fixer. */
export function stepToIngredient(draft: ParsedRecipe, index: number, atIngredient?: number): ParsedRecipe {
  const current = draft.steps[index];
  if (current === undefined) return draft;
  const text = current.text.trim();
  if (text.length === 0) return removeStep(draft, index);
  const ingredients = [...draft.ingredients];
  const at = atIngredient === undefined ? ingredients.length : Math.min(Math.max(atIngredient, 0), ingredients.length);
  ingredients.splice(at, 0, {
    ...parseIngredientLine(text, at),
    section: current.section ?? undefined,
  });
  return setIngredients(removeStep(draft, index), ingredients);
}

/** "Zeile in Zutat umwandeln" — from the raw OCR text pane. */
export function appendIngredientFromLine(draft: ParsedRecipe, line: string): ParsedRecipe {
  const text = line.trim();
  if (text.length === 0) return draft;
  const position = draft.ingredients.length;
  return setIngredients(draft, [...draft.ingredients, parseIngredientLine(text, position)]);
}

/** "Zeile in Schritt umwandeln" — from the raw OCR text pane. */
export function appendStepFromLine(draft: ParsedRecipe, line: string): ParsedRecipe {
  const text = line.trim();
  if (text.length === 0) return draft;
  const position = draft.steps.length;
  return setSteps(draft, [...draft.steps, { position, text: text.slice(0, LIMITS.stepText) }]);
}

/** Bulk paste into the ingredient list (handles "Für den Teig:" headings). */
export function appendIngredientBlock(draft: ParsedRecipe, text: string): ParsedRecipe {
  const parsed = parseIngredientBlock(text);
  if (parsed.length === 0) return draft;
  return setIngredients(draft, [...draft.ingredients, ...parsed]);
}

/** Bulk paste into the step list. */
export function appendStepBlock(draft: ParsedRecipe, text: string): ParsedRecipe {
  const parsed = parseStepBlock(text);
  if (parsed.length === 0) return draft;
  return setSteps(draft, [...draft.steps, ...parsed]);
}

/**
 * Renames a section heading: applies to the consecutive run of rows that share
 * the section value of `index`, which is what the user sees as "one group".
 */
export function renameIngredientSection(draft: ParsedRecipe, index: number, name: string): ParsedRecipe {
  const current = draft.ingredients[index];
  if (current === undefined) return draft;
  const previous = current.section ?? undefined;
  const next = clip(name, LIMITS.section);
  const items = [...draft.ingredients];
  for (let i = index; i < items.length; i += 1) {
    const item = items[i]!;
    if ((item.section ?? undefined) !== previous) break;
    items[i] = { ...item, section: next };
  }
  return setIngredients(draft, items);
}

export function renameStepSection(draft: ParsedRecipe, index: number, name: string): ParsedRecipe {
  const current = draft.steps[index];
  if (current === undefined) return draft;
  const previous = current.section ?? undefined;
  const next = clip(name, LIMITS.section);
  const items = [...draft.steps];
  for (let i = index; i < items.length; i += 1) {
    const item = items[i]!;
    if ((item.section ?? undefined) !== previous) break;
    items[i] = { ...item, section: next };
  }
  return setSteps(draft, items);
}

/* -------------------------------------------------------------------------- */
/* step operations                                                             */
/* -------------------------------------------------------------------------- */

export function updateStep(draft: ParsedRecipe, index: number, patch: Partial<RecipeStep>): ParsedRecipe {
  const current = draft.steps[index];
  if (current === undefined) return draft;
  return setSteps(
    draft,
    draft.steps.map((item, i) => (i === index ? { ...item, ...patch } : item)),
  );
}

export function addStep(draft: ParsedRecipe, afterIndex?: number): ParsedRecipe {
  const at = afterIndex === undefined ? draft.steps.length : afterIndex + 1;
  const section = afterIndex === undefined ? undefined : draft.steps[afterIndex]?.section;
  const next = [...draft.steps];
  next.splice(at, 0, emptyStep(at, section ?? undefined));
  return setSteps(draft, next);
}

export function removeStep(draft: ParsedRecipe, index: number): ParsedRecipe {
  return setSteps(
    draft,
    draft.steps.filter((_item, i) => i !== index),
  );
}

export function moveStep(draft: ParsedRecipe, from: number, to: number): ParsedRecipe {
  return setSteps(draft, moveItem(draft.steps, from, to));
}

/** Splits one step into several (blank line first, then sentence boundaries). */
export function splitStepText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [trimmed];
  if (/\n\s*\n/.test(trimmed)) {
    return trimmed
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  const parsed = parseStepBlock(trimmed);
  if (parsed.length > 1) return parsed.map((step) => step.text);
  const sentences = trimmed
    .split(/(?<=[.!?])\s+(?=\p{Lu})/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return sentences.length > 1 ? sentences : [trimmed];
}

export function splitStep(draft: ParsedRecipe, index: number): ParsedRecipe {
  const current = draft.steps[index];
  if (current === undefined) return draft;
  const pieces = splitStepText(current.text);
  if (pieces.length < 2) return draft;
  const next = [...draft.steps];
  next.splice(
    index,
    1,
    ...pieces.map((text, offset) => ({
      position: index + offset,
      section: current.section ?? undefined,
      text: text.slice(0, LIMITS.stepText),
    })),
  );
  return setSteps(draft, next);
}

export function canSplitStep(step: RecipeStep): boolean {
  return splitStepText(step.text).length > 1;
}

/** "Alle Schritte neu aufteilen" — rebuilds the list from the joined text. */
export function reparseAllSteps(draft: ParsedRecipe): ParsedRecipe {
  const joined = draft.steps.map((step) => step.text.trim()).filter((text) => text.length > 0).join("\n\n");
  if (joined.length === 0) return draft;
  const parsed = parseStepBlock(joined);
  if (parsed.length === 0) return draft;
  return setSteps(draft, parsed);
}

/* -------------------------------------------------------------------------- */
/* tags                                                                        */
/* -------------------------------------------------------------------------- */

export function addTag(draft: ParsedRecipe, name: string): ParsedRecipe {
  const tag = name.trim().slice(0, LIMITS.tagName);
  if (tag.length === 0) return draft;
  // foldText, not toLowerCase: the server keys tags by the folded name, so "Kase"
  // and "Käse" are one tag there and must be one here too (see TagCombobox.sameName).
  const exists = draft.tags.some((existing) => foldText(existing) === foldText(tag));
  if (exists || draft.tags.length >= LIMITS.maxTags) return draft;
  return { ...draft, tags: [...draft.tags, tag] };
}

export function removeTag(draft: ParsedRecipe, name: string): ParsedRecipe {
  return { ...draft, tags: draft.tags.filter((tag) => tag !== name) };
}

/* -------------------------------------------------------------------------- */
/* raw text -> draft                                                           */
/* -------------------------------------------------------------------------- */

const INGREDIENT_HEADING_RE = /^\s*(zutaten|ingredients|einkaufsliste)\b.*$/iu;
const STEP_HEADING_RE = /^\s*(zubereitung|anleitung|und so geht'?s|so geht'?s|preparation|instructions|method|schritte)\b.*$/iu;

export interface RawTextSections {
  title?: string;
  ingredientsText: string;
  stepsText: string;
}

/**
 * Splits a raw OCR / text-layer blob into a title, an ingredient block and a
 * step block using the usual German headings. Without headings everything goes
 * into the ingredient block (the user then moves lines with the bulk fixers).
 */
export function splitRawTextSections(rawText: string): RawTextSections {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  const ingredients: string[] = [];
  const steps: string[] = [];
  const head: string[] = [];
  let mode: "head" | "ingredients" | "steps" = "head";

  for (const line of lines) {
    if (INGREDIENT_HEADING_RE.test(line)) {
      mode = "ingredients";
      continue;
    }
    if (STEP_HEADING_RE.test(line)) {
      mode = "steps";
      continue;
    }
    if (mode === "head") head.push(line);
    else if (mode === "ingredients") ingredients.push(line);
    else steps.push(line);
  }

  const title = head.map((line) => line.trim()).find((line) => line.length >= 3);
  if (ingredients.length === 0 && steps.length === 0) {
    return { title, ingredientsText: head.slice(1).join("\n"), stepsText: "" };
  }
  return { title, ingredientsText: ingredients.join("\n"), stepsText: steps.join("\n") };
}

/**
 * "Alles aus dem Rohtext neu erkennen". Keeps title/servings/times the user may
 * already have corrected unless the raw text clearly offers a title.
 */
export function reparseFromRawText(draft: ParsedRecipe, rawText: string): ParsedRecipe {
  const sections = splitRawTextSections(rawText);
  const ingredients = parseIngredientBlock(sections.ingredientsText);
  const steps = parseStepBlock(sections.stepsText);
  const next: ParsedRecipe = {
    ...draft,
    title: clip(draft.title, LIMITS.title) ?? clip(sections.title, LIMITS.title),
  };
  return setSteps(setIngredients(next, ingredients), steps);
}

/* -------------------------------------------------------------------------- */
/* normalisation for PATCH / commit                                            */
/* -------------------------------------------------------------------------- */

function normalizeConfidence(confidence: ParsedRecipeConfidence | undefined): ParsedRecipeConfidence {
  const overall = clamp01(confidence?.overall) ?? 0;
  const out: ParsedRecipeConfidence = { overall };
  const keys = ["title", "description", "ingredients", "steps", "servings", "times", "image"] as const;
  for (const key of keys) {
    const value = clamp01(confidence?.[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function normalizeIngredient(ingredient: RecipeIngredient, position: number): RecipeIngredient | undefined {
  const rawText = clip(ingredient.raw, LIMITS.raw);
  const name =
    clip(ingredient.name, LIMITS.ingredientName) ??
    clip(rawText, LIMITS.ingredientName) ??
    undefined;
  if (name === undefined) return undefined;
  const quantity = clampNumber(ingredient.quantity, 1_000_000);
  const quantityMaxRaw = clampNumber(ingredient.quantityMax, 1_000_000);
  const quantityMax =
    quantityMaxRaw !== undefined && quantity !== undefined && quantityMaxRaw > quantity ? quantityMaxRaw : undefined;
  return {
    position,
    section: clip(ingredient.section, LIMITS.section),
    quantity,
    quantityMax,
    unit: clip(ingredient.unit, LIMITS.unit),
    name,
    note: clip(ingredient.note, LIMITS.ingredientNote),
    raw: (rawText ?? formatIngredient({ ...ingredient, name }, formatQuantity)).slice(0, LIMITS.raw),
  };
}

/**
 * Makes an edited draft safe to send: clips every string to its schema limit,
 * drops empty rows, re-indexes positions and repairs the confidence object.
 * Idempotent.
 */
export function normalizeParsedRecipe(draft: ParsedRecipe): ParsedRecipe {
  const ingredients: RecipeIngredient[] = [];
  for (const ingredient of draft.ingredients.slice(0, LIMITS.maxIngredients)) {
    const normalized = normalizeIngredient(ingredient, ingredients.length);
    if (normalized !== undefined) ingredients.push(normalized);
  }

  const steps: RecipeStep[] = [];
  for (const step of draft.steps.slice(0, LIMITS.maxSteps)) {
    const text = clip(step.text, LIMITS.stepText);
    if (text === undefined) continue;
    steps.push({ position: steps.length, section: clip(step.section, LIMITS.section), text });
  }

  const tags: string[] = [];
  for (const tag of draft.tags) {
    const name = clip(tag, LIMITS.tagName);
    if (name === undefined) continue;
    if (tags.some((existing) => foldText(existing) === foldText(name))) continue;
    if (tags.length >= LIMITS.maxTags) break;
    tags.push(name);
  }

  const servingsAmount = clampNumber(draft.servings?.amount, 1000);
  const servingsUnit = clip(draft.servings?.unit, LIMITS.servingsUnit);
  const servings =
    servingsAmount !== undefined && servingsAmount > 0
      ? { amount: servingsAmount, unit: servingsUnit ?? translate("common.servings.defaultUnit") }
      : undefined;

  const difficulty = DIFFICULTIES.find((value) => value === draft.difficulty);

  return {
    title: clip(draft.title, LIMITS.title),
    description: clip(draft.description, LIMITS.description),
    imageUrl: clip(draft.imageUrl, LIMITS.imageUrl),
    sourceUrl: clip(draft.sourceUrl, LIMITS.sourceUrl),
    sourceName: clip(draft.sourceName, LIMITS.sourceName),
    servings,
    prepMinutes: clampMinutes(draft.prepMinutes),
    cookMinutes: clampMinutes(draft.cookMinutes),
    totalMinutes: clampMinutes(draft.totalMinutes),
    difficulty,
    ingredients,
    steps,
    tags,
    notes: clip(draft.notes, LIMITS.notes),
    language: clip(draft.language, LIMITS.language) ?? "de",
    confidence: normalizeConfidence(draft.confidence),
  };
}

/** Cheap structural comparison used to decide whether an autosave is needed. */
export function isSameParsedRecipe(a: ParsedRecipe, b: ParsedRecipe): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Blocking validation for "Speichern": only a title is truly required. */
export interface DraftValidation {
  ok: boolean;
  /** User-facing. */
  problems: string[];
  /** Non-blocking remarks shown next to the save button. */
  warnings: string[];
}

export function validateForCommit(draft: ParsedRecipe): DraftValidation {
  const normalized = normalizeParsedRecipe(draft);
  const problems: string[] = [];
  const warnings: string[] = [];
  if (normalized.title === undefined) problems.push(translate("recipe.import.draftEdit.needTitle"));
  if (normalized.ingredients.length === 0) warnings.push(translate("recipe.import.draftEdit.noIngredients"));
  if (normalized.steps.length === 0) warnings.push(translate("recipe.import.draftEdit.noSteps"));
  return { ok: problems.length === 0, problems, warnings };
}
