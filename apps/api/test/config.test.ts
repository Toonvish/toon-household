/**
 * `AppConfig` (apps/api/src/config.ts, plan e2 P5): the process layer provides the very object
 * `env` exports and resolves it once per process; `layerFrom` decodes explicit raw values with the
 * derived fields and fails with a `Config.ConfigError` whose lines equal `parseEnv`'s; `config`
 * reads the current `ConfigProvider`; a production process with the `.env.example` secret still
 * exits 1 with the placeholder line. `apps/api/test/env-parse.test.ts` stays the oracle of the
 * rules themselves.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Cause, Config, ConfigProvider, Effect, Exit, Layer, Option } from "effect";
import { AppConfig, configErrorLines, parseEnv, REPO_ROOT, resolveProcessEnv, type Env } from "../src/config.ts";
import { env } from "../src/env.ts";

const API_ROOT = resolve(import.meta.dir, "..");
const BASE = { DATABASE_URL: "file:./data/x.db", SESSION_SECRET: "0123456789abcdef" };
type Source = Record<string, string | undefined>;

const readConfig = Effect.gen(function* () {
  return yield* AppConfig;
});

function fromLayer(layer: Layer.Layer<AppConfig, Config.ConfigError>): Exit.Exit<Env, Config.ConfigError> {
  return Effect.runSyncExit(Effect.provide(readConfig, layer));
}

function decoded(values: Source): Env {
  const exit = fromLayer(AppConfig.layerFrom(values));
  if (Exit.isFailure(exit)) throw new Error(`expected a config, got:\n${Cause.pretty(exit.cause)}`);
  return exit.value;
}

function configError(exit: Exit.Exit<Env, Config.ConfigError>): Config.ConfigError {
  if (Exit.isSuccess(exit)) throw new Error("expected a ConfigError, got a config");
  const error = Cause.findErrorOption(exit.cause);
  if (Option.isNone(error)) throw new Error(`expected a typed failure, got:\n${Cause.pretty(exit.cause)}`);
  return error.value;
}

function parseLines(source: Source): string[] {
  const result = parseEnv(source);
  if (result.ok) throw new Error("expected parseEnv to fail");
  return result.lines;
}

describe("AppConfig.layer: the process value", () => {
  test("provides the same object as env", () => {
    const exit = fromLayer(AppConfig.layer);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe(env);
  });

  test("a second resolution returns the same object (one temp DB per process)", () => {
    const first = Effect.runSync(Effect.provide(readConfig, AppConfig.layer));
    const second = Effect.runSync(Effect.provide(readConfig, AppConfig.layer));
    expect(second).toBe(first);
    expect(resolveProcessEnv()).toBe(env);
    expect(env.isTest).toBe(true);
    expect(env.databaseUrl.startsWith("file:")).toBe(true);
  });
});

describe("AppConfig.layerFrom: explicit values", () => {
  test("decodes the derived fields", () => {
    const config = decoded({
      ...BASE,
      WEB_ORIGIN: "http://a, http://b ,,  http://c",
      MAIL_SECURITY: "tls",
      IMPORT_OCR_ENABLED: "1",
    });
    expect(config.webOrigins).toEqual(["http://a", "http://b", "http://c"]);
    expect(config.databaseKind).toBe("file");
    expect(config.databaseUrl).toBe(`file:${resolve(REPO_ROOT, "./data/x.db")}`);
    expect(config.uploadDir).toBe(resolve(REPO_ROOT, "./data/uploads"));
    expect(config.mailSecurity).toBe("tls");
    expect(config.mailPort).toBe(465);
    expect(config.ocrImportEnabled).toBe(true);
    expect(config.pdfImportEnabled).toBe(true);
    expect(config.NODE_ENV).toBe("development");
    expect(config.API_PORT).toBe(3001);

    const remote = decoded({ ...BASE, DATABASE_URL: "libsql://x.turso.io", DATABASE_AUTH_TOKEN: "t" });
    expect(remote.databaseKind).toBe("remote");
    expect(decoded(BASE).mailPort).toBe(587);
    expect(decoded({ ...BASE, IMPORT_OCR_ENABLED: "1", IMPORT_PDF_ENABLED: "0" }).pdfImportEnabled).toBe(false);
  });

  test("equals parseEnv for the same map, and reads neither process.env nor the test rules", () => {
    const source = { ...BASE, NODE_ENV: "test", API_PORT: "8080", MAIL_TRANSPORT: "smtp", PATH: "/usr/bin" };
    const parsed = parseEnv(source);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(decoded(source)).toEqual(parsed.env);
    // Under NODE_ENV=test the process rules would replace DATABASE_URL; layerFrom keeps the given one.
    expect(decoded(source).DATABASE_URL).toBe("file:./data/x.db");
    expect(decoded(source).mailTransport).toBe("console");
  });

  const BAD: Array<[string, Source]> = [
    ["a missing required variable", { SESSION_SECRET: "0123456789abcdef" }],
    ["two field issues at once", { DATABASE_URL: "", SESSION_SECRET: "short", API_PORT: "0" }],
    ["an empty value is a value, not unset", { ...BASE, WEB_ORIGIN: "", MAIL_PORT: "" }],
    ["a bad enum", { ...BASE, NODE_ENV: "staging", MAIL_SECURITY: " tls" }],
    [
      "the cross-field (env) lines, in order",
      {
        DATABASE_URL: "libsql://x.turso.io",
        SESSION_SECRET: "change-me-to-a-32-byte-random-hex-string-0000000",
        NODE_ENV: "production",
        MAIL_TRANSPORT: "smtp",
        MAIL_SECURITY: "none",
        MAIL_USER: "u",
      },
    ],
    ["resend without key and sender", { ...BASE, MAIL_TRANSPORT: "resend" }],
    ["a remote database with an empty token", { ...BASE, DATABASE_URL: "wss://x.example", DATABASE_AUTH_TOKEN: "" }],
  ];
  for (const [name, source] of BAD) {
    test(`fails with a ConfigError whose lines equal parseEnv's: ${name}`, () => {
      const error = configError(fromLayer(AppConfig.layerFrom(source)));
      expect(error._tag).toBe("ConfigError");
      const lines = configErrorLines(error);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines).toEqual(parseLines(source));
    });
  }

  test("the placeholder secret in production is the parseEnv line", () => {
    const source = {
      ...BASE,
      NODE_ENV: "production",
      SESSION_SECRET: "change-me-to-a-32-byte-random-hex-string-0000000",
    };
    expect(configErrorLines(configError(fromLayer(AppConfig.layerFrom(source))))).toEqual([
      "  - (env): SESSION_SECRET is still the .env.example placeholder — generate one: openssl rand -hex 32",
    ]);
  });
});

describe("AppConfig.config: the current ConfigProvider", () => {
  test("reads the installed provider", () => {
    const provider = ConfigProvider.layer(
      ConfigProvider.fromUnknown({ ...BASE, API_PORT: "4000", TRUST_PROXY: "true" }),
    );
    const config = Effect.runSync(Effect.provide(AppConfig.config, provider));
    expect(config.API_PORT).toBe(4000);
    expect(config.trustProxy).toBe(true);
    expect(config.SESSION_SECRET).toBe(BASE.SESSION_SECRET);
  });

  test("parse(provider) fails with every issue collected", () => {
    const exit = Effect.runSyncExit(
      AppConfig.config.parse(ConfigProvider.fromUnknown({ SESSION_SECRET: "x", API_PORT: "abc" })),
    );
    const lines = configErrorLines(configError(exit));
    expect(lines.map((line) => /^ {2}- ([^:]+): /.exec(line)?.[1])).toEqual([
      "DATABASE_URL",
      "API_PORT",
      "SESSION_SECRET",
    ]);
    expect(lines).toEqual(parseLines({ SESSION_SECRET: "x", API_PORT: "abc" }));
  });
});

describe("the process value in a fresh process", () => {
  async function run(script: string, extraEnv: Source): Promise<{ code: number; stdout: string; stderr: string }> {
    const childEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...extraEnv })) {
      if (value !== undefined) childEnv[key] = value;
    }
    const proc = Bun.spawn(["bun", "-e", script], { cwd: API_ROOT, env: childEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  }

  test("NODE_ENV=production with the change-me secret exits 1 with the placeholder line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "toon-config-"));
    try {
      const production: Source = {
        NODE_ENV: "production",
        DATABASE_URL: `file:${join(dir, "app.db")}`,
        DATABASE_AUTH_TOKEN: undefined,
        TEST_DATABASE_URL: undefined,
        SESSION_SECRET: "change-me-to-a-32-byte-random-hex-string-0000000",
        UPLOAD_DIR: join(dir, "uploads"),
        WEB_DIST_DIR: undefined,
        MAIL_TRANSPORT: undefined,
      };
      // Importing config.ts alone resolves nothing: no dotenv, no exit.
      const imported = await run('await import("./src/config.ts"); console.log("imported");', production);
      expect(imported.code).toBe(0);
      expect(imported.stdout).toContain("imported");

      const viaLayer = await run(
        [
          'const { Effect } = await import("effect");',
          'const { AppConfig } = await import("./src/config.ts");',
          "Effect.runSync(Effect.provide(Effect.gen(function* () { yield* AppConfig; }), AppConfig.layer));",
          'console.log("resolved");',
        ].join(" "),
        production,
      );
      expect(viaLayer.code).toBe(1);
      expect(viaLayer.stdout).not.toContain("resolved");
      expect(viaLayer.stderr).toContain(
        "Invalid environment variables — check your .env (template: .env.example):\n" +
          "  - (env): SESSION_SECRET is still the .env.example placeholder — generate one: openssl rand -hex 32",
      );

      const viaEnv = await run('await import("./src/env.ts"); console.log("env ok");', production);
      expect(viaEnv.code).toBe(1);
      expect(viaEnv.stderr).toContain("SESSION_SECRET is still the .env.example placeholder");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
