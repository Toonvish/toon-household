// The design-system guard (SPEC D5, M4-T08). It makes the M4 exit greps permanent in `bun test`:
// the Table D rules of docs/plans/m4-design-pass.md §2 and the pinned, documented pre-existing
// recipe exceptions. A new violation anywhere fails here with file:line and the rule; fixing a
// pinned exception means updating the pinned record below in the same commit.
//
// Sources of the rules: toon-recipe CLAUDE.md ("THE PALETTE IS DECLARED FOUR TIMES AND THE TWO
// [data-theme] BLOCKS ONLY OVERRIDE WHAT THEY NAME", "THE DISPLAY FAMILY SHIPS EXACTLY ONE WEIGHT",
// "features/recipes/print.css is invisible to all five gates", "controlClasses carries min-w-0").
// Comment lines (trimmed line starting with `*`, `//`, `/*`, `{/*`) are never scanned.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const WEB_ROOT = join(import.meta.dir, "..", "..");
const SRC = join(WEB_ROOT, "src");
const SELF = join(import.meta.dir, "design-system.test.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(SRC, file).split(sep).join("/");
const relWeb = (file: string) => relative(WEB_ROOT, file).split(sep).join("/");

const ALL_FILES = walk(SRC);
// Shipped source: ts/tsx that is not a test.
const SOURCE_FILES = ALL_FILES.filter(
  (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
);

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

/** Every quoted string literal ("…", '…', `…`) on a line. */
function literals(text: string): string[] {
  return text.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
}

const hasLiteral = (line: Line, pred: (s: string) => boolean) => literals(line.text).some(pred);

function report(rule: string, hits: Line[]): string {
  if (hits.length === 0) return "";
  return (
    `${rule}\n` +
    hits.map((h) => `  ${rel(h.file)}:${h.n}: ${h.text.trim()}`).join("\n")
  );
}

function expectNone(rule: string, hits: Line[]) {
  expect(report(rule, hits)).toBe("");
}

// --- (a) theme.css: the palette is declared four times --------------------------------------------

function cssBlocks(css: string): string[] {
  // Split into top-level blocks by brace depth (comments contain no braces).
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}") {
      depth--;
      if (depth === 0) {
        blocks.push(stripped.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  return blocks;
}

function customProps(block: string): Set<string> {
  return new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]!));
}

describe("(a) theme.css declares the palette four times (R CLAUDE.md, D5)", () => {
  const blocks = cssBlocks(readFileSync(join(SRC, "styles", "theme.css"), "utf8"));
  const find = (head: string) => blocks.find((b) => b.startsWith(head));
  const root = find(":root {");
  const media = find("@media (prefers-color-scheme: dark)");
  const light = find(':root[data-theme="light"]');
  const dark = find(':root[data-theme="dark"]');

  test("the four blocks exist, :root first", () => {
    expect(blocks[0]?.startsWith(":root {")).toBe(true);
    expect(media).toBeDefined();
    expect(light).toBeDefined();
    expect(dark).toBeDefined();
  });

  const rootProps = customProps(root ?? "");
  // The media block wraps a `:root:not([data-theme="light"])` rule; its custom properties are the
  // same declaration list.
  const mediaProps = customProps(media ?? "");
  const lightProps = customProps(light ?? "");
  const darkProps = customProps(dark ?? "");

  test("the three override blocks define the same custom-property set", () => {
    const sorted = (s: Set<string>) => [...s].sort();
    expect(mediaProps.size).toBeGreaterThan(0);
    expect(sorted(lightProps)).toEqual(sorted(mediaProps));
    expect(sorted(darkProps)).toEqual(sorted(mediaProps));
  });

  test(":root contains the override set", () => {
    const missing = [...mediaProps].filter((p) => !rootProps.has(p));
    expect(missing).toEqual([]);
  });

  test("every var(--x) behind a --color-*/--shadow-* @theme line is declared", () => {
    const index = readFileSync(join(SRC, "styles", "index.css"), "utf8");
    const used = new Set<string>();
    for (const line of index.split("\n")) {
      if (!/^\s*--(color|shadow)-[a-z0-9-]+\s*:/.test(line)) continue;
      for (const m of line.matchAll(/var\((--[a-z0-9-]+)/gi)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter((p) => !mediaProps.has(p) && !rootProps.has(p));
    expect(missing).toEqual([]);
  });
});

// --- (b) no Google Fonts ---------------------------------------------------------------------------

describe("(b) fonts are self-hosted", () => {
  test("no fonts.googleapis / fonts.gstatic in the web package", () => {
    const files = [
      join(WEB_ROOT, "index.html"),
      join(WEB_ROOT, "vite.config.ts"),
      join(WEB_ROOT, "pwa-manifest.ts"),
      ...ALL_FILES.filter((f) => f !== SELF),
    ];
    const hits = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .flatMap((text, i) =>
          /fonts\.(googleapis|gstatic)/.test(text) ? [`  ${relWeb(f)}:${i + 1}: ${text.trim()}`] : [],
        ),
    );
    expect(
      hits.length ? `Fonts are self-hosted (styles/fonts.css, D5):\n${hits.join("\n")}` : "",
    ).toBe("");
  });
});

// --- (c) pinned arbitrary text sizes (recipe exceptions) -----------------------------------------

// The documented pre-existing exceptions: toon-recipe CLAUDE.md "THE DISPLAY FAMILY SHIPS EXACTLY
// ONE WEIGHT" and toon-recipe docs/redesign/PR.md (R CLAUDE.md and R docs/redesign/PR.md are the
// record; converting them changes drawn screens). 34 hits in 17 files (the plan text says 18; its own per-file list sums to 17), measured in
// docs/plans/m4-design-pass.md §1. Finance and the core have none. A fix must update this map.
const RECIPE_EXCEPTIONS: Record<string, number> = {
  "components/layout/BottomTabBar.tsx": 1,
  "components/ui/Avatar.tsx": 2,
  "modules/recipe/features/import/components/ConfidenceBadge.tsx": 1,
  "modules/recipe/features/import/components/ParsedRecipeEditor.tsx": 4,
  "modules/recipe/features/import/components/SourceViewer.tsx": 5,
  "modules/recipe/features/import/ImportPage.tsx": 2,
  "modules/recipe/features/plan/components/WeekStrip.tsx": 1,
  "modules/recipe/features/recipes/components/IngredientList.tsx": 1,
  "modules/recipe/features/recipes/components/RecentlyCookedShelf.tsx": 1,
  "modules/recipe/features/recipes/components/RecipeEditorialRow.tsx": 2,
  "modules/recipe/features/recipes/components/StepList.tsx": 2,
  "modules/recipe/features/recipes/RecipeDetailPage.tsx": 4,
  "modules/recipe/features/recipes/RecipeListPage.tsx": 1,
  "modules/recipe/features/shopping/components/BoughtSection.tsx": 1,
  "modules/recipe/features/shopping/components/ListRecipesPanel.tsx": 1,
  "modules/recipe/features/shopping/components/ShoppingItemCard.tsx": 2,
  "modules/recipe/features/shopping/ShoppingListDetailPage.tsx": 3,
};

describe("(c) arbitrary text sizes equal the pinned recipe exceptions (Table D D-1)", () => {
  const ARBITRARY = /text-\[\d[\d.]*(px|rem|em)\]/g;
  const counts: Record<string, number> = {};
  const lines: Record<string, Line[]> = {};
  for (const f of SOURCE_FILES) {
    for (const l of codeLines(f)) {
      const n = l.text.match(ARBITRARY)?.length ?? 0;
      if (n === 0) continue;
      counts[rel(f)] = (counts[rel(f)] ?? 0) + n;
      (lines[rel(f)] ??= []).push(l);
    }
  }

  test("per-file counts equal RECIPE_EXCEPTIONS", () => {
    const problems: string[] = [];
    for (const file of new Set([...Object.keys(counts), ...Object.keys(RECIPE_EXCEPTIONS)])) {
      const have = counts[file] ?? 0;
      const want = RECIPE_EXCEPTIONS[file] ?? 0;
      if (have === want) continue;
      const where = (lines[file] ?? []).map((l) => `${file}:${l.n}`).join(", ");
      problems.push(
        `  ${file}: ${have} arbitrary text-[…] size(s), pinned ${want}${where ? ` (${where})` : ""}`,
      );
    }
    expect(
      problems.length
        ? `Table D D-1: type comes from the scale, never text-[…] (R CLAUDE.md "ONE WEIGHT"; update RECIPE_EXCEPTIONS only when a pinned exception is fixed):\n${problems.join("\n")}`
        : "",
    ).toBe("");
  });

  test("the pinned map is the measured 34 hits in 17 files", () => {
    const total = Object.values(RECIPE_EXCEPTIONS).reduce((a, b) => a + b, 0);
    expect(total).toBe(34);
    expect(Object.keys(RECIPE_EXCEPTIONS).length).toBe(17);
  });
});

// --- (d)-(i) string-literal rules ------------------------------------------------------------------

describe("Table D string-literal rules", () => {
  test("(d) bottom-0 only on the tab bar and the recipe hero overlay (D-5)", () => {
    const allowed = new Set([
      "components/layout/BottomTabBar.tsx",
      "modules/recipe/features/recipes/components/RecipeHeroMobile.tsx",
    ]);
    const hits = scan(
      SOURCE_FILES.filter((f) => !allowed.has(rel(f))),
      (l) => hasLiteral(l, (s) => /(^|[\s"'`:])bottom-0(?![\w-])/.test(s)),
    );
    expectNone(
      "Table D D-5: a bottom action bar is `sticky bottom-tabbar`, never `bottom-0` (R CLAUDE.md \"A bottom action bar needs bottom-tabbar\"):",
      hits,
    );
  });

  test("(e) font-display never beside font-semibold/font-bold (D-1)", () => {
    const hits = scan(SOURCE_FILES, (l) =>
      hasLiteral(
        l,
        (s) => /(^|\s)font-display(\s|$)/.test(s) && /(^|\s)font-(semibold|bold)(\s|$)/.test(s),
      ),
    );
    expectNone(
      'Table D D-1: font-display always with font-medium (R CLAUDE.md "THE DISPLAY FAMILY SHIPS EXACTLY ONE WEIGHT"):',
      hits,
    );
  });

  test("(f) px-safe / -mx-gutter / top-topbar / bleed-gutter rules (D-3, D-5)", () => {
    expectNone(
      'Table D D-3: never px-<n>/px-gutter beside px-safe (R CLAUDE.md "NEVER write px-4 px-safe"):',
      scan(SOURCE_FILES, (l) =>
        hasLiteral(
          l,
          (s) => /(^|\s)px-safe(\s|$)/.test(s) && /(^|\s)px-(\d[\d.]*|gutter)(\s|$)/.test(s),
        ),
      ),
    );
    expectNone(
      "Table D D-3: `-mx-gutter` is not a utility in this app; bleed with .bleed-gutter / .bleed-gutter-inset:",
      scan(SOURCE_FILES, (l) => l.text.includes("-mx-gutter")),
    );
    expectNone(
      "Table D D-5: `top-topbar` is dead (no TopBar any more); a sticky top element uses top-0:",
      scan(SOURCE_FILES, (l) => l.text.includes("top-topbar")),
    );
    expectNone(
      "Table D D-3: .bleed-gutter* cannot be undone by lg:mx-0 / lg:px-0 (hand-written utilities are emitted after Tailwind's); bleed at every width:",
      scan(SOURCE_FILES, (l) =>
        hasLiteral(
          l,
          (s) => /(^|\s)bleed-gutter(-inset)?(\s|$)/.test(s) && /(^|\s)lg:(mx|px)-0(\s|$)/.test(s),
        ),
      ),
    );
  });

  test("(g) hand-rolled uppercase + tracking only in the four recipe files (D-1)", () => {
    const allowed = new Set([
      "modules/recipe/features/recipes/components/IngredientList.tsx",
      "modules/recipe/features/recipes/components/StepList.tsx",
      "modules/recipe/features/recipes/RecipeDetailPage.tsx",
      "modules/recipe/features/shopping/components/ItemDetailDialog.tsx",
    ]);
    const hits = scan(
      SOURCE_FILES.filter((f) => !allowed.has(rel(f))),
      (l) =>
        hasLiteral(l, (s) => /(^|\s)uppercase(\s|$)/.test(s) && /(^|\s)tracking-/.test(s)),
    );
    expectNone(
      "Table D D-1: every uppercase label is `.eyebrow`, never a hand-rolled `uppercase tracking-*` (R CLAUDE.md; four documented recipe exceptions):",
      hits,
    );
  });

  test("(h) arrow/check/chevron glyphs only on the four pinned catalog lines (D-7)", () => {
    const glyph = /[→←✓▾⋯]/;
    const pinned = (l: Line) =>
      /"(household\.detail\.backLink|recipe\.collectionDetail\.backLink)"/.test(l.text);
    const hits = scan(ALL_FILES.filter((f) => /\.tsx?$/.test(f)), (l) => glyph.test(l.text) && !pinned(l))
      .filter((l) => !/\.test\.tsx?$/.test(l.file));
    expectNone(
      "Table D D-7: no arrow/chevron/check/ellipsis glyph as text; use lucide icons with aria-hidden (only household.detail.backLink and recipe.collectionDetail.backLink, de + en, are pinned):",
      hits,
    );
    const pinnedLines = scan(
      SOURCE_FILES,
      (l) => glyph.test(l.text),
    ).filter(pinned);
    expect(pinnedLines.length).toBe(4);
  });

  test("(i) no arbitrary grid template with a bare 1fr (D-4)", () => {
    const hits = scan(SOURCE_FILES, (l) =>
      hasLiteral(l, (s) => {
        for (const m of s.matchAll(/grid-(cols|rows)-\[([^\]]*)\]/g)) {
          // strip every minmax(0,Nfr) form, then look for a remaining bare fr track
          const rest = m[2]!.replace(/minmax\(0,\s*[\d.]+fr\)/g, "");
          if (/(^|[^\w.])[\d.]*fr(?!\w)/.test(rest)) return true;
        }
        return false;
      }),
    );
    expectNone(
      'Table D D-4: a grid track holding a control is `minmax(0,1fr)`, never a bare `1fr` (R CLAUDE.md "controlClasses carries min-w-0"):',
      hits,
    );
  });

  test("(j) data-app-shell only on header/nav/aside, and print.css still hides them", () => {
    const hits: Line[] = [];
    for (const f of SOURCE_FILES) {
      const lines = codeLines(f);
      for (const l of lines) {
        if (!l.text.includes("data-app-shell")) continue;
        // The attribute may sit on the opening tag's line or on a following attribute line;
        // look back to the nearest `<tag` opener in the raw file.
        const raw = readFileSync(f, "utf8").split("\n");
        let tag: string | undefined;
        for (let i = l.n - 1; i >= 0 && i >= l.n - 15; i--) {
          const m = raw[i]!.match(/<([A-Za-z][\w.]*)/g);
          if (m) {
            tag = m[m.length - 1]!.slice(1);
            break;
          }
        }
        if (!tag || !["header", "nav", "aside"].includes(tag)) hits.push(l);
      }
    }
    expectNone(
      'Table D (R CLAUDE.md "print.css is invisible to all five gates"): data-app-shell goes only on <header>, <nav>, <aside> elements:',
      hits,
    );
    const printCss = readFileSync(
      join(SRC, "modules", "recipe", "features", "recipes", "print.css"),
      "utf8",
    );
    for (const sel of [
      "header[data-app-shell]",
      "nav[data-app-shell]",
      "aside[data-app-shell]",
      '[data-print="hide"]',
    ]) {
      expect(printCss.includes(sel)).toBe(true);
    }
  });
});
