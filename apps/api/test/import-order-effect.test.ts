/**
 * The files the Effect migration pulls into the API's import cycle (plan `docs/plans/e2-api-core-services.md` P21;
 * CLAUDE.md "API import cycle"). `apps/api/test/import-order.test.ts` is pinned unchanged, so these entries get a
 * guard of their own in the same shape: one fresh `bun -e` process per entry, `NODE_ENV=test`, the entry imported
 * FIRST, then `./src/runtime.ts`, then `runtime.runPromise(Effect.void)`, which builds the whole `AppLayer` after
 * that import order (under `NODE_ENV=test` on the child's own temp DB; `Database.layer` never closes there). A
 * static initializer or composition file that reads an imported binding in its TDZ dies here with "Cannot access
 * '…' before initialization".
 *
 * E2-T03 lists the composition (`config`, `database`, `infra`, the core services layer, `runtime`); E2-T05 adds
 * `./src/modules/adapter.ts` and `./src/core/services/media/references.ts` (`UploadReferences`), E2-T12 the middlewares, the core routes and the services they reach.
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const API_ROOT = resolve(import.meta.dir, "..");

async function importThenBuildInFreshProcess(specifier: string): Promise<{ code: number; stderr: string }> {
  const script = [
    `await import(${JSON.stringify(specifier)});`,
    `const { runtime } = await import("./src/runtime.ts");`,
    `const { Effect } = await import("effect");`,
    `await runtime.runPromise(Effect.void);`,
  ].join(" ");
  const proc = Bun.spawn(["bun", "-e", script], {
    cwd: API_ROOT,
    env: { ...process.env, NODE_ENV: "test", SESSION_SECRET: "0123456789abcdef0123456789abcdef" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { code, stderr };
}

describe("import order does not matter for the Effect composition", () => {
  for (const entry of [
    // E2-T03: the configuration, the database service, the composition files and the runtime
    "./src/config.ts",
    "./src/db/database.ts",
    "./src/infra.ts",
    "./src/core/services/layer.ts",
    "./src/runtime.ts",
    // E2-T05: the module adapter (imported by db/migrate.ts and the registry) and the first core service
    "./src/modules/adapter.ts",
    "./src/core/services/media/references.ts",
  ]) {
    test(`${entry} loads first in a fresh process and the AppLayer builds after it`, async () => {
      const { code, stderr } = await importThenBuildInFreshProcess(entry);
      expect(stderr).not.toContain("before initialization");
      expect(stderr).not.toContain("ReferenceError");
      expect(code).toBe(0);
    });
  }
});
