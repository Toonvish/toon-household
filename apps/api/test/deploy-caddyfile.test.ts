// Guards of docker/Caddyfile (SPEC D11, ADR 0008; plan m6-deploy T03 and decisions 7 to 10).
// Text-level: the load-bearing lines of the stack's Caddy. `caddy adapt` / `caddy validate` run only
// against the pinned image (plan m6 T03 step 2, T08); this file runs in CI without Docker.
// Where each old path goes is pinned by apps/web/src/legacy-redirects.test.ts against the route tree.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CADDYFILE_PATH = join(import.meta.dir, "../../../docker/Caddyfile");
const CADDYFILE = readFileSync(CADDYFILE_PATH, "utf8");
const LINES = CADDYFILE.split("\n");

/**
 * SHA-256 of toon-edge's two snippets, computed at authoring time (2026-10-15) from
 * /home/erics/software/toon-edge/Caddyfile with
 *   sed -n '/^(hardening) {$/,/^}$/p' Caddyfile | sha256sum
 *   sed -n '/^(fwd) {$/,/^}$/p' Caddyfile | sha256sum
 * i.e. over the lines from `(name) {` to the next line that is exactly `}`, each ending in "\n".
 * SPEC D11 takes them VERBATIM: a changed byte here is a change to toon-edge's hardening. The digests are
 * the whole check: toon-edge is retired and this repo reads nothing outside itself.
 */
const SNIPPET_SHA256 = {
  hardening: "0468ebf3f07d113aee4c9d13e5e2fbb31d6652042e0c32b76f44164f42ddd3fd",
  fwd: "86fb891a2d74aded58752be2f247686bf41fc85b4934042d921fe22ae6a5f1cc",
} as const;

/** The retiring worker of plan m6 decision 9, exactly (the body Caddy answers on an old host's /sw.js). */
const RETIRING_WORKER = [
  "// Retires the service worker of the app that used to live on this hostname (toon-household ADR 0008).",
  'self.addEventListener("install", () => self.skipWaiting());',
  'self.addEventListener("activate", (event) => {',
  "  event.waitUntil((async () => {",
  "    for (const key of await caches.keys()) await caches.delete(key);",
  "    await self.clients.claim();",
  "    await self.registration.unregister();",
  '    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);',
  "  })());",
  "});",
].join("\n");

const OLD_HOSTS = {
  recipe: "{$RECIPE_HOSTNAME:http://old-recipe-hostname.unset.invalid}",
  finance: "{$FINANCE_HOSTNAME:http://old-finance-hostname.unset.invalid}",
} as const;

/** The lines of the top-level block opened by the line `<opener> {`, both braces included. */
function topLevelBlock(lines: readonly string[], opener: string): string[] {
  const start = lines.indexOf(opener === "" ? "{" : `${opener} {`);
  if (start < 0) throw new Error(`no top-level block "${opener} {"`);
  const end = lines.indexOf("}", start);
  return lines.slice(start, end + 1);
}

function sha256(lines: readonly string[]): string {
  return createHash("sha256").update(`${lines.join("\n")}\n`).digest("hex");
}

/** Lines that are not comments (a `#` first on the line); the snippets' comments mention what we forbid. */
function directives(lines: readonly string[]): string[] {
  return lines.filter((line) => !line.trim().startsWith("#"));
}

/**
 * The one sanctioned edit to the verbatim snippets: the `(fwd)` comment block spells the option
 * `trusted-proxies` here, so that no `trusted_proxies` string occurs anywhere in docker/Caddyfile (the
 * deploy gate greps for it). Undo the spelling before hashing.
 */
function unhyphenated(lines: string[]): string[] {
  return lines.map((line) => (line.trim().startsWith("#") ? line.replaceAll("trusted-proxies", "trusted_proxies") : line));
}

describe("the toon-edge snippets, verbatim (SPEC D11)", () => {
  for (const name of ["hardening", "fwd"] as const) {
    test(`(${name}) has the pinned SHA-256`, () => {
      expect(sha256(unhyphenated(topLevelBlock(LINES, `(${name})`)))).toBe(SNIPPET_SHA256[name]);
    });
  }

});

describe("global options", () => {
  const global = topLevelBlock(LINES, "").map((line) => line.trim());

  test("the global block comes first (Caddy requires it)", () => {
    expect(directives(LINES).find((line) => line.trim() !== "")).toBe("{");
  });

  test("no admin API", () => {
    expect(global).toContain("admin off");
  });

  test("one certificate issuer for every site (decision 7)", () => {
    expect(global).toContain("cert_issuer {$TOON_TLS_ISSUER:acme}");
  });
});

describe("the app over HTTPS", () => {
  const site = topLevelBlock(LINES, "{$TOON_HOSTNAME}");
  const text = site.join("\n");

  test("its own tls issuer block, as toon-recipe had it", () => {
    expect(text).toMatch(/\n\ttls \{\n\t\tissuer \{\$TOON_TLS_ISSUER:acme\}\n\t\}\n/);
  });

  test("proxies to app:3001 with the fwd snippet and the recipe import timeouts", () => {
    const proxy = text.slice(text.indexOf("reverse_proxy app:3001 {"));
    expect(text).toContain("reverse_proxy app:3001 {");
    expect(proxy).toContain("\t\timport fwd\n");
    expect(proxy).toContain("read_timeout 300s");
    expect(proxy).toContain("write_timeout 300s");
  });

  test("imports the hardening headers and compresses", () => {
    expect(site).toContain("\timport hardening");
    expect(site).toContain("\tencode zstd gzip");
  });
});

describe("plain http: the local CA download and a redirect", () => {
  const site = topLevelBlock(LINES, "http://{$TOON_HOSTNAME}").map((line) => line.trim());

  test("serves /toon-root-ca.crt from Caddy's local authority", () => {
    expect(site).toContain("handle /toon-root-ca.crt {");
    expect(site).toContain("root * /data/caddy/pki/authorities/local");
    expect(site).toContain("rewrite * /root.crt");
    expect(site).toContain("header Content-Type application/x-x509-ca-cert");
  });

  test("redirects everything else to https", () => {
    expect(site).toContain("redir https://{host}{uri} permanent");
  });
});

describe("what the stack's Caddy must not do", () => {
  test("no trusted_proxies directive (it would let a client choose its rate-limit bucket)", () => {
    // toon-edge's verbatim `(fwd)` comment names the trusted-proxies option twice (spelled with a hyphen in this repo), so only directives are checked.
    expect(directives(LINES).filter((line) => line.includes("trusted_proxies"))).toEqual([]);
  });

  test("no Content-Security-Policy header (the API sends its own, ADR 0007)", () => {
    expect(directives(LINES).filter((line) => line.includes("Content-Security-Policy"))).toEqual([]);
  });

  test("no path-prefixed app (SPEC §9): one reverse_proxy, at the site root", () => {
    expect(directives(LINES).filter((line) => line.includes("reverse_proxy"))).toEqual([
      "\treverse_proxy app:3001 {",
    ]);
    expect(directives(LINES).filter((line) => /^\s*(handle_path|uri strip_prefix)\b/.test(line))).toEqual([]);
  });
});

describe("the retiring worker (decision 9)", () => {
  const snippet = topLevelBlock(LINES, "(retire_old_worker)");

  test("is served on /sw.js as no-cache JavaScript with a 200", () => {
    const trimmed = snippet.map((line) => line.trim());
    expect(trimmed).toContain("handle /sw.js {");
    expect(trimmed).toContain('header Content-Type "text/javascript; charset=utf-8"');
    expect(trimmed).toContain('header Cache-Control "no-cache"');
    // `*` is load-bearing: a body starting with `/` would otherwise be read as a path matcher.
    expect(trimmed).toContain("respond * <<JS");
    expect(trimmed).toContain("JS 200");
  });

  test("its body is decision 9's text, exactly", () => {
    const open = snippet.findIndex((line) => line.trim() === "respond * <<JS");
    const close = snippet.findIndex((line, index) => index > open && line.trim() === "JS 200");
    const closer = snippet[close] ?? "";
    const indent = closer.slice(0, closer.length - closer.trimStart().length);
    const body = snippet.slice(open + 1, close).map((line) => {
      expect(line.startsWith(indent)).toBe(true);
      return line.slice(indent.length);
    });
    expect(body.join("\n")).toBe(RETIRING_WORKER);
  });
});

describe("the optional old hostnames (ADR 0008)", () => {
  for (const [host, address] of Object.entries(OLD_HOSTS)) {
    describe(host, () => {
      const block = topLevelBlock(LINES, address);
      const body = directives(block.slice(1, -1)).filter((line) => line.trim() !== "");

      test("falls back to a reserved .invalid address when the variable is unset", () => {
        expect(address).toMatch(/^\{\$[A-Z_]+_HOSTNAME:http:\/\/old-[a-z]+-hostname\.unset\.invalid\}$/);
      });

      test("retires the old worker first and imports the hardening headers", () => {
        expect(body[0]).toBe("\timport retire_old_worker");
        expect(body).toContain("\timport hardening");
      });

      test("redirects only from inside handle blocks (a bare redir would sort before /sw.js)", () => {
        const redirs = body.filter((line) => line.trim().startsWith("redir "));
        expect(redirs.length).toBeGreaterThan(1);
        for (const line of redirs) expect(line.startsWith("\t\tredir https://{$TOON_HOSTNAME}")).toBe(true);
        expect(body.filter((line) => /^\t(redir|respond|reverse_proxy|tls)\b/.test(line))).toEqual([]);
      });

      test("ends with D11's {uri} catch-all", () => {
        const handles = body.filter((line) => /^\thandle\b/.test(line));
        expect(handles.at(-1)).toBe("\thandle {");
        const last = body.lastIndexOf("\thandle {");
        expect(body[last + 1]).toBe("\t\tredir https://{$TOON_HOSTNAME}{uri} permanent");
        expect(body[last + 2]).toBe("\t}");
      });

      test("every redirect is permanent (decision 10)", () => {
        for (const line of body.filter((candidate) => candidate.trim().startsWith("redir "))) {
          expect(line.trimEnd().endsWith(" permanent")).toBe(true);
        }
      });
    });
  }
});
