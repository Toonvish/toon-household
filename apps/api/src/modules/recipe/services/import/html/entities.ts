/**
 * HTML entity decoding + text extraction helpers.
 *
 * Recipe sites put entities and inline markup into every JSON-LD/microdata
 * field ("Br&ouml;tchen", "<strong>250 g</strong> Mehl"), so every string that
 * reaches a ParsedRecipe goes through `cleanText()` first.
 *
 * Pure, no I/O, no dependencies — safe to unit-test directly.
 */

/** The named entities that actually show up on German/English recipe pages. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  shy: "\u00ad",
  auml: "ä",
  Auml: "Ä",
  ouml: "ö",
  Ouml: "Ö",
  uuml: "ü",
  Uuml: "Ü",
  szlig: "ß",
  eacute: "é",
  Eacute: "É",
  egrave: "è",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  ccedil: "ç",
  iacute: "í",
  oacute: "ó",
  ocirc: "ô",
  uacute: "ú",
  ntilde: "ñ",
  aring: "å",
  oslash: "ø",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  plusmn: "±",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  frac13: "⅓",
  frac23: "⅔",
  frac18: "⅛",
  sup2: "²",
  sup3: "³",
  micro: "µ",
  middot: "·",
  bull: "•",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  lsaquo: "‹",
  rsaquo: "›",
  dagger: "†",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  times: "×",
  divide: "÷",
  minus: "−",
  ne: "≠",
  le: "≤",
  ge: "≥",
  asymp: "≈",
  zwnj: "",
  zwj: "",
  lrm: "",
  rlm: "",
};

const ENTITY_RE = /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/**
 * Decodes numeric (`&#233;`, `&#xE9;`) and named (`&ouml;`) HTML entities.
 * Unknown entities are left verbatim so nothing is silently lost.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(ENTITY_RE, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const codePoint = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
      // Surrogate halves are not valid scalar values.
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? match : named;
  });
}

/** Block-level tags that become a line break when markup is flattened to text. */
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
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
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

/** True for tags whose *content* is never user-visible text. */
const DROPPED_TAGS = ["script", "style", "noscript", "template", "svg", "iframe", "head"] as const;

const DROPPED_CONTENT_RE = new RegExp(`<(${DROPPED_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi");

/**
 * Removes tags from an HTML fragment, turning block-level boundaries into
 * newlines so that `<li>` lists survive as one line per item.
 */
export function stripTags(html: string): string {
  const withoutDropped = html.replace(DROPPED_CONTENT_RE, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = withoutDropped.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_match, tag: string) =>
    BLOCK_TAGS.has(tag.toLowerCase()) ? "\n" : " ",
  );
  // Anything left that looks like a stray tag (e.g. "<3") stays as-is.
  return withBreaks.replace(/<[^>]*>/g, " ");
}

/** NBSP, en/em/thin/figure spaces, zero-width space, ideographic space, BOM. */
const EXOTIC_SPACE_RE = /[\u00a0 \u2000-\u200b\u202f\u205f\u3000\ufeff]/g;
/** Soft hyphens survive HTML/OCR and would break unit parsing. */
const SOFT_HYPHEN_RE = /\u00ad/g;

/** Collapses runs of whitespace (incl. NBSP) into single spaces and trims. */
export function collapseWhitespace(input: string): string {
  return input.replace(EXOTIC_SPACE_RE, " ").replace(/\s+/g, " ").trim();
}

/**
 * Normalises whitespace while KEEPING line structure:
 * every line is collapsed individually, blank runs shrink to one empty line.
 */
export function collapseLines(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(EXOTIC_SPACE_RE, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The canonical "make this string safe for a ParsedRecipe field" pipeline:
 * decode entities, drop markup, collapse whitespace to a single line.
 */
export function cleanText(input: string | null | undefined): string {
  if (typeof input !== "string" || input.length === 0) return "";
  const withoutTags = input.includes("<") ? stripTags(input) : input;
  return collapseWhitespace(decodeHtmlEntities(withoutTags).replace(SOFT_HYPHEN_RE, ""));
}

/**
 * Like `cleanText` but preserves line breaks — used for instruction blobs and
 * ingredient blocks where each line is a separate item.
 */
export function cleanMultilineText(input: string | null | undefined): string {
  if (typeof input !== "string" || input.length === 0) return "";
  const withoutTags = input.includes("<") ? stripTags(input) : input;
  return collapseLines(decodeHtmlEntities(withoutTags).replace(SOFT_HYPHEN_RE, ""));
}

/** Truncates to `max` characters without cutting a word when avoidable. */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  const hard = input.slice(0, max);
  const lastSpace = hard.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? hard.slice(0, lastSpace) : hard).trimEnd();
}
