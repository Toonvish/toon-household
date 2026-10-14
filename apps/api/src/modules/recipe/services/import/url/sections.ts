/**
 * Heading-relative extraction helpers.
 *
 * Most German recipe pages that lack structured data still have the shape
 * "<h2>Zutaten</h2> … list … <h2>Zubereitung</h2> … text …". These helpers pull
 * the content that FOLLOWS a heading, stopping at the next heading of the same
 * or a higher level — which is exactly what a reader sees as "the section".
 */
import { type ElementNode, type HtmlNode, blockTextOf, queryAll, textOf, walkElements } from "../html/parse.ts";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
/** Chrome that sits inside a section but is not part of its content. */
const NOISE_CLASS_RE =
  /(^|-)(ad|ads|advert|banner|share|sharing|social|comment|comments|newsletter|related|breadcrumb|nav|menu|print|rating|stars|jump|toc|cookie|consent)(-|$)/i;

/** Every heading element in the document, in order. */
export function headings(doc: ElementNode): ElementNode[] {
  const out: ElementNode[] = [];
  walkElements(doc, (element) => {
    if (HEADING_TAGS.has(element.tag)) out.push(element);
  });
  return out;
}

/** First heading whose text matches `pattern`. */
export function findHeading(doc: ElementNode, pattern: RegExp): ElementNode | null {
  for (const heading of headings(doc)) {
    if (pattern.test(textOf(heading))) return heading;
  }
  return null;
}

function headingLevel(element: ElementNode): number {
  return HEADING_TAGS.has(element.tag) ? Number(element.tag.slice(1)) : 99;
}

function isNoise(element: ElementNode): boolean {
  if (element.tag === "script" || element.tag === "style" || element.tag === "noscript") return true;
  if (element.attrs.hidden !== undefined) return true;
  if (/display\s*:\s*none/i.test(element.attrs.style ?? "")) return true;
  return element.classList.some((className) => NOISE_CLASS_RE.test(className));
}

/**
 * The sibling nodes that follow `heading` inside its parent, up to the next
 * heading of the same or a higher level.
 */
export function nodesAfterHeading(heading: ElementNode): HtmlNode[] {
  const parent = heading.parent;
  if (!parent) return [];
  const level = headingLevel(heading);
  const startIndex = parent.children.indexOf(heading);
  if (startIndex === -1) return [];

  const out: HtmlNode[] = [];
  for (let index = startIndex + 1; index < parent.children.length; index += 1) {
    const node = parent.children[index]!;
    if (node.type === "element") {
      if (HEADING_TAGS.has(node.tag) && headingLevel(node) <= level) break;
      if (isNoise(node)) continue;
    }
    out.push(node);
  }
  return out;
}

/** Block-structured text of the section that follows a matching heading. */
export function textAfterHeading(doc: ElementNode, pattern: RegExp): string {
  const heading = findHeading(doc, pattern);
  if (!heading) return "";
  const nodes = nodesAfterHeading(heading);
  if (nodes.length === 0) {
    // Some themes wrap the content in the heading's *parent's* next sibling.
    return "";
  }
  const parts: string[] = [];
  for (const node of nodes) parts.push(blockTextOf(node));
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The list items of the first `<ul>`/`<ol>`/`<table>` that follows a matching
 * heading — one string per item/row.
 */
export function listAfterHeading(doc: ElementNode, pattern: RegExp): string[] {
  const heading = findHeading(doc, pattern);
  if (!heading) return [];
  for (const node of nodesAfterHeading(heading)) {
    if (node.type !== "element") continue;
    const list = node.tag === "ul" || node.tag === "ol" || node.tag === "table" ? node : findList(node);
    if (!list) continue;
    const items = itemsOfList(list);
    if (items.length > 0) return items;
  }
  return [];
}

function findList(root: ElementNode): ElementNode | null {
  let found: ElementNode | null = null;
  walkElements(root, (element) => {
    if (found === null && (element.tag === "ul" || element.tag === "ol" || element.tag === "table")) found = element;
  });
  return found;
}

/** One entry per `<li>` (or per table row, cells joined by a space). */
export function itemsOfList(list: ElementNode): string[] {
  if (list.tag === "table") {
    return queryAll(list, "tr")
      .map((row) => {
        const cells = queryAll(row, "td, th").map(textOf).filter((text) => text.length > 0);
        return cells.join(" ").trim();
      })
      .filter((text) => text.length > 0);
  }
  return queryAll(list, "li")
    .map(textOf)
    .filter((text) => text.length > 0);
}
