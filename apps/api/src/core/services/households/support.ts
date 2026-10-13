/**
 * Shared query helpers for the household services and the module services.
 *
 * Lives inside core/services/households/; the module services (M2+) import from
 * here as well, so the helpers exist exactly once.
 */
import { FOLD_PAIRS, foldText } from "@toon/shared";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Database } from "../../../db/client.ts";
import { env } from "../../../env.ts";

/** The transaction handle drizzle hands to `db.transaction(cb)`. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Anything that can run queries: the pooled drizzle instance or a transaction.
 * Every service function takes this so it can be composed inside a transaction
 * and so tests can pass an isolated in-memory database.
 */
export type DbLike = Database | Tx;

/**
 * KNOWN LIBSQL LIMITATION (verified with @libsql/client 0.17.4 + Bun 1.4.0; NOT
 * reproducible on 0.18.0 + Bun 1.4.2, where the memory DB survives the commit —
 * the degradation below is kept anyway, it is free and guards a regression):
 * `client.transaction()` opens a SECOND connection, and for an in-memory URL
 * (`file::memory:`) that second connection is a brand-new, EMPTY database —
 * after the transaction commits, every table is gone. File-backed databases
 * (self-hosted `file:./data/local.db`) and Turso are unaffected.
 *
 * Integration tests run with DATABASE_URL=file::memory: (forced by env.ts), so
 * `withTransaction` degrades to sequential execution there and uses a real
 * transaction in every other configuration. The statement order is identical,
 * so the tests still cover the full write path; only the rollback guarantee is
 * missing on the memory DB.
 */
export const transactionsSupported: boolean = !env.databaseUrl.includes(":memory:");

/** Runs `work` inside a transaction wherever libSQL supports one (see above). */
export async function withTransaction<T>(
  db: Database,
  work: (tx: DbLike) => Promise<T>,
): Promise<T> {
  if (!transactionsSupported) return work(db);
  return db.transaction(async (tx) => work(tx));
}

/** Current unix ms — one place so tests can reason about ordering. */
export function nowMs(): number {
  return Date.now();
}

/* -------------------------------------------------------------------------- */
/* German-friendly, case-insensitive text matching                            */
/* -------------------------------------------------------------------------- */

/**
 * SQLite's `lower()` only folds ASCII, so "Ä" would never match "ä" and
 * "Grieß" would never match "griess". We therefore fold BOTH sides (column and
 * search term) with the same replacement table before the LIKE comparison.
 * Umlauts are folded to their base letter so "Möhre" is found by "mohre" too.
 *
 * The table itself lives in `@toon/shared` (src/text.ts) because the web app and the
 * `name_key` column of the shopping-list tables fold with the SAME pairs. Importing
 * it here rather than repeating it is what keeps `foldSql` and `foldText` in step.
 */

/** Wraps a column/expression in `lower()` + the fold replacements. */
export function foldSql(expression: SQL | SQL.Aliased | unknown): SQL<string> {
  let folded = sql`lower(${expression})`;
  for (const [from, to] of FOLD_PAIRS) {
    folded = sql`replace(${folded}, ${from}, ${to})`;
  }
  return folded as SQL<string>;
}

/**
 * Applies the same folding as `foldSql` in JavaScript.
 * Re-exported from `@toon/shared` so existing call sites keep working.
 */
export { foldText };

/** Escapes LIKE wildcards; pair with `escape '\'` (see likeFolded). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * `<folded column> LIKE '%<folded term>%' ESCAPE '\'` — folds the COLUMN in SQL.
 *
 * Correct but expensive: the 23 `replace()` calls run per row, so this only
 * belongs on a small table (tag and collection names). For recipe search, where a
 * `count(*)` visits every row, use {@link likeStoredFold} against a pre-folded
 * column instead — see the `recipes` comment in src/db/schema.ts.
 */
export function likeFolded(expression: unknown, term: string): SQL<unknown> {
  const pattern = `%${escapeLike(foldText(term))}%`;
  // The doubled backslash is the TS escape: SQLite sees ESCAPE '\'.
  return sql`${foldSql(expression)} like ${pattern} escape '\\'`;
}

/**
 * Same comparison as {@link likeFolded}, but against a column that ALREADY holds a
 * folded value (`recipes.title_fold`, `recipe_ingredients.name_fold`, …). Only the
 * search term is folded here, in JS, once per query instead of once per row.
 *
 * Pass the column itself — wrapping it in `foldSql()` would fold twice. That is
 * harmless for the pairs we have (folding is idempotent: 'a' does not map to
 * anything) but it would silently reintroduce the per-row cost this exists to remove.
 */
export function likeStoredFold(column: unknown, term: string): SQL<unknown> {
  const pattern = `%${escapeLike(foldText(term))}%`;
  return sql`${column} like ${pattern} escape '\\'`;
}

/** Case-insensitive equality (German folded) for names, e.g. tag names. */
export function eqFolded(expression: unknown, value: string): SQL<unknown> {
  return sql`${foldSql(expression)} = ${foldText(value)}`;
}

/* -------------------------------------------------------------------------- */
/* misc                                                                       */
/* -------------------------------------------------------------------------- */

/** Turns rows of `{ key, value }` counts into a lookup map. */
export function toCountMap(rows: ReadonlyArray<{ key: string; value: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.key, Number(row.value));
  return map;
}

/** De-duplicates while keeping the first occurrence order. */
export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
