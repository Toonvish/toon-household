# M9 — calendar feed: plan

**Status: M9-T01 done on `main`; lanes api and web next.** Base commit `e307a64c0` (`M8-ui: UI check record (plan 9.7) and the
screenshots in both schemes`). Sections 9 and 10 (the integration record and "what changed vs plan") are written by M9-T08 and M9-T09.

M9 lets a household member subscribe their phone calendar (iOS Calendar, Android through ICSx5 or Google Calendar, Samsung Calendar
through either, Outlook, macOS) to the household calendar: one way, read only. It replaces the feed half of `docs/open-work.md` X-10
(ICS IMPORT stays deferred). THE SPEC is the feature as decided with the owner (the task text of this run, restated as the decisions of
section 2), `docs/modules/calendar.md` (section 7 is the feed's DESIGN, rewritten as built at M9-T08) and ADR 0016; the fixed decisions
are `docs/SPEC.md` §1 (D1-D15) and `docs/EFFECT.md` §1 (E1-E12). The one deviation the feature forces is a module route without a
session, recorded as ADR 0017 (`docs/adr/0017-calendar-feed.md`, written by M9-T02 with the SPEC edits in the same commit).

Exit: the gates green on the merged tree (`bun install --frozen-lockfile`, `bun run typecheck`, `bun test` with the pass count above
the baseline and 0 fail, `bun run build`, `bun run i18n:check` with the PARITY half OK and the leftover half still exactly the 148
classified false positives, `git status --porcelain repos/` empty); every new route with a `docs/API.md` row; the ICS writer's unit
tests (folding, escaping, VTIMEZONE, all-day, multi-day, timed with `TZID`, UID stability); the feed route's refusals all one `404`;
the token in no log line; the management routes in the cross-household sweep and the web contract test; a headless pass of the new
screen at 390 and 1440; the docs as built.

## 1. Context

### 1.1 Baseline (HEAD `e307a64c0`)

`bun run typecheck` OK; `bun test` 15697 pass, 1 skip, 0 fail in 216 files; `bun run i18n:check` exits 1 by design with 148 classified
leftover-German false positives (none in the calendar) and the parity half OK.

### 1.2 What exists that the feed plugs into

- The occurrence expansion: `CalendarOccurrences.list` (`apps/api/src/modules/calendar/services/entries/occurrences.service.ts`) over
  `expandOccurrences` (`packages/shared/src/modules/calendar/recurrence.ts`) and the row helpers of
  `apps/api/src/modules/calendar/services/entries/rows.ts` (`loadEntryRecords`, `toOccurrenceDto`, `assigneeFor`, the P10 sort and the
  P10 `memberId` filter, the 400-day and 2000-occurrence caps).
- The module contract `apps/api/src/modules/types.ts` (`householdApi`, `userApi`), `apps/api/src/modules/mount.ts` (asserts the four
  outermost middlewares of a household API, the prefix of a user API), `apps/api/src/http/middleware.ts` (`householdModuleApi`,
  `userModuleApi`, `chain`), `apps/api/src/http/app.ts` (`httpApiRoutes()`, which `apps/api/test/api-doc.test.ts` reads).
- The capability-URL precedent: the signed `/uploads/:filename` URLs (`apps/api/src/lib/uploadUrls.ts`, SPEC D4): a URL that carries its
  own authority, no cookie.
- The request log `apps/api/src/middleware/requestLog.ts` (logs the PATHNAME, never the query) and `logBoundaryFailure`
  (`apps/api/src/lib/errors.ts`, called from `errorResponse` in `apps/api/src/http/response.ts` with `pathOf(request.originalUrl)`).
  `docker/Caddyfile` has no `log` directive (no access log).
- `RateLimiter` (`apps/api/src/core/services/auth/rateLimit.ts`): `check(key, rule)` always records, `enforce(...)` is a no-op under
  `NODE_ENV=test`.
- `users.locale` (`apps/api/src/db/schema/core.ts`: the account's interface locale, NULL = never chosen) and `AppConfig.defaultLocale`.
- The claim links' origin rule: `config.webOrigins[0]` (`apps/api/src/core/services/households/invites.service.ts`).

### 1.3 Model code to read before writing

API: `apps/api/src/modules/calendar/{index,layer,hooks}.ts`, `apps/api/src/modules/calendar/routes/{index,core.index,occurrences.api,
occurrences}.ts`, `apps/api/src/modules/calendar/services/entries/{layer,occurrences.service,rows}.ts`,
`apps/api/src/modules/calendar/services/waste/waste.service.ts` (a service over `RateLimiter`), `apps/api/src/modules/calendar/seed.ts`
(the Clock's date in Europe/Berlin), `apps/api/test/support/calendar-harness.ts`, `apps/api/test/calendar-occurrences.test.ts`,
`apps/api/test/rate-limiter.test.ts`. Web: `apps/web/src/modules/calendar/{index.ts,routes.tsx}`,
`apps/web/src/modules/calendar/lib/{api,queries}.ts`, `apps/web/src/modules/calendar/features/cars/` and `features/waste/` (screens with
a `CalendarPageHeader`, a form, a confirm), `apps/web/src/lib/share.ts` (`copyToClipboard`), `apps/web/src/components/ui/`.

## 2. Decisions (binding for the tasks)

**P1 — Lanes and branches.** M9-T01 runs alone on `main` and ends green. Then two lanes in git worktrees branched from the T01 tip:
`m9/api` (`../toon-household-m9-api`) and `m9/web` (`../toon-household-m9-web`); each runs `bun install --frozen-lockfile` once
(background, log ending `exit=$?`). Integration (M9-T08) merges with `git merge --no-ff`, api first. A lane never edits a file the other
owns (section 3); the shared contract is T01's (section 5) and changes only through integration.

**P2 — The module contract gains `publicApi` (ADR 0017).** `ApiModule.publicApi?: ModuleHttpApi`: routes served at `/api/<id>/feed/…`
with NO session middleware; the URL itself is the credential. Built with a new `publicModuleApi(id, api)` in
`apps/api/src/http/middleware.ts` (prefix `/api/<id>`, `chain(ApiErrorBoundary)`, nothing else). `moduleRoutesLayer` gains
`assertPublicApis`: every endpoint's middleware set is EXACTLY `{ ApiErrorBoundary }` (a cookie is never read), the method is `GET`
(`HEAD` reaches it through the router's `HEAD` → `GET` fallback), the path lies below `/api/<id>/feed/`; a violation is the same
`Effect.die(wiringDefect(...))`. No catch-all for it (an unknown path falls to the global JSON 404). `assertUserApis` additionally refuses
a user path below `/api/<id>/feed/` (so the log redaction of P15 never hides a session route). `httpApiRoutes()` lists the public APIs
after each module's household and user APIs. ADR 0017 edits SPEC §2 (the interface: `publicApi?: ModuleHttpApi  // served at
/api/<id>/feed/… behind ApiErrorBoundary only; the URL is the credential (ADR 0017)`, and one rule bullet), D8 (a sentence: "Public
module routes (no session; a capability URL like the signed `/uploads` URLs) mount under `/api/<module>/feed/…`; the calendar's
subscription feed is the one (ADR 0017).") and D4 (the signed `/uploads` URLs "and the calendar's feed tokens"). It names the precedent
(signed uploads), the threat model (a leaked link reads one household's calendar until replaced; rotation and revocation; no write), the
Caddyfile without access log and the redaction of P15.

**P3 — The token.** 32 bytes from `crypto.getRandomValues`, base64url without padding (43 characters, `CALENDAR_FEED_LIMITS.tokenBytes` /
`.tokenLength`); the URL's last segment is `<token>.ics` (`CALENDAR_FEED_FILE_PATTERN`). The database stores only `sha256(token)` as 64
lower-case hex (`calendar_feed_tokens.token_hash`, unique index: the lookup is by hash, so no constant-time compare is needed). The token
is never stored, never logged, and returned only in the `201` of `POST …/calendar/feed`.

**P4 — Lookup and refusals.** Order in the feed route: `:file` against `CALENDAR_FEED_FILE_PATTERN` → hash → rate limit (P5) → row by
`token_hash` → the row's user is still a member of the row's household (`household_members`) → the household has the calendar enabled
(a `household_modules` row; read through the core's `HouseholdModules` service or the table) → render. EVERY refusal (malformed,
unknown, replaced or revoked token, a former member, the module disabled) is `new NotFound()`: `404 not_found` with the one generic
body `server.error.notFound`, never naming the reason. The rate limit runs before the lookup, so an unknown token consumes its bucket too.

**P5 — Rate limit.** 60 fetches per token and hour (`CALENDAR_FEED_LIMITS.fetchesPerHour`, rule `{ limit: 60, windowMs: 3_600_000 }`),
key `calendar-feed:<token_hash>`, through `RateLimiter.check` and `return yield* new RateLimited({ retryAfterSeconds })` when refused
(`429 rate_limited` with `Retry-After`). `check`, not `enforce`: `enforce` is off under `NODE_ENV=test`, and a key per token hash is
unique per test, so the always-on `check` is deterministic and lets the route test prove the 429 (a recorded difference to the
waste import, which uses `enforce`). A `304` counts as a fetch.

**P6 — The response.** `200`, `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: inline; filename="haushalt.ics"`,
`Cache-Control: private, max-age=300`, a STRONG `ETag` = `"` + sha256 hex of the body + `"`. `If-None-Match` (a comma list, or `*`)
matching it answers `304` with `ETag` and `Cache-Control` and no body. `HEAD` runs the same handler through the router fallback (the
server drops the body). The global security headers and CORS apply as to every response.

**P7 — `last_used_at`.** Written when it is NULL or at least `CALENDAR_FEED_LIMITS.lastUsedResolutionMs` (1 h) older than the Clock's
now; never once per fetch. A `304` is a use. GET and PATCH answer it as ISO (`lastUsedAt`), the web's proof that a phone subscribed.

**P8 — The window and the server's today (a recorded exception).** today = the Clock's date in `Europe/Berlin`
(`DateTime.formatIsoDate(DateTime.makeZonedUnsafe(yield* DateTime.now, { timeZone: CALENDAR_FEED_LIMITS.timeZone }))`, as the seed
does); window `[today - 30, today + 365]` (396 days, below the 400-day cap). This is the one exception to "The server never decides
today" (`docs/modules/calendar.md` §1.2 and its gotcha get the exception at M9-T08): a subscribed calendar has no client to send a
date. No `Date` (idioms (11), (19)); tests drive it with a `TestClock` at the service level. One entry yields at most 396 occurrences
in the window, so `calendar_range_too_large` cannot occur; should it, the feed dies (`Effect.orDie`), a 500 that logs.

**P9 — Reuse of the occurrence logic.** `CalendarOccurrences` gains `expand(householdId, query)` →
`{ items: Array<{ occurrence: CalendarOccurrence; entry: EntryRecord }>, members }` (the same expansion, states, caps, P10 filter and
P10 order) and `list` becomes `expand` mapped to `{ items: occurrences, members }`: behaviour unchanged, pinned by the existing
occurrence tests. The feed reads `expand(householdId, { from, to })` for scope `all` and `expand(householdId, { from, to, memberId:
userId })` for `mine`: the P10 `memberId` rule IS the owner's rule (naming nobody = for everybody: an event without attendees, an
unassigned task, an unassigned waste pickup; else I am an attendee, the person of a car booking, or the assignee OF THAT OCCURRENCE with
the rotation resolved). Skipped occurrences are dropped after the expansion; done ones are marked (P12).

**P10 — Locale.** The feed has no `Accept-Language` from a person: it renders in the token user's `users.locale` when it is a `Locale`,
else `AppConfig.defaultLocale` (German unless the deployment says otherwise). Content (titles, notes, names, car names, the household's
name) is never translated.

**P11 — The ICS writer** (`apps/api/src/modules/calendar/services/feed/ics.ts`, pure, no Effect): `icsText(value)` escapes `\` → `\\`,
`;` → `\;`, `,` → `\,`, a line break (`\r\n`, `\n`, `\r`) → `\n`; `foldLine(line)` folds at 75 OCTETS of UTF-8 (the first line 75, every
continuation line a leading space plus at most 74), never inside a UTF-8 sequence; every line ends in CRLF, the file too.
`VCALENDAR`: `VERSION:2.0`, `PRODID:-//toon-household//Kalender//DE`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`, `X-WR-CALNAME`,
`X-WR-TIMEZONE:Europe/Berlin`, `REFRESH-INTERVAL;VALUE=DURATION:PT1H`, `X-PUBLISHED-TTL:PT1H`, then a static `VTIMEZONE` for
Europe/Berlin (`TZID:Europe/Berlin`; `DAYLIGHT` +0100 → +0200 `CEST` `DTSTART:19700329T020000` `RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU`;
`STANDARD` +0200 → +0100 `CET` `DTSTART:19701025T030000` `RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU`), then one `VEVENT` per occurrence,
in the P10 order: `UID:<entryId>-<date>@toon-household`; `DTSTAMP` and `LAST-MODIFIED` = the entry's `updated_at` in UTC
(`YYYYMMDDTHHMMSSZ`, formatted from the unix ms through `DateTime`, never `new Date(`), so an unchanged calendar gives the same bytes
and the same ETag; all-day: `DTSTART;VALUE=DATE:<date>` and `DTEND;VALUE=DATE:<endDate + 1>` (exclusive, multi-day correct); timed:
`DTSTART;TZID=Europe/Berlin:<date>T<HHMM>00` and, with an end time, `DTEND;TZID=Europe/Berlin:<endDate>T<HHMM>00`; WITHOUT an end
time no `DTEND` (RFC 5545 §3.6.1: the event ends at its start; the app shows only the start too); `TRANSP:TRANSPARENT` for an all-day
task (waste pickups are all-day tasks), `OPAQUE` otherwise; `SUMMARY`, `DESCRIPTION` (P12), `LOCATION` when the entry has one; no RRULE
(the occurrences are expanded).

**P12 — Summary and description** (`apps/api/src/modules/calendar/services/feed/vevent.ts`, pure: occurrence + entry + names + car
names + locale → the event's fields), German through the server catalog `server.calendar.feed.*` (T01, section 5.3):
- event: `SUMMARY` = title; `DESCRIPTION` "Für: Alle" (no attendee) or "Für: <names>".
- task: `SUMMARY` = title, plus `withPeople` " · <assignee>" when the occurrence has one; done → `done` "✓ <summary>";
  `DESCRIPTION` "Zuständig: <name>" when assigned.
- car booking: `SUMMARY` = `carSummary` "<car>: <title or carDefaultTitle>", plus " · <person(s)>"; `DESCRIPTION` "Auto: <car>",
  "Für: <names>". A car name the household no longer lists (it cannot happen: cars are archived, never deleted while booked) is
  `unknownCar`.
- waste pickup: `SUMMARY` = `waste.<category>` (`waste.withCleaning` for `bio_cleaning`), done → "✓ …"; `DESCRIPTION` "Zuständig: <name>"
  when assigned.
- A user id that is no household member any more renders `formerMember`. Names are joined with ", ". `DESCRIPTION` = the people and car
  lines, then an empty line and the entry's notes when it has any.
- `X-WR-CALNAME` = `calendarName` "Haushalt · <household name>", scope `mine` `calendarNameMine` "Haushalt · <name> (meine Termine)".

**P13 — Management.** Group `calendar.feed` under `householdModuleApi("calendar", …)` with `chain(RequireVerifiedEmail)` (reads pass,
writes need a confirmed account), the caller's OWN link only (`CurrentMembership` `householdId` + `userId`):
`GET …/calendar/feed` → `200 CalendarFeedResponse` (`{ feed: null }` without one; never the token);
`POST …/calendar/feed` `CreateCalendarFeedRequest` → `201 CalendarFeedCreatedResponse` (creates, or REPLACES in ONE upsert on
`(household_id, user_id)`: new id, hash, scope, `created_at` from the Clock, `last_used_at` NULL; the old token dies at once);
`url` = `config.webOrigins[0]` + `CALENDAR_FEED_PATH_PREFIX` + token + `.ics`;
`PATCH …/calendar/feed` `UpdateCalendarFeedRequest` → `200 CalendarFeedResponse` (token unchanged), `404 not_found` without a link;
`DELETE …/calendar/feed` → `204`, idempotent. Services: `CalendarFeedTokens` (`get`, `create`, `updateScope`, `remove`, `resolve(token)`
for the feed: the P4 checks, `touch` for P7) in `services/feed/tokens.service.ts`; `CalendarFeed` (`render(resolved)` → `{ body, etag }`)
in `services/feed/feed.service.ts`; the area `services/feed/layer.ts` (`calendarFeedAreaLayer()`) sits in an OUTER `provideMerge` step
of `calendarLayer()` over the entries and waste areas (it yields `CalendarOccurrences`, `CalendarResources`, `CalendarMembers`).

**P14 — Hook.** `calendarOnMemberRemoving` deletes the leaver's `calendar_feed_tokens` row of that household (first statement; no
veto). Account deletion and household deletion cascade.

**P15 — The token never reaches a log.** `apps/api/src/http/request.ts` gains `logPathOf(url)`: `pathOf(url)` with every path below
`/api/<id>/feed/` reduced to `/api/<id>/feed/<redacted>.ics` (the last segment replaced; `.ics` kept only when present). It needs no
module import: P2 makes "below `/api/<id>/feed/`" the place of every public route. `requestLogMiddleware` and `errorResponse`'s
`logBoundaryFailure` call use it. A test pins both lines; `apps/api/test/deploy-caddyfile.test.ts` gains "no `log` directive" so the
proxy never writes an access log with the token. (The JSON 404 body of an UNKNOWN route echoes the path to its own requester only.)

**P16 — Web screen.** `/calendar/feed` "Kalender-Abo", sidebar-only (third `secondaryNavItems` entry after Autos and Müllabfuhr, key
`calendar.nav.feed`), reachable from Übersicht (a link in the rail from `lg` and in the phone list below the Today card). It renders
`CalendarPageHeader` (`PhoneHeaderRow`) without a header action. States: no link (one paragraph, scope choice Alle Termine des Haushalts
/ Nur meine Termine, "Link erstellen"); just created (the URL read-only with "Kopieren" via `copyToClipboard`, the prominent
"Mit iPhone-Kalender verbinden" `<a href={webcalUrl(url)}>`, setup per platform ordered by `navigator.userAgent`: iPhone/iPad,
Android (ICSx5 from the Play Store and F-Droid; refresh interval selectable; Samsung Kalender and Google Kalender then show it), Google
Kalender on the web (calendar.google.com > Weitere Kalender + > Per URL; Google refreshes only every few hours), Outlook/Mac one line;
the note that the link is personal and works without a password); existing link (scope changeable, created, "Zuletzt abgerufen: …" or
"Noch nicht abgerufen", "Neuen Link erzeugen" with a confirm that the old link stops working on every device, "Abo beenden" with a
confirm). The URL lives in component state only (the POST answer); it is never written to the query cache. Pure helpers:
`features/feed/lib/platforms.ts` (`feedPlatformOrder(userAgent)`: `ios` first on iPhone/iPad (an iPad reporting a Mac UA with touch
counts as desktop: no `navigator` read inside the helper), `android` first on Android, else the desktop order) and
`features/feed/lib/webcal.ts` (`webcalUrl(url)`: `https://` / `http://` → `webcal://`, host and path kept).

**P17 — Web data layer.** `CalendarApi.fetchFeed(householdId)` (`getJson(CalendarFeedResponseSchema)`), `createFeed(householdId, body)`
(`sendJson` → `CalendarFeedCreatedResponseSchema`), `updateFeed(householdId, body)` (→ `CalendarFeedResponseSchema`),
`deleteFeed(householdId)` (`sendVoid`), each with its Promise facade; paths through `calendarPath(householdId, "feed")`.
`calendarKeys.feed(h)` = `["toon","household",h,"calendar","feed"]`, NOT in `persistQueryAllowList` (`lastUsedAt` must be live, and the
screen needs the network anyway); writes behind `useOfflineGuard`, each invalidating `calendarKeys.feed(h)`. The app never fetches the
feed itself.

**P18 — Service worker.** No change expected: `/api/calendar/feed/…` matches no runtime rule of `apps/web/vite.config.ts` (the
calendar's `NetworkOnly` rule is household-scoped; the one `NetworkFirst` rule is recipe's) and `/api` is outside the navigation
fallback, so it is never cached. The web lane confirms by reading the file and records it; an edit would need ADR 0011's order.

**P19 — i18n.** Server keys `server.calendar.feed.*` (T01) and web keys `calendar.feed.*` plus `calendar.nav.feed` are new German,
admitted by `NEW_GERMAN_NAMESPACES` (ADR 0016); natural, short, the app's du-tone. No seed data for the feed (a token is a credential).

## 3. Lanes and file ownership

### 3.1 M9-T01 (on `main`, alone, first; done)

`packages/shared/src/modules/calendar/{limits,index}.ts`, `packages/shared/src/modules/calendar/schemas/feed.ts`,
`packages/shared/test/calendar-schemas.test.ts`, `packages/shared/src/core/i18n/catalogs/server.{de,en}.ts` (the feed block; the api lane
may add `server.calendar.feed.*` keys directly below it), `apps/api/src/modules/calendar/schema.ts`, `apps/api/src/db/schema.ts` (header),
`apps/api/drizzle/0005_calendar_feed.sql` + meta, `apps/api/test/{db-calendar-feed-migration,db-calendar-migration,calendar-module}.test.ts`,
`docs/API.md` "Tables" of the calendar section, this plan, `docs/modules/calendar.md` section 7 (design).

### 3.2 Lane api (`m9/api`)

Owns: `apps/api/src/modules/{types,mount}.ts`, `apps/api/src/http/{middleware,request,response,app}.ts`,
`apps/api/src/middleware/requestLog.ts`, `apps/api/src/modules/calendar/**` except `schema.ts`, every new or touched `apps/api/test/*`
file of section 4 (incl. `calendar-module`, `calendar-cross-household`, `api-doc`, `modules`, `deploy-caddyfile`), `docs/API.md` (a new
calendar subsection "Subscription feed", the "Middleware chain and mount order" note on public module routes, the `not_found` and
`rate_limited` "Raised by" cells), `docs/adr/0017-calendar-feed.md`, `docs/SPEC.md` (§2, D4, D8 per ADR 0017).

### 3.3 Lane web (`m9/web`)

Owns everything under `apps/web/src/modules/calendar/` (incl. `index.ts`, `routes.tsx`, the manifest and persist tests, the catalogs).
Reads `apps/web/vite.config.ts` (P18) without editing it.

### 3.4 Integration (M9-T08, M9-T09, on `main`)

`apps/api/test/web-contract-calendar.test.ts`, `docs/modules/calendar.md` (as built), `CLAUDE.md`, `docs/open-work.md` (X-10 split:
the feed done, ICS import stays), ADR 0017's status line, this plan's sections 9 and 10, any review fix (its own commit).

## 4. Tasks

Every task: read CLAUDE.md "Conventions" and "Gotchas in use", `docs/modules/calendar.md` whole (section 7 is the feed), this plan's
sections 2 and 5; before Effect code `repos/effect/LLMS.md` (whole, once per session) and the pattern files the task names. Commit per
task (more commits are fine), the message naming the task id and ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
never push; `git status --porcelain repos/` empty after every task; long commands in the background with a log ending `exit=$?`, read
from the log. Never relax a test or gate to get green.

### M9-T01 — Shared contract, table, migration, catalog keys (main; done)

Did: the six schemas of section 5.1 with their ok and not-ok cases (the M8 P22 guard), `CALENDAR_FEED_LIMITS`,
`CALENDAR_FEED_PATH_PREFIX`, `CALENDAR_FEED_FILE_PATTERN`; no new error code (`not_found`, `rate_limited` serve); the server keys of
section 5.3 (de, en); `calendar_feed_tokens` in `schema.ts` and the GENERATED `0005_calendar_feed.sql`
(`cd apps/api && bunx drizzle-kit generate --name calendar_feed`); `apps/api/test/db-calendar-feed-migration.test.ts`; the table lists of
`db-calendar-migration.test.ts` and `calendar-module.test.ts` name the eighth table; this plan; the design section.
Verify: `bun run typecheck`; `bun test packages/shared/test/calendar-schemas.test.ts packages/shared/test/schema-golden-coverage.test.ts
apps/api/test/db-calendar-feed-migration.test.ts apps/api/test/db-calendar-migration.test.ts apps/api/test/calendar-module.test.ts`;
`(cd apps/api && bunx drizzle-kit generate --name m9_drift_check 2>&1 | grep -c 'No schema changes')` prints 1; full `bun test`.

### Lane api

Read first: `agent-patterns/effect-http-api.md`, `agent-patterns/effect-services.md`, `agent-patterns/effect-datetime-clock.md`,
`agent-patterns/effect-testing.md`, `agent-patterns/effect-errors.md`; `repos/effect/packages/effect/HTTPAPI.md` (endpoints, raw
responses), `repos/effect/packages/effect/src/http/HttpServerResponse.ts` (`text`, `empty`, headers), `repos/effect/packages/effect/src/DateTime.ts`;
the model files of section 1.3; `apps/api/test/{modules,middleware,http-foundation,calendar-occurrences,calendar-cross-household,
rate-limiter,deploy-caddyfile}.test.ts`.

#### M9-T02 — The contract extension, the log redaction, ADR 0017

1. P2 in `types.ts`, `middleware.ts` (`publicModuleApi`), `mount.ts` (`assertPublicApis`, the user-path rule, `moduleLayer` registers a
   module's `publicApi`), `app.ts` (`moduleApis()` adds `publicApi`).
2. P15: `logPathOf` in `request.ts`; `requestLog.ts` and `response.ts` use it.
3. `docs/adr/0017-calendar-feed.md` (date, context, decision, consequences) and in the SAME commit `docs/SPEC.md` §2, D4, D8.
4. Tests: the mount assertions (a public endpoint with `RequireSession`, one with a second middleware, one outside `/api/<id>/feed/`, a
   `POST`, a user path below `feed/`: each dies naming the rule; a good one builds) beside the household cases of
   `apps/api/test/modules.test.ts` or in a new `apps/api/test/modules-public.test.ts`; the redaction (`requestLogMiddleware` with a
   recording `write`, both lines; `logPathOf` table: a token path, a path without `.ics`, a non-feed path unchanged, a query dropped);
   the Caddyfile has no `log` directive.
Verify: `bun run typecheck`; `bun test apps/api/test/modules.test.ts apps/api/test/middleware.test.ts apps/api/test/http-foundation.test.ts
apps/api/test/http-global.test.ts apps/api/test/deploy-caddyfile.test.ts apps/api/test/effect-idioms.test.ts` plus the new files.
Gotchas: "Middleware, APIs and handler layers are TDZ-safe" (`publicModuleApi` stays in the leaf; a public `*.api.ts` imports only
`effect`, `effect/http-api` and the middleware leaf); "Middleware chain order is load-bearing" (the attached-last runs first).

#### M9-T03 — The ICS writer and the event mapper, test-first

`services/feed/ics.ts` (P11) and `services/feed/vevent.ts` (P12), pure. Tests `apps/api/test/calendar-feed-ics.test.ts`: escaping of each
of `\ ; , \n` and `\r\n`; folding at 75 octets with an `ä` (2 bytes) and a `€` (3 bytes) and an emoji (4 bytes) placed across the boundary
(no line over 75 octets, unfolding restores the input byte for byte); CRLF only (no bare `\n`); the header lines and the VTIMEZONE block
verbatim; all-day single and multi-day (exclusive `DTEND`), timed with `TZID` with and without end, a timed multi-day car booking; UID
`<entryId>-<date>@toon-household` stable for the same input; `DTSTAMP` from a unix ms in UTC; `TRANSP`; and per kind the SUMMARY and
DESCRIPTION of P12 in `de` and `en` (done prefix, rotation assignee, car default title, waste with cleaning, a former member, notes).
Verify: `bun test apps/api/test/calendar-feed-ics.test.ts`; `grep -rnE "new Date\(|Date\.now\(" apps/api/src/modules/calendar` empty.

#### M9-T04 — Services: `expand`, `CalendarFeedTokens`, `CalendarFeed`, the hook

1. P9 `CalendarOccurrences.expand` (+ `list` over it); `apps/api/test/calendar-occurrences.test.ts` stays green unchanged.
2. `services/feed/{tokens.service,feed.service,layer}.ts` (P3-P8, P10, P13), composed in `calendarLayer()` as P13 says;
   `CalendarServices` gains the two.
3. P14 in `hooks.ts`.
4. Tests `apps/api/test/calendar-feed-service.test.ts` (on the shared test db with the harness): the window on a `TestClock` (a
   single event 31 days back is out, 30 days back in, today + 365 in, + 366 out; a recurring daily task yields 396 VEVENTs), the scope
   `mine` (an event for everybody, one naming me, one naming another; a rotation where every second occurrence is mine; a waste pickup
   unassigned, mine, another's; a car booking of mine and of another), skipped omitted, done marked, the locale from `users.locale`,
   the replaced token unknown, `last_used_at` written once per hour (`TestClock.adjust`), the hook deleting the leaver's row only.
Verify: `bun test apps/api/test/calendar-feed-service.test.ts apps/api/test/calendar-occurrences.test.ts apps/api/test/calendar-members.test.ts
apps/api/test/import-order-effect.test.ts apps/api/test/runtime.test.ts`; `bun run typecheck`.
Gotchas: "One composition point, evaluated lazily, siblings nested explicitly"; a static `layer` references only `effect` exports and its
own class; time read inside the method on every call.

#### M9-T05 — Routes, sweep, docs rows

1. `routes/feed.api.ts` + `routes/feed.ts` (group `calendar.feed`, P13), `routes/feed-public.api.ts` + `routes/feed-public.ts` (group
   `calendar.feedPublic`, endpoint `GET /feed/:file`, built with `publicModuleApi("calendar", …)`), `routes/feed.index.ts`
   (`calendarFeedApis()`, `calendarFeedHandlers()`, `calendarFeedPublicApis()`, `calendarFeedPublicHandlers()`); `routes/index.ts` adds
   the feed lists to the household lists and exports `calendarPublicApis()` / `calendarPublicHandlers()`; the manifest gains `publicApi`
   (getter + `Layer.suspend`, as `householdApi`).
2. Tests `apps/api/test/calendar-feed-routes.test.ts`: management (create 201 with the URL shape, GET never carries a token or `url`,
   PATCH keeps the token, PATCH 404 without a link, replace kills the old URL, DELETE 204 twice, `403 email_unverified` on each write
   under `setVerifiedEmailRequired(true)`, a placeholder or non-member refused by the chain) and the public route (200 with the four
   headers and a parseable body, unknown and malformed tokens 404 with the SAME body, rotated 404, revoked 404, a removed member 404, the
   module disabled 404, ETag → 304, HEAD 200 without body, 61st fetch 429 with `Retry-After`, no cookie needed and a foreign cookie
   ignored); `apps/api/test/calendar-cross-household.test.ts` gains the feed cases (U's GET/POST/PATCH/DELETE on B's `…/calendar/feed`
   is 403, B's link untouched; U's token of A never renders B's entries); `apps/api/test/calendar-module.test.ts` (the manifest has a
   `publicApi`, still no `userApi`); `api-doc.test.ts` `MODULE_PREFIXES.calendar` gains `/api/calendar/`.
3. `docs/API.md`: subsection "Subscription feed" with the five rows (auth vocabulary `public:feed-token` for the feed,
   `household:member+module:calendar[+verified]` for the four), the headers, the refusals, the rate limit; the middleware note.
Verify: `bun test apps/api/test/calendar-feed-routes.test.ts apps/api/test/calendar-cross-household.test.ts apps/api/test/calendar-module.test.ts
apps/api/test/api-doc.test.ts apps/api/test/import-order.test.ts apps/api/test/import-order-effect.test.ts apps/api/test/docs-paths.test.ts`;
then the lane gate: `bun run typecheck`, full `bun test` (log), `bun run i18n:check` (parity OK, 148).
Gotchas: "The calendar must be enabled before its routes answer" (`createCalendarHousehold`); the import-order test reads `routes/` by
itself; a by-id route gets its sweep case in the same commit.

### Lane web

Read first: `apps/web/src/modules/calendar/{index.ts,routes.tsx,lib/api.ts,lib/queries.ts,phone-header.test.ts,manifest.test.ts}`, the
cars and waste screens, `apps/web/src/modules/calendar/components/CalendarPageHeader.tsx`, `apps/web/src/lib/{share,api}.ts`,
`apps/web/src/components/ui/`, `apps/web/src/styles/design-system.test.ts` (the Table D rules), `apps/web/vite.config.ts` (P18).

#### M9-T06 — Data layer and pure helpers

`CalendarApi` members and facades (P17) with rows in `apps/web/src/modules/calendar/lib/api.test.ts`; `calendarKeys.feed`, `feedQuery`,
`useCreateFeed`, `useUpdateFeed`, `useDeleteFeed` in `lib/queries.ts` (+ `queries.test.ts`); `features/feed/lib/{platforms,webcal}.ts`
with tests (iPhone, iPad, Android phone and tablet, Windows, macOS, Linux, empty UA; `https`, `http`, a port, a query kept).
Verify: `bun test apps/web/src/modules/calendar`; `bun run typecheck`.

#### M9-T07 — The screen, nav, Übersicht link, catalogs

`features/feed/FeedPage.tsx` (named export `FeedPage`) with its components under `features/feed/components/`, the lazy route `feed` in
`routes.tsx`, `secondaryNavItems` third entry (an icon that exists in the installed `lucide-react`: `CalendarSync` if present, else
`Rss`), the Übersicht link, `catalogs/feed.{de,en}.ts` spread in `catalogs/index.ts`, `calendar.nav.feed`; `manifest.test.ts` (the
three sidebar items), `phone-header.test.ts` covers the new screen through `routes.tsx`; a component test of the three states (no link,
just created with the URL and the webcal href, existing with "Noch nicht abgerufen" and with a `lastUsedAt`). The LINKS grep of
`docs/modules/calendar.md` §5.1 gains `feed` (the pattern lives in the doc; the integration task edits it, the lane runs it).
Verify: `bun test apps/web/src/modules/calendar apps/web/src/styles`; `bun run typecheck`; `bun run i18n:check` (parity OK, 148); the
LINKS grep with `feed` added empty; `grep -rn "from \"effect" apps/web/src/modules/calendar` empty; `bun run build` (log).
Gotchas: "A module owns its layout route and its static import graph stays shell-free" (the screen is lazy; `index.ts` imports no
screen), "`MessageKey` must stay a literal union", "A phone header action has a short label", "Every shell screen renders
`PhoneHeaderRow` itself", "The design-system test is the Table D gate".

### Integration

#### M9-T08 — Merge, contract rows, docs as built, gates

1. Merge `m9/api`, then `m9/web` (`--no-ff`); `bun install --frozen-lockfile`.
2. `apps/api/test/web-contract-calendar.test.ts`: rows `fetchFeed` (null and a link), `createFeed` (201), `updateFeed`, `deleteFeed`
   (void), decoded with `{ disableChecks: true }` and equal to the body.
3. Docs: `docs/modules/calendar.md` section 7 rewritten as built (and §1.2's "server never decides today" with the P8 exception, the
   gotchas, §5.1 LINKS with `feed`, §5.2 tests, §6 without the feed); `docs/open-work.md` X-10 (ICS import only); `CLAUDE.md` (Status with
   M9 and the gate counts, Layout: migration `0005_calendar_feed`, the feed files, ADR 0017 in the ADR list, the module-gotcha index);
   ADR 0017 status.
4. Gates: typecheck, `bun test` (log; count), `bun run build` (log; gzipped JS), `bun run i18n:check`, `git status --porcelain repos/`.

#### M9-T09 — Review, headless check, the record

Code review of the merged diff (high effort) against section 2, each finding fixed in its own commit with a test. Headless (CLAUDE.md
"Headless runs"): seeded scratch DB, built app, demo login, enable Kalender, `/calendar/feed` at 390 and 1440 in the three states without
overflow; create a link, `curl` the URL (200, headers; validate the body with a strict parser in a scratch directory outside the repo,
e.g. `python3 -m pip install icalendar` in a venv); screenshots to `docs/plans/screenshots/m9/`. Sections 9 and 10.

## 5. The cross-lane contract

### 5.1 Shared names (`@toon/shared`, flat; `packages/shared/src/modules/calendar/`)

| Name | Shape |
| --- | --- |
| `CalendarFeedScopeSchema` / `CalendarFeedScope` | `"all" \| "mine"` |
| `CalendarFeedSchema` / `CalendarFeed` | `{ scope, createdAt: ISO, lastUsedAt: ISO \| null }` |
| `CalendarFeedResponseSchema` / `CalendarFeedResponse` | `{ feed: CalendarFeed \| null }` (GET, PATCH) |
| `CreateCalendarFeedRequestSchema` / `CreateCalendarFeedRequest` | `{ scope }` (POST) |
| `UpdateCalendarFeedRequestSchema` / `UpdateCalendarFeedRequest` | `{ scope }` (PATCH) |
| `CalendarFeedCreatedResponseSchema` / `CalendarFeedCreatedResponse` | `{ url, scope, createdAt, lastUsedAt: null }` (POST 201) |
| `CALENDAR_FEED_LIMITS` | `tokenBytes 32`, `tokenLength 43`, `pastDays 30`, `futureDays 365`, `fetchesPerHour 60`, `lastUsedResolutionMs 3600000`, `maxAgeSeconds 300`, `timeZone "Europe/Berlin"` |
| `CALENDAR_FEED_PATH_PREFIX` | `"/api/calendar/feed/"` |
| `CALENDAR_FEED_FILE_PATTERN` | `/^([A-Za-z0-9_-]{43})\.ics$/`, group 1 the token |

No new `ERROR_CODES`: the feed's refusals are `not_found` and `rate_limited`; the management's are the chain's plus `validation_failed`
and `not_found` (PATCH without a link).

### 5.2 Routes

| Method | Path | Group.endpoint | Request | Answer | Web |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/households/:householdId/calendar/feed` | `calendar.feed.get` | – | `CalendarFeedResponse` | `fetchFeed` (decodes) |
| POST | `/api/households/:householdId/calendar/feed` | `calendar.feed.create` | `CreateCalendarFeedRequest` | 201 `CalendarFeedCreatedResponse` | `createFeed` (write) |
| PATCH | `/api/households/:householdId/calendar/feed` | `calendar.feed.update` | `UpdateCalendarFeedRequest` | `CalendarFeedResponse` | `updateFeed` (write) |
| DELETE | `/api/households/:householdId/calendar/feed` | `calendar.feed.remove` | – | 204 | `deleteFeed` (void) |
| GET (+HEAD) | `/api/calendar/feed/:file` | `calendar.feedPublic.feed` | – (`If-None-Match`) | 200 `text/calendar` / 304 / 404 / 429 | never fetched by the app |

### 5.3 Server catalog keys (T01; de and en)

`server.calendar.feed.calendarName` (`{household}`), `.calendarNameMine` (`{household}`), `.done` (`{summary}`), `.withPeople`
(`{summary}`, `{names}`), `.carSummary` (`{car}`, `{title}`), `.carDefaultTitle`, `.unknownCar`, `.for` (`{names}`), `.assignee`
(`{names}`), `.car` (`{car}`), `.everybody`, `.formerMember`, `.waste.waste_rest` … `.waste.waste_tree`, `.waste.withCleaning`
(`{label}`).

### 5.4 Web names (`apps/web/src/modules/calendar/`)

Route `/calendar/feed` → `features/feed/FeedPage` (`FeedPage`); `calendarKeys.feed(householdId)` = `["toon","household",householdId,
"calendar","feed"]` (not persisted); `CalendarApi.fetchFeed`, `.createFeed`, `.updateFeed`, `.deleteFeed` and their facades; hooks
`feedQuery`, `useCreateFeed`, `useUpdateFeed`, `useDeleteFeed`; helpers `feedPlatformOrder(userAgent)`, `webcalUrl(url)`; catalog keys
`calendar.nav.feed` ("Kalender-Abo") and `calendar.feed.*` (`catalogs/feed.{de,en}.ts`).

## 6. Risks

- **A leaked link.** Anyone with it reads one household's calendar (scope permitting) until it is replaced or ended; no write, no
  session. Mitigations: the explicit copy on the screen, replace and end in one tap, the rate limit, no token in a log.
- **Clients refresh as they like.** Google Calendar polls every few hours whatever `REFRESH-INTERVAL` says; the screen says so.
- **ETag churn.** The body changes when the window moves (once a day) or data changes; nothing else (DTSTAMP is the entry's
  `updated_at`, not now).
- **iPad user agent.** iPadOS reports a Mac by default; the ordering then shows the desktop order with the iPhone button still first in
  the "just created" state.

## 7. Deviations expected (each recorded in section 10 when it happens)

ADR 0017 (P2); the P8 exception to "The server never decides today"; `RateLimiter.check` instead of `enforce` (P5).

## 8. Out of this milestone

ICS import, per-occurrence edits, alarms (`VALARM`), a feed of several households in one URL, a per-entry opt-out; all stay in
`docs/open-work.md`.

## 9. Integration record

(Written by M9-T08 and M9-T09.)

## 10. What changed vs plan

(Written by M9-T08 and M9-T09.)
