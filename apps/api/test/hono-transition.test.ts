// The Hono transition sections (plan docs/plans/e7-http-api.md P17; E7-T02). Until the cutover (E7-T11) Hono-shaped code
// that must survive sits in ONE final section per file, opened by the marker line below and running to the end of the
// file, with its OWN imports. E7-T12 deletes each section verbatim, so nothing above a marker may use a name the
// section imports or declares. A comment-free line scan in the style of apps/api/test/effect-idioms.test.ts; a failure
// prints `file:line: identifier` (or the offending line).
//
// (1) In every file under apps/api/src that contains the marker: every `hono` / `hono/*` import line lies below it, and
//     no identifier imported or declared (at top level) below it occurs above it (a property access `.name` and the
//     text of a string literal are not occurrences).
// (2) STRICT, behind `const STRICT`, which E7-T11 set to true (the cutover leaves no unmarked Hono file): every file
//     under apps/api/src that imports `hono` contains the marker. Before E7-T11 the unconverted route files and
//     src/index.ts imported Hono without one, so the non-strict run only proved the scan sees the Hono files.
// E7-T12 deletes this file together with the sections.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Set to true by E7-T11, the cutover (P17). */
const STRICT = true;

const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(ROOT, "apps", "api", "src");
export const MARKER = "/* Hono (E7 transition): E7-T12 deletes this section */";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(ROOT, file).split(sep).join("/");
const FILES = walk(SRC);

interface Line {
  n: number;
  text: string;
}

const COMMENT_START = /^(\*|\/\/|\/\*|\{\/\*)/;

/** Non-comment lines of a file (the marker line itself is a comment and never returned). */
function codeLines(source: string): Line[] {
  const lines: Line[] = [];
  let inBlock = false;
  source.split("\n").forEach((text, i) => {
    const trimmed = text.trim();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      return;
    }
    if (/^\/\*/.test(trimmed) && !trimmed.includes("*/")) {
      inBlock = true;
      return;
    }
    if (trimmed.length > 0 && !COMMENT_START.test(trimmed)) lines.push({ n: i + 1, text });
  });
  return lines;
}

/** 1-based line number of the marker, or undefined. */
function markerLine(source: string): number | undefined {
  const index = source.split("\n").findIndex((text) => text.trim() === MARKER);
  return index === -1 ? undefined : index + 1;
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'`])([^"'`\n]+)\1/g;
const isHono = (spec: string) => spec === "hono" || spec.startsWith("hono/");
const importsHono = (text: string) => [...text.matchAll(SPECIFIER)].some((m) => isHono(m[2]!));

/** The local names an import statement binds (`a`, `b as c` → `c`, `* as d` → `d`, default `e`). */
function importedNames(statement: string): string[] {
  const clause = /^import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']/.exec(statement.trim())?.[1];
  if (!clause) return [];
  const names: string[] = [];
  const braces = /\{([\s\S]*)\}/.exec(clause);
  for (const part of braces?.[1]?.split(",") ?? []) {
    const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).at(-1)?.trim();
    if (name) names.push(name);
  }
  const outside = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, " ").trim();
  const star = /\*\s+as\s+(\w+)/.exec(outside);
  if (star) names.push(star[1]!);
  else if (/^\w+$/.test(outside)) names.push(outside);
  return names;
}

const DECLARATION =
  /^(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;

/** Every top-level name the section (the code lines after the marker) imports or declares. */
function sectionNames(section: Line[]): string[] {
  const names = new Set<string>();
  const text = section.map((l) => l.text).join("\n");
  for (const match of text.matchAll(/^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?/gm)) {
    for (const name of importedNames(match[0])) names.add(name);
  }
  for (const line of section) {
    if (/^\s/.test(line.text)) continue; // top level only
    const declared = DECLARATION.exec(line.text)?.[1];
    if (declared) names.add(declared);
  }
  return [...names];
}

/** A code line with its string literals emptied (their text is not an occurrence). */
const withoutStrings = (text: string) => text.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, "$1$1");

/** Whether `name` occurs in `text` as an identifier (not as `.name`, not inside a string). */
function occurs(name: string, text: string): boolean {
  const escaped = name.replace(/\$/g, "\\$");
  return new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])`).test(withoutStrings(text));
}

function expectNone(rule: string, hits: string[]) {
  expect(hits.length === 0 ? "" : `${rule}\n${hits.map((h) => `  ${h}`).join("\n")}`).toBe("");
}

const MARKED = FILES.flatMap((file) => {
  const source = readFileSync(file, "utf8");
  const marker = markerLine(source);
  return marker === undefined ? [] : [{ file, source, marker }];
});

describe("(1) a Hono section holds every hono import of its file, and nothing above it uses its names", () => {
  test("the scan sees the sections of E7-T02's files", () => {
    const marked = MARKED.map(({ file }) => rel(file));
    for (const expected of [
      "apps/api/src/lib/errors.ts",
      "apps/api/src/lib/http.ts",
      "apps/api/src/lib/cookies.ts",
      "apps/api/src/lib/validate.ts",
      "apps/api/src/lib/locale.ts",
      "apps/api/src/lib/types.ts",
      "apps/api/src/core/services/auth/rateLimit.ts",
    ]) {
      expect(marked).toContain(expected);
    }
  });

  test("every hono / hono/* import line lies below the marker", () => {
    const hits = MARKED.flatMap(({ file, source, marker }) =>
      codeLines(source)
        .filter((l) => l.n < marker && importsHono(l.text))
        .map((l) => `${rel(file)}:${l.n}: ${l.text.trim()}`),
    );
    expectNone("a hono import above the Hono section (P17)", hits);
  });

  test("no identifier imported or declared below the marker occurs above it", () => {
    const hits = MARKED.flatMap(({ file, source, marker }) => {
      const lines = codeLines(source);
      const above = lines.filter((l) => l.n < marker);
      const names = sectionNames(lines.filter((l) => l.n > marker));
      return names.flatMap((name) =>
        above.filter((l) => occurs(name, l.text)).map((l) => `${rel(file)}:${l.n}: ${name}`),
      );
    });
    expectNone("a name of the Hono section used above it (P17: E7-T12 deletes the section verbatim)", hits);
  });

  test("the marker is the last section: it appears once per file", () => {
    const hits = MARKED.filter(({ source }) => source.split("\n").filter((t) => t.trim() === MARKER).length !== 1).map(
      ({ file }) => rel(file),
    );
    expectNone("more than one Hono marker in a file", hits);
  });

  test("the rule bites: an import above, a use above, and the clean shape", () => {
    const names = sectionNames([
      { n: 10, text: 'import type { Context, MiddlewareHandler as Handler } from "hono";' },
      { n: 11, text: 'import { validator } from "hono/validator";' },
      { n: 12, text: "export function validate(c: Context): void {}" },
      { n: 13, text: "  const inner = 1;" },
    ]);
    expect(names.sort()).toEqual(["Context", "Handler", "validate", "validator"]);
    expect(occurs("validate", "  return validate(x);")).toBe(true);
    expect(occurs("validate", "  return schema.validate(x);")).toBe(false);
    expect(occurs("validate", '  const s = "validate";')).toBe(false);
    expect(occurs("Context", "import { Context } from \"effect\";")).toBe(true);
    expect(importsHono('import type { Context } from "hono";')).toBe(true);
    expect(importsHono('import { deleteCookie } from "hono/cookie";')).toBe(true);
    expect(importsHono('import { Effect } from "effect";')).toBe(false);
  });
});

describe("(2) every file that imports hono has a Hono section (STRICT from E7-T11)", () => {
  test(`every hono importer under apps/api/src is marked${STRICT ? "" : " (non-strict until E7-T11: the scan sees the importers)"}`, () => {
    const importers = FILES.filter((file) => codeLines(readFileSync(file, "utf8")).some((l) => importsHono(l.text)));
    const unmarked = importers.filter((file) => markerLine(readFileSync(file, "utf8")) === undefined).map(rel);
    if (STRICT) {
      expectNone("a hono importer without the Hono section marker (P17)", unmarked);
    } else {
      expect(importers.map(rel)).toContain("apps/api/src/index.ts");
      expect(importers.map(rel)).toContain("apps/api/src/lib/errors.ts");
    }
  });
});
