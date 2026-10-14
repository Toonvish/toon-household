/**
 * Editable form state for the recipe form.
 *
 * Rows carry a client-side `key` so React never re-mounts an input while the user is
 * typing (positions change on every reorder, so they cannot be keys). Everything is
 * stored as STRINGS while editing — an empty numeric field must stay empty instead of
 * snapping to 0 — and converted once on submit.
 */
import type {
  CreateRecipeRequest,
  Difficulty,
  RecipeDetail,
  RecipeIngredient,
  RecipeIngredientInput,
  RecipeStep,
  RecipeStepInput,
} from "@toon/shared";
import {
  formatQuantity,
  parseIngredientBlock,
  parseNumberToken,
  parseStepBlock,
} from "@toon/shared";
import { translate } from "@/lib/i18n";
import { localId } from "./hooks";

export interface IngredientRow {
  key: string;
  section: string;
  /** Free text so "1 1/2" and "1,5" both survive round-trips. */
  quantity: string;
  quantityMax: string;
  unit: string;
  name: string;
  note: string;
  /** Original source line, preserved for imported recipes (provenance). */
  raw: string;
}

export interface StepRow {
  key: string;
  section: string;
  text: string;
}

export interface RecipeFormValues {
  title: string;
  description: string;
  imageUrl: string;
  sourceUrl: string;
  sourceName: string;
  servingsAmount: string;
  servingsUnit: string;
  prepMinutes: string;
  cookMinutes: string;
  totalMinutes: string;
  difficulty: Difficulty | "";
  rating: string;
  notes: string;
  ingredients: IngredientRow[];
  steps: StepRow[];
  /** Tag NAMES — the API creates unknown ones inside the household. */
  tags: string[];
  collectionIds: string[];
}

export function emptyIngredientRow(section = ""): IngredientRow {
  return {
    key: localId(),
    section,
    quantity: "",
    quantityMax: "",
    unit: "",
    name: "",
    note: "",
    raw: "",
  };
}

export function emptyStepRow(section = ""): StepRow {
  return { key: localId(), section, text: "" };
}

/**
 * Blank form for RecipeNewPage. `servingsUnit` seeds the field with the ambient
 * locale's word for "servings" — UI copy at the moment it is produced, plain
 * content afterwards once the user edits or saves it (docs/i18n.md §0's
 * borderline rule), so this reads the CURRENT locale via `translate()` rather
 * than a hook (this is a plain function, not a component).
 */
export function emptyRecipeForm(): RecipeFormValues {
  return {
    title: "",
    description: "",
    imageUrl: "",
    sourceUrl: "",
    sourceName: "",
    servingsAmount: "4",
    servingsUnit: translate("common.servings.defaultUnit"),
    prepMinutes: "",
    cookMinutes: "",
    totalMinutes: "",
    difficulty: "",
    rating: "",
    notes: "",
    ingredients: [emptyIngredientRow()],
    steps: [emptyStepRow()],
    tags: [],
    collectionIds: [],
  };
}

function numberToInput(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  // Fractions read better than 0.5 in an editable field.
  return formatQuantity(value);
}

function intToInput(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : "";
}

/** Fills the form from a loaded recipe (RecipeEditPage). */
export function recipeToForm(recipe: RecipeDetail): RecipeFormValues {
  return {
    title: recipe.title,
    description: recipe.description ?? "",
    imageUrl: recipe.imageUrl ?? "",
    sourceUrl: recipe.sourceUrl ?? "",
    sourceName: recipe.sourceName ?? "",
    servingsAmount: numberToInput(recipe.servingsAmount),
    servingsUnit: recipe.servingsUnit ?? "",
    prepMinutes: intToInput(recipe.prepMinutes),
    cookMinutes: intToInput(recipe.cookMinutes),
    totalMinutes: intToInput(recipe.totalMinutes),
    difficulty: recipe.difficulty ?? "",
    rating: intToInput(recipe.rating),
    notes: recipe.notes ?? "",
    // Same mappers as the paste path, but keyed by the PERSISTED row id instead of
    // a fresh local one — React must not remount a field while it is being typed in.
    ingredients:
      recipe.ingredients.length > 0
        ? recipe.ingredients.map((ingredient) => ({ ...ingredientToRow(ingredient), key: ingredient.id }))
        : [emptyIngredientRow()],
    steps:
      recipe.steps.length > 0
        ? recipe.steps.map((step) => ({ ...stepToRow(step), key: step.id }))
        : [emptyStepRow()],
    tags: recipe.tags.map((tag) => tag.name),
    collectionIds: [...recipe.collectionIds],
  };
}

/**
 * Parses an editable amount field ("1 1/2", "1,5", "½", "1½") into a number.
 * Uses the shared `parseNumberToken` so the browser accepts exactly what the API does.
 */
export function parseAmountInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = parseNumberToken(trimmed);
  return typeof parsed === "number" && parsed >= 0 ? parsed : undefined;
}

function parseIntInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number.parseInt(trimmed.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Rows that carry no name/text at all are dropped silently. */
export function ingredientRowsToInput(rows: readonly IngredientRow[]): RecipeIngredientInput[] {
  const out: RecipeIngredientInput[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (name.length === 0) continue;
    const quantity = parseAmountInput(row.quantity);
    const quantityMax = parseAmountInput(row.quantityMax);
    out.push({
      position: out.length,
      section: nullable(row.section),
      quantity: quantity ?? null,
      quantityMax: quantityMax !== undefined && quantityMax > (quantity ?? 0) ? quantityMax : null,
      unit: nullable(row.unit),
      name,
      note: nullable(row.note),
      // Keep the imported source line; otherwise reconstruct something readable.
      raw: row.raw.trim().length > 0 ? row.raw.trim() : rowToRawLine(row, quantity, quantityMax),
    });
  }
  return out;
}

function rowToRawLine(
  row: IngredientRow,
  quantity: number | undefined,
  quantityMax: number | undefined,
): string {
  const amount =
    quantity === undefined
      ? ""
      : quantityMax !== undefined && quantityMax > quantity
        ? `${formatQuantity(quantity)}-${formatQuantity(quantityMax)}`
        : formatQuantity(quantity);
  const line = [amount, row.unit.trim(), row.name.trim()].filter((part) => part.length > 0).join(" ");
  const note = row.note.trim();
  return (note.length > 0 ? `${line} (${note})` : line).slice(0, 500);
}

export function stepRowsToInput(rows: readonly StepRow[]): RecipeStepInput[] {
  const out: RecipeStepInput[] = [];
  for (const row of rows) {
    const text = row.text.trim();
    if (text.length === 0) continue;
    out.push({ position: out.length, section: nullable(row.section), text });
  }
  return out;
}

/**
 * Form -> `CreateRecipeRequest`. Also valid as an `UpdateRecipeRequest` because the
 * update schema is the partial of the create schema and child arrays are replace-all.
 */
export function formToRequest(values: RecipeFormValues): CreateRecipeRequest {
  return {
    title: values.title.trim(),
    description: nullable(values.description),
    imageUrl: nullable(values.imageUrl),
    sourceUrl: nullable(values.sourceUrl),
    sourceName: nullable(values.sourceName),
    servingsAmount: parseAmountInput(values.servingsAmount) ?? null,
    servingsUnit: nullable(values.servingsUnit),
    prepMinutes: parseIntInput(values.prepMinutes) ?? null,
    cookMinutes: parseIntInput(values.cookMinutes) ?? null,
    totalMinutes: parseIntInput(values.totalMinutes) ?? null,
    difficulty: values.difficulty === "" ? null : values.difficulty,
    rating: parseIntInput(values.rating) ?? null,
    notes: nullable(values.notes),
    language: "de",
    ingredients: ingredientRowsToInput(values.ingredients),
    steps: stepRowsToInput(values.steps),
    tags: values.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    collectionIds: [...values.collectionIds],
  };
}

/** Ingredient rows parsed from a pasted block (one line per ingredient). */
export function rowsFromPastedIngredients(text: string): IngredientRow[] {
  return parseIngredientBlock(text).map((ingredient) => ingredientToRow(ingredient));
}

export function ingredientToRow(ingredient: RecipeIngredient): IngredientRow {
  return {
    key: localId(),
    section: ingredient.section ?? "",
    quantity: numberToInput(ingredient.quantity),
    quantityMax: numberToInput(ingredient.quantityMax),
    unit: ingredient.unit ?? "",
    name: ingredient.name,
    note: ingredient.note ?? "",
    raw: ingredient.raw,
  };
}

/** Step rows parsed from a pasted preparation block. */
export function rowsFromPastedSteps(text: string): StepRow[] {
  return parseStepBlock(text).map((step) => stepToRow(step));
}

export function stepToRow(step: RecipeStep): StepRow {
  return { key: localId(), section: step.section ?? "", text: step.text };
}

/** Sum of prep + cook, used to prefill "Total" when the user leaves it empty. */
export function derivedTotalMinutes(values: RecipeFormValues): number | undefined {
  const prep = parseIntInput(values.prepMinutes);
  const cook = parseIntInput(values.cookMinutes);
  if (prep === undefined && cook === undefined) return undefined;
  return (prep ?? 0) + (cook ?? 0);
}

/** Cheap dirty check for the unsaved-changes guard. */
export function isSameForm(a: RecipeFormValues, b: RecipeFormValues): boolean {
  return JSON.stringify(stripKeys(a)) === JSON.stringify(stripKeys(b));
}

function stripKeys(values: RecipeFormValues) {
  return {
    ...values,
    ingredients: values.ingredients.map(({ key: _key, ...rest }) => rest),
    steps: values.steps.map(({ key: _key, ...rest }) => rest),
  };
}
