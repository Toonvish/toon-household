/**
 * toon-household API — Bun.serve + Hono.
 *
 * This file is the WIRING: CORS, logging, error handling, locale negotiation,
 * the health probe, the core routers and the module mounts. Modules add their
 * routes inside `src/modules/<id>/` and reach the app only through
 * `src/modules/index.ts` (SPEC §2) — nobody needs to edit this file to add a
 * module route.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { dbReady } from "./db/client.ts";
import { env } from "./env.ts";
import { notFoundHandler, onErrorHandler } from "./lib/errors.ts";
import { localeMiddleware } from "./lib/locale.ts";
import type { AppEnv } from "./lib/types.ts";
import { API_MODULES } from "./modules/index.ts";

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
    features: Object.assign(
      {},
      ...API_MODULES.map((module) => module.healthFeatures?.() ?? {}),
    ) as Record<string, boolean>,
  }),
);

// --- uploads ----------------------------------------------------------------
// M1: `GET /uploads/:filename` (signed URLs, lib/uploadUrls.ts) returns here with
// the media service and its thumbnails.

// --- core routers -----------------------------------------------------------
// M1: app.route("/api/auth", authRoutes);
// M1: app.route("/api/households", householdRoutes);  (members, invites, modules
//     under /api/households/:householdId — invites before `:id`, SPEC D8)

// --- modules ----------------------------------------------------------------
// M0-T09: mountModules(app, API_MODULES) — each household router at
// /api/households/:householdId/<id> behind requireSession → requireHouseholdRole
// → requireModule(id), each user router at /api/<id>.

// --- static web (LAST) --------------------------------------------------------
// M0-T09: `app.use("*", webAppMiddleware(env.webDistDir))` when WEB_DIST_DIR is
// set. It MUST stay the last registration: it falls back to the SPA shell for
// unknown paths, so anything it saw first would never reach a real route.

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
