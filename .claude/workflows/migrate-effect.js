export const meta = {
  name: 'migrate-effect',
  description: 'Migrate toon-household onto Effect 4 milestone by milestone (docs/EFFECT.md): agents learn from the vendored Effect source, Opus plans and reviews, Sonnet implements and verifies, Haiku does mechanical rewrites and runs the gates',
  whenToUse: 'Run from ~/software/toon-household after reading docs/EFFECT.md. args: { milestones: ["E0"], maxFixRounds?: 2, maxParallel?: 3, hardenRounds?: 2 }. Milestones E0 foundation (vendors repos/effect), E1 shared-schema, E2 api-core-services, E3 recipe-services, E4 finance-services, E5 scripts, E6 web-client, E7 http-api, E8 harden (docs/EFFECT.md §4). Run one or two per invocation and read the result before the next; the loop stops at the first milestone whose exit criteria are not met. Resume with resumeFromRunId after fixing the cause.',
  phases: [
    { title: 'Learn', detail: 'Vendored Effect present (git subtree, E0 creates it); Sonnet distills a missing agent-patterns/effect-<topic>.md per topic the milestone needs, from repos/effect only', model: 'sonnet' },
    { title: 'Plan', detail: 'Opus high: milestone plan from docs/EFFECT.md, CLAUDE.md and repos/effect/LLMS.md; three adversarial critics (feasibility, behaviour-preservation, Effect v4 idioms); one revision; each task tagged with the model tier that fits it', model: 'opus' },
    { title: 'Implement', detail: 'Haiku for spelled-out mechanical rewrites and gate runs, Sonnet for implementation, Opus for the architecture tasks (runtime, Database, errors, HttpApi); dependency waves in parallel worktrees, merge, verify, fix loop', model: 'sonnet' },
    { title: 'Review', detail: 'Opus high: exit criteria, behaviour unchanged (API.md rows, German copy, test count), SPEC D1-D15 and EFFECT E1-E12 compliance, idioms; gates run by Haiku', model: 'opus' },
    { title: 'Harden', detail: 'Sonnet high: fix review findings, re-review, sync CLAUDE.md, the plan, the pattern files and ADRs', model: 'sonnet' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
const REPO = '/home/erics/software/toon-household'
const EFFECT_SPEC = `${REPO}/docs/EFFECT.md`
const VENDOR = `${REPO}/repos/effect`
const EFFECT_REPO_URL = 'https://github.com/Effect-TS/effect.git'
const EFFECT_VERSION = '4.0.5'
const EFFECT_TAG = `effect@${EFFECT_VERSION}`
const PATTERNS_DIR = `${REPO}/agent-patterns`
const DOCS = `${EFFECT_SPEC} (§1 fixed decisions E1-E12, §2 how an agent learns Effect here, §3 target architecture, §4 milestones, §5 gates, §6 out of scope), ${REPO}/docs/SPEC.md §1 (D1-D15, still in force) and §2 (the module contract), ${REPO}/CLAUDE.md (conventions and the gotchas in use; the module gotchas live in ${REPO}/docs/modules/recipe.md and ${REPO}/docs/modules/finance.md and stay binding), ${REPO}/docs/API.md (the frozen wire contract), and the vendored Effect source: ${VENDOR}/LLMS.md first, then the pattern files under ${PATTERNS_DIR}/, then ${VENDOR}/ai-docs/src/, ${VENDOR}/packages/effect/SCHEMA.md (in chunks), ${VENDOR}/packages/effect/HTTPAPI.md, ${VENDOR}/packages/effect/CONFIG.md, and ${VENDOR}/MIGRATION.md + ${VENDOR}/migration/*.md whenever an API you remember is v3`
const MAX_FIX = (args && Number.isInteger(args.maxFixRounds)) ? args.maxFixRounds : 2
const MAX_PARALLEL = (args && Number.isInteger(args.maxParallel)) ? Math.max(1, args.maxParallel) : 3
const HARDEN_ROUNDS = (args && Number.isInteger(args.hardenRounds)) ? Math.max(0, args.hardenRounds) : 2

// Model tiers. The planner tags every task with one; the orchestrator maps it to a model.
//   rewrite — Haiku: a mechanical rewrite whose every substitution the brief spells out (a Zod→Schema table
//             for one schema file, an import-path map, Date.now()→Clock in a named list of lines); no design
//   build   — Sonnet: implementation with tests (a service and its layer, a route on the runtime, a test rewrite)
//   core    — Opus: architecture-defining work (runtime.ts, Database, the error family, the HttpApi definition,
//             the module contract, the config service)
// Verification is Sonnet (it has to judge, not just run), gate runs are Haiku (run and report verbatim),
// learning/distillation is Sonnet, planning, critique and review are Opus, fix round 1 is Sonnet and the
// last fix round escalates to Opus.
const OPUS = { model: 'opus', effort: 'high' }
const SONNET = { model: 'sonnet', effort: 'high' }
const HAIKU = { model: 'haiku', effort: 'medium' }
const TIER_MODEL = { rewrite: HAIKU, build: SONNET, core: OPUS }
const modelFor = (task) => TIER_MODEL[task.tier] || SONNET

// Pattern topics (docs/EFFECT.md §2.2). Each milestone names the ones its tasks need; a missing file is distilled
// in the Learn phase from the vendored source before the planner starts.
const PATTERN_SOURCES = {
  'effect-core': `${VENDOR}/LLMS.md ("Writing Effect code"), ${VENDOR}/ai-docs/src/01_effect/, ${VENDOR}/packages/effect/src/Effect.ts (Effect.gen, Effect.fn, fnUntraced, map/flatMap/andThen, Result, Option, Exit, Cause), ${VENDOR}/migration/yieldable.md, ${VENDOR}/migration/cause.md`,
  'effect-schema': `${VENDOR}/LLMS.md ("Defining schemas"), ${VENDOR}/packages/effect/SCHEMA.md (chunks: Struct, Class, optional/optionalKey, Literals, Union, Array, Record, check/refine, decodeTo, decodeUnknownSync/Effect/Exit, issues and formatters, annotations, TaggedError), ${VENDOR}/migration/schema.md (the v3 rename table)`,
  'effect-services': `${VENDOR}/LLMS.md ("Writing Effect services", "Managing resources and Scopes", "Running Effect programs", "Integrating Effect into existing applications"), ${VENDOR}/ai-docs/src/04_integration/10_managed-runtime.ts, ${VENDOR}/migration/services.md, ${VENDOR}/migration/layer-memoization.md, ${VENDOR}/migration/scope.md, ${VENDOR}/packages/effect/src/Layer.ts, ${VENDOR}/packages/effect/src/ManagedRuntime.ts`,
  'effect-errors': `${VENDOR}/LLMS.md ("Error handling"), ${VENDOR}/migration/error-handling.md, ${VENDOR}/migration/cause.md, ${VENDOR}/packages/effect/src/Effect.ts (catch, catchTag, catchTags, catchReason, mapError, orDie, tapError, exit)`,
  'effect-testing': `${VENDOR}/LLMS.md ("Testing Effect programs"), ${VENDOR}/ai-docs/src/09_testing/, ${VENDOR}/packages/effect/src/testing/ (TestClock, TestConsole), and how to run an Effect under plain bun test (Effect.runPromise with a provided layer; no @effect/vitest)`,
  'effect-config': `${VENDOR}/packages/effect/CONFIG.md, ${VENDOR}/packages/effect/src/Config.ts, ${VENDOR}/packages/effect/src/ConfigProvider.ts (fromEnv, fromMap, orElse), Redacted`,
  'effect-datetime-clock': `${VENDOR}/LLMS.md ("Working with DateTime", "Working with Schedules"), ${VENDOR}/packages/effect/src/DateTime.ts, ${VENDOR}/packages/effect/src/Clock.ts, ${VENDOR}/packages/effect/src/Schedule.ts, ${VENDOR}/packages/effect/src/testing/TestClock.ts`,
  'effect-stream': `${VENDOR}/LLMS.md ("Working with Streams", "Working with child processes"), ${VENDOR}/ai-docs/src/03_stream/, ${VENDOR}/ai-docs/src/60_child-process/, ${VENDOR}/packages/platform/bun/src/BunChildProcessSpawner.ts, ${VENDOR}/packages/platform/bun/src/BunStream.ts, ${VENDOR}/packages/platform/bun/src/BunFileSystem.ts`,
  'effect-http-client': `${VENDOR}/LLMS.md ("Effect HttpClient"), ${VENDOR}/ai-docs/src/50_http-client/, ${VENDOR}/packages/effect/src/http/HttpClient.ts, HttpClientRequest.ts, HttpClientResponse.ts, FetchHttpClient.ts, Cookies.ts, Headers.ts, HttpClientError.ts`,
  'effect-http-api': `${VENDOR}/LLMS.md ("Building HttpApi servers"), ${VENDOR}/packages/effect/HTTPAPI.md, ${VENDOR}/ai-docs/src/51_http-server/, ${VENDOR}/packages/effect/src/http-api/ (HttpApi, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder, HttpApiMiddleware, HttpApiSchema, HttpApiError, HttpApiClient, HttpApiTest)`,
  'effect-http-server-bun': `${VENDOR}/packages/platform/bun/src/BunHttpServer.ts, BunHttpServerRequest.ts, BunHttpPlatform.ts, BunRuntime.ts, BunServices.ts, ${VENDOR}/packages/effect/src/http/ (HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse, HttpMiddleware, Cookies, Etag, HttpPlatform for static files, Multipart), with attention to middleware order, cookies with HttpOnly/SameSite, streaming file responses and graceful shutdown`,
  'effect-cli': `${VENDOR}/LLMS.md ("Building CLI applications"), ${VENDOR}/ai-docs/src/70_cli/, ${VENDOR}/packages/effect/src/cli/ (Command, Argument, Flag), exit codes and how to keep a script's output byte-identical`,
}

const MILESTONES = {
  E0: {
    name: 'foundation',
    patterns: ['effect-core', 'effect-schema', 'effect-services', 'effect-errors', 'effect-testing'],
    goal: `docs/EFFECT.md §4 E0: the vendored Effect source is present at ${VENDOR} (a squashed git subtree of ${EFFECT_REPO_URL} at tag ${EFFECT_TAG}; the Learn phase has already added it if it was missing, so this milestone VERIFIES it and records the commit), excluded from test discovery (a root bunfig.toml with [test] pathIgnorePatterns = ["repos/**"] — prove it: bun test must not list a single file under repos/), from the image (.dockerignore gains repos), from the editor (.vscode/settings.json: search.exclude, files.watcherExclude, typescript.preferences.autoImportFileExcludePatterns for repos/**) and from Vite's watcher (server.watch.ignored in apps/web/vite.config.ts); effect@${EFFECT_VERSION} in packages/shared, apps/api and apps/web and @effect/platform-bun@${EFFECT_VERSION} in apps/api, pinned exactly (no caret), bun install --frozen-lockfile green; CLAUDE.md gains a section "Vendored reference code" with §2's read order and rules (read-only, never imported, how to update) and "Building it" points at this workflow; the pattern files §2.2 names for E0 exist and are committed; apps/api/test/effect-idioms.test.ts in the shape of apps/web/src/styles/design-system.test.ts with the E12 rules that already hold (no import from repos/, no effect/unstable/, no @effect/platform" or @effect/schema or @effect/sql@0 or Context.Tag(, every @effect/* dependency at the same exact version as effect); apps/api/src/runtime.ts with an empty AppLayer (Layer.empty or a trivial service) and ONE ManagedRuntime, /api/health answered through runtime.runPromise with a test, SIGTERM/SIGINT disposing the runtime before exit (apps/api/src/index.ts) with a boot-and-shutdown check in the record; docs/adr/0012-effect-application-framework.md recording E1-E12 against SPEC D4, D7, D8, D9 and D10 and amending their wording where they name Zod or Hono in the same commit; docs/open-work.md gains "Owner decisions" entries for @effect/sql-libsql and @effect/atom-react; the docs-paths test still passes (every path named in CLAUDE.md exists, repos/ paths are outside its prefixes and need no exception).`,
    exit: 'gates green; bun test discovers nothing under repos/ (run bun test --only-failures or list the files and grep); docker build context excludes repos/ (check with a dry .dockerignore test or `docker build` to a log ending in exit=$?); the subtree commit is in git log; CLAUDE.md points at repos/effect/LLMS.md; the idioms test exists and passes; /api/health is served through the runtime and the shutdown path is exercised once in the record.',
  },
  E1: {
    name: 'shared-schema',
    patterns: ['effect-core', 'effect-schema', 'effect-errors', 'effect-testing'],
    goal: 'docs/EFFECT.md §4 E1 and E4: every Zod schema in packages/shared/src (core/schemas/{common,household,user,auth}.ts, modules/recipe/*, modules/finance/*, the i18n-adjacent parsers) rewritten as effect Schema with the SAME accepted and rejected inputs — the existing shared tests are the oracle and each schema file gets a table-driven parity test for every rule the old schema expressed (min/max, trim, regex, enum, optional vs nullable, defaults, refinements, transformations such as string→number for queries, the 50/200 pagination clamps, integer cents, YYYY-MM-DD and YYYY-MM texts); inferred types replaced by typeof X.Type / X.Encoded with the same exported names so apps/api and apps/web compile without renames; toValidationIssues takes the Schema issue (use the issue tree / formatter API named in repos/effect/packages/effect/SCHEMA.md) and returns the SAME details items for the existing fixtures (path, message, code), wording from the server catalog (server.validation.*, ADR 0002), never Effect\'s default message; apps/api gets lib/validate.ts (validate("json"|"query"|"param", schema) producing the same 400 validation_error envelope and the same onValidationError behaviour) and every zValidator call site is rewritten to it — a rewrite task per route file with the exact substitution table; apps/web/src/lib/validation.ts and every form validator on Schema with the same user-visible messages; env.ts stays on its own parsing until E2 (it may keep a local zod-free parser or move to Schema, planner\'s choice, behaviour identical); zod and @hono/zod-validator removed from every package.json and bun.lock; the idioms rule "no zod import" switched on.',
    exit: 'gates green; grep -r "from \\"zod\\"" apps packages scripts is empty and zod is absent from bun.lock; every API validation test and every shared test passes with unchanged assertions; i18n:check parity OK with the same 146 classified hits; the pass count is not below E0\'s record.',
  },
  E2: {
    name: 'api-core-services',
    patterns: ['effect-core', 'effect-services', 'effect-errors', 'effect-testing', 'effect-config', 'effect-datetime-clock', 'effect-stream'],
    goal: 'docs/EFFECT.md §4 E2 and E5-E7 for the core: AppConfig as a Context.Service built with Config from the environment with env.ts\'s exact rules (the root .env/.env.local loading order, NODE_ENV=test picking a fresh temp file DB and reading no .env, the production refusal of the change-me SESSION_SECRET, WEB_ORIGIN parsing, every default), with env.ts re-exporting the resolved values so untouched files keep compiling; Database as a scoped service and layer owning the @libsql/client client and the drizzle instance, sending the D7 pragmas on every local file connection and the busy timeout as createClient timeout (apps/api/test/db-pragmas.test.ts unchanged and green, pooled connection included), exposing use(fn) and transaction(effect) with withTransaction\'s degradation rule, closed by the runtime scope; the tagged error family in apps/api/src/lib/errors.ts (one Schema.TaggedError per static helper of ApiError, same status/code/text, plus a generic ApiFailure for the rest) and ONE boundary mapper used by Hono\'s onError (same envelope, same locale rendering, same English log line, same 500 internal_error for defects); Mailer (console/smtp/resend) as layers chosen by AppConfig, Uploads and thumbnails as a service, RateLimiter as a service with the same windows (10/h invites, 5/h households, the login limiter), Clock/DateTime wherever core services read time today; every module under core/services/{auth,households,mail,media}/ as a Context.Service with a static layer and Effect.fn("Service.method") methods declaring their typed failures; apps/api/src/runtime.ts composing AppLayer (config, database, mailer, uploads, rate limiter, each module\'s layer when present) and the ManagedRuntime; the core routes (auth, households, members, invites, modules) and the middlewares (session, household, module, verifiedEmail, originGuard, securityHeaders, locale, staticWeb) calling runtime.runPromise and keeping their order and semantics (CLAUDE.md "Middleware chain order is load-bearing"; the hoisted-function-declaration rule for requireHandler/optionalHandler stays, import-order.test.ts green); the ApiModule hooks typed as Effects with an adapter that still accepts the Promise-based recipe and finance manifests until E3/E4; apps/api/test/support/effect.ts (runTest, itEffect, the test AppLayer on the shared test DB, a recording Mailer, TestClock where a test fakes time); the core tests that call a service directly rewritten onto the service (same assertions, same file, same commit), through-the-app tests untouched; the idioms rules "no throw new ApiError", "no Date.now()/new Date() in apps/api/src/core/services" switched on with a pinned allow list.',
    exit: 'gates green; the pass count is not below E1\'s; db-pragmas, middleware, import-order, placeholders (the two-claim race), rate-limit and origin-guard tests pass unchanged; bun run dev:api boots in the background, /api/health answers, SIGTERM closes the database through the scope (the log shows it) and the process exits 0; a curl walkthrough of register → create household → invite → accept from docs/plans/m7-harden.md §9 gives the same statuses.',
  },
  E3: {
    name: 'recipe-services',
    patterns: ['effect-core', 'effect-services', 'effect-errors', 'effect-testing', 'effect-stream', 'effect-http-client', 'effect-datetime-clock'],
    goal: 'docs/EFFECT.md §4 E3: every file under apps/api/src/modules/recipe/services/ as a Context.Service with the module layer exported from the manifest (recipes, tags, collections, plan and cook log, shopping with the outbox merge rule and client-minted mutationId unchanged, cards, media and thumbnails, the import pipeline: URL fetch through an HttpClient layer wrapped by the SSRF guard so that every refusal apps/api/test pins (private hosts, redirects, IMPORT_ALLOW_PRIVATE_HOSTS) still holds, the schema-map and adapters as pure code, image localisation, OCR and PDF subprocesses as scoped resources or Streams with the worker terminated by shutdown, the capability flags from AppConfig); the hooks afterMigrate (the fold backfill the legacy migration relies on), seedDemo, uploadReferences, healthFeatures as Effects on the new contract; the recipe routes calling the runtime with every by-id lookup still scoped by membership.householdId (D8); recipe tests that call a service directly rewritten onto the service in the same file and commit; docs/modules/recipe.md section 4 gotchas honoured one by one (read them before planning) and its service names updated.',
    exit: 'gates green; the pass count is not below E2\'s; every recipe row of docs/API.md is still served (apps/api/test/api-doc.test.ts); the import route tests ("Import route tests use real sessions"), the ssrf tests and recipe-cross-household.test.ts pass unchanged; a URL import against a local fixture server and a shopping-list offline replay pass in the headless browser or in app.request tests.',
  },
  E4: {
    name: 'finance-services',
    patterns: ['effect-core', 'effect-services', 'effect-errors', 'effect-testing', 'effect-datetime-clock'],
    goal: 'docs/EFFECT.md §4 E4: every file under apps/api/src/modules/finance/services/ and lib/ as a Context.Service with the module layer: participants (the slot rules, 409 finance_participant_in_use, the slot-1 re-seat), transactions (integer cents, payer and split_mode, the four viewer-projected kinds), categories, tags, plan (the Fixkostenplan rounding and expectedBalanceCents unchanged; plan:run as an Effect; the boot catch-up and the 6-hour accrual tick on Schedule driven by Clock so "The start hook and the clock" gets a TestClock test that advances six hours), balance and balance_stale, settlements, the onMemberRemoving veto (409 member_has_ledger, ADR 0004), onEnable (two participants, D3; runs BEFORE the household_modules upsert as today), onHouseholdCreated (the 21 categories), seedDemo, uploadReferences; requireFinanceParticipant on the runtime keeping its hoisted-declaration rule and its module-local context variable; finance routes calling the runtime, every by-id lookup scoped by household (finance-cross-household.test.ts); finance tests that call a service directly rewritten onto the service; docs/modules/finance.md gotchas F1-F74 honoured (read section 4 before planning) and its service names updated; the finance greps LINKS_FIN/NOROUTER/NOCORE/NOSHADOW of docs/modules/finance.md §5.1 run and clean.',
    exit: 'gates green; the pass count is not below E3\'s; halfForOther(-101) = -50, the single-rounding plan share, the second retroactive correction, isPeriodBooked, balance_stale, member_has_ledger and finance-cross-household pass unchanged; the fixed-cost boot catch-up still books the two fixture rows of 51400 ct (CLAUDE.md "The first boot catches the fixed-cost plan up"); the finance greps are clean.',
  },
  E5: {
    name: 'scripts',
    patterns: ['effect-core', 'effect-services', 'effect-errors', 'effect-cli', 'effect-config', 'effect-stream'],
    goal: 'docs/EFFECT.md §4 E5 and E10: apps/api/scripts/{migrate,seed,reset-password,uploads-gc,plan-run,localize-images,finance-import-xlsx,migrate-legacy}.ts as Effect programs run with BunRuntime.runMain on AppLayer (or on an explicit layer where the script must not import env.ts); apps/api/scripts/legacy/* and apps/api/scripts/finance-import/* as services on explicit layers taking the target db and client as today; migrate-legacy.ts keeps its static-import discipline byte for byte in spirit (only node: builtins and types statically, DATABASE_URL redirected to the scratch copy BEFORE the first dynamic import, then db/client, then db/migrate, then ./legacy/*; apps/api/test/legacy-cli.test.ts guards it textually and by subprocess and must pass unchanged, so the text guard is updated only where the file names changed and the planner records why); every flag, exit code (0 success, 1 errors, 2 usage) and every output line a doc or test pins stays identical (docs/migration.md, CLAUDE.md "Commands", the "[migrate:legacy] already migrated: nothing written." line, seed\'s production refusal, uploads-gc\'s 24 h grace and --dry-run, plan-run\'s per-household report); effect/cli may replace hand-written argv parsing where the output stays identical; the root scripts/{dev,typecheck,i18n-check,icons}.ts stay plain Bun.',
    exit: 'gates green; the pass count is not below E4\'s; the fixture run of migrate:legacy from CLAUDE.md "Commands" (dry run, --apply, --apply again) prints the same report and the same three exit codes, the dry run writes no target file and no -wal, the second --apply writes nothing; legacy-cli, legacy-placeholders (which cleans the shared DB) and legacy-fixtures pass unchanged; seed refuses production without ALLOW_SEED and a 10+ character SEED_PASSWORD.',
  },
  E6: {
    name: 'web-client',
    patterns: ['effect-core', 'effect-schema', 'effect-services', 'effect-errors', 'effect-http-client', 'effect-testing'],
    goal: 'docs/EFFECT.md §4 E6 and E11: apps/web/src/lib/runtime.ts with ONE ManagedRuntime over a WebLayer (FetchHttpClient configured with the base URL rules of apps/web/src/lib/api.ts, credentials include, the JSON content type, the 401 → unauthorized-handler hook, the upload size cap); apps/web/src/lib/api.ts and apps/web/src/modules/{recipe,finance}/api.ts (and any lib/api-*.ts) as effects that describe each request once and decode the response with the shared Schema, failing with the same ApiError (status, code, message, details) now a tagged error; the queries.ts files switched to runtime.runPromise with their query keys, persist policy, mutationDefaults, offline outbox and PERSIST_BUSTER untouched (D9; the shopping and finance outbox tests, persist.test.ts, query-client.test.ts and session-purge.test.ts unchanged and green); the 401 purge of the persisted cache wired through the runtime; apps/web/src/lib/api.test.ts extended with a decode-failure case and a 401 case; nothing else in the web app imports effect unless the plan records why; the gzipped bundle size recorded before and after in the plan (vite build output), imports from "effect" and "effect/http" only; the LINKS greps of both module docs run after the port; the three web tsconfig projects typecheck.',
    exit: 'gates green; the pass count is not below E5\'s; the headless checks of CLAUDE.md (login via fetch, a shopping-list offline check-off replay after reload, a finance capture replay after a reload while offline, scrollWidth <= clientWidth at 390 and 1440 on Home and one screen per module) pass against the built app served by WEB_DIST_DIR; gzipped bundle growth recorded and under 60 kB (else an ADR explains it); the CSP connect-src check at a second origin (127.0.0.1:3001) shows no console error.',
  },
  E7: {
    name: 'http-api',
    patterns: ['effect-core', 'effect-services', 'effect-errors', 'effect-http-api', 'effect-http-server-bun', 'effect-testing', 'effect-stream'],
    goal: 'docs/EFFECT.md §4 E7 and E8: the HttpApi definition built from docs/API.md section by section (core groups auth/households/members/invites/modules/health/uploads; one HttpApiGroup per module router contributed through the manifest, which now carries the groups plus their handler layer instead of a Hono router — SPEC §2, apps/api/src/modules/types.ts, docs/modules/*.md updated in the same commit); HttpApiMiddleware for session, household role, module, verified e-mail, locale, origin guard, security headers (the CSP hashes of the built index.html at boot), cors, with the pinned order (no cookie 401 first, non-member 403 before the module row is read, disabled module 404 module_disabled; invite-token routes before /:householdId; static web LAST; /api and /uploads never under the SPA fallback); BunHttpServer serving on the same port and host with the same signed /uploads (404 for unsigned/forged/expired, thumbnails on first request), the same Set-Cookie attributes, the same CORS headers, Location and Content-Disposition where docs/API.md says; ApiModule.start/shutdown on the runtime scope; every app.request-based test moved to the in-memory HttpApi handler (HttpApiTest or HttpApiBuilder\'s handler) keeping its assertions; apps/api/test/api-doc.test.ts enumerating METHOD path from the HttpApi definition (every served route has a row and every row is served, every ERROR_CODES value named); apps/api/test/middleware.test.ts and import-order.test.ts adapted to the new entry point without losing a case; hono and hono-related packages removed from package.json and bun.lock; a table-driven contract test over the walkthrough of docs/plans/m7-harden.md §9 asserting status and the named headers per row; the Dockerfile, compose, Caddyfile unchanged unless the record names why (the API port, the health path and the X-Forwarded-For LAST-entry rule stay); docs/API.md "Middleware chain and mount order" rewritten to the HttpApi terms with the rows untouched; OpenAPI may be generated into the plan record, /docs is NOT mounted.',
    exit: 'gates green; the pass count is not below E6\'s; every docs/API.md row served with the same status and headers (the contract test); the local stack test of docs/deployment.md passes with a freshly built image (build log ending in exit=0, /api/health healthy through the Caddy, the old-hostname redirects untouched); the CSP hashes still match the built index.html at a second origin; grep -r "from \\"hono" apps is empty.',
  },
  E8: {
    name: 'harden',
    patterns: ['effect-core', 'effect-services', 'effect-errors', 'effect-testing'],
    goal: 'docs/EFFECT.md §4 E8: every open review finding of E0-E7 closed; CLAUDE.md rewritten as built (read order with docs/EFFECT.md, layout with runtime.ts/config.ts and the services, commands, conventions with the Effect idioms, the gotchas that proved real during the migration — each with the file that pins it — and a "Retired gotchas" entry per gotcha Effect made obsolete, e.g. the hoisted-handler rule if layers removed the cycle); docs/API.md conventions updated where the implementation notes changed (never a row); docs/modules/recipe.md and finance.md with the service names and the layer; the pattern files under agent-patterns/ refreshed against what the code actually does, each with one example from this repo; docs/open-work.md; docs/EFFECT.md §3 made to match the tree; the idioms test with every E12 rule on and its allow list minimal; the final gate logs, the walkthrough and the boot-and-shutdown proof in docs/plans/e8-harden.md.',
    exit: 'gates green on the final tree; the pass count is not below E7\'s; CLAUDE.md names no file that does not exist (docs-paths.test.ts) and names docs/EFFECT.md, repos/effect/LLMS.md and agent-patterns/; the idioms test has every E12 rule on; docs/plans/e8-harden.md holds the gate logs and the walkthrough.',
  },
}

const requested = (args && Array.isArray(args.milestones) && args.milestones.length) ? args.milestones : ['E0']
const todo = requested.filter(n => MILESTONES[n] != null)
if (!todo.length) throw new Error('args.milestones must contain E0..E8')
log(`toon-household Effect migration: milestones ${todo.join(', ')}; max parallel ${MAX_PARALLEL}, fix rounds ${MAX_FIX}, harden rounds ${HARDEN_ROUNDS}`)

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const TASK = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    goal: { type: 'string' },
    tier: { type: 'string', enum: ['rewrite', 'build', 'core'], description: 'rewrite = mechanical substitution with a spelled-out table (Haiku); build = implementation with tests (Sonnet); core = architecture-defining (Opus)' },
    brief: { type: 'string', description: 'everything the implementer must read, by path and section: EFFECT.md decisions, the pattern files, the vendored docs and examples, the repo files to change, the CLAUDE.md or module-doc gotchas that apply, the exact substitution table for a rewrite task' },
    files: { type: 'array', items: { type: 'string' }, description: 'files this task owns; two tasks of one wave never share one' },
    deps: { type: 'array', items: { type: 'string' }, description: 'ids of tasks that must be merged before this one starts' },
    acceptance: { type: 'array', items: { type: 'string' } },
    verify: { type: 'array', items: { type: 'string' }, description: 'shell commands that must exit 0' },
  },
  required: ['id', 'title', 'goal', 'tier', 'brief', 'files', 'deps', 'acceptance', 'verify'],
}
const PLAN_SCHEMA = {
  type: 'object',
  properties: { plan_path: { type: 'string' }, summary: { type: 'string' }, baseline_tests: { type: 'integer', description: 'the pass count of bun test measured at plan time' }, tasks: { type: 'array', items: TASK } },
  required: ['plan_path', 'summary', 'baseline_tests', 'tasks'],
}
const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] }, text: { type: 'string' } }, required: ['severity', 'text'] } },
  },
  required: ['approved', 'issues'],
}
const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    summary: { type: 'string' },
    commit: { type: 'string', description: 'short hash of the last commit, or empty' },
    branch: { type: 'string', description: 'the branch the commits are on: "main" or the task branch' },
    deviations: { type: 'array', items: { type: 'string' }, description: 'where the implementation departs from EFFECT.md E1-E12, SPEC D1-D15 or a module-doc decision, and why' },
    notes: { type: 'string' },
  },
  required: ['status', 'summary', 'commit', 'branch', 'deviations'],
}
const LANDED_SCHEMA = {
  type: 'object',
  properties: { landed: { type: 'boolean' }, commit: { type: 'string' }, evidence: { type: 'string' } },
  required: ['landed', 'commit', 'evidence'],
}
const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['merged', 'failed'] },
    summary: { type: 'string' },
    merged: { type: 'array', items: { type: 'string' } },
    failed: { type: 'array', items: { type: 'string' } },
    head: { type: 'string' },
  },
  required: ['status', 'summary', 'merged', 'failed', 'head'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    commands_run: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
  },
  required: ['pass', 'commands_run', 'failures'],
}
const GATES_SCHEMA = {
  type: 'object',
  properties: {
    results: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, exit_code: { type: 'integer' }, tail: { type: 'string', description: 'the last 40 lines of output, verbatim; on a non-zero exit preceded by every (fail) line and Unhandled error block of the log' } }, required: ['command', 'exit_code', 'tail'] } },
    tests_passed: { type: 'integer', description: 'the "N pass" number bun test printed, or -1' },
    git_status: { type: 'string' },
  },
  required: ['results', 'tests_passed', 'git_status'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    exit_met: { type: 'boolean' },
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] }, title: { type: 'string' }, detail: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['severity', 'title', 'detail'] } },
  },
  required: ['exit_met', 'summary', 'findings'],
}
const VENDOR_SCHEMA = {
  type: 'object',
  properties: {
    present: { type: 'boolean', description: 'repos/effect/LLMS.md exists on main after this step' },
    ref: { type: 'string', description: 'the tag or branch vendored' },
    commit: { type: 'string', description: 'the subtree commit, or empty when nothing was added' },
    notes: { type: 'string' },
  },
  required: ['present', 'ref', 'commit', 'notes'],
}
const PATTERN_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    status: { type: 'string', enum: ['written', 'existing', 'blocked'] },
    commit: { type: 'string' },
    sources_read: { type: 'array', items: { type: 'string' } },
  },
  required: ['path', 'status', 'commit', 'sources_read'],
}

// ---------------------------------------------------------------------------
// Helpers (plain code, no agents)
// ---------------------------------------------------------------------------
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const branchOf = (n, task) => `wf/${slug(n)}-${slug(task.id)}`
const wtOf = (task) => `${REPO}/.worktrees/${slug(task.id)}`
function incompleteTasks(results) {
  return results.filter(r => !r.impl || r.impl.status === 'blocked').map(r => r.task.id)
}
function landedImpl(impl, check) {
  if (!impl || impl.status !== 'blocked' || !check || check.landed !== true) return null
  const commit = String(check.commit || '').trim()
  if (!/^[0-9a-f]{7,40}$/.test(commit) || !String(check.evidence || '').trim()) return null
  return { ...impl, status: 'done', commit, branch: 'main', onMain: true, notes: `already on main (${commit}): ${check.evidence}` }
}
const needsMerge = (impl) => !impl.onMain && !!impl.branch && impl.branch !== 'main'

// ---------------------------------------------------------------------------
// Shared rules for every agent
// ---------------------------------------------------------------------------
const RULES = `
Project: toon-household, repository root ${REPO}. Read first: ${DOCS}.
This is a MIGRATION ONTO EFFECT 4 that changes how the code is written, not what it does (docs/EFFECT.md). Rules:
- Work only inside ${REPO}. Never edit ~/.claude, other repos, or the user's shell config.
- ${VENDOR} is the vendored Effect source (a git subtree): READ-ONLY reference. Never edit a file in it, never run bun install, bun test or tsc inside it, never import from repos/ in application code. It is the documentation: before writing Effect code read ${VENDOR}/LLMS.md and the pattern file(s) for the modules you touch under ${PATTERNS_DIR}/; look up every signature in the vendored source (${VENDOR}/packages/effect/src/…), never from memory and never from the web. Your memory of Effect is v3; v4 renamed APIs (Context.Tag→Context.Service with a static layer and no accessors, Effect.catchAll→Effect.catch, Either→Result, Schema.Union([A,B]) and Schema.Literals([...]) take arrays, annotations→annotate, filter→check/refine, decodeUnknown→decodeUnknownEffect, @effect/platform/*→effect/*, effect/unstable/http→effect/http; the full map is ${VENDOR}/migration/v3-to-v4.md). Effect packages: effect@${EFFECT_VERSION} and @effect/platform-bun@${EFFECT_VERSION} only, pinned exactly; no @effect/platform, @effect/schema, @effect/sql@0.x, @effect/vitest, no effect/unstable/* path.
- docs/SPEC.md §1 decisions D1-D15 and docs/EFFECT.md §1 decisions E1-E12 are fixed. The module docs' decisions and gotchas (docs/modules/recipe.md, docs/modules/finance.md) are binding inside their module. If you must deviate, make the minimal deviation and report it in \`deviations\`; never re-litigate.
- Behaviour is frozen: every docs/API.md row (status, body, headers), every German string byte-identical, every DB table and migration, every exit code and output line a doc or test pins, every observable assertion of the existing tests. A test file you rewrite onto a service keeps its assertions and is replaced in the same commit; the bun test pass count never drops below the previous record. Pure functions stay pure (money math, parsers, formatters, the i18n runtime); Effect wraps what is fallible, asynchronous, resourceful or needs a dependency.
- Idioms (docs/EFFECT.md E12, from LLMS.md): Effect.gen inline; Effect.fn("Service.method") for reusable functions, Effect.fnUntraced on hot paths; no function that only wraps an Effect.gen; combinators as extra arguments of Effect.fn, never .pipe on it; return yield* when raising; Schema.TaggedError for errors; Context.Service + static layer for services; Predicate instead of hand-written guards; Schema instead of manual parsing; DateTime/Clock instead of Date in services; Effect.catchTag(s) instead of instanceof. apps/api/test/effect-idioms.test.ts pins what grep can see: never relax a rule to get green.
- Money is integer cents everywhere. Timestamps are integer unix ms in SQLite and ISO on the wire; planned_on and periods are text. Tables are prefixed per module (recipe_, finance_); core tables are not. Module routes mount under /api/households/:householdId/<module>/ and user-scoped ones under /api/<module>/. Query keys start ["toon","household",id,"<module>"].
- Never ask questions; make the sensible choice and record it.
- Do not push. Commit per task with a message whose body names the EFFECT.md decision or the file served, ending with "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>". \`git -C ${REPO} status --porcelain repos/\` must be empty after every task.
- Verification means running commands and reading their output. Report failures verbatim. bun run i18n:check exits non-zero by design: read its output and classify every hit (146 known false positives).
- Tests live in apps/api/test (never tests/), apps/web co-located *.test.ts(x) under tsconfig.test.json, packages/shared/test; bun test only, no vitest.
- Long commands (bun install on a cold cache, docker build, a headless-browser run, git subtree) go to the background writing one log that ends with "exit=$?", then poll the log; a log without exit= means not finished.
`

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
const vendorPrompt = () => `${RULES}
Learn phase, step 1: make sure the vendored Effect source exists at ${VENDOR} on branch main of ${REPO} (docs/EFFECT.md E2, the "one weird git trick": a squashed git subtree, not a submodule, not a clone).
1. If ${VENDOR}/LLMS.md exists: report present=true, read the ref from the last subtree commit (\`git -C ${REPO} log --oneline -3 -- repos/effect\`), change nothing.
2. Otherwise the tree must be clean (\`git -C ${REPO} status --porcelain\` empty; if not, report blocked in notes and change nothing). Run in the background with a log ending in exit=$?: \`cd ${REPO} && git subtree add --prefix=repos/effect ${EFFECT_REPO_URL} ${EFFECT_TAG} --squash\`. If that fails because the tag is unknown, retry with \`main\` and say so in notes. Then verify ${VENDOR}/LLMS.md, ${VENDOR}/ai-docs/src/index.md and ${VENDOR}/packages/effect/SCHEMA.md exist and report the subtree commit (\`git -C ${REPO} log --oneline -1\`).
Do nothing else: no bunfig, no .dockerignore, no package.json (E0's tasks own those). Never run bun install, bun test or tsc inside ${VENDOR}.`

const patternPrompt = (topic) => `${RULES}
Learn phase, step 2: write the project-local pattern file ${PATTERNS_DIR}/${topic}.md (docs/EFFECT.md §2.2) if it does not exist (if it exists, report status "existing" and change nothing).
Read ONLY the vendored source: ${PATTERN_SOURCES[topic]}. Read ${VENDOR}/LLMS.md once first. Never the web, never your memory of Effect v3.
The file is a distillation for an implementer working in THIS repo (Bun 1.4, bun test, Hono until E7, drizzle + @libsql/client, TanStack Query on the web): 120-250 lines, Markdown, sections in this order: (1) What the module is for and the exact import lines (package and path, v4); (2) Constructors and the 2-4 call shapes this repo will use, each as a short verbatim-correct code block copied or minimally adapted from the vendored docs/examples (cite the source path after each block); (3) Composing / encoding and decoding / providing, as applicable; (4) Error handling (typed failures vs defects, catchTag/catchTags, what reaches the boundary); (5) v3 → v4 renames that bite for this module (from ${VENDOR}/migration/*.md), as a two-column list; (6) Pitfalls from LLMS.md and the source comments; (7) "In this repo": where it will be applied (file paths) and one rule from docs/EFFECT.md E1-E12 it serves. Every API name in the file must exist in ${VENDOR}/packages/effect/src or ${VENDOR}/packages/platform/bun/src: check each with grep before writing it. Commit the one file on main in ${REPO} (message "learn: ${topic} pattern file from the vendored Effect source"). Report the sources you actually read.`

const planPrompt = (n, m) => `${RULES}
You are the planner for milestone ${n} "${m.name}" of the Effect migration.
Goal: ${m.goal}
Exit criteria: ${m.exit}
Pattern files to read for this milestone: ${m.patterns.map(p => `${PATTERNS_DIR}/${p}.md`).join(', ')}.
Inspect the current repository state (git log, tree, the gates — run \`bun test\` once and record the pass count as baseline_tests) and the parts of the tree the milestone names, so the plan builds on what exists and names real files. Where the milestone touches a module, read that module doc's section 4 gotchas first.
Write ${REPO}/docs/plans/${slug(n)}-${m.name}.md: context (state of the tree, the baseline pass count, the bundle size where E6/E7 ask for it), the decisions this plan takes (binding for the tasks; each names the EFFECT.md decision it serves), the ordered task list, per-task brief, tier, files, deps, acceptance checks and verify commands, risks, deviations expected, and what is explicitly out of this milestone.
Tasks: 6-12 of them, 45-120 minutes of focused work each, each leaving the build green on its own branch. Tag every task with a tier: "rewrite" for a mechanical substitution whose every rule you spell out in the brief as a table (old construct → new construct, old import → new import, old name → new name, file by file; a Haiku agent executes it and must not have to design anything, and it must not touch a line the table does not name), "build" for implementation with tests (Sonnet), "core" for architecture-defining work (Opus): runtime.ts, the Database service, the error family, AppConfig, the HttpApi definition, the module contract. Prefer many rewrite tasks over few: a rewrite task should touch at most ~15 files. Every task's brief lists by path and section what to read: the EFFECT.md decisions, the pattern files, the vendored docs and examples (${VENDOR}/…), the repo files, the CLAUDE.md and module-doc gotchas that apply. Lay the tasks out in dependency waves: tasks with no unmet deps run IN PARALLEL in separate git worktrees and are merged in id order, so two tasks of one wave must not edit the same files (say which files each owns in \`files\`); shared files (package.json and bun.lock, apps/api/src/runtime.ts, modules/index.ts, db/schema.ts, lib/errors.ts, the test support files, CLAUDE.md) are edited by the earliest task that needs them or by a dedicated integration task that depends on the wave. Each task's \`verify\` lists shell commands that must exit 0 (e.g. "cd ${REPO} && bun run typecheck", "cd ${REPO} && bun test apps/api/test/households", "cd ${REPO} && bun test apps/api/test/effect-idioms.test.ts", "cd ${REPO} && git status --porcelain repos/ | wc -l | grep -qx 0"); a headless-browser, docker or boot-and-shutdown check belongs only in the final integration task of the milestone, which depends on every other task and compares the pass count with baseline_tests.
Return the plan as structured output.`

const critiquePrompt = (n, m, plan, lens) => `${RULES}
You are an adversarial reviewer of a milestone plan. Lens: ${lens}.
Milestone ${n} "${m.name}". Goal: ${m.goal}. Exit criteria: ${m.exit}.
Plan file: ${plan.plan_path}. Tasks (JSON): ${JSON.stringify(plan.tasks)}
Try hard to find what would make this plan fail. Approve only if there are no high-severity issues.`

const LENSES = {
  feasibility: 'feasibility: two tasks of one wave editing the same files, a rewrite task whose table leaves a substitution unspecified (a Haiku agent will guess), a core task mis-tagged as rewrite or build, a dep missing so a task starts before its foundation exists (a service before the Database layer, a route before the runtime), tasks too large for one commit, unverifiable acceptance checks, ordering that leaves the build red, a verify command that cannot run (missing script, wrong path)',
  behaviour: 'behaviour preservation: a docs/API.md row whose status, body or header could change; a German string retyped; a DB table, column or migration touched; an exit code or pinned output line changed; a test rewritten with weaker assertions or deleted without its replacement in the same commit; a CLAUDE.md or module-doc gotcha the task will trip over (middleware order, the hoisted-handler import cycle, the migrate-legacy import order, the pragmas, the claim race, the offline outbox); pure code needlessly wrapped in Effect; the pass count able to drop; SPEC D1-D15 or EFFECT E1-E12 violated',
  idioms: `Effect v4 idioms and API truth: every API name, import path and call shape in the briefs must exist in ${VENDOR} (grep ${VENDOR}/packages/effect/src and ${VENDOR}/packages/platform/bun/src; your own memory is v3 and is wrong on renames); services as Context.Service with static layers, errors as Schema.TaggedError, Effect.fn named, no .pipe on Effect.fn, no function that only wraps Effect.gen, Schema not manual parsing, DateTime/Clock not Date, catchTag not instanceof, layers memoised through one memo map and one ManagedRuntime per process, scopes closed on shutdown, no effect/unstable path, no v3 package; a brief that teaches a v3 construct is a high-severity issue`,
}

const revisePrompt = (n, m, plan, issues) => `${RULES}
Revise the plan for milestone ${n} "${m.name}" at ${plan.plan_path} to address these review issues (JSON): ${JSON.stringify(issues)}.
Keep what was right. Rewrite the plan file in place and return the full revised task list as structured output (keep baseline_tests).`

const implPrompt = (n, m, plan, task, i, total, isolated) => `${RULES}
Implement task ${task.id} (${i + 1}/${total}, tier ${task.tier}) of milestone ${n} "${m.name}": ${task.title}
Goal: ${task.goal}
Brief (read exactly this, by path and section, before writing anything): ${task.brief}
Pattern files for this milestone: ${m.patterns.map(p => `${PATTERNS_DIR}/${p}.md`).join(', ')} (read the ones your brief names; look every signature up in ${VENDOR}/packages/effect/src before using it).
Files this task owns: ${(task.files || []).join(', ') || 'see plan'}
Acceptance: ${task.acceptance.join(' | ')}
Plan file for context: ${plan.plan_path}
${task.tier === 'rewrite' ? 'This is a REWRITE task: apply exactly the substitution table in the brief to exactly the files it names. Do not redesign, rename, reformat or "improve" anything else; a German string stays byte-identical; a comment stays unless the table rewrites it; a test keeps its assertions. If the table is ambiguous for a line, pick the reading that changes the fewest characters and record it in `notes`.' : ''}
${isolated ? `You work in YOUR OWN GIT WORKTREE on your own branch, which you create yourself as the very first step: \`git -C ${REPO} worktree add -b ${branchOf(n, task)} ${wtOf(task)} main\` (if the directory or branch already exists from an interrupted run, remove the directory with \`git -C ${REPO} worktree remove --force ${wtOf(task)}\` and the branch with \`git -C ${REPO} branch -D ${branchOf(n, task)}\`, then create them again). From then on every shell command starts with \`cd ${wtOf(task)} &&\` (your shell's working directory is NOT the worktree; never run bun or git in ${REPO} itself, and never \`git checkout\` or \`git switch\` there). Run \`bun install\` once in the worktree (Bun's isolated linker gives each checkout its own node_modules; ${REPO}/.worktrees is gitignored; the worktree carries its own repos/effect copy, read it there). Other tasks run at the same time on other branches, so touch only the files this task owns; the orchestrator merges the branches in task order afterwards and removes the worktree. Commit on your branch and report "${branchOf(n, task)}" in \`branch\`; leave the worktree in place.` : `You work on the main checkout in ${REPO} (branch main); report "main" in \`branch\`.`}
Steps: read the brief and the pattern files; implement with tests; run the task's verify commands (${task.verify.join(' && ')}) and fix until they pass; confirm \`git status --porcelain repos/\` is empty; commit. If something outside your control blocks the task (missing system dependency, an Effect API the vendored source does not have), return status "blocked" with the exact error text and leave the tree clean.`

const landedPrompt = (n, task, impl) => `${RULES}
Task ${task.id} "${task.title}" of milestone ${n} reported blocked: ${impl.notes || impl.summary}.
Decide whether its work is nevertheless already in the history of main of ${REPO} (an earlier run or a resumed run committed it). Read only: \`git -C ${REPO} log main --oneline --grep "${task.id}"\`, \`git -C ${REPO} log main --oneline -- ${(task.files || []).join(' ') || '.'}\`, \`git -C ${REPO} show --stat <commit>\`, and confirm with \`git -C ${REPO} merge-base --is-ancestor <commit> main\` (exit 0). The commit must carry what the task's goal and acceptance say: ${task.goal} | ${task.acceptance.join(' | ')}. If the block was an environment failure or the work is only partly there, answer landed=false. Change nothing.`

const mergePrompt = (n, wave) => `${RULES}
Integrate a wave of milestone ${n}: the following tasks were implemented in parallel on separate branches of ${REPO} and must land on main in this order: ${JSON.stringify(wave.map(w => ({ id: w.task.id, title: w.task.title, branch: w.impl.branch, commit: w.impl.commit, files: w.task.files || [] })))}.
In ${REPO} (branch main, clean tree): for each task in order run \`git merge --no-ff --no-edit <branch>\`. On a conflict, resolve it by keeping both tasks' intent (read both sides and the tasks' plan sections), then \`git add\` and \`git commit --no-edit\`. After each merge run that task's verify commands and \`bun run typecheck\`; if the merged result fails because the tasks interact (not because one task was wrong on its own), make the minimal integration fix as its own commit. After the last merge: remove each merged task's worktree (\`git worktree remove --force <dir>\`; the directories are ${JSON.stringify(wave.map(w => wtOf(w.task)))}), \`git worktree prune\`, and delete the merged branches (\`git branch -d\`). A branch that is already an ancestor of main counts as merged. An unmerged branch keeps its worktree and is reported in \`failed\` with the conflict summary. Report the final \`head\`.`

const verifyPrompt = (n, task, impl) => `${RULES}
Independently verify task ${task.id} "${task.title}" (tier ${task.tier}) of milestone ${n} on the main checkout ${REPO}. The implementer reported: ${impl.summary} (commit ${impl.commit || 'none'}).
Run every verify command: ${task.verify.join(' ; ')}. Then check each acceptance item by reading code or running something: ${task.acceptance.join(' | ')}.
Then the migration checks: (a) every Effect API the commit uses exists in ${VENDOR}/packages/effect/src or ${VENDOR}/packages/platform/bun/src with that signature (grep the names; a v3 construct that happens to typecheck through a compatibility export is a failure); (b) the idioms of docs/EFFECT.md E12 in the changed files (no Effect.gen-only wrapper functions, no .pipe on Effect.fn, return yield* on errors, services as Context.Service with a static layer, no Date.now() in a service, no instanceof on errors); (c) behaviour: for a route or service, the docs/API.md row's status and envelope unchanged, German strings unchanged (git diff of the catalogs is empty), a rewritten test keeps its assertions (diff it against its previous version); (d) \`git -C ${REPO} status --porcelain\` clean and \`git -C ${REPO} status --porcelain repos/\` empty.
${task.tier === 'rewrite' ? 'For a rewrite task also diff the changed files against their previous version and confirm that only the substitutions the table lists differ; any other change is a failure.' : ''}
Do not fix anything; only report. pass=true only if every command exits 0 and every acceptance item and migration check is demonstrably met.`

const fixPrompt = (n, task, verify, round) => `${RULES}
Fix round ${round} for task ${task.id} "${task.title}" of milestone ${n} on main in ${REPO}. Verification failed with: ${JSON.stringify(verify.failures)} (commands run: ${verify.commands_run.join(' ; ')}).
Fix the root cause (look the API up in ${VENDOR} when the failure is an Effect signature), re-run the verify commands (${task.verify.join(' && ')}) until green, commit the fix.`

const gatesPrompt = (n) => `${RULES}
Run the verification gates of milestone ${n} on ${REPO} and report verbatim; change nothing, fix nothing, judge nothing.
Commands, each from ${REPO}, each captured to a log in the background when it may run long: \`bun install --frozen-lockfile\`, \`bun run typecheck\`, \`bun test\` (record the "N pass" number as tests_passed and confirm no file path under repos/ appears in its output), \`bun run build\`, \`bun run i18n:check\`, \`bun test apps/api/test/effect-idioms.test.ts\` (exit_code -1 with tail "missing" if the file does not exist yet), \`git status --porcelain repos/\` (must print nothing). Then \`git status --porcelain\` and \`git log --oneline -15\`.
Return every command with its exit code and the last 40 lines of its output. When a command exits non-zero, also put every \`(fail) \` line and every \`Unhandled error\` block of its log into that command's tail verbatim, ahead of the last 40 lines (the review needs the failing test names, not only the summary).`

const reviewPrompt = (n, m, plan, results, gates) => `${RULES}
You are the milestone reviewer for milestone ${n} "${m.name}" of the Effect migration.
Goal: ${m.goal}
Exit criteria: ${m.exit}
Baseline pass count at plan time: ${plan.baseline_tests}. Gate pass count now: ${gates ? gates.tests_passed : 'unknown'}.
Task outcomes (JSON): ${JSON.stringify(results.map(r => ({ id: r.task.id, title: r.task.title, tier: r.task.tier, status: r.impl ? r.impl.status : 'skipped', verified: r.verify ? r.verify.pass : false, deviations: r.impl ? r.impl.deviations : [] })))}
Gate results, run by a separate agent (JSON): ${JSON.stringify(gates)}
Review the actual code and tests (git log since the plan, the diff, the gate output above; re-run a gate yourself only if its output is unclear). Judge: are the exit criteria met and demonstrated? Is behaviour unchanged — docs/API.md rows, the German catalogs (git diff of every catalog file since the plan's base commit must be empty), the DB schema and migrations, the pinned output lines, the test assertions (spot-check five rewritten tests against their previous version), and the pass count not below the baseline? Does the code follow docs/EFFECT.md E1-E12 and SPEC D1-D15, and do the modules still honour their module-doc gotchas? Are the Effect idioms (E12) followed, and does every API used exist in ${VENDOR} as used (spot-check ten names against ${VENDOR}/packages/effect/src)? Were the pattern files corrected where the code proved them wrong? Are deviations justified and documented? Where the milestone asks for a boot-and-shutdown, headless, bundle-size or local-stack check, was it actually run (look for the logs and the recorded numbers)? Report findings with severity; high = exit criterion not met, a behaviour change, a fixed decision violated, or a v3 construct in the tree.`

const fixFindingPrompt = (n, f) => `${RULES}
Address this milestone-${n} review finding (${f.severity}): ${f.title}
Detail: ${f.detail}
Files: ${(f.files || []).join(', ') || 'locate them'}
Fix it properly with tests on main in ${REPO}, run the gates that cover it (bun run typecheck, the relevant bun test paths, bun test apps/api/test/effect-idioms.test.ts, bun run build when the web app changed), commit.`

const docsPrompt = (n, m, review) => `${RULES}
Milestone ${n} "${m.name}" is implemented. Review summary: ${review.summary}
Sync documentation in ${REPO}: update CLAUDE.md (status, layout, commands, conventions and the gotchas actually in use, with the new paths; a gotcha Effect made obsolete moves to "Retired gotchas" with one line saying what replaced it); mark the plan in docs/plans as done with the integration record (gate logs, pass counts before and after, the checks the exit criteria asked for) and a short "what changed vs plan" section listing every deviation; correct every pattern file under ${PATTERNS_DIR}/ that the milestone proved wrong and add one "In this repo" example per file from the code just written; for every deviation from docs/SPEC.md §1 or docs/EFFECT.md §1 that survived review, add docs/adr/NNNN-<slug>.md (date, context, decision, consequences) and adjust the SPEC or EFFECT.md text in the same commit. Do not change decisions. Run \`bun test apps/api/test/docs-paths.test.ts\` (every path named in CLAUDE.md must exist). Commit.`

// ---------------------------------------------------------------------------
// Orchestration: milestones strictly sequential; Learn → Plan → waves → Review → Harden
// ---------------------------------------------------------------------------
const report = []
let agents = 0
const run = async (prompt, opts) => { agents++; return agent(prompt, opts) }

for (const n of todo) {
  const m = MILESTONES[n]
  if (budget.total && budget.remaining() < 150_000) { log(`budget nearly spent, stopping before milestone ${n}`); break }
  log(`=== milestone ${n}: ${m.name} ===`)

  // --- Learn: the vendored source must exist (E0 adds it), then the pattern files this milestone needs ---
  const vendor = await run(vendorPrompt(), { ...HAIKU, effort: 'low', phase: 'Learn', label: `vendor:${n}`, schema: VENDOR_SCHEMA })
  if (!vendor || !vendor.present) {
    report.push({ milestone: n, name: m.name, status: 'aborted', reason: `vendored Effect source missing: ${vendor ? vendor.notes : 'agent failed'}` })
    log(`milestone ${n} aborted: repos/effect is not present and could not be added (${vendor ? vendor.notes : 'agent failed'})`)
    break
  }
  log(`vendored Effect: ${vendor.ref}${vendor.commit ? ` (subtree commit ${vendor.commit})` : ' (already present)'}`)
  const patterns = (await parallel(m.patterns.map(topic => () => run(patternPrompt(topic), { ...SONNET, phase: 'Learn', label: `pattern:${topic}`, schema: PATTERN_SCHEMA })))).filter(Boolean)
  const written = patterns.filter(p => p.status === 'written').map(p => p.path)
  const blockedPatterns = m.patterns.filter((topic, k) => !patterns[k] || patterns[k].status === 'blocked')
  log(`pattern files: ${written.length} written, ${patterns.filter(p => p.status === 'existing').length} existing${blockedPatterns.length ? `, BLOCKED: ${blockedPatterns.join(', ')}` : ''}`)
  if (blockedPatterns.length) {
    report.push({ milestone: n, name: m.name, status: 'aborted', reason: `pattern files could not be written: ${blockedPatterns.join(', ')}` })
    log(`milestone ${n} aborted: the planner would start without ${blockedPatterns.join(', ')}; resume after fixing the cause`)
    break
  }

  // --- Plan (Opus): plan, three critics, one revision ---
  let plan = await run(planPrompt(n, m), { ...OPUS, phase: 'Plan', label: `plan:${n}`, schema: PLAN_SCHEMA })
  if (!plan) { report.push({ milestone: n, status: 'plan-failed' }); continue }
  const critiques = (await parallel(Object.keys(LENSES).map(lens => () =>
    run(critiquePrompt(n, m, plan, LENSES[lens]), { ...OPUS, phase: 'Plan', label: `critic:${lens}:${n}`, schema: CRITIQUE_SCHEMA }),
  ))).filter(Boolean)
  const issues = critiques.flatMap(c => c.issues).filter(i => i.severity !== 'low')
  if (critiques.some(c => !c.approved) && issues.length) {
    log(`plan ${n}: ${issues.length} issues from critics, revising`)
    const revised = await run(revisePrompt(n, m, plan, issues), { ...OPUS, phase: 'Plan', label: `revise:${n}`, schema: PLAN_SCHEMA })
    if (revised) plan = revised
  }
  const tiers = plan.tasks.reduce((acc, t) => { acc[t.tier] = (acc[t.tier] || 0) + 1; return acc }, {})
  log(`plan ${n}: ${plan.tasks.length} tasks (${JSON.stringify(tiers)}), baseline ${plan.baseline_tests} tests → ${plan.plan_path}`)

  // --- Implement in dependency waves; model per task tier ---
  const results = []
  const done = new Set()
  const dead = new Set()
  const pending = plan.tasks.slice()
  const total = plan.tasks.length
  let waveNo = 0
  let aborted = null
  while (pending.length) {
    const ready = pending.filter(t => (t.deps || []).every(d => done.has(d)))
    if (!ready.length) {
      for (const t of pending) { log(`task ${t.id} skipped: deps ${JSON.stringify(t.deps || [])} not satisfied`); results.push({ task: t, impl: null, verify: null }) }
      break
    }
    const wave = ready.slice(0, MAX_PARALLEL)
    for (const t of wave) pending.splice(pending.indexOf(t), 1)
    waveNo++
    const isolated = wave.length > 1
    log(`wave ${waveNo}: ${wave.map(t => `${t.id}(${t.tier})`).join(', ')}${isolated ? ' in parallel worktrees' : ' on main'}`)

    const impls = await parallel(wave.map(task => () => run(
      implPrompt(n, m, plan, task, plan.tasks.indexOf(task), total, isolated),
      { ...modelFor(task), phase: 'Implement', label: `impl:${task.id}`, schema: IMPL_SCHEMA },
    )))
    const crashed = wave.filter((task, k) => impls[k] == null).map(t => t.id)
    if (crashed.length) {
      log(`wave ${waveNo}: agents for ${crashed.join(', ')} returned no result; aborting milestone ${n}`)
      aborted = `agents failed in wave ${waveNo}: ${crashed.join(', ')}`
      break
    }
    // A blocked result may be work that already sits on main: a read-only check before declaring it dead.
    const blockedIdx = wave.map((t, k) => k).filter(k => impls[k].status === 'blocked')
    const checks = await parallel(blockedIdx.map(k => () => run(landedPrompt(n, wave[k], impls[k]), { ...HAIKU, phase: 'Implement', label: `landed:${wave[k].id}`, schema: LANDED_SCHEMA })))
    blockedIdx.forEach((k, j) => {
      const fixed = landedImpl(impls[k], checks[j])
      if (fixed) { log(`task ${wave[k].id} reported blocked but its work is already on main (${fixed.commit}); counted done`); impls[k] = fixed }
    })
    const landed = []
    wave.forEach((task, k) => {
      const impl = impls[k]
      if (impl.status === 'blocked') { log(`task ${task.id} blocked: ${impl.notes || impl.summary}`); dead.add(task.id); results.push({ task, impl, verify: null }) }
      else landed.push({ task, impl })
    })

    const toMerge = isolated ? landed.filter(w => needsMerge(w.impl)) : []
    let merged = landed.filter(w => !toMerge.includes(w))
    if (toMerge.length) {
      const mergeRes = await run(mergePrompt(n, toMerge), { ...SONNET, phase: 'Implement', label: `merge:wave${waveNo}`, schema: MERGE_SCHEMA })
      // Merge agents sometimes decorate ids ("E2-T05 (wf/e2-e2-t05, daa4a24)"): match on the id token, not the whole string.
      const mergedIds = (mergeRes ? mergeRes.merged : []).map(s => String(s))
      const ok = new Set(toMerge.map(w => w.task.id).filter(id => mergedIds.some(s => s === id || new RegExp(`(^|[^A-Za-z0-9-])${id}([^A-Za-z0-9-]|$)`).test(s))))
      merged = merged.concat(toMerge.filter(w => ok.has(w.task.id)))
      for (const w of toMerge.filter(w => !ok.has(w.task.id))) {
        log(`task ${w.task.id}: branch ${w.impl.branch} not merged (${mergeRes ? mergeRes.summary : 'merge agent failed'})`)
        dead.add(w.task.id); results.push({ task: w.task, impl: { ...w.impl, status: 'blocked', notes: 'unmerged branch' }, verify: null })
      }
    }

    // Verify on main (Sonnet, read-only, concurrent), then sequential fix loops: Sonnet first, Opus on the last round.
    const verifies = await parallel(merged.map(w => () => run(verifyPrompt(n, w.task, w.impl), { ...SONNET, phase: 'Implement', label: `verify:${w.task.id}`, schema: VERIFY_SCHEMA })))
    for (let k = 0; k < merged.length; k++) {
      const { task, impl } = merged[k]
      let verify = verifies[k]
      let round = 0
      while (verify && !verify.pass && round < MAX_FIX) {
        round++
        const fixer = round === MAX_FIX ? OPUS : SONNET
        log(`task ${task.id}: verification failed (${verify.failures.length} failures), fix round ${round} (${fixer.model})`)
        await run(fixPrompt(n, task, verify, round), { ...fixer, phase: 'Implement', label: `fix${round}:${task.id}`, schema: IMPL_SCHEMA })
        verify = await run(verifyPrompt(n, task, impl), { ...SONNET, phase: 'Implement', label: `reverify${round}:${task.id}`, schema: VERIFY_SCHEMA })
      }
      if (verify && !verify.pass) log(`task ${task.id}: still failing after ${MAX_FIX} fix rounds; left for milestone review`)
      done.add(task.id)
      results.push({ task, impl, verify })
    }
  }
  results.sort((a, b) => plan.tasks.indexOf(a.task) - plan.tasks.indexOf(b.task))
  if (!aborted) {
    const incomplete = incompleteTasks(results)
    if (incomplete.length) aborted = `blocked/skipped tasks: ${incomplete.join(', ')}`
  }
  if (aborted) {
    report.push({ milestone: n, name: m.name, plan: plan.plan_path, status: 'aborted', reason: aborted, tasks: results.map(r => ({ id: r.task.id, tier: r.task.tier, status: r.impl ? r.impl.status : 'not run', verified: !!(r.verify && r.verify.pass), commit: r.impl ? r.impl.commit : '' })) })
    log(`milestone ${n} aborted (${aborted}); resume with resumeFromRunId after fixing the cause`)
    break
  }

  // --- Review: Haiku runs the gates, Opus judges; Harden: Sonnet fixes, Opus re-reviews, bounded ---
  let gates = await run(gatesPrompt(n), { ...HAIKU, phase: 'Review', label: `gates:${n}`, schema: GATES_SCHEMA })
  if (gates && gates.tests_passed >= 0 && gates.tests_passed < plan.baseline_tests) log(`WARNING milestone ${n}: ${gates.tests_passed} tests pass, baseline was ${plan.baseline_tests} (a dropped test is a review finding)`)
  let review = await run(reviewPrompt(n, m, plan, results, gates), { ...OPUS, phase: 'Review', label: `review:${n}`, schema: REVIEW_SCHEMA })
  if (review) {
    for (let round = 1; round <= HARDEN_ROUNDS; round++) {
      const serious = review.findings.filter(f => f.severity !== 'low')
      if (!serious.length) break
      log(`review ${n}, harden round ${round}: ${serious.length} findings to fix (${review.findings.length - serious.length} low skipped)`)
      for (const f of serious) {
        await run(fixFindingPrompt(n, f), { ...SONNET, phase: 'Harden', label: `fix${round}:${f.title.slice(0, 40)}`, schema: IMPL_SCHEMA })
      }
      gates = await run(gatesPrompt(n), { ...HAIKU, phase: 'Review', label: `gates${round}:${n}`, schema: GATES_SCHEMA })
      const again = await run(reviewPrompt(n, m, plan, results, gates), { ...OPUS, phase: 'Review', label: `re-review${round}:${n}`, schema: REVIEW_SCHEMA })
      if (again) review = again
    }
    await run(docsPrompt(n, m, review), { ...SONNET, phase: 'Harden', label: `docs:${n}` })
  }

  report.push({
    milestone: n,
    name: m.name,
    plan: plan.plan_path,
    baseline_tests: plan.baseline_tests,
    tests_passed: gates ? gates.tests_passed : -1,
    patterns_written: written,
    tasks: results.map(r => ({ id: r.task.id, title: r.task.title, tier: r.task.tier, status: r.impl ? r.impl.status : 'failed', verified: !!(r.verify && r.verify.pass), commit: r.impl ? r.impl.commit : '' })),
    exit_met: review ? review.exit_met : false,
    open_findings: review ? review.findings.filter(f => f.severity !== 'low').map(f => `${f.severity}: ${f.title}`) : ['review failed'],
    review_summary: review ? review.summary : '',
  })
  log(`milestone ${n} done: exit_met=${review ? review.exit_met : 'unknown'}, tests ${plan.baseline_tests} → ${gates ? gates.tests_passed : '?'}, agents so far ${agents}`)
  if (review && !review.exit_met) { log(`stopping: milestone ${n} exit criteria not met; fix and resume`); break }
}

return { agents_used: agents, milestones: report }
