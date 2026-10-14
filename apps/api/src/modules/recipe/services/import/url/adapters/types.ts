/**
 * Site adapter contract.
 *
 * Adapters are the LAST-RESORT extractor and the gap-filler: the pipeline always
 * tries JSON-LD, then microdata, then the adapter, merging in that order. Adding
 * a new site therefore means adding exactly one file plus one registry entry.
 */
import type { ElementNode } from "../../html/parse.ts";
import type { ParsedFields } from "../../parsed.ts";

export interface AdapterContext {
  /** Final URL of the fetched page (after redirects). */
  url: string;
  /** Lowercased hostname without a leading "www.". */
  host: string;
}

export interface SiteAdapter {
  /** Stable id, reported in `sourceMeta` when the adapter supplied the data. */
  readonly id: string;
  /** Human-readable site name used for `sourceName`. */
  readonly siteName: string;
  /**
   * Hostnames handled by this adapter. Matching is exact or by dot-suffix, so
   * "chefkoch.de" also matches "www.chefkoch.de" and "m.chefkoch.de".
   */
  readonly hosts: readonly string[];
  /**
   * Optional content-based match, checked for adapters whose hostname did not
   * match. This is how the WP Recipe Maker adapter serves every blog running
   * the plugin, not just the one hostname in `hosts`.
   */
  appliesTo?(doc: ElementNode): boolean;
  /** Pure extraction from the parsed document. Must never throw. */
  extract(doc: ElementNode, context: AdapterContext): ParsedFields;
}
