/**
 * Serving the built PWA from the API's own port (the single-container setup).
 *
 * The middleware is exercised against a throwaway `dist` directory rather than a
 * real vite build, so these tests are fast and pin behaviour instead of build
 * output. What matters here and is easy to regress:
 *
 *   - `/api/*` and `/uploads/*` are NEVER answered by the static layer,
 *   - `sw.js` and `index.html` are never cached (otherwise the app can never
 *     update itself again, and the symptom appears days later),
 *   - hashed assets ARE cached immutably,
 *   - a missing *.js is a 404, not the SPA shell,
 *   - path traversal cannot escape the dist directory.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { webAppMiddleware } from "../src/middleware/staticWeb.ts";

let distDir = "";
let outsideSecret = "";
let app: Hono;

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), "toon-dist-"));
  distDir = join(base, "dist");
  mkdirSync(join(distDir, "assets"), { recursive: true });
  mkdirSync(join(distDir, "icons"), { recursive: true });

  writeFileSync(join(distDir, "index.html"), "<!doctype html><title>Rezepte</title>");
  writeFileSync(join(distDir, "sw.js"), "// service worker");
  writeFileSync(join(distDir, "manifest.webmanifest"), '{"name":"Rezepte"}');
  writeFileSync(join(distDir, "assets", "index-a1b2c3d4.js"), "console.log('app')");
  writeFileSync(join(distDir, "assets", "index-a1b2c3d4.css"), "body{}");
  // The card scanner's decoder — a wasm module served as octet-stream would fail
  // `instantiateStreaming`, and only in the single-origin (Docker) setup.
  writeFileSync(join(distDir, "assets", "zxing_reader-a1b2c3d4.wasm"), "\0asm");
  writeFileSync(join(distDir, "icons", "icon-192.png"), "not really a png");

  // A file next to (not inside) dist: nothing may ever reach it.
  outsideSecret = join(base, "secret.txt");
  writeFileSync(outsideSecret, "SESSION_SECRET=hunter2");

  app = new Hono();
  // Stand-ins for the real routers, so "the static layer must not shadow them" is
  // actually observable.
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/uploads/:filename", (c) => c.text(`upload:${c.req.param("filename")}`));
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Nicht gefunden" } }, 404));
  app.use("*", webAppMiddleware(distDir));
});

afterAll(() => {
  if (distDir) rmSync(join(distDir, ".."), { recursive: true, force: true });
});

// `Hono.request()` is typed as `Response | Promise<Response>`; awaiting it in one
// place keeps every test below free of that union.
const get = async (path: string, init?: RequestInit): Promise<Response> =>
  await app.request(`http://localhost${path}`, init);

describe("serving the app shell", () => {
  test("/ returns index.html", async () => {
    const response = await get("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<title>Rezepte</title>");
  });

  test("client-side routes fall back to the shell so a deep link works", async () => {
    for (const path of ["/shopping", "/recipes/123", "/groups/abc/members", "/import"]) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<title>Rezepte</title>");
    }
  });

  test("HEAD answers with the headers and no body", async () => {
    const response = await get("/", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe("");
  });

  test("a non-GET method is left to the routers", async () => {
    const response = await get("/", { method: "POST" });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });
});

describe("cache headers", () => {
  test("sw.js is never cached — this is what lets the app update at all", async () => {
    const response = await get("/sw.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    // Without this the browser refuses a worker that claims the whole origin.
    expect(response.headers.get("service-worker-allowed")).toBe("/");
  });

  test("index.html is never cached", async () => {
    expect((await get("/index.html")).headers.get("cache-control")).toBe("no-cache");
    expect((await get("/recipes/1")).headers.get("cache-control")).toBe("no-cache");
  });

  test("hashed assets are immutable for a year", async () => {
    const js = await get("/assets/index-a1b2c3d4.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");

    const css = await get("/assets/index-a1b2c3d4.css");
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
  });

  test("the manifest gets the type that makes the install prompt appear", async () => {
    const response = await get("/manifest.webmanifest");
    expect(response.status).toBe(200);
    // application/octet-stream here means "no PWA", silently.
    expect(response.headers.get("content-type")).toBe("application/manifest+json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  test("a wasm module keeps its own type, or the scanner cannot instantiate it", async () => {
    const response = await get("/assets/zxing_reader-a1b2c3d4.wasm");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/wasm");
  });

  test("other static files get a modest cache", async () => {
    const response = await get("/icons/icon-192.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
  });
});

describe("what the static layer must never answer", () => {
  test("/api/* still reaches the API", async () => {
    const response = await get("/api/health");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("an unknown /api path is a JSON 404, never the SPA shell", async () => {
    const response = await get("/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  test("/uploads/* still reaches the signed-upload route", async () => {
    const response = await get("/uploads/abc.jpg");
    expect(await response.text()).toBe("upload:abc.jpg");
  });

  test("a missing asset is a 404, not HTML with the wrong MIME type", async () => {
    for (const path of ["/assets/gone-00000000.js", "/nope.css", "/missing.png"]) {
      const response = await get(path);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("application/json");
    }
  });
});

describe("path traversal", () => {
  test("cannot escape the dist directory", async () => {
    for (const path of [
      "/../secret.txt",
      "/..%2Fsecret.txt",
      "/assets/../../secret.txt",
      "/%2e%2e%2fsecret.txt",
      "/....//secret.txt",
      "/assets/%2e%2e/%2e%2e/secret.txt",
    ]) {
      const response = await get(path);
      const body = await response.text();
      expect(body).not.toContain("hunter2");
    }
  });

  test("a directory is not served as a file", async () => {
    const response = await get("/assets/");
    // Falls through to the shell or a 404 — never a directory listing.
    expect(response.headers.get("content-type")).not.toContain("octet-stream");
    expect(await response.text()).not.toContain("index-a1b2c3d4");
  });
});

describe("without a build", () => {
  test("an unset WEB_DIST_DIR leaves the app untouched (dev mode)", async () => {
    // The middleware is not mounted at all in that case; this pins the other half:
    // a mounted middleware pointing at a directory with no index.html must not
    // start answering routes with an empty 200.
    const empty = mkdtempSync(join(tmpdir(), "toon-empty-"));
    const bare = new Hono();
    bare.get("/api/health", (c) => c.json({ status: "ok" }));
    bare.notFound((c) => c.json({ error: { code: "not_found" } }, 404));
    bare.use("*", webAppMiddleware(empty));
    try {
      expect((await bare.request("http://localhost/")).status).toBe(404);
      expect(await (await bare.request("http://localhost/api/health")).json()).toEqual({
        status: "ok",
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
