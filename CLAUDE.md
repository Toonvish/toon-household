# CLAUDE.md — toon-household

The household app: `toon-recipe` and `toon-finance` merged into one modular Bun/Effect/React PWA, with room for
more modules. The next session has no memory of this one, so the docs are the spec. This file holds the core and
the cross-cutting rules; each module's knowledge lives in its own doc (`docs/modules/<id>.md`).

## Read order

1. `docs/SPEC.md` — the fixed decisions (§1), the module contract (§2), the target layout (§3), the schema mapping
   (§4), the shell (§5), the migration (§6), the gates (§7), the milestones (§8).
2. This file.
2b. `docs/EFFECT.md` — the Effect migration spec: the fixed decisions E1–E12 (on top of D1–D15), how an agent
   learns Effect here (the vendored source under `repos/effect`, the pattern files under `agent-patterns/`),
   the target architecture and the milestones E0–E8. Read it before any Effect work. Before writing Effect code
   read `repos/effect/LLMS.md` and the pattern files under `agent-patterns/` first ("Vendored reference code"
   below).
3. Before touching a module, its doc: `docs/modules/recipe.md`, `docs/modules/finance.md` or `docs/modules/calendar.md`
   (what the module owns, its source's locked decisions with their status here, its gotchas, the source's gotchas mapped
   one by one; the calendar has no source repository).
4. The two source repos are archived on GitHub (`Toonvish/toon-recipe`, `Toonvish/toon-finance`) and this repo
   no longer reads them: their locked decisions and gotchas are mapped one by one in the module docs (step 3)
   and stay binding inside the module that inherits them (SPEC D13). Consult an archive only as history.
5. `docs/API.md` — the HTTP contract: conventions, error codes, middleware chain and mount order, security, every
   core endpoint, then the sections "Recipe module" and "Finance module" (one table row per served route).
6. `docs/migration.md` — the operator's guide to `migrate:legacy` (inputs, rules, report, cutover order).
7. `docs/deployment.md` — the operator's guide to the stack (fresh install, operations, the cutover from
   toon-edge, variants, the local stack test).
8. `docs/open-work.md` — what is deliberately not done (owner actions and decisions, deferred, observations).
9. `docs/adr/` — one record per deviation from SPEC §1 (`NNNN-slug.md`: date, context, decision, consequences;
   the ADR edits the SPEC text in the same commit).
10. `docs/plans/` — one plan per milestone (`docs/plans/m0-scaffold.md` …): tasks, files, verify commands, the
    integration record and "what changed vs plan". Dated records: history lives there, not here.

## Fixed decisions

SPEC §1 (D1–D15) is fixed and changes only through an ADR. Do not re-litigate a decision in code or review; if a
task forces a deviation, make the smallest one and record it. The ADRs so far (`docs/adr/`): 0001 household
copy without recipe counts (D10); 0002 finance's generic Zod messages use the core's wording (D10); 0003 finance
tests on the shared memory DB (D13), superseded by 0009; 0004 finance participant churn rules (`409
member_has_ledger`, the slot-1 re-seat, `onMemberRemoving`; D3, D13); 0005 ledger states only the legacy
migration may write (D2, D3, SPEC §6); 0006 placeholder members and claim invites (D1, D4, D12, SPEC §4, §6);
0007 toon-finance `1715207` adaptations: leave rule, CSP additions, origin guard trusting `WEB_ORIGIN` (D13); 0008
old hostnames map their own paths and retire their service workers (D11); 0009 the whole test suite on a temp file
DB (restores toon-finance gotcha 2); 0010 a header row per shell screen instead of a global top bar (D1, D6); 0011
the service worker's runtime rules are the union of both sources' (D9, D13); 0012 Effect is the application
framework (E1–E12; amends D10's wording); 0013 validation details come from the one schema adapter (E4; plan
`docs/plans/e1-shared-schema.md` P7, P9, P10: every route's `details` carry the catalog message and `i18n`, a
struct's own checks do not run while one of its fields fails); 0014 transitional bridges while the core moves onto
Effect (E5, E7; plan `docs/plans/e2-api-core-services.md` P1, P6, P11, P17: the process-wide database instance, the
legacy bridges with their calling conventions, the Promise module contract, the test seams; closed at E8, "Status after
E8": the 19 test-only doors live in `apps/api/test/support/bridges/`, the seams and the import-time client stay); 0015 the HttpApi server:
what E7 does differently from `docs/EFFECT.md` (E8; plan `docs/plans/e7-http-api.md` D1 to D7, P3, P12: CORS, the origin
guard, the security headers and the request log are global router middleware and there is no locale middleware, a module
contributes `HttpApi`s that wrap its groups, endpoints declare no payload or success schema, the bounded stop with the
server fiber outside the runtime's fiber scope); 0016 a third module, `calendar` (M8; D2, D5, D6, D7, D8, D10, SPEC §2, §5:
`MODULE_IDS` gains `calendar`, three module tabs outside a module, eleven waste and person tokens, new German admitted by
namespace, an exact-host outbound fetch of the waste flyer).

`docs/EFFECT.md` §1 (E1–E12) is fixed in the same way as D1–D15: it changes only through an ADR, and a task that
forces a deviation makes the smallest one and records it (ADR 0012, `docs/adr/0012-effect-application-framework.md`).

## Building it

The app itself is built (see "Status"); the build workflow that did it (`build-household.js`, SPEC §8) was
removed in commit `7788b45` and lives in git history only.

**The Effect migration is done** (E0 foundation … E8 harden, `docs/EFFECT.md` §4). It was built by
`.claude/workflows/migrate-effect.js` (per milestone: Learn from the vendored source and distil the pattern files, Plan with three
critics, Implement in parallel worktrees, Review against the exit criteria, Harden), which wrote one plan per milestone under
`docs/plans/`, committed per task and never pushed. The workflow file stays as history; nothing in the tree needs it. A later change
follows "Conventions" and "Gotchas in use" directly, with its own plan under `docs/plans/` and an ADR for any deviation from §1 of
`docs/SPEC.md` or `docs/EFFECT.md`.

## Vendored reference code

`repos/effect` is the Effect source, vendored as a squashed `git subtree` of `https://github.com/Effect-TS/effect.git`
at the release tag `effect@4.0.5` (squash commit `e54b8022a`, merge commit `60828f2e6`, subtree split `7f524e25c`,
which IS the tag). It is the documentation: this repo's models remember Effect 3, and Effect 4 renamed a great
deal, so every Effect signature is looked up in the vendored source, never recalled and never fetched from the
web (`docs/EFFECT.md` E2, §2).

- **Read order before writing Effect code (`docs/EFFECT.md` §2.1).** (1) `repos/effect/LLMS.md`, the library's own
  guide for coding agents, whole once per session. (2) The pattern file(s) for the modules the task touches.
  (3) The examples LLMS.md links under `repos/effect/ai-docs/src/` (`04_integration` for `ManagedRuntime`,
  `09_testing`, `40_sql`, `50_http-client`, `51_http-server`). (4) For schemas `repos/effect/packages/effect/SCHEMA.md`
  (large: in chunks), for HttpApi `repos/effect/packages/effect/HTTPAPI.md`, for config
  `repos/effect/packages/effect/CONFIG.md`. (5) For an API you remember from v3: `repos/effect/MIGRATION.md` and
  `repos/effect/migration/*.md`. (6) When the docs are silent: the source under
  `repos/effect/packages/effect/src/` and the package's `test/`.
- **Pattern files.** Twelve, under `agent-patterns/`: `effect-core.md`, `effect-schema.md`, `effect-services.md`,
  `effect-errors.md`, `effect-testing.md`, `effect-config.md`, `effect-datetime-clock.md`, `effect-stream.md`,
  `effect-http-client.md`, `effect-http-api.md`, `effect-http-server-bun.md`, `effect-cli.md`. Each ends with "In this repo",
  examples copied from the tree with their paths (E8 refreshed all twelve). A task that finds a wrong line in one fixes the file
  in the same commit; `apps/api/test/docs-paths.test.ts` checks every repo path they name.
- **v4, not v3.** `Context.Tag` / `Effect.Service` became `Context.Service` with a static `layer` and no accessors,
  `Effect.catchAll` became `Effect.catch`, `Either` became `Result`, `Schema.Union` and `Schema.Literals` take arrays,
  `.annotations()` became `.annotate()`, `.filter()` became `.check()`, `decodeUnknown` became
  `decodeUnknownEffect`, `@effect/platform/*` moved into `effect/*` and `effect/unstable/http` into `effect/http`.
  The full map is `repos/effect/migration/v3-to-v4.md`; read it whenever an API you remember is v3.
- **Rules (`docs/EFFECT.md` §2.4, pinned by `apps/api/test/effect-idioms.test.ts`).** `repos/` is read-only
  reference: nothing in `apps/`, `packages/` or `scripts/` imports from it, it is not a workspace, `bun install`,
  `bun test` and `tsc` are never run inside it, no file in it is edited, and `git status --porcelain repos/` is
  empty after every task.
- **The fences (E2).** `bunfig.toml` (`[test] pathIgnorePatterns = ["repos/**"]`, test discovery), `.dockerignore`
  (the line `repos`, the image), `.vscode/settings.json` (`search.exclude`, `files.watcherExclude`,
  `typescript.preferences.autoImportFileExcludePatterns`: the editor) and `server.watch.ignored` in
  `apps/web/vite.config.ts` (Vite's watcher).
- **Updating it.** Bump `effect` in the three `package.json` that name it (`packages/shared`, `apps/api`,
  `apps/web`) and `@effect/platform-bun` in `apps/api` together, as the same exact version, then in the SAME commit
  run `git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git effect@<version> --squash`,
  then the gates. The idioms test's version rules (one exact version everywhere, the vendored
  `repos/effect/packages/effect/package.json` equal to the installed `effect`) fail otherwise.

## Status

Built and migrated; every milestone is done. The app: M0 scaffold, M1 core, M2 recipe module, M3 finance module, M3b
finance-sync (toon-finance `cbdec67..1715207` plus placeholders), M4 design pass, M5 migration, M6 deploy and M7 harden
(2026-10-13 to 2026-10-15). The Effect migration (`docs/EFFECT.md` §4, 2026-10-16 to 2026-11-06): E0 foundation, E1
shared-schema (ADR 0013), E2 api-core-services, E3 recipe-services, E4 finance-services, E5 scripts (ADR 0014), E6 web-client,
E7 http-api (Hono gone, ADR 0015) and E8 harden (the test doors, idioms rules (15) to (21), the docs as built; ADR 0014
closed). M8 calendar module (2026-11-06, ADR 0016): the third module, `calendar` (Kalender: appointments, car bookings,
chores with rotation, the Stadt Hattingen waste flyer import by tour). Each milestone's record is the last two sections of its plan (the integration record with the gate logs, then "what
changed vs plan"): `docs/plans/m0-scaffold.md`, `docs/plans/m1-core.md`, `docs/plans/m2-recipe-module.md`,
`docs/plans/m3-finance-module.md`, `docs/plans/m3b-finance-sync.md`, `docs/plans/m4-design-pass.md`, `docs/plans/m5-migration.md`,
`docs/plans/m6-deploy.md`, `docs/plans/m7-harden.md`, `docs/plans/e0-foundation.md`, `docs/plans/e1-shared-schema.md`,
`docs/plans/e2-api-core-services.md`, `docs/plans/e3-recipe-services.md`, `docs/plans/e4-finance-services.md`,
`docs/plans/e5-scripts.md`, `docs/plans/e6-web-client.md`, `docs/plans/e7-http-api.md`, `docs/plans/e8-harden.md`,
`docs/plans/m8-calendar-module.md`. Three modules are built (`API_MODULES` and `WEB_MODULES` are `[recipe, finance, calendar]`,
`/api/health` reports `modules: ["recipe","finance","calendar"]`).

Gates: `bun run typecheck` OK; `bun test` 15236 pass, 1 skip (the snapshot sweep's `describe.skipIf`), 0 fail in 183 files (63.38 s; the final count of E8-T12, `docs/plans/e8-harden.md` section 9.1; E7's was 15191 in 181 files, and
11357 of the cases are the golden parity cases of `packages/shared/test/parity/`); `bun run i18n:check` exits 1 by design with 148 classified false positives (`docs/open-work.md`
O-5); the gzipped web bundle is 419.99 kB (E6, unchanged by E7 and E8); `git status --porcelain repos/` is empty.

## Layout (as built)

Package names are `@toon/shared`, `@toon/api`, `@toon/web`; the root is `toon-household`. Paths per SPEC §3.

- `packages/shared/src/index.ts` is the ONLY entry (the vite alias maps exactly `"@toon/shared"`; never import a
  subpath). `packages/shared/src/core/` holds `i18n/` (runtime plus
  `packages/shared/src/core/i18n/catalogs/server.{de,en}.ts`, and `packages/shared/src/core/i18n/issues.ts`, the
  `SchemaIssue` adapter `toValidationIssues`), `schemas/{common,household,user,auth}.ts` plus the Effect `Schema`
  vocabulary `packages/shared/src/core/schemas/checks.ts` (re-exported from the entry, `ALL_ISSUES` included),
  `calendar.ts`, `text.ts`. `packages/shared/src/modules/registry.ts` has `MODULE_IDS`, `ModuleIdSchema`,
  `DEFAULT_ENABLED_MODULES = ["recipe"]`; `packages/shared/src/modules/recipe/` and
  `packages/shared/src/modules/finance/` are the module barrels, re-exported FLAT from the entry (finance's tag
  schemas and 50/200 pagination are therefore `FinanceTag…` / `FinancePaginationQuery…`). Tests flat in
  `packages/shared/test/`, beside `packages/shared/test/support/schema.ts` (the schema test helpers),
  `packages/shared/test/fixtures/schema-golden/` (the golden JSON corpus, the parity oracle) and
  `packages/shared/test/parity/` (the three parity tests over it).
- `apps/api/src/index.ts` is the process: the boot (the `AppLayer`, each module's `start`, the server fiber), SIGTERM/SIGINT (bounded server
  stop, each module's `shutdown`, the runtime dispose) and `export { app }` (the in-memory handler the tests call). The application is
  `apps/api/src/http/app.ts` (`appRoutesLayer()`: the global layer, `SystemApi`, `AuthApi`, `HouseholdsApi`, the module APIs, the fallback; `httpApiRoutes()`,
  the api-doc test's route list) served by `apps/api/src/http/server.ts` (`BunHttpServer`, `0.0.0.0:API_PORT`, 20 MiB body cap). The rest of
  `apps/api/src/http/` is the vocabulary (E7): `middleware.ts` (the `HttpApiMiddleware` tags, `chain`, `coreApi`, `householdModuleApi`, `userModuleApi`, `ModuleId`),
  `context.ts` (`CurrentUser`, `CurrentSession`, `MaybeSession`, `CurrentMembership`), `request.ts` (`jsonBody`, `queryParams`, `rawJsonOr`, `clientIp`, …),
  `response.ts` (`json`, `created`, `noContent`, `errorResponse`, `ApiErrorBoundaryLayer`), `cookies.ts`, `global.ts` (`globalHttpLayer()`, `fallbackRoutesLayer()`),
  `middleware-layer.ts` (`httpMiddlewareLayer()`) and `in-memory.ts` (`inMemoryHandler`). Beside it: `apps/api/src/env.ts`,
  `apps/api/src/db/{client,migrate,schema}.ts` plus `apps/api/src/db/schema/core.ts`, `apps/api/src/lib/` (`apps/api/src/lib/validate.ts` is the one decode path),
  `apps/api/src/middleware/{session,household,module,verifiedEmail}.ts` (the `HttpApiMiddleware` implementations) and
  `apps/api/src/middleware/{staticWeb,originGuard,securityHeaders,cors,requestLog}.ts` (the global ones),
  `apps/api/src/modules/{index,types,mount}.ts` (the registry, the contract, `moduleRoutesLayer`),
  `apps/api/src/runtime.ts` (`AppLayer`, the shared memo map and the one `ManagedRuntime`, E0) and
  `apps/api/src/core/health.ts` (`healthResponse`, the `/api/health` payload as an Effect).
- Core API: `apps/api/src/core/routes/{auth,households,members,invites,modules,system}.ts` with a leaf `X.api.ts` beside `auth`,
  `households` and `system` (`apps/api/src/core/routes/households.api.ts` holds the four groups `invites`, `households`, `members`, `modules` of
  `/api/households`; the handler layers are `invitesHandlers`, `householdGroupHandlers`, `membersHandlers`, `modulesHandlers`, merged by `householdsHandlers`) and
  `apps/api/src/core/services/{auth,households,mail,media}/`;
  `apps/api/src/core/services/households/modules.ts` holds `enabledModulesFor`, `initializeHousehold`,
  `enableModule`, `disableModule`; `apps/api/src/core/services/media/` holds the uploads, the module reference
  scan and the sharp thumbnails.
- Module APIs: `apps/api/src/modules/recipe/` and `apps/api/src/modules/finance/` (manifest `index.ts`,
  `schema.ts`, `routes/`, `services/`, seed; details in the module docs). Each `routes/X.ts` has a leaf `routes/X.api.ts`
  (the `HttpApiGroup` and its `HttpApi`: method, path, `params`, middleware; no payload or success schema) and `routes/index.ts` holds the
  hoisted `…HouseholdApis()` / `…HouseholdHandlers()` (and recipe's `…UserApis()` / `…UserHandlers()`) the manifest reads lazily;
  finance's gate is `apps/api/src/modules/finance/http.ts` (the leaf tag `RequireFinanceParticipant`, `CurrentFinanceParticipant`) with its
  layer in `apps/api/src/modules/finance/middleware.ts`.
- Migrations: `apps/api/drizzle/{0000_core,0001_recipe,0002_finance,0003_placeholder_members,0004_calendar}.sql`, generated by
  drizzle-kit (`0003` has three generator defects corrected by hand, ADR 0006).
- Calendar module (M8, ADR 0016; details and the service table in `docs/modules/calendar.md`): shared
  `packages/shared/src/modules/calendar/` (`dates.ts` date math without `Date`, `recurrence.ts`, `people.ts`, `limits.ts`, `waste.ts`,
  `schemas/`), API `apps/api/src/modules/calendar/` (manifest `index.ts`, `schema.ts`, `layer.ts` (`calendarLayer()`, `CalendarServices`),
  `hooks.ts`, `seed.ts`, `routes/` with `core.index.ts` and `waste.index.ts`, `services/members.ts`, `services/entries/`,
  `services/waste/` with the pure parser `services/waste/hattingen.ts`), web `apps/web/src/modules/calendar/` (manifest, `routes.tsx`,
  `HomeCard.tsx`, `catalogs/`, `components/`, `lib/`, `features/{agenda,month,tasks,entries,cars,waste}/`). Tests: `packages/shared/test/calendar*.test.ts`,
  `apps/api/test/calendar-*.test.ts`, `apps/api/test/db-calendar-migration.test.ts`, `apps/api/test/web-contract-calendar.test.ts`, the harness
  `apps/api/test/support/calendar-harness.ts`, the flyer fixture `apps/api/test/fixtures/calendar/hattingen-abfall-2027.pdf` with its recorded
  items `apps/api/test/fixtures/calendar/hattingen-2027.items.json` (`apps/api/test/fixtures/calendar/record-items.ts`), and the web's
  co-located tests plus `apps/web/src/styles/calendar-tokens.test.ts`.
- Scripts:
  `apps/api/scripts/{migrate,seed,reset-password,uploads-gc,plan-run,localize-images,finance-import-xlsx,migrate-legacy}.ts`;
  `apps/api/scripts/legacy/` is the `migrate:legacy` library (`claims.ts` is the placeholders' claim-invite step; `io.ts` the
  Effect primitives `legacyTry`, `liftTagged`; `service.ts` the `LegacyMigration` service),
  `apps/api/scripts/finance-import/` the workbook parsers (pure). Root `scripts/{dev,typecheck,i18n-check,icons}.ts` stay plain Bun.
- Scripts (E5): `apps/api/scripts/support/main.ts` (`runScript`, `makeScriptTeardown`, `ScriptExit`; imports only `effect` and
  `@effect/platform-bun`), `docs/plans/e5-verify.sh` (the milestone's verification script, with the recorded fixture output
  `docs/plans/e5-fixture/{dry,apply,again}.norm`) and the subprocess tests `apps/api/test/scripts-main.test.ts`,
  `apps/api/test/scripts-seed.test.ts`, `apps/api/test/scripts-plan-run.test.ts`, `apps/api/test/scripts-uploads.test.ts`,
  `apps/api/test/legacy-io.test.ts`, `apps/api/test/legacy-service.test.ts`, `apps/api/test/legacy-cli-usage.test.ts`.
- API tests in `apps/api/test/` (`apps/api/test/support/` for harnesses, `apps/api/test/import/`,
  `apps/api/test/fixtures/import/`, `apps/api/test/fixtures/legacy/`); the doc guards are
  `apps/api/test/api-doc.test.ts` (every served route has a `docs/API.md` row and every row is served; every
  `ERROR_CODES` value is named) and `apps/api/test/docs-paths.test.ts` (every repo path in this file,
  `docs/API.md`, the module docs and `docs/open-work.md` exists).
- Web: `apps/web/src/{main,app,route-roots,router}.tsx` (`route-roots.tsx` imports no shell and no registry;
  `router.tsx` attaches `AppLayout` = `RequireAuth` + `AppShell` and builds the tree: auth routes,
  `/households`, `/households/$householdId`, `/settings`, `/` Home, `WEB_MODULES.map((m) => m.route)`),
  `apps/web/src/lib/` (`runtime.ts` and `api-client.ts` (E6, below), `api`, `queries`, `query-client`, `session.tsx`, `persist`, `nav.tsx`, `permissions.ts`,
  `share.ts`, `i18n/` with the core catalogs), `apps/web/src/components/ui/` (toon-recipe's primitives, the only
  ones), `apps/web/src/components/layout/` (AppShell, BottomTabBar, SideNav, ModuleSwitcher, PhoneHeaderRow,
  nav items), `apps/web/src/core/features/{auth,home,households,settings}/`,
  `apps/web/src/modules/{index,catalogs,persist,types,enabled}.ts`, `apps/web/src/styles/{theme,index,fonts}.css`;
  the web modules `apps/web/src/modules/recipe/` and `apps/web/src/modules/finance/` (manifest, `routes.tsx`,
  `HomeCard.tsx`, `catalogs/`, `lib/`, `features/`). Nothing lives under `apps/web/src/features/` (SPEC §3). Web
  tests are co-located `*.test.ts(x)` under `apps/web/tsconfig.test.json`. PWA: `apps/web/pwa-manifest.ts`,
  `apps/web/public/icons/` and `apps/web/public/favicon.svg` (from `scripts/icons.ts`).
- CI and deploy: `.github/workflows/ci.yml` (verify job with a poppler step and SHA-pinned actions; the
  `docker-build` job on pull requests builds the image without pushing), `.github/workflows/release.yml` (push to
  `main` and `v*` tags: typecheck, test, the multi-arch image to `ghcr.io/toonvish/toon-household`),
  `.github/workflows/deploy.yml` (gated by the repository variable `DEPLOY_ENABLED`, one SSH forced command).
  `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.local-stack`,
  `docker/{Caddyfile,entrypoint.sh,env.example,toon-deploy.sh}`; nothing of it is built by `bun run build`.
- Effect tooling (E0): `bunfig.toml` (test discovery skips `repos/**`), `.vscode/settings.json` (editor excludes for
  `repos/`), `repos/effect/` (the vendored Effect source, read-only; "Vendored reference code") and `agent-patterns/`
  (the `effect-<topic>.md` pattern files); the gate is `apps/api/test/effect-idioms.test.ts`, and
  `apps/api/test/runtime.test.ts` pins the runtime and the health route served through it.
- HTTP layer (E7): tests `apps/api/test/http-contract.test.ts` (the table-driven contract over the `docs/plans/m7-harden.md` §9.3 walkthrough
  plus the header rows, captured from the Hono app and unchanged by the cutover), `apps/api/test/http-foundation.test.ts` (the vocabulary:
  middleware order, request and response helpers, router isolation), `apps/api/test/http-global.test.ts` (the global layer: preflight,
  origin guard, fallback) and `apps/api/test/http-server.test.ts` (`BunHttpServer.layerTest`: a real socket); the mini-app helper is
  `apps/api/test/support/http.ts` (`testHttpApp`). A new route gets its `X.api.ts` endpoint, its handler, a `docs/API.md` row
  (`apps/api/test/api-doc.test.ts` reads `httpApiRoutes()`) and, for a by-id route, its case in the cross-household sweep.
- Recipe services (E3): `apps/api/src/modules/recipe/layer.ts` (`recipeLayer()`, the areas nested by dependency; `RecipeServices`),
  the area files `apps/api/src/modules/recipe/services/{ocr,import,import/url,recipes,shopping,plan,cards}/layer.ts`, and the
  `Context.Service` classes `Ocr`, `PdfText`, `ImportCapabilities`, `ImportFiles`, `OcrImporter`, `ImportDrafts`, `ImportCommit`,
  `ImportHttp`, `HeroImages`, `UrlImporter`, `RemoteImages`, `RecipeTags`, `Recipes`, `RecipeCollections`, `CookLog`, `MealPlan`,
  `ShoppingLists`, `ShoppingItems`, `ShoppingBought`, `ShoppingMutations`, `ShoppingFromPlan`, `Cards` (the table with files is
  `docs/modules/recipe.md` section 1.2); the pure helpers (`ssrf.ts` checks, `preprocess.ts`, parsers, mappers, adapters) stay
  plain modules. Beside them `apps/api/src/modules/recipe/services/import/db.ts` (`withImportDb`, `setImportDbForTests`) and
  `apps/api/src/modules/recipe/services/ocr/seam.ts` (the Promise engine seam as an effect).
- Finance services (E4): `apps/api/src/modules/finance/layer.ts` (`financeLayer()`, the areas nested by dependency; `FinanceServices`;
  `withFinanceServices`, the services over the CURRENT `Database` with a local memo map), the area files
  `apps/api/src/modules/finance/services/{participants,categories,ledger,plan,setup}/layer.ts`, the `Context.Service` classes
  `FinanceParticipants`, `FinanceSettings`, `FinanceCategories`, `FinanceTags`, `FinanceMutationClaims`, `FinanceBalance`,
  `FinanceTransactions`, `FinanceSummary`, `FinanceSettlements`, `FinancePlan`, `FinanceAccrual`, `FinanceSetup` (the table with files
  is `docs/modules/finance.md` section 1.3); `apps/api/src/modules/finance/lib/clock.ts` (`financeTimeMillis`, `setClockForTest`),
  `apps/api/src/modules/finance/services/plan/scheduler.ts` (`startAccrualSchedule`, `stopAccrualSchedule`; not a service) and
  `apps/api/src/modules/finance/middleware.ts` (the participant gate on the runtime); the pure helpers (`defaults.ts`,
  `period-scan.ts`, `dateRange.ts`, `aggregateExclusion.ts`, `support.ts`) stay plain modules. Tests added by E4:
  `apps/api/test/finance-clock.test.ts`, `apps/api/test/finance-scheduler.test.ts`, `apps/api/test/finance-services-local.test.ts`;
  `docs/plans/e4-verify.sh` is the milestone's verification script.
- Effect core (E2): `apps/api/src/config.ts` (`AppConfig`, the validated environment as a service; `apps/api/src/env.ts`
  re-exports its resolved `env`, `REPO_ROOT`, `parseEnv`), `apps/api/src/db/database.ts` (the `Database` service;
  `db/client.ts` keeps `createDatabase`, the shared `client` / `db` / `dbReady` and the drizzle TYPE `Database`),
  `apps/api/src/infra.ts` (`infraLayer()`: config, database, mailer, thumbnails, uploads, rate limiter, verified-email),
  `apps/api/src/core/services/layer.ts` (`coreServicesLayer()`, `baseServicesLayer()`) with
  `apps/api/src/core/services/auth/layer.ts` and `apps/api/src/core/services/households/layer.ts` (one hoisted
  composition function each), `apps/api/src/lib/errors.ts` (the tagged error family, `isApiError`,
  `toApiError`, `errorBody`, `logBoundaryFailure`, `routeUnknown`), `apps/api/test/support/effect.ts` (`runTest`, `runTestExit`, `itEffect`, `recordingMailer`,
  `withMailer`) and `apps/api/test/import-order-effect.test.ts` (the fresh-process import guard for the files the
  runtime pulls into the cycle). Core services (`Context.Service` classes): `Mailer` (`mail/index.ts`, exported as
  `MailerService`), `RateLimiter`, `VerifiedEmail`, `Thumbnails`, `Uploads`, `UploadReferences`, `HouseholdModules`,
  `Passwords`, `Users`, `Sessions`, `AuthInvites`, `EmailVerification`, `PasswordReset`, `OAuthProviders`
  (`apps/api/src/lib/oauth.ts`), `OAuthAccounts`, `Households`, `HouseholdInvites`, `AuthBootstrap`.
- Effect web (E6): `apps/web/src/lib/runtime.ts` (`WebLayer`, the one web `runtime`, `runPromise(effect, { signal })`; the one `fetch(` call of
  the web app), `apps/web/src/lib/api-client.ts` (`ApiClient` service over `HttpClient`, the tagged `ApiError`, `isApiError`,
  `setUnauthorizedHandler`), `apps/web/src/lib/api.ts` (the base-URL rules, `DECODE_OPTIONS`, `getJson` / `sendJson` / `sendForm` / `sendVoid`,
  `lenient`, `uploadForm`, the `CoreApi` namespace plus one exported Promise facade per endpoint), `apps/web/src/modules/recipe/lib/api.ts`
  (`RecipeApi`), `apps/web/src/modules/finance/lib/api.ts` (`FinanceApi`), `apps/web/src/modules/recipe/features/import/lib/importApi.ts`
  (`ImportApi`, `ImportApiError`), the tests `apps/web/src/lib/api.test.ts`, `apps/web/src/lib/runtime.test.ts`,
  `apps/web/src/lib/should-retry.test.ts`, `apps/web/src/modules/recipe/lib/api.test.ts`, `apps/web/src/modules/finance/lib/api.test.ts`,
  `apps/web/src/modules/recipe/features/import/lib/importApi.test.ts`, and the three API-side contract tests
  `apps/api/test/web-contract-core-recipe.test.ts`, `apps/api/test/web-contract-finance.test.ts`,
  `apps/api/test/web-contract-legacy.test.ts` (the last holds the snapshot sweep).
- Test support (E8, plan `docs/plans/e8-harden.md` P1, ADR 0014 "Status after E8"): `apps/api/test/support/bridges/`, the 19
  test-only doors, one file per source module (`migrate.ts`, `api-error.ts`, `sessions.ts`, `users.ts`, `rate-limit.ts`, `mail.ts`,
  `recipe-{drafts,ocr,fetch,ssrf}.ts`, `finance-{bridge,participants,clock}.ts`, `legacy-{io,run,users,households,recipe,sources}.ts`),
  their tests `apps/api/test/bridges-core.test.ts` and `apps/api/test/bridges-modules.test.ts`, and `docs/plans/e8-verify.sh` (the
  milestone's checks, among them `no-bridges`, `imports` and `paths`). Beside them the harnesses `apps/api/test/support/effect.ts`,
  `apps/api/test/support/finance-harness.ts`, `apps/api/test/support/legacy-harness.ts`, `apps/api/test/support/http.ts` and
  `apps/api/test/support/explain.ts`.
- Docs: see "Read order"; plus `docs/plans/screenshots/` and `docs/design/recipe-redesign/` (design record, D5).
- Core DB tables (unprefixed): `users`, `oauth_accounts`, `sessions`, `password_reset_tokens`,
  `email_verification_tokens`, `households`, `household_members`, `household_invites`, `household_modules`,
  `legacy_ids` (its column is named `table` per D12; the TS property is `tableName`). Recipe tables are all
  `recipe_*`, finance tables all `finance_*` (lists in the module docs; `group_id` became `household_id`).

## Commands

Run from the repo root. Bun 1.4.2 (`.bun-version`); `bun install --frozen-lockfile` first.

- `bun run dev`: API (`:3001`, `bun --watch`) and Vite web (`:5173`, proxies `/api`); `dev:api` / `dev:web` one
  at a time. Needs `DATABASE_URL` and `SESSION_SECRET` (16+ chars) in the environment or a root `.env` (copy
  `.env.example`) and a migrated DB, e.g. `DATABASE_URL=file:./data/m2.db SESSION_SECRET=<32 hex> bun run dev`.
- `bun run start`: the API without watch (production); with `WEB_DIST_DIR=./apps/web/dist` it also serves the
  built shell (needs `bun run build` first).
- `bun run typecheck`: `tsc --noEmit` over packages/shared, apps/api and the three apps/web projects.
- `bun test`: all unit and API tests, on a fresh temp file DB per process (ADR 0009; `TEST_DATABASE_URL`
  overrides it). `bunfig.toml` keeps the vendored `repos/` out of discovery.
- `bun run build`: Vite build plus the generated PWA service worker into `apps/web/dist`.
- `bun run i18n:check`: German catalog parity plus no German left in ported source. Exits 1 by design: parity
  OK, and about 148 leftover-German hits, all false positives (German quoted in doc comments and 10 lines of recipe
  content vocabulary; a line that merely contains a German stopword such as "die" is one too). Classify each hit, never suppress the check. `apps/api/scripts` is not scanned.
- `bun run db:generate`: drizzle-kit generates a migration from `apps/api/src/db/schema`.
- `bun run db:migrate`: applies the migrations to `DATABASE_URL` (e.g. `file:./data/m2.db`) and every build
  module's `afterMigrate`. `bun run db:studio`: drizzle-kit studio on the configured DB.
- `bun run seed`: idempotent demo data on `DATABASE_URL` (migrates first; needs `SESSION_SECRET`). One password
  for every login: `SEED_PASSWORD`, else `demo1234`; under `NODE_ENV=production` it refuses (exit 1) unless
  `ALLOW_SEED=1` and a 10+ character `SEED_PASSWORD` are set; modules get it in the `seedDemo` context
  (`demoPassword`). Logins: `demo@toon.local` (household "Familie"), `robin@toon.local` (finance slot 2),
  `kim@toon.local` (member WITHOUT a slot); the module docs list each module's demo data. The calendar's demo data (a car with
  bookings, events, rotating tasks and a synthetic tour-4 waste import) is written but the module is NOT enabled: press
  "Aktivieren" on the Kalender card on Home (`docs/modules/calendar.md` section 1.8).
- `bun run icons`: regenerates the PNGs in `apps/web/public/icons/` from `apps/web/public/favicon.svg` with
  `sharp` (`rsvg-convert` is the fallback). Committed; CI never runs it; only when the mark changes.
- `bun run plan:run [householdId]`: the fixed-cost catch-up by hand (the API runs it at boot and every 6 hours);
  without an argument every household with finance enabled; a disabled or incomplete plan is reported.
- `bun run finance:import-xlsx -- <Haushalt.xlsx> [--household <id>] [--dry-run] [--excel-text-quirk]`:
  toon-finance's one-off workbook import (`docs/modules/finance.md`).
- `bun run uploads:gc [-- --dry-run] [-- --min-age-hours=N]`: deletes files in `UPLOAD_DIR` no row references
  (core avatars and household images plus every module's `uploadReferences`; `*.thumb.webp` follow their
  original); files younger than 24 h are always kept.
- `bun run recipe:localize-images [-- --dry-run]`: copies recipe hero images and collection covers that are
  still remote URLs into `UPLOAD_DIR` (rows written before the write paths localized them, see the recipe
  gotcha "Remote images become local copies on write."); an unreachable image stays remote and is listed.
- `bun run auth:reset-password <email> [--send]`: prints a password-reset link (works without mail).
- `bun run migrate:legacy -- [--recipe-db <file>] [--recipe-uploads <dir>] [--finance-db <file>] [--mapping
  <json>] [--apply] [--report <file>]`: the one-off legacy import (guide: `docs/migration.md`). Target:
  `DATABASE_URL` (a local `file:` URL, process environment or the root `.env`) and `UPLOAD_DIR`; relative paths
  resolve against the repo root. Without `--apply` nothing is written, not even the target file (the dry run
  runs on a scratch copy); `--apply` repeats the dry pass and writes only if it is clean; a second `--apply` ends
  with `[migrate:legacy] already migrated: nothing written.` Exit 0 success, 1 errors found, 2 usage or input.
  Fixture run: `D=$(mktemp -d); NODE_ENV=development DATABASE_URL=file:$D/target.db UPLOAD_DIR=$D/uploads bun
  run migrate:legacy -- --recipe-db apps/api/test/fixtures/legacy/recipe.db --recipe-uploads
  apps/api/test/fixtures/legacy/uploads --finance-db apps/api/test/fixtures/legacy/finance.db` (add `--apply`
  twice). `bun run` prefixes each line with `@toon/api migrate:legacy: `; the `--report` JSON has none.
- **The local stack test** (the whole image, compose file, Caddyfile and redirects on this machine; guide:
  `docs/deployment.md` "Local stack test"; never in `/opt/toon-household`), compose project
  `toon-household-local`: `docker build -t toon-household:local . > build.log 2>&1; echo "exit=$?" >> build.log`
  (read `exit=0`; `--build-arg WITH_OCR=1 --build-arg WITH_PDF=0` for the published variant), then
  `docker compose --env-file .env.local-stack up -d` (ports 80 and 443 free), wait for the app container to be
  `healthy`, `curl --resolve haushalt.test:80:127.0.0.1 http://haushalt.test/toon-root-ca.crt -o root.crt`, then
  `curl --cacert root.crt --resolve haushalt.test:443:127.0.0.1 https://haushalt.test/api/health`; the old
  hostnames are `rezepte.test` and `finanzen.test` (`--resolve` for curl, `--host-resolver-rules` for Chromium,
  plus `--ignore-certificate-errors` for a service worker to register). Tear down with
  `docker compose -p toon-household-local --env-file .env.local-stack down -v`.
- **`caddy validate`** only through compose, so the stack's `.env` is interpolated as `up` does: `docker compose
  --env-file <env> run --rm --no-deps --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile --adapter
  caddyfile` (no `caddy` binary on the host; never a raw `docker run -e RECIPE_HOSTNAME=`, see the gotcha).
- **Scripts inside the running container:** `docker compose exec app bun apps/api/scripts/<script>.ts`
  (`seed.ts` refuses production without `-e ALLOW_SEED=1 -e SEED_PASSWORD=<10+ chars>`, `reset-password.ts
  <email>`, `uploads-gc.ts`, `plan-run.ts`, `localize-images.ts`; `migrate-legacy.ts` via `docker run --entrypoint bun` as in
  the cutover guide).

Environment switches of the recipe module (`apps/api/src/env.ts`): `IMPORT_OCR_ENABLED`, `IMPORT_PDF_ENABLED`,
`IMPORT_ALLOW_PRIVATE_HOSTS=1` (dev only), `UPLOAD_DIR`; all default off (`docs/modules/recipe.md`).

## Conventions

The conventions are toon-recipe's `CLAUDE.md` "Conventions" plus toon-finance's "Konventionen" (money is integer
cents everywhere; no float touches a user amount), with these household-wide rules:

- Tables prefixed per module (`recipe_`, `finance_`), core tables not. API paths under
  `/api/households/:householdId/<module>/` (user-scoped: `/api/<module>/`). Query keys
  `["toon","household",id,"<module>",…]`; user data `["toon","<module>",…]`.
- German UI strings byte-identical to the sources; new German only for new screens, listed in `NEW_GERMAN` in
  `scripts/i18n-check.ts`. Content language never goes through `t()`.
- toon-recipe's web namespace `ui.*` is core `common.*` here (a pure KEY rename, values unchanged, so
  `ui.common.dash` is `common.common.dash`; `UiCatalog` is `CommonCatalog`). Every port of a recipe screen
  applies `"ui.` → `"common.`. Module namespaces are `recipe.*`, `finance.*`.
- Renames from toon-recipe (apply them to every port): `group` → `household`, `groupId` → `householdId`,
  `activeGroupId` → `activeHouseholdId`, `requireGroupRole` → `requireHouseholdRole`, `createOwnedGroup` →
  `createOwnedHousehold`, `useActiveGroup` → `useActiveHousehold`, `RequireActiveGroup` →
  `RequireActiveHousehold`, `/api/groups` → `/api/households`, web catalog keys `groups.*` → `household.*`
  (group management only), `auth.register.groupName.*` → `auth.register.householdName.*`,
  `auth.settings.groups.*` → `auth.settings.households.*`. The German VALUES keep "Gruppe" and
  `DEFAULT_HOUSEHOLD_NAME` stays "Meine Rezepte" (D10; a rename to "Haushalt" is an owner decision and needs an
  ADR). Server keys `server.group.*` and `{groupName}` placeholders keep their names.
- Renames from toon-finance (apply them to every port): `household_members` → `finance_participants` (by user
  id; `HouseholdContext` is `FinanceParticipantContext`, read in a handler as `const household = yield*
  CurrentFinanceParticipant` from `apps/api/src/modules/finance/http.ts` so route bodies keep F's `household`), `members.service` → `participants.service`,
  `useHousehold` / `useOtherMember` → `useFinanceHousehold` / `useOtherParticipant`, F's unprefixed catalog keys
  (`transactions.list.title`) → `finance.…`, F's URLs `/transactions`, `/new`, `/plan`, `/categories` →
  `/finance/…` (F's `/` is `/finance`, F's `/household` is the core's Gruppen plus the participants section on
  `/settings`), typed router hooks (`Link`, `useNavigate`, `useParams`, `useBlocker`) → `@/lib/nav`. Finance's
  TS identifiers carry a `finance` prefix and ported files import them aliased (`docs/modules/finance.md`).
- Core helpers a recipe port needs are core, not module code: `@/lib/nav` (`AppLink`, `useAppNavigate`,
  `useRouteParam(s)`, `useNavigationGuard`), `@/lib/permissions` (`hasAtLeast`), `@/lib/share` (`shareOrCopy`,
  `copyToClipboard`); `canModifyOwn` stays with the recipe module.
- Module boundary: the core imports a module only through `apps/api/src/modules/index.ts` /
  `apps/web/src/modules/index.ts` (and, on the web, its catalogs through `apps/web/src/modules/catalogs.ts`); a
  module never imports another module's directory.
- **Effect idioms (`docs/EFFECT.md` E12; the number is the rule of `apps/api/test/effect-idioms.test.ts` that pins it).**
  `Effect.gen` inline; `Effect.fn("Service.method")` (a string or template-literal span name) for a reusable function,
  `Effect.fnUntraced` on a hot path, combinators as extra arguments of `Effect.fn` and never `.pipe` on it, no function that only
  returns `Effect.gen(`: (15). Raise with `return yield* new X(…)`: (16). Errors are `Schema.TaggedError`s caught with
  `Effect.catchTag(s)`, never an `Error` subclass or `instanceof`: (17); no `throw ApiError` under `apps/api/src`: (10). Services are
  `Context.Service` classes with a static `layer` and no accessors (`const s = yield* S` or `S.use(…)`), never `Context.Tag` or
  `Effect.Service`: (4). `Predicate.isObject` / `Predicate.isObjectOrArray` instead of `typeof x === "object" && x !== null`: (18).
  Time from `Clock` / `DateTime`: no `Date.now(` / `new Date(` in a `services/` directory and no `nowMs(` in the core or the
  modules (11), none on the request path (19). An effect runs only at the edges: `Effect.run…(` / `runtime.run…(` in six pinned
  files of non-test `apps/api/src` (20), one `ManagedRuntime.make(` per process (5), the scripts through `runScript` or
  `BunRuntime.runMain` (12), the web through its one runtime with `effect` and `effect/http` only (13). v4 names only: no Effect 3
  package (3), no `effect/unstable/` path (2), no v3 API name such as `Effect.catchAll(`, `Either.` or `.annotations(` (21).
  Untrusted input is decoded with a shared `Schema` through `apps/api/src/lib/validate.ts`, never parsed by hand; no zod (9) (the
  rest of that idiom is review, not grep). The tree: no import from `repos/` (1), one exact Effect version (6, 7), the vendored tree
  and its fences (8), no hono (14). Never relax a rule to get green; a hit is fixed in the code.
- Docs in English; a living doc names every repo file repo-relative from the root (`apps/api/test/docs-paths.test.ts`
  checks them). Commit messages end with the harness's `Co-Authored-By` line; no pushes from agent sessions.
- Tests: `apps/api/test/` (never `apps/api/tests/`), web co-located, `packages/shared/test/`. Ported tests that
  need unported code are removed with a placeholder comment naming the returning milestone, never skipped
  silently.

## Gotchas in use

Binding gotchas of the sources stay binding inside their module (SPEC D13). These are the core and cross-cutting
ones; the module gotchas are indexed below and live in the module docs.

### Database and API

- **One runtime, disposed on shutdown (E0, E2, E7).** `apps/api/src/runtime.ts` is the only file that calls
  `ManagedRuntime.make` (`AppLayer`, the whole composition below; the shared `appMemoMap`). Nothing runs
  an effect on it at module scope: the layer builds lazily on the first run, and a run at import time would
  re-enter the API import cycle (below). `GET /api/health` is the `SystemApi` handler over
  `healthResponse` (`apps/api/src/core/health.ts`; `AppConfig`, `VerifiedEmail` and the registry are read inside the generator, key
  order `ok, status, version, time, database, modules, features`). Boot (`apps/api/src/index.ts`): `await
  runtime.runPromise(Effect.void)` builds the whole `AppLayer` first, so a database that cannot be opened fails the
  boot, then each module's `start()` effect (a failure logs `[api] start of module <id> failed:`), then the server fiber
  (`Layer.launch(serverLayer())`) until it listens (a bind failure fails the boot with exit 1), then the boot line.
  **The server fiber is forked with `Effect.runForkWith(await runtime.context())`, never `runtime.runFork`:**
  `runtime.dispose()` interrupts and AWAITS every fiber it forked, and `BunHttpServer`'s `server.stop()` finalizer waits for
  every request in flight (the handlers are `UNINTERRUPTIBLE`), so a managed server fiber made a slow upload hold the whole
  teardown (8.9 s measured at E7-T13, ADR 0015). On SIGTERM/SIGINT (never in tests) it logs `[api] <signal> — stopping
  modules …`, interrupts the server fiber BOUNDED to 5 s (`Fiber.interrupt` under `Effect.timeoutOrElse`; a request still
  running is abandoned), runs every module's `shutdown` effect, THEN `await runtime.dispose()`, which runs
  `Database.layer`'s release and logs `[db] database closed`, then logs `[api] runtime disposed` (a failed dispose logs
  `[api] runtime dispose failed:`), and `process.exit(0)` last in every case. Measured: 23 to 48 ms idle, 5.03 s with a
  slow upload in flight, 354 ms through `docker compose stop` (`docs/plans/e7-http-api.md` 9.4). `index.ts` never
  `export default`s an object with `fetch` (Bun would auto-serve it a second time). Never dispose the runtime in a test: the
  tests share one process and one runtime. Pinned by `apps/api/test/runtime.test.ts`, `apps/api/test/http-server.test.ts` and
  idioms rule (5); the stop times by `docs/plans/e7-http-api.md` 9.4 and `docs/open-work.md` O-9.
- **One composition point, evaluated lazily, siblings nested explicitly (E2, plan P3).** `AppLayer` is
  `Layer.suspend(appLayer)` over hoisted functions only (`infraLayer()`, `coreServicesLayer()`, `baseServicesLayer()`,
  `authServicesLayer()`, `householdServicesLayer()`, `moduleLayers()`), annotated `Layer.Layer<AppServices,
  AppLayerError, never>` so a requirement left open is a `tsc` error in `apps/api/src/runtime.ts`. `Layer.mergeAll`
  feeds no member's output into another member's input: a service that needs a service of the same step goes in an
  outer step, `Layer.provideMerge`d, never beside it. **A service's static `layer` references no imported binding but
  `effect` exports and its own class**: its dependencies are yielded inside the generator at build time, because a
  static `Layer.provide(Other.layer)` reads `Other` while the import cycle may still be evaluating it (TDZ). Time and
  the current executor are read inside the method body on every call (never captured at build), so a `TestClock` or a
  transaction reaches them. `apps/api/test/import-order-effect.test.ts` builds the `AppLayer` after each entry point,
  first in a fresh process.
- **Test-only doors live in `apps/api/test/support/bridges/` (E8, plan `docs/plans/e8-harden.md` P1, P4, ADR 0014 "Status
  after E8").** `apps/api/src` and `apps/api/scripts` hold only the Effect forms. Every Promise or synchronous form a pinned test
  still calls is a DOOR, one file per source module it mirrors, 19 in all: `runMigrations`, the legacy `ApiError` class with its ten
  static helpers, `createSession`, `claimPlaceholderUser`, `checkRateLimit`, `trySendMail`, recipe `createDraft`, `importFromText`,
  `fetchHtml` and `assertPublicUrl`, finance `assignParticipants` with `updateParticipantDisplayName`, `runFinanceBridge` and `nowMs`,
  and the `migrate:legacy` forms `runLegacy`, `runLegacyMigration`, `migrateUsers`, `migrateHouseholds`, `migrateRecipe`,
  `openLegacy`. **A door keeps the old name, signature and calling convention, and says so with an explicit return type:** a
  Promise door runs `runtime.runPromise` or `Effect.runPromise` and rejects with the tagged error itself (a finance or legacy door
  with a `DatabaseError`'s `cause`, the raw driver error); a SYNCHRONOUS door (`checkRateLimit`, `importFromText`, `nowMs`) runs a
  service-free effect with `Effect.runSync` and throws synchronously. The reason is E2's `enforceRateLimit`: called as a plain
  unawaited statement, a Promise-returning form typechecked, stayed green under test (the limiter is off) and would have silently
  dropped the import limit in production. A door imports only the module it mirrors and what its body needs (the runtime, the
  `Database` service, the shared client, the finance layer, a sibling door); nothing under `apps/api/src`, `apps/api/scripts`,
  `apps/web/src` or `packages` imports a door. `runFinanceBridge(effect, executor)` never imports `runtime.ts`: it builds the finance
  services over the executor it is handed (`withFinanceServices`) and provides `Database.layerFromExecutor(executor)` itself. `nowMs`
  is the one door that is not a copy: `Effect.runSync(financeTimeMillis)`, the same value in both clock states.
  `apps/api/test/bridges-core.test.ts` and `apps/api/test/bridges-modules.test.ts` run each door against its Effect form on the same
  input; idioms rule (20) and `bash docs/plans/e8-verify.sh no-bridges all` keep `src` free of them. A new test calls the Effect form
  (`runTest`, `itEffect` of `apps/api/test/support/effect.ts`); a new door is a last resort and lists its callers in its doc comment.
- **The test seams stay in `src` (E8, plan e8 P2, ADR 0014 "Status after E8").** `setMailer`, `getMailer`, `isMailerOverridden`,
  `isMailConfigured` (`apps/api/src/core/services/mail/index.ts`), `resetRateLimits` (`apps/api/src/core/services/auth/rateLimit.ts`),
  `setVerifiedEmailRequired` (`apps/api/src/core/services/auth/verifiedEmail.ts`), `setImportDbForTests`
  (`apps/api/src/modules/recipe/services/import/db.ts`), `setImportGuardForTests` (`apps/api/src/modules/recipe/services/import/url/fetch.ts`),
  `setRemoteImageDownloaderForTests` (`apps/api/src/modules/recipe/services/recipes/remoteImage.ts`), `setClockForTest`
  (`apps/api/src/modules/finance/lib/clock.ts`) and `setWasteFlyerFetchForTests` (`apps/api/src/modules/calendar/services/waste/fetch.ts`,
  M8: the flyer download, fed by `makeTestWasteFlyerFetch(bytesByUrl)`) mutate module-level state that the services of the ONE runtime read at CALL time. The
  tests drive the app through the in-memory handler on that same runtime (one process, one database, ADR 0009), so a test layer
  cannot reach them: a seam is the smallest correct mechanism, not a transitional bridge. Their section headers read `test seams:
  …`. A seam is a plain synchronous function called outside any effect; the three recipe `…ForTests` seams throw outside
  `NODE_ENV=test` (the one tolerated `throw` in recipe code: a production caller must fail loudly), and so does the calendar's. A test
  that sets one releases it (`setMailer(null)`, `setClockForTest(null)`, `setWasteFlyerFetchForTests(null)`, `resetRateLimits()`). Pinned by `apps/api/test/mail.test.ts`,
  `apps/api/test/rate-limiter.test.ts` and `apps/api/test/finance-clock.test.ts`.
- **The scripts are Effect programs (E5, ADR 0014, plan `docs/plans/e5-scripts.md` P1, P2, P18).** Seven of the eight run on the one
  `AppLayer` (`Effect.provide(AppLayer)` INSIDE the program, so the layer's scope has closed when the teardown runs) through
  `runScript(program)` of `apps/api/scripts/support/main.ts` under `if (import.meta.main)`: a program that succeeds with a number exits
  with it, with `void` exits 0, a failure with the error's `[Runtime.errorExitCode]` (`ScriptExit`, raised as `return yield* new
  ScriptExit({ code })` after the script printed its own line; 1 without one), an interruption 130, and the process then ALWAYS ends with
  `process.exit(code)` (the one in the scripts' Effect code). **Every `AppLayer` script prints one more line than before, `[db] database
  closed`** (`Database.layer`'s release), unpinned; `finance:import-xlsx --dry-run` and the no-`--household` path print none because they
  never open the database. **A value import can open the database:** `src/db/database.ts` imports `src/db/client.ts`, which creates the
  database file AT IMPORT, so `seed.ts` (before its production refusal), `migrate.ts` (before the `SESSION_SECRET` placeholder) and
  `finance-import-xlsx.ts` (its dry run) import `Database`, `src/runtime.ts`, the finance services and the finance schema only dynamically
  inside the generator that needs them (`import type` for types); `bash docs/plans/e5-verify.sh xlsx-dry`, `apps/api/test/scripts-seed.test.ts`
  and `apps/api/test/finance-import-xlsx.test.ts` spawn with `NODE_ENV=development` (the inherited `test` hides the mistake). **Service
  calls are v4 calls**: `const accrual = yield* FinanceAccrual; yield* accrual.runCatchUp(…)` or `FinanceAccrual.use((accrual) => …)`; a
  `Context.Service` class has no static accessors and none is added (`bash docs/plans/e5-verify.sh statics`). Time comes from the
  `Clock`; the `migrate:legacy` library is Effect functions with no `await`, its services-free steps over an explicit `MigrationContext`
  and the one service `LegacyMigration` (`apps/api/scripts/legacy/service.ts`).
  Pinned by idioms rule (12), `apps/api/test/scripts-main.test.ts` and `apps/api/test/legacy-service.test.ts`.
- **Catch-all stays catch-all (E2, plan P2).** `Effect.catch` and `Effect.catchTag(s)` see the typed error channel
  only; a synchronous throw inside a generator and an `Effect.promise` rejection are DEFECTS and pass them by. Where
  the old code caught everything (`verifyPassword`: a malformed hash is `false`, never a 500; `trySendMail`; the
  expired-token sweeps; the thumbnail generation and its failure cache; the OAuth callback and
  `sendVerificationLinkQuietly` in `apps/api/src/core/routes/auth.ts`) the Effect form wraps a Promise with
  `Effect.tryPromise` and recovers the WHOLE cause with `Effect.catchCause` (`Cause.squash(cause)` is the value the
  old `catch (error)` saw) or `Effect.ignoreCause`. The OAuth callback must never use `Effect.catch`: a defect would
  become a `500` JSON instead of the redirect with `oauth_failed`.
  Pinned by `apps/api/test/auth.test.ts` (a malformed hash) and `apps/api/test/oauth-callback.test.ts`.
- **The recipe module's services and the URL import guard (E3, plan P2, P10, P17).** Each recipe service is yielded inside a handler
  or another service's method (never at module scope); an area composes siblings in an outer `provideMerge` step
  and `apps/api/src/modules/recipe/layer.ts` nests the areas (the table is `docs/modules/recipe.md` section 1.2). The URL fetch
  is one `HttpClient` request per hop (`redirect: "manual"`, no `traceparent`), each hop checked by `checkPublicUrl` BEFORE the
  request. The test seam of the guard is `setImportGuardForTests({ allowHosts, resolve })`: an EXACT-HOST allow list, never an
  "allow private hosts" switch (`IMPORT_ALLOW_PRIVATE_HOSTS` skips every host check, the metadata address included, so a test
  behind it could not prove a refusal and would send a real request to `169.254.169.254`). `apps/api/test/import/url-import-local.test.ts`
  runs the real client against a `Bun.serve` fixture under it, with an explicit `URL_IMPORT_TEST_TIMEOUT_MS` on every test.
  The recipe route files are entries of `apps/api/test/import-order-effect.test.ts` since E7-T13 (the Hono routers they used to
  build at module scope are gone).
- **The error family and the one boundary mapper (E2, plan P4).** `apps/api/src/lib/errors.ts` has one
  `Schema.TaggedError` per HTTP refusal (`BadRequest`, `Unauthorized`, `InvalidCredentials`, `Forbidden`, `NotFound`,
  `Conflict`, `PayloadTooLarge`, `UnsupportedMediaType`, `ValidationFailed`, `Internal`, `RateLimited` with
  `Retry-After`, the generic `ApiFailure`), permissive field schemas (a constructor never throws on a value today's
  code passes) and `isApiError` (a `Predicate`, no `instanceof`). Services and routes fail with them
  (`return yield* new NotFound()`), `toApiError` / `errorBody` render the envelope once, at the one boundary (`ApiErrorBoundary`,
  outermost on every `HttpApi`, in `apps/api/src/http/response.ts`, and `errorResponse` for the global middlewares). No `throw
  ApiError` under `apps/api/src` (idioms rule (10)), no `Error` subclass (rule (17)). `DatabaseError` and `MailError` are tagged
  errors OUTSIDE the family: a database failure is a `500 internal_error` whose log line shows its `cause`, never an API error to
  module code. A 5xx family member logs `[api] <METHOD> <path> -> <status> <code>: <English message>` and its stack (the pre-E2
  line, `logBoundaryFailure`; a 4xx warns outside production). Pinned by `apps/api/test/errors.test.ts`.
- **The `Database` service and the shared client (E2, plan P6, ADR 0014).** **Decided at E8 (plan e8 P3, ADR 0014
  "Status after E8", `docs/open-work.md` O-7): `apps/api/src/db/client.ts` keeps creating the process-wide `client` / `db` / `dbReady`
  at import and `apps/api/src/env.ts` keeps re-exporting the resolved `env`**, because the tests' shared `db` (ADR 0009),
  `migrate-legacy.ts`'s pinned import order (`apps/api/test/legacy-cli.test.ts`, `apps/api/test/import-order.test.ts`) and 23
  synchronous `env` readers depend on them; creating the client in the layer would change that contract for no gain. The `Database`
  service (`apps/api/src/db/database.ts`) owns its lifetime: acquire awaits `dbReady` (the D7 pragmas), release closes
  the client and logs `[db] database closed`, **never under `NODE_ENV=test`** (one process, one client, ADR 0009;
  a test that disposes an `AppLayer` runtime must not close it, `apps/api/test/database.test.ts` proves it).
  The current executor is a `Context.Reference`: inside `Database.transaction` it is the open transaction (no
  savepoint for a nested call), `Database.withExecutor(db)(effect)` hands in an instance (what the doors do),
  `Database.layerFromExecutor(executor)` wraps a bare drizzle executor and closes nothing, `layerFrom` and
  `layerFromUrl` are the test and script constructors. On a `:memory:` URL `transaction` degrades to sequential
  exactly as `withTransaction` did.
- **The mail seam (E2, plan P8).** `Mailer` (`MailerService`) is a service whose layers (`layerConsole`, `layerSmtp`,
  `layerResend`) choose by `AppConfig.mailTransport`; the transport is read AT SEND TIME through the module-level override of
  `setMailer(m)` / `setMailer(null)`, so a test that installs a fake (or a failing relay) works through the runtime. The service's
  `trySendMail` never fails and logs `[mail] Sending to <redacted> failed (<transport>): <reason>`; the SMTP `Date` header takes the
  Clock's time through the optional `now` of `SmtpMailer.send`. Pinned by `apps/api/test/mail.test.ts` and
  `apps/api/test/mail/smtp.test.ts`.
- **Hooks are Effects; both manifests are `ApiModule`s (E2 P11, E3, E4 P3-P5).** `ApiModule` hooks are Effects that read the
  current executor from `Database`; `recipeModule` (E3) and `financeModule` (E4) implement the contract directly
  (`ApiModule<RecipeServices>`, `ApiModule<FinanceServices>`: hooks as Effects, `layer` merged into `AppLayer`). A hook is typed over `Database` only (`start` too: SPEC §2), so finance
  wraps each hook program in `withFinanceServices` (`apps/api/src/modules/finance/layer.ts`), which builds the finance services over
  the CURRENT `Database` of the calling fiber (the core's open transaction for a hook) with `Effect.provide(layer, { local: true })`,
  a fresh memo map: a plain `Effect.provide` would reuse the services the runtime's `AppLayer` memoized, bound to the runtime's
  database, and a test's private `Database.layerFrom(…)` would silently never be reached (`apps/api/test/finance-services-local.test.ts`
  proves it; the finance services hold no state, so the copies cannot disagree). Outside the runtime a hook runs
  with `Database.layerFromExecutor(executor)` provided: `migrate-legacy.ts` runs `migrateDatabase()` (`apps/api/src/db/migrate.ts`,
  then every `afterMigrate`) on its explicit target, the doors `runMigrations` and `runFinanceBridge` under `Effect.runPromise`;
  `apps/api/src/db/migrate.ts` never imports `runtime.ts`, so it keeps `migrate-legacy.ts`'s import-order rule. The other scripts run
  their hooks on the `AppLayer` (`seed`'s `seedDemo`, the `UploadReferences` service for `uploads:gc`). `API_MODULES` in
  `apps/api/src/modules/index.ts` is a lazy array (a `Proxy` over the manifests, built on first access) so a manifest imported FIRST
  in a fresh process does not read the list in its TDZ; a read at module scope still fails loudly. The finance scheduler is not a
  service: `startAccrualSchedule` awaits the boot catch-up and forks ONE detached fiber on `Effect.schedule(tick,
  Schedule.spaced("6 hours"))` (`Effect.schedule` steps the schedule before its first run, so the first interval run is six hours
  after the start, as `setInterval`; `Effect.repeat` would run at once), `stopAccrualSchedule` interrupts it before the runtime is
  disposed, and `apps/api/test/finance-scheduler.test.ts` drives it with a `TestClock` (a bounded real-time poll for the catch-up's
  real database I/O). A failed tick logs `[plan] interval catch-up failed:` and the schedule goes on. The module clock is
  `financeTimeMillis` (the `setClockForTest` override, else the `Clock`); the finance route files are entries of
  `apps/api/test/import-order-effect.test.ts` since E7-T13.
- **Middleware, APIs and handler layers are TDZ-safe (E2, plan P12, P21; E7, plan P15).** The runtime imports `modules/index.ts`,
  which imports each module's `routes/index.ts`, which builds `HttpApi`s and handler layers while the middleware files may still
  be evaluating. The leaves import nothing in the cycle: every `*.api.ts`, `apps/api/src/http/{middleware,context}.ts` and
  `apps/api/src/modules/finance/http.ts` (the `HttpApiMiddleware` tags and the `HttpApi` values) import only `effect`,
  `effect/http-api`, types and `lib/errors.ts`. A class-valued tag is a TDZ binding, unlike the hoisted middleware factories of the
  Hono era, so what depends on one is built lazily: a handler layer at module scope references only `effect` exports, its leaf
  API and its own build function (services are yielded inside the handlers); a middleware layer at module scope references only
  its leaf tag (`Layer.effect(RequireSession, Effect.gen(...))`, its services yielded inside); every LIST of layers or APIs the
  server builds is computed in a hoisted function (`appRoutesLayer()`, `moduleRoutesLayer()`, `httpMiddlewareLayer()`,
  `globalHttpLayer()`, `recipeHouseholdApis()`, `financeHouseholdHandlers()`, …), the manifests read them lazily (a getter,
  `Layer.suspend`), and `apps/api/src/http/app.ts`'s one module-scope statement calls the hoisted `inMemoryHandler`, which builds
  nothing until the first request. `lib/errors.ts`, `lib/types.ts` and `lib/validate.ts` import neither the runtime nor a service.
  `apps/api/test/import-order.test.ts` and `apps/api/test/import-order-effect.test.ts` pin it: every route file is an entry that
  loads FIRST in a fresh process, then the `AppLayer` builds and one request is served (E7-T13 added the 16 route files the pre-E7
  tree could not take as a first import, `docs/open-work.md` O-6 retired).

- **D7 pragmas.** `apps/api/src/db/client.ts` sends WAL + `synchronous = FULL` (finance's ledger choice, not
  recipe's `NORMAL`), `foreign_keys = ON` and the busy timeout on every connection to a local `file:` DB, never
  to `libsql://` or `:memory:`; the busy timeout also goes to `createClient` as `timeout`, because libSQL's pool
  runs the pragmas on its first connection only (ADR 0009). `apps/api/test/db-pragmas.test.ts` pins it,
  including a second pooled connection. Do not "optimise" it back.
- **Migrations are generated.** `apps/api/drizzle/0000_core.sql` comes from `bun run db:generate`, never by
  hand; DDL is verified through `@libsql/client` (`bun:sqlite` is a newer SQLite). `db:migrate` needs only
  `DATABASE_URL`: it supplies a placeholder `SESSION_SECRET` (never overriding a real one) and imports the db
  modules dynamically so `apps/api/src/env.ts` validates after that.
  `apps/api/test/db-placeholder-migration.test.ts` pins `0003`'s corrected body.
- **Middleware chain order is load-bearing (E7: HttpApi terms).** A module's `householdApi` is built by `householdModuleApi(id, api)`
  (`apps/api/src/http/middleware.ts`), which attaches `ApiErrorBoundary` → `RequireSession` → `RequireHouseholdMember` →
  `RequireModule` (annotated with the group's `ModuleId`), then the group's chain, then the endpoint's: no cookie is 401 first, a
  non-member is 403 before the module row is read (a foreign household's enabled modules never leak), a disabled module is
  `404 module_disabled`. **The middleware attached LAST runs FIRST** (`HttpApiBuilder.ts` `applyMiddleware`; HTTPAPI.md's prose
  suggests the opposite): attach through `chain(A, B, C)`, which takes the middlewares in EXECUTION order and attaches them
  reversed, never `.middleware(...)` by hand. `apps/api/test/middleware.test.ts` and `apps/api/test/http-foundation.test.ts` pin the
  order. A module's endpoints have no `RequireSession` / `RequireHouseholdMember` of their own; a group adds `RequireVerifiedEmail`
  and an endpoint `RequireHouseholdAdmin` where needed. A `userApi` (`userModuleApi`: `/api/recipe/cards`) runs `RequireSession`
  itself and is NOT behind `RequireModule`. `moduleRoutesLayer` (`apps/api/src/modules/mount.ts`) ASSERTS the four outermost
  middlewares and the prefix at layer build (`Effect.die` naming the module and the endpoint) and registers a catch-all per household module on
  `…/<id>/*` that runs session → member → module and answers the JSON 404 (once per explicit method but `HEAD`: a `*`-method route enters the
  `HEAD` tree and would shadow the `HEAD` → `GET` fallback). The router matches by SPECIFICITY, not registration order: the
  invite-token routes beside `/:householdId`, `…/shopping-lists/bought` beside `…/:listId` need no order; the order that remains
  load-bearing is the GLOBAL one (`docs/API.md` "Middleware chain and mount order"): the request log, the security headers, CORS and
  the origin guard, registered in ONE generator in `globalHttpLayer()` (never a `Layer.mergeAll`, which builds concurrently), then the
  routes, the static web last as the fallback route (`fallbackRoutesLayer()`: the path `*` once per explicit method but `HEAD`, never
  `/*`, which the router would also register as the bare path).
- **A `household_modules` row is the enabled state.** Every household-creation path (register, OAuth sign-up,
  `POST /api/households`, seed) goes through `initializeHousehold(db, id)`, which writes the
  `DEFAULT_ENABLED_MODULES` rows (even for a module the build lacks; the UI filters by `WEB_MODULES`) and then
  runs each build module's `onHouseholdCreated`. `enableModule` runs the module's `onEnable` BEFORE the upsert, so
  a refusal writes nothing even where `Database.transaction` degrades (an explicit `TEST_DATABASE_URL=file::memory:`).
  `disableModule` deletes the row (settings lost, module data kept). The legacy migration (ADR 0005) is the one
  writer that bypasses this path. `API_MODULES` is read inside functions only: `initializeHousehold` imports
  `apps/api/src/modules/index.ts` from a core service, so a top-level read becomes an import cycle.
  Pinned by `apps/api/test/modules.test.ts`.
- **`HouseholdWithRole` has `modules: string[]`, no counts (ADR 0001).** It travels in `/api/auth/me` (the one
  persisted core query, `["toon","me"]`) and drives the shell: `moduleGuard(enabledIds, id)`
  (`apps/web/src/modules/enabled.ts`, pure) decides `RequireModule`, which `moduleLayoutComponent(id)` wraps
  around every module layout's `<Outlet/>`. The query client's `onError` invalidates `["toon","me"]` on
  `404 module_disabled`, so a stale bundle and a live disable take one path. Core query-key segments (`me`,
  `sessions`, `oauth-providers`, `households`, `invite`, `detail`, `members`, `invites`) never equal a module id.
  Pinned by `apps/web/src/modules/enabled.test.ts` and `apps/web/src/modules/layout.test.tsx`.
- **Validation details come from the wire-issue vocabulary (E1, ADR 0013).** A schema that can fail on the wire is
  built from `packages/shared/src/core/schemas/checks.ts` (or carries the `WIRE_ISSUE` annotation), is decoded with
  `ALL_ISSUES` (every issue collected, as Zod did) and exports its type as `Types.DeepMutable<typeof X.Type>`;
  `apps/api/src/lib/validate.ts` (`decode`, `decodeOrThrow`, `decodeOption`) fails with `Schema.SchemaError`,
  `toApiError` maps it once through `toValidationIssues` (`packages/shared/src/core/i18n/issues.ts`), so every
  route's `details` item is `{ path, code, message, i18n }` in the negotiated locale. Never read an Effect
  message or write `details` by hand. The golden JSON of `packages/shared/test/fixtures/schema-golden/` (made
  once from Zod 4.5.4) and the parity tests of `packages/shared/test/parity/` are the oracle: same `ok`, same
  output, same issues. The P7 allow maps in those tests (and `P7_ALLOW` in `packages/shared/test/schema-checks.test.ts`)
  are the only tolerated divergence: a struct's own refinement and an array or string length check do not run
  while a child failed, so an already rejected input may list fewer trailing issues; a listed id that does not
  diverge fails. Consequence for forms: a struct-level error (the card `value` check) shows one submit later.
  A construct the vocabulary lacks is added to `checks.ts` with a `primitives.json` case, never worked round.
- **Uploads are signed, not cookie-checked.** `/uploads/:filename` answers 404 for an unsigned, forged or expired
  URL (`apps/api/src/lib/uploadUrls.ts`); `<name>.thumb.webp` is built with `sharp` on first request and falls
  back to the original (short cache) when sharp cannot convert.
  Pinned by `apps/api/test/uploads.test.ts` and `apps/api/test/thumbnails.test.ts`.
- **Cross-household guard (D8).** The household comes from `:householdId` only. Every by-id lookup in a module
  service filters by `membership.householdId` and answers `404 not_found` for another household's id;
  `apps/api/test/recipe-cross-household.test.ts`, `apps/api/test/finance-cross-household.test.ts`,
  `apps/api/test/calendar-cross-household.test.ts` and `apps/api/test/calendar-waste-cross-household.test.ts` address
  every by-id route with another household's id (cards: another user's card). A new by-id route gets its case
  in the same commit.
- **API import cycle: read the registry inside functions, hoist what the cycle touches (E7: see "Middleware, APIs and handler layers are
  TDZ-safe").** `apps/api/src/middleware/session.ts` → `apps/api/src/core/services/auth/users.ts` →
  `apps/api/src/core/services/households/modules.ts` → `apps/api/src/modules/index.ts` → the recipe manifest →
  `apps/api/src/modules/recipe/routes/index.ts` reaches the route files while `session.ts` may still be evaluating. The Hono-era
  failure ("Cannot access 'requireHandler' before initialization" in the real server while every in-process test passed) is the
  shape to avoid: a module-scope read of something still being evaluated. `API_MODULES` is never read at module top level
  (`initializeHousehold` and `appRoutesLayer()` read it inside functions). `apps/api/test/import-order.test.ts` imports each
  real entry point first, in a fresh process. A new module-scope call into a core middleware or service needs the same care.
- **Placeholders and claim invites (ADR 0006, plan m3b decisions 1-6).** A placeholder is a core user row with
  `email IS NULL AND password_hash IS NULL`: `isPlaceholderUser` (`apps/api/src/core/services/auth/users.ts`) is
  the one predicate (an OAuth-only account also has a NULL hash). It has no OAuth link, session or avatar and
  cannot sign in; `toUserDto` answers 401 for one, and every reader of `users.email` narrows it
  (`requireAccountEmail`). `Users.claimPlaceholderUser` is ONE conditional `UPDATE … WHERE id = ? AND password_hash IS
  NULL AND email IS NULL RETURNING id` (F gotcha 72: never check-then-write; zero rows is `409
  member_has_account`, a unique violation `409 email_taken`; `apps/api/test/placeholders.test.ts` races two
  claims). A claim invite is redeemed ONLY by `POST /api/auth/register { inviteToken }` (same user id, so every
  payer, income person, membership and seat stays valid); `POST /api/households/invites/accept` answers `409
  invite_claim_requires_register` unless the caller IS the claimed user. Creating one is admin+ and revokes the
  older pending one; a spent claim token is `404 invite_invalid` (F gotcha 55). The claimed account is
  unconfirmed (read-only until confirmed). Placeholders never hold finance slot 1; deleting a household deletes
  its placeholder users. `removeMember` runs every build module's `onMemberRemoving` veto first (finance's:
  "A seated participant cannot leave while the ledger has rows." in `docs/modules/finance.md`).
- **The origin guard trusts `WEB_ORIGIN` (plan m3b decision 15, F gotcha 66).**
  `apps/api/src/middleware/originGuard.ts` runs on `/api/*` for unsafe methods before the routes: an `Origin`
  listed in `WEB_ORIGIN` (`env.webOrigins`) passes (the dev setup calls the API from `:5173`, the same SITE,
  which F's rule would refuse); otherwise `Sec-Fetch-Site: cross-site|same-site`, `Origin: null` and an `Origin`
  host other than the request host answer `403` with `server.error.originMismatch`; no `Origin` (curl, tests)
  passes; only the host is compared (TLS ends at the Caddy). It is the fourth global middleware (after CORS, before any
  route, `originGuardMiddleware` registered by `globalHttpLayer()`; its refusal is `errorResponse(new Forbidden(…))` and still
  carries the security and CORS headers), and `readJson` in `apps/api/src/core/routes/auth.ts` wants `Content-Type: application/json`. A second origin
  that legitimately calls the API must be listed in `WEB_ORIGIN`, comma-separated.
  Pinned by `apps/api/test/security.test.ts` and `apps/api/test/http-global.test.ts`.
- **The CSP and the baked API URL (plan m3b decision 16, F gotchas 67 and 50, ADR 0007).**
  `apps/api/src/middleware/securityHeaders.ts` (a pre-response handler of the global layer: every response, errors and the
  preflight included; the literal header set is `docs/API.md` "Security headers and the CSP") hashes every inline `<script>` of the built `index.html` at boot
  and sends `script-src 'self' 'wasm-unsafe-eval' <hashes>` (zxing-wasm), `style-src 'self'`, `img-src 'self'
  data: blob: https:`, `media-src 'self' blob:`, `connect-src 'self'`, `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `nosniff`; no HSTS (the Caddy's, D11), no `Permissions-Policy` (it would block the
  camera). **`connect-src 'self'` presumes a build with `PUBLIC_API_URL=""`:** an absolute value is baked into
  the bundle and, served from any other origin, blocks every API call and `/uploads` image, which a run at
  `localhost:3001` hides. Build the served app with the variable EMPTY (`.env.example` keeps the absolute value
  for `bun run dev`); unset in a production build is relative too (`apps/web/src/lib/api.ts`). Only a browser
  sees a CSP break: check a served build at a second origin (`127.0.0.1:3001`) with the console open.
  Pinned by `apps/api/test/security.test.ts` and `apps/api/test/deploy-dockerfile.test.ts`.
- **Core hardening from `1715207` (F gotchas 18 and 74).** `clientIp` reads the LAST `X-Forwarded-For` entry
  (what the trusted proxy appends; keep `header_up X-Forwarded-For {remote_host}` in the Caddyfile), e-mail
  invites are rate limited per user (10/h; a claim invite without an address is not) and `POST /api/households`
  too (5/h, so a headless script that creates households must restart the API between passes), a production
  API refuses the `change-me…` `SESSION_SECRET`, `apps/api/src/db/client.ts` creates the data directory `0o700`,
  passwords are capped at 200 characters before argon2, display and household names refuse control characters,
  and a 401 in the web app purges the persisted cache like a logout.
  Pinned by `apps/api/test/security.test.ts`, `apps/api/test/config.test.ts` and `apps/api/test/db-pragmas.test.ts`.
- **Claim links are credentials (plan m3b decision 14).** Whoever holds a claim link becomes that person. The
  migration's `--apply` report and stdout carry live links (`<first WEB_ORIGIN>/invite/<token>`; never a dry run)
  and must stay outside any repository (`docs/migration.md`); the claim-link dialogs show the link to an admin
  and copy it (`shareOrCopy` / `copyToClipboard`); a record of a real run names counts only.
  `apps/api/test/legacy-placeholders.test.ts` redeems a migrated claim link.
- **Core copy stays module-neutral (plan m3b decision 8).** The core Gruppe screens and the auth pages say
  "Gruppe" and never "Buchungen", "Platz" or "Haushalt": F's module-neutral strings are in the core catalogs
  byte-identical, F's finance-flavoured ones live only in `finance.settings.household.*`. Five core web strings
  are NEW German (`auth.register.claimHint`, `auth.invite.claimSubtitle`, `household.placeholder.removeConfirm`,
  `household.claim.hint`, `household.claim.linkHint`), listed in `NEW_GERMAN` with the server keys
  `server.household.placeholderRole` and `server.finance.placeholderSlotOne`. A person's name is content and
  never goes through `t()`.
  `NEW_GERMAN` in `scripts/i18n-check.ts` pins them.

### Web shell

- **One web runtime; API calls are described once (E6, plan `docs/plans/e6-web-client.md` P1 to P17, EFFECT.md E11).**
  `apps/web/src/lib/runtime.ts` is the only file that calls `ManagedRuntime.make` on the web and the only file with a `fetch(` call
  (`lateBoundFetch`: `FetchHttpClient.Fetch`'s default reads `globalThis.fetch` once and caches it, so a test that stubs `fetch` per
  test would never be seen; the layer also sets `credentials: "include"` and `TracerPropagationEnabled` false, so no `b3` /
  `traceparent` header and no new preflight). Like the API's, it never runs at module scope: `WebLayer` is `Layer.suspend` over a
  hoisted function, and `apps/web/src/lib/runtime.test.ts` imports each file of the cycle `api-client` -> `i18n/store` -> `api` ->
  `runtime` FIRST in a fresh process. `runPromise(effect, { signal })` is the one way web code runs an API effect: an abort rejects
  with `signal.reason` (an `AbortError`, as `fetch` did), any other failure with the tagged `ApiError` itself. The order of
  `ApiClient.execute` is today's: the 401 hook (a 401 on any call but `fetchMe` purges the persisted cache through the registered
  handler), 204/205 without a body, the body read as text and parsed tolerantly, a non-2xx mapped to the envelope, a 2xx handed to the
  helper; every `HttpClientError` is `network_error` with status 0 (a body that fails mid-read used to be the raw `TypeError`, deviation D1).
  `ApiError` is a `Schema.TaggedError` with PERMISSIVE field schemas (a constructor never throws on a value the code passes, as in the
  API's `apps/api/src/lib/errors.ts`). Each endpoint is ONE member of `CoreApi` / `RecipeApi` / `FinanceApi` / `ImportApi` and the
  exported function the screens call is a `function` facade over `runPromise` with today's name, signature and `Promise` result; a
  `queryFn` calls `runPromise(Api.NAME(ARGS), { signal })`. **Decoding:** a READ (`getJson`) decodes with `DECODE_OPTIONS = {
  disableChecks: true }`, so structure and types are checked (keys, `string` / `number` / `null`, literal unions) and the shared
  schemas' wire CHECKS (UUID, ISO pattern, lengths, ranges) are NOT, because the server applied them on the way in and rows written
  before a limit tightened, migrated and placeholder rows must still render; a mismatch is `ApiError { code: "invalid_response",
  status: <the 2xx> }` and `shouldRetry` (`apps/web/src/lib/queries.ts`) NEVER retries it (deterministic; pinned by
  `apps/web/src/lib/should-retry.test.ts`). A WRITE (`sendJson`, `sendForm`) whose 2xx body fails the decode resolves the RAW payload
  (a DEV `console.warn` only): the server applied it, so failing it would roll back an applied optimistic update, drop a paused
  capture from the outbox and retry a taken request. The decoded type is `Types.DeepMutable<S["Type"]>` with the ONE cast inside the
  helper. Decoding must be the identity on the wire (a decode strips undeclared keys): the three contract tests drive the real app and
  assert `decode(body)` equals `body` for every route the web decodes; a route that cannot satisfy it without breaking the golden or
  parity tests gets a one-line marker `lenient: { schema: "<XResponseSchema>", reason: "..." }` in its contract row AND
  `lenient(<XResponseSchema>)` in the client (validate, log in DEV, return the raw payload), and the two-way grep of the E6-T09 verify list
  keeps the two lists equal (every marker is applied, every `lenient(X)` has a marker); at E6 the list is EMPTY. **Idioms rule (13)**
  (`apps/api/test/effect-idioms.test.ts`): web code imports `"effect"` and `"effect/http"` only (never a subpath), only the files of
  `WEB_EFFECT_ALLOW_LIST` import `effect` at all, `\bfetch\(` only in `runtime.ts` and `new XMLHttpRequest` only in `importApi.ts`
  (the upload progress), each list with its stale-entry check; `queries.ts` files import `runPromise` from `@/lib/runtime`. The import
  client keeps its own mapping and pass-through (deviation D4: no `statusText`, so an unmapped status without an envelope message shows
  `recipe.import.error.unknown.title`). **Deploy rule (D5, `skipWaiting` is off):** a READ now fails on a structure or type mismatch, and
  an installed PWA runs the PREVIOUS bundle until every tab closes, so a server change that WIDENS a response literal or shape (a new
  `TransactionOrigin`, `TagKind`, `InviteStatus` or role value, a field turning nullable, a new required key the old schema lacks as
  optional) is a two-step deploy: first a release whose shared schema accepts the new value while the server never sends it, then,
  once the old service workers have been replaced, the release that sends it. Everything additive that only ADDS an optional key is
  safe (an undeclared key is stripped, not refused). Stored data no fixture has is the residual risk: the owner's snapshot sweep
  (`WEB_CONTRACT_SNAPSHOT=1`, "Testing and tooling" and `docs/open-work.md` A11) covers it.
- **`MessageKey` must stay a literal union (D10).** `apps/web/src/modules/catalogs.ts` objects
  (`MODULE_CATALOGS_DE/EN`) are literal-typed with no annotation, ever: an index-signature type turns `MessageKey`
  into `string` and every `t()` typo compiles. A literal-union test and a `@ts-expect-error` in
  `apps/web/src/lib/i18n/i18n.test.ts` guard it. Catalogs reach the registry through `catalogs.ts`, never through
  `apps/web/src/modules/index.ts` (which imports screens that import i18n: a cycle).
- **No module-level constants over `WEB_MODULES`** in files a manifest imports; nav items are computed by
  functions at render time (`apps/web/src/components/layout/nav-items.ts`,
  `apps/web/src/components/layout/use-nav-items.ts`).
  Pinned by `apps/web/src/components/layout/nav-items.test.ts`.
- **Persist policy comes from the manifests (D9).** `buildPersistPolicy(WEB_MODULES)` feeds
  `createShouldPersistQuery` / `createShouldPersistMutation` (`apps/web/src/lib/persist.ts`); a module that
  declares `persistMutationNamespaces` must also register `mutationDefaults` for each namespace (a restored
  mutation carries its variables, not its function). `PERSIST_BUSTER = "household-v1"`. The persisted cache is
  keyed per user id and purged on account switch (toon-recipe's data-leak guard, unchanged).
  Pinned by `apps/web/src/lib/persist.test.ts` and `apps/web/src/modules/persist.test.ts`.
- **Service worker.** `apps/web/vite.config.ts` rules, first match wins, so every `NetworkOnly` rule precedes the
  one `NetworkFirst` rule: `/api/auth/`, the recipe `imports`, `shopping-lists`, `plan` and `/api/recipe/cards`,
  and finance's `/api/households/<id>/finance/…` (toon-finance gotcha 11: the offline ledger IS the persisted
  TanStack cache; a `NetworkFirst` hit would overwrite an optimistic row) and the calendar's
  `/api/households/<id>/calendar/…` (M8: the persisted cache is its offline copy) are `NetworkOnly`; then
  `recipes|tags|collections` (`NetworkFirst`, cache `toon-api-recipes`) and `/uploads/` (`CacheFirst`), ADR 0011.
  `/api` and `/uploads` stay out of the navigation fallback; `skipWaiting` is off. The dev server has no service
  worker: check offline behaviour on the built app (`bun run build`, then `WEB_DIST_DIR=./apps/web/dist bun run
  start`).
  No test pins the order: read `apps/web/vite.config.ts` against ADR 0011.
- **The route tree is strict, with one hole.** `WEB_MODULES = [recipeModule, financeModule, calendarModule] as const satisfies
  readonly WebModule[]` and no manifest carries a type annotation (`satisfies WebModule<"…">` only), so
  `router.tsx`'s `WEB_MODULES.map((m) => m.route)` keeps the concrete route types and a raw
  `<Link to="/recipe/nope">` fails `tsc`. The hole: module screens navigate through `AppLink` / `useAppNavigate`
  (`apps/web/src/lib/nav.tsx`, `to: string`) and template-string helpers, which `tsc` does NOT check; an
  unprefixed target (`/plan` instead of `/recipe/plan`) compiles and lands on `NotFoundPage`. The LINKS greps are
  the check, not `tsc`: recipe's in `docs/modules/recipe.md` section 5, `LINKS_FIN` with `NOROUTER`, `NOCORE`
  and `NOSHADOW` in `docs/modules/finance.md` section 5.1, the calendar's LINKS in `docs/modules/calendar.md` section 5.1. Run them after every web port; a headless pass that
  clicks the links is the second check.
- **A module owns its layout route and its static import graph stays shell-free (SPEC §2).** `WebModule.route`
  is built in `modules/<id>/routes.tsx` with `getParentRoute: () => householdScopedRoute` from
  `apps/web/src/route-roots.tsx`, which imports neither `@/modules` nor the shell; `AppLayout` is attached in
  `apps/web/src/router.tsx` via `appRoute.update({ component })`. Nothing the manifest imports statically
  (`index.ts`, `routes.tsx`, `HomeCard.tsx`, catalogs, `offline.ts`, the `settingsSections` and `enableDialog`
  components) may import `@/modules`, `@/components/layout` or `use-nav-items`: the registry would re-enter a
  manifest that is still evaluating (TDZ `ReferenceError` when a test imports the manifest first). Screens are
  `lazyRouteComponent`s, which keeps them out of that graph. `apps/web/src/modules/recipe/manifest.test.ts`,
  `apps/web/src/modules/finance/manifest.test.ts` and the two `persist.test.ts` import `./index` first.
- **The offline queue survives a second reload (M3-T12 fix).** TanStack's `onlineManager` starts "online" and
  only changes on a browser event, so an app reloaded while offline believed it was online: the restored paused
  write re-ran, failed and waited in an unpaused retry, which the persist policy (paused mutations only) dropped,
  and a second reload lost the booking. `apps/web/src/lib/query-client.ts` `seedOnlineManager()` seeds the
  manager from `navigator.onLine` once at boot. The shell has no sync badge; a module shows its own note
  (finance's `PendingSyncNote`).
  Pinned by `apps/web/src/lib/query-client.test.ts`.
- **`ActionMenu` has `renderTrigger` and `item.current`.** `renderTrigger(props)`
  (`apps/web/src/components/ui/ActionMenu.tsx`) replaces the icon button with the caller's element (spread
  `props`; the phone module chip is one); a `current` item is the brand-soft row with `aria-current="true"` and a
  check. Both are optional.
  No test pins them; `apps/web/src/components/layout/ModuleSwitcher.tsx` is the `renderTrigger` caller.
- **Every shell screen renders `PhoneHeaderRow` itself** (no global top bar, ADR 0010): the recipe screens
  (guard `apps/web/src/modules/recipe/phone-header.test.ts`, reading `routes.tsx` for the screen list; the detail
  is exempt: its hero owns the top edge), finance's (`apps/web/src/modules/finance/phone-header.test.ts` and its
  `PageHeader`), the calendar's (`apps/web/src/modules/calendar/phone-header.test.ts` and its `CalendarPageHeader`), and the core's Home, Settings, Gruppen and Gruppe detail
  (`apps/web/src/core/features/phone-header.test.ts`). It is a `<header data-app-shell>`: `print.css` hides it.
- **The design-system test is the Table D gate (M4-T08).** `apps/web/src/styles/design-system.test.ts` makes the
  design greps permanent: the four `apps/web/src/styles/theme.css` blocks define the same 50 tokens (39 plus the calendar's eleven, ADR 0016,
  `apps/web/src/styles/calendar-tokens.test.ts`), no
  `fonts.googleapis`, arbitrary `text-[…]` sizes only where the pinned record says (the 34 inherited toon-recipe
  hits in 17 files; a cleanup edits the record in the same commit), `bottom-0` only on the tab bar and the recipe
  hero overlay, no `font-display` beside `font-semibold`, no bare `1fr` track in an arbitrary grid template, text
  arrows only on the four pinned catalog lines, `data-app-shell` only on header/nav/aside. A new violation fails
  `bun test` with file:line and the rule; never relax a rule to get green. Table D is in plan
  `docs/plans/m4-design-pass.md` §2.
- **Hand-written utilities beat breakpoint variants.** `.px-gutter`, `.bleed-gutter`, `.bleed-gutter-inset`,
  `.pb-tabbar`, `.bottom-tabbar` in `apps/web/src/styles/index.css` are emitted after everything Tailwind
  generates, so `lg:mx-0` / `lg:px-8` cannot override them (a media query adds no specificity); change the
  `--gutter` variable (`lg:[--gutter:2rem]` on `<main>`) instead. `-mx-gutter` does NOT exist: use
  `bleed-gutter` or `bleed-gutter-inset`. `top-topbar` is dead (a sticky header uses `top-0`, the status-bar
  inset is `<main>`'s). `.bottom-tabbar` adds 1px for the tab bar's own top border.
  No test pins the cascade; `apps/web/src/styles/index.css` holds the utilities.
- **Theme colour has one source.** `apps/web/src/lib/theme-colors.ts` `THEME_COLORS = { light: "#faf5ee", dark:
  "#17120f" }` (the light and dark `--bg`); `apps/web/index.html`'s inline pre-paint script keeps the literals
  (it cannot import), `apps/web/src/lib/theme.ts` and the manifest import the module;
  `apps/web/src/lib/theme-colors.test.ts` enforces agreement with `theme.css`. Tokens, `body` background and
  `<meta name="theme-color">` follow the resolved scheme in all four combinations (OS light/dark x no
  preference/the opposite explicit `toon.theme`). Built CSS is minified (`#291f180d`): compare colours as RGBA.
- **The manifest.** `apps/web/pwa-manifest.ts` (a plain `as const` object plus a mutable-typed copy for the
  plugin) holds name/short_name "Haushalt", the German `description`, the four icons and the three shortcuts
  (`/recipe/import`, `/recipe/recipes/new`, `/finance/new`); a shortcut into a module the household has not
  enabled lands on Home with the module-disabled toast. `.webmanifest` is served as `application/manifest+json`
  (`apps/web/src/pwa-manifest.test.ts` reads the manifest).

### Testing and tooling

- **`repos/` is fenced off, not deleted.** The vendored Effect source carries about 580 vitest files of its own, which
  are reference material and not this repo's tests. `bunfig.toml` `[test] pathIgnorePatterns = ["repos/**"]` keeps
  them out of `bun test` (Bun 1.4.2 and 1.4.3 both honour it). The proof is `bun test repos`: it prints "The
  following filters did not match any test files" and exits 1, by design; a path filter that matches `repos/`
  finds nothing, so never "fix" it. `.dockerignore`, `.vscode/settings.json` and Vite's `server.watch.ignored`
  fence the rest; the idioms test reads all four.
- **The idioms test is the E12 gate.** `apps/api/test/effect-idioms.test.ts` makes the greps of `docs/EFFECT.md` E12
  permanent, in the shape of the design-system gate: a comment-free line scan (or a documented multi-line scan), one `describe`
  per rule, a regex self-check, a failure of `file:line: code`, and a pinned allow list (file or path prefix to reason) whose stale
  entries fail. All 21 rules are on (`PENDING_RULES` lists none; "Conventions" maps each idiom to its number). The non-empty allow
  lists: (5) `apps/api/src/runtime.ts` and `apps/web/src/lib/runtime.ts`; (12) `process.exit(` in `apps/api/scripts/support/main.ts`;
  (13) `WEB_EFFECT_ALLOW_LIST`, `fetch(` in `apps/web/src/lib/runtime.ts`, `new XMLHttpRequest` in
  `apps/web/src/modules/recipe/features/import/lib/importApi.ts`; (17) the pure workbook parser `apps/api/scripts/finance-import/amounts.ts`
  and its loop in `apps/api/scripts/finance-import-xlsx.ts`; (20) six files: `apps/api/src/index.ts` (boot, shutdown),
  `apps/api/src/http/in-memory.ts`, `apps/api/src/config.ts` (the eager validation), `apps/api/src/core/routes/system.ts` (pinned by
  `apps/api/test/runtime.test.ts` (b), `docs/open-work.md` O-11), `apps/api/src/modules/recipe/services/ocr/tesseract.ts` (the
  Promise engine contract) and `apps/api/src/db/database.ts` (the drizzle transaction callback). (10), (11), (14), (15), (16), (18),
  (19) and (21) allow nothing. A new rule is a `describe` in the commit that makes it true, never a skipped test. Never relax a rule
  to get green.
- **The web contract tests and the snapshot sweep (E6, plan P7, P7b).** `apps/api/test/web-contract-core-recipe.test.ts`,
  `apps/api/test/web-contract-finance.test.ts` and `apps/api/test/web-contract-legacy.test.ts` decode every response the web clients decode
  with `{ disableChecks: true }` and assert the decoded value `toEqual` the body (83 JSON rows and 27 void rows, 49 finance rows; the legacy
  file runs the same sweep over the migrated fixtures, ADR 0005 and ADR 0006 states included). The second `describe` of the legacy file is the
  SNAPSHOT SWEEP, skipped unless `WEB_CONTRACT_SNAPSHOT=1` (it then runs against `TEST_DATABASE_URL`, the owner's local COPY of a production
  snapshot, and prints routes decoded and failures per schema and issue PATH, never a value); the default run prints its skip. A new web
  read route gets a row in the same commit; a new `lenient` row needs its `lenient(X)` in the client, the two-way grep checks both
  directions.
- **A test that runs `sharp` carries an explicit time budget.** `apps/api/test/thumbnails.test.ts` gives its route tests
  `SHARP_TEST_TIMEOUT_MS` (60 s) as the `test(...)` timeout: under the load of parallel worktrees (354 s for a suite that
  takes 25 s alone) bun's 5 s default failed four of them. A gate that fails keeps its `(fail)` lines and any `Unhandled
  error` block in the log; a bare count hides which test it was.
- **Headless runs.** Install Playwright in a scratch directory outside the repo (a `bun add` log ending in
  `exit=$?`), log in with `fetch("/api/auth/login")` from the page, assert `scrollWidth <= clientWidth`, and never
  match the tab bar by its `aria-label` (`SideNav` carries the same one): the tab bar is `nav.fixed`, the sidebar
  `aside[data-app-shell]`. Login is rate limited per address in memory (`429` after a few runs): reuse a saved
  `storageState` per user across contexts and runs, or restart the API. `position: fixed` elements have
  `offsetParent === null`; test visibility with `getBoundingClientRect` and computed `display`. A module disabled
  through the API behind the SPA's back is noticed on the first `404 module_disabled`: re-enable through the Home
  "Aktivieren" button. `["toon","me"]` is persisted, so a household created through the API after the SPA visited
  `/` is unknown to it: create it from a non-SPA page (`goto("/api/health")`, then `fetch`). The active household
  is `localStorage` `toon.activeHouseholdId`, then the profile's `activeHouseholdId` (switch: PATCH
  `/api/auth/me` and set the key on a non-SPA page; accepting an invite also moves it). Phone screenshots use
  `isMobile: true, hasTouch: true` at 390x844. Never `pkill -f` a pattern that also matches the shell running it;
  kill the server's pid.
  The record is `docs/plans/m7-harden.md` section 9; no test.
- **`scrollbar-gutter: stable`** on `<html>` (toon-recipe's) makes `scrollWidth` 375/1425 against `clientWidth`
  390/1440 under classic scrollbars (a desktop-Chromium context; a mobile context with overlay scrollbars
  measures 390/390); check no-overflow as `scrollWidth <= clientWidth` plus no element's right edge beyond
  `innerWidth` + 0.5, and when the two numbers differ show once that `documentElement.style.scrollbarGutter =
  "auto"` makes them equal. A bar that bleeds to the viewport edge ends at 375 beside the gutter, 390 without.
- **i18n-check is self-contained.** Its parity half greps the commit the branch forked from on main
  (`I18N_CHECK_BASE=<sha>` overrides it) and nothing outside this repo: since the port every source string is in
  the repo's own history. A genuinely new German string still goes to `NEW_GERMAN`; a module without a source
  repository is admitted by namespace instead (`NEW_GERMAN_NAMESPACES`: `calendar.` and `server.calendar.`, ADR 0016).
  The check is `scripts/i18n-check.ts`.
- **Long commands** (cold `bun install`, docker build, headless browser) go to the background with one log
  ending in `exit=$?`. A `docker build` is judged by `$?` written to its log, never through a pipe (`docker build
  ... | tail` reports tail's status); the repo-root `build.log` is ignored by `*.log` and removed after the check.

### Legacy migration (`migrate:legacy`, `docs/migration.md`)

- **`migrate:legacy` reads snapshots and writes only through a redirected, validated path (plan m5 decisions 3,
  5, 6, 16).** `apps/api/scripts/legacy/sources.ts` copies each legacy file and its `-wal` (never `-shm`) into a
  scratch directory and opens the copy with a plain `createClient` (not `createDatabase`: its WAL pragma rewrites
  a header) plus `PRAGMA query_only = 1`; a copy of the main file alone loses every page still in the WAL, so the
  operator copies the whole volume. A schema gate (exit 2) wants recipe at 9 migrations / `0008_shopping_bought`
  and finance at 3 / `0002_placeholder_members`. Dry run = the full pipeline against a scratch copy of the
  target; `--apply` = that pass, then the real write only if it is clean, then a balance re-check. Every row and
  its `legacy_ids` entry go in the same `client.batch(…, "write")` (chunks of 500); a mapped row is never updated
  again (a one-shot cutover that resumes, not a sync).
  Pinned by `apps/api/test/legacy-framework.test.ts` and `apps/api/test/legacy-cli.test.ts`.
- **The CLI never imports `src/env.ts`, and its import order is load-bearing.** `apps/api/src/env.ts` freezes
  `env.databaseUrl` on first load and `apps/api/src/db/client.ts` opens that database on import, so importing
  either before the redirect would create and switch to WAL the REAL target during a dry run.
  `apps/api/scripts/migrate-legacy.ts` is an Effect program under `BunRuntime.runMain` (E5, plan `docs/plans/e5-scripts.md` P10) and
  imports only `node:` builtins, `effect`, `@effect/platform-bun` (neither reads the environment nor opens a database; plan deviation 3) and
  types statically, resolves `DATABASE_URL` and `UPLOAD_DIR` itself (`resolveCliEnv`: process environment, then the root `.env` and
  `.env.local` with env.ts's rules, kept in step by hand), points `process.env.DATABASE_URL` at the scratch copy
  BEFORE its first dynamic import, then imports `src/db/client.ts`, then `src/db/migrate.ts`, and only then
  `./legacy/*`. A relative `file:` target resolves against the repo root computed in the CLI file. The library
  takes the target `db` and `client` as parameters and never uses the shared `db`.
  `apps/api/test/legacy-cli.test.ts` guards the order textually and by subprocess (no target file and no `-wal`
  after a dry run). **Every synchronous exit-2 throw of the CLI is lifted by name** (`liftExitTwo` in the CLI file, `liftTagged` in
  `apps/api/scripts/legacy/io.ts`: `Effect.suspend` + `try` + `Predicate.isTagged`): `CliUsageError`, `MappingError` and `LegacyInputError`
  thrown inside Effect code are DEFECTS, `Effect.catchTags` misses them and the CLI would exit 1 where it must exit 2 while every
  in-process assertion stayed green (`Cause.squash` returns the same object); `apps/api/test/legacy-cli-usage.test.ts` spawns the five exit-2
  paths. The CLI's teardown sets `process.exitCode` and never calls `process.exit`, so the report reaches a pipe in full; a signal
  interrupts it after its finalizers (the scratch directory is removed) and exits 130.
- **Subprocess tests of the CLI set `NODE_ENV=development`.** The child inherits `NODE_ENV=test`, under which
  `apps/api/src/env.ts` picks its own temp test DB and `resolveCliEnv` reads no `.env`; they also pass an
  absolute `DATABASE_URL`, an explicit `UPLOAD_DIR` and a placeholder `SESSION_SECRET`. Migration tests use their
  own temp-file targets and temp upload directories, never the shared test `db` and never `env.uploadDir`.
- **Claimed ids and the verified-only e-mail match (users, households).** The users step (`migrateUsersEffect`) decides every recipe
  user first, then the finance-only ones, with an in-run `Set` of claimed target ids next to the DB lookup (the
  fixture's gina has toon-finance's id equal to cleo's toon-recipe id, both in one batch: a DB lookup alone would
  fail the primary key and "fix" the wrong row). A claimed id gets `crypto.randomUUID()` and a warning (household
  ids too), random per pass, so a dry run and the `--apply` after it print different ones. A legacy user whose
  e-mail matches a target account is mapped onto it ONLY when that account has `email_verified_at`, else exit 1
  ("unverified target account <email> blocks the merge"), on a resumed run too. An OAuth-only recipe account
  keeps no password when a finance row has its e-mail (finance never verified addresses: account takeover).
  Finance-only users start unconfirmed.
  Pinned by `apps/api/test/legacy-users.test.ts`.
- **Ledger states the runtime refuses are written by the migration alone (ADR 0005).** A one-participant finance
  household gets its `finance` module row, a lone slot-2 participant is re-seated in slot 1, a plan payer who is
  not a participant is re-pointed to slot 1 and an income naming a non-participant is kept, each a warning; the
  migration writes `household_modules` and `finance_participants` directly and never calls
  `initializeHousehold`, `onHouseholdCreated` or `onEnable` (they would seed default categories next to the
  copied ones). The balance invariant is identity-based: computed from the perspective of the legacy user who
  holds slot 1 in the TARGET and compared with `getBalance` on the migrated rows (balance, count, amount sum).
  Pinned by `apps/api/test/legacy-finance.test.ts`.
- **The legacy fixtures are built, checked and tracked on purpose.** `apps/api/test/fixtures/legacy/build.ts`
  rebuilds `recipe.db`, `finance.db` and `uploads/` deterministically from verbatim copies of the two sources'
  migration SQL and `apps/api/test/fixtures/legacy/facts.ts` (argon2id hashes precomputed; Bun's hash is
  salted); `build.ts --check` and `apps/api/test/legacy-fixtures.test.ts` compare a logical dump with the
  committed files. The repo ignores `*.db`; `.gitignore` un-ignores exactly `apps/api/test/fixtures/legacy/*.db`
  (rollback journal, so no `-wal` is ever produced). Never edit the migration copies or the databases by hand;
  change `facts.ts` or `build.ts` and rebuild.
- **Migration evidence stays out of the tree.** `migration-in/` and `migration-out/` are in `.gitignore`; real
  copies of the owner's data never get committed, and a record of a real run names counts and OK/FAIL only.
- **The claim test cleans the shared DB (plan m3b decision 18).** `apps/api/test/legacy-placeholders.test.ts`
  runs a real `apply` of a FINANCE-ONLY input into the shared test DB (it must: `app.request` sees only that DB)
  and registers with the migrated claim token. To keep later files order-independent it asserts first that no
  fixture e-mail exists, records the counts of `users`, `households`, `household_invites` and `legacy_ids`, and
  in `afterAll` deletes every household and user the run wrote (households first so the cascade takes the
  finance rows) and asserts the counts are back. The merge path is proven on the legacy harness's temp DBs.

### Deploy (`docs/deployment.md`)

- **The Dockerfile refuses a bundle with the dev API URL (M6).** The web-build stage sets `PUBLIC_API_URL=""`
  (set and empty) and its `RUN` ends in `! grep -rqF 'localhost:3001' apps/web/dist`, so an image whose bundle
  carries the dev fallback of `apps/web/src/lib/api.ts` cannot be built (the CSP's `connect-src 'self'`,
  toon-finance gotcha 50). Bun 1.4's isolated linker needs THREE `node_modules` copies in the runtime stage
  (`/app/node_modules`, `/app/apps/api/node_modules`, `/app/packages/shared/node_modules`; `apps/web` is
  absent on purpose): copying only the root builds, starts and dies with "Cannot find module
  '@libsql/client'". The runtime user is `bun` (uid 1000) with no capability (`cap_drop: [ALL]`,
  `no-new-privileges`); a volume PRE-FILLED by a root container (the migration's copy-in) keeps root
  ownership, which is why `docs/migration.md` step 6 ends in `chown -R 1000:1000 /data`.
  Pinned by `apps/api/test/deploy-dockerfile.test.ts`.
- **Caddy treats an empty `{$VAR}` as set (M6, plan m6 decision 7).** `{$VAR:default}` falls back only when the
  variable is UNSET; a set-but-empty `RECIPE_HOSTNAME` leaves a site block without an address and `caddy adapt`
  fails with "server block without any key is global configuration, and if used, it must be first". The
  `docker/Caddyfile` defaults `http://old-recipe-hostname.unset.invalid` and
  `http://old-finance-hostname.unset.invalid` cover the unset case only; set-but-empty is covered by compose's
  `${RECIPE_HOSTNAME:-http://…unset.invalid}` defaults. Prove the empty case through compose (`docker compose
  --env-file <empty> config`, then `run … caddy validate`); a raw `docker run -e RECIPE_HOSTNAME=` failing is
  expected, never a reason to change the Caddyfile. One global `cert_issuer {$TOON_TLS_ISSUER:acme}` serves every
  site, so the old-hostname sites need no `tls` block (one on the `.invalid` placeholder is a config error).
  Pinned by `apps/api/test/deploy-compose.test.ts` and `apps/api/test/deploy-caddyfile.test.ts`.
- **The old-hostname blocks use `handle`, never a bare `redir` (ADR 0008).** Caddy sorts `redir` before
  `handle`, so a bare `redir` would swallow `/sw.js`; every route of an old-host block is a `handle`, and
  `/sw.js` answers 200 with the retiring worker (`(retire_old_worker)`: deletes the caches, claims, unregisters
  itself, reloads every window onto the 301). A 301 is cached by browsers, so a Table R row must be right before
  go-live (`apps/web/src/legacy-redirects.test.ts` resolves every target against the route tree). The worker
  leaves IndexedDB alone: the cutover guide tells everybody to open both old apps online once first.
  `apps/api/test/deploy-caddyfile.test.ts` pins the verbatim `(hardening)` and `(fwd)` snippets by digest: the
  `header_up X-Forwarded-For {remote_host}` overwrite makes the API's LAST-hop read safe, and a
  `trusted_proxies` line would re-open the rate-limit bypass.
- **A single-file bind mount pins the old inode (M6).** `docker-compose.yml` mounts `./docker/Caddyfile` as one
  file; replacing it (`curl -o`, `mv`) leaves the running Caddy on the old config, and `deploy` never recreates
  caddy. `toon-household-deploy sync-config` downloads the compose file AND the Caddyfile, validates both
  (`config -q`, `caddy validate` through compose), restores the `*.bak` copies on any failure and restarts the
  caddy container when the Caddyfile changed. `docker/toon-deploy.sh` is the forced command of ONE ssh key
  (`toon-household-deploy`; verbs `deploy [latest|sha256:<64 hex>]`, `sync-config`, `status`; `set -f`),
  distinct from the old `toon-deploy` and `toon-finance-deploy` keys.
  Pinned by `apps/api/test/deploy-script.test.ts`.
- **A freshly published GHCR package is private (M6).** `.github/workflows/release.yml` pushes on `main` and `v*`
  tags (typecheck and test first, `provenance: false`, SHA-pinned actions, `WITH_OCR=1 WITH_PDF=0`); the package
  stays private until the owner makes it public or the server runs `docker login`, and
  `.github/workflows/deploy.yml` runs only when the repository VARIABLE `DEPLOY_ENABLED` is `true` (a job-level
  `if` cannot read secrets). Both are verified by their YAML tests only until the first push to `main`.
  The YAML tests are `apps/api/test/deploy-workflows.test.ts`.
- **The local stack is the compose project `toon-household-local`, never the production name (M6, plan m6
  decision 5).** The compose file says `name: toon-household`, so without a project name of its own a local `up`
  would use `toon-household_toon-data` and a local `down -v` would delete the production data volume.
  `.env.local-stack` sets `COMPOSE_PROJECT_NAME=toon-household-local` (it beats the file's `name:`; `-p` beats
  both), every local command in `docs/deployment.md` also spells `-p toon-household-local`
  (`apps/api/test/deployment-doc.test.ts` pins every `down -v`), and the production `.env` never sets it. Only
  the cutover REHEARSAL uses `-p toon-household`, on a machine shown to have no `toon-household_*` volume; a
  volume made by `docker volume create` has no compose label, so `down -v` leaves it (remove it by name; compose
  only WARNS it "was not created by Docker Compose"). Check with
  `docker volume ls -q | grep -E '^toon-household(-local)?_'` (empty when nothing is left).
- **The first boot catches the fixed-cost plan up, so a migrated balance moves (M6).** `ApiModule.start` runs
  `plan:run` once at boot; an enabled plan whose periods since the old finance app last ran are unbooked gets
  `Fixkostenanteil MM/YYYY` rows (origin `fixed_plan`) at that boot. After a cutover the balance equals the
  report's plus those rows; without them it must match (the legacy fixtures: 119486 ct in the report, 222286 ct
  after the boot, two rows of 51400 ct).
  Pinned by `apps/api/test/finance-scheduler.test.ts`.

### Module gotchas (moved to the module docs)

Each quoted title is a gotcha of its module doc's section 4a, verbatim; read it there before touching the module.

`docs/modules/recipe.md`: "Recipe tables and indexes are prefixed, their TS identifiers are not."; "Fold columns
and the backfill." (`migrate:legacy` relies on the `afterMigrate` backfill); "Import route tests use real
sessions."; "Import query keys are rooted at `"toon"` (decision 14)."; "The library's recipe count is the
module's own query (ADR 0001, decision 13)."; "The shopping list outbox is wired through the manifest.";
"Remote images become local copies on write."; "Inherited recipe gotchas stay binding inside `modules/recipe`" (section 4b maps toon-recipe's 83); "Printing a
recipe (verified by printing to PDF, M4-T09)." (re-verify by print-to-PDF at 390 and 1440).

`docs/modules/finance.md`: "A seated participant cannot leave while the ledger has rows." (the finance side of
the core `removeMember` hook `onMemberRemoving`: `409 member_has_ledger`, the seat delete, the slot-1 re-seat,
ADR 0004); "Plan payer and income person must be participants (M4-T01, finding B)."; "Enabling finance needs
two participants (D3)."; "Finance TS identifiers carry a `finance` prefix; ported files import them aliased.";
"Participants and the gate (D3, plan m3 decisions 3-5)."; "The `start` hook and the clock.";
"`settingsSections` are rendered."; "Finance server catalog (ADR 0002)."; "The finance test harness gives
toon-finance's names H semantics (plan m3 decision 18)."; "The finance greps" (`LINKS_FIN`, `NOROUTER`, `NOCORE`,
`NOSHADOW`; run after every finance port); "`FinanceGate` renders `PendingSyncNote` as a Fragment sibling of the
outlet, never inside a wrapper `div`."; "Inherited finance gotchas stay binding inside `modules/finance`"
(section 4b maps F1 to F74); "The Erfassen sheet is module-local and has no FAB (plan m3b decisions 9 and 10, F
gotchas 62, 63, 65)."; "F gotcha numbers are F's numbering at `1715207`."

`docs/modules/calendar.md` (no source repository, so no section 4b): "The flyer's text layer holds several copies of every
grid."; "Hidden copies may be older drafts."; "A weekday item can carry the holiday name."; "pdf.js finishes on microtasks
alone."; "Route tests reach the flyer fetch through a seam."; "The server never decides today."; "`resource_id` is NO ACTION,
the refusal is the service's."; "A car booking can lose its person."; "The calendar must be enabled before its routes
answer."; "Imported waste entries are read-mostly"; "API sub-paths are built from segments on the web."; "Three module tabs
fill the phone bar."

### Retired gotchas

- **`file::memory:` is per client.** Retired by ADR 0009: `bun test` no longer forces `file::memory:`; under
  `NODE_ENV=test` `apps/api/src/env.ts` gives each process a fresh temp file DB, so every `Database.transaction` is a
  real transaction. What remains: a test going through `app.request` must use the shared `db`;
  `createDatabase({ url: "file::memory:" })` is a separate, empty database, and an `EXPLAIN` against the shared
  client goes through `apps/api/test/support/explain.ts`.
- **Two validation paths with different `details` (`zValidator` + `onValidationError`, `readJson` + `ZodError`).**
  Retired by E1 and ADR 0013: every route validates through `apps/api/src/lib/validate.ts` (`decode`,
  `decodeOrThrow`, `decodeOption`), a refusal is a `Schema.SchemaError`, `toApiError` renders it once with
  `toValidationIssues`, and `zod` and `@hono/zod-validator` are not dependencies (idioms rule (9)). What remains of the
  old gotcha: a form-facing 422 carries `i18n` and the catalog text on every route, and `readJson` in
  `apps/api/src/core/routes/auth.ts` still wants `Content-Type: application/json`.
- **Hono-era API rules (middleware factories as hoisted function declarations; one `await runtime.runPromise(...)` before
  `await next()`; mount order in `apps/api/src/index.ts`; `mountModules`; `requireHandler` / `optionalHandler`).** Retired by E7
  and ADR 0015: nothing is a Hono middleware any more. What remains of each: the leaves and the lazily built lists of the TDZ gotcha
  above, the chain order as `chain(...)` and `householdModuleApi` (the Middleware chain gotcha), the global order in
  `globalHttpLayer()`, and the rule that the first request builds the router, never an import (`apps/api/src/http/in-memory.ts`).
- **`routes/recipes.ts`, `routes/imports.ts` and the eight finance route files die when imported first (`docs/open-work.md` O-6).**
  Retired by E7-T13: the Hono routers that read the still-evaluating route bindings at module scope are gone; all 20 route files
  load first in a fresh process and serve a request (`apps/api/test/import-order-effect.test.ts`).
- **A missed shared-type alias compiles silently through the web's `request<T>` (finance gotcha "Finance TS identifiers carry a
  `finance` prefix", the web half).** Retired by E6: `request<T>` and its unvalidated cast are deleted; each endpoint names its
  response schema once (`getJson(url, Schema)` in `CoreApi` / `RecipeApi` / `FinanceApi`), the response is decoded with it, and the
  three `apps/api/test/web-contract-*.test.ts` fail on a wrong schema. What remains: the aliases themselves in finance's ported files.
- **Bridges until E8 (E2 to E5, ADR 0014).** Retired by E8 (plan e8 P1, P2, P4): the `/* legacy bridges */` sections of
  `apps/api/src` and `apps/api/scripts`, the finance `bridge.ts` and the legacy `ApiError` class of `lib/errors.ts` are gone
  (`requireUser`, `requireMembership` and `requireFinanceParticipantContext` went with Hono at E7). What remains: the 19 doors and
  their calling-convention rule ("Test-only doors live in `apps/api/test/support/bridges/`") and the seams ("The test seams stay
  in `src`").
- **The finance `nowMs()` survivor (plan e4 P12).** Retired by E8-T06: the synchronous `nowMs()` of
  `apps/api/src/modules/finance/lib/clock.ts`, kept for the test harness, was the one entry of idioms rule (11)'s `nowMs(` allow
  list. What remains: the door `apps/api/test/support/bridges/finance-clock.ts` for `apps/api/test/support/finance-harness.ts` and
  `apps/api/test/finance-clock.test.ts`; `src` reads `financeTimeMillis`, and rule (11)'s allow lists are empty.

## Open work

What is deliberately not done lives in `docs/open-work.md`: owner actions (A1 to A11, among them the cutover, the first
`release.yml` / `deploy.yml` runs and the E6 decode sweep over a production snapshot), owner decisions (D-1 to D-6: "Gruppe" vs
"Haushalt", the pinned design exceptions, finance print styles, a per-household PWA name or icon, `@effect/sql-libsql`,
`@effect/atom-react`), items deferred by design (X-1 to X-14: the N-person ledger, D3; the member-leaves veto beyond finance; the
declared HttpApi schemas, a typed `HttpApiClient`, the request log format; the calendar's per-occurrence edits, reminders, ICS feed,
offline writes, other waste providers, sharing outside the household and the next year's flyer) and recorded observations (O-1 to O-11). New open items
go there, not here.
