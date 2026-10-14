/**
 * `<meta>` / `<title>` fallbacks. Never enough for a recipe on their own, but
 * they reliably fill the gaps structured data leaves (title, description, hero
 * image, site name, language) on every CMS.
 */
import { type ElementNode, attr, queryAll, queryOne, textOf } from "../html/parse.ts";
import { cleanText } from "../html/entities.ts";
import type { ParsedFields } from "../parsed.ts";
import { absoluteUrl, normalizeLanguage } from "./schema-map.ts";

/** All `<meta>` values keyed by lowercased `name`/`property`/`itemprop`. */
export function readMetaTags(doc: ElementNode): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const element of queryAll(doc, "meta")) {
    const key = (attr(element, "property") ?? attr(element, "name") ?? attr(element, "itemprop"))?.toLowerCase();
    const value = attr(element, "content");
    if (key === undefined || value === undefined) continue;
    const existing = out.get(key);
    if (existing) existing.push(value);
    else out.set(key, [value]);
  }
  return out;
}

function first(meta: Map<string, string[]>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const values = meta.get(key);
    if (values && values.length > 0) {
      const clean = cleanText(values[0]);
      if (clean.length > 0) return clean;
    }
  }
  return undefined;
}

/**
 * Human-friendly site name for `sourceName`:
 * "chefkoch.de" -> "Chefkoch", "backstube-mueller.example" -> "Backstube Mueller".
 */
export function siteNameFromHost(host: string): string {
  const bare = host.replace(/^www\./, "");
  const label = bare.split(".")[0] ?? bare;
  return label
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toLocaleUpperCase("de-DE") + part.slice(1))
    .join(" ");
}

export interface MetaFallbackOptions {
  url: string;
  host: string;
}

/**
 * Extracts what the document head alone can tell us. Used to fill gaps only —
 * `mergeParsedFields` keeps whatever a structured source already provided.
 */
export function extractMetaFields(doc: ElementNode, options: MetaFallbackOptions): ParsedFields {
  const meta = readMetaTags(doc);
  const fields: ParsedFields = { sourceUrl: options.url, sourceName: siteNameFromHost(options.host) };

  const ogSiteName = first(meta, "og:site_name", "application-name");
  if (ogSiteName !== undefined) fields.sourceName = ogSiteName;

  const title = first(meta, "og:title", "twitter:title") ?? cleanText(textOf(queryOne(doc, "title")));
  if (title !== undefined && title.length > 0) fields.title = stripSiteSuffix(title, fields.sourceName ?? options.host);

  const description = first(meta, "og:description", "description", "twitter:description");
  if (description !== undefined) fields.description = description;

  const image = first(meta, "og:image", "og:image:secure_url", "twitter:image", "twitter:image:src", "image");
  if (image !== undefined) fields.imageUrl = absoluteUrl(image, options.url);

  const language = normalizeLanguage(
    attr(queryOne(doc, "html"), "lang") ?? first(meta, "og:locale") ?? first(meta, "content-language"),
  );
  if (language !== undefined) fields.language = language;

  const keywords = meta.get("keywords")?.[0] ?? meta.get("article:tag")?.join(",");
  if (keywords !== undefined) {
    const tags = keywords
      .split(/\s*[,;|]\s*/)
      .map((tag) => cleanText(tag))
      .filter((tag) => tag.length > 1 && tag.length <= 60);
    if (tags.length > 0) fields.tags = tags.slice(0, 30);
  }

  return fields;
}

/** Drops the " | Chefkoch.de" / " - Rezept" tail from a `<title>`. */
export function stripSiteSuffix(title: string, siteName: string): string {
  const separators = [" | ", " – ", " — ", " - ", " · ", " » ", " :: "];
  let out = title;
  for (const separator of separators) {
    const index = out.lastIndexOf(separator);
    if (index <= 0) continue;
    const tail = out.slice(index + separator.length).trim();
    const head = out.slice(0, index).trim();
    const tailLooksLikeSite =
      tail.toLowerCase().includes(siteName.toLowerCase()) ||
      /^(rezept|rezepte|recipe|blog|kochen|backen)\b/i.test(tail) ||
      /\.(de|com|net|org|at|ch)$/i.test(tail);
    if (tailLooksLikeSite && head.length >= 3) out = head;
  }
  return out.trim();
}
