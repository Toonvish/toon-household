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
 * `./src/modules/adapter.ts` and `./src/core/services/media/references.ts` (`UploadReferences`), E2-T12 the middlewares, the core routes and the services they reach,
 * E3-T01 the recipe module's composition (`./src/modules/recipe/layer.ts`) and `./src/modules/recipe/migrate.ts`.
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
    // E2-T12: the middlewares (factories the routers call at module scope), the core routes, the services they
    // reach and the two module manifests
    "./src/middleware/household.ts",
    "./src/middleware/module.ts",
    "./src/middleware/verifiedEmail.ts",
    "./src/middleware/originGuard.ts",
    "./src/core/routes/auth.ts",
    "./src/core/routes/households.ts",
    "./src/core/services/households/households.service.ts",
    "./src/core/services/auth/sessions.ts",
    "./src/modules/finance/index.ts",
    "./src/modules/recipe/index.ts",
    // E3-T01: the recipe module's composition (hoisted area functions, `ImportCapabilities`) and the fold backfill
    // (`foldBackfill`, imported by `scripts/legacy/recipe.ts` without the manifest)
    "./src/modules/recipe/layer.ts",
    "./src/modules/recipe/migrate.ts",
  ]) {
    test(`${entry} loads first in a fresh process and the AppLayer builds after it`, async () => {
      const { code, stderr } = await importThenBuildInFreshProcess(entry);
      expect(stderr).not.toContain("before initialization");
      expect(stderr).not.toContain("ReferenceError");
      expect(code).toBe(0);
    });
  }
});
