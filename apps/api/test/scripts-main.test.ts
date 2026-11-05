/**
 * The script runner and `db:migrate` (docs/EFFECT.md E10; plan `docs/plans/e5-scripts.md` P1, P8, P13, E5-T01).
 *
 * The subprocess cases characterise `bun apps/api/scripts/migrate.ts` exactly as the operator (and
 * `docker/entrypoint.sh`) runs it. They were written and run green against the UNCONVERTED script first and pass
 * unchanged against the Effect program (P13): a real `NODE_ENV=development` (never the inherited `test`, under which
 * `src/env.ts` picks its own temp DB), an absolute `DATABASE_URL`, an explicit `UPLOAD_DIR` and `SESSION_SECRET`.
 * They assert only lines both versions print (the trailing `[db] database closed` of P3 is neither asserted present
 * nor absent). The unit cases pin the runner's exit-code rules (P1) and the Promise door `runMigrations` (P8).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { Exit, Runtime } from "effect";
import { createDatabase } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { isDatabaseError } from "../src/lib/errors.ts";
import { makeScriptTeardown, ScriptExit } from "../scripts/support/main.ts";

/** Subprocess budget: parallel worktrees put the host under heavy load (plan P13, CLAUDE.md "sharp" gotcha). */
const SPAWN_TIMEOUT_MS = 120_000;

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const MIGRATE_SCRIPT = join(REPO_ROOT, "apps/api/scripts/migrate.ts");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "toon-household-scripts-main-"));
  dirs.push(dir);
  return dir;
}

interface Spawned {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `bun apps/api/scripts/migrate.ts` from the repo root with an explicit environment. */
function runMigrateScript(dir: string): Spawned {
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
    cmd: ["bun", MIGRATE_SCRIPT],
    cwd: REPO_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

async function tableNames(file: string): Promise<string[]> {
  const client = createClient({ url: `file:${file}` });
  try {
    const result = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
    return result.rows.map((row) => String(row.name));
  } finally {
    client.close();
  }
}

describe("bun apps/api/scripts/migrate.ts (subprocess)", () => {
  test(
    "migrates a fresh file database, prints its three lines and is idempotent",
    async () => {
      const dir = tempDir();
      const first = runMigrateScript(dir);
      if (first.code !== 0) console.error(first.stderr);
      expect(first.code).toBe(0);
      const lines = first.stdout.split("\n");
      expect(lines).toContain(`[db:migrate] file database: file:${join(dir, "x.db")}`);
      expect(lines).toContain(`[db:migrate] migrations: ${join(REPO_ROOT, "apps/api/drizzle")}`);
      expect(lines).toContain("[db:migrate] done");

      const second = runMigrateScript(dir);
      if (second.code !== 0) console.error(second.stderr);
      expect(second.code).toBe(0);
      expect(second.stdout.split("\n")).toContain("[db:migrate] done");

      const tables = await tableNames(join(dir, "x.db"));
      for (const name of ["users", "household_modules", "legacy_ids", "recipe_recipes", "finance_transactions"]) {
        expect(tables).toContain(name);
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("makeScriptTeardown (plan P1)", () => {
  /** Runs the teardown on `exit` and returns what reached `exitProcess` and the runner's `onExit`. */
  function codesFor(exit: Exit.Exit<unknown, unknown>): { exitProcess: number[]; onExit: number[] } {
    const exitProcess: number[] = [];
    const onExit: number[] = [];
    makeScriptTeardown((code) => exitProcess.push(code))(exit, (code) => onExit.push(code));
    return { exitProcess, onExit };
  }

  test("a void success exits 0", () => {
    expect(codesFor(Exit.void).exitProcess).toEqual([0]);
  });

  test("a numeric success exits with that number", () => {
    expect(codesFor(Exit.succeed(2)).exitProcess).toEqual([2]);
    expect(codesFor(Exit.succeed(0)).exitProcess).toEqual([0]);
  });

  test("a ScriptExit failure exits with its code", () => {
    expect(codesFor(Exit.fail(new ScriptExit({ code: 2 }))).exitProcess).toEqual([2]);
  });

  test("an unmarked failure exits 1", () => {
    expect(codesFor(Exit.fail(new Error("boom"))).exitProcess).toEqual([1]);
    expect(codesFor(Exit.die("defect")).exitProcess).toEqual([1]);
  });

  test("an interruption exits 130", () => {
    expect(codesFor(Exit.interrupt()).exitProcess).toEqual([130]);
  });

  test("the runner's onExit sees the same code, once", () => {
    expect(codesFor(Exit.succeed(3)).onExit).toEqual([3]);
    expect(codesFor(Exit.fail(new ScriptExit({ code: 2 }))).onExit).toEqual([2]);
  });

  test("ScriptExit is not reported again by runMain and carries its exit-code marker", () => {
    const error = new ScriptExit({ code: 2 });
    expect(error[Runtime.errorReported]).toBe(false);
    expect(Runtime.getErrorReported(error)).toBe(false);
    expect(Runtime.getErrorExitCode(error)).toBe(2);
    expect(error._tag).toBe("ScriptExit");
  });
});

describe("runMigrations, the Promise door of migrateDatabase (plan P8)", () => {
  test(
    "migrates a createDatabase temp DB, then rejects with the raw libSQL error once the client is closed",
    async () => {
      const dir = tempDir();
      const created = createDatabase({ url: `file:${join(dir, "door.db")}` });
      await created.ready;
      await runMigrations(created.db);
      const tables = await created.client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
      const names = tables.rows.map((row) => String(row.name));
      for (const name of ["__drizzle_migrations", "users", "recipe_recipes", "finance_transactions"]) {
        expect(names).toContain(name);
      }

      created.client.close();
      let rejection: unknown;
      await runMigrations(created.db).then(
        () => undefined,
        (error: unknown) => {
          rejection = error;
        },
      );
      expect(rejection).toBeDefined();
      expect(isDatabaseError(rejection)).toBe(false);
      expect(rejection).toBeInstanceOf(Error);
    },
    SPAWN_TIMEOUT_MS,
  );
});
