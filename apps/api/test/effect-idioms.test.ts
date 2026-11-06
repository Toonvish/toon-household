// The Effect idioms gate (docs/EFFECT.md E12, E1, E2; plan docs/plans/e0-foundation.md E0-T06, P7, P8).
// It makes the greps of E12 permanent in `bun test`, in the shape of
// apps/web/src/styles/design-system.test.ts: one `describe` per rule, a comment-free line scan, and a
// failure text of `file:line: code` per hit. A new violation anywhere fails here with the rule; never
// relax a rule to get green (an allow list is a pinned constant with a reason per entry).
//
// Only the rules that hold at the current milestone are switched on. The rules a later milestone switches on are listed in
// PENDING_RULES below as a comment, never as skipped or todo tests.
//
// PENDING_RULES (switched on by the milestone named; each is a new `describe` in the same commit as the
// migration that makes it true):
// (E1 switched on rule (9), E2 rules (10) and (11), E5 rule (12), E6 rule (13), E7 rule (14), E8 rules (15) to (21) below; none is pending.)
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

// Where `ManagedRuntime.make(` may appear in non-test source: the API's one runtime (E7) and the web's one runtime
// over `FetchHttpClient` (E11, added by E6-T01; plan docs/plans/e6-web-client.md P1).
const RUNTIME_ALLOW_LIST = ["apps/api/src/runtime.ts", "apps/web/src/lib/runtime.ts"];
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

// --- (10), (11) the E2 rules (plan docs/plans/e2-api-core-services.md P15) -------------------------

/** A pinned allow list over file paths: a key ending in `/` is a directory prefix, any other key is one file. */
type PathAllow = Record<string, string>;
const pathAllowed = (allow: PathAllow, path: string) =>
  Object.keys(allow).some((key) => (key.endsWith("/") ? path.startsWith(key) : path === key));
const allowedPath = (allow: PathAllow) => (line: Line) => pathAllowed(allow, rel(line.file));

/** Every allow-list entry must still match a hit of its rule: a fixed file leaves the list in the same commit. */
function expectNoStaleEntries(rule: string, allow: PathAllow, hits: Line[]) {
  const stale = Object.keys(allow).filter(
    (key) => !hits.some((h) => (key.endsWith("/") ? rel(h.file).startsWith(key) : rel(h.file) === key)),
  );
  expectNoProblems(`${rule}: allow-list entries that no longer match a hit (remove them)`, stale.map((k) => `${k}: ${allow[k]}`));
}

const API_SRC_FILES = ALL_FILES.filter((f) => rel(f).startsWith("apps/api/src/"));

// Pinned allow list (path prefix -> reason): empty since E4-T06 (E3 moved the recipe module and E4 the finance module
// onto the tagged family); a new entry would need an ADR.
const ALLOW_THROW_API_ERROR: PathAllow = {};
const THROW_API_ERROR = /\bthrow\s+(?:new\s+)?ApiError\b/;

describe("(10) no throw of ApiError (E6, E12)", () => {
  test("no `throw ApiError` / `throw new ApiError` under apps/api/src outside the pinned module allow list", () => {
    expectNone(
      "refusals are `return yield* new <TaggedError>(...)` (a Schema.TaggedError of apps/api/src/lib/errors.ts), never a thrown ApiError (docs/EFFECT.md E6, E12)",
      scan(API_SRC_FILES, (l) => THROW_API_ERROR.test(l.text) && !allowedPath(ALLOW_THROW_API_ERROR)(l)),
    );
  });

  test("every allow-list entry still matches (E3 and E4 shrink it, never grow it)", () => {
    expectNoStaleEntries("(10)", ALLOW_THROW_API_ERROR, scan(API_SRC_FILES, (l) => THROW_API_ERROR.test(l.text)));
  });

  test("the rule bites: a throw line matches, a comment-free Effect refusal does not", () => {
    expect(THROW_API_ERROR.test("  throw ApiError.notFound();")).toBe(true);
    expect(THROW_API_ERROR.test("  throw new ApiError(409, 'x', 'y');")).toBe(true);
    expect(THROW_API_ERROR.test("  return yield* new NotFound();")).toBe(false);
  });
});

// Pinned allow list (path or prefix -> reason) for `Date.now(` / `new Date(` under a `services/` directory.
// Empty since E4-T09: the core `nowMs()` is deleted (recipe reads the Clock since E3, finance since E4), so no service reads the
// wall clock; the stale-entry test below fails an entry that no longer matches.
const ALLOW_SERVICE_DATE: PathAllow = {};
const SERVICE_DATE = /\bDate\.now\s*\(|\bnew\s+Date\s*\(/;
const SERVICE_FILES = API_SRC_FILES.filter((f) => rel(f).includes("/services/"));

// The core `nowMs()` is gone (E4-T09). A `nowMs(` call reads the wall clock and bypasses the Clock as surely as a literal
// `Date.now(` does (plan e2 P7, plan e3 P16, plan e4 P12): nothing under apps/api/src/core/, apps/api/src/modules/recipe/ or
// apps/api/src/modules/finance/ calls it. The one allowed line is the definition of the finance module clock's synchronous
// read, kept for the test harness (`apps/api/test/support/finance-harness.ts`).
const NOW_MS_CALL = /\bnowMs\s*\(/;
const CORE_FILES = API_SRC_FILES.filter(
  (f) =>
    rel(f).startsWith("apps/api/src/core/") ||
    rel(f).startsWith("apps/api/src/modules/recipe/") ||
    rel(f).startsWith("apps/api/src/modules/finance/"),
);
// Empty since E8-T06: the finance clock's synchronous `nowMs()` is deleted (its test door is
// `apps/api/test/support/bridges/finance-clock.ts`, plan e8 P1), so no `nowMs(` line is left under the core or the modules.
const ALLOW_NOW_MS: PathAllow = {};

describe("(11) no Date.now() / new Date( in services, no nowMs( in the core or the modules (E7, E12)", () => {
  test("no `Date.now(` / `new Date(` in a services/ directory outside the pinned allow list", () => {
    expectNone(
      "services read time from Clock / DateTime inside the method body (docs/EFFECT.md E7, E12; plan e2 P7)",
      scan(SERVICE_FILES, (l) => SERVICE_DATE.test(l.text) && !allowedPath(ALLOW_SERVICE_DATE)(l)),
    );
  });

  test("every service allow-list entry still matches", () => {
    expectNoStaleEntries("(11)", ALLOW_SERVICE_DATE, scan(SERVICE_FILES, (l) => SERVICE_DATE.test(l.text)));
  });

  test("no `nowMs(` call under apps/api/src/core/, apps/api/src/modules/recipe/ or apps/api/src/modules/finance/ (it reads Date.now(), bypassing the Clock)", () => {
    expectNone(
      "the core and the modules read `yield* Clock.currentTimeMillis` (finance: `financeTimeMillis`), never nowMs() (plan e2 P7, plan e3 P16, plan e4 P12)",
      scan(CORE_FILES, (l) => NOW_MS_CALL.test(l.text) && !allowedPath(ALLOW_NOW_MS)(l)),
    );
  });

  test("the nowMs allow-list entry still matches", () => {
    expectNoStaleEntries("(11) nowMs", ALLOW_NOW_MS, scan(CORE_FILES, (l) => NOW_MS_CALL.test(l.text)));
  });

  test("the rule bites on the three shapes", () => {
    expect(SERVICE_DATE.test("const at = Date.now();")).toBe(true);
    expect(SERVICE_DATE.test("const d = new Date(value);")).toBe(true);
    expect(SERVICE_DATE.test("const at = yield* Clock.currentTimeMillis;")).toBe(false);
    expect(NOW_MS_CALL.test("const at = nowMs();")).toBe(true);
    expect(NOW_MS_CALL.test("const at = yield* Clock.currentTimeMillis;")).toBe(false);
  });
});

// --- (12) the E5 rule: the scripts are Effect programs (plan docs/plans/e5-scripts.md P12, P14; docs/EFFECT.md E10) ----

const SCRIPT_FILES = ALL_FILES.filter((f) => rel(f).startsWith("apps/api/scripts/"));
/** The files directly under apps/api/scripts/ (the entry points; `support/`, `legacy/`, `finance-import/` are libraries). */
const SCRIPT_ENTRIES = SCRIPT_FILES.filter((f) => /^apps\/api\/scripts\/[^/]+\.ts$/.test(rel(f)));
const SCRIPT_LIBRARY_FILES = SCRIPT_FILES.filter(
  (f) => rel(f).startsWith("apps/api/scripts/legacy/") || rel(f).startsWith("apps/api/scripts/finance-import/"),
);
const SCRIPT_AND_SRC_FILES = [...API_SRC_FILES, ...SCRIPT_FILES];

const RUNS_AS_PROGRAM = /\brunScript\s*\(|\bBunRuntime\.runMain\s*\(/;
const PROCESS_EXIT = /\bprocess\.exit\s*\(/;
const AWAIT = /\bawait\s/;
const RUN_MODULE_HOOK = /\brunModuleHook\b/;

// Pinned allow list (file -> reason) for `process.exit(` under apps/api/scripts/: the runner's teardown only.
const ALLOW_PROCESS_EXIT: PathAllow = {
  "apps/api/scripts/support/main.ts": "the runner's teardown, which ends the process after the scope closed (plan e5 P1)",
};

describe("(12) the scripts are Effect programs (E10, E12)", () => {
  test("(a) every entry point directly under apps/api/scripts/ runs through runScript( or BunRuntime.runMain(", () => {
    const missing = SCRIPT_ENTRIES.filter((f) => !codeLines(f).some((l) => RUNS_AS_PROGRAM.test(l.text)));
    expectNoProblems(
      "a script is an Effect program run by `runScript(` (apps/api/scripts/support/main.ts) or `BunRuntime.runMain(` (docs/EFFECT.md E10)",
      missing.map((f) => `${rel(f)}:1: no runScript( or BunRuntime.runMain( call`),
    );
  });

  test("the scan sees the entry points", () => {
    expect(SCRIPT_ENTRIES.length).toBeGreaterThanOrEqual(8);
  });

  test("(b) no `process.exit(` under apps/api/scripts/ outside the pinned allow list", () => {
    expectNone(
      "a script ends through its exit code, the runner's teardown calls process.exit once (plan e5 P1, P14)",
      scan(SCRIPT_FILES, (l) => PROCESS_EXIT.test(l.text) && !allowedPath(ALLOW_PROCESS_EXIT)(l)),
    );
  });

  test("(b) every process.exit allow-list entry still matches", () => {
    expectNoStaleEntries("(12) process.exit", ALLOW_PROCESS_EXIT, scan(SCRIPT_FILES, (l) => PROCESS_EXIT.test(l.text)));
  });

  test("(c) no `await ` under apps/api/scripts/legacy/ and apps/api/scripts/finance-import/ (the library is Effect)", () => {
    expectNone(
      "the migrate:legacy and finance-import libraries are Effects, with no `await` (plan e5 P14; their Promise doors are the test doors of apps/api/test/support/bridges/, plan e8 P1)",
      scan(SCRIPT_LIBRARY_FILES, (l) => AWAIT.test(l.text)),
    );
  });

  test("(d) no runModuleHook under apps/api/src or apps/api/scripts (deleted by E5-T09)", () => {
    expectNone(
      "a hook runs outside the runtime with Database.layerFromExecutor provided (plan e5 P12)",
      scan(SCRIPT_AND_SRC_FILES, (l) => RUN_MODULE_HOOK.test(l.text)),
    );
  });

  test("the rule bites on its shapes", () => {
    expect(RUNS_AS_PROGRAM.test("runScript(program);")).toBe(true);
    expect(RUNS_AS_PROGRAM.test("BunRuntime.runMain(program, { teardown });")).toBe(true);
    expect(RUNS_AS_PROGRAM.test("main();")).toBe(false);
    expect(PROCESS_EXIT.test("  process.exit(1);")).toBe(true);
    expect(PROCESS_EXIT.test("  process.exitCode = 1;")).toBe(false);
    expect(AWAIT.test("  const rows = await client.execute(sql);")).toBe(true);
    expect(AWAIT.test("  const rows = yield* Effect.promise(() => client.execute(sql));")).toBe(false);
    expect(RUN_MODULE_HOOK.test("import { runModuleHook } from '../adapter.ts';")).toBe(true);
  });
});

// --- (13) the E6 rules: Effect stays at the edge of the web app (plan docs/plans/e6-web-client.md P13; docs/EFFECT.md E11, E12) ----

const WEB_SRC_FILES = ALL_FILES.filter((f) => rel(f).startsWith("apps/web/src/") && !/\.test\.tsx?$/.test(rel(f)));
const WEB_EFFECT_SPECIFIER = /^effect(?:\/.*)?$/;
const importsEffect = (l: Line) => hasSpecifier(l, (spec) => WEB_EFFECT_SPECIFIER.test(spec));

// Pinned allow list (file -> reason): the only web files that import `effect` at all. Plan e6 P13 also names
// apps/web/src/modules/recipe/lib/api.ts and apps/web/src/modules/finance/lib/api.ts; they build on the helpers of
// apps/web/src/lib/api.ts and import no `effect` specifier, so listing them would be a stale entry (recorded as a deviation).
const WEB_EFFECT_ALLOW_LIST: PathAllow = {
  "apps/web/src/lib/runtime.ts": "the one ManagedRuntime, the transport layer and runPromise (E11)",
  "apps/web/src/lib/api-client.ts": "the ApiClient service, the tagged ApiError and the envelope mapping (E11)",
  "apps/web/src/lib/api.ts": "the request helpers and CoreApi, the effects behind the Promise facades (E11)",
  "apps/web/src/lib/validation.ts": "the form adapter over the shared Effect schemas (E1)",
  "apps/web/src/core/features/households/components/InvitePanel.tsx": "a form schema's decoding default (E1)",
  "apps/web/src/modules/recipe/features/import/lib/importApi.ts": "the import client on the runtime's HttpClient (E11; plan e6 P12)",
};

// The network primitives, two patterns with separate allow lists (`\b` keeps `refetch(` and `fetchQuery(` out).
const FETCH_CALL = /\bfetch\(/;
const ALLOW_FETCH: PathAllow = {
  "apps/web/src/lib/runtime.ts": "the late-bound Fetch of the transport layer, the one fetch( call of the web app (plan e6 P2)",
};
const XHR_CALL = /\bnew XMLHttpRequest\b/;
const ALLOW_XHR: PathAllow = {
  "apps/web/src/modules/recipe/features/import/lib/importApi.ts": "the upload progress events fetch cannot give (plan e6 P12)",
};

describe("(13) Effect stays at the edge of the web app (E11, E12)", () => {
  test("(a) every effect specifier of a non-test web file is exactly \"effect\" or \"effect/http\"", () => {
    expectNone(
      "the web app imports from \"effect\" and \"effect/http\" only (plan e6 P13a, P15)",
      scan(WEB_SRC_FILES, (l) => hasSpecifier(l, (spec) => WEB_EFFECT_SPECIFIER.test(spec) && spec !== "effect" && spec !== "effect/http")),
    );
  });

  test("(b) only the pinned files import effect", () => {
    expectNone(
      "Effect lives in the runtime, the clients and the form adapter; screens and queries call `runPromise` from @/lib/runtime (plan e6 P13b)",
      scan(WEB_SRC_FILES, (l) => importsEffect(l) && !allowedPath(WEB_EFFECT_ALLOW_LIST)(l)),
    );
  });

  test("(b) every WEB_EFFECT_ALLOW_LIST entry still matches", () => {
    expectNoStaleEntries("(13b)", WEB_EFFECT_ALLOW_LIST, scan(WEB_SRC_FILES, importsEffect));
  });

  test("(c) no `fetch(` call in a non-test web file outside the pinned allow list", () => {
    expectNone(
      "the transport is the runtime's HttpClient; the one fetch( call is the late-bound Fetch of runtime.ts (plan e6 P13c)",
      scan(WEB_SRC_FILES, (l) => FETCH_CALL.test(l.text) && !allowedPath(ALLOW_FETCH)(l)),
    );
  });

  test("(c) every fetch allow-list entry still matches", () => {
    expectNoStaleEntries("(13c) fetch", ALLOW_FETCH, scan(WEB_SRC_FILES, (l) => FETCH_CALL.test(l.text)));
  });

  test("(c) no `new XMLHttpRequest` in a non-test web file outside the pinned allow list", () => {
    expectNone(
      "the one XHR is the import upload's progress events (plan e6 P12, P13c)",
      scan(WEB_SRC_FILES, (l) => XHR_CALL.test(l.text) && !allowedPath(ALLOW_XHR)(l)),
    );
  });

  test("(c) every XMLHttpRequest allow-list entry still matches", () => {
    expectNoStaleEntries("(13c) XMLHttpRequest", ALLOW_XHR, scan(WEB_SRC_FILES, (l) => XHR_CALL.test(l.text)));
  });

  test("the scan covers the web sources and the rules bite", () => {
    expect(WEB_SRC_FILES.length).toBeGreaterThan(100);
    expect(WEB_SRC_FILES.some((f) => rel(f).endsWith(".test.ts"))).toBe(false);
    expect(FETCH_CALL.test("  globalThis.fetch(url);")).toBe(true);
    expect(FETCH_CALL.test("  await fetch('/x');")).toBe(true);
    expect(FETCH_CALL.test("  void refetch();")).toBe(false);
    expect(FETCH_CALL.test("  queryClient.fetchQuery(opts);")).toBe(false);
    expect(XHR_CALL.test("  const xhr = new XMLHttpRequest();")).toBe(true);
    expect(importsEffect({ file: "", n: 1, text: 'import { Option } from "effect/Option";' })).toBe(true);
  });
});

// --- (14) no hono (E7, E8) ------------------------------------------------------------------------

const isHonoPackage = (spec: string) => spec === "hono" || spec.startsWith("hono/");

const ALLOW_HONO: Record<string, string> = {};

describe("(14) no hono (E7, E8)", () => {
  test("no hono or hono/* specifier in a scanned file", () => {
    expectNone(
      "the API is served by effect/http-api on BunHttpServer; hono is gone (docs/EFFECT.md E8)",
      scan(ALL_FILES, (l) => hasSpecifier(l, isHonoPackage) && !allowed(ALLOW_HONO)(l)),
    );
  });

  test("hono is in no dependency section of a package.json", () => {
    const problems: string[] = [];
    for (const path of PACKAGE_JSONS) {
      const json = readJson(path);
      for (const section of DEP_SECTIONS) {
        for (const name of Object.keys(json[section] ?? {})) {
          if (isHonoPackage(name) && !(path in ALLOW_HONO)) problems.push(`${path}: ${section}.${name}`);
        }
      }
    }
    expectNoProblems("the API is served by effect/http-api on BunHttpServer; hono is gone (docs/EFFECT.md E8)", problems);
  });

  test('bun.lock has no "hono" key', () => {
    const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");
    const problems = [...lock.matchAll(/"(hono)(?:@[^"]*)?"\s*:/g)].map((m) => `bun.lock: "${m[1]}"`);
    expectNoProblems("the API is served by effect/http-api on BunHttpServer; hono is gone (docs/EFFECT.md E8)", problems);
  });
});

// --- (15) to (21) the E12 idioms grep can see (E8; plan docs/plans/e8-harden.md P7; docs/EFFECT.md E12) ----------------------
//
// Rules (15) and (16) read the style of every Effect function, (17) and (18) the guards and errors, (19) the Clock on the request
// path, (20) where an Effect is run and (21) the Effect 3 names. Each has a regex (or scanner) self-check, a pinned allow list
// where P7 names one and a stale-entry test where the list is not empty. Never relax a rule to get green: a hit is fixed in code.

const NON_TEST_FILE = (f: string) => !/\.test\.tsx?$/.test(f);
/** The non-test source of the four packages (rules (15) and (16)). */
const IDIOM_FILES = ALL_FILES.filter((f) => NON_TEST_ROOTS.some((r) => rel(f).startsWith(r)) && NON_TEST_FILE(f));
const API_SRC_NON_TEST = API_SRC_FILES.filter(NON_TEST_FILE);
const API_SRC_AND_SCRIPT_FILES = [...API_SRC_NON_TEST, ...SCRIPT_FILES.filter(NON_TEST_FILE)];

/**
 * The text of a TypeScript file with every comment, string, template-literal text and regex literal blanked to spaces (newlines and
 * offsets are kept, the quote and slash delimiters and the `${ … }` expressions of a template stay), so that a paren-balanced scan
 * is not fooled by a `)` or a quote inside a string. A heuristic tokenizer, not a parser: a regex literal is recognised after
 * `( , = : [ ! & | ? { ; ` or `return` and an apostrophe in JSX text blanks to the end of its line at most.
 */
function maskSource(src: string): string {
  const n = src.length;
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < Math.min(to, n); k++) if (src[k] !== "\n") out[k] = " ";
  };
  const templateStack: number[] = [];
  let depth = 0;
  let last = "";
  let lastWord = "";
  /** Masks template text from `start`; returns the index to resume at (after the closing backtick, or after a `${`). */
  const template = (start: number): number => {
    let k = start;
    while (k < n) {
      const c = src[k]!;
      if (c === "\\") {
        blank(k, k + 2);
        k += 2;
      } else if (c === "`") {
        return k + 1;
      } else if (c === "$" && src[k + 1] === "{") {
        templateStack.push(depth);
        depth++;
        last = "{";
        return k + 2;
      } else {
        blank(k, k + 1);
        k++;
      }
    }
    return k;
  };
  let i = 0;
  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && src[k] !== c && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
      blank(i + 1, k);
      i = Math.min(k + 1, n);
      last = c;
      lastWord = "";
    } else if (c === "`") {
      i = template(i + 1);
      last = "`";
      lastWord = "";
    } else if (c === "/" && (last === "" || "(,=:[!&|?{;".includes(last) || lastWord === "return" || lastWord === "typeof")) {
      let k = i + 1;
      let inClass = false;
      while (k < n && src[k] !== "\n" && (inClass || src[k] !== "/")) {
        if (src[k] === "\\") k++;
        else if (src[k] === "[") inClass = true;
        else if (src[k] === "]") inClass = false;
        k++;
      }
      if (src[k] === "/") {
        blank(i + 1, k);
        i = k + 1;
        last = "/";
        lastWord = "";
      } else {
        i++;
        last = "/";
      }
    } else {
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (templateStack.length > 0 && templateStack[templateStack.length - 1] === depth) {
          templateStack.pop();
          i = template(i + 1);
          last = "`";
          lastWord = "";
          continue;
        }
      }
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (/[\w$]/.test(c)) lastWord = /[\w$]/.test(last) ? lastWord + c : c;
      else lastWord = "";
      last = c;
      i++;
    }
  }
  return out.join("");
}

/** The index of the `)` closing the `(` at `open` in masked text, or -1. */
function matchParen(masked: string, open: number): number {
  let depth = 0;
  for (let k = open; k < masked.length; k++) {
    if (masked[k] === "(") depth++;
    else if (masked[k] === ")" && --depth === 0) return k;
  }
  return -1;
}

/** The index of the `(` matching the `)` at `close` in masked text, or -1. */
function matchParenBack(masked: string, close: number): number {
  let depth = 0;
  for (let k = close; k >= 0; k--) {
    if (masked[k] === ")") depth++;
    else if (masked[k] === "(" && --depth === 0) return k;
  }
  return -1;
}

const lineStarts = (text: string): number[] => {
  const starts = [0];
  for (let k = 0; k < text.length; k++) if (text[k] === "\n") starts.push(k + 1);
  return starts;
};
const lineAt = (starts: number[], offset: number): number => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const NOT_A_FUNCTION_PAREN = /\b(?:if|for|while|switch|catch|with)\s*$/;

/**
 * The three multi-line checks of rule (15), 1-based line numbers per kind, over the MASKED text (comments and strings skipped):
 *  (a) `Effect.fn(` whose first argument is not a string literal ("…", '…' or a template literal `…`: a span name);
 *  (b) `.pipe(` directly after the closing paren of `Effect.fn(…)(…)` or `Effect.fnUntraced(…)` (combinators are extra arguments);
 *  (c) a declared function or `const` / `let` arrow whose body is only `Effect.gen(…)` (`=> Effect.gen(` / `{ return Effect.gen(…) }`);
 *      an inline callback passed to a combinator is not a declaration and passes.
 */
function fnIdiomViolations(src: string): { a: number[]; b: number[]; c: number[] } {
  const m = maskSource(src);
  const starts = lineStarts(m);
  const a: number[] = [];
  const b: number[] = [];
  const c: number[] = [];

  for (const match of m.matchAll(/\bEffect\.(fnUntraced|fn)\s*(?:<[^()]*>)?\s*\(/g)) {
    const open = match.index! + match[0].length - 1;
    const kind = match[1];
    if (kind === "fn" && !/^\s*["'`]/.test(m.slice(open + 1, open + 200))) a.push(lineAt(starts, match.index!));
    const close = matchParen(m, open);
    if (close < 0) continue;
    let end = close;
    if (kind === "fn") {
      let j = close + 1;
      while (j < m.length && /\s/.test(m[j]!)) j++;
      if (m[j] === "(") {
        const second = matchParen(m, j);
        if (second >= 0) end = second;
      }
    }
    const pipe = /^\s*\.pipe\s*\(/.exec(m.slice(end + 1, end + 200));
    if (pipe) b.push(lineAt(starts, end + 1 + pipe[0].indexOf(".pipe")));
  }

  // (c) an arrow declared with const / let whose whole body is Effect.gen(
  for (const match of m.matchAll(/=>\s*Effect\.gen\s*\(/g)) {
    let depth = 0;
    let k = match.index! - 1;
    for (; k >= 0; k--) {
      const ch = m[k]!;
      if (")]}".includes(ch)) depth++;
      else if ("([{".includes(ch)) {
        depth--;
        if (depth < 0) break;
      } else if (ch === ";" && depth === 0) break;
    }
    if (depth < 0) continue;
    const segment = m.slice(k + 1, match.index!);
    const decl = [...segment.matchAll(/\b(?:const|let)\s+[\w$]+/g)].pop();
    if (!decl) continue;
    const rest = segment.slice(decl.index!);
    if (/^(?:const|let)\s+[\w$]+\s*(?::[^=]+?)?=\s*(?:async\s*)?[(\w$<]/.test(rest)) c.push(lineAt(starts, match.index!));
  }
  // (c) a function whose body is only `return Effect.gen(…)`
  for (const match of m.matchAll(/\breturn\s+Effect\.gen\s*\(/g)) {
    const open = match.index! + match[0].length - 1;
    const close = matchParen(m, open);
    if (close < 0 || !/^\s*;?\s*\}/.test(m.slice(close + 1, close + 40))) continue;
    const before = m.slice(0, match.index!).replace(/\s+$/, "");
    if (!before.endsWith("{")) continue;
    const head = before.slice(0, -1).replace(/\s+$/, "");
    let isFunction = false;
    if (head.endsWith("=>")) isFunction = true;
    else if (head.endsWith(")")) {
      const openParen = matchParenBack(head, head.length - 1);
      isFunction = openParen >= 0 && !NOT_A_FUNCTION_PAREN.test(head.slice(0, openParen));
    } else if (/\)\s*:\s*[^;{}]*$/.test(head.slice(-300))) isFunction = true;
    if (isFunction) c.push(lineAt(starts, match.index!));
  }
  return { a, b, c };
}

function fnIdiomHits(kind: "a" | "b" | "c"): Line[] {
  return IDIOM_FILES.flatMap((f) => {
    const text = readFileSync(f, "utf8");
    const lines = text.split("\n");
    return fnIdiomViolations(text)[kind].map((n) => ({ file: f, n, text: lines[n - 1] ?? "" }));
  });
}

describe("(15) Effect.fn idioms (E12)", () => {
  test("(a) `Effect.fn(` is named: its first argument is a string literal (a template literal is a span name)", () => {
    expectNone(
      "`Effect.fn(\"Service.method\")(function* …)`: the first argument is the span name, a string or template literal (docs/EFFECT.md E12; repos/effect/LLMS.md)",
      fnIdiomHits("a"),
    );
  });

  test("(b) no `.pipe(` after an Effect.fn(…)(…) / Effect.fnUntraced(…) call", () => {
    expectNone(
      "combinators are extra arguments of Effect.fn, never `.pipe` on it (docs/EFFECT.md E12; repos/effect/LLMS.md 'Do not use .pipe with Effect.fn')",
      fnIdiomHits("b"),
    );
  });

  test("(c) no declared function or const arrow whose body is only Effect.gen(", () => {
    expectNone(
      "a reusable function is `Effect.fn(\"name\")(function* …)`, not a function wrapping an Effect.gen (docs/EFFECT.md E12; repos/effect/LLMS.md 'Avoid creating functions that only wrap and return an Effect.gen')",
      fnIdiomHits("c"),
    );
  });

  test("the scan covers the non-test source of the four packages", () => {
    expect(IDIOM_FILES.length).toBeGreaterThan(300);
    expect(IDIOM_FILES.some((f) => rel(f).startsWith("apps/api/test/"))).toBe(false);
    expect(IDIOM_FILES.some((f) => /\.test\.tsx?$/.test(f))).toBe(false);
  });

  test("(a) bites: an unnamed or computed-name Effect.fn is a hit, a string, an apostrophe string and a template literal name are not", () => {
    expect(fnIdiomViolations("const f = Effect.fn(function* (x) { return x; });").a).toEqual([1]);
    expect(fnIdiomViolations("const f = Effect.fn(name)(function* (x) { return x; });").a).toEqual([1]);
    expect(fnIdiomViolations('const f = Effect.fn("Svc.method")(function* (x) { return x; });').a).toEqual([]);
    expect(fnIdiomViolations("const f = Effect.fn('Svc.method')(function* (x) { return x; });").a).toEqual([]);
    expect(fnIdiomViolations("const f = Effect.fn(`recipe.imports.${name}`)(function* (x) { return x; });").a).toEqual([]);
    expect(fnIdiomViolations("const f = Effect.fn(\n  \"Svc.method\",\n)(function* () {});").a).toEqual([]);
    expect(fnIdiomViolations("const f = Effect.fnUntraced(function* (x) { return x; });").a).toEqual([]);
    expect(fnIdiomViolations('// Effect.fn(x)(y)\nconst s = "Effect.fn(x)";').a).toEqual([]);
  });

  test("(b) bites: .pipe after the call is a hit (also across lines), an extra argument and a pipe inside the body are not", () => {
    expect(fnIdiomViolations('const f = Effect.fn("A.b")(function* (x) { return x; }).pipe(Effect.orDie);').b).toEqual([1]);
    expect(fnIdiomViolations('const f = Effect.fn("A.b")(function* () {\n  return 1;\n})\n  .pipe(Effect.orDie);').b).toEqual([4]);
    expect(fnIdiomViolations("const f = Effect.fnUntraced(function* (x) { return x; }).pipe(Effect.orDie);").b).toEqual([1]);
    expect(fnIdiomViolations('const f = Effect.fn("A.b")(function* (x) { return yield* g(x).pipe(Effect.orDie); });').b).toEqual([]);
    expect(fnIdiomViolations('const f = Effect.fn("A.b")(function* (x) { return x; }, Effect.orDie);').b).toEqual([]);
    expect(fnIdiomViolations('const f = Effect.fn("A.b")(function* () { const s = ")"; return s; }).bind(x);').b).toEqual([]);
  });

  test("(c) bites: a const arrow or a function returning Effect.gen is a hit, an inline callback and a longer body are not", () => {
    expect(fnIdiomViolations("const f = (x: number) => Effect.gen(function* () { return x; });").c).toEqual([1]);
    expect(fnIdiomViolations("export const g = async (x) => Effect.gen(function* () { return x; });").c).toEqual([1]);
    expect(fnIdiomViolations("const f = (x: number): Effect.Effect<number> => Effect.gen(function* () { return x; });").c).toEqual([1]);
    expect(fnIdiomViolations("function f(x: number) {\n  return Effect.gen(function* () { return x; });\n}").c).toEqual([2]);
    expect(fnIdiomViolations("const f = (x: number) => {\n  return Effect.gen(function* () { return x; });\n};").c).toEqual([2]);
    expect(fnIdiomViolations("const f = (x: number): Effect.Effect<number> => {\n  return Effect.gen(function* () { return x; });\n};").c).toEqual([2]);
    expect(fnIdiomViolations("Effect.flatMap(a, (x) => Effect.gen(function* () { return x; }));").c).toEqual([]);
    expect(fnIdiomViolations("const f = flow((x) => Effect.gen(function* () { return x; }));").c).toEqual([]);
    expect(fnIdiomViolations("function f(x: number) {\n  const y = x + 1;\n  return Effect.gen(function* () { return y; });\n}").c).toEqual([]);
    expect(fnIdiomViolations("if (x) {\n  return Effect.gen(function* () { return 1; });\n}").c).toEqual([]);
    expect(fnIdiomViolations("const f = (x: number) => foo(Effect.gen(function* () { return x; }));").c).toEqual([]);
  });

  test("the masking keeps offsets and skips strings, comments, regex literals and template text but not `${}` code", () => {
    const src = 'const a = "x)"; // )\nconst r = /[")]\\//; const t = `p) ${f(1)} q`;';
    const masked = maskSource(src);
    expect(masked.length).toBe(src.length);
    expect(masked.includes("p)")).toBe(false);
    expect(masked.includes("f(1)")).toBe(true);
    expect(masked.split("\n").length).toBe(2);
    expect(matchParen(masked, masked.indexOf("f("))).toBe(masked.indexOf("f(") + 3);
  });
});

// --- (16) return yield* when raising ------------------------------------------------------------------------------------

const RAISE = /\byield\*\s+(?:new\s+[A-Z]|Effect\.(?:fail|failCause|die|dieMessage)\s*\()/;
const raisesWithoutReturn = (text: string): boolean => {
  const m = RAISE.exec(text);
  return m !== null && !/\breturn\s*$/.test(text.slice(0, m.index));
};

describe("(16) `return yield*` when raising (E12)", () => {
  test("no `yield* new X(` or `yield* Effect.fail(` / failCause( / die( / dieMessage( without `return`", () => {
    expectNone(
      "an error is raised as `return yield* new X(...)` so the generator ends and the type narrows (docs/EFFECT.md E12; repos/effect/LLMS.md)",
      scan(IDIOM_FILES, (l) => raisesWithoutReturn(l.text)),
    );
  });

  test("the rule bites", () => {
    expect(raisesWithoutReturn("      yield* new NotFound();")).toBe(true);
    expect(raisesWithoutReturn("      yield* Effect.fail(new NotFound());")).toBe(true);
    expect(raisesWithoutReturn("      yield* Effect.die(error);")).toBe(true);
    expect(raisesWithoutReturn("      yield* Effect.dieMessage('x');")).toBe(true);
    expect(raisesWithoutReturn("      yield* Effect.failCause(cause);")).toBe(true);
    expect(raisesWithoutReturn("      return yield* new NotFound();")).toBe(false);
    expect(raisesWithoutReturn("      return yield* Effect.fail(new NotFound());")).toBe(false);
    expect(raisesWithoutReturn("      yield* Effect.logWarning('x');")).toBe(false);
    expect(raisesWithoutReturn("      const rows = yield* Database;")).toBe(false);
  });
});

// --- (17) errors are tagged ------------------------------------------------------------------------------------------

const ERROR_SUBCLASS = /\bclass\s+[\w$]+\s+extends\s+(?:Error|TypeError|RangeError)\b/;
const INSTANCEOF_ERROR = /\binstanceof\s+([\w$.]*Error)\b/;
const instanceofCustomError = (text: string): boolean => {
  const m = INSTANCEOF_ERROR.exec(text);
  return m !== null && m[1] !== "Error";
};
const isErrorRuleHit = (text: string) => ERROR_SUBCLASS.test(text) || instanceofCustomError(text);

// Pinned allow list (file -> reason): the pure workbook parser keeps a plain Error subclass (it has no Effect: E3, plan e5
// deviation 5) and the pure extraction loop that catches it tests it with `instanceof`.
const ALLOW_PLAIN_ERROR: PathAllow = {
  "apps/api/scripts/finance-import/amounts.ts": "the pure workbook parser's AmountParseError (E3, plan e5 deviation 5)",
  "apps/api/scripts/finance-import-xlsx.ts": "the pure extraction loop that catches AmountParseError with instanceof (plan e5 deviation 5)",
};

describe("(17) errors are tagged, not Error subclasses (E12)", () => {
  test("no `class X extends Error|TypeError|RangeError` and no `instanceof <Custom>Error` outside the pinned allow list", () => {
    expectNone(
      "errors are `Schema.TaggedError`s caught with `Effect.catchTag(s)` / `Predicate.isTagged` (docs/EFFECT.md E12; apps/api/src/lib/errors.ts)",
      scan(API_SRC_AND_SCRIPT_FILES, (l) => isErrorRuleHit(l.text) && !allowedPath(ALLOW_PLAIN_ERROR)(l)),
    );
  });

  test("every allow-list entry still matches", () => {
    expectNoStaleEntries("(17)", ALLOW_PLAIN_ERROR, scan(API_SRC_AND_SCRIPT_FILES, (l) => isErrorRuleHit(l.text)));
  });

  test("the rule bites", () => {
    expect(isErrorRuleHit("export class AmountParseError extends Error {")).toBe(true);
    expect(isErrorRuleHit("class Boom extends TypeError {}")).toBe(true);
    expect(isErrorRuleHit("class Boom extends RangeError {}")).toBe(true);
    expect(isErrorRuleHit("if (error instanceof AmountParseError) {")).toBe(true);
    expect(isErrorRuleHit("if (error instanceof TypeError) {")).toBe(true);
    expect(isErrorRuleHit("const reason = error instanceof Error ? error.message : String(error);")).toBe(false);
    expect(isErrorRuleHit("export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {}) {}")).toBe(false);
    expect(isErrorRuleHit("if (Predicate.isTagged(error, 'NotFound')) {")).toBe(false);
  });
});

// --- (18) Predicate instead of hand-written object guards ----------------------------------------------------------

const OBJECT_TYPEOF = /\btypeof\s+([\w$.]+)\s*[!=]==?\s*["']object["']/;
const handWrittenObjectGuard = (text: string): boolean => {
  const m = OBJECT_TYPEOF.exec(text);
  if (!m) return false;
  const subject = m[1]!.replace(/[.$]/g, "\\$&");
  return new RegExp(`(?:\\b${subject}\\s*[!=]==?\\s*null\\b|\\bnull\\s*[!=]==?\\s*${subject}\\b)`).test(text);
};

describe("(18) Predicate instead of hand-written object guards (E12)", () => {
  test("no `typeof x === \"object\"` paired with `x !== null` on one line", () => {
    expectNone(
      "a runtime guard is `Predicate.isObject` / `isRecord` / `isTagged` / `hasProperty` of effect/Predicate (docs/EFFECT.md E12; repos/effect/LLMS.md 'Runtime type guards')",
      scan(API_SRC_AND_SCRIPT_FILES, (l) => handWrittenObjectGuard(l.text)),
    );
  });

  test("the rule bites in both orders, on negation and on dotted subjects", () => {
    expect(handWrittenObjectGuard('  return typeof value === "object" && value !== null;')).toBe(true);
    expect(handWrittenObjectGuard('  return value !== null && typeof value === "object";')).toBe(true);
    expect(handWrittenObjectGuard('  if (typeof value !== "object" || value === null) return false;')).toBe(true);
    expect(handWrittenObjectGuard("  return typeof error.cause === 'object' && error.cause !== null;")).toBe(true);
    expect(handWrittenObjectGuard('  return typeof value === "object";')).toBe(false);
    expect(handWrittenObjectGuard('  return typeof a === "object" && b !== null;')).toBe(false);
    expect(handWrittenObjectGuard("  return Predicate.isObject(value);")).toBe(false);
  });
});

// --- (19) the Clock on the request path ----------------------------------------------------------------------------

const REQUEST_PATH_DATE = /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/;
const REQUEST_PATH_FILES = API_SRC_NON_TEST.filter((f) => {
  const r = rel(f);
  return r.startsWith("apps/api/src/http/") || r.startsWith("apps/api/src/middleware/") || r.includes("/routes/");
});
const ALLOW_REQUEST_PATH_DATE: PathAllow = {};

describe("(19) the Clock on the request path (E12)", () => {
  test("no `Date.now(` / `new Date()` under apps/api/src/http/, apps/api/src/middleware/ or a routes/ directory", () => {
    expectNone(
      "the request path reads `yield* Clock.currentTimeMillis` / `DateTime.now`, never the wall clock (docs/EFFECT.md E12; plan e8 P7)",
      scan(REQUEST_PATH_FILES, (l) => REQUEST_PATH_DATE.test(l.text) && !allowedPath(ALLOW_REQUEST_PATH_DATE)(l)),
    );
  });

  test("the scan sees the request path and the rule bites", () => {
    const rels = REQUEST_PATH_FILES.map(rel);
    for (const must of ["apps/api/src/http/app.ts", "apps/api/src/middleware/requestLog.ts", "apps/api/src/core/routes/auth.ts", "apps/api/src/modules/recipe/routes/imports.ts"]) {
      expect(rels).toContain(must);
    }
    expect(REQUEST_PATH_DATE.test("const at = Date.now();")).toBe(true);
    expect(REQUEST_PATH_DATE.test("const d = new Date();")).toBe(true);
    expect(REQUEST_PATH_DATE.test("const d = new Date(ms);")).toBe(false);
    expect(REQUEST_PATH_DATE.test("const at = yield* Clock.currentTimeMillis;")).toBe(false);
  });
});

// --- (20) Effect runs only at the edges -------------------------------------------------------------------------------

// ONE regex over every runner of repos/effect/packages/effect/src/Effect.ts (runPromise, runPromiseExit, runSync, runSyncExit,
// runFork, runCallback and the `…With` forms) and every `runtime.run…(` of a ManagedRuntime.
const RUN_CALL = /\b(?:Effect|runtime)\.run\w*\(/;

// Pinned allow list (file -> reason), plan e8 P7: the edges of the process and the three seams that cannot be Effects.
const ALLOW_EFFECT_RUN: PathAllow = {
  "apps/api/src/index.ts": "the boot and the shutdown of the process",
  "apps/api/src/http/in-memory.ts": "the tests' handler warms the runtime before the first request",
  "apps/api/src/config.ts": "the eager validation of the environment at import (env.ts)",
  "apps/api/src/core/routes/system.ts": "runtime.runPromise(healthResponse), pinned by apps/api/test/runtime.test.ts (b) (E0)",
  "apps/api/src/modules/recipe/services/ocr/tesseract.ts": "the Promise OcrEngine contract (plan e3)",
  "apps/api/src/db/database.ts": "Database.transaction's drizzle callback runs the inner effect under the open transaction with Effect.runPromiseExitWith(inner)",
};

describe("(20) Effect runs only at the edges (E12)", () => {
  test("no Effect.run…( or runtime.run…( in non-test apps/api/src outside the pinned allow list", () => {
    expectNone(
      "an effect runs at the boot, the shutdown and the pinned seams, never inside a service or a handler (docs/EFFECT.md E12; plan e8 P7)",
      scan(API_SRC_NON_TEST, (l) => RUN_CALL.test(l.text) && !allowedPath(ALLOW_EFFECT_RUN)(l)),
    );
  });

  test("every allow-list entry still matches", () => {
    expectNoStaleEntries("(20)", ALLOW_EFFECT_RUN, scan(API_SRC_NON_TEST, (l) => RUN_CALL.test(l.text)));
  });

  test("the allow list has exactly the six entries of plan e8 P7", () => {
    expect(Object.keys(ALLOW_EFFECT_RUN).sort()).toEqual([
      "apps/api/src/config.ts",
      "apps/api/src/core/routes/system.ts",
      "apps/api/src/db/database.ts",
      "apps/api/src/http/in-memory.ts",
      "apps/api/src/index.ts",
      "apps/api/src/modules/recipe/services/ocr/tesseract.ts",
    ]);
  });

  test("the one regex catches every runner, the …With forms included", () => {
    for (const hit of [
      "Effect.runPromise(x)",
      "Effect.runPromiseExit(x)",
      "Effect.runSync(x)",
      "Effect.runSyncExit(x)",
      "Effect.runFork(x)",
      "Effect.runCallback(x)",
      "Effect.runPromiseWith(ctx)(x)",
      "Effect.runPromiseExitWith(x)(y)",
      "Effect.runSyncWith(ctx)(e)",
      "Effect.runSyncExitWith(ctx)(e)",
      "Effect.runForkWith(await runtime.context())(e)",
      "Effect.runCallbackWith(ctx)(e)",
      "runtime.runPromise(e)",
      "runtime.runSync(e)",
      "runtime.runFork(e)",
    ]) {
      expect(RUN_CALL.test(hit)).toBe(true);
    }
    for (const pass of ["runtime.context()", "const runtime = ManagedRuntime.make(layer);", "Layer.launch(layer)", "const prerun = 1;"]) {
      expect(RUN_CALL.test(pass)).toBe(false);
    }
  });
});

// --- (21) no Effect 3 API names -------------------------------------------------------------------------------------

// Each name was looked up in repos/effect/packages/effect/src/ (`grep -n "export const <name>"` in Effect.ts and Schema.ts, and the
// module list for Either / FiberRef) at E8-T07 and is absent from v4 (repos/effect/migration/v3-to-v4.md: catchAll is `Effect.catch`,
// catchAllCause `catchCause`, either `result`, Either `Result`, FiberRef `Context.Reference`, annotations `annotate`, zipRight
// `andThen`, decodeUnknown `decodeUnknownEffect`). A name v4 still exports with its v3 meaning would be left out and recorded here.
const V3_NAMES: Record<string, RegExp> = {
  "Effect.catchAll(": /\bEffect\.catchAll\s*\(/,
  "Effect.catchAllCause(": /\bEffect\.catchAllCause\s*\(/,
  "Effect.catchSome(": /\bEffect\.catchSome\s*\(/,
  "Effect.either(": /\bEffect\.either\s*\(/,
  "Either.": /\bEither\./,
  FiberRef: /\bFiberRef\b/,
  ".annotations(": /\.annotations\s*\(/,
  "Effect.zipRight(": /\bEffect\.zipRight\s*\(/,
  "Effect.zipLeft(": /\bEffect\.zipLeft\s*\(/,
  "Schema.decodeUnknown(": /\bSchema\.decodeUnknown\s*\(/,
};
const v3Name = (text: string): string | undefined => Object.keys(V3_NAMES).find((k) => V3_NAMES[k]!.test(text));
const ALLOW_V3_NAME: Record<string, string> = {};

describe("(21) no Effect 3 API names (E12)", () => {
  test("none of the removed v3 names appears in a scanned file", () => {
    expectNone(
      "Effect 4 renamed these: Effect.catch / catchCause / result, Result, Context.Reference, .annotate(, Effect.andThen, Schema.decodeUnknownEffect (repos/effect/migration/v3-to-v4.md)",
      scan(ALL_FILES, (l) => v3Name(l.text) !== undefined && !allowed(ALLOW_V3_NAME)(l)),
    );
  });

  test("the rule bites on every name and passes the v4 names", () => {
    for (const hit of [
      "Effect.catchAll((e) => x)",
      "Effect.catchAllCause((c) => x)",
      "Effect.catchSome((e) => x)",
      "Effect.either(x)",
      "const r: Either.Either<A, E> = x;",
      "const ref = FiberRef.unsafeMake(0);",
      "schema.annotations({ title: 'x' })",
      "Effect.zipRight(a, b)",
      "Effect.zipLeft(a, b)",
      "Schema.decodeUnknown(S)(x)",
    ]) {
      expect(v3Name(hit)).toBeDefined();
    }
    for (const pass of [
      "Effect.catch((e) => x)",
      "Effect.catchCause((c) => x)",
      "Effect.catchTag('A', (e) => x)",
      "Effect.result(x)",
      "Result.isFailure(r)",
      "schema.annotate({ title: 'x' })",
      "Effect.andThen(a, b)",
      "Schema.decodeUnknownEffect(S)(x)",
    ]) {
      expect(v3Name(pass)).toBeUndefined();
    }
  });
});
