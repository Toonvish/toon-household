/**
 * The schema-driven, chunked row copier (plan m5 decisions 7 and 8, SPEC §6.5).
 *
 * - Legacy rows are read by `rowid` keyset (`WHERE rowid > ? ORDER BY rowid LIMIT <chunk>`), so
 *   a large table never sits in memory and the order is stable.
 * - Each chunk's ledger entries are prefetched with `lookupMany`; a mapped row is counted
 *   "already migrated" and never touched (also never updated).
 * - Inserts are raw parametrised SQL whose column list is the TARGET table's SQL columns
 *   (`getTableConfig`). Values pass as SQLite storage values (booleans 0/1, JSON as text, reals
 *   as reals): no drizzle mode conversion.
 * - The transformed row's key set must EQUAL the target's column set; anything else is a
 *   programming error and throws before the chunk is sent (no column is dropped silently).
 * - One `client.batch([...rowInserts, ...ledgerInserts], "write")` per chunk (atomic). A batch
 *   that fails is retried row by row; a row that still fails is recorded in `skipped` with
 *   `error: true` and `reason: "insert failed: <libSQL message>"`, gets no ledger entry, and the
 *   other rows proceed (the run then exits 1).
 *
 * No module-scope code beyond imports and constants (decision 5).
 */
import type { InStatement, Value } from "@libsql/client";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { ledgerStatement, lookupMany } from "./ledger.ts";
import { addCount } from "./report.ts";
import type { LegacySource, MigrationContext, Row, TableCount } from "./types.ts";

/** Rows per batch (SPEC §6.5). `MigrationContext.chunkSize` carries it; tests lower it. */
export const CHUNK_SIZE = 500;

/** The legacy row's rowid travels under this alias and is stripped before `transform`. */
const ROWID_ALIAS = "__legacy_rowid";

/** A bug in a step's transform or entry (wrong column set, undefined value): never caught. */
export class CopyProgrammingError extends Error {
  override readonly name = "CopyProgrammingError";
}

/** One row (or a ledger-only decision) to write, with the ledger entries recorded beside it. */
export interface WriteEntry {
  /** The target row in SQL column names; `null` writes only the ledger entries (e.g. a merge decision). */
  values: Row | null;
  /** Ledger entries; `table` defaults to the target table's SQL name. */
  ledger: { source: LegacySource; legacyId: string; table?: string }[];
  /** The `new_id` every ledger entry of this entry records. */
  newId: string;
  /** Human-readable name for warnings and errors, e.g. `users anna@example.test`. */
  label: string;
}

/** What a transform returns for a row that is not written. */
export interface SkipResult {
  skip: string;
  error?: boolean;
}

export interface CopySpec {
  source: LegacySource;
  /** The legacy table's SQL name. */
  legacyTable: string;
  /** The target drizzle table. */
  target: SQLiteTable;
  /** The ledger key of a legacy row; default `row.id`. Composite keys are `<a>:<b>`. */
  legacyId?(row: Row): string;
  /** The target row in SQL column names (exactly the target's column set) or a skip. */
  transform(row: Row, ctx: MigrationContext): Row | SkipResult;
  /** The new id the ledger records; default `values.id ?? legacyId`. */
  newId?(values: Row, row: Row): string;
  /** The ledger's `table` value; default the target's SQL name. */
  ledgerTable?: string;
}

/** SQL table name of a drizzle table. */
export function tableName(table: SQLiteTable): string {
  return getTableConfig(table).name;
}

/** The target table's column SQL names, in schema order. */
export function columnNames(table: SQLiteTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

/** A copy of `row` with keys renamed (`{ group_id: "household_id" }`); other keys are kept. */
export function renameColumns(row: Row, renames: Record<string, string>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[renames[key] ?? key] = value;
  return out;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * The INSERT of one target row. Throws {@link CopyProgrammingError} unless the key set of
 * `values` equals the target's column set and no value is `undefined`.
 */
export function insertStatement(table: SQLiteTable, values: Row): InStatement {
  const name = tableName(table);
  const columns = columnNames(table);
  const keys = Object.keys(values);
  const missing = columns.filter((column) => !Object.hasOwn(values, column));
  const extra = keys.filter((key) => !columns.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new CopyProgrammingError(
      `programming error: the row for ${name} does not match its columns (missing: ${missing.join(", ") || "-"}; extra: ${extra.join(", ") || "-"})`,
    );
  }
  const undefinedColumns = columns.filter((column) => values[column] === undefined);
  if (undefinedColumns.length > 0) {
    throw new CopyProgrammingError(
      `programming error: the row for ${name} has undefined values in ${undefinedColumns.join(", ")}`,
    );
  }
  return {
    sql: `INSERT INTO ${quoteIdent(name)} (${columns.map(quoteIdent).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    args: columns.map((column) => values[column] as Value),
  };
}

function entryStatements(table: SQLiteTable, entry: WriteEntry): InStatement[] {
  const defaultTable = tableName(table);
  const rows = entry.values === null ? [] : [insertStatement(table, entry.values)];
  const ledger = entry.ledger.map((item) =>
    ledgerStatement(item.table ?? defaultTable, item.source, item.legacyId, entry.newId),
  );
  return [...rows, ...ledger];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Records a skipped row (and, for an error, one line in `report.errors`). */
export function recordSkip(
  ctx: MigrationContext,
  count: TableCount,
  legacyId: string,
  reason: string,
  error: boolean,
): void {
  count.skipped += 1;
  ctx.report.skipped.push({ table: count.table, source: count.source, legacyId, reason, error });
  if (error) ctx.report.errors.push(`${count.table} (${count.source}) ${legacyId}: ${reason}`);
}

/**
 * Writes `entries` in chunks of `ctx.chunkSize`: one atomic batch per chunk with every row
 * insert followed by every ledger insert; a failed batch is retried entry by entry, and an
 * entry that still fails is skipped as an error (no ledger entry). Adds to `count.written` /
 * `count.skipped` (the caller adds `count` to the report with `addCount` once it is complete).
 * Returns the entries that were written. Every statement is built before the first batch, so a
 * {@link CopyProgrammingError} leaves the target untouched.
 */
export async function writeEntries(
  ctx: MigrationContext,
  table: SQLiteTable,
  entries: readonly WriteEntry[],
  count: TableCount,
): Promise<WriteEntry[]> {
  const prepared = entries.map((entry) => ({ entry, statements: entryStatements(table, entry) }));
  const written: WriteEntry[] = [];
  const chunkSize = Math.max(1, ctx.chunkSize);
  for (let start = 0; start < prepared.length; start += chunkSize) {
    const chunk = prepared.slice(start, start + chunkSize);
    const rowStatements = chunk.flatMap(({ entry, statements }) =>
      entry.values === null ? [] : statements.slice(0, 1),
    );
    const ledgerStatements = chunk.flatMap(({ entry, statements }) =>
      entry.values === null ? statements : statements.slice(1),
    );
    try {
      await ctx.target.client.batch([...rowStatements, ...ledgerStatements], "write");
      for (const { entry } of chunk) written.push(entry);
      count.written += chunk.length;
      continue;
    } catch {
      // fall through to the per-row retry: the batch was rolled back as a whole
    }
    for (const { entry, statements } of chunk) {
      try {
        await ctx.target.client.batch(statements, "write");
        written.push(entry);
        count.written += 1;
      } catch (error) {
        const legacyId = entry.ledger[0]?.legacyId ?? entry.newId;
        recordSkip(ctx, count, legacyId, `insert failed: ${errorMessage(error)}`, true);
      }
    }
  }
  return written;
}

function isSkip(result: Row | SkipResult): result is SkipResult {
  return (
    typeof (result as SkipResult).skip === "string" &&
    Object.keys(result).every((key) => key === "skip" || key === "error")
  );
}

/**
 * Copies one legacy table into one target table (decision 8): keyset reads, ledger prefetch,
 * transform, {@link writeEntries}. Records the returned count in `ctx.report` (`addCount`), so
 * the caller does not add it again.
 */
export async function copyTable(ctx: MigrationContext, spec: CopySpec): Promise<TableCount> {
  const legacy = ctx[spec.source];
  if (!legacy) {
    throw new CopyProgrammingError(`programming error: copyTable(${spec.legacyTable}) without a ${spec.source} database`);
  }
  const target = tableName(spec.target);
  const ledgerTable = spec.ledgerTable ?? target;
  const count: TableCount = { table: target, source: spec.source, read: 0, written: 0, alreadyMigrated: 0, skipped: 0 };
  const chunkSize = Math.max(1, ctx.chunkSize);
  let lastRowid: Value = -1;
  for (;;) {
    const result = await legacy.client.execute({
      sql: `SELECT rowid AS ${ROWID_ALIAS}, * FROM ${quoteIdent(spec.legacyTable)} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      args: [lastRowid, chunkSize],
    });
    if (result.rows.length === 0) break;
    const rows: Row[] = result.rows.map((raw) => {
      const row: Row = {};
      result.columns.forEach((column, index) => {
        row[column] = raw[index] ?? null;
      });
      return row;
    });
    lastRowid = rows[rows.length - 1]?.[ROWID_ALIAS] ?? lastRowid;
    for (const row of rows) delete row[ROWID_ALIAS];
    count.read += rows.length;

    const legacyIdOf = (row: Row): string => (spec.legacyId ? spec.legacyId(row) : String(row.id));
    const existing = await lookupMany(ctx.target.client, ledgerTable, spec.source, rows.map(legacyIdOf));
    const entries: WriteEntry[] = [];
    for (const row of rows) {
      const legacyId = legacyIdOf(row);
      if (existing.has(legacyId)) {
        count.alreadyMigrated += 1;
        continue;
      }
      const transformed = spec.transform(row, ctx);
      if (isSkip(transformed)) {
        recordSkip(ctx, count, legacyId, transformed.skip, transformed.error === true);
        continue;
      }
      const newId = spec.newId
        ? spec.newId(transformed, row)
        : typeof transformed.id === "string"
          ? transformed.id
          : legacyId;
      entries.push({
        values: transformed,
        ledger: [{ source: spec.source, legacyId, table: ledgerTable }],
        newId,
        label: `${spec.legacyTable} ${legacyId}`,
      });
    }
    if (entries.length > 0) await writeEntries(ctx, spec.target, entries, count);
    if (rows.length < chunkSize) break;
  }
  addCount(ctx.report, count);
  return count;
}
