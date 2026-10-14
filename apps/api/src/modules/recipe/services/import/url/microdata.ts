/**
 * Microdata (`itemscope` / `itemtype` / `itemprop`) fallback for pages without
 * JSON-LD — still common on older German food blogs and on hRecipe-era themes.
 *
 * The extractor turns a microdata item back into the SAME loose object shape a
 * JSON-LD node has, so `mapSchemaRecipe()` can be reused verbatim. Nesting is
 * respected: a property whose element is itself an `itemscope` becomes a nested
 * object (that is how `nutrition` and `HowToStep` arrive), and properties of a
 * nested item never leak into the parent.
 */
import { type ElementNode, attr, blockTextOf, childElements, parseHtml, queryAll, textOf } from "../html/parse.ts";

/** Value readers per tag, mirroring the HTML microdata spec. */
function propertyValue(element: ElementNode): string {
  switch (element.tag) {
    case "meta":
      return attr(element, "content") ?? "";
    case "audio":
    case "embed":
    case "iframe":
    case "img":
    case "source":
    case "track":
    case "video":
      return attr(element, "src") ?? attr(element, "data-src") ?? attr(element, "content") ?? "";
    case "a":
    case "area":
    case "link":
      return attr(element, "href") ?? textOf(element);
    case "object":
      return attr(element, "data") ?? "";
    case "data":
      return attr(element, "value") ?? textOf(element);
    case "time":
      return attr(element, "datetime") ?? textOf(element);
    case "ol":
    case "ul":
    case "dl":
    case "table":
      // Lists keep their line structure so each <li> stays one item.
      return blockTextOf(element);
    default:
      return attr(element, "content") ?? textOf(element);
  }
}

const MAX_MICRODATA_DEPTH = 8;

/** True when the element opens a new microdata item. */
function isItemScope(element: ElementNode): boolean {
  return element.attrs.itemscope !== undefined || element.attrs.itemtype !== undefined;
}

/**
 * Collects the itemprops that belong to `scope` — i.e. descendants that are not
 * inside a *nested* itemscope. `itemref` is not supported (vanishingly rare).
 */
function collectScopedProps(scope: ElementNode): ElementNode[] {
  const out: ElementNode[] = [];
  const visit = (parent: ElementNode): void => {
    for (const child of childElements(parent)) {
      const hasProp = child.attrs.itemprop !== undefined;
      const nestedScope = isItemScope(child);
      if (hasProp) out.push(child);
      // Do not descend into a nested item: its props belong to that item.
      if (!nestedScope) visit(child);
    }
  };
  visit(scope);
  return out;
}

/** Recursively turns a microdata item element into a JSON-LD-ish object. */
export function itemToObject(scope: ElementNode, depth = 0): Record<string, unknown> {
  const node: Record<string, unknown> = {};
  const itemType = attr(scope, "itemtype");
  if (itemType !== undefined) {
    const types = itemType
      .split(/\s+/)
      .map((value) => value.replace(/^https?:\/\/schema\.org\//i, "").trim())
      .filter((value) => value.length > 0);
    node["@type"] = types.length === 1 ? types[0] : types;
  }
  const itemId = attr(scope, "itemid");
  if (itemId !== undefined) node["@id"] = itemId;

  if (depth > MAX_MICRODATA_DEPTH) return node;

  for (const element of collectScopedProps(scope)) {
    const names = (attr(element, "itemprop") ?? "").split(/\s+/).filter((name) => name.length > 0);
    if (names.length === 0) continue;
    const value: unknown = isItemScope(element) ? itemToObject(element, depth + 1) : propertyValue(element);
    if (typeof value === "string" && value.trim().length === 0) continue;

    for (const name of names) {
      const existing = node[name];
      if (existing === undefined) node[name] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else node[name] = [existing, value];
    }
  }
  return node;
}

/**
 * Every microdata item on the page whose `itemtype` matches `typeName`
 * (case-insensitive, schema.org prefix optional), outermost first.
 */
export function extractMicrodataItems(source: string | ElementNode, typeName = "Recipe"): Array<Record<string, unknown>> {
  const doc = typeof source === "string" ? parseHtml(source) : source;
  const needle = typeName.toLowerCase();
  const out: Array<Record<string, unknown>> = [];
  for (const element of queryAll(doc, "[itemtype]")) {
    const itemType = (attr(element, "itemtype") ?? "").toLowerCase();
    if (!itemType.split(/\s+/).some((value) => value.replace(/^https?:\/\/schema\.org\//, "") === needle)) continue;
    // Skip items nested inside another item of the same type.
    let ancestor = element.parent;
    let nested = false;
    while (ancestor !== null) {
      if ((attr(ancestor, "itemtype") ?? "").toLowerCase().includes(needle)) {
        nested = true;
        break;
      }
      ancestor = ancestor.parent;
    }
    if (nested) continue;
    out.push(itemToObject(element));
  }
  return out;
}

/**
 * The best microdata Recipe node on the page (most ingredient lines), or null.
 * The returned object is shaped exactly like a JSON-LD node.
 */
export function findMicrodataRecipe(source: string | ElementNode): Record<string, unknown> | null {
  const items = extractMicrodataItems(source, "Recipe");
  if (items.length === 0) return null;
  return items.sort((left, right) => ingredientCount(right) - ingredientCount(left))[0] ?? null;
}

function ingredientCount(node: Record<string, unknown>): number {
  const value = node.recipeIngredient ?? node.ingredients ?? node.ingredient;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") return value.split("\n").filter((line) => line.trim().length > 0).length;
  return 0;
}
