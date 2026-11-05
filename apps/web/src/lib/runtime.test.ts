/**
 * The web's one runtime (docs/EFFECT.md E11, E7; plan docs/plans/e6-web-client.md P1, P6, P16).
 *
 * (1) Import cycle: `api-client.ts` → `@/lib/i18n/store.ts` → `@/lib/api` → `@/lib/runtime` → `api-client.ts`.
 * A module-scope read of an imported binding on that cycle throws a TDZ `ReferenceError` only in the entry
 * order that hits it, so each of the six cycle files is imported FIRST in a fresh `bun` process (cwd
 * `apps/web`, so the `@/` paths resolve), then one facade runs against a stubbed `fetch` and the child prints `ok`.
 * (2) `runPromise` maps an abort to the signal's `AbortError` and a failure to the tagged error itself.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { ApiClient, ApiError } from "./api-client.ts";
import { runPromise, runtime } from "./runtime.ts";

const WEB_ROOT = join(import.meta.dir, "..", "..");

const ENTRY_FILES = [
  "src/lib/api-client.ts",
  "src/lib/runtime.ts",
  "src/lib/api.ts",
  "src/lib/i18n/store.ts",
  "src/modules/recipe/lib/api.ts",
  "src/modules/finance/lib/api.ts",
];

const HEALTH = {
  ok: true,
  status: "ok",
  version: "0.1.0",
  time: "2026-11-05T10:00:00.000Z",
  database: "file",
  modules: ["recipe", "finance"],
};

/** The child: import the entry first, then the core client, stub fetch, run one decoded read. */
function childScript(entry: string): string {
  return `
await import(${JSON.stringify(join(WEB_ROOT, entry))});
const api = await import(${JSON.stringify(join(WEB_ROOT, "src/lib/api.ts"))});
globalThis.fetch = async () => new Response(${JSON.stringify(JSON.stringify(HEALTH))}, {
  status: 200,
  headers: { "content-type": "application/json" },
});
const health = await api.fetchHealth();
console.log(health.ok === true && health.modules.length === 2 ? "ok" : "bad " + JSON.stringify(health));
`;
}

describe("each cycle file can be imported first in a fresh process (P16)", () => {
  for (const entry of ENTRY_FILES) {
    test(entry, () => {
      const dir = mkdtempSync(join(tmpdir(), "web-runtime-order-"));
      try {
        const script = join(dir, "child.ts");
        writeFileSync(script, childScript(entry));
        const child = Bun.spawnSync(["bun", script], {
          cwd: WEB_ROOT,
          env: { ...process.env, NODE_ENV: "test" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdout = child.stdout.toString().trim();
        const stderr = child.stderr.toString();
        expect({ exitCode: child.exitCode, stdout, stderr: child.exitCode === 0 ? "" : stderr }).toEqual({
          exitCode: 0,
          stdout: "ok",
          stderr: "",
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 30_000);
  }
});

describe("runPromise (P1, P6)", () => {
  test("resolves the value of a successful effect", async () => {
    expect(await runPromise(Effect.succeed(42))).toBe(42);
  });

  test("an aborted signal rejects with the signal's AbortError, not Effect's interruption error", async () => {
    const controller = new AbortController();
    const pending = runPromise(Effect.never, { signal: controller.signal });
    controller.abort();
    const error = await pending.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
    expect(error).toBe(controller.signal.reason);
  });

  test("a signal aborted before the run rejects with an AbortError too", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await runPromise(Effect.succeed(1).pipe(Effect.delay("1 second")), {
      signal: controller.signal,
    }).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect((error as Error).name).toBe("AbortError");
  });

  test("a failure rejects with the tagged error itself", async () => {
    const failure = new ApiError({ code: "conflict", status: 409, message: "Konflikt" });
    const error = await runPromise(Effect.fail(failure)).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBe(failure);
  });

  test("a defect rejects with the thrown value", async () => {
    const boom = new Error("boom");
    const error = await runPromise(Effect.die(boom)).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBe(boom);
  });

  test("the runtime provides the ApiClient and the HttpClient", async () => {
    const provided = await runtime.runPromise(
      Effect.all([ApiClient, HttpClient.HttpClient]).pipe(
        Effect.map(([api, http]) => [typeof api.execute, typeof http.execute]),
      ),
    );
    expect(provided).toEqual(["function", "function"]);
  });
});
