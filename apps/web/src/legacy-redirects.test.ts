// FIRST imports, on purpose (H/CLAUDE.md "A module owns its layout route and its static import
// graph stays shell-free"): the manifests are evaluated before anything that could reach the
// registry (`@/modules`) or the shell, exactly as each module's `manifest.test.ts` does. This file
// never imports `@/router` at runtime: the core routes are read from its source text below.
import { recipeModule } from "./modules/recipe/index";
import { financeModule } from "./modules/finance/index";
/**
 * Table R of docs/plans/m6-deploy.md (ADR 0008, SPEC D11): the old hostnames of toon-recipe and
 * toon-finance map their own paths to this app's and fall back to the same path on
 * TOON_HOSTNAME. A 301 is cached by the browser, so a wrong row ships a permanent redirect to
 * NotFound. Three checks keep `docker/Caddyfile`, the table and the route tree together:
 *
 *   (a) the `handle` matcher -> `redir` target pairs of each old-host site block in
 *       `docker/Caddyfile` equal the table below exactly (file and table cannot drift);
 *   (b) every row's target, with its sample's path, query and regexp capture substituted,
 *       resolves to a route of this app;
 *   (c) every route of the two source apps (a concrete sample per old path) either hits a row
 *       whose target resolves, or falls to the `{uri}` catch-all, where its own path (query
 *       stripped) must resolve here. Only `/api/` and `/uploads/` are exempt (served by the API,
 *       not the route tree). A Table R row forgotten in both the file and the table therefore
 *       fails (c) instead of shipping a cached 301 to NotFound.
 *
 * Matching follows Caddy's semantics for the matchers used: `path` with an exact path or a
 * `/x/*` prefix, `path_regexp` with its capture groups (`{re.<name>.1}`), and a `handle` without a
 * matcher as the catch-all. The rows are mutually exclusive, so first match in table order is
 * Caddy's `handle` result.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnyRoute } from "@tanstack/react-router";

type Host = "recipe" | "finance";

interface Row {
  host: Host;
  /** The matcher as Caddy reads it: `path …`, `path_regexp <name> <pattern>`, or `*` (no matcher). */
  matcher: string;
  /** The `redir` target, verbatim from the Caddyfile. */
  target: string;
  /** A concrete old URL (path plus optional query) this row handles. */
  sample: string;
}

const NEW = "https://{$TOON_HOSTNAME}";

/** Table R (docs/plans/m6-deploy.md section 3), without the `/sw.js` row (a 200, not a redirect). */
const TABLE_R: readonly Row[] = [
  // toon-recipe's old hostname
  { host: "recipe", matcher: "path /", target: `${NEW}/recipe{?query}`, sample: "/?q=suppe" },
  { host: "recipe", matcher: "path /search", target: `${NEW}/recipe{?query}`, sample: "/search?q=x" },
  { host: "recipe", matcher: "path /recipes/*", target: `${NEW}/recipe{uri}`, sample: "/recipes/r1/edit" },
  { host: "recipe", matcher: "path /import /import/*", target: `${NEW}/recipe{uri}`, sample: "/import/d1" },
  {
    host: "recipe",
    matcher: "path /collections /collections/*",
    target: `${NEW}/recipe{uri}`,
    sample: "/collections/c1",
  },
  { host: "recipe", matcher: "path /tags", target: `${NEW}/recipe{uri}`, sample: "/tags" },
  { host: "recipe", matcher: "path /shopping /shopping/*", target: `${NEW}/recipe{uri}`, sample: "/shopping/history" },
  { host: "recipe", matcher: "path /plan", target: `${NEW}/recipe{uri}`, sample: "/plan" },
  { host: "recipe", matcher: "path /groups", target: `${NEW}/households{?query}`, sample: "/groups" },
  {
    host: "recipe",
    matcher: "path_regexp groups ^/groups/(.*)$",
    target: `${NEW}/households/{re.groups.1}{?query}`,
    sample: "/groups/h1",
  },
  { host: "recipe", matcher: "*", target: `${NEW}{uri}`, sample: "/settings?linked=google" },
  // toon-finance's old hostname
  { host: "finance", matcher: "path /", target: `${NEW}/finance`, sample: "/" },
  {
    host: "finance",
    matcher: "path /transactions /transactions/*",
    target: `${NEW}/finance{uri}`,
    sample: "/transactions/t1/edit",
  },
  { host: "finance", matcher: "path /new", target: `${NEW}/finance/new`, sample: "/new" },
  { host: "finance", matcher: "path /plan", target: `${NEW}/finance/plan`, sample: "/plan" },
  { host: "finance", matcher: "path /categories", target: `${NEW}/finance/categories`, sample: "/categories" },
  { host: "finance", matcher: "path /household", target: `${NEW}/households`, sample: "/household" },
  { host: "finance", matcher: "path /password/forgot", target: `${NEW}/forgot-password`, sample: "/password/forgot" },
  {
    host: "finance",
    matcher: "path /password/reset /password/reset/*",
    target: `${NEW}/forgot-password`,
    sample: "/password/reset?token=x",
  },
  { host: "finance", matcher: "*", target: `${NEW}{uri}`, sample: "/login" },
];

/**
 * Every route of the two source apps as a concrete old URL (toon-recipe `apps/web/src/router.tsx`,
 * toon-finance `apps/web/src/router.tsx`), plus one `/api` and one `/uploads` sample per host to show
 * the exemption.
 */
const SOURCE_SAMPLES: Record<Host, readonly string[]> = {
  recipe: [
    "/",
    "/search?q=x",
    "/recipes/new",
    "/recipes/r1",
    "/recipes/r1/edit",
    "/import",
    "/import/d1",
    "/collections",
    "/collections/c1",
    "/shopping",
    "/shopping/cards",
    "/shopping/history",
    "/shopping/l1",
    "/tags",
    "/plan",
    "/groups",
    "/groups/g1",
    "/settings",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password/t1",
    "/verify-email/t1",
    "/invite/t1",
    "/oauth/callback",
    "/api/health",
    "/uploads/x.webp",
  ],
  finance: [
    "/",
    "/transactions",
    "/transactions/t1",
    "/transactions/t1/edit",
    "/new",
    "/plan",
    "/categories",
    "/household",
    "/settings",
    "/login",
    "/register",
    "/invite/t1",
    "/password/forgot",
    "/password/reset?token=x",
    "/api/health",
    "/uploads/x.webp",
  ],
};

/** Served by the API and `/uploads`, not by the route tree: the catch-all keeps them as they are. */
const EXEMPT_PREFIXES = ["/api/", "/uploads/"] as const;

/* -------------------------------------------------------------------------- */
/* the Caddyfile's old-host blocks                                            */
/* -------------------------------------------------------------------------- */

const CADDYFILE = readFileSync(join(import.meta.dir, "../../../docker/Caddyfile"), "utf8");

const SITE_ADDRESS: Record<Host, string> = {
  recipe: "{$RECIPE_HOSTNAME:http://old-recipe-hostname.unset.invalid}",
  finance: "{$FINANCE_HOSTNAME:http://old-finance-hostname.unset.invalid}",
};

/** The lines of the top-level block that opens with `<address> {` (up to the line that is exactly `}`). */
function siteBlock(address: string): string[] {
  const lines = CADDYFILE.split("\n");
  const start = lines.indexOf(`${address} {`);
  if (start < 0) throw new Error(`no site block for ${address}`);
  const end = lines.indexOf("}", start);
  return lines.slice(start + 1, end);
}

/** The block's `handle` matcher -> `redir` target pairs, named matchers resolved to their definition. */
function redirectPairs(host: Host): { matcher: string; target: string }[] {
  const lines = siteBlock(SITE_ADDRESS[host]).map((line) => line.trim());
  const named = new Map<string, string>();
  for (const line of lines) {
    const definition = /^(@\w+)\s+(.+)$/.exec(line);
    if (definition) named.set(definition[1] ?? "", definition[2] ?? "");
  }
  const pairs: { matcher: string; target: string }[] = [];
  lines.forEach((line, index) => {
    const handle = /^handle(?:\s+(\S+))?\s*\{$/.exec(line);
    if (!handle) return;
    const raw = handle[1];
    const matcher = raw === undefined ? "*" : raw.startsWith("@") ? (named.get(raw) ?? raw) : `path ${raw}`;
    const redir = /^redir\s+(\S+)\s+permanent$/.exec(lines[index + 1] ?? "");
    pairs.push({ matcher, target: redir?.[1] ?? `(no redir after handle ${raw ?? ""})` });
  });
  return pairs;
}

/* -------------------------------------------------------------------------- */
/* Caddy's matching and substitution, for the matchers the file uses          */
/* -------------------------------------------------------------------------- */

function splitUrl(url: string): { path: string; query: string } {
  const at = url.indexOf("?");
  return at < 0 ? { path: url, query: "" } : { path: url.slice(0, at), query: url.slice(at + 1) };
}

/** `null` when the matcher does not match, else the regexp captures by placeholder name. */
function match(matcher: string, path: string): Map<string, string> | null {
  if (matcher === "*") return new Map();
  const [kind, ...args] = matcher.split(/\s+/);
  if (kind === "path") {
    const hit = args.some((arg) => (arg.endsWith("/*") ? path.startsWith(arg.slice(0, -1)) : path === arg));
    return hit ? new Map() : null;
  }
  if (kind === "path_regexp") {
    const [name, pattern] = args;
    const found = new RegExp(pattern ?? "").exec(path);
    if (!found) return null;
    return new Map(found.slice(1).map((value, index) => [`{re.${name}.${index + 1}}`, value]));
  }
  throw new Error(`matcher kind not modelled: ${matcher}`);
}

/** The redirect target's path (and query) for one old URL, every placeholder substituted. */
function apply(target: string, url: string, captures: Map<string, string>): string {
  const { query } = splitUrl(url);
  let out = target.startsWith(NEW) ? target.slice(NEW.length) : target;
  out = out.replaceAll("{uri}", url).replaceAll("{?query}", query ? `?${query}` : "");
  for (const [placeholder, value] of captures) out = out.replaceAll(placeholder, value);
  if (/\{[^}]*\}/.test(out)) throw new Error(`unsubstituted placeholder in ${target} for ${url}`);
  return out;
}

/* -------------------------------------------------------------------------- */
/* the new app's routes                                                       */
/* -------------------------------------------------------------------------- */

/** Every full path of a module's route tree (as in `modules/<id>/manifest.test.ts`). */
function fullPaths(route: AnyRoute, prefix = ""): string[] {
  const own = (route.options as { path?: string }).path ?? "";
  const joined = `${prefix}/${own}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
  return [joined, ...childrenOf(route).flatMap((child) => fullPaths(child, joined))];
}

function childrenOf(route: AnyRoute): readonly AnyRoute[] {
  return (route.children ?? []) as readonly AnyRoute[];
}

const ROUTER_SOURCE = readFileSync(join(import.meta.dir, "router.tsx"), "utf8");
const CORE_PATHS = [...ROUTER_SOURCE.matchAll(/^\s*path: "(\/[^"]*)",$/gm)].map((found) => found[1] ?? "");
const MODULE_PATHS = [...fullPaths(recipeModule.route), ...fullPaths(financeModule.route)];
const H_PATHS = [...new Set([...CORE_PATHS, ...MODULE_PATHS])];

function segments(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

/** Whether a concrete path (no query) is a route of this app; `$param` matches any one segment. */
function resolves(path: string): boolean {
  const concrete = segments(path);
  return H_PATHS.some((pattern) => {
    const parts = segments(pattern);
    return (
      parts.length === concrete.length &&
      parts.every((part, index) => part.startsWith("$") || part === concrete[index])
    );
  });
}

/** The Table R row Caddy picks for an old URL (first match; the rows are mutually exclusive). */
function rowFor(host: Host, url: string, table: readonly Row[]) {
  const { path } = splitUrl(url);
  for (const row of table.filter((candidate) => candidate.host === host)) {
    const captures = match(row.matcher, path);
    if (captures) return { row, captures };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("the new app's route list", () => {
  test("the core routes are read from router.tsx", () => {
    for (const path of [
      "/",
      "/households",
      "/households/$householdId",
      "/settings",
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password/$token",
      "/verify-email/$token",
      "/invite/$token",
      "/oauth/callback",
    ]) {
      expect(CORE_PATHS).toContain(path);
    }
  });

  test("the module routes come from the manifests", () => {
    expect(MODULE_PATHS).toContain("/recipe/recipes/$recipeId/edit");
    expect(MODULE_PATHS).toContain("/finance/transactions/$transactionId/edit");
  });

  test("the resolver refuses what the tree does not have", () => {
    expect(resolves("/plan")).toBe(false);
    expect(resolves("/recipe/nope")).toBe(false);
    expect(resolves("/recipe/plan")).toBe(true);
    expect(resolves("/households/h1")).toBe(true);
  });
});

describe("(a) docker/Caddyfile's old-host blocks equal Table R", () => {
  for (const host of ["recipe", "finance"] as const) {
    test(`${host} host: the matcher -> target pairs, in file order`, () => {
      const fromFile = redirectPairs(host);
      const fromTable = TABLE_R.filter((row) => row.host === host).map(({ matcher, target }) => ({ matcher, target }));
      const key = (pair: { matcher: string; target: string }) => `${pair.matcher} => ${pair.target}`;
      expect(fromFile.map(key).sort()).toEqual(fromTable.map(key).sort());
    });

    test(`${host} host: the {uri} catch-all is the block's last handle`, () => {
      expect(redirectPairs(host).at(-1)).toEqual({ matcher: "*", target: `${NEW}{uri}` });
    });
  }
});

describe("(b) every Table R target resolves to a route of this app", () => {
  for (const row of TABLE_R) {
    test(`${row.host} ${row.matcher} (${row.sample})`, () => {
      const captures = match(row.matcher, splitUrl(row.sample).path);
      expect(captures).not.toBeNull();
      const landed = apply(row.target, row.sample, captures ?? new Map());
      expect({ landed, resolves: resolves(splitUrl(landed).path) }).toEqual({ landed, resolves: true });
    });
  }

  test("the query survives where the table says so", () => {
    const groups = TABLE_R.find((row) => row.matcher.startsWith("path_regexp"));
    expect(groups).toBeDefined();
    if (!groups) return;
    expect(apply(groups.target, "/groups/g1?x=1", match(groups.matcher, "/groups/g1") ?? new Map())).toBe(
      "/households/g1?x=1",
    );
    const search = rowFor("recipe", "/search?q=x", TABLE_R);
    expect(search && apply(search.row.target, "/search?q=x", search.captures)).toBe("/recipe?q=x");
    const reset = rowFor("finance", "/password/reset?token=x", TABLE_R);
    expect(reset && apply(reset.row.target, "/password/reset?token=x", reset.captures)).toBe("/forgot-password");
  });
});

describe("(c) no source route falls through to a dead end", () => {
  for (const host of ["recipe", "finance"] as const) {
    for (const url of SOURCE_SAMPLES[host]) {
      test(`${host} ${url}`, () => {
        const hit = rowFor(host, url, TABLE_R);
        expect(hit).not.toBeNull();
        if (!hit) return;
        const landed = apply(hit.row.target, url, hit.captures);
        const path = splitUrl(landed).path;
        const exempt = hit.row.matcher === "*" && EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
        expect({ landed, ok: exempt || resolves(path) }).toEqual({ landed, ok: true });
      });
    }
  }

  test("the samples cover every old path of Table R", () => {
    for (const row of TABLE_R) {
      const covered = SOURCE_SAMPLES[row.host].some((url) => rowFor(row.host, url, TABLE_R)?.row === row);
      expect({ row: `${row.host} ${row.matcher}`, covered }).toEqual({ row: `${row.host} ${row.matcher}`, covered: true });
    }
  });
});
