/**
 * The API's import graph has a cycle (`middleware/session.ts` -> `auth/users.ts` ->
 * `households/modules.ts` -> `modules/index.ts` -> the recipe manifest -> `routes/cards.ts`, which
 * calls `requireSession()` at module scope). Which file the entry point reaches first decides
 * whether that call sees an initialised `requireHandler`; the in-process tests share one module
 * graph, so only a fresh process per entry point proves it. Regression for M2-T12: the real server
 * died with "Cannot access 'requireHandler' before initialization" while all tests passed.
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const API_ROOT = resolve(import.meta.dir, "..");

async function importInFreshProcess(specifier: string): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(["bun", "-e", `await import(${JSON.stringify(specifier)});`], {
    cwd: API_ROOT,
    env: { ...process.env, NODE_ENV: "test", SESSION_SECRET: "0123456789abcdef0123456789abcdef" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { code, stderr };
}

describe("import order does not matter", () => {
  for (const entry of [
    // the server, then the first import of each script (seed, uploads:gc, reset-password, migrate)
    "./src/index.ts",
    "./src/middleware/session.ts",
    "./src/modules/index.ts",
    "./src/db/migrate.ts",
    "./src/core/services/households/modules.ts",
    "./src/core/services/media/references.ts",
    "./src/core/services/auth/users.ts",
    // M5: the migrate:legacy library; the CLI loads the client and the migrator first, then these
    "./scripts/legacy/run.ts",
    "./scripts/legacy/households.ts",
    "./scripts/legacy/finance.ts",
    "./scripts/legacy/balance.ts",
  ]) {
    test(`${entry} loads first in a fresh process`, async () => {
      const { code, stderr } = await importInFreshProcess(entry);
      expect(stderr).not.toContain("before initialization");
      expect(code).toBe(0);
    });
  }
});
