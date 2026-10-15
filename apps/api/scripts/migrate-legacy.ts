/**
 * bun run migrate:legacy: the one-shot import of toon-recipe's and toon-finance's databases into
 * this app (SPEC section 6, plan m5 decisions 5, 6, 15 and 16).
 *
 * THE ORDER OF THIS FILE IS LOAD-BEARING. Everything in the legacy library reaches the shared
 * database client (and, through it, the env module, which freezes `DATABASE_URL` when it first
 * loads). A dry run must never open, create or switch to WAL the real target, so:
 *   - this file imports only node builtins and TYPES statically;
 *   - `main` resolves the environment itself (`resolveCliEnv`), copies the target into a scratch
 *     directory and points `process.env.DATABASE_URL` at that copy;
 *   - only then does it load the client, the migrator and the library, in the order
 *     `scripts/migrate.ts` and `import-order.test.ts` prove;
 *   - the env module is never loaded here, not even after the redirect (nothing in this file needs
 *     it: the target and the upload directory are resolved by `resolveCliEnv`).
 * `legacy-cli.test.ts` guards the order textually and by subprocess (a dry run leaves no target
 * file and no `-wal` behind).
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Client } from "@libsql/client";
import type { LegacyDb, MappingOverride, Report, TargetDb } from "./legacy/types.ts";

/** Monorepo root, computed here (the env module's own export may not be loaded; see above). */
const REPO_ROOT = resolve(import.meta.dir, "../../..");

export const USAGE = `Usage: bun run migrate:legacy -- [options]

Imports toon-recipe's and toon-finance's databases into the database named by DATABASE_URL.
Without --apply nothing is written: the whole migration runs against a scratch copy of the target
and prints the report (a dry run).

Options:
  --recipe-db <file>       toon-recipe's SQLite database (copy the whole data volume, WAL included)
  --recipe-uploads <dir>   toon-recipe's upload directory (needs --recipe-db)
  --finance-db <file>      toon-finance's SQLite database
  --mapping <json>         finance household -> recipe group overrides (needs --finance-db):
                           {"finance": {"<finance household id>": "<recipe group id>" | "new"}}
  --apply                  write the target (after a clean dry pass) and copy the uploads
  --report <file>          also write the report of the last pass as JSON
  --help                   print this text

At least one of --recipe-db and --finance-db is required. Relative paths resolve against the
repository root. The target is DATABASE_URL (a local file: URL, from the process environment or the
root .env); uploads go to UPLOAD_DIR (default ./data/uploads).

Exit codes: 0 success, 1 the run found errors, 2 usage, mapping or input error (nothing written).`;

/** A usage or environment problem found before anything is written (exit code 2). */
export class CliUsageError extends Error {
  readonly exitCode = 2;
  override readonly name = "CliUsageError";
}

/**
 * Merges the root `.env` and then `.env.local` into a COPY of `processEnv`: an existing value
 * wins, nothing is read when NODE_ENV is `test`.
 * Kept in step with the env module's `loadRootDotEnv`; that module cannot be loaded before the
 * redirect, so its line syntax (`export` prefix, quote stripping, trailing comments) is repeated.
 */
function mergeRootDotEnv(processEnv: NodeJS.ProcessEnv, repoRoot: string): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...processEnv };
  if (merged.NODE_ENV === "test") return merged;
  for (const file of [".env", ".env.local"]) {
    const path = join(repoRoot, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const key = match[1]!;
      if (merged[key] !== undefined) continue;
      let value = match[2]!.trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * The target database URL and the upload directory, both absolute. `DATABASE_URL` is required and
 * must be a local `file:` URL (a remote target is refused: the dry run needs a file to copy);
 * `UPLOAD_DIR` defaults to `./data/uploads`. Reads the root `.env` and `.env.local` like the env
 * module does, never writes `process.env`. Throws {@link CliUsageError}.
 */
export function resolveCliEnv(
  processEnv: NodeJS.ProcessEnv,
  repoRoot: string,
): { databaseUrl: string; uploadDir: string } {
  const merged = mergeRootDotEnv(processEnv, repoRoot);
  const raw = merged.DATABASE_URL;
  if (raw === undefined || raw === "") {
    throw new CliUsageError(
      "DATABASE_URL is not set (process environment or the repo's root .env); point it at the target, e.g. DATABASE_URL=file:./migration-out/toon.db",
    );
  }
  if (!raw.startsWith("file:")) {
    throw new CliUsageError(
      "DATABASE_URL must be a local file: URL (e.g. file:./migration-out/toon.db); migrate:legacy does not write to a remote database",
    );
  }
  const path = raw.slice("file:".length);
  if (path.length === 0 || path.startsWith(":memory:")) {
    throw new CliUsageError("DATABASE_URL names an in-memory database; point it at a file (e.g. file:./migration-out/toon.db)");
  }
  const absolute = isAbsolute(path) ? path : resolve(repoRoot, path);
  return { databaseUrl: `file:${absolute}`, uploadDir: resolve(repoRoot, merged.UPLOAD_DIR || "./data/uploads") };
}

interface CliOptions {
  recipeDb?: string;
  recipeUploads?: string;
  financeDb?: string;
  mapping?: string;
  apply: boolean;
  report?: string;
  help: boolean;
}

/** Parses argv (decision 16); every problem is a {@link CliUsageError}. Paths resolve against `repoRoot`. */
export function parseCliArgs(argv: string[], repoRoot: string): CliOptions {
  let values: {
    "recipe-db"?: string;
    "recipe-uploads"?: string;
    "finance-db"?: string;
    mapping?: string;
    apply?: boolean;
    report?: string;
    help?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        "recipe-db": { type: "string" },
        "recipe-uploads": { type: "string" },
        "finance-db": { type: "string" },
        mapping: { type: "string" },
        apply: { type: "boolean" },
        report: { type: "string" },
        help: { type: "boolean" },
      },
    }));
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }
  const path = (value: string | undefined): string | undefined => (value === undefined ? undefined : resolve(repoRoot, value));
  const options: CliOptions = { apply: values.apply === true, help: values.help === true };
  const recipeDb = path(values["recipe-db"]);
  const recipeUploads = path(values["recipe-uploads"]);
  const financeDb = path(values["finance-db"]);
  const mapping = path(values.mapping);
  const report = path(values.report);
  if (recipeDb) options.recipeDb = recipeDb;
  if (recipeUploads) options.recipeUploads = recipeUploads;
  if (financeDb) options.financeDb = financeDb;
  if (mapping) options.mapping = mapping;
  if (report) options.report = report;
  if (options.help) return options;
  if (!options.recipeDb && !options.financeDb) {
    throw new CliUsageError("give at least one of --recipe-db and --finance-db");
  }
  if (options.recipeUploads && !options.recipeDb) throw new CliUsageError("--recipe-uploads needs --recipe-db");
  if (options.mapping && !options.financeDb) throw new CliUsageError("--mapping needs --finance-db");
  return options;
}

/** Copies a target database (`<db>` and `<db>-wal` when present, never `-shm`) to `dest`. */
function snapshotTarget(source: string, dest: string): void {
  if (!existsSync(source)) return;
  if (!statSync(source).isFile()) throw new CliUsageError(`the target is not a file: ${source}`);
  copyFileSync(source, dest);
  if (existsSync(`${source}-wal`)) copyFileSync(`${source}-wal`, `${dest}-wal`);
}

function isExitTwo(error: unknown): error is Error & { exitCode: 2 } {
  return error instanceof Error && (error as { exitCode?: unknown }).exitCode === 2;
}

export async function main(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const closers: (() => void)[] = [];
  let scratch: string | undefined;
  try {
    // a. arguments and usage
    const options = parseCliArgs(argv, REPO_ROOT);
    if (options.help) {
      console.log(USAGE);
      return 0;
    }

    // b. the environment, resolved without the env module
    const { databaseUrl, uploadDir } = resolveCliEnv(env, REPO_ROOT);
    const targetPath = databaseUrl.slice("file:".length);
    console.log(
      options.apply
        ? `[migrate:legacy] mode: apply (target ${targetPath})`
        : `[migrate:legacy] mode: dry-run (nothing is written to ${targetPath})`,
    );
    console.log(`[migrate:legacy] uploads: ${uploadDir}`);

    // c. the scratch copy of the target; the shared client must open THAT file
    scratch = mkdtempSync(join(tmpdir(), "toon-migrate-legacy-"));
    const scratchTarget = join(scratch, "target.db");
    snapshotTarget(targetPath, scratchTarget);
    process.env.DATABASE_URL = `file:${scratchTarget}`;
    process.env.SESSION_SECRET ||= "migrate-legacy-does-not-use-the-session-secret";

    // d. the library, loaded only now
    const { client: scratchClient, db: scratchDb, dbReady, createDatabase } = await import("../src/db/client.ts");
    const { runMigrations } = await import("../src/db/migrate.ts");
    const { openLegacy } = await import("./legacy/sources.ts");
    const { parseMappingFile } = await import("./legacy/mapping.ts");
    const { exitCodeFor, renderReport, reportToJson } = await import("./legacy/report.ts");
    const { knownLegacyIds, runLegacyMigration } = await import("./legacy/run.ts");
    closers.push(() => scratchClient.close());

    // e. inputs and the mapping, before any pass writes anything
    const recipe: LegacyDb | undefined = options.recipeDb ? await openLegacy("recipe", options.recipeDb, scratch) : undefined;
    if (recipe) closers.push(() => recipe.client.close());
    const finance: LegacyDb | undefined = options.financeDb ? await openLegacy("finance", options.financeDb, scratch) : undefined;
    if (finance) closers.push(() => finance.client.close());
    let mapping: MappingOverride | undefined;
    if (options.mapping) {
      if (!existsSync(options.mapping) || !statSync(options.mapping).isFile()) {
        throw new CliUsageError(`--mapping: file not found: ${options.mapping}`);
      }
      mapping = parseMappingFile(readFileSync(options.mapping, "utf8"), await knownLegacyIds(recipe, finance));
    }
    const common = {
      ...(recipe ? { recipe } : {}),
      ...(finance ? { finance } : {}),
      ...(mapping ? { mapping } : {}),
    };

    // f. pass 1: the scratch copy, uploads planned and never copied
    await dbReady;
    await runMigrations(scratchDb);
    const dryTarget: TargetDb = { db: scratchDb, client: scratchClient, url: databaseUrl };
    const dryReport: Report = await runLegacyMigration({
      ...common,
      mode: "dry-run",
      target: dryTarget,
      uploads: { ...(options.recipeUploads ? { sourceDir: options.recipeUploads } : {}), targetDir: uploadDir, copy: false },
    });
    let last = dryReport;
    let code: number = exitCodeFor(dryReport);
    if (!options.apply || code !== 0) {
      process.stdout.write(renderReport(dryReport));
    } else {
      // g. --apply: the dry pass was clean, so write the real target
      console.log(`[migrate:legacy] dry pass clean; writing ${targetPath}`);
      const real = createDatabase({ url: databaseUrl });
      closers.push(() => real.client.close());
      await real.ready;
      await runMigrations(real.db);
      const applied: Report = await runLegacyMigration({
        ...common,
        mode: "apply",
        target: { db: real.db, client: real.client as Client, url: databaseUrl },
        uploads: { ...(options.recipeUploads ? { sourceDir: options.recipeUploads } : {}), targetDir: uploadDir, copy: true },
      });
      // the rows sit in the WAL until a checkpoint: leave one self-contained file behind (the
      // operator copies the target to the server)
      await real.client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
      process.stdout.write(renderReport(applied));
      last = applied;
      code = exitCodeFor(applied);
    }

    // h. the JSON report of the last pass
    if (options.report) {
      mkdirSync(dirname(options.report), { recursive: true });
      writeFileSync(options.report, reportToJson(last));
    }
    return code;
  } catch (error) {
    if (isExitTwo(error)) {
      console.error(`[migrate:legacy] error: ${error.message}`);
      if (error instanceof CliUsageError) console.error("Run with --help for the usage.");
      console.error("[migrate:legacy] nothing was written.");
      return 2;
    }
    throw error;
  } finally {
    for (const close of closers.reverse()) {
      try {
        close();
      } catch {
        // already closed
      }
    }
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exitCode = await main();
