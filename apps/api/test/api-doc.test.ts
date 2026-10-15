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
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { users } from "../src/db/schema.ts";
import { app } from "../src/index.ts";
import { createHousehold, createUser } from "./support/finance-harness.ts";

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

/**
 * The Auth column's `+verified` suffix is checked against behaviour, not against the source text:
 * an unconfirmed owner of a household with both modules enabled sends every served module write
 * (no body: the confirmed-address gate runs before any parsing) and the routes that answer
 * `403 email_unverified` must be exactly the rows whose Auth cell carries `+verified`.
 */
describe("docs/API.md marks +verified on exactly the module writes that gate on it", () => {
  const AUTH_ROW = /^\| (POST|PATCH|PUT|DELETE) \| `([^`]+)` \| ([^|]+) \|/gm;
  const authOf = new Map<string, string>(
    [...doc.matchAll(AUTH_ROW)].map((match) => [`${match[1]} ${match[2]}`, match[3] ?? ""]),
  );
  const moduleWrites = served.filter(
    (entry) => !entry.startsWith("GET ") && moduleOf(pathOf(entry)) !== null && authOf.has(entry),
  );

  beforeAll(async () => {
    await runMigrations(db);
    setVerifiedEmailRequired(true);
  });
  afterAll(() => setVerifiedEmailRequired(null));

  test("every served module write is documented with an Auth cell", () => {
    const missing = served.filter(
      (entry) => !entry.startsWith("GET ") && moduleOf(pathOf(entry)) !== null && !authOf.has(entry),
    );
    expect(missing).toEqual([]);
    expect(moduleWrites.length).toBeGreaterThan(50);
  });

  test("the +verified rows are the writes that answer 403 email_unverified", async () => {
    const owner = await createUser("Unconfirmed");
    const householdId = await createHousehold(owner, "Doc gate");
    await db.update(users).set({ emailVerified: false, emailVerifiedAt: null }).where(eq(users.id, owner.id));

    const gated: string[] = [];
    for (const entry of moduleWrites) {
      const method = entry.slice(0, entry.indexOf(" "));
      const path = pathOf(entry)
        .replace(":householdId", householdId)
        .replace(/:[A-Za-z]+/g, () => crypto.randomUUID());
      const response = await app.request(path, { method, headers: { Cookie: owner.cookie } });
      const payload = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      if (payload?.error?.code === "email_unverified") gated.push(entry);
    }

    const documented = moduleWrites.filter((entry) => (authOf.get(entry) ?? "").includes("+verified"));
    expect(documented.sort()).toEqual(gated.sort());
  });
});
