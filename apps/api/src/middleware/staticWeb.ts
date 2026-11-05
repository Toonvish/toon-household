/**
 * Serves the built PWA from the API's own port.
 *
 * This is what makes the Docker image ONE container and ONE origin, and it is why
 * a self-hosted deployment needs no CORS entry, no second web server and no API
 * URL baked into the bundle at build time: the browser fetches `/`, `/api/…` and
 * `/uploads/…` from the same origin, so `PUBLIC_API_URL` can stay empty and the
 * `SameSite=Lax` session cookie is a first-party cookie by construction.
 *
 * Mounted LAST in src/index.ts, and it still refuses `/api/*` and `/uploads/*`
 * itself — belt and braces, because the failure mode of getting that wrong is the
 * SPA shell being returned for an API call, which surfaces as an unparseable JSON
 * error miles from the cause.
 *
 * THE CACHING RULES ARE THE POINT OF THIS FILE. Vite emits content-hashed asset
 * filenames, so those are immutable forever; `index.html` and `sw.js` are NOT
 * hashed, and if either is cached the app can never update itself again — the
 * browser keeps handing back a service worker that precaches the old bundle. That
 * bug looks like "the server keeps serving a stale app for days", so:
 *
 *   /assets/<name>-<hash>.<ext>   immutable, one year
 *   sw.js, index.html, manifest   no-cache (revalidate every single time)
 *   icons and other static files   one day
 */
import { existsSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { pathOf } from "../http/request.ts";
import { errorResponse } from "../http/response.ts";
import { routeUnknown } from "../lib/errors.ts";

/**
 * Explicit content types for everything a vite + vite-plugin-pwa build emits.
 *
 * `Bun.file().type` covers most of these, but it answers
 * `application/octet-stream` for `.webmanifest` — and a manifest served with the
 * wrong type is silently ignored, which means no install prompt and no PWA. That
 * one entry is the reason this map exists.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  // The card scanner's zxing decoder (apps/web/src/features/cards/lib/scan.ts).
  // `Bun.file().type` happens to answer `application/wasm` today; listed anyway,
  // because a wasm module served as octet-stream fails `instantiateStreaming` and
  // the symptom would be "the scanner never loads, only in Docker".
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

/** Never cached, because the app can only ever update through these. */
const NEVER_CACHE = new Set(["/index.html", "/sw.js", "/registerSW.js", "/manifest.webmanifest"]);

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  return dot > slash ? path.slice(dot).toLowerCase() : "";
}

function cacheControl(pathname: string): string {
  if (NEVER_CACHE.has(pathname)) return "no-cache";
  // Vite's hashed output: the name changes whenever the bytes do, so this is safe
  // and it is what makes a repeat visit instant on a phone.
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "public, max-age=86400";
}

/**
 * The response for `pathname` out of `distDir`, or `undefined` when the static layer declines (the caller answers the
 * route-unknown `404`): the built file, or the SPA shell `index.html` for a path that looks like a client-side route.
 *
 * A request for a MISSING file that looks like a file (it has an extension) is declined rather than answered with
 * the SPA shell. Handing back HTML for a missing `.js` produces a MIME-type console error that says nothing about the
 * real problem, and a typo'd asset path would look like it worked.
 */
export function resolveStatic(distDir: string, method: string, pathname: string): Response | undefined {
  const root = resolve(distDir);
  const indexPath = join(root, "index.html");

  if (method !== "GET" && method !== "HEAD") return undefined;

  // The API and the uploads route own these; nothing here may answer them.
  if (pathname.startsWith("/api/") || pathname.startsWith("/uploads/")) return undefined;

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is not a path we can reason about.
    return undefined;
  }
  // `%00` and friends would otherwise reach the filesystem layer.
  if (decoded.includes("\u0000")) return undefined;

  const requested = normalize(decoded);
  if (requested.includes("..")) return undefined;

  const candidate = requested === "/" ? indexPath : join(root, requested);
  // normalize() plus the prefix check is the same guard the uploads route uses:
  // it keeps `/..%2f..%2fetc/passwd` inside the dist directory.
  const inRoot = candidate === root || candidate.startsWith(`${root}/`);

  if (inRoot && existsSync(candidate) && statSync(candidate).isFile()) {
    return serve(method, candidate, requested === "/" ? "/index.html" : requested);
  }

  // Missing and it looks like a file -> a real 404, not the app shell.
  if (extensionOf(requested).length > 0) return undefined;

  // Everything else is a client-side route (`/recipes/123`, `/shopping`), which
  // only the SPA can resolve.
  if (!existsSync(indexPath)) return undefined;
  return serve(method, indexPath, "/index.html");
}

/**
 * The fallback route's handler (plan `docs/plans/e7-http-api.md` P11.5; registered by `fallbackRoutesLayer` in
 * `http/global.ts` on the path `*` for every explicit method but HEAD): with a `distDir` a `GET` (or the `HEAD` the
 * router hands to the `GET` tree) the static rules accept is served; everything else is the JSON `404`
 * (`server.error.routeUnknown`) every unknown route has.
 */
export const staticFallback = Effect.fn("staticWeb.fallback")(function* (distDir: string | null) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (distDir !== null) {
    const response = resolveStatic(distDir, request.method, new URL(request.originalUrl, "http://localhost").pathname);
    if (response !== undefined) return HttpServerResponse.fromWeb(response);
  }
  return yield* errorResponse(routeUnknown(request.method, pathOf(request.originalUrl)));
});

function serve(method: string, absolutePath: string, pathname: string): Response {
  const file = Bun.file(absolutePath);
  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPES[extensionOf(pathname)] ?? file.type ?? "application/octet-stream",
    "Cache-Control": cacheControl(pathname),
  };
  // A service worker outside its scope is rejected by the browser; this header is
  // what lets `/sw.js` claim the whole origin (it is served from the root, so the
  // scope already matches — the header keeps that true if the path ever moves).
  if (pathname === "/sw.js") headers["Service-Worker-Allowed"] = "/";

  if (method === "HEAD") {
    return new Response(null, { headers: { ...headers, "Content-Length": String(file.size) } });
  }
  return new Response(file, { headers });
}

/* Hono (E7 transition): E7-T12 deletes this section */
import type { MiddlewareHandler } from "hono";

/** Hono middleware serving `distDir` (`resolveStatic`), with an SPA fallback to `index.html`. */
export function webAppMiddleware(distDir: string): MiddlewareHandler {
  return async (c, next) => {
    const response = resolveStatic(distDir, c.req.method, new URL(c.req.url).pathname);
    return response ?? next();
  };
}
