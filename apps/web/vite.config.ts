import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Service-worker runtime caching for READ-ONLY offline use.
 *
 * The TanStack Query cache persisted in IndexedDB (src/lib/persist.ts) is what
 * actually makes a screen render offline; these rules only cover what the query
 * cache cannot hold — the hero-image bytes — plus a network-first fallback for
 * recipe GETs so a flaky connection degrades instead of failing.
 *
 * FOUR RULES THAT MUST NOT BE RELAXED, each for a specific reason:
 *
 *  1. `/api/auth/*` IS NEVER CACHED. A cached `/api/auth/me` would let a signed-out
 *     or revoked session keep looking valid, and on a shared phone it is exactly the
 *     response that must never be answered from disk. `/api/auth/` is matched and
 *     excluded BEFORE the recipe rule, because a `NetworkOnly` rule that comes
 *     second would never be consulted.
 *  2. IMPORT ENDPOINTS ARE NEVER CACHED. They are uploads and OCR results, i.e.
 *     mutations and mid-edit state; a replayed one is a data-correctness bug.
 *  3. EVERY entry is `private`-safe and bounded. `expiration` caps keep a phone from
 *     filling up, and `cacheableResponse: { statuses: [200] }` keeps a 401 or a 403
 *     from being stored as if it were content.
 *  4. SHOPPING LISTS AND SAVED CARDS ARE NEVER CACHED HERE. Their offline copy is the persisted
 *     TanStack cache, which also holds the queued offline edits; a second, unaware
 *     cache layer would overwrite optimistic state with a stale body. See the rule.
 *
 * `/uploads/…` URLs now carry `?exp&sig` (see apps/api/src/lib/uploadUrls.ts). The
 * signature is stable for a 12-hour window, so cache entries do hit; when it rotates
 * the old entry simply ages out under `maxEntries`.
 */
const RUNTIME_CACHING = [
  {
    // Rule 1 — first, so nothing below can ever claim an auth request.
    urlPattern: /\/api\/auth\//,
    handler: "NetworkOnly" as const,
  },
  // Module rules, recipe (M2, SPEC D9): the union of both source apps' lists, in R's order, under
  // `/api/households/[^/]+/recipe/…` and `/api/recipe/cards`. Finance (M3) adds its own under
  // `/api/households/[^/]+/finance/…`.
  // Every NetworkOnly rule must precede any NetworkFirst rule: the first match wins, so a
  // NetworkOnly rule placed after a NetworkFirst one would never be consulted.
  {
    // Rule 2 — imports (upload + OCR + draft edits) are never replayed.
    urlPattern: /\/api\/households\/[^/]+\/recipe\/imports/,
    handler: "NetworkOnly" as const,
  },
  {
    /**
     * Rule 4 — SHOPPING LISTS ARE NEVER CACHED HERE, even though they are the most
     * offline-critical screen in the app. Their offline copy is the persisted TanStack
     * cache (src/lib/persist.ts), which is the same store the queued offline mutations
     * live in, so the two stay consistent by construction.
     *
     * A service-worker cache would actively BREAK that: a `NetworkFirst` hit would hand
     * TanStack a stale list body that looks like a fresh success, and `onSuccess` would
     * write it over the optimistic state — silently un-ticking items the user just
     * checked off. Must come before the recipes rule for the same reason rule 1 does.
     */
    urlPattern: /\/api\/households\/[^/]+\/recipe\/shopping-lists/,
    handler: "NetworkOnly" as const,
  },
  {
    // The meal planner — same rule as shopping lists, and for the same reason: its
    // offline copy is the persisted TanStack cache (now on the persist.ts allow-list
    // too), and a `NetworkFirst` hit here would hand it a stale week that looks like
    // a fresh success. Must come before the recipes rule below for the same reason
    // rule 1 does.
    urlPattern: /\/api\/households\/[^/]+\/recipe\/plan/,
    handler: "NetworkOnly" as const,
  },
  {
    /**
     * SAVED CARDS, same rule and same reason. `/api/recipe/cards` is the user's loyalty
     * barcodes, read at a till where there is often no signal — and its offline
     * copy is the persisted TanStack cache (src/lib/persist.ts), not this layer.
     * A `NetworkFirst` hit here would hand TanStack a stale wallet that looks
     * like a fresh success and overwrite the real one.
     */
    urlPattern: /\/api\/recipe\/cards/,
    handler: "NetworkOnly" as const,
  },
  {
    /**
     * FINANCE LEDGER, same rule as shopping lists and the planner (F gotcha 11): `/api/households/…/finance/…`
     * is never cached here. The offline copy of the ledger IS the persisted TanStack cache, the
     * same store the paused mutations live in. A `NetworkFirst` hit would hand TanStack a stale
     * body that looks like a fresh success, `onSuccess` would write it over the optimistic state,
     * and the booking just recorded would silently disappear. Must come before any NetworkFirst
     * rule below for the same reason rule 1 does.
     */
    urlPattern: /\/api\/households\/[^/]+\/finance\//,
    handler: "NetworkOnly" as const,
  },
  {
    // Recipes, tags, collections: fresh when there is a connection, cached when the
    // wifi in the kitchen gives up. The short timeout is what makes that feel fast
    // rather than like a hang.
    urlPattern: /\/api\/households\/[^/]+\/recipe\/(recipes|tags|collections)/,
    handler: "NetworkFirst" as const,
    method: "GET" as const,
    options: {
      cacheName: "toon-api-recipes",
      networkTimeoutSeconds: 4,
      expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
      cacheableResponse: { statuses: [200] },
    },
  },
  {
    // Hero images: bytes never change under a given signed URL, so cache-first is
    // both correct and the difference between a usable and an empty offline list.
    urlPattern: /\/uploads\//,
    handler: "CacheFirst" as const,
    method: "GET" as const,
    options: {
      cacheName: "toon-uploads",
      expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 },
      cacheableResponse: { statuses: [200] },
    },
  },
];

/**
 * Vite config for @toon/web.
 *
 *  - `envDir: "../../"`               -> the single .env lives in the monorepo root,
 *  - `envPrefix: ["VITE_","PUBLIC_"]` -> `import.meta.env.PUBLIC_API_URL` is inlined,
 *  - `@/*` + `@toon/shared` aliases mirror apps/web/tsconfig.json (paths, no baseUrl — TS 7),
 *
 * This file is type-checked by apps/web/tsconfig.node.json, NOT by tsconfig.json: it runs
 * under Node, and its `node:url` / `vite` imports drag @types/node into whatever program
 * holds it — which, while it sat in tsconfig.json, made `process.env` legal in every
 * component.
 *
 *  - `server.proxy` forwards `/api` and `/uploads` to the API so the app can also be
 *    run same-origin in dev (set `PUBLIC_API_URL=""` in .env). With the default
 *    `PUBLIC_API_URL=http://localhost:3001` the browser talks to the API directly;
 *    that works because the API sends `Access-Control-Allow-Credentials: true` +
 *    `Access-Control-Allow-Origin: <WEB_ORIGIN>` and `localhost:5173`/`localhost:3001`
 *    are the same *site*, so the `SameSite=Lax` session cookie is still sent.
 *  - `VitePWA` generates the service worker + web manifest. The precache/navigation
 *    fallback NEVER covers `/api` or `/uploads` (see navigateFallbackDenylist), so a
 *    stale worker can never answer an API call or hide an upload.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here("../../"), ["VITE_", "PUBLIC_", "API_"]);
  const apiTarget =
    env.PUBLIC_API_URL || env.VITE_API_URL || `http://localhost:${env.API_PORT || "3001"}`;
  const proxy = {
    "/api": { target: apiTarget, changeOrigin: false, secure: false },
    "/uploads": { target: apiTarget, changeOrigin: false, secure: false },
  } as const;

  return {
    root: here("."),
    envDir: "../../",
    envPrefix: ["VITE_", "PUBLIC_"],
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        strategies: "generateSW",
        registerType: "autoUpdate",
        // src/lib/pwa.ts registers `/sw.js` itself (production only, so a worker never
        // sits in front of the dev server and breaks HMR).
        injectRegister: false,
        filename: "sw.js",
        manifest: {
          id: "/",
          name: "Haushalt",
          short_name: "Haushalt",
          lang: "de",
          dir: "ltr",
          start_url: "/",
          scope: "/",
          display: "standalone",
          display_override: ["standalone", "minimal-ui"],
          orientation: "any",
          background_color: "#faf5ee",
          theme_color: "#c2532c",
          categories: ["lifestyle", "productivity"],
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            {
              src: "/icons/maskable-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "/icons/maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          // App shell: hashed build output + icons. Source maps stay out of the cache.
          //
          // `wasm` IS DELIBERATELY ABSENT. The only wasm in the bundle is
          // zxing-wasm's barcode reader (~1.1 MB), used exclusively by the card
          // scanner — a once-per-card action performed at home. Precaching it
          // would add a megabyte to every install and every update to save a
          // download almost nobody makes twice, and it would be caching the ONE
          // part of the cards feature that legitimately needs a connection.
          // Drawing a saved card is pure JS in the main bundle (see
          // packages/shared/src/barcode.ts), so the till path stays offline-proof
          // either way. Adding "wasm" here is a real decision, not a typo fix.
          //
          // `woff2` IS PRESENT and `wasm` is not, for opposite reasons. The four font
          // files total ~55 KB, are needed by EVERY screen, and are needed OFFLINE —
          // an unavailable webfont reflows the shopping list at the till. zxing-wasm is
          // 1.1 MB, is needed by one screen, once per card, at home, with a connection.
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff2}"],
          globIgnores: ["**/*.map"],
          navigateFallback: "/index.html",
          // NEVER serve the SPA shell for API calls or uploads. Unchanged, and it
          // must stay that way whatever runtimeCaching below does.
          navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
          navigationPreload: false,
          cleanupOutdatedCaches: true,
          // Claims the page on FIRST install, so offline works without a reload. Its
          // precache is the same version as the running document, so nothing mismatches.
          clientsClaim: true,
          /**
           * skipWaiting is OFF, and that is the whole update story.
           *
           * With it on, a new worker activates the instant it installs and claims a
           * document that is still running the OLD bundle. This app is code-split
           * (lib/lazy-page.tsx), so the next route the user opens asks the NEW precache
           * for an OLD `assets/Page-<hash>.js` that no longer exists — a lazy-import
           * failure into the ErrorBoundary. `cleanupOutdatedCaches` deletes the old
           * precache on activate, which is exactly when that starts happening.
           *
           * So the new worker WAITS, and `lib/pwa.ts` decides when to let it through:
           * immediately when nothing is unsaved, otherwise when the user taps the
           * UpdateBanner. Activation and the reload then happen together.
           */
          skipWaiting: false,
          runtimeCaching: RUNTIME_CACHING,
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: {
      alias: {
        "@": here("./src"),
        "@toon/shared": here("../../packages/shared/src/index.ts"),
      },
    },
    server: { port: 5173, host: true, proxy },
    preview: { port: 4173, host: true, proxy },
    // sourcemap: false — `true` shipped 86 *.js.map files (5.0 MB of dist/assets)
    // next to the bundle, so anyone with the deployed URL could read the entire
    // TypeScript client source. Use "hidden" plus an upload step if you add error
    // reporting later.
    build: { target: "es2022", sourcemap: false },
  };
});
