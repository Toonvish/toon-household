/**
 * `LegacyMigration`, the one service of the `migrate:legacy` library (docs/EFFECT.md E7, E10; plan
 * `docs/plans/e5-scripts.md` P9, P10, E5-T07), on the committed fixtures and temp file targets
 * (`test/support/legacy-harness.ts`), never the shared test DB.
 *
 * - `open` is a scoped resource: the snapshot's client works inside the scope and is closed with it.
 * - `knownLegacyIds` reads the legacy group and household ids.
 * - `run` refuses a bad mapping as a TYPED `MappingError` (a `Fail`, never a defect: the CLI's `catchTags`
 *   maps it to exit 2), before anything is written.
 * - The service's static `layer` reads no imported binding at class evaluation: `service.ts` loads first in a
 *   fresh process and its layer builds there.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Cause, Effect, Exit } from "effect";
import { LegacyMigration } from "../scripts/legacy/service.ts";
import { FINANCE_HOUSEHOLDS, GROUPS } from "./fixtures/legacy/facts.ts";
import { countRows, createLegacyRun, FIXTURE_DIR, type LegacyRun } from "./support/legacy-harness.ts";

const API_ROOT = resolve(import.meta.dir, "..");

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

function withService<A, E>(effect: Effect.Effect<A, E, LegacyMigration>): Effect.Effect<A, E> {
  return effect.pipe(Effect.provide(LegacyMigration.layer));
}

describe("LegacyMigration", () => {
  test("open is scoped: the snapshot's client is closed when the scope closes", async () => {
    const dir = tempDir("toon-legacy-service-");
    const input = join(dir, "recipe.db");
    cpSync(join(FIXTURE_DIR, "recipe.db"), input);
    const { legacy, groupsInside } = await Effect.runPromise(
      withService(
        Effect.scoped(
          Effect.gen(function* () {
            const migration = yield* LegacyMigration;
            const opened = yield* migration.open("recipe", input, dir);
            const result = yield* Effect.promise(() => opened.client.execute("SELECT count(*) AS n FROM groups"));
            expect(opened.client.closed).toBe(false);
            return { legacy: opened, groupsInside: Number(result.rows[0]?.n) };
          }),
        ),
      ),
    );
    expect(groupsInside).toBe(Object.keys(GROUPS).length);
    expect(legacy.source).toBe("recipe");
    expect(legacy.snapshotPath).toBe(join(dir, "recipe.db"));
    expect(legacy.client.closed).toBe(true);
  });

  test("knownLegacyIds reads the recipe group ids and the finance household ids", async () => {
    const run = await createLegacyRun();
    runs.push(run);
    const known = await Effect.runPromise(
      withService(LegacyMigration.use((migration) => migration.knownLegacyIds(run.ctx.recipe, run.ctx.finance))),
    );
    expect([...known.groupIds].sort()).toEqual(Object.values(GROUPS).map((group) => group.id).sort());
    expect([...known.financeIds].sort()).toEqual(Object.values(FINANCE_HOUSEHOLDS).map((household) => household.id).sort());
  });

  test("run refuses a bad mapping as a typed MappingError before anything is written", async () => {
    const run = await createLegacyRun({ mode: "apply" });
    runs.push(run);
    const bad = { [FINANCE_HOUSEHOLDS.FH1.id]: GROUPS.G1.id, [FINANCE_HOUSEHOLDS.FH2.id]: GROUPS.G1.id };
    const pass = LegacyMigration.use((migration) =>
      migration.run({
        mode: "apply",
        ...(run.ctx.recipe ? { recipe: run.ctx.recipe } : {}),
        ...(run.ctx.finance ? { finance: run.ctx.finance } : {}),
        target: run.target,
        uploads: run.ctx.uploads,
        mapping: bad,
      }),
    );
    const exit = await Effect.runPromise(Effect.exit(withService(pass)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasFails(exit.cause)).toBe(true);
      expect(Cause.hasDies(exit.cause)).toBe(false);
    }
    const caught = await Effect.runPromise(
      withService(
        pass.pipe(
          Effect.as("passed"),
          Effect.catchTag("MappingError", (error) => Effect.succeed(`${error._tag} ${error.exitCode}`)),
        ),
      ),
    );
    expect(caught).toBe("MappingError 2");
    expect(await countRows(run.target.client, "users")).toBe(0);
    expect(await countRows(run.target.client, "legacy_ids")).toBe(0);
  });

  test(
    "service.ts loads first in a fresh process and its layer builds there",
    async () => {
      const program = [
        'const { Effect } = await import("effect");',
        'const { LegacyMigration } = await import("./scripts/legacy/service.ts");',
        "const keys = await Effect.runPromise(",
        "  LegacyMigration.use((service) => Effect.succeed(Object.keys(service).sort().join(','))).pipe(",
        "    Effect.provide(LegacyMigration.layer),",
        "  ),",
        ");",
        "console.log(keys);",
      ].join("\n");
      const proc = Bun.spawn(["bun", "-e", program], {
        cwd: API_ROOT,
        env: { ...process.env, NODE_ENV: "test", SESSION_SECRET: "0123456789abcdef0123456789abcdef" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(stderr).not.toContain("before initialization");
      expect(code).toBe(0);
      expect(stdout.trim()).toBe("knownLegacyIds,open,run");
    },
    120_000,
  );
});
