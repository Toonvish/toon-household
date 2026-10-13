/**
 * toon-household API — Bun.serve + Hono.
 *
 * This file is the WIRING: CORS, logging, error handling, locale negotiation,
 * the health probe, the core routers and the module mounts. Modules add their
 * routes inside `src/modules/<id>/` and reach the app only through
 * `src/modules/index.ts` (SPEC §2) — nobody needs to edit this file to add a
 * module route.
 */
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRoutes } from "./core/routes/auth.ts";
import { householdRoutes } from "./core/routes/households.ts";
import { isVerifiedEmailRequired } from "./core/services/auth/verifiedEmail.ts";
import { resolveThumbnail } from "./core/services/media/thumbnails.ts";
import { dbReady } from "./db/client.ts";
import { env } from "./env.ts";
import { notFoundHandler, onErrorHandler } from "./lib/errors.ts";
import { localeMiddleware } from "./lib/locale.ts";
import type { AppEnv } from "./lib/types.ts";
import {
  UPLOAD_EXP_PARAM,
  UPLOAD_SIG_PARAM,
  verifyUploadSignature,
} from "./lib/uploadUrls.ts";
import { webAppMiddleware } from "./middleware/staticWeb.ts";
import { API_MODULES } from "./modules/index.ts";
import { mountModules } from "./modules/mount.ts";

export const app = new Hono<AppEnv>();

app.onError(onErrorHandler);
app.notFound(notFoundHandler);

if (!env.isTest) app.use("*", logger());

app.use(
  "/api/*",
  cors({
    origin: (origin) => (env.webOrigins.includes(origin) ? origin : env.webOrigins[0] ?? ""),
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Disposition", "Location"],
    maxAge: 86400,
  }),
);

// Negotiates the interface locale ApiError.toBody() renders in — must run
// before every router so onErrorHandler/notFoundHandler can read it too.
app.use("*", localeMiddleware);

/**
 * Liveness/readiness probe, and the one place a client can ask what this
 * deployment can actually do. `modules` is the BUILD's modules (SPEC §2), not
 * what a household enabled; `features` merges what each module's
 * `healthFeatures()` reports (e.g. recipe's OCR import flags), so the web app
 * knows not to offer a capability the server was built without. It needs no
 * session and the service worker never caches `/api`, so the answer is always
 * the running server's.
 */
app.get("/api/health", (c) =>
  c.json({
    ok: true as const,
    status: "ok" as const,
    version: process.env.npm_package_version ?? "0.1.0",
    time: new Date().toISOString(),
    database: env.databaseKind,
    modules: API_MODULES.map((module) => module.id),
    features: {
      verifiedEmailRequired: isVerifiedEmailRequired(),
      ...(Object.assign(
        {},
        ...API_MODULES.map((module) => module.healthFeatures?.() ?? {}),
      ) as Record<string, boolean>),
    },
  }),
);

// --- uploads ----------------------------------------------------------------
/**
 * Uploaded images (recipe photos, avatars, household covers).
 *
 * NOT public: every URL must carry `?exp&sig` minted by the API when the owning
 * row was serialised (see lib/uploadUrls.ts for the scheme and for why a cookie
 * check cannot work here — a cross-origin `<img>` sends no credentials). An
 * unsigned, forged or expired request is a 404, exactly like a missing file, so
 * this route never confirms that a given UUID exists.
 *
 * Import SOURCE scans are not reachable here at all: nothing mints a signature for
 * them, and they are served by the membership-checked
 * `GET /api/households/:householdId/recipe/imports/:draftId/source` (M2).
 *
 * Path traversal is blocked by normalising and re-checking the prefix.
 *
 * `<name>.thumb.webp` is the list thumbnail of `<name>` and is generated here on
 * first request (services/media/thumbnails.ts).
 */
app.get("/uploads/:filename", async (c) => {
  const requested = normalize(c.req.param("filename"));
  if (requested.includes("..") || requested.startsWith("/")) return c.notFound();

  const verdict = verifyUploadSignature(
    requested,
    c.req.query(UPLOAD_EXP_PARAM),
    c.req.query(UPLOAD_SIG_PARAM),
  );
  if (verdict !== "ok") return c.notFound();

  const absolute = join(env.uploadDir, requested);
  if (!absolute.startsWith(env.uploadDir)) return c.notFound();

  // A `<name>.thumb.webp` is DERIVED: the URL is minted from the row, which knows
  // nothing about the disk, so the first request for one builds it. If it cannot be
  // built the original is served instead — a 404 here would be a broken <img> on a
  // recipe that is perfectly fine. See services/media/thumbnails.ts.
  let path = absolute;
  let derivedFallback = false;
  if (!existsSync(absolute)) {
    const resolved = await resolveThumbnail(requested);
    if (resolved === undefined) return c.notFound();
    path = resolved.path;
    derivedFallback = resolved.fallback;
  }

  const file = Bun.file(path);
  return new Response(file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      // `private` because the URL is now a capability, not a public address: a
      // shared proxy must not hand one client's signed response to another. The
      // max-age stays inside the signature's own lifetime.
      //
      // The fallback is deliberately NOT immutable: it is the wrong (full-size)
      // answer, so it must expire quickly enough to heal once sharp can convert.
      "Cache-Control": derivedFallback
        ? "private, max-age=300"
        : "private, max-age=21600, immutable",
    },
  });
});

// --- modules ----------------------------------------------------------------
mountModules(app, API_MODULES);

// --- core routers -----------------------------------------------------------
app.route("/api/auth", authRoutes);
// Members, invites and modules under /api/households/:householdId; the invite-token
// routes sit before `:householdId` inside householdRoutes (SPEC D8).
app.route("/api/households", householdRoutes);

// --- static web (LAST) --------------------------------------------------------
// The built web app, same-origin, when WEB_DIST_DIR is set (the Docker image; in dev
// vite serves it). It MUST stay the last registration: it falls back to the SPA
// shell for unknown paths, so anything it saw first would never reach a real route.
// It refuses `/api/*` and `/uploads/*` itself — see middleware/staticWeb.ts.
if (env.webDistDir !== null) {
  app.use("*", webAppMiddleware(env.webDistDir));
}

if (!env.isTest) {
  // The connection PRAGMAs (WAL etc., see db/client.ts) are queued before the first
  // query either way; awaiting them here means a database that cannot be opened at
  // all fails at BOOT with a readable message instead of on the first request. Not
  // done under `bun test`, where this module is imported for `app.fetch` and a
  // top-level await would serialise every test file behind it.
  await dbReady;
  console.log(
    `[api] toon-household API on http://localhost:${env.API_PORT} (db: ${env.databaseKind}, origins: ${env.webOrigins.join(", ")}, mail: ${env.mailTransport}, web: ${env.webDistDir ?? "extern"})`,
  );
}

export default {
  port: env.API_PORT,
  fetch: app.fetch,
  /** 15 MB uploads + a little slack for multipart overhead. */
  maxRequestBodySize: 20 * 1024 * 1024,
};
