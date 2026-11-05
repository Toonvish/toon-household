/**
 * `bun apps/api/scripts/plan-run.ts` (docs/EFFECT.md E10; plan `docs/plans/e5-scripts.md` P13, E5-T03).
 *
 * Subprocess cases written and run green against the UNCONVERTED script first, unchanged against the Effect program:
 * a real `NODE_ENV=development` (never the inherited `test`), an absolute `DATABASE_URL`, an explicit `UPLOAD_DIR` and
 * `SESSION_SECRET`. They assert exit codes and lines both versions print (the trailing `[db] database closed` of P3
 * is neither asserted present nor absent).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Subprocess budget: parallel worktrees put the host under heavy load (plan P13). */
const SPAWN_TIMEOUT_MS = 120_000;

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SCRIPTS = join(REPO_ROOT, "apps/api/scripts");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "toon-household-scripts-plan-run-"));
  dirs.push(dir);
  return dir;
}

interface Spawned {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runScript(dir: string, script: string, args: string[] = []): Spawned {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: `file:${join(dir, "x.db")}`,
    UPLOAD_DIR: join(dir, "uploads"),
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  };
  delete env.TEST_DATABASE_URL;
  delete env.DATABASE_AUTH_TOKEN;
  const proc = Bun.spawnSync({
    cmd: ["bun", join(SCRIPTS, script), ...args],
    cwd: REPO_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const RESULT_LINE = /^\[plan-run\] Familie \(([0-9a-f-]{36})\): booked \d+ period\(s\), skipped \d+, -?\d+ ct total$/;

describe("bun apps/api/scripts/plan-run.ts (subprocess)", () => {
  test(
    "a migrated empty database has no households to run: exit 0",
    () => {
      const dir = tempDir();
      const migrated = runScript(dir, "migrate.ts");
      expect(migrated.code).toBe(0);
      const run = runScript(dir, "plan-run.ts");
      expect(run.code).toBe(0);
      expect(run.stderr).toContain("[plan-run] no households to run");
      expect(run.stdout).not.toContain("booked");
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "on the seeded demo household it prints one result line, with and without the id argument",
    () => {
      const dir = tempDir();
      const seeded = runScript(dir, "seed.ts");
      expect(seeded.code).toBe(0);

      const all = runScript(dir, "plan-run.ts");
      expect(all.code).toBe(0);
      const lines = all.stdout.split("\n").filter((line) => line.startsWith("[plan-run]"));
      expect(lines).toHaveLength(1);
      const match = RESULT_LINE.exec(lines[0] ?? "");
      expect(match).not.toBeNull();
      const householdId = match?.[1] ?? "";

      const one = runScript(dir, "plan-run.ts", [householdId]);
      expect(one.code).toBe(0);
      const oneLines = one.stdout.split("\n").filter((line) => line.startsWith("[plan-run]"));
      expect(oneLines).toHaveLength(1);
      expect(RESULT_LINE.test(oneLines[0] ?? "")).toBe(true);
      expect(oneLines[0]).toContain(householdId);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "an unknown household id is refused with exit 1",
    () => {
      const dir = tempDir();
      expect(runScript(dir, "migrate.ts").code).toBe(0);
      const run = runScript(dir, "plan-run.ts", ["nope"]);
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("[plan-run] no household nope with finance enabled");
    },
    SPAWN_TIMEOUT_MS,
  );
});
