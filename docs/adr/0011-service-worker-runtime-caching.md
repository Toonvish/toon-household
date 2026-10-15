# 0011: The service worker's runtime rules are the union of both sources' (refines D9, D13)

Date: 2026-10-15

## Context

SPEC D9 said "Service worker: `/api` and `/uploads` never cached; the `NetworkOnly` list is the
union of both sources' lists." `apps/web/vite.config.ts` does something narrower in one place and
wider in another. The navigation fallback (`navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//]`)
never serves the SPA shell for either path, which is the part of D9 that holds. Runtime caching,
however, keeps toon-recipe's own rules, which SPEC D13 makes binding inside the recipe module:
`NetworkFirst` into the cache `toon-api-recipes` (4 s timeout, 200 entries, 7 days, status 200
only) for `GET /api/households/<id>/recipe/(recipes|tags|collections)`, and `CacheFirst` into the
cache `toon-uploads` (120 entries, 30 days, status 200 only) for `GET /uploads/`, because the
signed upload URL is stable for a 12-hour window and the hero images are the one thing the
persisted TanStack cache cannot hold. Everything else under `/api` is `NetworkOnly`: `/api/auth/`,
the recipe `imports`, `shopping-lists`, `plan`, `/api/recipe/cards` and every finance path
(toon-recipe's rules 1 to 4 and toon-finance gotcha 11: the offline copy of those screens is the
persisted TanStack cache, the store the paused mutations live in, and a cached body would
overwrite the optimistic row). So "never cached" was false for two rule sets, and D13's
"the service-worker rules ... binding for the module that inherits them" and D9 pulled in
different directions.

## Decision

D9's sentence becomes: "`/api` and `/uploads` are never served by the navigation fallback; the
runtime rules are the union of both sources' (`NetworkOnly` first, then recipe's `NetworkFirst`
read cache for recipes, tags and collections, and `CacheFirst` for uploads, as toon-recipe has
them)." The order stays load-bearing: the first match wins, so every `NetworkOnly` rule precedes
the one `NetworkFirst` rule. `skipWaiting` stays off.

## Consequences

- A new module that wants an offline read cache for its own GET routes adds a `NetworkFirst`
  rule after every `NetworkOnly` one and declares the reason; a module whose screens are
  editable offline gets a `NetworkOnly` rule instead, like shopping lists and the ledger.
- Recipe, tag and collection reads may be answered from `toon-api-recipes` for up to seven days
  when the network is slow or down; that is the inherited toon-recipe behaviour, not a new one.
- No code changes. CLAUDE.md's "Service worker" gotcha already describes the rules as built.
