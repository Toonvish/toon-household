/**
 * Turning what someone types into shopping lines.
 *
 * The add box takes free text ("500g Mehl", "2 Dosen Tomaten", "Klopapier") and the
 * parsing is done HERE, on the client, with `parseIngredientLine` from @toon/shared —
 * the same parser the importer uses. The API then only ever receives structured
 * `{ name, quantity, unit }`, which keeps one German-language parser in the codebase
 * instead of two.
 *
 * A line the parser cannot read an amount out of is not an error: it becomes an
 * amount-less item, which is exactly right for "Klopapier".
 */
import { SHOPPING_LIMITS, parseIngredientLine, type ShoppingItemInput } from "@toon/shared";

/**
 * Parses one typed line into a shopping item, or null when it is blank.
 *
 * `raw`, `position` and `section` from the parser are dropped: `raw` would show the
 * text as typed rather than as understood, and the other two are recipe concepts.
 */
export function parseShoppingInput(text: string): ShoppingItemInput | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const parsed = parseIngredientLine(trimmed);
  const name = parsed.name.trim();
  // The parser guarantees a non-empty name for non-empty input, but a line of pure
  // punctuation could still fold to nothing.
  if (name.length === 0) return null;

  return {
    name: name.slice(0, 300),
    quantity: parsed.quantityMax ?? parsed.quantity ?? null,
    unit: parsed.unit ?? null,
    note: parsed.note ?? null,
  };
}

/**
 * Parses a whole textarea: one item per line, blank lines dropped, capped at what the
 * API accepts in a single request. Lets someone paste a list from a chat message.
 */
export function parseShoppingInputBlock(text: string): ShoppingItemInput[] {
  const items: ShoppingItemInput[] = [];
  for (const line of text.split(/\r?\n/)) {
    const item = parseShoppingInput(line);
    if (item) items.push(item);
    if (items.length >= SHOPPING_LIMITS.itemsPerRequest) break;
  }
  return items;
}
