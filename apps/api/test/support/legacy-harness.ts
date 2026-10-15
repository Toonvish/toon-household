/**
 * Shared setup of the `migrate:legacy` tests (plan m5 M5-T03). Later tasks import it and never
 * edit it; a task that needs more setup writes it in its own test file.
 *
 * `createLegacyRun` copies the committed fixtures (`test/fixtures/legacy/`) into a fresh temp
 * directory, opens both with `openLegacy` (snapshots in `<tmp>/scratch`), creates a TEMP FILE target
 * (`createDatabase` + `runMigrations`, never the shared `file::memory:` db) and returns a ready
 * `MigrationContext`. Nothing here touches `env.uploadDir`: the upload target is an explicit
 * `<tmp>/uploads-target` directory.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { createDatabase } from "../../src/db/client.ts";
import { runMigrations } from "../../src/db/migrate.ts";
import { createReport } from "../../scripts/legacy/report.ts";
import { openLegacy } from "../../scripts/legacy/sources.ts";
import type { MappingOverride, MigrationContext, Mode, TargetDb } from "../../scripts/legacy/types.ts";

/** The committed fixtures (recipe.db, finance.db, uploads/). */
export const FIXTURE_DIR = join(import.meta.dir, "../fixtures/legacy");

export interface LegacyRunOptions {
  mode?: Mode;
  mapping?: MappingOverride;
  chunkSize?: number;
  /** Copy the fixture `uploads/` to `<tmp>/uploads-source` and point the context at it. */
  withUploads?: boolean;
}

export interface LegacyRun {
  /** The temp directory everything lives in. */
  dir: string;
  ctx: MigrationContext;
  target: TargetDb;
  /** The operator-side copies the snapshots were taken from (hash these to prove they are untouched). */
  recipePath: string;
  financePath: string;
  uploadsSource: string | undefined;
  uploadsTarget: string;
  /** Closes every client and removes the temp directory. */
  cleanup(): void;
}

/** A fresh, migrated, empty target database on a temp file. */
export async function createTarget(dir: string, name = "target.db"): Promise<TargetDb> {
  const url = `file:${join(dir, name)}`;
  const created = createDatabase({ url });
  await created.ready;
  await runMigrations(created.db);
  return { db: created.db, client: created.client, url };
}

export async function createLegacyRun(options: LegacyRunOptions = {}): Promise<LegacyRun> {
  const dir = mkdtempSync(join(tmpdir(), "toon-legacy-run-"));
  const input = join(dir, "input");
  const scratch = join(dir, "scratch");
  const uploadsTarget = join(dir, "uploads-target");
  mkdirSync(input, { recursive: true });
  mkdirSync(scratch, { recursive: true });
  mkdirSync(uploadsTarget, { recursive: true });
  const recipePath = join(input, "recipe.db");
  const financePath = join(input, "finance.db");
  cpSync(join(FIXTURE_DIR, "recipe.db"), recipePath);
  cpSync(join(FIXTURE_DIR, "finance.db"), financePath);
  let uploadsSource: string | undefined;
  if (options.withUploads) {
    uploadsSource = join(dir, "uploads-source");
    cpSync(join(FIXTURE_DIR, "uploads"), uploadsSource, { recursive: true });
  }
  const mode: Mode = options.mode ?? "dry-run";
  const recipe = await openLegacy("recipe", recipePath, scratch);
  const finance = await openLegacy("finance", financePath, scratch);
  const target = await createTarget(dir);
  const ctx: MigrationContext = {
    mode,
    recipe,
    finance,
    target,
    ids: {
      users: { recipe: new Map(), finance: new Map() },
      households: { recipe: new Map(), finance: new Map() },
    },
    report: createReport(mode, target.url),
    uploads: { ...(uploadsSource ? { sourceDir: uploadsSource } : {}), targetDir: uploadsTarget, copy: mode === "apply" },
    ...(options.mapping ? { mapping: options.mapping } : {}),
    chunkSize: options.chunkSize ?? 500,
  };
  return {
    dir,
    ctx,
    target,
    recipePath,
    financePath,
    uploadsSource,
    uploadsTarget,
    cleanup() {
      recipe.client.close();
      finance.client.close();
      target.client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** `SELECT count(*) FROM <table>` (the table name is a trusted literal). */
export async function countRows(client: Client, table: string): Promise<number> {
  const result = await client.execute(`SELECT count(*) AS n FROM "${table.replaceAll('"', '""')}"`);
  return Number(result.rows[0]?.n ?? 0);
}
