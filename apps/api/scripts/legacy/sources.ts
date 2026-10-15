/**
 * Opening the two legacy databases (plan m5 decisions 3 and 4).
 *
 * THE OPERATOR'S FILES ARE NEVER OPENED. Each input is first copied into the run's scratch
 * directory (`<db>` and `<db>-wal` when present, never `-shm`) and only the copy is opened,
 * with a plain `createClient` (NOT `createDatabase`: its `journal_mode = WAL` pragma would
 * rewrite the file header) followed by `PRAGMA query_only = 1`. The `-wal` copy is mandatory:
 * a WAL database whose pages have not been checkpointed yet keeps them ONLY in the WAL, so a
 * copy of the main file alone silently loses those rows (measured by the planner, plan m5
 * §1.1; `legacy-framework.test.ts` (a) pins it). The `-shm` is a per-host index SQLite
 * rebuilds from the WAL; a copied one could describe a different WAL state.
 *
 * Schema gate: the snapshot must sit at exactly the source's last drizzle migration
 * (`LEGACY_SCHEMAS`, plan m5 §1.2), else the run stops with exit 2 before anything is written.
 *
 * No module-scope code beyond imports and constants (decision 5: the CLI imports this file
 * dynamically, after its `DATABASE_URL` redirect).
 */
import { copyFileSync, existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { type Client, createClient, type InArgs } from "@libsql/client";
import type { LegacyDb, LegacySource, Row } from "./types.ts";

/** The drizzle journal each source must be at (plan m5 §1.2: count, last `when`, last tag). */
export const LEGACY_SCHEMAS = {
  recipe: { migrations: 9, lastCreatedAt: 1788859780811, lastTag: "0008_shopping_bought" },
  finance: { migrations: 3, lastCreatedAt: 1789194481486, lastTag: "0002_placeholder_members" },
} as const satisfies Record<LegacySource, { migrations: number; lastCreatedAt: number; lastTag: string }>;

/**
 * A usage or input problem found before anything is written (missing file, a directory, not a
 * SQLite database, wrong schema version). The CLI exits with {@link LegacyInputError.exitCode}.
 */
export class LegacyInputError extends Error {
  readonly exitCode = 2;
  override readonly name = "LegacyInputError";
}

/**
 * Copies `sourcePath` (and `sourcePath-wal` when present, never `-shm`) to `destPath`
 * (`destPath-wal`). The source is only read. A stale `-wal` / `-shm` beside `destPath` is
 * removed first, so the copy never pairs with another database's WAL.
 */
export function snapshotDatabase(sourcePath: string, destPath: string): { wal: boolean } {
  if (!existsSync(sourcePath)) {
    throw new LegacyInputError(`legacy database not found: ${sourcePath}`);
  }
  if (!statSync(sourcePath).isFile()) {
    throw new LegacyInputError(`legacy database is not a file: ${sourcePath}`);
  }
  for (const suffix of ["-wal", "-shm"]) rmSync(`${destPath}${suffix}`, { force: true });
  copyFileSync(sourcePath, destPath);
  const wal = `${sourcePath}-wal`;
  if (existsSync(wal) && statSync(wal).isFile()) {
    copyFileSync(wal, `${destPath}-wal`);
    return { wal: true };
  }
  return { wal: false };
}

/** The gate's refusal text (decision 4); `N of M` is what the operator compares. */
function schemaMessage(source: LegacySource, applied: number, lastCreatedAt: number | null): string {
  const expected = LEGACY_SCHEMAS[source];
  const head = `legacy ${source} database is at migration ${applied} of ${expected.migrations}`;
  const newer =
    applied > expected.migrations || (lastCreatedAt !== null && lastCreatedAt > expected.lastCreatedAt);
  if (newer) {
    return `${head}; it is newer than ${expected.lastTag} (${expected.lastCreatedAt}), which this migration tool was written for`;
  }
  const detail = ` (its last migration is from ${lastCreatedAt ?? "nowhere"}, expected ${expected.lastTag} at ${expected.lastCreatedAt})`;
  return `${head}${detail}; start the old app once (it migrates on boot) and copy it again`;
}

/**
 * Snapshots the legacy `source` database at `path` into `<scratchDir>/<source>.db`, opens the
 * copy read-only (`PRAGMA query_only = 1`) and checks its drizzle journal against
 * {@link LEGACY_SCHEMAS}. Throws {@link LegacyInputError} (and closes the copy) on any refusal.
 */
export async function openLegacy(source: LegacySource, path: string, scratchDir: string): Promise<LegacyDb> {
  const originalPath = resolve(path);
  const snapshotPath = resolve(scratchDir, `${source}.db`);
  try {
    snapshotDatabase(originalPath, snapshotPath);
  } catch (error) {
    if (error instanceof LegacyInputError) {
      throw new LegacyInputError(error.message.replace("legacy database", `legacy ${source} database`));
    }
    throw error;
  }
  const client = createClient({ url: `file:${snapshotPath}` });
  try {
    await checkSchema(source, client, originalPath);
  } catch (error) {
    client.close();
    throw error;
  }
  return { source, client, originalPath, snapshotPath };
}

async function checkSchema(source: LegacySource, client: Client, originalPath: string): Promise<void> {
  let hasJournal: boolean;
  try {
    await client.execute("PRAGMA query_only = 1");
    const table = await client.execute(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    );
    hasJournal = Number(table.rows[0]?.n ?? 0) > 0;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new LegacyInputError(`legacy ${source} database ${originalPath} cannot be read: ${reason}`);
  }
  let applied = 0;
  let lastCreatedAt: number | null = null;
  if (hasJournal) {
    const result = await client.execute(
      "SELECT count(*) AS n, max(CAST(created_at AS INTEGER)) AS last FROM __drizzle_migrations",
    );
    applied = Number(result.rows[0]?.n ?? 0);
    const last = result.rows[0]?.last;
    lastCreatedAt = last === null || last === undefined ? null : Number(last);
  }
  const expected = LEGACY_SCHEMAS[source];
  if (applied !== expected.migrations || lastCreatedAt !== expected.lastCreatedAt) {
    throw new LegacyInputError(schemaMessage(source, applied, lastCreatedAt));
  }
}

/** Runs a read on a legacy (or any) client and returns plain objects keyed by SQL column name. */
export async function readAll(legacy: Pick<LegacyDb, "client">, sql: string, args: InArgs = []): Promise<Row[]> {
  const result = await legacy.client.execute({ sql, args });
  return result.rows.map((row) => {
    const out: Row = {};
    result.columns.forEach((column, index) => {
      out[column] = row[index] ?? null;
    });
    return out;
  });
}
