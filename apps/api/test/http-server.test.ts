/**
 * The real server (`src/http/server.ts`; docs/EFFECT.md E7, E8, E9; plan `docs/plans/e7-http-api.md` P12, E7-T11): the
 * application served by `BunHttpServer` through a real socket, not the in-memory handler every other test uses.
 *
 * `appServer(routes)` over `BunHttpServer.layerTest` (`127.0.0.1`, port 0) is built on the one runtime, as
 * `src/index.ts` launches `serverLayer()` there (the `AppLayer` services are the runtime's; the router is the server's
 * own, on a fork of the memo map). The routes are `appRoutesLayer()` plus one test route that echoes `clientIp`, so the
 * socket address the server reads from `Bun.serve` (`server.requestIP`) is proven to reach it. Each case goes over
 * the wire with `fetch`:
 *   (a) `GET /api/health` answers 200 with the health payload and the complete security-header set;
 *   (b) `HEAD /api/health` answers 200 with the same headers and an EMPTY body (the router's `HEAD` → `GET` fallback,
 *       BunHttpServer omits the body);
 *   (c) a registration and a login carry their session cookie as a real `Set-Cookie` header with today's attributes;
 *   (d) `clientIp` sees the socket address (`127.0.0.1`), never `"unknown"` as in memory.
 * The server scope is closed in `afterAll`; the runtime itself is never disposed in a test.
 */
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { appRoutesLayer } from "../src/http/app.ts";
import { clientIp } from "../src/http/request.ts";
import { appServer } from "../src/http/server.ts";
import { runtime } from "../src/runtime.ts";

/** The security headers every response carries (`middleware/securityHeaders.ts`; the contract test pins the full set). */
const SECURITY: Record<string, string | null> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src blob:",
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

const PASSWORD = "geheimes-passwort-123";

/** A test-only route: the client address as the rate limiter reads it. */
const clientIpEcho = HttpRouter.add(
  "GET",
  "/__test/client-ip",
  Effect.map(clientIp, (ip) => HttpServerResponse.text(ip)),
);

let scope: Scope.Closeable | undefined;
let base = "";

beforeAll(async () => {
  await runMigrations(db);
  const opened = await runtime.runPromise(Scope.make());
  scope = opened;
  const server = appServer(Layer.merge(appRoutesLayer(), clientIpEcho)).pipe(Layer.provideMerge(BunHttpServer.layerTest));
  const context = await runtime.runPromise(Layer.buildWithScope(server, opened));
  const address = Context.get(context, HttpServer.HttpServer).address;
  if (address._tag === "UnixPathAddress") throw new Error("expected a TCP address");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (scope !== undefined) await runtime.runPromise(Scope.close(scope, Exit.void));
});

function expectSecurityHeaders(response: Response): void {
  for (const [name, value] of Object.entries(SECURITY)) {
    expect({ name, value: response.headers.get(name) }).toEqual({ name, value });
  }
}

describe("the application through BunHttpServer and a real socket", () => {
  test("(a) GET /api/health answers 200 with the payload and the security headers", async () => {
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expectSecurityHeaders(response);
    const body = (await response.json()) as { ok: boolean; status: string; modules: string[] };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");
    expect(body.modules).toEqual(["recipe", "finance"]);
  });

  test("(b) HEAD /api/health answers 200 with the security headers and an empty body", async () => {
    const response = await fetch(`${base}/api/health`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
    expect(await response.text()).toBe("");
  });

  test("(c) register and login send the session cookie as a real Set-Cookie header", async () => {
    const email = `server.${crypto.randomUUID().slice(0, 8)}@toon.test`;
    const register = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "Server", password: PASSWORD }),
    });
    expect(register.status).toBe(201);
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.status).toBe(200);
    for (const response of [register, login]) {
      const cookies = response.headers.getSetCookie();
      expect(cookies).toHaveLength(1);
      const [pair, ...attributes] = (cookies[0] ?? "").split(";").map((part) => part.trim());
      expect(pair).toMatch(/^toon_session=[^;]+$/);
      expect(new Set(attributes.map((attribute) => attribute.split("=")[0]?.toLowerCase()))).toEqual(
        new Set(["max-age", "path", "httponly", "samesite"]),
      );
      expect(attributes).toContain("Path=/");
      expect(attributes).toContain("HttpOnly");
      expect(attributes).toContain("SameSite=Lax");
      // The remaining lifetime of a fresh 30-day session, in seconds (a second may have passed since it was created).
      const maxAge = Number(attributes.find((attribute) => attribute.startsWith("Max-Age="))?.slice("Max-Age=".length));
      expect(maxAge).toBeGreaterThan(30 * 24 * 3600 - 60);
      expect(maxAge).toBeLessThanOrEqual(30 * 24 * 3600);
    }

    const sessionCookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "";
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: sessionCookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(email);
  });

  test("(d) the socket address reaches clientIp", async () => {
    const response = await fetch(`${base}/__test/client-ip`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("127.0.0.1");
  });
});
