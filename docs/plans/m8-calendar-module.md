# M8 — calendar module: plan

**Status: PLANNED (2026-11-06).** Base commit `94e2906f1` (`M8 design: calendar module (docs/modules/calendar.md, ADR 0016) and the
Hattingen 2027 flyer fixture`). Sections 9 and 10 (the integration record and "what changed vs plan") are written by M8-T18 and
M8-T19.

M8 builds the third household module, `calendar` (Kalender): appointments for everybody or for named members, car bookings with a
conflict check, chores with a rotating assignee, and the import of the Stadt Hattingen waste flyer by tour number. THE SPEC is
`docs/modules/calendar.md` (the design, read whole) plus `docs/adr/0016-calendar-module.md`; the fixed decisions are `docs/SPEC.md`
§1 (D1-D15) and `docs/EFFECT.md` §1 (E1-E12). This plan only adds what the design leaves open (section 2) and cuts the work into
four lanes (section 3).

Exit: the gates green on the merged tree (`bun install --frozen-lockfile`, `bun run typecheck`, `bun test` with the pass count above
the baseline and 0 fail, `bun run build`, `bun run i18n:check` with the PARITY half OK and the leftover half still exactly the
classified false positives, `git status --porcelain repos/` empty); every calendar route has a `docs/API.md` row
(`apps/api/test/api-doc.test.ts` with `calendar` in `REQUIRED_MODULE_SECTIONS`); every by-id calendar route in a cross-household sweep;
the parser reproduces every row of design §5.4 from the committed fixture; every web read route in
`apps/api/test/web-contract-calendar.test.ts`; a headless pass at 390 and 1440 over every screen of design §4 with no horizontal
overflow; the docs "as built" (section 4, M8-T18).

## 1. Context

### 1.1 Baseline (measured for E8, unchanged by the design commit)

`bun run typecheck` OK; `bun test` 15236 pass, 1 skip, 0 fail in 183 files; `bun run i18n:check` exits 1 by design with 148
classified leftover-German false positives and the parity half OK; gzipped web bundle 419.99 kB.

### 1.2 What exists that the module plugs into

- Shared: `packages/shared/src/modules/registry.ts` (`MODULE_IDS = ["recipe", "finance"]`), the flat entry
  `packages/shared/src/index.ts`, the schema vocabulary `packages/shared/src/core/schemas/checks.ts`, `ERROR_CODES` in
  `packages/shared/src/core/schemas/common.ts`, the server catalogs `packages/shared/src/core/i18n/catalogs/server.{de,en}.ts`.
- API: the contract `apps/api/src/modules/types.ts` (`ApiModule<Services>`, `ModuleHttpApi`), the registry
  `apps/api/src/modules/index.ts` (lazy `API_MODULES`, `ModuleServices`), `apps/api/src/modules/mount.ts` (asserts the chain, adds
  the per-module catch-all), the vocabulary `apps/api/src/http/{middleware,request,response,context}.ts`, the error family
  `apps/api/src/lib/errors.ts` (`ApiFailure` carries any status, code and `details`; `Conflict` has no `details`), `toIso` in
  `apps/api/src/lib/http.ts`, the one decode path `apps/api/src/lib/validate.ts`, the drizzle registry `apps/api/src/db/schema.ts`,
  migrations `apps/api/drizzle/0000_core.sql` … `0003_placeholder_members.sql`.
- Web: `apps/web/src/modules/{index,catalogs,types}.ts`, `apps/web/src/components/layout/nav-items.ts` (`MAX_MODULE_TABS = 2`),
  `apps/web/vite.config.ts` (`RUNTIME_CACHING`), `apps/web/src/lib/api.ts` (`getJson`, `sendJson`, `sendForm`, `sendVoid`, `seg`,
  `queryString`), `apps/web/src/lib/runtime.ts` (`runPromise`), `apps/web/src/lib/queries.ts` (`queryKeys.householdModule`,
  `filterKey`, `householdMembersQuery`), `apps/web/src/lib/validation.ts`, `apps/web/src/components/ui/*`,
  `apps/web/src/components/layout/PhoneHeaderRow.tsx`, `todayPlanDate()` in `packages/shared/src/core/calendar.ts` (the CLIENT's today).
- Tests that pin the module list and must move with it: `packages/shared/test/core.test.ts`, `apps/api/test/{runtime,smoke,
  http-server,http-contract,recipe-module,finance-module,module-adapter}.test.ts` (health `modules` / `API_MODULES` ids),
  `apps/web/src/modules/{recipe,finance}/manifest.test.ts` (`WEB_MODULES` ids), `apps/web/src/components/layout/nav-items.test.ts`
  (the "at most two module tabs" case), `packages/shared/test/schema-golden-coverage.test.ts` (217 exported `*Schema`, decision P22).

### 1.3 Model code to read before writing

Finance is the model for everything server-side: `apps/api/src/modules/finance/{index,layer,schema,seed}.ts`,
`apps/api/src/modules/finance/routes/{index,tags.api,tags,transactions.api,transactions}.ts`,
`apps/api/src/modules/finance/services/categories/{layer,categories.service}.ts`,
`apps/api/src/modules/finance/services/participants/participants.service.ts` (a service-level `ValidationFailed` with `details`),
`apps/api/test/finance-cross-household.test.ts`, `apps/api/test/web-contract-finance.test.ts`,
`apps/api/test/support/finance-harness.ts`. Recipe's URL fetch (`apps/api/src/modules/recipe/services/import/url/fetch.ts`, one
`HttpClient` request per hop, `redirect: "manual"`, no `traceparent`) and PDF text (`apps/api/src/modules/recipe/services/ocr/pdf.ts`,
dynamic `import("unpdf")`, a serialising lock) are models to COPY the shape of, never to import (module boundary). Web: the finance
module (`apps/web/src/modules/finance/{index.ts,routes.tsx,HomeCard.tsx,lib/api.ts,lib/queries.ts,components/PageHeader.tsx,
phone-header.test.ts,manifest.test.ts,persist.test.ts}`) and recipe's planner (`apps/web/src/modules/recipe/features/plan/`).

## 2. Decisions (binding for the tasks)

**P1 — Lanes and branches.** Foundation runs alone on `main` (M8-T01 … M8-T04) and ends with every gate green. Then three lanes
run in parallel in git worktrees branched from the foundation tip: `m8/api-core` (`../toon-household-m8-api-core`), `m8/api-waste`
(`../toon-household-m8-api-waste`), `m8/web` (`../toon-household-m8-web`); each runs `bun install --frozen-lockfile` once (background,
log ending `exit=$?`). Integration (M8-T18) merges into `main` with `git merge --no-ff` in the order api-core, api-waste, web. A lane
never edits a file another lane owns (section 3); the three shared regions that two lanes touch are split by foundation-made anchors
(P21, P23) so the merges are clean.

**P2 — Calendar arithmetic without `Date`.** `packages/shared/src/modules/calendar/dates.ts` implements the module's date math on
`YYYY-MM-DD` strings with the days-from-civil algorithm: `calendarDayNumber`, `fromDayNumber`, `addCalendarDays`,
`calendarDaysBetween`, `calendarWeekday` (0 = Monday … 6 = Sunday), `daysInCalendarMonth`, `isLeapYear`, `isCalendarDate` (a REAL
date, `2027-02-29` false), `isCalendarTime` (`HH:MM`, 00:00-23:59), `compareDateTime`. No `new Date(`, no `Date.now(` and no local
time zone anywhere in the shared calendar code or in `apps/api/src/modules/calendar/` (idioms rules (11), (19); the parser lives under
`services/` and needs weekdays). The web may use `todayPlanDate()` for the client's today.

**P3 — Recurrence.** `packages/shared/src/modules/calendar/recurrence.ts`, pure, typed over
`CalendarSeries = { startDate, endDate, repeat: { freq, interval, weekdays, until } }`:
- `freq "none"` is one occurrence. `daily`: every `interval` days. `weekly`: the ISO week of the start date is week 0; weeks
  `0, interval, 2·interval, …` hold an occurrence on each listed weekday that is ≥ the start date (default weekdays: the start
  date's). `monthly`: the start's day of month every `interval` months, a month WITHOUT that day is skipped and is not an occurrence.
  `yearly`: same month and day every `interval` years (29 Feb only in leap years). `until` is inclusive and bounds the occurrence
  START date.
- Duration: `d = calendarDaysBetween(startDate, endDate)`; every occurrence keeps it (`endDate = date + d`). An occurrence overlaps
  `[from, to]` when `date ≤ to` and `endDate ≥ from`, so expansion starts at `from - d`.
- `ordinal` counts occurrences from the series start (0-based), EVERY occurrence counts whatever its state (a skipped day does not
  shift the rotation). It is computed WITHOUT enumerating from the start day by day: arithmetic for daily (`floor(days / interval)`)
  and weekly (full selected weeks × weekday count + position in the week, minus listed weekdays before the start in week 0);
  month/year stepping for monthly and yearly (bounded by the series age in months, about 1200 per century).
- API: `expandOccurrences(series, from, to, limit = CALENDAR_LIMITS.maxOccurrencesPerEntry)` →
  `{ occurrences: ReadonlyArray<{ date, endDate, ordinal }>, overflow: boolean }`; `occurrenceOrdinal(series, date)` → `number | null`
  (`null` when `date` is not an occurrence start: the PUT-state 404 and the orphan check of P7); `nextOccurrences(series, from, count)`
  (the form's "Nächste: …" line).
- Tests (`packages/shared/test/calendar-recurrence.test.ts`): every freq, interval 1 and > 1, weekday sets, the 31st and 29 Feb,
  multi-day overlap at both range edges, `until` on and off an occurrence, ordinals of a 10-year-old daily, weekly and monthly series
  against a naive day-by-day enumerator (property loop over seeded inputs), `overflow` at the limit, `occurrenceOrdinal` on and off.

**P4 — Range and caps.** A read range is at most 400 days INCLUSIVE (`calendarDaysBetween(from, to) + 1 ≤ 400`). The query schema
checks only formats and `to ≥ from` (`validation_failed`); the SERVICE refuses a longer range, and an entry whose expansion
overflows 2000, with `ApiFailure { status: 422, code: "calendar_range_too_large", details: [{ path: "to", code: "custom", message,
i18n }] }` (keys `server.calendar.rangeTooLarge`, `server.calendar.tooManyOccurrences`). No silent truncation.

**P5 — Wire contract names.** Section 5.1 is the table every lane codes against; names are final once foundation commits.
Responses carry timestamps as ISO strings (`toIso`), dates as `YYYY-MM-DD`, times as `HH:MM`, nullable fields as `null` (never
absent).

**P6 — Entry validation by kind** (the create schema's struct checks, keyed `server.calendar.*`; the member and resource checks are
the service's):

| kind | time | who | resource |
| --- | --- | --- | --- |
| `event` | `allDay` true: no times; false: `startTime` required, `endTime` optional (`null` = no end), end after start | `attendeeIds` 0-20 distinct members (none = "Alle"); `assigneeMode` must be `none`, `assigneeIds` empty | must be null |
| `task` | as event; `endDate` must equal `startDate` | `attendeeIds` empty; `assigneeMode` `none` (0 ids), `fixed` (exactly 1), `rotate` (2-12 distinct, order = rotation) | must be null |
| `car` | all-day, or timed with `startTime` AND `endTime`, end after start | exactly 1 attendee (who needs the car); assignee fields empty | required: a car of this household that is not archived |

A member id that is not a member of the household is `422 validation_failed` at its path (`attendeeIds.1`, …) with
`server.calendar.memberNotInHousehold`; a `resourceId` of another household is `404 not_found` (D8, as finance's foreign
`categoryId`); an archived own car is `422` with `server.calendar.resourceArchived`. `title` is 1-200 trimmed, `location` ≤ 200,
`notes` ≤ 2000, `interval` 1-99, `weekdays` only for weekly, `until ≥ startDate`.

**P7 — PATCH is merge-then-validate.** `UpdateCalendarEntryRequestSchema` is the create fields minus `kind`, all optional, plus
`allowConflict`. The service merges the body onto the stored entry and decodes the RESULT with the create schema (so every P6 rule
and its `details` apply to the merged entry), then checks members and the resource. When the schedule changed (`allDay`, dates,
times, `repeat`), occurrence states whose date is no longer an occurrence (`occurrenceOrdinal(...) === null`) are deleted in the same
`Database.transaction`.

**P8 — Imported waste entries are read-mostly.** On an entry with `wasteImportId`: PATCH may change only `notes`, `assigneeMode` and
`assigneeIds` (any other key in the body: `409 calendar_entry_imported`); DELETE is `409 calendar_entry_imported` (the unit is the
import: `DELETE …/waste/imports/:importId`); PUT occurrence state is allowed (the "rausgestellt" tick). `GET /entries` (P9b) never
lists them.

**P9 — Two refinements of the design's API table.**
(a) `GET /occurrences` answers `{ items, members }`, `members` = `CalendarMember[]` (`userId`, `name`, `colorIndex` 1-6, `hasAccount`)
of the household, sorted by join time (`household_members.created_at`, then `user_id`); `colorIndex = (position mod 6) + 1` through the
shared pure `calendarPersonColors` (`packages/shared/src/modules/calendar/people.ts`), which the web also uses on the core members
query. Reason: the persisted calendar keys then render names and colours offline (the core members query is not persisted).
(b) `GET /entries?kind=&recurring=` answers `{ items: CalendarEntry[] }` (non-waste series of the household, filtered): the Aufgaben
"Wiederkehrend" section needs every task series, also one with no occurrence in the visible window. One more `docs/API.md` row;
recorded in section 10 and in the as-built `docs/modules/calendar.md`.

**P10 — Occurrence filters and order.** `memberId` keeps an occurrence whose `memberIds` contain it, whose `assigneeId` is it, or
that names nobody (an event for "Alle", an unassigned task or pickup: household-wide). `kind` filters by entry kind (waste pickups
are `task`). Order: `date`, then all-day before timed, then `startTime`, then waste before other entries, then `title` / category
order, then `entryId` (deterministic).

**P11 — Car conflicts** (`CalendarCarConflicts.check`): two bookings of the same resource conflict when their half-open wall-time
intervals overlap; all-day covers `[date 00:00, endDate+1 00:00)`. For recurring bookings the check runs over the new booking's
occurrences within `[startDate, min(until, startDate + 366 days)]` against every other booking of that resource expanded over the same
window; occurrences whose state is `skipped` do not block. On PATCH the entry itself is excluded. Unless `allowConflict: true`, a
conflict is `ApiFailure { 409, "calendar_car_conflict", text: server.calendar.carConflict, details: CalendarCarConflict[] }` (at most
10, ordered by date; `{ entryId, date, startTime, endTime, title, memberIds }`).

**P12 — Occurrence states.** `PUT /entries/:entryId/occurrences/:date` with `status: "done"` only on a task (`409
calendar_not_a_task`), `"skipped"` on any kind, `null` deletes the row (reset). `:date` must satisfy `occurrenceOrdinal !== null`, else
`404 not_found`. `done_by` = the caller for `done`, `null` for `skipped`. The answer is that occurrence as `CalendarOccurrence`.

**P13 — Resources.** `GET /resources` lists non-archived cars unless `includeArchived=true` (`Enum(["true","false"])`, no import of
finance's boolean query schema: module boundary). DELETE of a car that any entry references is `409 calendar_resource_in_use`
(archive instead: `PATCH { archived: true }` sets `archived_at` from the Clock, `false` clears it). Names are 1-60 trimmed.

**P14 — Hooks and seed use `Database` only.** `apps/api/src/modules/calendar/hooks.ts` (`calendarOnMemberRemoving`) and
`apps/api/src/modules/calendar/seed.ts` (`seedCalendarDemo`) are Effects over the CURRENT `Database` executor with direct drizzle
statements and the pure shared helpers, so they run outside the runtime too (no `withCalendarServices` is needed). Member removal
(no veto): delete the user's `calendar_entry_members` rows in the household's entries and its `calendar_waste_assignees` row; renumber
the remaining rotation positions; a rotation left with one person becomes `fixed`, with none `none` (entries and waste settings
alike). Car bookings keep their row without a person; `done_by` keeps the user id (the web shows an unknown id as "Ehemaliges
Mitglied").

**P15 — Waste assignment is resolved at write time.** Waste entries are single all-day tasks; a rotation over single entries would
always pick the first person, so the import and `PUT /waste/settings` compute the assignee PER PICKUP DAY: the pickup days of an
import sorted ascending, day `k` → `assigneeIds[k mod n]` (all categories of one day go to the same person). The entries store
`assignee_mode "fixed"` with that one id (or `"none"`); the settings keep the mode and the ordered list. `PUT /waste/settings` re-runs
this for every entry of every import of the household with `date ≥ body.today` (the client's today; the server never decides it).

**P16 — Waste overview.** `GET /waste?from=` answers `{ settings | null, imports (newest year first), next }`; `next` = per category in
`WASTE_CATEGORIES` order the earliest waste entry with `startDate ≥ from` whose state is not `skipped`, `{ category, date, detail }`.

**P17 — The waste source.** URL: only `https:`, host in `WASTE_PROVIDERS[provider].hosts` (exact match), at most 5 redirects, every
hop re-checked BEFORE it is requested, `redirect: "manual"`, no `traceparent`, 20 s for the whole fetch, ≤ 10 MiB by `Content-Length`
and by the streamed count. Refusals: scheme or host (also on a redirect hop) `400 calendar_waste_source_refused`; network error,
non-2xx, too many redirects, timeout, too large `502 calendar_waste_fetch_failed` (`details: [{ reason }]`, reason one of `network`,
`status`, `redirects`, `timeout`, `tooLarge`). Upload: `multipart/form-data` with `file` and `tour`; > 10 MiB `413 payload_too_large`
(`server.calendar.wasteTooLarge`), bytes not starting with `%PDF-` `415 unsupported_media_type` (`server.calendar.wasteNotPdf`), neither
file nor url `422 validation_failed` (`server.calendar.wasteFileRequired`, path `file`). Fetched bytes that are not a PDF are `422
calendar_waste_unparseable` (check `notPdf`). Preview and import share a per-user rate limit (`RateLimiter`, key `calendar-waste`, 30
per hour; off under test like the others).

**P18 — PDF text.** `WastePdfText` (`Context.Service`) imports `unpdf` DYNAMICALLY inside its method (pdf.js stays out of the boot
graph), serialises extractions with a one-permit semaphore built in its layer (memory bound, as recipe's lock), runs
`getDocumentProxy(bytes, { isEvalSupported: false })` and `getTextContent({ includeMarkedContent: true })` under a 20 s Effect
timeout, and returns `WasteTextItem[]` (`{ str, x, y, width, page, section }`, `section` from depth-tracked
`beginMarkedContentProps` / `endMarkedContent`). Failures map to `422 calendar_waste_unparseable` with checks `encrypted` (a non-empty
user password), `pages` (> 6) and `timeout`. Tests may feed recorded items: `apps/api/test/fixtures/calendar/hattingen-2027.items.json`
is generated ONCE from the committed PDF by `apps/api/test/fixtures/calendar/record-items.ts` and committed; a test compares a fresh
extraction with it.

**P19 — The parser contract.** `parseHattingenFlyer(items)` in `apps/api/src/modules/calendar/services/waste/hattingen.ts` is a pure
function returning `{ ok: true, year, days: ReadonlyMap<date, Partial<Record<WasteCategory, tour>>>, cleaning: ReadonlyArray<{ from,
to }> } | { ok: false, check, date?, readings? }` (no throw, no `Error` subclass: idioms rule (17)). It follows design §5.3 exactly
(per-section blocks, the weekday validation, half-pitch row bands from the block's own day items, column cells bounded by the next
header of the SAME block, consensus across valid blocks, the sanity checks). `selectTour(parse, tour)` → `{ category, date, detail }[]`
(`detail "bio_cleaning"` for a B pickup inside a cleaning range). Check names: `notPdf`, `encrypted`, `pages`, `timeout`, `year`,
`months`, `consensus`, `values`, `tourCount`, `sundays`, `noTourDates`. Built TEST-FIRST: `apps/api/test/calendar-waste-hattingen.test.ts`
encodes every row of design §5.4 before the parser exists, plus 365 dates covered, determinism, and the whole-year count of tour 4 in R
pinned to the number the parser yields once every spot check passes.

**P20 — Import semantics** (design §5.5, one `Database.transaction`): upsert settings (provider, tour, `source_url` for a URL
source; mode and assignees kept, default `none`); read the occurrence states of the household's import of `(provider, year)` keyed by
`(category, date)`; delete that import (its entries cascade); insert the new import and one entry per `(category, date)` of the tour
(`kind task`, `all_day`, `title NULL`, `category`, `category_detail`, `waste_import_id`, assignee per P15); re-insert the carried states
for the `(category, date)` pairs that still exist. Answer `201 { import, entryCount }`. `source` is `url` or `upload`; `source_name`
the URL or the uploaded file's name (≤ 200).

**P21 — Server catalog keys** (foundation writes de + en for all of them; lanes never edit outside their anchor, P28):
errors `server.calendar.{carConflict, resourceInUse, entryImported, notATask, rangeTooLarge, tooManyOccurrences, wasteSourceRefused,
wasteFetchFailed, wasteUnparseable, wasteFileRequired, wasteNotPdf, wasteTooLarge}`; parser checks
`server.calendar.wasteCheck.{notPdf, encrypted, pages, timeout, year, months, consensus, values, tourCount, sundays, noTourDates}`;
validation `server.calendar.{invalidDate, invalidTime, rangeOrder, endBeforeStart, timeRequired, allDayNoTime, taskSingleDay,
untilBeforeStart, weekdaysOnlyWeekly, duplicateIds, memberNotInHousehold, attendeesNotOnTasks, assigneesOnlyTasks, fixedNeedsOne,
rotateNeedsTwo, assigneesForNone, carNeedsResource, carNeedsOnePerson, resourceOnlyCars, resourceArchived}`. Below the foundation
block, two anchor comments separated by at least three unchanged lines: `/* calendar: api-core additions (M8) */` and
`/* calendar: api-waste additions (M8) */` (both files). German: short, du-form, the app's tone.

**P22 — The golden corpus covers the E1 schemas only.** `packages/shared/test/schema-golden-coverage.test.ts` enumerates every
exported `*Schema` and requires golden cases made once from Zod 4.5.4 (ADR 0013); the calendar schemas never had a Zod form and
cannot get one. Foundation narrows `schemaExports` to names NOT declared under `packages/shared/src/modules/calendar/` (read from
those source files), keeps the count 217, and adds two assertions in the same file: every excluded name is declared in a calendar
file, and every excluded name appears in `packages/shared/test/calendar-schemas.test.ts`, which holds an ok and a not-ok case per
schema (decoded with `ALL_ISSUES`, the `details` checked through `toValidationIssues` for the keyed checks). A stricter guard, not a
relaxed one; recorded in section 10.

**P23 — Docs and test anchors.** Foundation writes the `docs/API.md` "Error codes" rows for the eight codes and a `## Calendar
module` section with `### Mount and access` (filled), `### Entries, occurrences and resources — apps/api/src/modules/calendar/routes/
{entries,occurrences,resources}.ts` (api-core fills) and, further down after a `### Tables` placeholder, `### Waste —
apps/api/src/modules/calendar/routes/waste.ts` (api-waste fills). `apps/api/test/api-doc.test.ts` gains `calendar:
["/api/households/:householdId/calendar"]` in `MODULE_PREFIXES` and `"calendar"` in `REQUIRED_MODULE_SECTIONS` at foundation, so each
lane documents its routes in the commit that serves them. `apps/api/test/import-order-effect.test.ts` lists the calendar route files
by READING `apps/api/src/modules/calendar/routes/` (every `*.ts` not ending `.api.ts`), so no lane edits it.

**P24 — Web data rules.** Query keys (section 5.4) under `["toon","household",id,"calendar",…]`; a write invalidates
`["toon","household",id,"calendar"]`; persisted: `occurrences`, `entry`, `entries`, `resources`, `waste`. Writes are online only:
with `onlineManager.isOnline()` false a write shows the core offline toast and sends nothing; no `persistMutationNamespaces`, no
`mutationDefaults`. The done toggle is optimistic over every cached `occurrences` list of the household (`setQueriesData`, rollback on
error, invalidate on settle). Reads decode with the shared response schemas (`getJson(Schema, url)`); no file of the module imports
`effect` (idioms rule (13)); forms validate with `@/lib/validation` over the shared request schemas.

**P25 — Seed** (design §6, `seedCalendarDemo`): idempotent by a marker: the household's resource named "Familienauto" (present =
done). People by e-mail among the household's members (`robin@toon.local`, `kim@toon.local`, both created by finance's seed earlier in
module order); a missing one falls back to the demo user. Dates from the Clock's date in `Europe/Berlin` (look up `DateTime` zone
APIs in `repos/effect`). The synthetic waste import: provider `hattingen`, tour 4, `source "upload"`, `source_name "demo-seed"`, year
of the seed date, rows written directly (no PDF). `apps/api/src/modules/calendar/seed.ts` is on the i18n `ALLOW_LIST` (content
German).

**P26 — Tables.** TS identifiers `calendarEntries`, `calendarEntryMembers`, `calendarOccurrenceStates`, `calendarResources`,
`calendarWasteSettings`, `calendarWasteAssignees`, `calendarWasteImports`, exported together as `calendarTables`; every index and
CHECK named `calendar_…`. CHECKs: `kind IN (event,task,car)`, `repeat_freq IN (…)`, `repeat_interval BETWEEN 1 AND 99`, `assignee_mode
IN (none,fixed,rotate)`, `category IN (…) OR NULL`, `(title IS NOT NULL OR category IS NOT NULL)`, `role IN (attendee,assignee)`,
`status IN (done,skipped)`, `resources.kind = 'car'`, `tour BETWEEN 1 AND 9`, `source IN (url,upload)`, dates and times by GLOB.
`calendar_waste_assignees` has PK `(household_id, user_id)`; `calendar_waste_settings.updated_at` lives on the settings row. No
`$defaultFn(Date.now)`: services stamp `created_at` / `updated_at` / `imported_at` / `archived_at` from `Clock.currentTimeMillis`
(rule (11)). The migration is GENERATED (`cd apps/api && bunx drizzle-kit generate --name calendar` → `0004_calendar.sql`), never
edited by hand; `apps/api/test/db-calendar-migration.test.ts` applies it on a scratch file and probes each CHECK.

**P27 — The service areas.** `calendarLayer()` = `Layer.mergeAll(calendarEntriesAreaLayer(), calendarWasteAreaLayer())`
`.pipe(Layer.provideMerge(CalendarMembers.layer))`. `CalendarMembers` (foundation, `services/members.ts`): `list(householdId)` →
`CalendarMember[]` (P9a) and `assertMembers(householdId, ids, path)` (the P6 422). The entries area (api-core): `CalendarResources`
and `CalendarCarConflicts` (leaves over `Database`), then `CalendarEntries` and `CalendarOccurrences` in an outer `provideMerge` step.
The waste area (api-waste): `WastePdfText` and `WasteFlyerFetch` (leaves; `WasteFlyerFetch.layer` provides `FetchHttpClient.layer`
itself, `HttpClient` is not a `ModuleRequirements` service), then `CalendarWaste`. The areas do not depend on each other (waste writes
its entries with its own statements). Each static `layer` references only `effect` exports and its own class (CLAUDE.md "One
composition point").

**P28 — Shared files and the escape hatch.** Only foundation edits the files of section 3.1's "foundation only" list. A lane that
finds a defect in a foundation file (a schema field, a key) makes ONE additive change (a new optional field, a new export, a new
catalog key below its own anchor, never a rename or removal) in a separate commit `M8-Txx shared-fix: …` that touches nothing else, and
lists it in its report; integration resolves any overlap. The web lane never changes a response shape: it reports the need.

**P29 — Tokens.** Foundation picks the eleven values (design §4.6) as hex literals in all four `theme.css` blocks, maps them in
`apps/web/src/styles/index.css` `@theme inline` (`--color-waste-rest: var(--waste-rest)`, …, `--color-person-1` …) so utilities
`bg-waste-rest`, `bg-person-1` exist, and adds `apps/web/src/styles/calendar-tokens.test.ts`: the eleven tokens in every block, the
override set size 50 (39 + 11; `apps/web/src/styles/design-system.test.ts` keeps its rules, its comment's count becomes 50), and each
token ≥ 3:1 against `--surface` of the same scheme (WCAG relative luminance on the hex values).

## 3. Lanes and file ownership

### 3.1 Foundation (on `main`, alone, first)

**Foundation only** (no lane edits these; P28 is the one exception): `packages/shared/src/modules/registry.ts`,
`packages/shared/src/index.ts`, `packages/shared/src/core/schemas/common.ts`, `packages/shared/src/core/i18n/catalogs/server.{de,en}.ts`
(lanes: below their anchor only), everything under `packages/shared/src/modules/calendar/`, `packages/shared/test/{core,
schema-golden-coverage}.test.ts`, `apps/api/src/db/schema.ts`, `apps/api/src/modules/calendar/{schema,index,layer}.ts`,
`apps/api/src/modules/calendar/services/members.ts`, `apps/api/src/modules/calendar/routes/index.ts`, `apps/api/drizzle/**`,
`apps/api/src/modules/index.ts`, `apps/api/test/support/calendar-harness.ts`, `apps/api/test/{api-doc,import-order-effect}.test.ts`,
the module-list pins of section 1.2, `apps/web/src/modules/{index,catalogs}.ts`, `apps/web/src/modules/calendar/{index.ts,routes.tsx}`,
`apps/web/src/components/layout/{nav-items,nav-items.test}.ts`, `apps/web/vite.config.ts`, `apps/web/src/styles/{theme,index}.css`,
`apps/web/src/styles/{design-system,calendar-tokens}.test.ts`, `scripts/i18n-check.ts`, `docs/API.md` outside the two lane subsections.

### 3.2 Lane api-core (`m8/api-core`)

Owns: `apps/api/src/modules/calendar/services/entries/**` (incl. `layer.ts`, replacing the stub), `apps/api/src/modules/calendar/
routes/{entries.api,entries,occurrences.api,occurrences,resources.api,resources,core.index}.ts` (replacing the `core.index.ts` stub),
`apps/api/src/modules/calendar/{hooks,seed}.ts` (replacing the stubs), `apps/api/test/calendar-{entries,occurrences,resources,
car-conflicts,members,seed,cross-household}.test.ts`, `docs/API.md` subsection "Entries, occurrences and resources", server catalog
keys below the api-core anchor.

### 3.3 Lane api-waste (`m8/api-waste`)

Owns: `apps/api/src/modules/calendar/services/waste/**` (incl. `layer.ts`, replacing the stub), `apps/api/src/modules/calendar/routes/
{waste.api,waste,waste.index}.ts` (replacing the `waste.index.ts` stub), `apps/api/test/calendar-waste-{hattingen,pdf-text,fetch,
service,routes,cross-household}.test.ts`, `apps/api/test/fixtures/calendar/{record-items.ts,hattingen-2027.items.json}` (the PDF fixture
is committed and read-only), `docs/API.md` subsection "Waste", server catalog keys below the api-waste anchor.

### 3.4 Lane web (`m8/web`)

Owns everything under `apps/web/src/modules/calendar/` EXCEPT `index.ts` and `routes.tsx` (foundation's; the lane may edit `routes.tsx`
only to swap a placeholder import for the real screen at the same path and export name, and `index.ts` only for the `homeCard` and
`secondaryNavItems` icons; it reports both in its commit). The placeholder screens foundation created are the lane's to replace.

### 3.5 Integration (M8-T18, M8-T19, on `main`)

`apps/api/test/web-contract-calendar.test.ts`, `apps/api/test/docs-paths.test.ts`, `docs/SPEC.md`, `CLAUDE.md`, `docs/open-work.md`,
`docs/modules/calendar.md` (as built), `docs/API.md` (implementation notes), `docs/adr/0016-calendar-module.md` (status line only), this
plan's sections 9 and 10, and any fix the review finds (each its own commit).

## 4. Tasks

Every task: read CLAUDE.md "Conventions" and "Gotchas in use", `docs/modules/calendar.md` whole, this plan's sections 2 and 5;
before Effect code `repos/effect/LLMS.md` (whole, once per session) and the pattern files named in the task (`agent-patterns/`).
Commit per task (more commits are fine), the message naming the task id and ending with `Co-Authored-By: Claude Opus 5.5
<noreply@anthropic.com>`; never push; `git status --porcelain repos/` empty after every task; long commands in the background with a log
ending `exit=$?`, read from the log, never judged through a pipe. Never relax a test or gate to get green.

### Foundation lane

#### M8-T01 — Shared calendar package, module id, error codes, server catalogs (foundation)

Read: `agent-patterns/effect-schema.md`, `repos/effect/packages/effect/SCHEMA.md` (struct checks, `Schema.optional`, `NullOr`),
`packages/shared/src/core/schemas/checks.ts`, `packages/shared/src/modules/finance/{index.ts,schemas/common.ts,schemas/categories.ts}`,
`packages/shared/src/modules/recipe/schemas/plan.ts` (`PlanDateSchema` as a model; do not import it), `packages/shared/src/core/i18n/issues.ts`,
`packages/shared/test/finance-schemas.test.ts`.
Do:
1. `MODULE_IDS = ["recipe", "finance", "calendar"]`; `DEFAULT_ENABLED_MODULES` unchanged; update `packages/shared/test/core.test.ts`.
2. `packages/shared/src/modules/calendar/{dates,recurrence,people,limits,waste,index}.ts` (P2, P3, P9a; `CALENDAR_LIMITS` and
   `WASTE_PROVIDERS`, `WASTE_CATEGORIES`, `WASTE_DETAILS`, `isWasteSourceHost(provider, url)`) and `schemas/{common,entries,
   occurrences,resources,waste}.ts` with every name of section 5.1; re-export flat from `packages/shared/src/index.ts`.
3. The eight error codes in `ERROR_CODES` (with doc comments); every P21 key in `server.de.ts` and `server.en.ts` plus the two anchors;
   the eight rows in `docs/API.md` "Error codes" (module `calendar`).
4. P22 in `packages/shared/test/schema-golden-coverage.test.ts`; `packages/shared/test/calendar-schemas.test.ts`;
   `packages/shared/test/calendar-recurrence.test.ts` (P3's list); `packages/shared/test/calendar-dates.test.ts`.
Verify: `bun test packages/shared/test/calendar-recurrence.test.ts packages/shared/test/calendar-dates.test.ts
packages/shared/test/calendar-schemas.test.ts packages/shared/test/schema-golden-coverage.test.ts packages/shared/test/core.test.ts
packages/shared/test/household.test.ts`; `bun run typecheck`; `grep -rnE "new Date\(|Date\.now\(" packages/shared/src/modules/calendar`
empty.
Gotchas: "Validation details come from the wire-issue vocabulary" (struct checks do not run while a field fails: test each struct
rule with otherwise valid input); types are `Types.DeepMutable<typeof X.Type>`; module boundary inside the shared package (no import
from `../recipe` or `../finance`).

#### M8-T02 — API skeleton: tables, migration, manifest, layer, members service, registry (foundation)

Read: `agent-patterns/effect-services.md`, `agent-patterns/effect-http-api.md`; `apps/api/src/modules/finance/{index,layer,schema}.ts`,
`apps/api/src/modules/finance/routes/index.ts`, `apps/api/src/modules/{index,types,mount}.ts`, `apps/api/src/runtime.ts`,
`apps/api/test/{modules,import-order-effect,api-doc,db-placeholder-migration}.test.ts`, `apps/api/test/support/finance-harness.ts`.
Do:
1. `apps/api/src/modules/calendar/schema.ts` (P26), re-exported from `apps/api/src/db/schema.ts` (header updated); generate
   `apps/api/drizzle/0004_calendar.sql` + meta; `apps/api/test/db-calendar-migration.test.ts`.
2. `apps/api/src/modules/calendar/services/members.ts` (`CalendarMembers`, P27) with `apps/api/test/calendar-members-service.test.ts`.
3. Stubs the lanes replace: `services/entries/layer.ts` and `services/waste/layer.ts` (`Layer.empty`, area type `never`),
   `routes/core.index.ts` and `routes/waste.index.ts` (`calendarCoreApis()` / `calendarWasteApis()` returning `[]`,
   `calendarCoreHandlers()` / `calendarWasteHandlers()` returning `Layer.empty`), `hooks.ts` (`calendarOnMemberRemoving` =
   `Effect.void`), `seed.ts` (`seedCalendarDemo` = `Effect.void`); final `routes/index.ts` (`calendarHouseholdApis()` concatenates the
   two lists, `calendarHouseholdHandlers()` merges the two layers), `layer.ts` (P27), `index.ts` (`ApiModule<CalendarServices>`: `id`,
   `householdApi` lazily, `schema: calendarTables`, `layer: Layer.suspend(calendarLayer)`, `onMemberRemoving`, `seedDemo`).
4. Register in `apps/api/src/modules/index.ts` (`ModuleServices` adds `CalendarServices`); update the module-list pins of section 1.2
   (health and `API_MODULES` ids become `["recipe", "finance", "calendar"]`; enabled-module lists stay).
5. `apps/api/test/support/calendar-harness.ts` (`createCalendarHousehold(owner, name)`: plain household + `POST
   …/modules/calendar`; `calendarPath(householdId, rest)`; re-exports `createUser`, `call`, `body`, `addMember`, `addPlaceholder`).
6. `apps/api/test/calendar-module.test.ts`: manifest id and tables all `calendar_`; `/api/health` lists calendar; enable with no
   settings 200; `…/calendar/nope` 401 without cookie, 403 non-member, `404 module_disabled` when off, `404 not_found` when on.
7. P23: `api-doc.test.ts` prefixes and required section; the `docs/API.md` calendar section skeleton; the directory read in
   `import-order-effect.test.ts` (plus `./src/modules/calendar/routes/index.ts` and `./src/modules/calendar/index.ts` as entries).
Verify: `bun run typecheck`; `bun test apps/api/test/calendar-module.test.ts apps/api/test/calendar-members-service.test.ts
apps/api/test/db-calendar-migration.test.ts apps/api/test/api-doc.test.ts apps/api/test/import-order.test.ts
apps/api/test/import-order-effect.test.ts apps/api/test/modules.test.ts apps/api/test/runtime.test.ts apps/api/test/effect-idioms.test.ts`;
`(cd apps/api && bunx drizzle-kit generate --name m8_drift_check 2>&1 | grep -c 'No schema changes')` prints 1.
Gotchas: "One composition point, evaluated lazily", "Middleware, APIs and handler layers are TDZ-safe" (the manifest reads the API
lists through a getter and `Layer.suspend`), "API import cycle", "Migrations are generated", "Hooks are Effects".

#### M8-T03 — Web skeleton: manifest, routes, catalogs, data-layer skeleton, nav, persist, service worker (foundation)

Read: `apps/web/src/modules/finance/{index.ts,routes.tsx,HomeCard.tsx,catalogs/index.ts,catalogs/nav.de.ts,lib/queries.ts,
manifest.test.ts,persist.test.ts}`, `apps/web/src/modules/{index,catalogs,types}.ts`, `apps/web/src/route-roots.tsx`,
`apps/web/src/components/layout/nav-items.ts`, `apps/web/vite.config.ts` (`RUNTIME_CACHING`, ADR 0011).
Do:
1. `apps/web/src/modules/calendar/index.ts` (literal-typed, `satisfies WebModule<"calendar">`; icon `CalendarDays`; tabs Übersicht
   `/calendar` (exact), Monat `/calendar/month`, Aufgaben `/calendar/tasks`; sidebar Autos `/calendar/cars`, Müllabfuhr
   `/calendar/waste`; `persistQueryAllowList` of P24; no outbox, no `enableDialog`).
2. `routes.tsx`: layout `moduleLayoutComponent("calendar")` under `householdScopedRoute`, every route of section 5.5 as a
   `lazyRouteComponent` with its `validateSearch` (`pick`), and one placeholder screen per route under `features/…` (renders
   `PhoneHeaderRow` and the module name; no new German).
3. `HomeCard.tsx` placeholder (title, a link to `/calendar`); `catalogs/{nav,common}.{de,en}.ts` and `catalogs/index.ts`
   (`calendar.module.name` "Kalender", the five nav labels); `lib/api.ts` (`CalendarApi = {}` with the base-path helper, `export *
   from "@/lib/api"`) and `lib/queries.ts` (`calendarKeys`, section 5.4).
4. Register in `apps/web/src/modules/index.ts` and `apps/web/src/modules/catalogs.ts`; update `WEB_MODULES` id pins in
   `apps/web/src/modules/{recipe,finance}/manifest.test.ts`.
5. `MAX_MODULE_TABS = 3` (doc comment cites ADR 0016); `nav-items.test.ts`: three enabled → three module tabs; four (a fake id) →
   three.
6. `RUNTIME_CACHING`: `/\/api\/households\/[^/]+\/calendar\//` `NetworkOnly`, after finance's rule, before the `NetworkFirst` one.
7. `apps/web/src/modules/calendar/persist.test.ts` (imports `./index` first; the five persisted segments, a foreign segment refused).
Verify: `bun run typecheck`; `bun test apps/web/src/modules apps/web/src/components/layout`; `bun run build` (background) succeeds.
Gotchas: "`MessageKey` must stay a literal union", "A module owns its layout route and its static import graph stays shell-free"
(the manifest, `routes.tsx`, `HomeCard.tsx` and catalogs never import `@/modules`, `@/components/layout` or `use-nav-items`),
"No module-level constants over `WEB_MODULES`", "The route tree is strict, with one hole", "Service worker".

#### M8-T04 — Tokens, i18n rule, foundation gates (foundation)

Do: P29 (`theme.css` four blocks, `index.css` mappings, `calendar-tokens.test.ts`, the count comment); `scripts/i18n-check.ts`:
`NEW_GERMAN_NAMESPACES = new Map([["calendar.", "M8 calendar module, no source repository (ADR 0016)"], ["server.calendar.", "…"]])`,
parity skips a key whose prefix is listed, the leftover scan unchanged; `ALLOW_LIST` gains `apps/api/src/modules/calendar/seed.ts` and
`apps/api/src/modules/calendar/services/waste/hattingen.ts` (flyer vocabulary: month and weekday names). Then the full gates.
Verify (`L` = a scratch log directory outside the repo): `bun test apps/web/src/styles`; `bun run i18n:check > $L/i18n.log 2>&1; echo
"exit=$?" >> $L/i18n.log`: parity `OK`, leftover count 148 (each new hit classified or fixed); `bun test > $L/test.log 2>&1; echo
"exit=$?" >> $L/test.log`: 0 fail, pass count above 15236; `bun run typecheck`; `bun run build` (log); `git status --porcelain repos/` empty. Record the counts in the commit body.
Exit of the foundation: everything above green on `main`; the lanes branch from this commit.

### Lane api-core

Read first (the lane brief): CLAUDE.md "Gotchas in use" → Database and API (all); `agent-patterns/{effect-services,effect-errors,
effect-http-api,effect-testing,effect-datetime-clock}.md`; `apps/api/src/modules/finance/services/categories/categories.service.ts`,
`apps/api/src/modules/finance/routes/{tags.api,tags,transactions.api,transactions}.ts`,
`apps/api/src/modules/finance/services/participants/participants.service.ts` (`ValidationFailed` with details), `apps/api/test/
finance-cross-household.test.ts`, `apps/api/test/support/{effect,calendar-harness}.ts`; this plan P3-P14, P27; design §1, §2, §6.

#### M8-T05 — Entry, occurrence, resource and conflict services

Files: `apps/api/src/modules/calendar/services/entries/{entries.service,occurrences.service,resources.service,conflicts.service,
rows,layer}.ts` (`rows.ts`: row ↔ DTO mapping and the entry loader shared by the four). Services `CalendarEntries` (`list`, `get`,
`create`, `update`, `remove`), `CalendarOccurrences` (`list(householdId, query)`, `setStatus(householdId, entryId, date, status,
userId)`), `CalendarResources` (`list`, `create`, `update`, `remove`), `CalendarCarConflicts` (`check(householdId, candidate,
excludeEntryId)`). `Effect.fn("CalendarEntries.create")` style, `return yield* new …`, every by-id read filtered by `householdId`.
Tests (`runTest` / `itEffect` over the runtime's database): `apps/api/test/calendar-entries.test.ts` (P6 matrix row by row, P7 merge
and orphan-state deletion, P8 refusals with a hand-inserted waste entry), `apps/api/test/calendar-occurrences.test.ts` (expansion over
the DB at range edges, multi-day, rotation picks on a long series, filters and order of P10, states of P12, P4 caps),
`apps/api/test/calendar-car-conflicts.test.ts` (single vs single, all-day vs timed, recurring vs single and recurring vs recurring
within and beyond the horizon, skipped occurrences, PATCH excludes self, `allowConflict`), `apps/api/test/calendar-resources.test.ts`.
Verify: `bun test apps/api/test/calendar-` (prefix filter); `bun run typecheck`; `bun test apps/api/test/effect-idioms.test.ts`.

#### M8-T06 — Routes: entries, occurrences, resources

Files: `routes/{entries.api,entries,occurrences.api,occurrences,resources.api,resources,core.index}.ts`. Groups
`calendar.entries`, `calendar.occurrences`, `calendar.resources`, each `.pipe(chain(RequireVerifiedEmail))`, each API built with
`householdModuleApi("calendar", HttpApi.make("calendar.<x>").add(group))`; endpoints and names exactly section 5.2; handlers
`UNINTERRUPTIBLE`, bodies through `jsonBody(Schema)`, queries through `queryParams(Schema)`, `created(...)` for 201, `noContent()`.
`docs/API.md` rows for every route in the api-core subsection (Auth column `household:member+module:calendar(+verified for writes)`,
request and response schema names, every status). Tests: the route-level cases in the four test files of M8-T05 (status codes,
`email_unverified` on a write with `setVerifiedEmailRequired(true)`, 422 `details` shape) or a new `apps/api/test/calendar-routes.test.ts`.
Verify: `bun test apps/api/test/calendar- apps/api/test/api-doc.test.ts apps/api/test/import-order-effect.test.ts
apps/api/test/modules.test.ts`; `bun run typecheck`.
Gotchas: "Middleware chain order is load-bearing" (no own `RequireSession`/`RequireHouseholdMember`; `chain`, never `.middleware`),
"Middleware, APIs and handler layers are TDZ-safe" (an `X.api.ts` imports only `effect`, `effect/http-api`, types,
`lib/errors.ts` and `http/middleware.ts`), "The error family and the one boundary mapper".

#### M8-T07 — Hooks and seed

Files: `apps/api/src/modules/calendar/{hooks,seed}.ts` (P14, P25), `apps/api/test/calendar-members.test.ts` (removing a member through
`DELETE /api/households/:id/members/:userId`: attendee rows gone, rotation renumbered and degraded to fixed/none, waste assignees,
placeholder removal not vetoed), `apps/api/test/calendar-seed.test.ts` (`seedCalendarDemo` twice on a scratch `Database.layerFrom`:
same row counts; every design §6 item present; the synthetic waste rows tour 4).
Verify: `bun test apps/api/test/calendar-members.test.ts apps/api/test/calendar-seed.test.ts apps/api/test/scripts-seed.test.ts`;
`D=$(mktemp -d); NODE_ENV=development DATABASE_URL=file:$D/s.db SESSION_SECRET=0123456789abcdef0123 bun run seed` twice, exit 0 both.

#### M8-T08 — Cross-household sweep

File: `apps/api/test/calendar-cross-household.test.ts` in finance's shape: households A and B with calendar enabled, B owns an event,
a task with a state, a car with a booking; with A's cookie every by-id route of `entries.api.ts`, `occurrences.api.ts`,
`resources.api.ts` addressed with B's ids answers `404 not_found`; a create/PATCH naming B's `resourceId` is 404, naming B's member
is 422 `memberNotInHousehold`; a coverage test reads those three `.api.ts` files and fails for a `:param` endpoint without a probe.
Verify: `bun test apps/api/test/calendar-cross-household.test.ts`; then the lane gate: `bun test` (background log, 0 fail),
`bun run typecheck`, `bun run i18n:check` parity OK, `git status --porcelain repos/` empty.

### Lane api-waste

Read first (the lane brief): design §5 whole (the traps); CLAUDE.md "The recipe module's services and the URL import guard" (the
shape, not the code), "Catch-all stays catch-all", "The error family"; `agent-patterns/{effect-services,effect-errors,
effect-http-client,effect-http-api,effect-testing}.md`, `repos/effect/ai-docs/src/50_http-client/`; `apps/api/src/modules/recipe/
services/import/url/fetch.ts` and `apps/api/src/modules/recipe/services/ocr/pdf.ts` (shape only, never imported);
`apps/api/src/modules/recipe/routes/imports.ts` (multipart reading); this plan P15-P20, P27.

#### M8-T09 — `WastePdfText` and the recorded items

Files: `services/waste/pdf-text.ts` (P18), `apps/api/test/fixtures/calendar/record-items.ts` (run once: `bun
apps/api/test/fixtures/calendar/record-items.ts` writes `hattingen-2027.items.json`; deterministic, sorted, rounded to 0.1 pt),
`apps/api/test/calendar-waste-pdf-text.test.ts` (extraction of the fixture equals the recorded JSON; > 6 pages, an encrypted file with
a user password (built in the test with a tiny hand-written PDF or skipped with the reason in a comment and an open-work note), a
non-PDF → the P18 checks).
Verify: `bun test apps/api/test/calendar-waste-pdf-text.test.ts`.

#### M8-T10 — The Hattingen parser, test-first

Files: first `apps/api/test/calendar-waste-hattingen.test.ts` (design §5.4 table as data, every row; 365 dates; determinism; the
cleaning details on 03-19, 07-01, 10-18; `selectTour` for tours 1, 4, 9; a block with a shifted weekday column is discarded; a
disagreement between two valid blocks fails `consensus`; a missing month fails `months`), committed failing-then-green in two commits
(`M8-T10 test`, `M8-T10 parser`); then `services/waste/hattingen.ts` (P19, design §5.3). The tour-4 R count is pinned in a third
commit once everything else passes.
Verify: `bun test apps/api/test/calendar-waste-hattingen.test.ts`; `grep -nE "new Date\(|Date\.now\(" apps/api/src/modules/calendar`
empty.

#### M8-T11 — `WasteFlyerFetch`

Files: `services/waste/fetch.ts` (P17: `checkWasteSourceUrl` pure, the hop loop over `HttpClient`, the caps), `apps/api/test/
calendar-waste-fetch.test.ts` with an `HttpClient` test layer (`HttpClient.make` answering per URL): https only, exact hosts, a
redirect to a foreign host refused before it is requested (the test client records every request), 6 redirects, a 404, a
`Content-Length` above the cap, a streamed body above the cap, a slow body under `TestClock`, no `traceparent` header.
`WasteFlyerFetch.layerTest(bytesByUrl)` serves the fixture for the other tests. No test reaches the network.
Verify: `bun test apps/api/test/calendar-waste-fetch.test.ts`.

#### M8-T12 — `CalendarWaste`, the routes, the sweep

Files: `services/waste/{waste.service,upload,layer}.ts` (overview P16, settings P15, preview, import P20, delete; `upload.ts` reads the
multipart body itself), `routes/{waste.api,waste,waste.index}.ts` (group `calendar.waste`, section 5.2), `docs/API.md` "Waste" rows,
tests `apps/api/test/calendar-waste-service.test.ts` (import twice replaces and carries states, rotation per pickup day, settings
re-assignment from `today`, `next`), `apps/api/test/calendar-waste-routes.test.ts` (upload and URL paths with the test fetch layer,
413/415/422/400/502 refusals, preview writes nothing), `apps/api/test/calendar-waste-cross-household.test.ts` (B's `importId` → 404,
coverage over `waste.api.ts`).
Verify: `bun test apps/api/test/calendar-waste`; lane gate as M8-T08's.

### Lane web

Read first (the lane brief): design §4 and §5.6 whole; CLAUDE.md "Web shell" gotchas (all) and "Conventions" (query keys, German
copy, module boundary); `apps/web/src/modules/finance/{lib/api.ts,lib/queries.ts,lib/api.test.ts,HomeCard.tsx,components/PageHeader.tsx,
phone-header.test.ts,manifest.test.ts}`, `apps/web/src/modules/recipe/features/plan/`, `apps/web/src/components/ui/index.ts`,
`apps/web/src/lib/{api,validation,nav,queries}.ts`, `apps/web/src/styles/{theme,index}.css`, `apps/web/src/styles/design-system.test.ts`
(its rules: no `text-[…]`, no glyph arrows/checks/chevrons as text, no `bottom-0`, no `font-display` with `font-semibold`, no bare `fr`,
no `uppercase` + `tracking-`; use `.eyebrow`, lucide icons, `grid-cols-7`); this plan P9, P24 and section 5. The lane cannot run the
API lanes' code: it codes against the shared schemas and section 5, and its unit tests stub `fetch` as `apps/web/src/modules/finance/lib/
api.test.ts` does.

#### M8-T13 — Data layer and helpers

Files: `lib/api.ts` (one `CalendarApi` member per endpoint of section 5.2 plus a facade per member), `lib/queries.ts` (query options,
mutations, the optimistic done toggle, the offline guard), `lib/{format,group,rhythm,people}.ts` with `lib/{api,queries,format,group,
rhythm,people}.test.ts` (date and time labels in German and English, grouping by day with one merged waste row per day, "Heute
Abend rausstellen" from tomorrow's pickups, rhythm in words for every freq, colour lookup).
Verify: `bun test apps/web/src/modules/calendar/lib`; `bun run typecheck`.

#### M8-T14 — Components, Übersicht, Home card

Files: `components/{CalendarPageHeader,OccurrenceRow,PersonDot,WasteDot,DayHeading,MemberFilterChips}.tsx`,
`features/agenda/{AgendaPage,components/TodayCard,components/CarStatusCard,components/NextPickupsCard}.tsx`, `HomeCard.tsx` (the
real one; it stays in the manifest graph, so it imports neither `CalendarPageHeader` nor the layout), catalogs `agenda`, `home`,
`common` (de, en).
Verify: `bun test apps/web/src/modules/calendar`; `bun run typecheck`.

#### M8-T15 — Monat and Aufgaben

Files: `features/month/{MonthPage,components/MonthGrid,components/DayList}.tsx`, `features/tasks/{TasksPage,components/OpenTasks,
components/TaskSeries,components/WasteSummaryCard}.tsx`, catalogs `month`, `tasks`.

#### M8-T16 — Neu/Bearbeiten, occurrence detail, Autos

Files: `features/entries/{NewEntryPage,EditEntryPage,OccurrenceDetailPage,components/EntryForm,components/RepeatFields,
components/WhoFields,components/CarConflictNotice}.tsx`, `features/cars/CarsPage.tsx`, catalogs `entries`, `cars`. The form decodes
with `@/lib/validation` over `CreateCalendarEntryRequestSchema` / `UpdateCalendarEntryRequestSchema`, shows the conflict's `details`
with "Trotzdem buchen" (`allowConflict: true`), and guards unsaved input with `useNavigationGuard`.

#### M8-T17 — Müllabfuhr, guards, lane gate

Files: `features/waste/{WastePage,components/WasteSettingsForm,components/WasteImportDialog,components/WasteImportList}.tsx` (tour
1-9, the provider's default URL prefilled, "PDF hochladen" alternative through `sendForm`, the preview's counts and warnings before
"Importieren", the refusal messages of P17 per code), catalogs `waste` (the five type labels of design §5.6), `phone-header.test.ts`
(every lazy screen of `routes.tsx` renders `CalendarPageHeader` or `PhoneHeaderRow`; `CalendarPageHeader` renders the row),
`manifest.test.ts` (imports `./index` first: identity, tabs, sidebar items, every route of section 5.5 lazy, registry order recipe,
finance, calendar, outside a module Home · Rezepte · Finanzen · Kalender · Profil).
Verify: `bun test apps/web/src/modules/calendar`; the LINKS grep `grep -rnoE "[\"'\`]/(recipe|finance|month|tasks|cars|waste|new|entries)
[/\"'\`?]" apps/web/src/modules/calendar` empty (every in-module literal starts with `/calendar`); lane gate: `bun run typecheck`, `bun
test` (log), `bun run build` (log), `bun run i18n:check` parity OK and leftover count unchanged.

### Integration

#### M8-T18 — Merge, contract test, docs as built, gates

1. Merge `m8/api-core`, `m8/api-waste`, `m8/web` (`--no-ff`, in that order); resolve only anchor-adjacent conflicts; run `bun
   install --frozen-lockfile`.
2. `apps/api/test/web-contract-calendar.test.ts` in the shape of `web-contract-finance.test.ts`: every route the web decodes (section
   5.2 column "web decodes"), decode with `{ disableChecks: true }`, the decoded value `toEqual` the body; the void rows; a waste
   household imported through the test fetch layer; no `lenient` row expected (one needs its `lenient(X)` in the client).
3. Docs: `docs/SPEC.md` D2, D6, D7, D8, §2, §3, §5 per ADR 0016; `docs/modules/calendar.md` rewritten "as built" in the shape of
   `docs/modules/finance.md` (1.x what it owns with the service table and files, the P9 refinements, section 4a gotchas from this
   milestone, section 5 verification commands); `docs/open-work.md` (design §7 items as deferred X-items, anything this run defers);
   `CLAUDE.md` (Status with the new gate counts, Layout, Commands for the calendar seed data, the module-gotcha index for
   `docs/modules/calendar.md`, ADR 0016 in the ADR list); `apps/api/test/docs-paths.test.ts` scans `docs/modules/calendar.md`;
   `docs/adr/0016-calendar-module.md` status.
4. Gates on the merged tree: typecheck, `bun test` (log; count recorded), `bun run build` (log; gzipped bundle recorded),
   `bun run i18n:check` (parity OK, leftover hits classified), `git status --porcelain repos/`, `bash docs/plans/e8-verify.sh all` if it
   still applies, the fixture seed on a scratch DB.
Verify: all of item 4; `bun test apps/api/test/web-contract-calendar.test.ts apps/api/test/docs-paths.test.ts apps/api/test/api-doc.test.ts`.

#### M8-T19 — Review, fixes, headless check, the record

1. Review the merged diff against design §1-§6 and this plan's decisions (a code review at high effort); each finding fixed in its
   own commit with a test.
2. Headless (CLAUDE.md "Headless runs"): seeded scratch DB, built app served by `WEB_DIST_DIR=./apps/web/dist bun run start`;
   Playwright in a scratch directory outside the repo; demo login with a saved `storageState`; enable Kalender on Home; at 390 (mobile
   context) and 1440 every screen of section 5.5 with `scrollWidth <= clientWidth` and no element beyond `innerWidth + 0.5`; the
   phone tab bar outside a module shows Start · Rezepte · Finanzen · Kalender · Profil; toggle a task done and back; a car booking
   that conflicts shows the notice and "Trotzdem buchen" saves; the waste upload of the fixture with tour 4 previews and imports, the
   Aufgaben card shows the next pickups; the CSP is clean in the console at a second origin; screenshots to
   `docs/plans/screenshots/m8/`.
3. Sections 9 and 10 of this plan; commit.

## 5. The cross-lane contract

### 5.1 Shared names (`@toon/shared`, flat)

Values: `CALENDAR_LIMITS` (`maxRangeDays 400`, `maxOccurrencesPerEntry 2000`, `conflictHorizonDays 366`, `conflictDetailsMax 10`,
`titleMax 200`, `locationMax 200`, `notesMax 2000`, `resourceNameMax 60`, `attendeesMax 20`, `rotationMax 12`, `intervalMax 99`,
`wastePdfMaxBytes 10485760`, `wastePdfMaxPages 6`, `wasteTimeoutMs 20000`, `wasteRedirectsMax 5`), `CALENDAR_WEEKDAYS`
(`["MO","TU","WE","TH","FR","SA","SU"]`), `CALENDAR_PERSON_COLORS` (6), `WASTE_PROVIDERS`, `WASTE_CATEGORIES`, `WASTE_DETAILS`;
functions of P2, P3, `calendarPersonColors`, `isWasteSourceHost`; types `CalendarSeries`, `CalendarOccurrenceDate`, `WasteCategory`,
`WasteProviderId`.

Schemas (each with its `Types.DeepMutable` type of the same name minus `Schema`):

| File | Schemas |
| --- | --- |
| `schemas/common.ts` | `CalendarDateSchema`, `CalendarTimeSchema`, `CalendarEntryKindSchema`, `CalendarRepeatFreqSchema`, `CalendarWeekdaySchema`, `CalendarAssigneeModeSchema`, `CalendarOccurrenceStatusSchema`, `CalendarWasteCategorySchema`, `CalendarWasteDetailSchema`, `CalendarWasteProviderSchema`, `CalendarMemberSchema` |
| `schemas/entries.ts` | `CalendarRepeatSchema` (`freq, interval, weekdays, until`), `CreateCalendarEntryRequestSchema`, `UpdateCalendarEntryRequestSchema`, `CalendarEntrySchema`, `CalendarEntryListQuerySchema` (`kind?, recurring?`), `CalendarEntryListResponseSchema`, `CalendarCarConflictSchema` |
| `schemas/occurrences.ts` | `CalendarOccurrenceQuerySchema` (`from, to, memberId?, kind?`), `CalendarOccurrenceSchema`, `CalendarOccurrenceListResponseSchema` (`items, members`), `SetCalendarOccurrenceStatusRequestSchema` |
| `schemas/resources.ts` | `CalendarResourceSchema` (`id, kind, name, archived, archivedAt, createdAt`), `CalendarResourceListQuerySchema`, `CalendarResourceListResponseSchema`, `CreateCalendarResourceRequestSchema`, `UpdateCalendarResourceRequestSchema` |
| `schemas/waste.ts` | `CalendarWasteSettingsSchema` (`provider, tour, sourceUrl, assigneeMode, assigneeIds, updatedAt`), `PutCalendarWasteSettingsRequestSchema` (`provider, tour, assigneeMode, assigneeIds, today`), `CalendarWasteImportSchema` (`id, provider, year, tour, source, sourceName, entryCount, importedAt, importedBy`), `CalendarWastePickupSchema` (`category, date, detail`), `CalendarWasteOverviewQuerySchema` (`from`), `CalendarWasteOverviewResponseSchema` (`settings, imports, next`), `CalendarWasteSourceRequestSchema` (JSON `{ provider?, tour, url }`), `CalendarWasteUploadFieldsSchema` (multipart `tour` as a numeric string), `CalendarWastePreviewSchema` (`provider, year, tour, counts, dates, warnings: { code, date }[]`), `CalendarWasteImportResponseSchema` (`import, entryCount`) |

`CalendarEntrySchema` = `{ id, householdId, kind, title|null, notes|null, location|null, allDay, startDate, startTime|null, endDate,
endTime|null, repeat, attendeeIds, assigneeMode, assigneeIds, resourceId|null, category|null, categoryDetail|null, wasteImportId|null,
createdBy|null, createdAt, updatedAt }`. `CalendarOccurrenceSchema` = design §2 (`id "<entryId>:<date>"`, `entryId, kind, title|null,
category|null, categoryDetail|null, date, endDate, allDay, startTime|null, endTime|null, location|null, recurring, memberIds,
assigneeId|null, resourceId|null, status, doneBy|null`).

### 5.2 Routes (below `/api/households/:householdId/calendar`; every group `chain(RequireVerifiedEmail)`)

| Method | Path | Group.endpoint | Request | Answer | Lane | Web decodes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/occurrences` | `calendar.occurrences.list` | `CalendarOccurrenceQuerySchema` | `CalendarOccurrenceListResponseSchema` | core | yes |
| PUT | `/entries/:entryId/occurrences/:date` | `calendar.occurrences.setStatus` | `SetCalendarOccurrenceStatusRequestSchema` | `CalendarOccurrenceSchema` | core | write |
| GET | `/entries` | `calendar.entries.list` | `CalendarEntryListQuerySchema` | `CalendarEntryListResponseSchema` | core | yes |
| GET | `/entries/:entryId` | `calendar.entries.get` | – | `CalendarEntrySchema` | core | yes |
| POST | `/entries` | `calendar.entries.create` | `CreateCalendarEntryRequestSchema` | 201 `CalendarEntrySchema` | core | write |
| PATCH | `/entries/:entryId` | `calendar.entries.update` | `UpdateCalendarEntryRequestSchema` | `CalendarEntrySchema` | core | write |
| DELETE | `/entries/:entryId` | `calendar.entries.remove` | – | 204 | core | void |
| GET | `/resources` | `calendar.resources.list` | `CalendarResourceListQuerySchema` | `CalendarResourceListResponseSchema` | core | yes |
| POST | `/resources` | `calendar.resources.create` | `CreateCalendarResourceRequestSchema` | 201 `CalendarResourceSchema` | core | write |
| PATCH | `/resources/:resourceId` | `calendar.resources.update` | `UpdateCalendarResourceRequestSchema` | `CalendarResourceSchema` | core | write |
| DELETE | `/resources/:resourceId` | `calendar.resources.remove` | – | 204 | core | void |
| GET | `/waste` | `calendar.waste.overview` | `CalendarWasteOverviewQuerySchema` | `CalendarWasteOverviewResponseSchema` | waste | yes |
| PUT | `/waste/settings` | `calendar.waste.putSettings` | `PutCalendarWasteSettingsRequestSchema` | `CalendarWasteSettingsSchema` | waste | write |
| POST | `/waste/preview` | `calendar.waste.preview` | JSON `CalendarWasteSourceRequestSchema` or multipart `file` + `CalendarWasteUploadFieldsSchema` | `CalendarWastePreviewSchema` | waste | write |
| POST | `/waste/import` | `calendar.waste.import` | as preview | 201 `CalendarWasteImportResponseSchema` | waste | write |
| DELETE | `/waste/imports/:importId` | `calendar.waste.removeImport` | – | 204 | waste | void |

Statuses per route: 200/201/204, 401, 403 (`forbidden` non-member, `email_unverified` on writes), 404 (`module_disabled`, `not_found`),
422 `validation_failed`, plus the route's own codes of P4, P8, P11-P13, P17.

### 5.3 Services (API, `Context.Service`, each with a static `layer`, no accessors)

`CalendarMembers` (foundation); `CalendarEntries`, `CalendarOccurrences`, `CalendarResources`, `CalendarCarConflicts` (api-core);
`WastePdfText`, `WasteFlyerFetch`, `CalendarWaste` (api-waste). `CalendarServices` = all eight. Route-list functions:
`calendarCoreApis()` / `calendarCoreHandlers()` (`routes/core.index.ts`), `calendarWasteApis()` / `calendarWasteHandlers()`
(`routes/waste.index.ts`), merged by `calendarHouseholdApis()` / `calendarHouseholdHandlers()` (`routes/index.ts`). Hooks:
`calendarOnMemberRemoving` (`hooks.ts`), `seedCalendarDemo` (`seed.ts`).

### 5.4 Web query keys and API (`apps/web/src/modules/calendar/lib/`)

`calendarKeys.all(h)` = `["toon","household",h,"calendar"]`; `.occurrences(h, from, to, filters)` = `[…all, "occurrences", from, to,
filterKey(filters)]`; `.entries(h, filters)` = `[…all, "entries", filterKey(filters)]`; `.entry(h, id)` = `[…all, "entry", id]`;
`.resources(h, includeArchived)` = `[…all, "resources", { includeArchived }]`; `.waste(h, from)` = `[…all, "waste", from]`.
`CalendarApi` members: `fetchOccurrences`, `setOccurrenceStatus`, `fetchEntries`, `fetchEntry`, `createEntry`, `updateEntry`,
`deleteEntry`, `fetchResources`, `createResource`, `updateResource`, `deleteResource`, `fetchWaste`, `putWasteSettings`,
`previewWasteFromUrl`, `previewWasteFromFile`, `importWasteFromUrl`, `importWasteFromFile`, `deleteWasteImport`.

### 5.5 Web routes (all lazy screens below `/calendar`)

`/calendar` `features/agenda/AgendaPage`; `/calendar/month` (`month`, `day`) `features/month/MonthPage`; `/calendar/tasks`
`features/tasks/TasksPage`; `/calendar/new` (`kind`, `date`) `features/entries/NewEntryPage`; `/calendar/entries/$entryId` (`date`)
`features/entries/OccurrenceDetailPage`; `/calendar/entries/$entryId/edit` `features/entries/EditEntryPage`; `/calendar/cars`
`features/cars/CarsPage`; `/calendar/waste` `features/waste/WastePage`. Named exports equal the file names.

## 6. Risks

- **The parser on hidden copies** (design §5.3). Mitigation: test-first against the committed fixture and the eye-verified table; a
  block that fails the calendar check is discarded, never repaired; a refusal names its check.
- **pdf.js memory and time in the 1-CPU image.** Dynamic import, one permit, 20 s timeout (P18); measured once in M8-T19 through the
  built app.
- **Merge conflicts in the shared regions.** Removed by the anchors and the split route and layer files (P1, P21, P23, P27); what
  remains (import-order list, `docs/API.md`) is resolved by M8-T18 and recorded.
- **The web lane codes blind.** Mitigation: section 5 is final at foundation; the contract test of M8-T18 decodes every read; a
  mismatch is fixed on the API side if the design says so, else in the client, and recorded.
- **Tab bar at five items** (ADR 0016): checked headless at 390 in M8-T19.
- **Recurrence edge cases in the rotation** (long series, skipped months): pinned against a naive enumerator (P3).

## 7. Deviations expected (each recorded in section 10 when it happens)

- P9 (a) `members` in the occurrence list answer and (b) `GET /entries` beyond the design's API table.
- P15 waste assignees resolved per pickup day and stored as `fixed`.
- P8 DELETE of an imported waste entry refused.
- P22 the golden-coverage test narrowed to the E1 corpus with a calendar guard beside it.

## 8. Out of this milestone

Design §7 (per-occurrence edits, reminders, an ICS feed, offline writes, other cities, a street search over the flyer's directory, ICS
import, sharing outside the household); M8-T18 records them in `docs/open-work.md`.

## 9. Integration record

To be written by M8-T18 and M8-T19: the gate logs (typecheck, test count, build and bundle size, i18n classification), the merge
conflicts and how they were resolved, the fixture seed run, the headless pass (screens, sizes, findings), the parser's tour-4 count.

## 10. What changed vs plan

To be written by M8-T19.
