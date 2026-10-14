/**
 * Two acceptance checks for the interface-language port (SPEC D10; ported from
 * toon-recipe's scripts/i18n-check.ts, docs/i18n.md §11):
 *
 *   1. Every German catalog value existed before, byte-for-byte (a rework, not
 *      a rewrite). "Before" is this repo's base commit OR HEAD of one of the two
 *      source repos (toon-recipe, toon-finance) — the household's own history has
 *      none of the ported strings.
 *   2. No German is left behind in a ported source tree.
 *
 * Both are deliberately grep-shaped — no AST, no parser to maintain. Run via
 * `bun run i18n:check`. Sources: env I18N_CHECK_SOURCES (colon-separated absolute
 * paths), default the sibling toon-recipe and toon-finance checkouts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;

function sh(command: string[], cwd = ROOT): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    code: proc.exitCode ?? 1,
    stdout: proc.stdout.toString("utf8"),
    stderr: proc.stderr.toString("utf8"),
  };
}

/** The commit this branch forked from — check 1 greps THAT tree, not the working copy. */
function baseCommit(): string {
  const envBase = process.env.I18N_CHECK_BASE;
  if (envBase) return envBase;
  const mergeBase = sh(["git", "merge-base", "HEAD", "origin/main"]);
  if (mergeBase.code === 0 && mergeBase.stdout.trim()) return mergeBase.stdout.trim();
  const fallback = sh(["git", "merge-base", "HEAD", "main"]);
  if (fallback.code === 0 && fallback.stdout.trim()) return fallback.stdout.trim();
  throw new Error(
    "i18n-check: could not resolve a base commit (tried origin/main and main). Set I18N_CHECK_BASE=<sha>.",
  );
}

/**
 * The source repos check 1 may find a fragment in. From env I18N_CHECK_SOURCES
 * (colon-separated), else the siblings of the MAIN checkout: the git common dir
 * is `<main>/.git` even from `.worktrees/<task>`, so its parent is the main
 * checkout and the parent of that holds toon-recipe and toon-finance.
 */
function resolveSources(): string[] {
  const envSources = process.env.I18N_CHECK_SOURCES;
  const candidates: string[] = [];
  if (envSources !== undefined && envSources.trim() !== "") {
    candidates.push(...envSources.split(":").filter((p) => p.trim() !== ""));
  } else {
    const common = sh(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const mainCheckout = common.code === 0 && common.stdout.trim() ? dirname(common.stdout.trim()) : ROOT;
    const siblings = dirname(mainCheckout);
    candidates.push(join(siblings, "toon-recipe"), join(siblings, "toon-finance"));
  }
  const resolved: string[] = [];
  for (const source of candidates) {
    const isRepo = existsSync(source) && sh(["git", "rev-parse", "--git-dir"], source).code === 0;
    if (isRepo) {
      resolved.push(source);
    } else {
      console.warn(`[i18n:check] WARNING: source repo not found, skipped: ${source}`);
    }
  }
  return resolved;
}

/**
 * Genuinely NEW German — a previously-English Zod default gaining a real
 * translation (docs/i18n.md §11). One entry per key, with the reason, so a
 * rewritten (not moved) string cannot hide behind this list by accident.
 */
const NEW_GERMAN = new Set<string>([
  "server.zod.too_small.string",
  "server.zod.too_small.number",
  "server.zod.too_small.array",
  "server.zod.too_small",
  "server.zod.too_big.string",
  "server.zod.too_big.number",
  "server.zod.too_big.array",
  "server.zod.too_big",
  "server.zod.invalid_format",
  "server.zod.invalid_type",
  "server.zod.fallback",
  // M0: new household copy (SPEC D10)
  "server.module.disabled",
  // M0: new household copy (SPEC D10)
  "home.appName",
  // M0: new household copy (SPEC D10)
  "home.nav.label",
  // M0: new household copy (SPEC D10)
  "home.title",
  // M0: new household copy (SPEC D10)
  "home.empty.title",
  // M0: new household copy (SPEC D10)
  "home.empty.body",
  // M1: new household copy (SPEC D10)
  "home.modules.availableTitle",
  // M1: new household copy (SPEC D10)
  "home.modules.memberHint",
  // M1: new household copy (SPEC D10)
  "home.modules.manage",
  // M1: new household copy (SPEC D10)
  "home.modules.manageDescription",
  // M1: new household copy (SPEC D10)
  "home.modules.disable",
  // M1: new household copy (SPEC D10)
  "home.modules.enabledToast",
  // M1: new household copy (SPEC D10)
  "home.modules.disabledToast",
  // M1: new household copy (SPEC D10)
  "home.modules.disableConfirmTitle",
  // M1: new household copy (SPEC D10)
  "home.modules.disableConfirmDescription",
  // M1: new household copy (SPEC D10)
  "home.moduleSwitcher.title",
  // M1: new household copy (SPEC D10)
  "home.moduleSwitcher.label",
  // M1: new household copy (SPEC D10)
  "home.moduleDisabled.toast",
  // ADR 0001: recipe count dropped (the core cannot count recipes)
  "household.detail.meta",
  // ADR 0001: recipe count dropped (the core cannot count recipes)
  "household.danger.warning",
  // M3 new copy — finance participants, enable flow, non-participant state (SPEC D10, finance decision 11)
  "finance.module.name",
  "finance.participants.title",
  "finance.participants.description",
  "finance.participants.slot1",
  "finance.participants.slot2",
  "finance.participants.save",
  "finance.participants.saved",
  "finance.participants.sameMember",
  "finance.participants.adminOnly",
  "finance.participants.needsTwoMembers",
  "finance.participants.enableTitle",
  "finance.participants.notParticipantTitle",
  "finance.participants.notParticipantBody",
  "finance.participants.notParticipantAdminHint",
  "finance.participants.toSettings",
  // M3 new server copy — finance participant refusals and non-participant state (SPEC D10, finance decision 11)
  "server.finance.notParticipant",
  "server.finance.participantsRequired",
  "server.finance.participantNotMember",
  "server.finance.participantInUse",
]);

/** Immediate subdirectories of `rel` (relative to ROOT); empty when `rel` does not exist. */
function subdirs(rel: string): string[] {
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory());
}

/** Every `*.de.ts` catalog file under the catalog roots (core, web lib, and each module's). */
function findDeCatalogFiles(): string[] {
  const roots = ["packages/shared/src/core/i18n/catalogs", "apps/web/src/lib/i18n/catalogs"];
  for (const mod of subdirs("apps/web/src/modules")) roots.push(`apps/web/src/modules/${mod}/catalogs`);
  for (const mod of subdirs("packages/shared/src/modules")) {
    roots.push(`packages/shared/src/modules/${mod}/catalogs`);
  }
  const files: string[] = [];
  for (const root of roots) {
    const dir = join(ROOT, root);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith(".de.ts")) files.push(join(dir, entry));
    }
  }
  return files;
}

/** Extracts `"key": "value"` / `"key": { one: "…", other: "…" }` string literals per key. */
function extractCatalogValues(source: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  const keyRe = /"([a-zA-Z][\w.]*)":\s*(\{[^}]*\}|"(?:[^"\\]|\\.)*")/g;
  for (const match of source.matchAll(keyRe)) {
    const key = match[1]!;
    const rhs = match[2]!;
    const literals = [...rhs.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
      m[1]!.replace(/\\"/g, '"').replace(/\\n/g, "\n"),
    );
    // Skip plural-object keys like "one"/"other" themselves — only their VALUES matter.
    const stringValues = rhs.startsWith("{") ? literals.filter((_, i) => i % 1 === 0) : literals;
    values.set(key, stringValues);
  }
  return values;
}

function fragmentsOf(value: string): string[] {
  return value
    .split(/\{[a-zA-Z0-9_]+\}/g)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length >= 3);
}

/** True when `fragment` is in the base commit, or at HEAD of any source repo. Cached per fragment. */
function makeFragmentFinder(base: string, sources: string[]): (fragment: string) => boolean {
  const cache = new Map<string, boolean>();
  return (fragment) => {
    const cached = cache.get(fragment);
    if (cached !== undefined) return cached;
    let found = sh(["git", "grep", "-F", "-q", "-e", fragment, base]).code === 0;
    for (const source of sources) {
      if (found) break;
      found = sh(["git", "-C", source, "grep", "-F", "-q", "-e", fragment, "HEAD"]).code === 0;
    }
    cache.set(fragment, found);
    return found;
  };
}

function checkGermanParity(base: string, sources: string[]): string[] {
  const failures: string[] = [];
  const exists = makeFragmentFinder(base, sources);
  for (const file of findDeCatalogFiles()) {
    const source = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);
    for (const [key, rawValues] of extractCatalogValues(source)) {
      if (NEW_GERMAN.has(key)) continue;
      for (const value of rawValues) {
        for (const fragment of fragmentsOf(value)) {
          if (!exists(fragment)) {
            failures.push(
              `${rel}: "${key}" — fragment not found in ${base} or the source repos: ${JSON.stringify(fragment)}`,
            );
          }
        }
      }
    }
  }
  return failures;
}

/* -------------------------------------------------------------------------- */
/* check 2 — no German left in ported source                                  */
/* -------------------------------------------------------------------------- */

const GERMAN_STOPWORDS =
  /\b(der|die|das|und|nicht|dein|deine|dich|kann|wurde|keine|bitte|noch|mehr|schon)\b/i;
const GERMAN_CHARS = /[äöüßÄÖÜ]/;

/** Content-language files: German recipe vocabulary / seed data, never flagged. */
const ALLOW_LIST = [
  "packages/shared/src/core/text.ts",
  "packages/shared/src/modules/recipe/units.ts",
  "packages/shared/src/modules/recipe/ingredients.ts",
  "packages/shared/src/modules/recipe/numbers.ts",
  "packages/shared/src/modules/recipe/duration.ts",
  "packages/shared/src/modules/recipe/tags.ts",
  "apps/api/src/modules/recipe/services/import/ocr/quantity-fix.ts",
  "apps/api/src/modules/recipe/services/import/ocr/segment.ts",
  "apps/api/src/modules/recipe/services/import/url/schema-map.ts",
  "apps/api/src/modules/recipe/services/import/url/adapters",
  "apps/api/src/modules/recipe/services/import/url/fetch.ts",
  "apps/api/src/modules/recipe/services/import/url/ssrf.ts",
  "apps/api/src/modules/recipe/services/import/url/image.ts",
  "apps/api/src/modules/recipe/services/import/parsed.ts",
  "apps/api/src/modules/recipe/services/import/times.ts",
  "apps/api/scripts/seed.ts",
  "apps/api/src/modules/recipe/seed.ts",
  "apps/api/src/modules/finance/seed.ts",
];

const PORTED_ROOTS = [
  "apps/web/src/core",
  "apps/web/src/modules",
  "apps/web/src/components",
  "apps/web/src/lib",
  "apps/api/src",
  "packages/shared/src",
];

function isAllowed(rel: string): boolean {
  if (rel.endsWith(".de.ts")) return true;
  if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return true;
  if (rel.startsWith("apps/api/test/fixtures/")) return true;
  if (rel.includes("/lib/i18n/catalogs/")) return true;
  // A module's own catalogs (web and shared trees) are catalogs, like lib/i18n/catalogs.
  if (
    (rel.startsWith("apps/web/src/modules/") || rel.startsWith("packages/shared/src/modules/")) &&
    rel.includes("/catalogs/")
  ) {
    return true;
  }
  return ALLOW_LIST.some((allowed) => rel === allowed || rel.startsWith(`${allowed}/`) || rel.startsWith(allowed));
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
}

function checkNoGermanLeft(): string[] {
  const failures: string[] = [];
  for (const root of PORTED_ROOTS) {
    const dir = join(ROOT, root);
    if (!existsSync(dir)) continue;
    const files: string[] = [];
    walk(dir, files);
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (isAllowed(rel)) continue;
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        // Only inside string/JSX literals — a rough but grep-shaped filter:
        // require a quote or JSX text character on the line to cut noise from
        // identifiers/imports that happen to contain a stopword substring.
        if (!/["'`>]/.test(line)) continue;
        if (GERMAN_CHARS.test(line) || GERMAN_STOPWORDS.test(line)) {
          failures.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
  }
  return failures;
}

/* -------------------------------------------------------------------------- */

async function main() {
  const base = baseCommit();
  const sources = resolveSources();
  console.log(`[i18n:check] sources: ${sources.length > 0 ? sources.join(", ") : "(none)"}`);
  console.log(`[i18n:check] base commit: ${base}`);

  console.log("[i18n:check] 1/2 German catalog parity…");
  const parityFailures = checkGermanParity(base, sources);
  if (parityFailures.length > 0) {
    console.error(`[i18n:check] FAILED — ${parityFailures.length} value(s) not found in the base tree or the source repos:`);
    for (const failure of parityFailures) console.error(`  - ${failure}`);
  } else {
    console.log("[i18n:check] OK");
  }

  console.log("[i18n:check] 2/2 no German left in ported source…");
  const leftoverFailures = checkNoGermanLeft();
  if (leftoverFailures.length > 0) {
    console.error(`[i18n:check] FAILED — ${leftoverFailures.length} possible German literal(s):`);
    for (const failure of leftoverFailures.slice(0, 200)) console.error(`  - ${failure}`);
    if (leftoverFailures.length > 200) {
      console.error(`  … and ${leftoverFailures.length - 200} more`);
    }
  } else {
    console.log("[i18n:check] OK");
  }

  if (parityFailures.length > 0 || leftoverFailures.length > 0) process.exit(1);
}

await main();
