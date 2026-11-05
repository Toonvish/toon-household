/**
 * The global HTTP layer (plan `docs/plans/e7-http-api.md` E7-T04; P11, deviation D6): the request log, the security
 * headers, CORS and the origin guard registered by `globalHttpLayer()`, and the fallback route of
 * `fallbackRoutesLayer()`, over mini APIs served in memory by `testHttpApp`. Every header value is the literal E7-T01
 * captured from the Hono app (`apps/api/test/http-contract.test.ts` rows 2, 3, 4 and 12): the preflight `204`, the
 * simple-request headers, the complete security-header set, the same CORS and security headers on a boundary-rendered
 * `401` and `422` and on the origin guard's `403`, and `/uploads/*` without CORS.
 *
 * The order is proven twice: once with no web build and once with a real `index.html` whose inline script is hashed
 * into the CSP when the layer is built (the preflight `204` and the origin guard's `403` still carry the CSP, which is
 * what a `Layer.mergeAll` of four global middleware layers would not guarantee). `HEAD` on an unknown non-API path
 * reaches the `GET` fallback.
 */
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { env } from "../src/env.ts";
import { fallbackRoutesLayer, globalHttpLayer } from "../src/http/global.ts";
import { coreApi, UNINTERRUPTIBLE } from "../src/http/middleware.ts";
import { jsonBody } from "../src/http/request.ts";
import { created, json } from "../src/http/response.ts";
import { Unauthorized } from "../src/lib/errors.ts";
import { colorStatus, elapsedLabel } from "../src/middleware/requestLog.ts";
import { inlineScriptHashes } from "../src/middleware/securityHeaders.ts";
import { testHttpApp } from "./support/http.ts";

const ORIGIN = "http://localhost:5173";
const EVIL = "https://evil.example";
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src blob:";

/** The E7-T01 literals: the complete security-header set and the absent ones. */
const SECURITY: Record<string, string | null> = {
  "content-security-policy": CSP,
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-resource-policy": "same-site",
  "cross-origin-opener-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "x-dns-prefetch-control": "off",
  "x-download-options": "noopen",
  "x-permitted-cross-domain-policies": "none",
  "x-xss-protection": "0",
  "strict-transport-security": null,
  "permissions-policy": null,
  "x-powered-by": null,
};
const CORS: Record<string, string | null> = {
  "access-control-allow-origin": ORIGIN,
  "access-control-allow-credentials": "true",
  "access-control-expose-headers": "Content-Disposition,Location",
  vary: "Origin",
};
const PREFLIGHT: Record<string, string | null> = {
  "access-control-allow-origin": ORIGIN,
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "Content-Type,Authorization",
  "access-control-expose-headers": "Content-Disposition,Location",
  "access-control-max-age": "86400",
  vary: "Origin, Access-Control-Request-Headers",
  "content-type": null,
};
const NO_CORS: Record<string, string | null> = {
  "access-control-allow-origin": null,
  "access-control-allow-credentials": null,
  "access-control-expose-headers": null,
  vary: null,
};

function expectHeaders(response: Response, expected: Record<string, string | null>): void {
  for (const [name, value] of Object.entries(expected)) expect([name, response.headers.get(name)]).toEqual([name, value]);
}

const PREFLIGHT_INIT = {
  method: "OPTIONS",
  headers: {
    origin: ORIGIN,
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type",
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The mini API: a 200, a 201, a boundary 401, a body that fails validation, and a plain `/uploads/:filename` route
// ---------------------------------------------------------------------------------------------------------------

const NameBody = Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1)) });

const GlobalGroup = HttpApiGroup.make("global.probe").add(
  HttpApiEndpoint.get("getOk", "/ok"),
  HttpApiEndpoint.post("postCreate", "/create"),
  HttpApiEndpoint.get("getUnauthorized", "/unauthorized"),
  HttpApiEndpoint.post("postName", "/name"),
);
const GlobalApi = coreApi(HttpApi.make("global.probe").add(GlobalGroup.prefix("/api/probe")));

const globalHandlers = HttpApiBuilder.group(GlobalApi, "global.probe", (handlers) =>
  handlers
    .handle("getOk", Effect.fn("global.probe.getOk")(function* () { return json({ ok: true }); }), UNINTERRUPTIBLE)
    .handle(
      "postCreate",
      Effect.fn("global.probe.postCreate")(function* () { return created({ id: "x1" }, "/api/probe/x1"); }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getUnauthorized",
      Effect.fn("global.probe.getUnauthorized")(function* () { return yield* new Unauthorized(); }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "postName",
      Effect.fn("global.probe.postName")(function* () { return json(yield* jsonBody(NameBody)); }),
      UNINTERRUPTIBLE,
    ),
);

/** `/uploads/:filename` as a plain route, so "carries the security headers but no CORS headers" is observable. */
const uploadsRoute = HttpRouter.add("GET", "/uploads/:filename", Effect.succeed(HttpServerResponse.text("upload")));

const quiet = { requestLog: false } as const;
const app = testHttpApp(
  [GlobalApi],
  globalHandlers,
  Layer.mergeAll(globalHttpLayer(quiet), fallbackRoutesLayer({ webDistDir: null }), uploadsRoute),
);

let scratch = "";
let withBuild: ReturnType<typeof testHttpApp>;
let theme = "";

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "toon-http-global-"));
  theme = 'try { document.documentElement.dataset.theme = "dark"; } catch (error) {}';
  writeFileSync(
    join(scratch, "index.html"),
    `<!doctype html><head><script>${theme}</script><script type="module" src="/assets/index-1.js"></script></head><body></body>`,
  );
  withBuild = testHttpApp(
    [GlobalApi],
    globalHandlers,
    Layer.mergeAll(globalHttpLayer({ ...quiet, webDistDir: scratch }), fallbackRoutesLayer({ webDistDir: scratch })),
  );
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const sha = (text: string): string => {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return `'sha256-${hasher.digest("base64")}'`;
};

describe("the security headers (P11.2, E7-T01 row 2)", () => {
  test("the complete set on a 200, a 404 and an OPTIONS preflight; HSTS, Permissions-Policy and X-Powered-By absent", async () => {
    const ok = await app.request("/api/probe/ok");
    expect(ok.status).toBe(200);
    expectHeaders(ok, SECURITY);
    const missing = await app.request("/api/nope");
    expect(missing.status).toBe(404);
    expectHeaders(missing, SECURITY);
    const preflight = await app.request("/api/auth/login", PREFLIGHT_INIT);
    expect(preflight.status).toBe(204);
    expectHeaders(preflight, SECURITY);
  });

  test("a non-API route carries them too: /uploads/* has the security headers and no CORS headers", async () => {
    const response = await app.request("/uploads/unsigned.jpg");
    expect(response.status).toBe(200);
    expectHeaders(response, { ...SECURITY, ...NO_CORS });
  });
});

describe("CORS (P11.3, E7-T01 row 3)", () => {
  test("OPTIONS /api/auth/login from a WEB_ORIGIN: 204, every Access-Control-* header and Vary exact, no content type", async () => {
    const response = await app.request("/api/auth/login", PREFLIGHT_INIT);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expectHeaders(response, PREFLIGHT);
  });

  test("the same preflight from a foreign origin is 204 with the same headers (the browser refuses it, not the server)", async () => {
    const response = await app.request("/api/auth/login", {
      ...PREFLIGHT_INIT,
      headers: { ...PREFLIGHT_INIT.headers, origin: EVIL },
    });
    expect(response.status).toBe(204);
    expectHeaders(response, PREFLIGHT);
  });

  test("a preflight without Access-Control-Request-Headers answers the configured allow-headers", async () => {
    const response = await app.request("/api/probe/ok", { method: "OPTIONS", headers: { origin: ORIGIN } });
    expect(response.status).toBe(204);
    expectHeaders(response, PREFLIGHT);
  });

  test("a simple GET with a trusted Origin: the CORS headers, no preflight-only ones", async () => {
    const response = await app.request("/api/probe/ok", { headers: { origin: ORIGIN } });
    expect(response.status).toBe(200);
    expectHeaders(response, {
      ...CORS,
      ...SECURITY,
      "access-control-allow-methods": null,
      "access-control-allow-headers": null,
      "access-control-max-age": null,
    });
  });

  test("the headers are sent without an Origin request header and to a foreign one (the first WEB_ORIGIN is echoed)", async () => {
    expectHeaders(await app.request("/api/probe/ok"), CORS);
    expectHeaders(await app.request("/api/probe/ok", { headers: { origin: EVIL } }), CORS);
  });

  test("a non-API OPTIONS is not a preflight: it reaches the fallback 404", async () => {
    const response = await app.request("/not-api", { method: "OPTIONS", headers: { origin: ORIGIN } });
    expect(response.status).toBe(404);
    expectHeaders(response, { ...NO_CORS, ...SECURITY });
  });

  test("CORS and the security headers are on a boundary-rendered 401", async () => {
    const response = await app.request("/api/probe/unauthorized", { headers: { origin: ORIGIN } });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
    expectHeaders(response, { ...CORS, ...SECURITY });
  });

  test("CORS and the security headers are on a boundary-rendered 422", async () => {
    const response = await app.request("/api/probe/name", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("validation_failed");
    expectHeaders(response, { ...CORS, ...SECURITY });
  });

  test("CORS and the security headers are on the route-unknown 404 of an /api path", async () => {
    const response = await app.request("/api/nope", { headers: { origin: ORIGIN } });
    expect(response.status).toBe(404);
    expectHeaders(response, { ...CORS, ...SECURITY });
  });
});

describe("the origin guard (P11.4, E7-T01 row 4)", () => {
  test("a foreign Origin on an unsafe method is 403 forbidden, with the CORS and security headers", async () => {
    const response = await app.request("/api/probe/create", { method: "POST", headers: { origin: EVIL } });
    expect(response.status).toBe(403);
    const payload = (await response.json()) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("forbidden");
    expect(payload.error.message).toBe("Diese Anfrage kam nicht aus der App und wurde abgelehnt.");
    expectHeaders(response, { ...CORS, ...SECURITY });
  });

  test("Sec-Fetch-Site: cross-site and same-site are 403; Origin: null is 403", async () => {
    const refused: Array<Record<string, string>> = [
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { origin: "null" },
    ];
    for (const headers of refused) {
      const response = await app.request("/api/probe/create", { method: "POST", headers });
      expect(response.status).toBe(403);
    }
  });

  test("the trusted WEB_ORIGIN passes (201 with Location), as does a request without an Origin", async () => {
    const trusted = await app.request("/api/probe/create", {
      method: "POST",
      headers: { origin: ORIGIN, "sec-fetch-site": "same-site" },
    });
    expect(trusted.status).toBe(201);
    expect(trusted.headers.get("location")).toBe("/api/probe/x1");
    expect((await app.request("/api/probe/create", { method: "POST" })).status).toBe(201);
  });

  test("safe methods are never checked, and a foreign POST outside /api is not the guard's business", async () => {
    expect((await app.request("/api/probe/ok", { headers: { origin: EVIL } })).status).toBe(200);
    const outside = await app.request("/not-api", { method: "POST", headers: { origin: EVIL } });
    expect(outside.status).toBe(404);
  });
});

describe("the request log (P11.1)", () => {
  let logged: string[] = [];
  const logging = testHttpApp(
    [GlobalApi],
    globalHandlers,
    Layer.mergeAll(
      globalHttpLayer({ requestLog: true, logLine: (line) => logged.push(line) }),
      fallbackRoutesLayer({ webDistDir: null }),
    ),
  );
  afterEach(() => {
    logged = [];
  });

  test("two lines per request in Hono's format, the pathname only, never the query", async () => {
    const response = await logging.request("/api/probe/ok?sig=secret&exp=1");
    expect(response.status).toBe(200);
    expect(logged).toHaveLength(2);
    expect(logged[0]).toBe("<-- GET /api/probe/ok");
    expect(logged[1]).toMatch(/^--> GET \/api\/probe\/ok (\x1B\[32m200\x1B\[0m|200) \d+(ms|s)$/);
    expect(logged.join("\n")).not.toContain("secret");
  });

  test("the outgoing line carries the boundary-rendered status", async () => {
    await logging.request("/api/probe/unauthorized");
    expect(logged[1]).toMatch(/^--> GET \/api\/probe\/unauthorized (\x1B\[33m401\x1B\[0m|401) \d+(ms|s)$/);
  });

  test("the default writer is console.log", async () => {
    const spy = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const defaulted = testHttpApp(
        [GlobalApi],
        globalHandlers,
        Layer.mergeAll(globalHttpLayer({ requestLog: true }), fallbackRoutesLayer({ webDistDir: null })),
      );
      await defaulted.request("/api/probe/ok");
      expect(spy.mock.calls.map((call) => call[0])).toContain("<-- GET /api/probe/ok");
    } finally {
      spy.mockRestore();
    }
  });

  test("it is off under NODE_ENV=test unless asked for, and the formatters are Hono's", async () => {
    expect(env.isTest).toBe(true);
    const spy = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await app.request("/api/probe/ok");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(elapsedLabel(5)).toBe("5ms");
    expect(elapsedLabel(999)).toBe("999ms");
    expect(elapsedLabel(1500)).toBe("2s");
    expect(elapsedLabel(1_234_000)).toBe("1,234s");
    expect(colorStatus(200, false)).toBe("200");
    expect(colorStatus(404, true)).toBe("\x1B[33m404\x1B[0m");
    expect(colorStatus(500, true)).toBe("\x1B[31m500\x1B[0m");
    expect(colorStatus(302, true)).toBe("\x1B[36m302\x1B[0m");
  });
});

describe("the order holds with a real index.html (the CSP carries the inline script's hash)", () => {
  const withHash = (): string => CSP.replace("'wasm-unsafe-eval';", `'wasm-unsafe-eval' ${sha(theme)};`);

  test("the hash is computed from the file the layer served", () => {
    expect(inlineScriptHashes(readFileSync(join(scratch, "index.html"), "utf8"))).toEqual([sha(theme)]);
  });

  test("the preflight 204 carries the CSP with the hash and the CORS headers", async () => {
    const response = await withBuild.request("/api/auth/login", PREFLIGHT_INIT);
    expect(response.status).toBe(204);
    expectHeaders(response, { ...PREFLIGHT, ...SECURITY, "content-security-policy": withHash() });
  });

  test("the origin guard's 403 carries the CSP with the hash and the CORS headers", async () => {
    const response = await withBuild.request("/api/probe/create", { method: "POST", headers: { origin: EVIL } });
    expect(response.status).toBe(403);
    expectHeaders(response, { ...CORS, ...SECURITY, "content-security-policy": withHash() });
  });

  test("the served shell, a deep link and a boundary 401 carry the same CSP", async () => {
    for (const path of ["/", "/finance/new", "/api/probe/unauthorized"]) {
      const response = await withBuild.request(path);
      expect(response.headers.get("content-security-policy")).toBe(withHash());
    }
  });
});

describe("the fallback route (P11.5)", () => {
  test("HEAD on an unknown non-API path reaches the GET fallback: the shell's headers and no body", async () => {
    const response = await withBuild.request("/recipe/recipes/123", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe("");
  });

  test("without a web build HEAD on an unknown path is the JSON 404's status (the GET fallback), HEAD on a GET route is 200", async () => {
    expect((await app.request("/recipe/recipes/123", { method: "HEAD" })).status).toBe(404);
    const head = await app.request("/api/probe/ok", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("the shell is served for / and deep links; /api and /uploads are never the shell", async () => {
    expect(await (await withBuild.request("/")).text()).toContain("<!doctype html>");
    expect((await withBuild.request("/finance/new")).status).toBe(200);
    const api = await withBuild.request("/api/does-not-exist");
    expect(api.status).toBe(404);
    expect(api.headers.get("content-type")).toContain("application/json");
    const upload = await withBuild.request("/uploads/nope.jpg");
    expect(upload.status).toBe(404);
    expect(upload.headers.get("content-type")).toContain("application/json");
  });

  test("every unknown route is the route-unknown envelope naming method and path, for each explicit method", async () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await app.request("/not-api/thing", { method });
      expect(response.status).toBe(404);
      const payload = (await response.json()) as { error: { code: string; message: string } };
      expect(payload.error.code).toBe("not_found");
      expect(payload.error.message).toContain(`${method} /not-api/thing`);
    }
  });

  test("a method the route has no handler for falls to the fallback: PUT on a GET route is the 404", async () => {
    const response = await app.request("/api/probe/ok", { method: "PUT" });
    expect(response.status).toBe(404);
    expectHeaders(response, { ...CORS, ...SECURITY });
  });
});

describe("globalHttpLayer registers the middlewares in one generator, never through Layer.mergeAll", () => {
  test("no mergeAll and no HttpRouter.middleware inside globalHttpLayer", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "http", "global.ts"), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join("\n");
    const start = code.indexOf("export function globalHttpLayer");
    const end = code.indexOf("export function fallbackRoutesLayer");
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, end);
    expect(body).not.toContain("mergeAll");
    expect(body).not.toContain("HttpRouter.middleware");
    expect(body.match(/addGlobalMiddleware\(/g)).toHaveLength(4);
    const order = [...body.matchAll(/addGlobalMiddleware\((\w+)/g)].map((m) => m[1]);
    expect(order).toEqual(["requestLogMiddleware", "securityHeadersMiddleware", "corsMiddleware", "originGuardMiddleware"]);
    // The fallback is one route per explicit method: never HEAD, never the method "*".
    const fallback = code.slice(end);
    expect(fallback).not.toMatch(/"HEAD"/);
    expect(fallback).not.toMatch(/add\("\*"/);
    expect(fallback.match(/HttpRouter\.add\("/g)).toHaveLength(6);
  });
});
