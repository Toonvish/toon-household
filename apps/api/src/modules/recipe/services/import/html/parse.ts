/**
 * A tiny, dependency-free HTML parser + CSS-subset selector engine.
 *
 * Why not a library? The Foundation phase installed no DOM/HTML parser and this
 * agent must not add dependencies. Recipe scraping needs three things only:
 *   1. find `<script type="application/ld+json">` bodies,
 *   2. walk microdata (`itemscope` / `itemprop`) with correct nesting,
 *   3. read text out of elements addressed by class/tag (site adapters).
 * A forgiving tokenizer with implicit-close rules covers all three on real
 * pages, and it never throws — malformed markup degrades, it does not fail.
 *
 * Supported selector syntax (deliberately small):
 *   tag, .class, #id, [attr], [attr="v"], [attr*="v"], [attr^="v"], [attr$="v"],
 *   descendant (space), child (>), and comma-separated groups.
 */
import { collapseLines, collapseWhitespace, decodeHtmlEntities } from "./entities.ts";

export interface ElementNode {
  readonly type: "element";
  /** Lowercased tag name. */
  readonly tag: string;
  /** Lowercased attribute names -> decoded values. */
  readonly attrs: Record<string, string>;
  readonly classList: readonly string[];
  readonly children: HtmlNode[];
  parent: ElementNode | null;
}

export interface TextNode {
  readonly type: "text";
  /** Entity-decoded text (raw, un-decoded for script/style bodies). */
  readonly text: string;
  parent: ElementNode | null;
}

export type HtmlNode = ElementNode | TextNode;

/** Tags that never have children. */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Tags whose content is raw text, not markup. */
const RAW_TEXT_TAGS = new Set(["script", "style"]);

/** `<p>` is implicitly closed by any of these. */
const CLOSES_PARAGRAPH = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

/** Opening one of these implicitly closes the listed still-open tags. */
const IMPLICIT_CLOSE: Record<string, readonly string[]> = {
  li: ["li"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  tr: ["tr", "td", "th"],
  td: ["td", "th"],
  th: ["td", "th"],
  thead: ["thead", "tbody", "tr", "td", "th"],
  tbody: ["thead", "tbody", "tfoot", "tr", "td", "th"],
  tfoot: ["thead", "tbody", "tr", "td", "th"],
  option: ["option"],
  optgroup: ["optgroup", "option"],
};

const ATTR_RE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]*)))?/g;

function createElement(tag: string, attrs: Record<string, string>): ElementNode {
  const classAttr = attrs.class ?? "";
  return {
    type: "element",
    tag,
    attrs,
    classList: classAttr.length > 0 ? classAttr.split(/\s+/).filter((name) => name.length > 0) : [],
    children: [],
    parent: null,
  };
}

function appendChild(parent: ElementNode, child: HtmlNode): void {
  child.parent = parent;
  parent.children.push(child);
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  for (const match of source.matchAll(ATTR_RE)) {
    const name = match[1]!.toLowerCase();
    if (name.length === 0 || name === "/") continue;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (attrs[name] === undefined) attrs[name] = decodeHtmlEntities(value);
  }
  return attrs;
}

/**
 * Parses an HTML document into a tree. The returned root is a synthetic
 * `#document` element; never throws, even on truncated or invalid markup.
 */
export function parseHtml(html: string): ElementNode {
  const root = createElement("#document", {});
  const stack: ElementNode[] = [root];
  const current = (): ElementNode => stack[stack.length - 1]!;

  let index = 0;
  const length = html.length;

  const pushText = (text: string, decode: boolean): void => {
    if (text.length === 0) return;
    appendChild(current(), { type: "text", text: decode ? decodeHtmlEntities(text) : text, parent: null });
  };

  /** Pops the stack up to and including `tag`; no-op when `tag` is not open. */
  const closeTag = (tag: string): void => {
    for (let depth = stack.length - 1; depth > 0; depth -= 1) {
      if (stack[depth]!.tag === tag) {
        stack.length = depth;
        return;
      }
    }
  };

  const closeImplicit = (tag: string): void => {
    const targets = IMPLICIT_CLOSE[tag];
    if (targets) {
      while (stack.length > 1 && targets.includes(current().tag)) stack.pop();
    }
    if (CLOSES_PARAGRAPH.has(tag)) {
      while (stack.length > 1 && current().tag === "p") stack.pop();
    }
  };

  while (index < length) {
    const next = html.indexOf("<", index);
    if (next === -1) {
      pushText(html.slice(index), true);
      break;
    }
    pushText(html.slice(index, next), true);

    // comments / doctype / processing instructions
    if (html.startsWith("<!--", next)) {
      const end = html.indexOf("-->", next + 4);
      index = end === -1 ? length : end + 3;
      continue;
    }
    if (html.startsWith("<!", next) || html.startsWith("<?", next)) {
      const end = html.indexOf(">", next);
      index = end === -1 ? length : end + 1;
      continue;
    }

    // closing tag
    if (html.startsWith("</", next)) {
      const end = html.indexOf(">", next);
      if (end === -1) {
        index = length;
        break;
      }
      const tag = html.slice(next + 2, end).trim().toLowerCase();
      if (tag.length > 0) closeTag(tag);
      index = end + 1;
      continue;
    }

    const nameMatch = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(next, next + 64));
    if (!nameMatch) {
      // "<3" and friends: emit as text.
      pushText("<", false);
      index = next + 1;
      continue;
    }
    const tag = nameMatch[1]!.toLowerCase();

    // find the end of the open tag, tolerating ">" inside quoted attributes
    let cursor = next + nameMatch[0].length;
    let quote: '"' | "'" | null = null;
    while (cursor < length) {
      const char = html[cursor]!;
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
      cursor += 1;
    }
    const openTagEnd = cursor >= length ? length : cursor;
    const attrSource = html.slice(next + nameMatch[0].length, openTagEnd);
    const selfClosing = attrSource.trimEnd().endsWith("/");
    const attrs = parseAttributes(selfClosing ? attrSource.trimEnd().slice(0, -1) : attrSource);

    closeImplicit(tag);

    const element = createElement(tag, attrs);
    appendChild(current(), element);
    index = openTagEnd + 1;

    if (VOID_TAGS.has(tag) || selfClosing) continue;

    if (RAW_TEXT_TAGS.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, "i");
      const rest = html.slice(index);
      const match = closeRe.exec(rest);
      const body = match ? rest.slice(0, match.index) : rest;
      if (body.length > 0) appendChild(element, { type: "text", text: body, parent: null });
      index = match ? index + match.index + match[0].length : length;
      continue;
    }

    stack.push(element);
  }

  return root;
}

/* --------------------------------- queries -------------------------------- */

interface AttrTest {
  name: string;
  operator: "exists" | "=" | "*=" | "^=" | "$=" | "~=";
  value: string;
}

interface CompoundSelector {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: AttrTest[];
}

interface SelectorStep {
  compound: CompoundSelector;
  /** How this step relates to the PREVIOUS step. */
  combinator: "descendant" | "child";
}

const COMPOUND_RE = /([.#]?[A-Za-z0-9_*:-]+|\[[^\]]*\])/g;

function parseCompound(source: string): CompoundSelector {
  const compound: CompoundSelector = { classes: [], attrs: [] };
  for (const match of source.matchAll(COMPOUND_RE)) {
    const token = match[1]!;
    if (token.startsWith(".")) {
      compound.classes.push(token.slice(1));
    } else if (token.startsWith("#")) {
      compound.id = token.slice(1);
    } else if (token.startsWith("[")) {
      const body = token.slice(1, -1);
      const attrMatch = /^\s*([^\s~^$*=]+)\s*(?:([~^$*]?=)\s*(.*?)\s*)?$/.exec(body);
      if (!attrMatch) continue;
      const rawValue = (attrMatch[3] ?? "").replace(/^["']|["']$/g, "");
      compound.attrs.push({
        name: attrMatch[1]!.toLowerCase(),
        operator: (attrMatch[2] ?? "exists") as AttrTest["operator"],
        value: rawValue,
      });
    } else if (token !== "*") {
      compound.tag = token.toLowerCase();
    }
  }
  return compound;
}

function parseSelector(selector: string): SelectorStep[][] {
  return selector
    .split(",")
    .map((group) => group.trim())
    .filter((group) => group.length > 0)
    .map((group) => {
      const steps: SelectorStep[] = [];
      let combinator: SelectorStep["combinator"] = "descendant";
      for (const piece of group.split(/\s+/)) {
        if (piece === ">") {
          combinator = "child";
          continue;
        }
        // handle "a>b" written without spaces
        const parts = piece.split(">").filter((part) => part.length > 0);
        parts.forEach((part, partIndex) => {
          steps.push({ compound: parseCompound(part), combinator: partIndex === 0 ? combinator : "child" });
          combinator = "descendant";
        });
      }
      return steps;
    })
    .filter((steps) => steps.length > 0);
}

function matchesAttr(element: ElementNode, test: AttrTest): boolean {
  const value = element.attrs[test.name];
  if (value === undefined) return false;
  switch (test.operator) {
    case "exists":
      return true;
    case "=":
      return value === test.value;
    case "*=":
      return test.value.length > 0 && value.includes(test.value);
    case "^=":
      return value.startsWith(test.value);
    case "$=":
      return value.endsWith(test.value);
    case "~=":
      return value.split(/\s+/).includes(test.value);
    default:
      return false;
  }
}

function matchesCompound(element: ElementNode, compound: CompoundSelector): boolean {
  if (compound.tag !== undefined && element.tag !== compound.tag) return false;
  if (compound.id !== undefined && element.attrs.id !== compound.id) return false;
  for (const className of compound.classes) {
    if (!element.classList.includes(className)) return false;
  }
  for (const test of compound.attrs) {
    if (!matchesAttr(element, test)) return false;
  }
  return true;
}

/** Right-to-left match of a full selector chain against `element`. */
function matchesChain(element: ElementNode, steps: SelectorStep[], scope: ElementNode): boolean {
  let stepIndex = steps.length - 1;
  if (!matchesCompound(element, steps[stepIndex]!.compound)) return false;

  let combinator = steps[stepIndex]!.combinator;
  let node: ElementNode | null = element.parent;
  stepIndex -= 1;

  while (stepIndex >= 0) {
    const step = steps[stepIndex]!;
    if (combinator === "child") {
      if (node === null || node === scope.parent || !matchesCompound(node, step.compound)) return false;
      combinator = step.combinator;
      node = node.parent;
      stepIndex -= 1;
      continue;
    }
    let found = false;
    while (node !== null) {
      if (matchesCompound(node, step.compound)) {
        found = true;
        break;
      }
      node = node.parent;
    }
    if (!found || node === null) return false;
    combinator = step.combinator;
    node = node.parent;
    stepIndex -= 1;
  }
  return true;
}

/** Depth-first walk over every element below (and excluding) `root`. */
export function walkElements(root: ElementNode, visit: (element: ElementNode) => void): void {
  for (const child of root.children) {
    if (child.type !== "element") continue;
    visit(child);
    walkElements(child, visit);
  }
}

/** All descendants of `root` matching the selector, in document order. */
export function queryAll(root: ElementNode, selector: string): ElementNode[] {
  const groups = parseSelector(selector);
  if (groups.length === 0) return [];
  const out: ElementNode[] = [];
  walkElements(root, (element) => {
    if (groups.some((steps) => matchesChain(element, steps, root))) out.push(element);
  });
  return out;
}

/** First descendant matching the selector, or null. */
export function queryOne(root: ElementNode, selector: string): ElementNode | null {
  const groups = parseSelector(selector);
  if (groups.length === 0) return null;
  let found: ElementNode | null = null;
  walkElements(root, (element) => {
    if (found === null && groups.some((steps) => matchesChain(element, steps, root))) found = element;
  });
  return found;
}

/** Reads an attribute (already entity-decoded), or undefined. */
export function attr(element: ElementNode | null | undefined, name: string): string | undefined {
  if (!element) return undefined;
  const value = element.attrs[name.toLowerCase()];
  return value === undefined || value.length === 0 ? undefined : value;
}

/** Concatenated text of all descendants, whitespace-collapsed to one line. */
export function textOf(node: HtmlNode | null | undefined): string {
  if (!node) return "";
  return collapseWhitespace(rawTextOf(node, false));
}

/**
 * Text of all descendants keeping block structure (one line per `<li>`/`<p>`),
 * which is what ingredient/instruction blocks need.
 */
export function blockTextOf(node: HtmlNode | null | undefined): string {
  if (!node) return "";
  return collapseLines(rawTextOf(node, true));
}

const SKIPPED_TEXT_TAGS = new Set(["script", "style", "noscript", "template", "svg", "head"]);

const NEWLINE_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
  "ul",
]);

function rawTextOf(node: HtmlNode, keepBlocks: boolean): string {
  if (node.type === "text") return node.text;
  if (SKIPPED_TEXT_TAGS.has(node.tag)) return "";
  let out = keepBlocks && NEWLINE_TAGS.has(node.tag) ? "\n" : "";
  for (const child of node.children) out += rawTextOf(child, keepBlocks);
  if (keepBlocks && NEWLINE_TAGS.has(node.tag)) out += "\n";
  else out += " ";
  return out;
}

/** True when the element (or an ancestor up to `root`) is hidden markup. */
export function isHiddenElement(element: ElementNode): boolean {
  if (element.attrs.hidden !== undefined) return true;
  const style = element.attrs.style ?? "";
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
}

/** Immediate element children, optionally filtered by tag name. */
export function childElements(element: ElementNode, tag?: string): ElementNode[] {
  const out: ElementNode[] = [];
  for (const child of element.children) {
    if (child.type !== "element") continue;
    if (tag === undefined || child.tag === tag) out.push(child);
  }
  return out;
}
