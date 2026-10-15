/**
 * Keeps every repository path named in the living docs real (M7 plan decision 5).
 *
 * Scans CLAUDE.md, docs/API.md, docs/modules/recipe.md, docs/modules/finance.md and
 * docs/open-work.md (never the plans, ADRs or SPEC: they are dated records) for inline-code spans
 * that are repo-relative paths: a span starting with one of PATH_PREFIXES, or exactly one of
 * ROOT_FILES. For each span it
 *   - joins a span that a line break split (paths hold no whitespace; a span that still holds
 *     whitespace after the join is a command or prose, not a path, and is skipped),
 *   - skips spans containing `<`, `…` or `$` (placeholders and shell variables),
 *   - drops a trailing `:<line>` (or `:<from>-<to>`) and `#anchor`,
 *   - expands `{a,b}` brace groups (one level of nesting; several groups multiply),
 *   - resolves a span containing `*` with Bun.Glob (at least one match),
 *   - asserts that the path exists, a trailing `/` meaning a directory.
 * "Exists" means present on disk AND known to git (tracked, or untracked but not ignored), so a
 * build output or a local `.env` that only one machine has cannot pass here and fail in CI.
 * ALLOW_MISSING names, with a reason each, the spans that name a path on purpose as absent.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..", "..");

const DOCS = [
  "CLAUDE.md",
  "docs/API.md",
  "docs/modules/recipe.md",
  "docs/modules/finance.md",
  "docs/open-work.md",
];

const PATH_PREFIXES = ["apps/", "packages/", "scripts/", "docs/", "docker/", ".github/"];

const ROOT_FILES = [
  "Dockerfile",
  ".dockerignore",
  "docker-compose.yml",
  "package.json",
  "bun.lock",
  ".bun-version",
  ".env.example",
  ".env.local-stack",
  "README.md",
  "CLAUDE.md",
  "tsconfig.json",
  "bunfig.toml",
];

/** Spans (after the `:line` / `#anchor` strip, before brace expansion) that are absent on purpose. */
const ALLOW_MISSING: Record<string, string> = {
  "apps/api/tests/": "named as the place tests never go (they live in apps/api/test/); never create it",
  "apps/web/src/features/": "named as empty on purpose: web features live under core/features/ or modules/<id>/features/ (SPEC §3)",
  "apps/web/dist": "the output of `bun run build`, ignored by git",
  "apps/web/dist/": "the output of `bun run build`, ignored by git",
  "apps/web/dist/assets": "the output of `bun run build`, ignored by git",
};

/** Every path git knows (tracked, or untracked and not ignored), plus each one's parent directories. */
function knownPaths(): { files: Set<string>; dirs: Set<string> } {
  const proc = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: ROOT,
  });
  if (proc.exitCode !== 0) throw new Error(`git ls-files failed: ${proc.stderr.toString()}`);
  const files = new Set(
    proc.stdout
      .toString()
      .split("\0")
      .filter((f) => f.length > 0 && existsSync(join(ROOT, f))),
  );
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return { files, dirs };
}

const KNOWN = knownPaths();

/** Fenced code blocks hold commands, not prose spans; they are cut before the span scan. */
function withoutFences(text: string): string {
  return text.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, "");
}

/** Inline-code spans (backtick runs of equal length), with a line break inside a span joined. */
function inlineSpans(text: string): string[] {
  const spans: string[] = [];
  for (const match of withoutFences(text).matchAll(/(`+)([^`][\s\S]*?)\1(?!`)/g)) {
    const body = match[2] ?? "";
    if (/\n\s*\n/.test(body)) continue; // a span never crosses a blank line
    spans.push(body.replace(/\s*\n\s*/g, "").trim());
  }
  return spans;
}

function isPathSpan(span: string): boolean {
  if (/\s/.test(span)) return false;
  if (/[<…$]/.test(span)) return false;
  return PATH_PREFIXES.some((prefix) => span.startsWith(prefix)) || ROOT_FILES.includes(span);
}

function stripLocation(span: string): string {
  return span.replace(/#.*$/, "").replace(/:\d+(?:-\d+)?(?::\d+)?$/, "");
}

/** Expands every `{a,b}` group (groups do not nest); several groups multiply. */
function expandBraces(span: string): string[] {
  const group = /\{([^{}]*)\}/.exec(span);
  if (!group) return [span];
  const head = span.slice(0, group.index);
  const tail = span.slice(group.index + group[0].length);
  return group[1]!.split(",").flatMap((alt) => expandBraces(`${head}${alt}${tail}`));
}

function pathExists(path: string): boolean {
  const wantsDir = path.endsWith("/");
  const bare = wantsDir ? path.slice(0, -1) : path;
  if (path.includes("*")) {
    const glob = new Bun.Glob(bare);
    for (const file of KNOWN.files) if (glob.match(file)) return !wantsDir;
    for (const dir of KNOWN.dirs) if (glob.match(dir)) return true;
    return false;
  }
  if (KNOWN.dirs.has(bare)) return statSync(join(ROOT, bare)).isDirectory();
  if (wantsDir) return false;
  return KNOWN.files.has(bare);
}

type Finding = { doc: string; span: string; path: string };

function scan(): { checked: number; missing: Finding[]; allowedHits: Set<string> } {
  let checked = 0;
  const missing: Finding[] = [];
  const allowedHits = new Set<string>();
  for (const doc of DOCS) {
    const text = readFileSync(join(ROOT, doc), "utf8");
    for (const raw of inlineSpans(text)) {
      if (!isPathSpan(raw)) continue;
      const span = stripLocation(raw);
      if (span in ALLOW_MISSING) {
        allowedHits.add(span);
        continue;
      }
      for (const path of expandBraces(span)) {
        checked++;
        if (!pathExists(path)) missing.push({ doc, span: raw, path });
      }
    }
  }
  return { checked, missing, allowedHits };
}

describe("repository paths named in the living docs exist", () => {
  const result = scan();

  test("the scan finds path spans in every doc", () => {
    expect(result.checked).toBeGreaterThan(100);
  });

  test("every path span resolves to a file or directory", () => {
    const report = result.missing.map((m) => `${m.doc}: \`${m.span}\` -> ${m.path}`);
    expect(report).toEqual([]);
  });

  test("every ALLOW_MISSING entry carries a reason and is really absent from git", () => {
    for (const [span, reason] of Object.entries(ALLOW_MISSING)) {
      expect(reason.length).toBeGreaterThan(10);
      const bare = span.endsWith("/") ? span.slice(0, -1) : span;
      expect(KNOWN.files.has(bare) || KNOWN.dirs.has(bare)).toBe(false);
    }
  });
});

describe("the span parser", () => {
  test("expands brace groups and joins wrapped spans", () => {
    expect(expandBraces("apps/api/src/db/{client,migrate}.ts")).toEqual([
      "apps/api/src/db/client.ts",
      "apps/api/src/db/migrate.ts",
    ]);
    expect(expandBraces("a/{b,c}/{d,e}")).toEqual(["a/b/d", "a/b/e", "a/c/d", "a/c/e"]);
    expect(inlineSpans("see `apps/web/\n  src/main.tsx` and ``x`y``")).toEqual(["apps/web/src/main.tsx", "x`y"]);
  });

  test("drops line numbers and anchors, skips placeholders", () => {
    expect(stripLocation("apps/web/src/main.tsx:12")).toBe("apps/web/src/main.tsx");
    expect(stripLocation("docs/SPEC.md#d7")).toBe("docs/SPEC.md");
    expect(isPathSpan("apps/<x>/index.ts")).toBe(false);
    expect(isPathSpan("docs/modules/…")).toBe(false);
    expect(isPathSpan("bun test apps/api/test")).toBe(false);
    expect(isPathSpan(".env.example")).toBe(true);
  });
});
