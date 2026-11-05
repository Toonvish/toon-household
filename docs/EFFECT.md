# Effect migration — spec

toon-household moves onto the [Effect](https://effect.website) library: `Schema` for every contract, services
and layers for every piece of fallible or effectful code, a managed runtime on both sides of the wire, and
(last) Effect's own HTTP server in place of Hono. This document is the spec the migration workflow builds from
(`.claude/workflows/migrate-effect.js`, see CLAUDE.md "Building it"). It has the same shape as `docs/SPEC.md`:
fixed decisions (§1), how agents learn Effect (§2), the target architecture (§3), the milestones (§4), the gates
(§5) and what is out of scope (§6). `docs/SPEC.md` D1–D15 stay in force; this spec adds E1–E12 and changes no
behaviour the user, the operator or the wire can observe.

The guiding sentence: **the migration changes how the code is written, not what it does.** Every `docs/API.md`
row, every German string, every DB table and migration, every exit code and output line a doc or test pins,
every fixed decision of `docs/SPEC.md`, and every observable assertion of the 2434-test suite survives.

## 1. Fixed decisions

Taken with the owner on 2026-10-16. Deviations follow the SPEC rule: smallest possible, recorded in the plan and
in `docs/adr/`, the ADR edits this text in the same commit.

- **E1 — Effect 4, one version, the stable packages only.** `effect@4.0.5` (the 4.x LTS line, npm tag
  `latest` on 2026-10-16), `@effect/platform-bun` at the SAME exact version, pinned without `^`. Every
  `@effect/*` package is bumped together (v4 ships synchronized versions). Never a v3 package or path:
  no `@effect/platform`, `@effect/schema`, `@effect/sql@0.x`, `@effect/sql-drizzle`, no
  `effect/unstable/*` import (v4 dropped the segment: `effect/http`, `effect/http-api`, `effect/sql`,
  `effect/testing`). `@effect/sql-libsql` is NOT installed (E5). `@effect/vitest` is not used (E9).
- **E2 — The Effect source is vendored and is the documentation (the "one weird git trick").**
  `repos/effect` is a squashed `git subtree` of `github.com/Effect-TS/effect` at the release tag of the
  installed `effect` version (`effect@4.0.5`; `main` only if the tag is missing), updated with `git subtree
  pull … --squash` in the same commit as a version bump. It is READ-ONLY reference material: nothing imports
  from `repos/`, nothing runs `bun install` or a test inside it, no file in it is edited. It is excluded from
  test discovery (`bunfig.toml` `[test] pathIgnorePatterns = ["repos/**"]`), from the image (`.dockerignore`),
  from the editor's search, watcher and auto-import (`.vscode/settings.json`) and from Vite's watcher. The
  read order for anyone writing Effect code is §2. Agents prefer the vendored source and examples over memory
  or the web: the models' memory is Effect v3, and v4 renamed a great deal (§2.3).
- **E3 — Inside out, behaviour-preserving, one layer per milestone.** Pure domain code first
  (`packages/shared`), then the API services, then the scripts, then the web, then the HTTP layer. A milestone
  leaves the tree in a shippable state: gates green, the test count not below the previous milestone's, no
  behaviour change. Pure functions stay pure functions (money math, parsers, formatters, the i18n runtime, the
  ledger arithmetic): Effect wraps what is fallible, asynchronous, resourceful or needs a dependency, never a
  pure computation.
- **E4 — `Schema` replaces Zod as THE contract.** `packages/shared` defines every request, response, query and
  entity schema with `effect`'s `Schema` and stays the single contract source; the API validates with it, the
  web decodes with it, types derive from it (`typeof X.Type`). The validation error envelope keeps its wire
  shape (`422 { error: { code: "validation_failed", message, details: [{ path, code, message, i18n }] } }`,
  `docs/API.md` "Conventions"; the first draft of this paragraph said `validation_error` and omitted `i18n`, ADR
  0013): one adapter (`toValidationIssues`) turns a `Schema` issue tree into the `details` items, and the
  wording stays the catalog's (`server.zod.*` and `server.validation.*` keys, ADR 0002), never Effect's default
  messages, for EVERY route (the former `zValidator` routes sent Zod's English sentence without `i18n` until E1,
  ADR 0013, accepted by the owner 2026-10-16). `zod` and
  `@hono/zod-validator` leave all three `package.json` at the end of E1. `drizzle-zod` is not in use and stays
  out.
- **E5 — Drizzle stays the schema and migration source; the connection becomes a service.** SPEC D7 ("one
  Drizzle schema, one migration set", the pragmas, `synchronous = FULL`) is untouched. A `Database`
  `Context.Service` owns the `@libsql/client` client and the drizzle instance, is built by a scoped `Layer`
  that sends the D7 pragmas (the `db-pragmas` test keeps passing, pooled connection included), exposes
  `use(fn)` and `transaction(effect)` (replacing `withTransaction`, same degradation rule under an explicit
  `TEST_DATABASE_URL=file::memory:`), and is closed by the runtime's scope on shutdown. Raw SQL through
  `@effect/sql-libsql` is a later ADR, not this migration. The process-wide instance is still
  created at import of `apps/api/src/db/client.ts` after E5 (the tests' shared `db` of ADR 0009 and
  `migrate-legacy.ts`'s load-bearing import order read it) and stays until E8 decides; `Database.layer` owns its
  lifetime (acquire awaits the pragmas, release closes it, never under `NODE_ENV=test`): ADR 0014 "Status after E5's
  integration".
- **E6 — Errors are tagged, typed and mapped once.** `ApiError` and its static helpers become a family of
  `Schema.TaggedError` classes in `apps/api/src/lib/errors.ts` carrying `status`, `code` and `text` (the
  server-catalog key with values) exactly as today; `toBody(locale)` moves to one `toApiError` /
  `errorResponse` at the HTTP boundary. Services declare their failures in the type
  (`Effect.Effect<A, NotFound | Forbidden | …>`); handlers never `instanceof`, they `Effect.catchTag(s)`.
  Unexpected failures (defects) are logged in English and answered as the same `500 internal_error` as now.
  Error codes are the wire contract (`ERROR_CODES` in `packages/shared`, the api-doc test names every value).
- **E7 — Services, layers, one runtime.** Every module under `apps/api/src/core/services/` and
  `apps/api/src/modules/<id>/services/` is a `Context.Service` class with a static `layer` (LLMS.md pattern);
  cross-cutting dependencies are services too: `AppConfig` (today's `env.ts`, built with `Config`, keeping its
  eager validation, the dotenv rules and the test temp-DB rule), `Database` (E5), `Mailer` (console / smtp /
  resend as layers chosen by config), `Uploads` (`UPLOAD_DIR`, signed URLs, thumbnails), `Clock` /
  `DateTime` wherever a service reads the time today (`Date.now()`, `new Date()`), `RateLimiter`,
  `OAuthProviders`. `apps/api/src/runtime.ts` composes `AppLayer` from the core layers and each module's
  `layer` and builds ONE `ManagedRuntime` at boot (ai-docs `04_integration`, memo map shared); until E7
  replaces Hono, handlers call `runtime.runPromise(...)`. Module code reaches a core service only through
  its tag (never through a core module's internals), and the core reaches a module only through
  `apps/api/src/modules/index.ts` (SPEC §2 unchanged). The `ApiModule` hooks (`onHouseholdCreated`,
  `onEnable`, `onMemberRemoving`, `afterMigrate`, `start`, `shutdown`, `seedDemo`, `uploadReferences`)
  become Effects that receive the transaction through the `Database` service's transactional context, and the
  manifest gains `layer: Layer.Layer<…>` for the module's own services; the import-cycle rule of CLAUDE.md
  ("read the registry inside functions") stays binding: layers are values, so a manifest never references a
  core middleware at module scope. While E2 to E5 convert the core, the modules and the scripts in turn, the
  converted core keeps legacy bridges with the old signatures, a Promise module contract behind an adapter
  (`PromiseApiModule`, `fromPromiseModule`, `runModuleHook`) and the test seams `setMailer`,
  `setVerifiedEmailRequired` and `resetRateLimits`, each removed by the milestone that moves its last caller: ADR 0014.
- **E8 — Hono goes last, and only when the API is already Effect underneath.** E7 (the milestone) replaces
  `Hono` with `effect/http-api` (`HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `HttpApiBuilder`,
  `HttpApiMiddleware`) served by `BunHttpServer` (`@effect/platform-bun`). The observable contract is frozen:
  every `docs/API.md` row, status, body, header (`Set-Cookie`, CSP, CORS, `Location`,
  `Content-Disposition`), the middleware ORDER of CLAUDE.md "Middleware chain order is load-bearing" and SPEC
  D8 (security headers, cors, origin guard on `/api/*`, health, `/uploads`, module routers, `/api/auth`,
  `/api/households`, static web LAST; invite-token routes before `/:householdId`), the signed `/uploads`,
  `requireSession` → `requireHouseholdRole("member")` → `requireModule(id)` as `HttpApiMiddleware`s with the
  same names and the same 401/403/404 order, and the `ApiModule` contract's shape (a module contributes
  `HttpApiGroup`s plus their handler layer instead of a `Hono` router; `userRouter` likewise). The api-doc
  test enumerates routes from the `HttpApi` definition instead of `app.routes`. The tree after E6 is a
  supported stopping point: the owner may defer E7 by not running it.
- **E9 — `bun test` stays; Effect tests run through layers.** No vitest, no `@effect/vitest`. A support
  module `apps/api/test/support/effect.ts` gives `runTest(effect)` (the test `AppLayer` with the shared test
  database of ADR 0009, a `TestClock` from `effect/testing` where a test today fakes time, a recording
  `Mailer`) and `itEffect(name, effect)`; `packages/shared/test` and the web tests use `Effect.runSync` /
  `Effect.runPromise` directly. Existing test files keep their assertions; a test rewritten onto a service
  replaces the old one in the same commit, never later, and the pass count never drops below the previous
  milestone's record (2434 at the start). `app.request` tests keep going through the real app until E7, then
  through `HttpApiBuilder`'s in-memory handler (`HttpApiTest`, see `repos/effect/LLMS.md` "HttpApi").
- **E10 — Scripts are Effect programs with the same CLI surface.** `apps/api/scripts/*.ts` run through
  `BunRuntime.runMain` on the `AppLayer` (or an explicit layer where the script must not load `env.ts`:
  `migrate-legacy.ts`'s import-order rule stays binding, so `AppConfig` has a constructor from explicit
  values and `Database` a layer from an explicit URL). `effect/cli` may parse arguments; every flag, exit
  code (0/1/2) and output line that `docs/migration.md`, `docs/deployment.md` or a test pins is unchanged,
  including the `@toon/api migrate:legacy: ` prefix behaviour.
- **E11 — The web gets a runtime and an Effect API client; TanStack Query stays.** SPEC D9 is fixed: the
  persisted TanStack cache IS the offline ledger and the outbox (`mutationDefaults`, paused mutations,
  `PERSIST_BUSTER`), so TanStack Query and the router stay. What becomes Effect: `apps/web/src/lib/api.ts`
  and every module `api.ts` (`HttpClient` from `effect/http` with `FetchHttpClient`, requests described once,
  responses decoded with the shared `Schema`, failures as the same tagged `ApiError` with `status`, `code`,
  `message`), run through ONE `ManagedRuntime` (`apps/web/src/lib/runtime.ts`); `queryFn`s and
  `mutationFn`s are `runtime.runPromise(...)` of those effects; the 401 handler, the cache purge, `credentials:
  "include"`, the upload size cap and `PUBLIC_API_URL` rules keep their semantics (the CSP `connect-src
  'self'` gotcha included). `@effect/atom-react` is an owner decision for later (`docs/open-work.md`), not
  this migration. The web bundle must stay tree-shaken: import from `effect` and `effect/http` only, check the
  gzipped size in the E6 record. **As built (E6):** the runtime is `apps/web/src/lib/runtime.ts` over
  `FetchHttpClient` (a late-bound `Fetch`, `credentials: "include"`, trace propagation off) with the `ApiClient`
  service of `apps/web/src/lib/api-client.ts`; READS decode with `disableChecks` (structure and types, never the wire
  checks), a WRITE's response never fails on its decode, `invalid_response` is never retried, and a response
  literal or shape that widens is a two-step deploy while `skipWaiting` is off; idioms rule (13) is the edge
  (plan `docs/plans/e6-web-client.md` P7, P7a, P13, section 7 D5). The gzipped bundle grew from 402.54 kB to
  419.99 kB (17.45 kB, under the 60 kB threshold: no ADR).
- **E12 — The idioms are a gate.** From `repos/effect/LLMS.md`: `Effect.gen` inline, `Effect.fn("Service.method")`
  for reusable functions (traced) and `Effect.fnUntraced` on hot paths, no function that only wraps an
  `Effect.gen`, combinators as extra arguments of `Effect.fn` (never `.pipe` on it), `return yield*` when
  raising, `Schema.TaggedError` for errors, `Context.Service` + static `layer` for services, `Predicate`
  instead of hand-written guards, `Schema` instead of manual parsing of untrusted input, `DateTime` / `Clock`
  instead of `Date` in services, `Effect.catchTag(s)` instead of `instanceof`. A grep test
  `apps/api/test/effect-idioms.test.ts` (shape of `design-system.test.ts`: a rule, a glob, a pinned allow
  list) pins what grep can see: no `from "zod"` after E1, no `effect/unstable/`, no `@effect/platform"`,
  `@effect/schema` or `Context.Tag(`, no import from `repos/`, no `Date.now()` / `new Date()` in
  `apps/api/src/**/services/**` after E2 (allow list: the few places that stamp a DB row and are covered by
  the `Clock` rule's record), no `throw new ApiError` after E2, no `from "hono"` outside the files E7's record
  names (none after E7). Never relax a rule to get green; a cleanup edits the record in the same commit.

## 2. How an agent learns Effect here

### 2.1 Read order (before writing any Effect code)

1. `repos/effect/LLMS.md` — the library's own guide for coding agents: idioms, services, errors, resources,
   running programs, testing, SQL, HttpClient, HttpApi. Read it whole once per session.
2. The pattern file(s) for the modules the task touches, `agent-patterns/effect-<topic>.md` (§2.2).
3. The example files LLMS.md links, under `repos/effect/ai-docs/src/` (`01_effect/…`, `04_integration`
   for `ManagedRuntime` with Hono, `09_testing`, `40_sql`, `50_http-client`, `51_http-server`).
4. For schemas: `repos/effect/packages/effect/SCHEMA.md`, in chunks (it is large). For HttpApi:
   `repos/effect/packages/effect/HTTPAPI.md`. For config: `repos/effect/packages/effect/CONFIG.md`.
5. For an API you remember from v3: `repos/effect/MIGRATION.md`, `repos/effect/migration/v3-to-v4.md`
   (the import and rename map), `repos/effect/migration/schema.md`, `services.md`, `error-handling.md`.
6. When the docs are silent: the source under `repos/effect/packages/effect/src/` and the package's `test/`.
   Never the web, never memory, for a v4 signature.

### 2.2 Pattern files

`agent-patterns/effect-<topic>.md` is a short, project-local distillation of one Effect module, written by an
agent from the vendored source (the blog's recommendation): constructors, the two or three call shapes this
repo uses, encoding/decoding or composing, error handling, the v3→v4 renames that bite, pitfalls, and one
example in this repo once one exists. The workflow's Learn phase writes a missing one before a milestone
plans; a milestone that discovers a wrong line fixes the file in the same commit. Topics: `effect-core`
(gen, fn, pipe, Result/Option, Exit, Cause), `effect-schema`, `effect-services` (Context.Service, Layer,
ManagedRuntime, memo map, Scope), `effect-errors` (TaggedError, catchTag(s), defects, Cause), `effect-testing`
(layers in tests, TestClock, running under `bun test`), `effect-config`, `effect-datetime-clock`,
`effect-stream` (recipe's OCR subprocess and uploads), `effect-http-client`, `effect-http-api`,
`effect-http-server-bun` (BunHttpServer, cookies, headers, static files, middleware order), `effect-cli`.

### 2.3 v4, not v3 (the renames every agent trips over)

`Context.Tag` / `Effect.Service` → `Context.Service<Self, Shape>()("id")` with a static `layer`, no static
accessors (use `Service.use(fn)` or `yield* Service`); `Effect.catchAll` → `Effect.catch`; `Either` → `Result`;
`FiberRef` → `Context.Reference`; `Schema.Union(A, B)` → `Schema.Union([A, B])`, `Schema.Literal("a", "b")` →
`Schema.Literals(["a", "b"])`, `.annotations()` → `.annotate()`, `.filter()` → `.check()` / `.refine()`,
`decodeUnknown` → `decodeUnknownEffect`, `decodeUnknownEither` → `decodeUnknownExit`, `pick`/`omit` →
`mapFields(Struct.pick([...]))`, `transform` → `decodeTo`; `@effect/platform/*` → `effect/*` (`HttpClient`,
`FetchHttpClient`, `Cookies`, `Headers`, `HttpRouter` under `effect/http`; `FileSystem`, `Path` under
`effect`); `effect/unstable/http` → `effect/http`; `TestClock` under `effect/testing`. The full map is
`repos/effect/migration/v3-to-v4.md`.

### 2.4 Rules for the vendored tree

`repos/` is read-only; nothing in `apps/`, `packages/` or `scripts/` imports from it; it is not a workspace;
`bun install`, `bun test` and `tsc` are never run inside it; it is never edited, and an agent that needs a
newer Effect bumps the three `package.json` and runs `git subtree pull --prefix=repos/effect
https://github.com/Effect-TS/effect.git <tag> --squash` in the same commit. `git status --porcelain repos/`
is empty after every task.

## 3. Target architecture

### 3.1 `packages/shared`

Unchanged layout; `core/schemas/*.ts` and `modules/<id>/schemas*.ts` hold `Schema` definitions (classes for
entities where a constructor helps, `Schema.Struct` for bodies and queries), `ERROR_CODES` and `ServerKey`
unchanged, `toValidationIssues` takes a `Schema` issue instead of a `ZodError` and returns the same items.
The flat re-export rule, the `Finance…` prefixes and the one-entry rule (`packages/shared/src/index.ts`)
stay. The i18n runtime and the pure modules (`calendar.ts`, `text.ts`, money, ledger, periods, units,
ingredients, barcode, qr) stay pure; a function that today throws a typed error (`BarcodeValueError`,
`QrTooLongError`) may return `Result` instead, with its callers adapted in the same commit.

### 3.2 `apps/api`

```
apps/api/src/
  runtime.ts                 AppLayer + the ManagedRuntime (one per process); layer builders for scripts and tests
  config.ts                  AppConfig service (env.ts's rules, Config-based); env.ts re-exports until E7 removes it
  db/{client,migrate,schema}.ts   Database service and layer (E5); migrate as an Effect; schema unchanged
  lib/errors.ts              the tagged error family (E6) + the one boundary mapper
  lib/…                      cookies, uploadUrls, timingSafe… as pure helpers or small services
  middleware/*.ts            E2–E6: Hono middlewares that run effects through the runtime;
                             E7: HttpApiMiddleware with the same names and order
  core/services/<area>/*.ts  Context.Service classes with static layers
  core/routes/*.ts           E2–E6: Hono routes calling runtime.runPromise; E7: HttpApiGroup definitions + handlers
  modules/<id>/{index,schema,routes/,services/,seed}.ts   manifest with `layer`, hooks as Effects
  modules/{index,types,mount}.ts   registry, the ApiModule contract (E7, E8), the mount chain
```

### 3.3 `apps/web`

`apps/web/src/lib/runtime.ts` (ManagedRuntime from a `WebLayer`: `FetchHttpClient` configured with the base
URL, credentials and the 401 hook), `apps/web/src/lib/api.ts` and `modules/<id>/api.ts` as effects returning
decoded shared types, `queries.ts` files unchanged in shape (`queryFn: () => runtime.runPromise(api.x())`),
the persist and offline plumbing untouched, `validation.ts` on `Schema`. Nothing else in the web app imports
`effect` unless the planner records why (forms stay forms).

### 3.4 Scripts

Each script is `BunRuntime.runMain(program.pipe(Effect.provide(layer)))`; `migrate-legacy.ts` keeps its
static-import discipline and builds its layers from the values it resolved itself.

## 4. Milestones

Sequential. Inside a milestone, tasks run in dependency waves (the workflow's rules). Each milestone's plan
lives in `docs/plans/e<N>-<name>.md` with the integration record and "what changed vs plan" as before.

| # | Name | Goal | Exit |
| --- | --- | --- | --- |
| E0 | foundation | Vendor Effect (E2: subtree at `effect@4.0.5`, `bunfig.toml` ignore, `.dockerignore`, `.vscode/settings.json`, Vite watch ignore), install `effect` and `@effect/platform-bun` pinned (E1), CLAUDE.md "Vendored reference code" section with §2's rules and read order, the first pattern files (`effect-core`, `effect-schema`, `effect-services`, `effect-errors`, `effect-testing`), `apps/api/test/effect-idioms.test.ts` with the E12 rules that already hold (no `repos/` import, no v3 paths, no `effect/unstable/`), `apps/api/src/runtime.ts` with an empty `AppLayer` and `/api/health` answered through `runtime.runPromise` as the proof that the runtime boots, shuts down and is tested, ADR 0012 "Effect is the application framework" (records E1–E12 against SPEC D4, D7, D8, D9, D10 and amends their wording where they name Zod or Hono), `docs/open-work.md` entries for `@effect/sql-libsql` and `@effect/atom-react`. | gates green; `bun test` runs no test under `repos/`; `docker build` context excludes `repos/`; `git subtree` commit present; CLAUDE.md points at `repos/effect/LLMS.md`; the idioms test exists and passes; health served through the runtime. |
| E1 | shared-schema | Every Zod schema in `packages/shared` rewritten as `Schema` (E4) with the same accepted and rejected inputs (the shared tests are the oracle; add a table-driven parity test per schema file where a case is not covered), `toValidationIssues` on Schema issues with byte-identical `details` for the existing fixtures, the API's `validate(target, schema)` helper replacing `@hono/zod-validator` (same 422 `validation_failed` envelope, wording from the catalog for every route, ADR 0002 and ADR 0013), `apps/web/src/lib/validation.ts` and every web form validator on Schema, `env.ts` and `lib/oauth.ts` decode with a local `Schema` and a pure `parseEnv` (the `AppConfig` service stays E2's, plan e1 P11, ADR 0013), `zod` and `@hono/zod-validator` removed from every `package.json` and the lockfile, the idioms rule "no zod" switched on. | gates green; `grep -r 'from "zod"' apps packages` empty; every API validation test and every shared test passes unchanged; the German validation wording unchanged (i18n:check parity OK). |
| E2 | api-core-services | E5, E6, E7 for the core: `AppConfig`, `Database` (pragmas, `transaction`, shutdown), the tagged error family and the boundary mapper, `Mailer` layers, `Uploads`/thumbnails, `RateLimiter`, `Clock` where the core reads time, every `core/services/**` module as a `Context.Service` with a layer, `runtime.ts` composing `AppLayer`, the core routes and the middlewares calling the runtime (Hono stays), the module hooks typed as Effects with an adapter so the recipe and finance manifests (still Promise-based) keep working until E3/E4, `apps/api/test/support/effect.ts`, the core tests rewritten where they call a service directly (through-the-app tests unchanged), the idioms rules "no throw ApiError" and "no Date in core services" switched on with their allow list. | gates green; pass count ≥ E1's; `db-pragmas`, `middleware`, `import-order`, `placeholders` (the claim race) tests pass unchanged; `bun run dev` boots and SIGTERM closes the database through the scope. |
| E3 | recipe-services | The recipe module's services as `Context.Service`s with the module `layer`: recipes, tags, collections, plan, shopping (outbox merge rule unchanged), cards, media, the import pipeline (URL fetch with the SSRF guard as an `HttpClient` layer that keeps every refusal the ssrf tests pin, image localisation, OCR subprocess and PDF as scoped resources / `Stream`s, the worker terminated in `shutdown`), the hooks (`afterMigrate` backfill, `seedDemo`, `uploadReferences`) as Effects, recipe routes on the runtime, recipe tests rewritten where they call a service directly. `docs/modules/recipe.md` gotchas stay binding one by one. | gates green; pass count ≥ E2's; every recipe route row in `docs/API.md` still served; the import route tests ("real sessions") and the cross-household test pass unchanged. |
| E4 | finance-services | The finance module likewise: participants, transactions, categories, tags, plan (`plan:run` as an Effect with `Schedule` for the 6-hour tick, `Clock`-driven so "The `start` hook and the clock" gets a `TestClock` test), balance, settlements, the `onMemberRemoving` veto, `onEnable` (two participants), `onHouseholdCreated` (21 categories), seed, upload references; finance routes and `requireFinanceParticipant` on the runtime; finance tests rewritten where they call a service directly. `docs/modules/finance.md` gotchas F1–F74 stay binding. | gates green; pass count ≥ E3's; `halfForOther`, the plan rounding, `balance_stale`, `member_has_ledger` and the cross-household tests pass unchanged; the fixed-cost boot catch-up still books the two fixture rows (M6 gotcha). |
| E5 | scripts | E10: `migrate`, `seed`, `reset-password`, `uploads-gc`, `plan-run`, `localize-images`, `finance-import-xlsx`, `migrate-legacy` (with `scripts/legacy/*` and `scripts/finance-import/*` as services on explicit layers) as Effect programs; the dev/typecheck/i18n-check/icons root scripts stay plain Bun. | gates green; the fixture run of `migrate:legacy` (CLAUDE.md "Commands") prints the same report and exit codes, dry run writes no file, a second `--apply` says "already migrated"; `legacy-cli.test.ts` (import order, subprocess) passes unchanged; `seed` refuses production as before. |
| E6 | web-client | E11: `apps/web/src/lib/runtime.ts`, the core `api.ts` and both module `api.ts` on `HttpClient` + `Schema`, `ApiError` as a tagged error with the same fields, the 401 handler and the cache purge wired through the runtime, `queries.ts` files switched to `runtime.runPromise`, the offline outbox tests and `persist.test.ts` unchanged, `apps/web/src/lib/api.test.ts` extended with a decode-failure case; bundle size recorded before and after. | gates green (the three web tsconfigs); the headless checks of CLAUDE.md (login via `fetch`, a shopping-list offline replay, a finance capture replay after a reload while offline) pass; gzipped bundle growth recorded and under 60 kB, else an ADR explains it. |
| E7 | http-api | E8: the `HttpApi` definition per `docs/API.md` section (core groups, one group per module router), `HttpApiMiddleware` for session, household role, module, verified e-mail, locale, origin guard, security headers, cors, with the pinned order; `BunHttpServer` serving on the same port with the same `/uploads` signing, static web last, `/api/health`; the `ApiModule` contract moved to groups + handler layer (SPEC §2 text and `docs/modules/*.md` updated in the same commit); `app.request`-based tests moved to the in-memory handler; the api-doc test enumerating the `HttpApi`; `hono` removed from `package.json`; the Dockerfile and compose unchanged except what the record names. | gates green; pass count ≥ E6's; every `docs/API.md` row served with the same status/headers (a table-driven contract test over the walkthrough of `docs/plans/m7-harden.md` §9); the local stack test of `docs/deployment.md` passes with the image; the CSP hashes still match the built `index.html`. |
| E8 | harden | Review findings of E0–E7 closed, CLAUDE.md as built (layout, commands, the Effect gotchas that proved real, the retired gotchas), `docs/API.md` conventions updated where E7 changed an implementation note (never a row), `docs/modules/*.md` service names, the pattern files refreshed from what the code actually does, `docs/open-work.md`, this spec's §3 made to match the tree. | gates green on the final tree; CLAUDE.md names no file that does not exist (`docs-paths.test.ts`); the idioms test has every E12 rule on; `docs/plans/e8-harden.md` holds the gate logs and the walkthrough. |

## 5. Verification gates

SPEC §7 unchanged (`bun install`, `bun run typecheck`, `bun test`, `bun run build`, `bun run i18n:check`),
plus per milestone: the pass count compared with the previous record (never lower), `git status --porcelain
repos/` empty, `bun test apps/api/test/effect-idioms.test.ts`, and for E2 onwards a boot-and-shutdown check
(`bun run dev:api` in the background, `/api/health`, SIGTERM, the log shows the scope closed). E6 adds the
headless checks and the bundle size; E7 adds the contract table and the local stack test.

## 6. Out of scope

The N-person ledger (SPEC D3), `@effect/atom-react` or any replacement of TanStack Query (owner decision),
`@effect/sql-libsql` and raw SQL (ADR when wanted), OpenTelemetry export (an env switch later; `Effect.fn`
spans exist, no exporter is wired), `effect/cluster`, `effect/rpc`, OpenAPI documentation served in
production (E7 may generate it for the record but does not mount `/docs`), any UI or copy change.
