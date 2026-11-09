# 0017: A public module route for the calendar's subscription feed (extends D4, D8; SPEC §2)

Date: 2026-11-09

Status: accepted and built (M9, `docs/plans/m9-calendar-feed.md` P2, P3, P4, P15; lane api M9-T02 to M9-T05, merged
and integrated on `main` by M9-T08 on 2026-11-09; the rate limit moved after the lookup by the M9-T09 review).

## Context

The owner wants a household member to subscribe their phone calendar (iOS Calendar, Android through ICSx5 or Google
Calendar, Samsung Calendar, Outlook, macOS) to the household calendar: one way, read only. A subscribed calendar is a
client the app does not control. It fetches a URL on its own schedule, sends no cookie and cannot log in, so the feed
cannot sit behind a session.

The module contract had no shape for such a route. SPEC §2 gave a module two HTTP contributions: `householdApi`
(behind `ApiErrorBoundary` → `RequireSession` → `RequireHouseholdMember` → `RequireModule`, asserted by
`moduleRoutesLayer`) and `userApi` (runs `RequireSession` itself). D8 named only those two mounts, and D4 named the
signed `/uploads` URLs as the one credential that is not a session. There is precedent for that kind of credential:
`/uploads/:filename` answers a signed URL with no cookie (`apps/api/src/lib/uploadUrls.ts`). The URL carries its own
authority, and anything else is a `404`.

## Decision

- **§2: `ApiModule.publicApi?: ModuleHttpApi`.** Its routes are served at `/api/<id>/feed/…` behind `ApiErrorBoundary`
  ONLY: no session middleware, no cookie read; the URL is the credential. A public API is built with
  `publicModuleApi(id, api)` (`apps/api/src/http/middleware.ts`: prefix `/api/<id>`, `chain(ApiErrorBoundary)`).
  `moduleRoutesLayer` (`apps/api/src/modules/mount.ts`) asserts at layer build that every public endpoint's
  middleware set is exactly `{ ApiErrorBoundary }`, its method is `GET` (`HEAD` reaches it through the router's
  `HEAD` → `GET` fallback) and its path lies below `/api/<id>/feed/`. A violation is the same `Effect.die` naming
  the module and the endpoint as for the other two contributions. There is no catch-all for it, so an unknown path
  falls to the global JSON `404`. `assertUserApis` also refuses a user path below `/api/<id>/feed/`, so that prefix
  holds public routes only. `httpApiRoutes()` lists each module's public APIs after its household and user APIs.
- **D8:** public module routes (no session; a capability URL like the signed `/uploads` URLs) mount under
  `/api/<module>/feed/…`. The calendar's subscription feed `GET /api/calendar/feed/:file` (`:file` =
  `<token>.ics`) is the one public route.
- **D4:** beside the signed `/uploads` URLs, the calendar's feed tokens are the second credential that is not a
  session. A token is 32 random bytes from `crypto.getRandomValues` in base64url (43 characters). Only its
  SHA-256 hex is stored (`calendar_feed_tokens.token_hash`, unique), and the lookup is by hash. A token is created or
  replaced by its owner, a verified household member, through the household-scoped management routes, and only the
  `201` of that `POST` carries it.
- **One answer for every refusal.** A malformed, unknown, replaced or revoked token, a token whose user is no longer a
  member of its household, and a household with the calendar disabled all answer the same `404 not_found` with the
  generic body. The feed never says which. A rate limit per token hash (60 fetches per hour, `429 rate_limited`
  with `Retry-After`) runs after the row lookup, so only a stored token gets a bucket (M9-T09 review: before the
  lookup, a flood of guessed tokens grew the process-wide limiter store without bound).
- **The token never reaches a log** (P15). `logPathOf(url)` (`apps/api/src/http/request.ts`) reduces every path below
  `/api/<id>/feed/` to `/api/<id>/feed/<redacted>[.ics]`. The request log (`apps/api/src/middleware/requestLog.ts`)
  and the boundary's failure log (`errorResponse` in `apps/api/src/http/response.ts`) print that path, never the
  raw one. `docker/Caddyfile` keeps no `log` directive (no access log at the proxy).
  `apps/api/test/deploy-caddyfile.test.ts` pins its absence and `apps/api/test/modules-public.test.ts` pins both
  log lines.

## Threat model

- **A leaked link** reads ONE household's calendar, within the link's scope (`all` or `mine`), until its owner
  replaces it (`POST` again: the old token dies at once) or ends it (`DELETE`). A member who leaves the household
  loses the link: the member-removal hook deletes the row, and the feed also re-checks the membership on every
  fetch. Deleting the account or the household cascades. The link cannot write, cannot open a session, and reveals
  nothing outside the household's calendar entries (names of the people an entry names, car names, the household's
  name in `X-WR-CALNAME`).
- **Guessing** a 256-bit token is not feasible. The lookup is by hash through a unique index, so no secret is
  compared in application code, and the per-token-hash rate limit caps the fetches of one real link (a guess costs one indexed lookup and opens no bucket).
- **Logs** never carry the token (above). The `404` body of an UNKNOWN route, served by the global fallback,
  repeats the path to whoever requested it, and only to them. Outside production that fallback also writes a
  development-only `console.warn` with the route-unknown message, for example on a `POST` to a feed URL. Production
  writes no 4xx line.
- **Caches.** The feed answers `Cache-Control: private, max-age=300`, so a shared cache does not keep it. The web
  app's service worker never caches `/api/calendar/feed/…` (no runtime rule matches it, and `/api` is outside the
  navigation fallback, ADR 0011).

## Consequences

- SPEC §2 (the interface and one rule bullet), D4 and D8 name the public contribution and the feed token (edited in
  the commit that lands this ADR).
- A future public module route goes below `/api/<id>/feed/` (or this ADR is amended with the new prefix, because
  `logPathOf` redacts only that one). Before it goes there, its URL must carry nothing that a log line should keep.
- `apps/api/test/modules-public.test.ts` pins the build assertions, the cookie-free serving and the redaction.
  `apps/api/test/calendar-feed-routes.test.ts` (M9-T05) pins the feed's answers.
