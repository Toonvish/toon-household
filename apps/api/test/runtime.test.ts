/**
 * The one ManagedRuntime (`src/runtime.ts`, docs/EFFECT.md E7) and the health probe
 * that runs through it (`src/core/health.ts`, `GET /api/health`).
 *
 * The shared `runtime` is NEVER disposed here: every test file runs in one bun
 * process and shares it (CLAUDE.md "Retired gotchas"); test (d) proves the disposal
 * behaviour on a throwaway runtime of its own.
 */
import { HealthResponseSchema } from "@toon/shared";
import { describe, expect, spyOn, test } from "bun:test";
import { Cause, Exit, ManagedRuntime, Schema } from "effect";
import { healthResponse } from "../src/core/health.ts";
import { app } from "../src/index.ts";
import { AppLayer, appMemoMap, runtime } from "../src/runtime.ts";

describe("src/runtime.ts", () => {
  test("(a) runtime is a ManagedRuntime on the shared memo map", () => {
    expect(ManagedRuntime.isManagedRuntime(runtime)).toBe(true);
    expect(runtime.memoMap).toBe(appMemoMap);
  });

  test("(b) GET /api/health is computed by runtime.runPromise(healthResponse)", async () => {
    const spy = spyOn(runtime, "runPromise");
    try {
      const response = await app.request("/api/health");
      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toBe(healthResponse);

      const body = (await response.json()) as {
        ok: boolean;
        status: string;
        time: string;
        database: string;
        modules: string[];
        features: { verifiedEmailRequired: unknown; ocrImport: unknown; pdfImport: unknown };
      };
      expect(body.ok).toBe(true);
      expect(body.status).toBe("ok");
      expect(body.database).toBe("file");
      expect(body.modules).toEqual(["recipe", "finance"]);
      expect(typeof body.features.verifiedEmailRequired).toBe("boolean");
      expect(body.features.ocrImport).toBe(false);
      expect(body.features.pdfImport).toBe(false);
      expect(() => Schema.decodeUnknownSync(HealthResponseSchema)(body)).not.toThrow();
      // DateTime.formatIso is Date#toISOString of the UTC instant: the format the route always sent.
      expect(new Date(body.time).toISOString()).toBe(body.time);
    } finally {
      spy.mockRestore();
    }
  });

  test("(c) the health payload keeps its key order", async () => {
    const health = await runtime.runPromise(healthResponse);
    expect(Object.keys(health)).toEqual([
      "ok",
      "status",
      "version",
      "time",
      "database",
      "modules",
      "features",
    ]);
  });

  test("(d) a disposed runtime refuses further runs with the 'ManagedRuntime disposed' defect", async () => {
    // A throwaway runtime with its own memo map; the shared one is never disposed in a test.
    const rt = ManagedRuntime.make(AppLayer);
    const before = await rt.runPromise(healthResponse);
    expect(before.ok).toBe(true);

    await rt.dispose();

    // disposeEffect swaps the runtime's context for Effect.die("ManagedRuntime disposed"), and
    // runPromise rejects with the squashed cause: the defect itself, a plain string.
    await expect(rt.runPromise(healthResponse)).rejects.toBe("ManagedRuntime disposed");
    const exit = await rt.runPromiseExit(healthResponse);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.squash(exit.cause)).toBe("ManagedRuntime disposed");
    }
  });
});
