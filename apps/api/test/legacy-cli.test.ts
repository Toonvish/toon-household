/**
 * `runLegacyMigration`, the `migrate:legacy` CLI and `resolveCliEnv` (plan m5 M5-T08, decisions
 * 5 to 7, 15, 16 and 18) against the committed fixtures (`test/fixtures/legacy/`, facts in
 * `facts.ts`).
 *
 * Three layers: the orchestrator in-process on temp file databases (a full apply, a second run
 * that writes nothing, a chunked run resumed after an interruption), the real CLI in a
 * subprocess (at most seven spawns: dry run on an absent target, apply, re-apply, dry run on the
 * migrated target, a bad mapping, the JSON report, a remote target), and the CLI's source order
 * (a textual guard; the subprocess cases are the behavioural proof that a dry run never touches
 * the real target).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { migrateHouseholds } from "../scripts/legacy/households.ts";
import { migrateRecipe } from "../scripts/legacy/recipe.ts";
import { exitCodeFor, totalWritten } from "../scripts/legacy/report.ts";
import { runLegacyMigration } from "../scripts/legacy/run.ts";
import { migrateUsers } from "../scripts/legacy/users.ts";
import { CliUsageError, resolveCliEnv } from "../scripts/migrate-legacy.ts";
import { EXPECTED, FINANCE_HOUSEHOLDS, GROUPS } from "./fixtures/legacy/facts.ts";
import { countRows, createLegacyRun, FIXTURE_DIR, type LegacyRun, sha256File } from "./support/legacy-harness.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const CLI_PATH = join(REPO_ROOT, "apps/api/scripts/migrate-legacy.ts");

const runs: LegacyRun[] = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function tableNames(run: LegacyRun): Promise<string[]> {
  const result = await run.target.client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name",
  );
  return result.rows.map((row) => String(row.name));
}

async function allCounts(run: LegacyRun): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const name of await tableNames(run)) counts[name] = await countRows(run.target.client, name);
  return counts;
}

function options(run: LegacyRun, overrides: { chunkSize?: number } = {}) {
  return {
    mode: "apply" as const,
    recipe: run.ctx.recipe,
    finance: run.ctx.finance,
    target: run.target,
    uploads: run.ctx.uploads,
    ...overrides,
  };
}

describe("runLegacyMigration (in-process)", () => {
  test("one full apply gives every expected count, four OK balances and exit code 0", async () => {
    const run = await createLegacyRun({ mode: "apply", withUploads: true });
    runs.push(run);
    const report = await runLegacyMigration(options(run));

    expect(report.errors).toEqual([]);
    expect(exitCodeFor(report)).toBe(0);
    expect(report.inputs.map((input) => input.source)).toEqual(["recipe", "finance"]);
    expect(report.inputs[0]?.tables.recipes).toBe(EXPECTED.legacyRows.recipe.recipes!);
    expect(report.inputs[1]?.tables.transactions).toBe(EXPECTED.legacyRows.finance.transactions!);

    expect(await countRows(run.target.client, "users")).toBe(EXPECTED.users);
    expect(await countRows(run.target.client, "households")).toBe(EXPECTED.households);
    expect(await countRows(run.target.client, "household_modules")).toBe(EXPECTED.householdModules);
    expect(await countRows(run.target.client, "finance_participants")).toBe(EXPECTED.financeParticipants);
    expect(await countRows(run.target.client, "finance_settings")).toBe(EXPECTED.financeSettings);
    expect(await countRows(run.target.client, "finance_incomes")).toBe(EXPECTED.financeIncomes);
    expect(await countRows(run.target.client, "finance_transactions")).toBe(EXPECTED.legacyRows.finance.transactions!);
    expect(await countRows(run.target.client, "recipe_recipes")).toBe(EXPECTED.legacyRows.recipe.recipes!);

    expect(report.balances).toHaveLength(EXPECTED.balances.rows);
    expect(report.balances.filter((balance) => balance.ok)).toHaveLength(EXPECTED.balances.ok);
    expect(report.uploads?.copied).toBe(EXPECTED.uploads.copied);
    expect(report.uploads?.missingReferenced).toHaveLength(EXPECTED.uploads.missingReferenced);
    expect(readdirSync(run.uploadsTarget)).toHaveLength(EXPECTED.uploads.sourceFiles);
    expect(report.users.collisions).toHaveLength(EXPECTED.collisions);
  });

  test("a second full run writes 0 rows and copies 0 files", async () => {
    const run = await createLegacyRun({ mode: "apply", withUploads: true });
    runs.push(run);
    await runLegacyMigration(options(run));
    const before = await allCounts(run);

    const second = await runLegacyMigration(options(run));
    expect(second.errors).toEqual([]);
    expect(exitCodeFor(second)).toBe(0);
    expect(totalWritten(second)).toBe(0);
    expect(second.uploads?.copied).toBe(0);
    expect(second.uploads?.alreadyPresent).toBe(EXPECTED.uploads.sourceFiles);
    expect(second.balances.filter((balance) => balance.ok)).toHaveLength(EXPECTED.balances.ok);
    expect(await allCounts(run)).toEqual(before);
  });

  test("a chunked run interrupted after the recipe step resumes to the same final counts", async () => {
    const reference = await createLegacyRun({ mode: "apply", withUploads: true });
    runs.push(reference);
    await runLegacyMigration(options(reference));
    const expected = await allCounts(reference);

    const run = await createLegacyRun({ mode: "apply", withUploads: true, chunkSize: 3 });
    runs.push(run);
    // the interrupted run: everything up to the end of migrateRecipe, nothing after it
    await migrateUsers(run.ctx);
    await migrateHouseholds(run.ctx);
    await migrateRecipe(run.ctx);
    expect(await countRows(run.target.client, "finance_transactions")).toBe(0);
    expect(await countRows(run.target.client, "recipe_recipes")).toBe(EXPECTED.legacyRows.recipe.recipes!);

    const resumed = await runLegacyMigration(options(run, { chunkSize: 3 }));
    expect(resumed.errors).toEqual([]);
    expect(exitCodeFor(resumed)).toBe(0);
    expect(resumed.balances.filter((balance) => balance.ok)).toHaveLength(EXPECTED.balances.ok);
    expect(await allCounts(run)).toEqual(expected);
  });

  test("a bad raw mapping is refused before anything is written", async () => {
    const run = await createLegacyRun({ mode: "apply" });
    runs.push(run);
    const bad = { [FINANCE_HOUSEHOLDS.FH1.id]: GROUPS.G1.id, [FINANCE_HOUSEHOLDS.FH2.id]: GROUPS.G1.id };
    await expect(runLegacyMigration({ ...options(run), mapping: bad })).rejects.toMatchObject({ exitCode: 2 });
    expect(await countRows(run.target.client, "users")).toBe(0);
    expect(await countRows(run.target.client, "legacy_ids")).toBe(0);
  });
});

/* ------------------------------------ the CLI ---------------------------------- */

interface Spawned {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the CLI exactly as `bun run migrate:legacy` does (decision 18: a real NODE_ENV, absolute paths). */
function cli(args: string[], env: Record<string, string>): Spawned {
  const proc = Bun.spawnSync({
    cmd: ["bun", CLI_PATH, ...args],
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: "development", SESSION_SECRET: "0123456789abcdef0123456789abcdef", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const RECIPE_DB = join(FIXTURE_DIR, "recipe.db");
const FINANCE_DB = join(FIXTURE_DIR, "finance.db");
const FIXTURE_UPLOADS = join(FIXTURE_DIR, "uploads");
const INPUT_ARGS = ["--recipe-db", RECIPE_DB, "--recipe-uploads", FIXTURE_UPLOADS, "--finance-db", FINANCE_DB];

async function targetCounts(path: string): Promise<Record<string, number>> {
  const client = createClient({ url: `file:${path}` });
  try {
    const names = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const counts: Record<string, number> = {};
    for (const row of names.rows) counts[String(row.name)] = await countRows(client, String(row.name));
    return counts;
  } finally {
    client.close();
  }
}

describe("migrate:legacy (subprocess)", () => {
  test("dry run, apply, re-apply, dry run on the migrated target, bad mapping, report, remote target", async () => {
    const dir = tempDir("toon-legacy-cli-");
    const target = join(dir, "target.db");
    const uploads = join(dir, "uploads");
    const env = { DATABASE_URL: `file:${target}`, UPLOAD_DIR: uploads };
    const fixtureHashes = [RECIPE_DB, FINANCE_DB].map(sha256File);

    // (a) dry run against an absent target
    const dry = cli(INPUT_ARGS, env);
    expect(dry.stderr).toBe("");
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain("== Household mapping proposal ==");
    for (const key of ["FH1", "FH2", "FH3", "FH4", "FH5"] as const) {
      expect(dry.stdout).toContain(FINANCE_HOUSEHOLDS[key].name);
    }
    expect(dry.stdout).toContain("== Finance balance per household ==");
    expect(dry.stdout.match(/ OK$/gm)).toHaveLength(EXPECTED.balances.ok);
    expect(dry.stdout).toMatch(/\[migrate:legacy\] dry run complete: \d+ rows would be written, \d+ files would be copied\. Nothing was written\.\n$/);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}-wal`)).toBe(false);
    expect(existsSync(uploads)).toBe(false);
    expect([RECIPE_DB, FINANCE_DB].map(sha256File)).toEqual(fixtureHashes);

    // (b) apply
    const applied = cli([...INPUT_ARGS, "--apply"], env);
    expect(applied.stderr).toBe("");
    expect(applied.code).toBe(0);
    expect(applied.stdout).toMatch(/\[migrate:legacy\] applied: \d+ rows written, 7 files copied\.\n$/);
    const migrated = await targetCounts(target);
    expect(migrated.users).toBe(EXPECTED.users);
    expect(readdirSync(uploads)).toHaveLength(EXPECTED.uploads.sourceFiles);
    expect([RECIPE_DB, FINANCE_DB].map(sha256File)).toEqual(fixtureHashes);

    // (c) the second apply writes nothing
    const again = cli([...INPUT_ARGS, "--apply"], env);
    expect(again.code).toBe(0);
    expect(again.stdout.endsWith("[migrate:legacy] already migrated: nothing written.\n")).toBe(true);
    expect(await targetCounts(target)).toEqual(migrated);

    // (d) a dry run against the migrated target leaves the real files byte-identical
    const hashes = () => [target, `${target}-wal`].map((path) => (existsSync(path) ? sha256File(path) : "absent"));
    const before = hashes();
    const dryAgain = cli(INPUT_ARGS, env);
    expect(dryAgain.code).toBe(0);
    expect(dryAgain.stdout).toContain(
      "[migrate:legacy] dry run complete: already migrated, nothing would be written. Nothing was written.",
    );
    expect(hashes()).toEqual(before);
    expect(existsSync(`${target}-wal`) ? statSync(`${target}-wal`).size : 0).toBe(0);
    expect(await targetCounts(target)).toEqual(migrated);

    // (e) a mapping naming one group twice is refused with exit 2 before anything is written
    const mapping = join(dir, "mapping.json");
    writeFileSync(
      mapping,
      JSON.stringify({ finance: { [FINANCE_HOUSEHOLDS.FH1.id]: GROUPS.G1.id, [FINANCE_HOUSEHOLDS.FH2.id]: GROUPS.G1.id } }),
    );
    const badMapping = cli([...INPUT_ARGS, "--mapping", mapping, "--apply"], env);
    expect(badMapping.code).toBe(2);
    expect(badMapping.stderr).toContain("both name recipe group");
    expect(hashes()).toEqual(before);

    // (f) --report writes the JSON of the last pass
    const reportPath = join(dir, "out", "r.json");
    const reported = cli([...INPUT_ARGS, "--report", reportPath], env);
    expect(reported.code).toBe(0);
    const json = JSON.parse(readFileSync(reportPath, "utf8")) as { balances: unknown[]; summary: { exitCode: number } };
    expect(json.balances).toHaveLength(EXPECTED.balances.rows);
    expect(json.summary.exitCode).toBe(0);

    // (g) a remote target is refused
    const remote = cli(INPUT_ARGS, { ...env, DATABASE_URL: "libsql://example.invalid" });
    expect(remote.code).toBe(2);
    expect(remote.stderr).toContain("DATABASE_URL must be a local file: URL");
  }, 120_000);
});

/* -------------------------------- resolveCliEnv -------------------------------- */

describe("resolveCliEnv", () => {
  test("a root .env supplies DATABASE_URL and UPLOAD_DIR, resolved against the repo root", () => {
    const root = tempDir("toon-cli-env-");
    writeFileSync(join(root, ".env"), "DATABASE_URL=file:./x.db\nUPLOAD_DIR=./up\n");
    expect(resolveCliEnv({}, root)).toEqual({ databaseUrl: `file:${join(root, "x.db")}`, uploadDir: join(root, "up") });
  });

  test("the .env line syntax of the env module: export prefix, quotes, trailing comments", () => {
    const root = tempDir("toon-cli-env-");
    writeFileSync(join(root, ".env"), `export DATABASE_URL="file:./q.db"\nUPLOAD_DIR=./u # the uploads\n`);
    expect(resolveCliEnv({}, root)).toEqual({ databaseUrl: `file:${join(root, "q.db")}`, uploadDir: join(root, "u") });
  });

  test("the upload directory defaults to ./data/uploads", () => {
    const root = tempDir("toon-cli-env-");
    expect(resolveCliEnv({ DATABASE_URL: "file:/abs/t.db" }, root)).toEqual({
      databaseUrl: "file:/abs/t.db",
      uploadDir: join(root, "data/uploads"),
    });
  });

  test("a process-env DATABASE_URL wins over .env", () => {
    const root = tempDir("toon-cli-env-");
    writeFileSync(join(root, ".env"), "DATABASE_URL=file:./x.db\n");
    expect(resolveCliEnv({ DATABASE_URL: "file:./y.db" }, root).databaseUrl).toBe(`file:${join(root, "y.db")}`);
  });

  test(".env.local fills a key .env lacks and never overrides .env", () => {
    const root = tempDir("toon-cli-env-");
    writeFileSync(join(root, ".env"), "DATABASE_URL=file:./x.db\n");
    writeFileSync(join(root, ".env.local"), "DATABASE_URL=file:./other.db\nUPLOAD_DIR=./local-up\n");
    expect(resolveCliEnv({}, root)).toEqual({ databaseUrl: `file:${join(root, "x.db")}`, uploadDir: join(root, "local-up") });
  });

  test("no DATABASE_URL anywhere is an exit-2 error with the documented message", () => {
    const root = tempDir("toon-cli-env-");
    let error: unknown;
    try {
      resolveCliEnv({}, root);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CliUsageError);
    expect((error as CliUsageError).exitCode).toBe(2);
    expect((error as CliUsageError).message).toBe(
      "DATABASE_URL is not set (process environment or the repo's root .env); point it at the target, e.g. DATABASE_URL=file:./migration-out/toon.db",
    );
  });

  test("a remote or in-memory URL is an exit-2 error", () => {
    const root = tempDir("toon-cli-env-");
    for (const url of ["libsql://example.turso.io", "https://example.test", "file::memory:"]) {
      expect(() => resolveCliEnv({ DATABASE_URL: url }, root)).toThrow(CliUsageError);
    }
  });

  test("NODE_ENV=test ignores the .env files", () => {
    const root = tempDir("toon-cli-env-");
    writeFileSync(join(root, ".env"), "DATABASE_URL=file:./x.db\n");
    expect(() => resolveCliEnv({ NODE_ENV: "test" }, root)).toThrow(CliUsageError);
    expect(resolveCliEnv({ NODE_ENV: "test", DATABASE_URL: "file:./p.db" }, root).databaseUrl).toBe(
      `file:${join(root, "p.db")}`,
    );
  });

  test("process.env is unchanged by every call", () => {
    const root = tempDir("toon-cli-env-");
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, ".env"), "DATABASE_URL=file:./x.db\nUPLOAD_DIR=./up\nSOME_OTHER_KEY=1\n");
    const before = JSON.stringify(process.env);
    resolveCliEnv({}, root);
    expect(() => resolveCliEnv({ DATABASE_URL: "libsql://x" }, root)).toThrow();
    expect(JSON.stringify(process.env)).toBe(before);
    expect(process.env.SOME_OTHER_KEY).toBeUndefined();
  });
});

/* ------------------------------- the source guard ------------------------------ */

describe("migrate-legacy.ts source order (decision 5)", () => {
  const source = readFileSync(CLI_PATH, "utf8");

  test("no dynamic import before the DATABASE_URL redirect; the first one is the db client", () => {
    const redirect = source.indexOf("process.env.DATABASE_URL =");
    const firstImport = source.indexOf("import(");
    expect(redirect).toBeGreaterThan(-1);
    expect(firstImport).toBeGreaterThan(redirect);
    expect(source.slice(firstImport)).toStartWith('import("../src/db/client.ts")');
  });

  test("the migrator follows the client and the library follows both", () => {
    const order = ["../src/db/client.ts", "../src/db/migrate.ts", "./legacy/sources.ts"].map((name) =>
      source.indexOf(`import("${name}")`),
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("the CLI never mentions the env module and imports no library file statically", () => {
    expect(source).not.toContain("src/env");
    expect(source).not.toMatch(/^import [^t].*from "(\.\.\/src|\.\/legacy)\//m);
  });
});
