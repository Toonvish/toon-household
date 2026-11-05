/**
 * toon-household API — Bun.serve + Hono.
 *
 * This file is the WIRING: CORS, logging, error handling, locale negotiation,
 * the health probe, the core routers and the module mounts. Modules add their
 * routes inside `src/modules/<id>/` and reach the app only through
 * `src/modules/index.ts` (SPEC §2) — nobody needs to edit this file to add a
 * module route.
 */
import { Effect } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRoutes } from "./core/routes/auth.ts";
import { householdRoutes } from "./core/routes/households.ts";
import { systemRoutes } from "./core/routes/system.ts";
import { env } from "./env.ts";
import { notFoundHandler, onErrorHandler } from "./lib/errors.ts";
import { localeMiddleware } from "./lib/locale.ts";
import type { AppEnv } from "./lib/types.ts";
import { originGuard } from "./middleware/originGuard.ts";
import { securityHeaders } from "./middleware/securityHeaders.ts";
import { webAppMiddleware } from "./middleware/staticWeb.ts";
import { API_MODULES } from "./modules/index.ts";
import { mountModules } from "./modules/mount.ts";
import { runtime } from "./runtime.ts";

export const app = new Hono<AppEnv>();

app.onError(onErrorHandler);
app.notFound(notFoundHandler);

if (!env.isTest) app.use("*", logger());

// Browser hardening headers on EVERY response (CSP with the built index.html's
// inline-script hashes, frame denial, nosniff, …), preflights and error bodies
// included — see middleware/securityHeaders.ts for what differs from Hono's
// defaults, why HSTS is left to the edge proxy, and why `connect-src 'self'`
// presumes a build with PUBLIC_API_URL="" (toon-finance gotcha 50).
app.use("*", securityHeaders(env.webDistDir));

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

// CSRF defence in depth for every state-changing API call (toon-finance gotcha 66,
// plan m3b decision 15): a browser request from a foreign origin, or from a SIBLING
// app on the same site (the old hostnames the stack's own Caddy redirects during the
// cutover; `SameSite=Lax` alone lets such a request through), is
// refused before any router parses its body or slides a session. After cors() so a
// preflight still gets its CORS headers, after the locale so the 403 is localised,
// before health, /uploads and mountModules. An Origin listed in WEB_ORIGIN passes
// (the dev web app on :5173 is same-site, not same-origin, with the API on :3001).
app.use("/api/*", originGuard(env.webOrigins));

// The system routes (E7-T10, plan docs/plans/e7-http-api.md P1, Table M): the liveness/readiness probe
// `GET /api/health` and the signed uploads `GET /uploads/:filename`, served by `SystemApi` through its bridge
// (core/routes/system.ts) at the place the two inline routes stood.
app.route("/", systemRoutes);

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

/**
 * Graceful shutdown (toon-recipe's block, generalised over the modules): every build
 * module's `shutdown()` runs — recipe's terminates its long-lived tesseract worker;
 * without that it was only ever torn down by process exit, which on a redeploy
 * means a killed worker mid-recognition and (on some hosts) a leaked child.
 *
 * Registered once, guarded so a repeated signal cannot start a second teardown,
 * and never in tests — bun's test runner owns the process there. A module whose
 * shutdown fails is logged and the others still run (the hooks are Effects run on the
 * one runtime, plan e2 P11; a failure rejects with the module's own error value). After every module, the one
 * Effect runtime is disposed (runtime.ts, docs/EFFECT.md E7): that closes its layer
 * scope; a failed dispose is logged and the process still exits 0.
 */
if (!env.isTest) {
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[api] ${signal} — stopping modules …`);
    await Promise.allSettled(
      API_MODULES.map(async (module) => {
        try {
          if (module.shutdown) await runtime.runPromise(module.shutdown());
        } catch (error: unknown) {
          console.warn(`[api] shutdown of module ${module.id} failed:`, error);
        }
      }),
    );
    try {
      await runtime.dispose();
      console.log("[api] runtime disposed");
    } catch (error: unknown) {
      console.error("[api] runtime dispose failed:", error);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

if (!env.isTest) {
  // Building the whole `AppLayer` here (configuration, the database acquire that awaits the
  // connection PRAGMAs of db/client.ts, the mailer and the rest) means a database that cannot be
  // opened at all fails at BOOT with a readable message instead of on the first request (plan e2
  // P18). Not done under `bun test`, where this module is imported for `app.fetch` and a
  // top-level await would serialise every test file behind it.
  await runtime.runPromise(Effect.void);
  for (const module of API_MODULES) {
    try {
      if (module.start) await runtime.runPromise(module.start());
    } catch (error) {
      console.error(`[api] start of module ${module.id} failed:`, error);
    }
  }
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
