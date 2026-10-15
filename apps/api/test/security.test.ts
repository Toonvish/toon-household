/**
 * Browser-facing and operational hardening of the core (M3b-T06; toon-finance 1715207,
 * `apps/api/test/security.test.ts`, its core half; plan m3b decisions 15-17). The finance
 * half of F's file (plan payer, period bounds, leaving, request bounds, idempotency scope)
 * is `finance-security.test.ts` (T07).
 *
 *   - the same-origin guard on unsafe `/api/*` methods, with H's WEB_ORIGIN allowance,
 *   - the content-type requirement of the auth router's body parser and the password ceiling,
 *   - the security headers every response carries, with H's CSP additions,
 *   - the last-hop `clientIp`,
 *   - the production refusals of `env.ts` and of `scripts/seed.ts`, and the seed password
 *     reaching every module's demo logins.
 *
 * None of these shows up in a curl walkthrough: they matter when a BROWSER (or an operator
 * on a production host) is the client, which is why they get their own pinned tests.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { Hono } from "hono";
import { clientIp } from "../src/core/services/auth/rateLimit.ts";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { env } from "../src/env.ts";
import { isForeignOrigin } from "../src/middleware/originGuard.ts";
import { inlineScriptHashes } from "../src/middleware/securityHeaders.ts";
import { body, call, createUser } from "./support/finance-harness.ts";

await runMigrations(db);

const API_ROOT = resolve(import.meta.dir, "..");
let scratch = "";

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "toon-household-security-"));
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

interface ErrorBody {
  error: { code: string; message: string };
}

/* -------------------------------------------------------------------------- */
/* origin guard (decision 15)                                                 */
/* -------------------------------------------------------------------------- */

describe("originGuard", () => {
  test("a cross-site browser request to an unsafe method is 403 before any handler runs", async () => {
    const user = await createUser("Guard");
    const response = await call("/api/auth/logout", {
      method: "POST",
      cookie: user.cookie,
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(response.status).toBe(403);
    const payload = await body<ErrorBody>(response);
    expect(payload.error.code).toBe("forbidden");
    expect(payload.error.message).toBe("Diese Anfrage kam nicht aus der App und wurde abgelehnt.");
    // The session must still be alive: the forged logout did nothing.
    expect((await call("/api/auth/me", { cookie: user.cookie })).status).toBe(200);
  });

  test("a SIBLING app on the shared edge domain (same-site) is refused too", async () => {
    const response = await call("/api/auth/login", {
      method: "POST",
      body: { email: "a@toon.test", password: "irrelevant" },
      headers: { "Sec-Fetch-Site": "same-site" },
    });
    expect(response.status).toBe(403);
  });

  test("a module route is guarded as well (the guard sits before mountModules)", async () => {
    const user = await createUser("ModuleGuard");
    const response = await call(`/api/households/${crypto.randomUUID()}/recipe/recipes`, {
      method: "POST",
      cookie: user.cookie,
      body: { title: "Nope" },
      headers: { Origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
    expect((await body<ErrorBody>(response)).error.code).toBe("forbidden");
  });

  test("a mismatching Origin host is refused, a matching one and no Origin pass", async () => {
    const user = await createUser("Origin");
    const foreign = await call("/api/auth/me", {
      method: "PATCH",
      cookie: user.cookie,
      body: { name: "Hacked" },
      headers: { Origin: "https://evil.example" },
    });
    expect(foreign.status).toBe(403);

    // `app.request()` resolves relative paths against http://localhost.
    const same = await call("/api/auth/me", {
      method: "PATCH",
      cookie: user.cookie,
      body: { name: "Renamed" },
      headers: { Origin: "https://localhost", "Sec-Fetch-Site": "same-origin" },
    });
    expect(same.status).toBe(200);

    const bare = await call("/api/auth/me", { method: "PATCH", cookie: user.cookie, body: { name: "Again" } });
    expect(bare.status).toBe(200);
  });

  test("an Origin listed in WEB_ORIGIN passes even with Sec-Fetch-Site: same-site (H's dev setup)", async () => {
    const user = await createUser("DevOrigin");
    const trusted = env.webOrigins[0];
    expect(trusted).toBe("http://localhost:5173");
    const response = await call("/api/auth/me", {
      method: "PATCH",
      cookie: user.cookie,
      body: { name: "From Vite" },
      headers: { Origin: trusted ?? "", "Sec-Fetch-Site": "same-site" },
    });
    expect(response.status).toBe(200);

    // Same scheme and host, another port: not listed, so F's rule applies and refuses it.
    const otherPort = await call("/api/auth/me", {
      method: "PATCH",
      cookie: user.cookie,
      body: { name: "Other port" },
      headers: { Origin: "http://localhost:5174", "Sec-Fetch-Site": "same-site" },
    });
    expect(otherPort.status).toBe(403);
  });

  test("safe methods are never checked; the scheme is ignored, the host is not; Origin: null is refused", () => {
    const evil = (name: string) => (name === "origin" ? "https://evil.example" : undefined);
    expect(isForeignOrigin({ method: "GET", url: "http://localhost/api/auth/me", header: evil })).toBe(false);
    expect(isForeignOrigin({ method: "HEAD", url: "http://localhost/api/auth/me", header: evil })).toBe(false);
    expect(isForeignOrigin({ method: "OPTIONS", url: "http://localhost/api/auth/me", header: evil })).toBe(false);
    expect(isForeignOrigin({ method: "POST", url: "http://localhost/api/auth/me", header: evil })).toBe(true);
    const https = (name: string) => (name === "origin" ? "https://localhost" : undefined);
    expect(isForeignOrigin({ method: "POST", url: "http://localhost/api/x", header: https })).toBe(false);
    const opaque = (name: string) => (name === "origin" ? "null" : undefined);
    expect(isForeignOrigin({ method: "POST", url: "http://localhost/api/x", header: opaque })).toBe(true);
    // `null` never matches a trusted origin either.
    expect(isForeignOrigin({ method: "POST", url: "http://localhost/api/x", header: opaque }, ["null"])).toBe(true);
    const none = () => undefined;
    expect(isForeignOrigin({ method: "DELETE", url: "http://localhost/api/x", header: none })).toBe(false);
    // A trusted origin is compared as an origin (scheme + host + port), trailing slash or case aside.
    const vite = (name: string) =>
      name === "origin" ? "http://LOCALHOST:5173" : name === "sec-fetch-site" ? "same-site" : undefined;
    expect(isForeignOrigin({ method: "POST", url: "http://localhost:3001/api/x", header: vite }, ["http://localhost:5173/"])).toBe(
      false,
    );
    expect(isForeignOrigin({ method: "POST", url: "http://localhost:3001/api/x", header: vite }, ["https://localhost:5173"])).toBe(
      true,
    );
  });

  test("a CORS preflight is not refused and still carries its CORS headers", async () => {
    const { app } = await import("../src/index.ts");
    const response = await app.request("/api/auth/login", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});

/* -------------------------------------------------------------------------- */
/* auth body parsing                                                          */
/* -------------------------------------------------------------------------- */

describe("auth body parsing", () => {
  test("a body that is not declared application/json is refused as bad_request", async () => {
    const { app } = await import("../src/index.ts");
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", undefined]) {
      const headers: Record<string, string> = {};
      if (contentType) headers["Content-Type"] = contentType;
      const response = await app.request("/api/auth/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "a@toon.test", password: "whatever-1234" }),
      });
      expect(response.status).toBe(400);
      expect((await body<ErrorBody>(response)).error.code).toBe("bad_request");
    }
  });

  test("application/json with a charset parameter is accepted", async () => {
    const { app } = await import("../src/index.ts");
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ email: "nobody@toon.test", password: "whatever-1234" }),
    });
    expect(response.status).toBe(401);
  });

  test("an oversized password never reaches argon2 (login and password change)", async () => {
    const login = await call("/api/auth/login", {
      method: "POST",
      body: { email: "a@toon.test", password: "x".repeat(10_000) },
    });
    expect(login.status).toBe(422);
    expect((await body<ErrorBody>(login)).error.code).toBe("validation_failed");

    const user = await createUser("LongPassword");
    const change = await call("/api/auth/password", {
      method: "POST",
      cookie: user.cookie,
      body: { currentPassword: "x".repeat(201), newPassword: "new-password-1234" },
    });
    expect(change.status).toBe(422);
  });

  test("names with control characters are refused (display name, household name)", async () => {
    const user = await createUser("Control");
    const profile = await call("/api/auth/me", {
      method: "PATCH",
      cookie: user.cookie,
      body: { name: "Line\nBreak" },
    });
    expect(profile.status).toBe(422);
    const household = await call("/api/households", {
      method: "POST",
      cookie: user.cookie,
      body: { name: "Familie\r\nBcc: someone@evil.example" },
    });
    expect(household.status).toBe(422);
    const payload = await body<{ error: { code: string; details?: Array<{ path: string; code: string }> } }>(household);
    expect(payload.error.code).toBe("validation_failed");
    expect(payload.error.details?.[0]).toMatchObject({ path: "name", code: "custom" });
  });
});

/* -------------------------------------------------------------------------- */
/* security headers (decision 16)                                             */
/* -------------------------------------------------------------------------- */

describe("security headers", () => {
  test("every response carries the H-adapted CSP, frame denial and nosniff, but no HSTS (the edge owns it)", async () => {
    for (const path of ["/api/health", "/api/does-not-exist", "/uploads/unsigned.jpg"]) {
      const response = await call(path);
      const csp = response.headers.get("content-security-policy") ?? "";
      const directives = new Map(
        csp.split(";").map((part) => {
          const [name = "", ...values] = part.trim().split(/\s+/);
          return [name, values.join(" ")] as const;
        }),
      );
      expect(directives.get("default-src")).toBe("'self'");
      // No WEB_DIST_DIR under test, so no hashes: 'self' plus the scanner's WebAssembly.
      expect(directives.get("script-src")).toBe("'self' 'wasm-unsafe-eval'");
      expect(directives.get("style-src")).toBe("'self'");
      expect(directives.get("img-src")).toBe("'self' data: blob: https:");
      expect(directives.get("media-src")).toBe("'self' blob:");
      expect(directives.get("font-src")).toBe("'self'");
      expect(directives.get("connect-src")).toBe("'self'");
      expect(directives.get("frame-ancestors")).toBe("'none'");
      expect(directives.get("object-src")).toBe("blob:");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-site");
      expect(response.headers.get("strict-transport-security")).toBeNull();
      // The card scanner needs the camera: no Permissions-Policy that could block it.
      expect(response.headers.get("permissions-policy")).toBeNull();
    }
  });

  test("inlineScriptHashes hashes exactly the inline bodies, skipping src= scripts and empty ones", () => {
    const html = `<script>var a = 1;</script><script type="module" src="/x.js"></script><script>  </script>`;
    const hashes = inlineScriptHashes(html);
    expect(hashes).toHaveLength(1);
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update("var a = 1;");
    expect(hashes[0]).toBe(`'sha256-${hasher.digest("base64")}'`);
  });
});

/* -------------------------------------------------------------------------- */
/* clientIp                                                                   */
/* -------------------------------------------------------------------------- */

describe("clientIp", () => {
  test("behind a trusted proxy the LAST X-Forwarded-For entry wins, never the client-chosen first", async () => {
    const probe = new Hono();
    probe.get("/", (c) => c.text(clientIp(c)));
    const mutableEnv = env as { trustProxy: boolean };
    const before = mutableEnv.trustProxy;
    try {
      mutableEnv.trustProxy = true;
      const forwarded = await probe.request("/", { headers: { "X-Forwarded-For": "6.6.6.6, 10.0.0.7" } });
      expect(await forwarded.text()).toBe("10.0.0.7");
      const single = await probe.request("/", { headers: { "X-Forwarded-For": "10.0.0.8" } });
      expect(await single.text()).toBe("10.0.0.8");
      mutableEnv.trustProxy = false;
      const untrusted = await probe.request("/", { headers: { "X-Forwarded-For": "6.6.6.6, 10.0.0.7" } });
      expect(await untrusted.text()).toBe("unknown");
    } finally {
      mutableEnv.trustProxy = before;
    }
  });
});

/* -------------------------------------------------------------------------- */
/* production refusals: env.ts and the seed (decision 17)                     */
/* -------------------------------------------------------------------------- */

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(args: string[], extraEnv: Record<string, string | undefined>): Promise<ProcessResult> {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...extraEnv })) {
    if (value !== undefined) childEnv[key] = value;
  }
  const proc = Bun.spawn(["bun", ...args], { cwd: API_ROOT, env: childEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** A production environment that env.ts accepts, pointed at a database under `dir`. */
function productionEnv(dir: string): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    DATABASE_URL: `file:${join(dir, "data", "seed.db")}`,
    DATABASE_AUTH_TOKEN: undefined,
    TEST_DATABASE_URL: undefined,
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    UPLOAD_DIR: join(dir, "uploads"),
    WEB_DIST_DIR: undefined,
    MAIL_TRANSPORT: undefined,
    ALLOW_SEED: undefined,
    SEED_PASSWORD: undefined,
  };
}

describe("env.ts in production", () => {
  test("refuses the .env.example SESSION_SECRET placeholder; a real secret loads", async () => {
    const dir = mkdtempSync(join(scratch, "env-"));
    const loadEnv = ["-e", 'await import("./src/env.ts"); console.log("env ok");'];
    const placeholder = await run(loadEnv, {
      ...productionEnv(dir),
      SESSION_SECRET: "change-me-to-a-32-byte-random-hex-string-0000000",
    });
    expect(placeholder.code).not.toBe(0);
    expect(placeholder.stderr).toContain("SESSION_SECRET is still the .env.example placeholder");

    const real = await run(loadEnv, productionEnv(dir));
    expect(real.stderr).toBe("");
    expect(real.code).toBe(0);
    expect(real.stdout).toContain("env ok");

    // Outside production the placeholder stays usable for a local setup.
    const development = await run(loadEnv, {
      ...productionEnv(dir),
      NODE_ENV: "development",
      SESSION_SECRET: "change-me-to-a-32-byte-random-hex-string-0000000",
    });
    expect(development.code).toBe(0);
  });
});

describe("scripts/seed.ts in production", () => {
  test("without ALLOW_SEED=1 it exits non-zero and writes nothing", async () => {
    const dir = mkdtempSync(join(scratch, "seed-refused-"));
    const result = await run(["scripts/seed.ts"], productionEnv(dir));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("refusing to run with NODE_ENV=production");
    expect(existsSync(join(dir, "data"))).toBe(false);
  });

  test("ALLOW_SEED=1 without or with a short SEED_PASSWORD exits non-zero and writes nothing", async () => {
    for (const seedPassword of [undefined, "short-pw"]) {
      const dir = mkdtempSync(join(scratch, "seed-password-"));
      const result = await run(["scripts/seed.ts"], {
        ...productionEnv(dir),
        ALLOW_SEED: "1",
        SEED_PASSWORD: seedPassword,
      });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("SEED_PASSWORD (>= 10 chars) is required in production");
      expect(existsSync(join(dir, "data"))).toBe(false);
    }
  });

  test(
    "ALLOW_SEED=1 with an own SEED_PASSWORD: every demo login of every module uses it, none demo1234",
    async () => {
      const dir = mkdtempSync(join(scratch, "seed-allowed-"));
      const seedPassword = "operator-chosen-pass-42";
      const result = await run(["scripts/seed.ts"], {
        ...productionEnv(dir),
        ALLOW_SEED: "1",
        SEED_PASSWORD: seedPassword,
      });
      if (result.code !== 0) throw new Error(`seed failed (${result.code}):\n${result.stderr}`);
      // Production never prints the password.
      expect(result.stdout).not.toContain(seedPassword);
      expect(result.stdout).not.toContain("demo1234");

      const client = createClient({ url: `file:${join(dir, "data", "seed.db")}` });
      try {
        const rows = await client.execute(
          "SELECT email, password_hash FROM users WHERE password_hash IS NOT NULL ORDER BY email",
        );
        const logins = rows.rows.map((row) => ({ email: String(row.email), hash: String(row.password_hash) }));
        expect(logins.map((login) => login.email)).toEqual([
          "demo@toon.local",
          "kim@toon.local",
          "robin@toon.local",
        ]);
        for (const login of logins) {
          expect(await Bun.password.verify(seedPassword, login.hash)).toBe(true);
          expect(await Bun.password.verify("demo1234", login.hash)).toBe(false);
        }
      } finally {
        client.close();
      }
    },
    60_000,
  );
});
