/**
 * The usage and input paths of the `migrate:legacy` CLI, by subprocess (plan `docs/plans/e5-scripts.md` E5-T08,
 * P10, risk 12). Five spawns: `--help`, an unknown option, `--recipe-uploads` without `--recipe-db`, a `--mapping`
 * naming a missing file, and a `DATABASE_URL` naming a directory. The last two had no test before E5.
 *
 * Why a subprocess: inside Effect code a synchronous `throw` of `CliUsageError`, `MappingError` or
 * `LegacyInputError` is a DEFECT that `Effect.catchTags` never sees, so the CLI would exit 1 without its three
 * stderr lines, while every in-process assertion (`rejects.toMatchObject({ exitCode: 2 })`) stays green because
 * `Cause.squash` returns the same object. Only the real exit code and stderr show a missing lift.
 *
 * Each spawn runs as `bun run migrate:legacy` does (CLAUDE.md "Subprocess tests of the CLI set
 * `NODE_ENV=development`": a real NODE_ENV, absolute paths, a placeholder `SESSION_SECRET`) and asserts that no
 * target file and no `-wal` appeared.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { USAGE } from "../scripts/migrate-legacy.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const CLI_PATH = join(REPO_ROOT, "apps/api/scripts/migrate-legacy.ts");
const FINANCE_DB = join(import.meta.dir, "fixtures/legacy/finance.db");
const TIMEOUT_MS = 120_000;

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Spawned {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Sandbox {
  dir: string;
  target: string;
  env: Record<string, string>;
}

function sandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "toon-legacy-cli-usage-"));
  tempDirs.push(dir);
  const target = join(dir, "target.db");
  return { dir, target, env: { DATABASE_URL: `file:${target}`, UPLOAD_DIR: join(dir, "uploads") } };
}

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

/** The two mode lines a dry run prints before it touches anything (step b). */
function dryRunHeader(target: string, box: Sandbox): string {
  return `[migrate:legacy] mode: dry-run (nothing is written to ${target})\n[migrate:legacy] uploads: ${join(box.dir, "uploads")}\n`;
}

function expectNoTarget(box: Sandbox): void {
  expect(existsSync(box.target)).toBe(false);
  expect(existsSync(`${box.target}-wal`)).toBe(false);
}

/** The three stderr lines of an exit-2 refusal; the usage hint only for a `CliUsageError`. */
function expectExitTwo(run: Spawned, message: string, usageHint = true): void {
  expect(run.code).toBe(2);
  expect(run.stderr).toContain(`[migrate:legacy] error: ${message}\n`);
  if (usageHint) expect(run.stderr).toContain("Run with --help for the usage.\n");
  expect(run.stderr.endsWith("[migrate:legacy] nothing was written.\n")).toBe(true);
}

describe("migrate:legacy usage and input errors (subprocess)", () => {
  test("--help prints the usage on stdout and exits 0", () => {
    const box = sandbox();
    const run = cli(["--help"], box.env);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(`${USAGE}\n`);
    expect(run.stderr).toBe("");
    expectNoTarget(box);
  }, TIMEOUT_MS);

  test("an unknown option is a usage error: exit 2, the three stderr lines, nothing on stdout", () => {
    const box = sandbox();
    const run = cli(["--bogus"], box.env);
    expectExitTwo(run, "Unknown option '--bogus'");
    expect(run.stdout).toBe("");
    expectNoTarget(box);
  }, TIMEOUT_MS);

  test("--recipe-uploads without --recipe-db is a usage error", () => {
    const box = sandbox();
    const run = cli(["--recipe-uploads", "/x", "--finance-db", FINANCE_DB], box.env);
    expectExitTwo(run, "--recipe-uploads needs --recipe-db");
    expect(run.stdout).toBe("");
    expectNoTarget(box);
  }, TIMEOUT_MS);

  test("a --mapping naming a missing file is a usage error before anything is written", () => {
    const box = sandbox();
    const mapping = join(box.dir, "nope.json");
    const run = cli(["--finance-db", FINANCE_DB, "--mapping", mapping], box.env);
    expectExitTwo(run, `--mapping: file not found: ${mapping}`);
    expect(run.stdout).toBe(dryRunHeader(box.target, box));
    expectNoTarget(box);
  }, TIMEOUT_MS);

  test("a DATABASE_URL naming a directory is refused with exit 2; the directory is unchanged", () => {
    const box = sandbox();
    const adir = join(box.dir, "adir");
    mkdirSync(adir);
    const run = cli(["--finance-db", FINANCE_DB], { ...box.env, DATABASE_URL: `file:${adir}` });
    expectExitTwo(run, `the target is not a file: ${adir}`);
    expect(run.stdout).toBe(dryRunHeader(adir, box));
    expect(readdirSync(adir)).toEqual([]);
    expectNoTarget(box);
  }, TIMEOUT_MS);
});
