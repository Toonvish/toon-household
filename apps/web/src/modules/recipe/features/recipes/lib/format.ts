/**
 * Recipe-specific presentation helpers.
 *
 * Generic formatting (dates, durations, servings, initials, host, tag contrast) lives in
 * `@/lib/format` — this module only adds what is specific to ingredients and steps.
 * Amounts always go through `formatQuantity` from @toon/shared so the UI shows
 * "1½" / "¾" instead of 1.5 / 0.75.
 */
import type { RecipeIngredient, RecipeStep } from "@toon/shared";
import { formatQuantity } from "@toon/shared";
import { formatMinutes, formatServingsLabel } from "@/modules/recipe/lib/format";
import { translate, type MessageKey } from "@/lib/i18n";

/** "1½" / "2–3" / "" — the amount column of an ingredient row. */
export function formatAmount(
  quantity: number | null | undefined,
  quantityMax?: number | null,
): string {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return "";
  const low = formatQuantity(quantity);
  if (typeof quantityMax === "number" && Number.isFinite(quantityMax) && quantityMax > quantity) {
    return `${low}–${formatQuantity(quantityMax)}`;
  }
  return low;
}

/** "250 g" — amount plus unit, already spaced. Empty when the line has no amount. */
export function formatAmountWithUnit(ingredient: RecipeIngredient): string {
  const amount = formatAmount(ingredient.quantity, ingredient.quantityMax);
  const unit = typeof ingredient.unit === "string" ? ingredient.unit.trim() : "";
  return [amount, unit].filter((part) => part.length > 0).join(" ");
}

/** Full display line, e.g. "250 g Mehl (gesiebt)". */
export function formatIngredientLine(ingredient: RecipeIngredient): string {
  const head = formatAmountWithUnit(ingredient);
  const line = [head, ingredient.name].filter((part) => part.length > 0).join(" ");
  return ingredient.note ? `${line} (${ingredient.note})` : line;
}

/**
 * Like `formatMinutes` from @/lib/format but returns "" instead of "–" for missing
 * values, so a card can drop the whole row.
 */
export function optionalMinutes(minutes: number | null | undefined): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return "";
  return formatMinutes(minutes);
}

/** "4 Portionen" / "" for missing values. */
export function optionalServings(
  amount: number | null | undefined,
  unit?: string | null,
): string {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return "";
  return formatServingsLabel(amount, unit ?? null);
}

/**
 * `RecipeSort` -> catalog key (rule 8: the enum value is locked, only the
 * label moves). Resolved at render time with `useT()`, never module-level —
 * see docs/i18n.md §10 rule 8.
 */
export const SORT_LABELS = {
  newest: "recipe.recipes.sort.newest",
  oldest: "recipe.recipes.sort.oldest",
  title: "recipe.recipes.sort.title",
  rating: "recipe.recipes.sort.rating",
  time: "recipe.recipes.sort.time",
  lastCooked: "recipe.recipes.sort.lastCooked",
} as const satisfies Record<string, MessageKey>;

export interface Sectioned<T> {
  section: string | null;
  items: T[];
}

/**
 * Groups ingredients/steps by their `section`, preserving array order and keeping
 * unlabelled rows in a leading `section: null` bucket.
 */
export function groupBySection<T extends { section?: string | null }>(
  rows: readonly T[],
): Sectioned<T>[] {
  const out: Sectioned<T>[] = [];
  for (const row of rows) {
    const section =
      typeof row.section === "string" && row.section.trim().length > 0 ? row.section.trim() : null;
    const last = out[out.length - 1];
    if (last && last.section === section) last.items.push(row);
    else out.push({ section, items: [row] });
  }
  return out;
}

/** Distinct section names in order of appearance — feeds the editors' datalist. */
export function sectionNames(rows: readonly { section?: string | null }[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const section = typeof row.section === "string" ? row.section.trim() : "";
    if (section.length > 0) seen.add(section);
  }
  return [...seen];
}

/**
 * Plain-text rendering of a whole recipe — used by share and the clipboard fallback.
 * Called from event handlers, not rendered continuously, so the ambient `translate()`
 * is the right tool here (see docs/i18n.md §7/§10 rule 6): a component body must use
 * `useT()` instead.
 */
export function recipeToPlainText(input: {
  title: string;
  description?: string | null;
  servingsAmount?: number | null;
  servingsUnit?: string | null;
  totalMinutes?: number | null;
  ingredients: readonly RecipeIngredient[];
  steps: readonly RecipeStep[];
  notes?: string | null;
  sourceUrl?: string | null;
}): string {
  const lines: string[] = [input.title, ""];
  if (input.description) lines.push(input.description, "");

  const servings = optionalServings(input.servingsAmount, input.servingsUnit);
  const total = optionalMinutes(input.totalMinutes);
  if (servings) lines.push(servings);
  if (total) lines.push(translate("recipe.recipes.plainText.totalTime", { time: total }));
  if (servings || total) lines.push("");

  lines.push(translate("recipe.recipes.plainText.ingredientsHeading"));
  for (const group of groupBySection(input.ingredients)) {
    if (group.section) lines.push(`  ${group.section}:`);
    for (const ingredient of group.items) lines.push(`  - ${formatIngredientLine(ingredient)}`);
  }

  lines.push("", translate("recipe.recipes.plainText.stepsHeading"));
  let index = 1;
  for (const group of groupBySection(input.steps)) {
    if (group.section) lines.push(`  ${group.section}:`);
    for (const step of group.items) {
      lines.push(`  ${index}. ${step.text}`);
      index += 1;
    }
  }

  if (input.notes) lines.push("", translate("recipe.recipes.plainText.notesHeading"), input.notes);
  if (input.sourceUrl) {
    lines.push("", translate("recipe.recipes.plainText.sourceLine", { url: input.sourceUrl }));
  }
  return lines.join("\n");
}
