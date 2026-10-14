/**
 * Turns the draft's per-field confidence plus a few OCR heuristics into
 * "bitte prüfen" hints. Pure and DOM-free so it can be unit tested.
 *
 * Rule: this NEVER blocks saving. It only decides where to draw attention.
 */
import { isKnownUnit, type ParsedRecipe, type ParsedRecipeConfidence, type RecipeIngredient, type RecipeStep } from "@toon/shared";
import { translate } from "@/lib/i18n";

/** Below this the review screen shows the "bitte prüfen" banner. */
export const CONFIDENCE_WARN = 0.5;
/** At or above this a value is treated as trustworthy. */
export const CONFIDENCE_GOOD = 0.75;

export type ConfidenceLevel = "unknown" | "low" | "medium" | "high";

export function confidenceLevel(value: number | null | undefined): ConfidenceLevel {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  if (value < CONFIDENCE_WARN) return "low";
  if (value < CONFIDENCE_GOOD) return "medium";
  return "high";
}

export type ConfidenceField = keyof Omit<ParsedRecipeConfidence, "overall">;

/**
 * Label for the "bitte prüfen" hint text. `field` is a domain value (locked);
 * only the label is resolved at render/call time so a locale switch is picked
 * up (docs/i18n.md §10 rule 8) — never freeze this into a module-level map.
 */
export function fieldLabel(field: ConfidenceField): string {
  switch (field) {
    case "title":
      return translate("recipe.import.confidence.field.title");
    case "description":
      return translate("recipe.import.confidence.field.description");
    case "ingredients":
      return translate("recipe.import.confidence.field.ingredients");
    case "steps":
      return translate("recipe.import.confidence.field.steps");
    case "servings":
      return translate("recipe.import.confidence.field.servings");
    case "times":
      return translate("recipe.import.confidence.field.times");
    case "image":
      return translate("recipe.import.confidence.field.image");
    default:
      return field;
  }
}

export function fieldConfidence(draft: ParsedRecipe, field: ConfidenceField): number | undefined {
  return draft.confidence[field];
}

/** True when a field should carry a visible "bitte prüfen" marker. */
export function fieldNeedsCheck(draft: ParsedRecipe, field: ConfidenceField): boolean {
  const value = draft.confidence[field];
  if (typeof value === "number") return value < CONFIDENCE_GOOD;
  // No opinion from the parser: flag empty values that a recipe really wants.
  switch (field) {
    case "title":
      return (draft.title ?? "").trim().length === 0;
    case "servings":
      return draft.servings === undefined;
    case "times":
      return draft.prepMinutes === undefined && draft.cookMinutes === undefined && draft.totalMinutes === undefined;
    case "ingredients":
      return draft.ingredients.length === 0;
    case "steps":
      return draft.steps.length === 0;
    default:
      return false;
  }
}

/** Characters tesseract loves to invent. */
const OCR_NOISE_RE = /[|¦~°¬<>«»■□▪@#§¤]/u;
const LETTER_RE = /\p{L}/u;

export interface RowCheck {
  needsCheck: boolean;
  /**
   * Short reasons, already rendered in the active interface locale (they come
   * from `translate()`, not from a raw literal), shown as a tooltip / hint
   * under the row.
   */
  reasons: string[];
}

const OK: RowCheck = { needsCheck: false, reasons: [] };

/**
 * Row-level heuristics for an ingredient. Deliberately conservative: we only
 * flag things a human can fix in a second.
 */
export function ingredientCheck(ingredient: RecipeIngredient, listConfidence?: number): RowCheck {
  const reasons: string[] = [];
  const name = (ingredient.name ?? "").trim();
  const raw = (ingredient.raw ?? "").trim();

  if (name.length === 0) reasons.push(translate("recipe.import.confidence.reason.noName"));
  else if (name.length < 2) reasons.push(translate("recipe.import.confidence.reason.shortName"));
  if (!LETTER_RE.test(name) && name.length > 0) reasons.push(translate("recipe.import.confidence.reason.noLetters"));
  if (OCR_NOISE_RE.test(name)) reasons.push(translate("recipe.import.confidence.reason.strangeChars"));
  if (typeof ingredient.unit === "string" && ingredient.unit.trim().length > 0 && !isKnownUnit(ingredient.unit)) {
    reasons.push(translate("recipe.import.confidence.reason.unknownUnit", { unit: ingredient.unit }));
  }
  if (ingredient.quantity === null || ingredient.quantity === undefined) {
    if (/\d/.test(raw)) reasons.push(translate("recipe.import.confidence.reason.numberNoQuantity"));
  } else if (ingredient.quantity > 5000 && (ingredient.unit === undefined || ingredient.unit === null)) {
    reasons.push(translate("recipe.import.confidence.reason.largeQuantityNoUnit"));
  }
  if (name.length > 90) reasons.push(translate("recipe.import.confidence.reason.mergedLine"));
  if (/\d\s*(g|kg|ml|l)\b/i.test(name)) reasons.push(translate("recipe.import.confidence.reason.quantityInName"));

  if (reasons.length === 0 && typeof listConfidence === "number" && listConfidence < CONFIDENCE_WARN) {
    return { needsCheck: true, reasons: [translate("recipe.import.confidence.reason.listUncertainIngredients")] };
  }
  return reasons.length === 0 ? OK : { needsCheck: true, reasons };
}

export function stepCheck(step: RecipeStep, listConfidence?: number): RowCheck {
  const reasons: string[] = [];
  const text = step.text.trim();
  if (text.length === 0) reasons.push(translate("recipe.import.confidence.reason.emptyStep"));
  else if (text.length < 12) reasons.push(translate("recipe.import.confidence.reason.shortStep"));
  if (OCR_NOISE_RE.test(text)) reasons.push(translate("recipe.import.confidence.reason.strangeCharsStep"));
  if (text.length > 1200) reasons.push(translate("recipe.import.confidence.reason.longStep"));
  if (reasons.length === 0 && typeof listConfidence === "number" && listConfidence < CONFIDENCE_WARN) {
    return { needsCheck: true, reasons: [translate("recipe.import.confidence.reason.listUncertainSteps")] };
  }
  return reasons.length === 0 ? OK : { needsCheck: true, reasons };
}

/** Count of rows that want a look — drives the "n Zeilen prüfen" summary. */
export function countRowsNeedingCheck(draft: ParsedRecipe): { ingredients: number; steps: number } {
  const ingredientConfidence = draft.confidence.ingredients;
  const stepConfidence = draft.confidence.steps;
  return {
    ingredients: draft.ingredients.filter((item) => ingredientCheck(item, ingredientConfidence).needsCheck).length,
    steps: draft.steps.filter((item) => stepCheck(item, stepConfidence).needsCheck).length,
  };
}

/** Percent string for the UI, e.g. 0.62 -> "62 %". */
export function formatConfidence(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return translate("recipe.import.confidence.unknown");
  return `${Math.round(value * 100)} %`;
}
