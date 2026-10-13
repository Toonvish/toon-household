/**
 * German-friendly text folding. Pure, no I/O.
 *
 * This is the SINGLE definition of "two strings mean the same word" for the whole
 * app, and it has to be, because three places compare against each other:
 *
 *  - `foldText()` here — used by the web app (shopping-list merge preview) and by
 *    every server-side JS comparison,
 *  - `foldSql()` in apps/api/src/services/groups/support.ts — builds the SAME
 *    replacements as nested SQLite `replace(lower(...))` calls, from {@link FOLD_PAIRS},
 *  - the `name_key` column of `shopping_list_items` / `shopping_list_catalog`, which
 *    stores a folded name so a UNIQUE index can do the merging.
 *
 * SQLite's `lower()` only folds ASCII, so "Ä" would never match "ä" and "Grieß"
 * would never match "griess" without this. Umlauts fold to their base letter, which
 * also makes "Möhre" findable as "mohre".
 *
 * Adding a pair changes stored `name_key` values: existing rows keep their old key
 * until they are rewritten, so only ever ADD pairs that cannot affect words already
 * in use, or accept that two spellings stop merging for old rows.
 */

/**
 * Replacement table, applied in order AFTER lowercasing.
 *
 * THE UPPERCASE ENTRIES ARE ONLY THERE FOR SQL. `foldText()` lowercases first, so
 * "Ä"/"Ö"/"Ü" can never reach the loop in JS — but `foldSql()` expands this same
 * table into SQLite `replace(lower(…))` calls and **SQLite's `lower()` folds ASCII
 * only**, so without them "MÖHRE" would fold to "mÖhre" in SQL and "mohre" in JS.
 *
 * THE TABLE IS DELIBERATELY NOT COMPLETE IN THAT RESPECT, and the reason is a hard
 * limit: SQLite's parser overflows at 31 nested `replace()` calls (measured against
 * libSQL 0.17.4 and re-verified on 0.18.0 — 30 works, 31 is `parser stack overflow`). Listing the uppercase
 * twin of every accent below would need 40 and break `foldSql()` outright. So
 * `foldSql()` agrees with `foldText()` for ASCII and for the German umlauts, and
 * NOT for an uppercase "È"/"Ç"/"ẞ" — which is exactly why the pre-folded recipe
 * columns are written by `foldText()` in JS and backfilled by
 * `backfillFoldedColumns()` in JS, never by folding in SQL. Do not "complete" this
 * table; it will overflow the parser.
 *
 * Adding a pair changes stored `name_key` / `merge_key` values: existing rows keep
 * their old key until rewritten, so only ever ADD pairs that cannot affect words
 * already in use, or accept that two spellings stop merging for old rows.
 */
export const FOLD_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["Ä", "a"],
  ["Ö", "o"],
  ["Ü", "u"],
  ["ä", "a"],
  ["ö", "o"],
  ["ü", "u"],
  ["ß", "ss"],
  ["é", "e"],
  ["è", "e"],
  ["ê", "e"],
  ["á", "a"],
  ["à", "a"],
  ["â", "a"],
  ["í", "i"],
  ["ì", "i"],
  ["î", "i"],
  ["ó", "o"],
  ["ò", "o"],
  ["ô", "o"],
  ["ú", "u"],
  ["ù", "u"],
  ["û", "u"],
  ["ç", "c"],
];

/** Lowercases and applies {@link FOLD_PAIRS}. The JS twin of `foldSql()`. */
export function foldText(value: string): string {
  let folded = value.toLowerCase();
  for (const [from, to] of FOLD_PAIRS) folded = folded.split(from).join(to);
  return folded;
}

/**
 * Folded, whitespace-collapsed comparison key for an ingredient/item NAME.
 *
 * Stricter than {@link foldText}: it also drops surrounding punctuation and
 * collapses runs of whitespace, so "Mehl ", "mehl" and "MEHL," share a key. Used as
 * the merge key for shopping-list items — see `packages/shared/src/shopping.ts`.
 */
export function nameKey(value: string): string {
  return foldText(value)
    .replace(/[\s ]+/g, " ")
    .replace(/^[\s.,;:!?"'`´()[\]{}\-–—]+/u, "")
    .replace(/[\s.,;:!?"'`´()[\]{}\-–—]+$/u, "")
    .trim();
}
