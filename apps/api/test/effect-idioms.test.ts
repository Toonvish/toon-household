// The Effect idioms gate (docs/EFFECT.md E12, E1, E2; plan docs/plans/e0-foundation.md E0-T06, P7, P8).
// It makes the greps of E12 permanent in `bun test`, in the shape of
// apps/web/src/styles/design-system.test.ts: one `describe` per rule, a comment-free line scan, and a
// failure text of `file:line: code` per hit. A new violation anywhere fails here with the rule; never
// relax a rule to get green (an allow list is a pinned constant with a reason per entry).
//
// Only the rules that hold at E0 are switched on. The rules a later milestone switches on are listed in
// PENDING_RULES below as a comment, never as skipped or todo tests.
//
// PENDING_RULES (switched on by the milestone named; each is a new `describe` in the same commit as the
// migration that makes it true):
//   E2  (api-core-services) No `throw new ApiError` in services; no `Date.now()` / `new Date()` in services
//        (DateTime / Clock instead).
//   E7  (http-api)       No `hono` import or dependency (the HttpApi server replaces it; docs/EFFECT.md E7).
//
// Comment lines (trimmed line starting with `*`, `//`, `/*`, `{/*`) are never scanned. No test reads git history.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const SELF = join(import.meta.dir, "effect-idioms.test.ts");

const SCAN_DIRS = [
  "apps/api/src",
  "apps/api/scripts",
  "apps/api/test",
  "apps/web/src",
  "packages/shared/src",
  "packages/shared/test",
  "scripts",
];
const SCAN_EXTRA_FILES = ["apps/web/vite.config.ts", "apps/web/pwa-manifest.ts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "repos"]);
const SOURCE_EXT = /\.(ts|tsx|js|mjs)$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const ALL_FILES = [
  ...SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))),
  ...SCAN_EXTRA_FILES.map((f) => join(ROOT, f)).filter((f) => existsSync(f)),
].filter((f) => SOURCE_EXT.test(f) && f !== SELF);

const rel = (file: string) => relative(ROOT, file).split(sep).join("/");

const COMMENT_START = /^(\*|\/\/|\/\*|\{\/\*)/;
interface Line {
  file: string;
  n: number;
  text: string;
}

const lineCache = new Map<string, Line[]>();
/** Non-comment lines of a file. */
function codeLines(file: string): Line[] {
  const cached = lineCache.get(file);
  if (cached) return cached;
  const lines: Line[] = [];
  let inBlock = false;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((text, i) => {
      const trimmed = text.trim();
      if (inBlock) {
        if (trimmed.includes("*/")) inBlock = false;
        return;
      }
      // A multi-line block comment (or JSX comment) opened on a line of its own.
      if (/^(\/\*|\{\/\*)/.test(trimmed) && !trimmed.includes("*/")) {
        inBlock = true;
        return;
      }
      if (!COMMENT_START.test(trimmed)) lines.push({ file, n: i + 1, text });
    });
  lineCache.set(file, lines);
  return lines;
}

function scan(files: string[], test: (line: Line) => boolean): Line[] {
  return files.flatMap((f) => codeLines(f).filter(test));
}

/** The module specifiers on a line: `from "x"`, `import "x"`, `import("x")`, `require("x")`, `mock.module("x")`. */
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bmock\.module\s*\(\s*)(["'`])([^"'`\n]+)\1/g;
function specifiers(text: string): string[] {
  return [...text.matchAll(SPECIFIER)].map((m) => m[2]!);
}
const hasSpecifier = (line: Line, pred: (spec: string) => boolean) =>
  specifiers(line.text).some(pred);

function report(rule: string, hits: Line[]): string {
  if (hits.length === 0) return "";
  return `${rule}\n` + hits.map((h) => `  ${rel(h.file)}:${h.n}: ${h.text.trim()}`).join("\n");
}

function expectNone(rule: string, hits: Line[]) {
  expect(report(rule, hits)).toBe("");
}

/** Failures of a non-line rule (a package.json, the lockfile, a config file), `where: what` per entry. */
function expectNoProblems(rule: string, problems: string[]) {
  expect(problems.length === 0 ? "" : `${rule}\n` + problems.map((p) => `  ${p}`).join("\n")).toBe("");
}

// The package names Effect 3 spread over other packages (E1, E7, E12): none of them is a dependency or an import.
const isV3Package = (spec: string) =>
  spec === "@effect/platform" ||
  spec.startsWith("@effect/platform/") ||
  spec === "@effect/schema" ||
  spec.startsWith("@effect/schema/") ||
  spec === "@effect/sql" ||
  spec.startsWith("@effect/sql/") ||
  spec.startsWith("@effect/sql-") ||
  spec === "@effect/vitest" ||
  spec.startsWith("@effect/vitest/");

describe("the scan covers the plan's files", () => {
  test("it sees the directories and files of E0-T06 and none of node_modules, dist, repos or itself", () => {
    const rels = ALL_FILES.map(rel);
    for (const must of ["apps/api/src/index.ts", "apps/web/src/main.tsx", "packages/shared/src/index.ts", "scripts/typecheck.ts", "apps/web/vite.config.ts", "apps/web/pwa-manifest.ts"]) {
      expect(rels).toContain(must);
    }
    expect(rels.filter((r) => /(^|\/)(node_modules|dist|repos)\//.test(r) || r === rel(SELF))).toEqual([]);
  });
});

// --- (1) the vendored tree is read, never imported ------------------------------------------------

// Pinned allow lists (file -> reason); all empty at E0.
const ALLOW_VENDORED_IMPORT: Record<string, string> = {};
const ALLOW_UNSTABLE_IMPORT: Record<string, string> = {};
const ALLOW_V3_PACKAGE: Record<string, string> = {};
const ALLOW_V3_CONSTRUCTOR: Record<string, string> = {};
const ALLOW_ZOD: Record<string, string> = {};

const allowed = (allow: Record<string, string>) => (line: Line) => rel(line.file) in allow;

describe("(1) no import from the vendored tree (E2)", () => {
  test("no specifier contains repos/", () => {
    expectNone(
      "repos/effect is read-only reference material: never import from repos/ in application code (docs/EFFECT.md E2)",
      scan(ALL_FILES, (l) => hasSpecifier(l, (s) => s.includes("repos/")) && !allowed(ALLOW_VENDORED_IMPORT)(l)),
    );
  });
});

// --- (2) no unstable path -------------------------------------------------------------------------

describe("(2) no effect/unstable/ path (E12)", () => {
  test("no specifier contains effect/unstable/", () => {
    expectNone(
      "no effect/unstable/* import: the stable effect/* paths only (docs/EFFECT.md E12)",
      scan(ALL_FILES, (l) => hasSpecifier(l, (s) => s.includes("effect/unstable/")) && !allowed(ALLOW_UNSTABLE_IMPORT)(l)),
    );
  });
});

// --- (3) no v3 package ----------------------------------------------------------------------------

describe("(3) no Effect 3 package specifier (E1, E7, E12)", () => {
  test("no @effect/platform, @effect/schema, @effect/sql, @effect/sql-*, @effect/vitest", () => {
    expectNone(
      "Effect 4 has these in `effect` itself; only effect and @effect/platform-bun are packages (docs/EFFECT.md E12)",
      scan(ALL_FILES, (l) => hasSpecifier(l, isV3Package) && !allowed(ALLOW_V3_PACKAGE)(l)),
    );
  });
});

// --- (4) no v3 service constructors ---------------------------------------------------------------

describe("(4) no Effect 3 service constructors (E12)", () => {
  test("no Context.Tag(, Context.GenericTag(, Effect.Tag(, Effect.Service<", () => {
    const V3_CONSTRUCTOR = /\b(?:Context\.Tag\s*[(<]|Context\.GenericTag\s*[(<]|Effect\.Tag\s*[(<]|Effect\.Service\s*<)/;
    expectNone(
      "services are `Context.Service` with a static `layer` (docs/EFFECT.md E12)",
      scan(ALL_FILES, (l) => V3_CONSTRUCTOR.test(l.text) && !allowed(ALLOW_V3_CONSTRUCTOR)(l)),
    );
  });
});

// --- (5) one runtime ------------------------------------------------------------------------------

// Where `ManagedRuntime.make(` may appear in non-test source (E6 adds apps/web/src/lib/runtime.ts).
const RUNTIME_ALLOW_LIST = ["apps/api/src/runtime.ts"];
const NON_TEST_ROOTS = ["apps/api/src/", "apps/api/scripts/", "packages/shared/src/", "apps/web/src/"];

describe("(5) one ManagedRuntime per process (E7, E12)", () => {
  test("ManagedRuntime.make( appears in non-test source only in the allow list", () => {
    const files = ALL_FILES.filter(
      (f) => NON_TEST_ROOTS.some((r) => rel(f).startsWith(r)) && !/\.test\.tsx?$/.test(f),
    );
    expectNone(
      `ManagedRuntime.make( only in ${RUNTIME_ALLOW_LIST.join(", ")} (docs/EFFECT.md E7, E12)`,
      scan(files, (l) => /\bManagedRuntime\.make\s*\(/.test(l.text) && !RUNTIME_ALLOW_LIST.includes(rel(l.file))),
    );
  });
});

// --- (6) dependencies -----------------------------------------------------------------------------

const PACKAGE_JSONS = ["package.json", "apps/api/package.json", "apps/web/package.json", "packages/shared/package.json"];
const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
type PackageJson = Partial<Record<(typeof DEP_SECTIONS)[number], Record<string, string>>> & { version?: string };

const readJson = (path: string): PackageJson => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const isEffectName = (name: string) => name === "effect" || name.startsWith("@effect/");
const EXACT = /^\d+\.\d+\.\d+$/;

const apiEffectVersion = readJson("apps/api/package.json").dependencies?.effect ?? "";

describe("(6) the Effect dependencies are exact, equal and the right ones (E12)", () => {
  test("every effect / @effect/* entry is an exact version equal to apps/api's effect", () => {
    const problems: string[] = [];
    if (!EXACT.test(apiEffectVersion)) problems.push(`apps/api/package.json: effect is "${apiEffectVersion}", not an exact version`);
    for (const path of PACKAGE_JSONS) {
      const json = readJson(path);
      for (const section of DEP_SECTIONS) {
        for (const [name, range] of Object.entries(json[section] ?? {})) {
          if (!isEffectName(name)) continue;
          if (!EXACT.test(range)) problems.push(`${path}: ${section}.${name} is "${range}", not an exact version`);
          else if (range !== apiEffectVersion) problems.push(`${path}: ${section}.${name} is ${range}, apps/api's effect is ${apiEffectVersion}`);
        }
      }
    }
    expectNoProblems("one Effect version everywhere, pinned without ^ or ~ (docs/EFFECT.md E12)", problems);
  });

  test("none of the Effect 3 packages or @effect/sql-drizzle is a dependency", () => {
    const problems: string[] = [];
    for (const path of PACKAGE_JSONS) {
      const json = readJson(path);
      for (const section of DEP_SECTIONS) {
        for (const name of Object.keys(json[section] ?? {})) {
          if (isV3Package(`${name}/`)) problems.push(`${path}: ${section}.${name}`);
          else if (name === "@effect/sql-drizzle") problems.push(`${path}: ${section}.${name}`);
        }
      }
    }
    expectNoProblems("forbidden Effect packages (docs/EFFECT.md E1, E7, E12; the E5 decision on @effect/sql-libsql is an owner decision)", problems);
  });

  test("effect is present in apps/api, apps/web and packages/shared; @effect/platform-bun in apps/api", () => {
    const has = (path: string, name: string) => DEP_SECTIONS.some((s) => name in (readJson(path)[s] ?? {}));
    const problems: string[] = [];
    for (const path of ["apps/api/package.json", "apps/web/package.json", "packages/shared/package.json"]) {
      if (!has(path, "effect")) problems.push(`${path}: effect is missing`);
    }
    if (!has("apps/api/package.json", "@effect/platform-bun")) problems.push("apps/api/package.json: @effect/platform-bun is missing");
    expectNoProblems("effect in the three workspaces, @effect/platform-bun in apps/api (docs/plans/e0-foundation.md P3)", problems);
  });
});

// --- (7) the lockfile -----------------------------------------------------------------------------

describe("(7) bun.lock resolves every Effect package to the one version (E12)", () => {
  test("every effect@x and @effect/<name>@x equals apps/api's effect", () => {
    const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const m of lock.matchAll(/"(effect|@effect\/[a-z0-9-]+)@(\d[^"]*)"/g)) {
      seen.add(m[1]!);
      if (m[2] !== apiEffectVersion) problems.push(`bun.lock: ${m[1]}@${m[2]}, apps/api's effect is ${apiEffectVersion}`);
    }
    if (!seen.has("effect")) problems.push("bun.lock: no resolved effect entry");
    expectNoProblems("no second Effect version in the lockfile (docs/EFFECT.md E12)", problems);
  });
});

// --- (8) the vendored tree is pinned and fenced (P1, P2, P8) --------------------------------------

describe("(8) the vendored Effect tree matches the installed version and stays fenced (E2)", () => {
  test("repos/effect/packages/effect/package.json version equals the installed effect", () => {
    const path = "repos/effect/packages/effect/package.json";
    const problems: string[] = [];
    if (!existsSync(join(ROOT, path))) problems.push(`${path}: missing (git subtree add / pull docs/EFFECT.md E2)`);
    else {
      const vendored = readJson(path).version;
      if (vendored !== apiEffectVersion) problems.push(`${path}: version ${vendored}, installed effect is ${apiEffectVersion} (git subtree pull)`);
    }
    expectNoProblems("the vendored source is the version the code runs (docs/plans/e0-foundation.md P8)", problems);
  });

  test("bunfig.toml [test] pathIgnorePatterns contains repos/**", () => {
    const toml = Bun.TOML.parse(readFileSync(join(ROOT, "bunfig.toml"), "utf8")) as {
      test?: { pathIgnorePatterns?: unknown };
    };
    const patterns = toml.test?.pathIgnorePatterns;
    const ok = Array.isArray(patterns) && patterns.includes("repos/**");
    expectNoProblems('bun test must never discover repos/ (P1)', ok ? [] : [`bunfig.toml: [test] pathIgnorePatterns is ${JSON.stringify(patterns)}`]);
  });

  test(".dockerignore has the line repos", () => {
    const lines = readFileSync(join(ROOT, ".dockerignore"), "utf8").split("\n").map((l) => l.trim());
    expectNoProblems("repos stays out of the build context (P2)", lines.includes("repos") ? [] : [".dockerignore: no line `repos`"]);
  });

  test(".vscode/settings.json parses and excludes repos/**", () => {
    const problems: string[] = [];
    const path = join(ROOT, ".vscode", "settings.json");
    if (!existsSync(path)) problems.push(".vscode/settings.json: missing");
    else {
      const s = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      const excludeKey = (key: string, glob: string) => {
        const v = s[key];
        return v !== null && typeof v === "object" && !Array.isArray(v) && (v as Record<string, unknown>)[glob] === true;
      };
      if (!excludeKey("search.exclude", "repos/**")) problems.push('.vscode/settings.json: search.exclude lacks "repos/**": true');
      if (!excludeKey("files.watcherExclude", "**/repos/**")) problems.push('.vscode/settings.json: files.watcherExclude lacks "**/repos/**": true');
      const auto = s["typescript.preferences.autoImportFileExcludePatterns"];
      if (!Array.isArray(auto) || !auto.includes("repos/**")) problems.push('.vscode/settings.json: typescript.preferences.autoImportFileExcludePatterns lacks "repos/**"');
    }
    expectNoProblems("the editor never indexes or imports from repos/ (P2)", problems);
  });
});

// --- (9) no zod (plan e1 P15) ---------------------------------------------------------------------

const isZodPackage = (spec: string) =>
  spec === "zod" || spec.startsWith("zod/") || spec === "@hono/zod-validator" || spec.startsWith("@hono/zod-validator/");

describe("(9) no zod (E1, E4)", () => {
  test("no zod, zod/* or @hono/zod-validator specifier in a scanned file", () => {
    expectNone(
      "validation is Effect Schema; zod and @hono/zod-validator are gone (docs/EFFECT.md E1, E4)",
      scan(ALL_FILES, (l) => hasSpecifier(l, isZodPackage) && !allowed(ALLOW_ZOD)(l)),
    );
  });

  test("zod and @hono/zod-validator are in no dependency section of a package.json", () => {
    const problems: string[] = [];
    for (const path of PACKAGE_JSONS) {
      const json = readJson(path);
      for (const section of DEP_SECTIONS) {
        for (const name of Object.keys(json[section] ?? {})) {
          if (isZodPackage(name) && !(path in ALLOW_ZOD)) problems.push(`${path}: ${section}.${name}`);
        }
      }
    }
    expectNoProblems("no zod dependency in any workspace (docs/EFFECT.md E1, E4)", problems);
  });

  test('bun.lock has no "zod" or "@hono/zod-validator" key', () => {
    const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");
    const problems = [...lock.matchAll(/"(zod|@hono\/zod-validator)(?:@[^"]*)?"\s*:/g)].map((m) => `bun.lock: "${m[1]}"`);
    expectNoProblems("no zod entry in the lockfile (docs/EFFECT.md E1, E4)", problems);
  });
});
