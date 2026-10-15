/**
 * Keeps docs/API.md honest (M7 plan decision 4): the rows of its endpoint tables
 * (`| METHOD | `/full/path` | Auth | Request | Response | Status |`) are compared with the
 * routes `app` really serves, and every `ERROR_CODES` value must be named in the doc.
 *
 *   (a) every served route outside the module prefixes is documented;
 *   (b) every served route under a module prefix is documented once that module id is in
 *       REQUIRED_MODULE_SECTIONS (M7-T04 adds "recipe", M7-T05 adds "finance");
 *   (c) every documented row is served, except DOC_ONLY;
 *   (d) every ERROR_CODES value appears in docs/API.md as an inline-code span;
 *   (e) no row is documented twice.
 *
 * Method `ALL` (middleware registrations such as `app.use`) is not a route and is ignored.
 */
import { ERROR_CODES } from "@toon/shared";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../src/index.ts";

/** Module ids whose routes must all have a row (grows with each module section). */
const REQUIRED_MODULE_SECTIONS: string[] = ["recipe", "finance"];

/** Rows that document a route `app.routes` cannot list (a derived URL of an existing route). */
const DOC_ONLY = ["GET /uploads/:filename.thumb.webp"];

/** Path prefix of each module's routes, by module id. */
const MODULE_PREFIXES: Record<string, string[]> = {
  recipe: ["/api/households/:householdId/recipe", "/api/recipe/"],
  finance: ["/api/households/:householdId/finance"],
};

const DOC_PATH = join(import.meta.dir, "..", "..", "..", "docs", "API.md");
const doc = readFileSync(DOC_PATH, "utf8");

const ROW = /^\| (GET|POST|PATCH|PUT|DELETE) \| `([^`]+)` \|/gm;
const documentedRows: string[] = [...doc.matchAll(ROW)].map((match) => `${match[1]} ${match[2]}`);

const served: string[] = [
  ...new Set(
    app.routes.filter((route) => route.method !== "ALL").map((route) => `${route.method} ${route.path}`),
  ),
];

/** The module id a route path belongs to, or null for the core. */
function moduleOf(path: string): string | null {
  for (const [id, prefixes] of Object.entries(MODULE_PREFIXES)) {
    for (const prefix of prefixes) {
      const bare = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
      if (path === bare || path.startsWith(`${bare}/`)) return id;
    }
  }
  return null;
}

function pathOf(entry: string): string {
  return entry.slice(entry.indexOf(" ") + 1);
}

describe("docs/API.md matches the served routes", () => {
  test("the doc has endpoint rows at all", () => {
    expect(documentedRows.length).toBeGreaterThan(0);
  });

  test("(a) every served route outside the module prefixes is documented", () => {
    const documented = new Set(documentedRows);
    const missing = served.filter((entry) => moduleOf(pathOf(entry)) === null && !documented.has(entry));
    expect(missing).toEqual([]);
  });

  test("(b) every served route of a module with a finished section is documented", () => {
    const documented = new Set(documentedRows);
    const missing = served.filter((entry) => {
      const id = moduleOf(pathOf(entry));
      return id !== null && REQUIRED_MODULE_SECTIONS.includes(id) && !documented.has(entry);
    });
    expect(missing).toEqual([]);
  });

  test("(c) every documented row is served", () => {
    const servedSet = new Set(served);
    const phantom = documentedRows.filter((entry) => !DOC_ONLY.includes(entry) && !servedSet.has(entry));
    expect(phantom).toEqual([]);
  });

  test("(d) every ERROR_CODES value appears in the doc as an inline-code span", () => {
    const spans = new Set([...doc.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]));
    const missing = ERROR_CODES.filter((code) => !spans.has(code));
    expect(missing).toEqual([]);
  });

  test("(e) no row is documented twice", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const entry of documentedRows) {
      if (seen.has(entry)) duplicates.push(entry);
      seen.add(entry);
    }
    expect(duplicates).toEqual([]);
  });

  test("the doc keeps the retired group vocabulary out of its auth levels and paths", () => {
    expect(doc).not.toMatch(/\/api\/groups|:groupId|group:(member|admin|owner)/);
  });
});
