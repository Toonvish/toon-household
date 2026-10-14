/**
 * Shopping-list algebra. Pure, German-first, no I/O.
 *
 * The API and the web app both merge lines with the functions here, so an optimistic
 * offline edit and the eventual server response agree instead of flickering.
 *
 * ## The merge rule, which is the whole design
 *
 * An item is identified by `(nameKey(name), merge bucket of unit)`. Two lines merge
 * into one when their names fold to the same key AND their units can be added
 * ({@link areUnitsCompatible}):
 *
 *   200 g Mehl  +  200 g Mehl   -> 400 g Mehl        (same unit)
 *   1 kg Mehl   +  200 g Mehl   -> 1.2 kg Mehl       (converted, nicest unit wins)
 *   200 g Mehl  +  2 EL Mehl    -> two lines         (EL has no fixed mass)
 *   3 Eier      +  2 Eier       -> 5 Eier            (both unitless)
 *   200 g Mehl  +  Mehl         -> two lines         (see below)
 *
 * That last one is deliberate. "Mehl" with no amount means "buy flour, I'll judge how
 * much"; folding it into "200 g" would silently invent a quantity, and folding "200 g"
 * into it would silently lose one. Both survive as separate lines.
 *
 * A line whose quantity is unknown (`null`) is NOT the same as `0`: it renders with no
 * amount at all, and adding it to another unknown stays unknown.
 */
import { roundQuantity } from "./numbers.ts";
import { foldText, nameKey } from "../../core/text.ts";
import {
  NON_SCALING_UNITS,
  areUnitsCompatible,
  convertUnit,
  normalizeUnit,
  preferredDisplayUnit,
} from "./units.ts";
import type { RecipeIngredient } from "./schemas/recipe.ts";

/** The amount half of a shopping line. `quantity: null` means "no amount given". */
export interface ShoppingAmount {
  quantity: number | null;
  unit: string | null;
}

/** A shopping line before it has an id — what a merge produces and an API accepts. */
export interface ShoppingDraftItem extends ShoppingAmount {
  name: string;
  note: string | null;
  /** Recipe ids this line came from, oldest first. Empty for a hand-typed item. */
  sourceRecipeIds: string[];
}

/* -------------------------------------------------------------------------- */
/* keys                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Bucket that decides which lines are ALLOWED to merge, stored alongside the item so
 * a UNIQUE index can enforce it.
 *
 * Convertible units collapse to their kind (`"mass"`), so `g` and `kg` land in the
 * same bucket. Everything else buckets by its own canonical token, and a missing unit
 * gets its own bucket `""`.
 */
export function unitBucket(unit: string | null | undefined): string {
  if (!unit || unit.trim().length === 0) return "";
  const canonical = normalizeUnit(unit);
  // Same-kind convertibility is transitive within mass/volume/length, so any member
  // of the kind is a stable bucket name. Probe the three base units.
  for (const base of ["g", "ml", "mm"] as const) {
    if (convertUnit(1, canonical, base) !== undefined) return `kind:${base}`;
  }
  return `unit:${canonical}`;
}

/**
 * Separator inside a merge key: a UNIT SEPARATOR control char, not a space.
 *
 * `nameKey` output can contain spaces, so with a space separator the item named
 * "Tomaten kind:g" with no unit and the item "Tomaten" measured in grams would
 * produce keys differing only in trailing whitespace — and the UNIQUE index on
 * `merge_key` would then merge two unrelated lines.
 */
const KEY_SEPARATOR = "\u001f";

/**
 * Merge key of a line: same key => the two lines are one shopping item.
 * Stored in `shopping_list_items.merge_key`, whose UNIQUE index does the merging.
 */
export function shoppingItemKey(name: string, unit: string | null | undefined): string {
  return `${nameKey(name)}${KEY_SEPARATOR}${unitBucket(unit)}`;
}

/* -------------------------------------------------------------------------- */
/* addition                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Adds two compatible amounts, choosing the nicest display unit for the sum.
 * Returns undefined when the units cannot be added at all — callers must then keep
 * the lines separate rather than dropping one.
 *
 * An unknown quantity is absorbing on the unit side only: `null + 200 g` is not
 * reachable (incompatible units by {@link areUnitsCompatible}), but `null + null`
 * for the same unit stays `null`.
 */
export function addAmounts(a: ShoppingAmount, b: ShoppingAmount): ShoppingAmount | undefined {
  if (!areUnitsCompatible(a.unit, b.unit)) return undefined;

  const unit = a.unit ?? b.unit ?? null;

  if (a.quantity === null && b.quantity === null) return { quantity: null, unit };
  // One side has no amount: the sum is the side that does. Not reachable through
  // areUnitsCompatible when the units differ, but valid for a unitless pair.
  if (a.quantity === null) return { quantity: b.quantity, unit: b.unit ?? unit };
  if (b.quantity === null) return { quantity: a.quantity, unit: a.unit ?? unit };

  if (unit === null) return { quantity: roundQuantity(a.quantity + b.quantity), unit: null };

  // Sum in A's unit, then re-pick the display unit so 1 kg + 200 g reads "1.2 kg".
  const bInA = convertUnit(b.quantity, b.unit ?? unit, a.unit ?? unit);
  if (bInA === undefined) return undefined;
  const nice = preferredDisplayUnit(a.quantity + bInA, a.unit ?? unit);
  return { quantity: roundQuantity(nice.quantity), unit: nice.unit };
}

/**
 * Folds `additions` into `existing`, merging anything that shares a key and
 * appending the rest. Neither input is mutated.
 *
 * Order is stable: merged lines keep the position they already had, genuinely new
 * lines are appended in the order they arrived. That is what makes an optimistic
 * client-side merge look identical to the server's answer.
 */
export function mergeShoppingItems<T extends ShoppingDraftItem>(
  existing: readonly T[],
  additions: readonly ShoppingDraftItem[],
): Array<T | ShoppingDraftItem> {
  const out: Array<T | ShoppingDraftItem> = [...existing];
  const indexByKey = new Map<string, number>();
  out.forEach((item, index) => {
    const key = shoppingItemKey(item.name, item.unit);
    if (!indexByKey.has(key)) indexByKey.set(key, index);
  });

  for (const addition of additions) {
    const key = shoppingItemKey(addition.name, addition.unit);
    const at = indexByKey.get(key);
    if (at === undefined) {
      indexByKey.set(key, out.length);
      out.push({ ...addition, sourceRecipeIds: [...addition.sourceRecipeIds] });
      continue;
    }
    const current = out[at]!;
    const summed = addAmounts(current, addition);
    if (!summed) {
      // Same key but unaddable amounts should be impossible (the key contains the
      // unit bucket). Fail safe by keeping both lines rather than losing one.
      out.push({ ...addition, sourceRecipeIds: [...addition.sourceRecipeIds] });
      continue;
    }
    out[at] = {
      ...current,
      quantity: summed.quantity,
      unit: summed.unit,
      note: mergeNotes(current.note, addition.note),
      sourceRecipeIds: mergeSourceIds(current.sourceRecipeIds, addition.sourceRecipeIds),
    };
  }
  return out;
}

/** Keeps both notes, de-duplicated, so "gesiebt" is not silently dropped. */
export function mergeNotes(a: string | null, b: string | null): string | null {
  const parts = [a, b]
    .flatMap((value) => (value ? value.split(",") : []))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const seen = new Set<string>();
  const unique = parts.filter((part) => {
    const key = nameKey(part);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) return null;
  return unique.join(", ").slice(0, 300);
}

/** Union of two provenance lists, order-stable, capped. */
export function mergeSourceIds(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].slice(0, MAX_SOURCE_RECIPES);
}

/** How many contributing recipes one item remembers. */
export const MAX_SOURCE_RECIPES = 12;

/* -------------------------------------------------------------------------- */
/* recipe -> shopping lines                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Section headings never reach the shopping list: "Für den Teig" is a cooking
 * concern, and keeping it would split "100 g Butter" for the dough from the same
 * butter for the topping into two lines you then buy twice.
 *
 * `raw` is dropped for the same reason — it still shows the recipe's ORIGINAL amount,
 * which after scaling is exactly the wrong number to put in front of a shopper.
 *
 * The UPPER bound of a range is used ("2-3 Eier" -> 3), matching `parseServings` and
 * `parseDuration`: too much food beats a missing ingredient at the till.
 *
 * The amount is also re-expressed in its nicest unit, because scaling produces numbers
 * no recipe author wrote: 500 ml tripled is "1500 ml", and a shopping list should say
 * "1,5 l". {@link addAmounts} does the same for merged lines, so a line reads
 * identically whether it arrived alone or was summed. Hand-typed amounts are NOT
 * rewritten (see `toDraft` in the API's items.service.ts) — what a person typed is
 * what they meant.
 */
export function ingredientToShoppingItem(
  ingredient: RecipeIngredient,
  recipeId: string | null,
): ShoppingDraftItem {
  const raw = ingredient.quantityMax ?? ingredient.quantity ?? null;
  const unit = ingredient.unit ? normalizeUnit(ingredient.unit) : null;
  const nice =
    typeof raw === "number" && unit !== null ? preferredDisplayUnit(raw, unit) : undefined;
  return {
    name: ingredient.name.trim().slice(0, 300),
    quantity:
      nice !== undefined
        ? roundQuantity(nice.quantity)
        : typeof raw === "number"
          ? roundQuantity(raw)
          : null,
    unit: nice !== undefined ? nice.unit : unit,
    note: ingredient.note?.trim() ? ingredient.note.trim().slice(0, 300) : null,
    sourceRecipeIds: recipeId ? [recipeId] : [],
  };
}

/**
 * Every ingredient of a recipe as shopping lines, already merged against each other
 * (a recipe that lists butter twice becomes one line).
 *
 * Pass the ALREADY SCALED ingredients — scaling is `scaleIngredients` from
 * ./ingredients.ts, and doing it here as well would apply the factor twice.
 */
export function recipeToShoppingItems(
  ingredients: readonly RecipeIngredient[],
  recipeId: string | null,
): ShoppingDraftItem[] {
  const lines = ingredients
    .filter((ingredient) => ingredient.name.trim().length > 0)
    .map((ingredient) => ingredientToShoppingItem(ingredient, recipeId));
  return mergeShoppingItems<ShoppingDraftItem>([], lines) as ShoppingDraftItem[];
}

/* -------------------------------------------------------------------------- */
/* display                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The amount as one short string ("400 g", "1½", ""), for the line under an item's
 * name. `formatNumber` should be `formatQuantity` from ./numbers.ts in the UI.
 */
export function formatShoppingAmount(
  amount: ShoppingAmount,
  formatNumber: (value: number) => string = (value) => String(value),
): string {
  if (amount.quantity === null) return amount.unit ?? "";
  const number = formatNumber(amount.quantity);
  return amount.unit ? `${number} ${amount.unit}` : number;
}

/**
 * True when a unit's amount says nothing useful to a shopper. "1 Prise Salz" is a
 * cooking instruction; on a shopping list it is just "Salz". Used by the UI to grey
 * the amount out — never to drop it, because the data stays lossless.
 */
export function isVagueAmount(amount: ShoppingAmount): boolean {
  return amount.unit !== null && NON_SCALING_UNITS.includes(normalizeUnit(amount.unit));
}

/* -------------------------------------------------------------------------- */
/* progress + frequently bought                                              */
/* -------------------------------------------------------------------------- */

/**
 * The shopping-trip progress bar (artboards 1c/1g): share of THIS TRIP that is done.
 *
 * Denominator is `toBuy + bought`, not a lifetime total — `4` bought against `10`
 * still to buy is 29 %, which is what the design draws, and `Clear bought` therefore
 * honestly resets the bar to 0 % rather than freezing it at a historical number.
 * Returns an integer 0–100; 0 when there is nothing on the list at all, and the UI
 * hides the bar in that case rather than drawing an empty one.
 */
export function shoppingProgressPercent(toBuy: number, bought: number): number {
  const total = toBuy + bought;
  if (total <= 0) return 0;
  return Math.round((bought / total) * 100);
}

/** How many chips the rail and the phone chip row show (artboards 1d/1h). */
export const FREQUENT_CHIP_COUNT = 8;

/**
 * STEP 1 — SELECTION. Which entries make the chip row: the most-bought ones.
 * Ranks by `useCount` desc, then `lastUsedAt` desc (the same order the API returns,
 * re-applied here so the function is correct on any input), and takes `limit`.
 * Says nothing about display order — see {@link sortEntriesByFoldedName} for that.
 */
export function selectMostBoughtEntries<T extends { useCount: number; lastUsedAt: string }>(
  entries: readonly T[],
  limit: number = FREQUENT_CHIP_COUNT,
): T[] {
  return [...entries]
    .sort((a, b) => b.useCount - a.useCount || b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, limit);
}

/**
 * STEP 2 — DISPLAY ORDER. Alphabetical by German folded name, so "Äpfel" sits under
 * A and not after Z: `foldText()` first (the app's single definition of "same word"),
 * then `localeCompare` on the FOLDED strings, then the raw name as a stable tiebreak.
 * Never `localeCompare` alone (an unfolded compare sorts `Ä` after `Z`), and never a
 * `foldSql()` ORDER BY — the parser overflows past 30 nested `replace()` calls and the
 * table is deliberately half-finished (see FOLD_PAIRS in ./text.ts). This runs
 * client-side over an already-ranked, already-small array; no fold is added in SQL.
 */
export function sortEntriesByFoldedName<T extends { name: string }>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) => foldText(a.name).localeCompare(foldText(b.name)) || a.name.localeCompare(b.name),
  );
}
