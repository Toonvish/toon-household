/**
 * `bun run seed` and `bun run auth:reset-password` (docs/EFFECT.md E10; plan `docs/plans/e5-scripts.md` P2, P5, P13,
 * E5-T02).
 *
 * The subprocess cases characterise `apps/api/scripts/seed.ts` and `apps/api/scripts/reset-password.ts` exactly as an
 * operator runs them. They were written and run green against the UNCONVERTED scripts first and pass unchanged against
 * the Effect programs (P13): a real `NODE_ENV=development` (never the inherited `test`, under which `src/env.ts` picks
 * its own temp DB and a production refusal could not be seen), an absolute `DATABASE_URL`, an explicit `UPLOAD_DIR` and
 * `SESSION_SECRET`. They assert only lines both versions print (the trailing `[db] database closed` of P3 is neither
 * asserted present nor absent). A production refusal must leave NO database file behind: the database modules load
 * only after it (P2 row 2).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Subprocess budget: parallel worktrees put the host under heavy load (plan P13, CLAUDE.md "sharp" gotcha). */
const SPAWN_TIMEOUT_MS = 120_000;

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SEED_SCRIPT = join(REPO_ROOT, "apps/api/scripts/seed.ts");
const RESET_SCRIPT = join(REPO_ROOT, "apps/api/scripts/reset-password.ts");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "toon-household-scripts-seed-"));
  dirs.push(dir);
  return dir;
}

interface Spawned {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `bun <script> <args>` from the repo root with an explicit environment. */
function runScript(script: string, dir: string, extraEnv: Record<string, string>, args: string[] = []): Spawned {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: `file:${join(dir, "x.db")}`,
    UPLOAD_DIR: join(dir, "uploads"),
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    ...extraEnv,
  };
  delete env.TEST_DATABASE_URL;
  delete env.DATABASE_AUTH_TOKEN;
  delete env.ALLOW_SEED;
  delete env.SEED_PASSWORD;
  for (const [key, value] of Object.entries(extraEnv)) env[key] = value;
  const proc = Bun.spawnSync({ cmd: ["bun", script, ...args], cwd: REPO_ROOT, env, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

/** Every file in the temp directory (a created database leaves `x.db`, a `-wal`, a `-shm`). */
function filesIn(dir: string): string[] {
  return readdirSync(dir);
}

describe("bun apps/api/scripts/seed.ts (subprocess)", () => {
  test(
    "(1) NODE_ENV=production without ALLOW_SEED refuses with exit 1 and creates no database file",
    () => {
      const dir = tempDir();
      const result = runScript(SEED_SCRIPT, dir, { NODE_ENV: "production" });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        "[seed] refusing to run with NODE_ENV=production. Set ALLOW_SEED=1 if you really mean it.",
      );
      expect(existsSync(join(dir, "x.db"))).toBe(false);
      expect(filesIn(dir)).toEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "(2) ALLOW_SEED=1 with a short SEED_PASSWORD refuses with exit 1 and creates no database file",
    () => {
      const dir = tempDir();
      const result = runScript(SEED_SCRIPT, dir, { NODE_ENV: "production", ALLOW_SEED: "1", SEED_PASSWORD: "short" });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        "[seed] SEED_PASSWORD (>= 10 chars) is required in production — the default is public.",
      );
      expect(existsSync(join(dir, "x.db"))).toBe(false);
      expect(filesIn(dir)).toEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "(3) NODE_ENV=development seeds the demo data and is idempotent on a second run",
    () => {
      const dir = tempDir();
      const first = runScript(SEED_SCRIPT, dir, {});
      if (first.code !== 0) console.error(first.stderr);
      expect(first.code).toBe(0);
      const firstLines = first.stdout.split("\n");
      expect(firstLines).toContain("[seed] user demo@toon.local / demo1234");
      expect(firstLines.some((line) => line.startsWith('[seed] household "Familie" ('))).toBe(true);
      expect(firstLines).toContain("[seed] done");
      expect(firstLines).toContain("  Login:    demo@toon.local");
      expect(firstLines).toContain("  Passwort: demo1234");

      const second = runScript(SEED_SCRIPT, dir, {});
      if (second.code !== 0) console.error(second.stderr);
      expect(second.code).toBe(0);
      const secondLines = second.stdout.split("\n");
      expect(secondLines.some((line) => line.startsWith("[seed] user "))).toBe(false);
      expect(secondLines.some((line) => line.startsWith("[seed] household "))).toBe(false);
      expect(secondLines).toContain("[seed] done");
      expect(secondLines).toContain("  Login:    demo@toon.local");
      expect(secondLines).toContain("  Passwort: demo1234");
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("bun apps/api/scripts/reset-password.ts (subprocess)", () => {
  test(
    "(4) without an address prints the usage and exits 1",
    () => {
      const dir = tempDir();
      const result = runScript(RESET_SCRIPT, dir, {});
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Usage: bun run auth:reset-password <email> [--send]");
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "(5) an unknown address exits 2 and says so plainly",
    () => {
      const dir = tempDir();
      expect(runScript(SEED_SCRIPT, dir, {}).code).toBe(0);
      const result = runScript(RESET_SCRIPT, dir, {}, ["nobody@example.test"]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("No account with the address nobody@example.test found (DB: file).");
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "(6) the seeded demo address gets a reset link and the closing notes, exit 0",
    () => {
      const dir = tempDir();
      expect(runScript(SEED_SCRIPT, dir, {}).code).toBe(0);
      const result = runScript(RESET_SCRIPT, dir, {}, ["demo@toon.local"]);
      if (result.code !== 0) console.error(result.stderr);
      expect(result.code).toBe(0);
      const lines = result.stdout.split("\n");
      expect(lines).toContain("Account:  Demo Koch <demo@toon.local>");
      expect(lines.some((line) => /\/reset-password\/[^/\s]+$/.test(line))).toBe(true);
      expect(lines.some((line) => line.startsWith("Valid:    "))).toBe(true);
      expect(lines).toContain("The link can be used exactly ONCE and signs out every device afterwards.");
    },
    SPAWN_TIMEOUT_MS,
  );
});
