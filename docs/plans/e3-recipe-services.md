# E3 — recipe-services: plan

**Status: DONE (2026-11-05), E3-T01 to E3-T13 integrated; the record is sections 9 and 10. (Planned as revision 1 after the three critics
(feasibility, behaviour preservation, Effect v4 idioms); the revision notes follow this header.)** Base commit `ddc48af87` (`learn: effect-http-client pattern file from the vendored Effect source`), Bun 1.4.3 on
the host (`.bun-version` says 1.4.2; nothing here depends on the difference). Sections 9 and 10 (the integration record
and "what changed vs plan") are written by E3-T13.

**Revision 1 (2026-11-05), what the critics changed.** (1) The local-fixture URL import test reaches its `Bun.serve`
fixture through a test-only EXACT-HOST allow list of the guard (`setImportGuardForTests({ allowHosts: ["127.0.0.1"] })`,
P10), never through the private-hosts escape hatch, which skips every host check: a redirect into `169.254.169.254` is then
refused by the guard before any request is sent (E3-T03, E3-T13). (2) `importFromText` is not pure: it stays a synchronous
export over `Effect.runSync` of a service-free effect that fails with `BadRequest` and reads the `Clock` (P11, E3-T02).
(3) The `NODE_ENV=test` guard line of a `…ForTests` seam is the one tolerated `throw` in the "no throw" acceptance greps
(P1). (4) The old E3-T12 is split: E3-T12 (wave 7) deletes the core bridges of P20 and rewrites their four test files;
E3-T13 (wave 8) is the integration (the recipe bridge prune, the new test, the docs, the record). (5) `routes/recipes.ts`
and `routes/imports.ts` are NOT added to `import-order-effect.test.ts`: both die on the base tree when imported first,
because `routes/index.ts` reads them at module scope (P17, section 7 item 9). (6) The OCR gate's queue wait is
interruptible: `Effect.acquireRelease(…, { interruptible: true })` inside `Effect.scoped` with a granted-slot hand-back in
the cancel handler; `Effect.acquireUseRelease` runs its acquire uninterruptibly in v4 (P11). (7) An engine rejection that is
not an API-family error propagates unchanged as a defect (P11). (8) Every native subprocess run is closed by its own
`Effect.scoped` inside the timeout region (P11). (9) `rate-limiter.test.ts` reaches the enabled limiter through a
production `AppConfig`, as it already does; `enforceIn` stays private (E3-T12).

E3 is the fourth milestone of the Effect migration (`docs/EFFECT.md` §4 E3; decisions E3, E5, E6, E7 for the recipe
module, E9 for its tests, E12 for the idioms). Every file under `apps/api/src/modules/recipe/services/` that does I/O
becomes a `Context.Service` with a static `layer`; the module's own `layer` is exported from the manifest and merged into
the one `AppLayer`; the manifest stops being a `PromiseApiModule` and implements the Effect contract `ApiModule`
directly (finance stays behind `fromPromiseModule` until E4); the hooks `afterMigrate`, `seedDemo`, `uploadReferences`,
`healthFeatures`, `shutdown` are Effects; the recipe routes call `runtime.runPromise(...)` (Hono stays until E7); the URL
importer fetches through an `HttpClient` (`effect/http`, `FetchHttpClient`) wrapped by the SSRF guard; the OCR and PDF
subprocesses are scoped resources released (killed) by interruption; the capability flags come from `AppConfig`. The
guiding sentence holds: how the code is written changes, not what it does. No `docs/API.md` row, German string, table,
migration, exit code, `details` payload or pinned log line changes.

Exit (`docs/EFFECT.md` §4 E3 and the milestone task): gates green (`bun install --frozen-lockfile`, `bun run typecheck`,
`bun test`, `bun run build`, `bun run i18n:check` read by hand); the pass count not below E2's record (14658, re-measured
as this plan's baseline, section 1.2); every recipe row of `docs/API.md` still served (`apps/api/test/api-doc.test.ts`
unchanged and green); the import route tests ("Import route tests use real sessions": `apps/api/test/import/routes.test.ts`,
`apps/api/test/import/ocr-disabled.test.ts`), `apps/api/test/import/ssrf.test.ts` and
`apps/api/test/recipe-cross-household.test.ts` pass with their files (and `apps/api/test/import/helpers.ts`) unchanged; a URL
import against a local fixture server passes in an `app.request` test (new, E3-T13) and in the boot walkthrough; the
shopping-list offline replay (`apps/api/test/shopping.test.ts` "mutationId (offline replay safety)",
`apps/api/test/shopping-bought.test.ts` "a replayed mutationId appends no second row") passes unchanged; `git status
--porcelain repos/` empty; `apps/api/test/effect-idioms.test.ts` green with the recipe entries of rules (10) and (11)
removed; `bun run dev:api`-equivalent boot answers `/api/health` and SIGTERM ends with `[db] database closed`, `[api]
runtime disposed`, exit 0.

## 1. Context

### 1.1 State of the tree at plan time (`ddc48af87`, measured 2026-11-05)

- **E2 is done** (`docs/plans/e2-api-core-services.md` sections 9 and 10). `apps/api/src/runtime.ts` builds `AppLayer =
  Layer.suspend(appLayer)` with `appLayer()` = `Layer.mergeAll(coreServicesLayer(), ...moduleLayers()).pipe(
  Layer.provideMerge(infraLayer()))`, annotated `Layer.Layer<AppServices, AppLayerError, never>`; `AppServices =
  InfraServices | CoreServices`; `moduleLayers()` reads `API_MODULES` inside the function and is `[]` today.
  `apps/api/src/modules/types.ts` has the Effect contract `ApiModule` (hooks as Effects needing `Database`,
  `healthFeatures?()` SYNCHRONOUS, `layer?: ModuleLayer` with `ModuleLayer = Layer.Layer<never, never, AppConfig |
  DatabaseService>`, i.e. a module layer may output nothing yet) and the Promise contract `PromiseApiModule`.
  `apps/api/src/modules/index.ts` exports `API_MODULES`, a lazy `Proxy` over `[fromPromiseModule(recipeModule),
  fromPromiseModule(financeModule)]`. `apps/api/src/modules/adapter.ts` has `fromPromiseModule` and `runModuleHook`
  (never imports `runtime.ts`). `apps/api/src/core/health.ts` merges `module.healthFeatures?.()` synchronously.
- **The recipe module** (`apps/api/src/modules/recipe/`, 55 TS files): services 10532 lines, routes 1368 lines,
  `schema.ts`, `seed.ts`, `migrate.ts`, `index.ts`. Every service function takes the drizzle handle first (`db: DbLike`
  / `database: Database`), returns a `Promise` and throws `ApiError`: 63 `throw ApiError…` lines in 20 files (idioms
  rule (10) allows them by the prefix `apps/api/src/modules/recipe/`), 114 `ApiError` mentions in 22 files (returned
  values too: `SsrfError.toApiError()`, `ocr/index.ts` `tooManyError()`, `tesseract.ts` `unavailableError` /
  `failedError`, `pdf.ts` `noTextLayerError`). Time: `nowMs()` (from `core/services/households/support.ts`) in 11
  service files, `Date.now()` in 4 service files (`import/drafts.ts`, `import/ocr/index.ts`, `import/url/index.ts`,
  `import/commit.ts`; rule (11) allows them by the prefix `apps/api/src/modules/recipe/services/`) and outside
  `services/` in `seed.ts`, `schema.ts` (column defaults) and `routes/shopping.ts` (`parseSinceQuery`). 15
  `withTransaction(` calls. The routes import the shared `db` from `db/client.ts` (except `routes/imports.ts`, which goes
  through `services/import/db.ts` `importDb()`).
- **Recipe → core imports** (what the conversion replaces): `db` and the drizzle type (`db/client.ts`), `ApiError`,
  `support.ts` (`DbLike`, `withTransaction`, `nowMs`, `foldText`, `eqFolded`, `likeStoredFold`, `toCountMap`,
  `unique`), `assertCanModifyOwned` / `assertRole` (`households/membership.ts`, sync bridges), `toPublicUser`,
  `isUniqueViolation`, `keepOnlySentKeys` (pure), `storeUploadedImage` (Promise bridge), `thumbnailUrlFor`,
  `listImageUrlFor`, `THUMBNAIL_SUFFIX` (pure), `warmThumbnail` (void bridge), `IMPORT_RULE` + `enforceRateLimit` (sync
  bridge, three unawaited statements in `routes/imports.ts`), `isVerifiedEmailRequired` (sync bridge, only in
  `capabilities.ts` `serverFeatures()`, which nothing calls), `requireUser` / `requireMembership` (sync bridges), the
  middlewares, `env`, `signUploadUrl` / `normalizeStoredUploadUrl` / `toIso` (pure lib helpers).
- **Inside the module, the service graph** (who imports whom; it decides the waves, section 3): `recipes.service.ts` →
  `tags.service.ts`, `remoteImage.ts`; `collections.service.ts` → `recipes.service.ts`, `remoteImage.ts`;
  `plan.service.ts` → `recipes.service.ts`; `cookLog.ts` → `plan.service.ts`, `recipes.service.ts`;
  `shopping/items.service.ts` → `recipes.service.ts`, `lists.service.ts`, `idempotency.ts`, `bought.service.ts`;
  `shopping/bought.service.ts` → `items.service.ts` (`applyAdditions`) — **a cycle** between items and bought;
  `fromPlan.service.ts` → `plan.service.ts`, `lists.service.ts`; `import/commit.ts` → `remoteImage.ts`;
  `remoteImage.ts` → `import/url/image.ts`; `image.ts` → `fetch.ts`, `ssrf.ts`, `files.ts`, core `warmThumbnail`;
  `import/url/index.ts` → `fetch.ts`, `image.ts`; `import/ocr/index.ts` → `ocr/index.ts`, `ocr/pdf.ts`,
  `ocr/preprocess.ts`, `files.ts`.
- **Seams the tests use** (kept, P15): `setImportDbForTests` (`import/db.ts`), `setOcrImportEnabled`,
  `setPdfImportEnabled` (`import/capabilities.ts`), `setOcrEngine` (`ocr/index.ts`), `setPdfRasterizer`
  (`ocr/pdf.ts`), `setOcrConcurrencyForTests` (`ocr/index.ts`), `setRemoteImageDownloaderForTests`
  (`recipes/remoteImage.ts`), the core `setMailer`, `setVerifiedEmailRequired`, `resetRateLimits`.
- **Tests that call recipe code directly** (everything else goes through `app.request`):
  `apps/api/test/import/commit.test.ts` (`commitDraft`, `countRecipes`, `createDraft`, `getDraftOr404`, `listDrafts`,
  `updateDraft`, own file DB), `apps/api/test/import/ocr-disabled.test.ts` (PINNED: `createDraft(db, …)`,
  `importFromText`), `apps/api/test/import/routes.test.ts` (PINNED: seams and the core `createSession` bridge),
  `apps/api/test/import/ssrf.test.ts` (PINNED: `fetchHtml(url, { fetchImpl, resolve, maxBytes, maxRedirects })`,
  `assertPublicUrl`, `SsrfError`, the pure `isPrivate*` / `isBlockedHostname`), `apps/api/test/import/url-pipeline.test.ts`
  (`importFromUrl`, `downloadHeroImage` with a scripted `fetchImpl`), `apps/api/test/recipe-remote-image.test.ts`
  (`downloadHeroImage`, `localizeImageUrl`, the downloader seam), `apps/api/test/import/ocr-segment.test.ts` (62 tests:
  `importFromImage`, `importFromPdf`, `withOcrSlot`, `withOcrTimeout`, `ocrInFlight`, `ocrQueued`, `pdfToText` with a
  fake engine, `setPdfRasterizer`), `apps/api/test/import/pdf-rasterize.test.ts` (the real `pdftoppm`:
  `extractPdfTextLayer`, `rasterizePdf`, `pdfToText`), `apps/api/test/recipe-module.test.ts` (manifest fields, its own
  file DB, `backfillFoldedColumns(db)`, the core bridge `collectUploadReferences(db)`, `healthFeatures?.()` synchronous),
  `apps/api/test/recipes-search.test.ts` (`backfillFoldedColumns(db)` on the shared db),
  `apps/api/test/legacy-recipe.test.ts` (`backfillFoldedColumns(run.target.db)`, E5's), `apps/api/test/module-adapter.test.ts`
  (asserts the wrapped recipe manifest's fields), `apps/api/test/recipes-cooked.test.ts` (the constant
  `COOK_UNDO_WINDOW_MS` only). The pure parsers' tests (`url-extract`, `ocr-tesseract`) import pure functions only.
- **Outside callers of recipe code**: `apps/api/scripts/legacy/recipe.ts` (`backfillFoldedColumns(ctx.target.db)`,
  imported only after the `DATABASE_URL` redirect; CLAUDE.md "The CLI never imports `src/env.ts`"),
  `apps/api/scripts/localize-images.ts` (`isRemoteImageUrl`, `localizeImageUrl`), `apps/api/src/db/migrate.ts`
  (`afterMigrate` through `runModuleHook`), `apps/api/scripts/seed.ts` (`seedDemo` through `runModuleHook`),
  `apps/api/src/core/services/media/references.ts` (`uploadReferences`), `apps/api/src/index.ts` (`shutdown` through
  `runtime.runPromise`), `apps/api/src/core/health.ts` (`healthFeatures`).
- **Core bridges whose last outside caller is recipe** (E2 section 9.2 "Removed by E3"): `enforceRateLimit`,
  `storeUploadedImage`, `warmThumbnail`, `isVerifiedEmailRequired`, `assertCanModifyOwned`, `assertRole` (unused
  import), and `createSession` for the two import tests. The first six go in E3-T12 with their remaining core tests
  rewritten onto the services; `createSession` stays because the import route tests are pinned unchanged (section 7).
- **Effect API facts looked up for this plan** (vendored `effect@4.0.5`): `effect/http` exports `HttpClient`,
  `HttpClientRequest`, `HttpClientResponse`, `HttpClientError`, `FetchHttpClient`; `FetchHttpClient`'s client calls
  `fiber.getRef(Fetch)(url, { ...RequestInit, method, headers, body, signal })` with `url` a `URL`
  (`repos/effect/packages/effect/src/http/FetchHttpClient.ts` ~56-85), so `Effect.provideService(FetchHttpClient.Fetch,
  fetchImpl)` swaps the fetch per run and `FetchHttpClient.RequestInit` (a `Context.Service`, read from the fiber's
  context per request) carries `redirect: "manual"`; `HttpClient.make` adds `traceparent`/`b3` unless the reference
  `HttpClient.TracerPropagationEnabled` (`src/http/HttpClient.ts` ~1773) is `false`; `Effect.tryPromise`
  (`src/internal/effect.ts` ~1099) hands the thunk an `AbortSignal` that interruption aborts and does NOT await the
  abandoned promise, and catches a synchronous throw of the thunk; `Effect.timeoutOrElse` (`src/Effect.ts` ~4744),
  `Effect.acquireRelease`, `Effect.acquireUseRelease` (~6866), `Effect.forkDetach` (~8917), `Effect.catchCause`
  (~3333), `Effect.ignoreCause` (~4392) exist; `effect/process` (`ChildProcess`, `ChildProcessSpawner`) exists but is
  NOT used (P11).

### 1.2 Baseline

`bun test` at `ddc48af87`, 2026-11-05, load average about 3: **14658 pass, 0 fail, 383481 expect() calls, 14658 tests in
158 files, 30.52 s** (log ends `exit=0`). This equals E2's record (section 9.5 of the E2 plan). Every task verifies
`pass >= 14658` (P18); E3 adds tests, so the record at the end is higher.

### 1.3 Bundle size

Not asked for E3 (E6 and E7 record it). E3 touches no web file; `bun run build` is run by E3-T13 as a gate only.

## 2. Decisions (binding for the tasks)

Each names the `docs/EFFECT.md` decision it serves. A task that cannot follow one makes the smallest deviation and records
it in its commit body; E3-T13 copies it to section 10. Where a decision says "as E2 P<n>", the E2 plan's text
(`docs/plans/e2-api-core-services.md` section 2) applies verbatim with recipe paths.

**P1 — Bridges keep every outside caller working while the module converts (E3, E7; as E2 P1).** The services are
converted in dependency waves (section 3) and the routes last, so a converted file keeps, for every old export that a
caller OUTSIDE the task's own files still uses (a route, a not-yet-converted service, a script, a test that is not
rewritten in this task), a bridge with the old name and the old signature:
- it takes the old `db` / `database` first argument and honours it with `Database.withExecutor(db)` (never the root:
  a bridge called inside an unconverted `withTransaction(db, async (tx) => …)` must run on that `tx`, or the write
  waits on SQLite's lock against the open transaction);
- it keeps the calling convention, stated by an explicit return type copied from the old signature: a Promise export
  runs `runtime.runPromise(Service.use((s) => s.method(...)).pipe(Database.withExecutor(db)))`; a SYNCHRONOUS export
  (`assertOcrImportEnabled`, `assertPdfImportEnabled`, `assertAnyUploadImportEnabled`, `isOcrImportEnabled`,
  `isPdfImportEnabled`, `resolveUploadPath`, `storedFilenameOf`, …) stays synchronous over a service-free effect with
  `Effect.runSync` or stays a plain function; it holds no literal `throw`;
- it sits in the section `/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */`
  at the end of the file, each with a one-line comment naming its remaining callers;
- a bridge whose last caller moves is deleted in that commit when its file belongs to the task that moved the caller;
  otherwise it waits for E3-T13 (a dead bridge holds no `throw` and blocks no gate). E3-T13 deletes every bridge whose callers were only
  recipe routes, recipe services or rewritten tests. **The survivors after E3 are exactly** (section 9.2 of the record
  lists them with callers): `backfillFoldedColumns(database?)` (`apps/api/scripts/legacy/recipe.ts`, E5;
  `apps/api/test/legacy-recipe.test.ts`), `localizeImageUrl` (`apps/api/scripts/localize-images.ts`, E5),
  `createDraft(db, input)` (`apps/api/test/import/ocr-disabled.test.ts`, pinned, E8), the synchronous
  `importFromText(rawText, options)` (`apps/api/test/import/ocr-disabled.test.ts`, pinned, E8, and
  `apps/api/test/import/ocr-segment.test.ts`; P11), and the pinned-test entry points
  `fetchHtml(url, options)` and `assertPublicUrl(url, options)` (`apps/api/test/import/ssrf.test.ts`, pinned, E8; P10).
  Pure exports (`isRemoteImageUrl`, `extractRecipeFromHtml`, `parseRecipeText`, `toDraftWire`, the
  parsers, mappers and constants) are not bridges and stay.
A bridge imports `runtime.ts` and calls it only inside its body (CLAUDE.md "API import cycle"); `migrate.ts`'s bridge
uses `runModuleHook` instead (P5).

**The one tolerated `throw` in recipe code: the `NODE_ENV=test` guard of a test seam.** `setImportDbForTests`
(`import/db.ts`), `setRemoteImageDownloaderForTests` (`recipes/remoteImage.ts`) and the new `setImportGuardForTests`
(`import/url/fetch.ts`, P10) keep (or get) the first line `if (!env.isTest) throw new Error("<seam name> is only available
under NODE_ENV=test");`: a seam is called by tests outside any effect and stays a plain synchronous function, a production
caller must fail loudly, and dropping the guard would be a behaviour change. Every acceptance grep of the form "no `throw` …
outside comments and the bridge section" exempts exactly these lines by piping its output through `grep -v 'is only
available under NODE_ENV=test'`, so that message text is fixed. They are neither `ApiError` nor matched by idioms rule (10).

**P2 — Service conventions (E7, E12; as E2 P2).** One `Context.Service` class per service file, id
`"toon/api/modules/recipe/services/<path from services/ without .ts>/<Name>"` (e.g.
`"toon/api/modules/recipe/services/recipes/tags.service/RecipeTags"`), shape
`Context.Service<Self, { readonly method: (...) => Effect.Effect<A, E> }>()(id)`. **Method names are the old exported
function names with the leading `db` / `database` parameter dropped**; every other parameter, its order, its default and
the result type stay (`Promise<T>` becomes `Effect.Effect<T, E>`), so the route rewrite (E3-T10) is a table. Every method
is `Effect.fn("Name.method")(function* (...) { … })` (`Effect.fnUntraced` for per-row helpers); combinators as extra
arguments of `Effect.fn`, never `.pipe` on it; `return yield*` when raising; failures declared in the shape
(`Effect.Effect<Tag, NotFound | Conflict | DatabaseError>`). `static readonly layer = Layer.effect(this, Effect.gen(
function* () { const database = yield* Database; const tags = yield* RecipeTags; … return Name.of({ … }) }))`: the
static initializer reads no imported binding but `effect` exports and the class itself; dependencies are yielded inside
the generator; the layer leaves its requirements open (never `Layer.provide(Other.layer)` in a static, CLAUDE.md "One
composition point"); the ONE exception is `Layer.provide(FetchHttpClient.layer)` in `ImportHttp.layer` (an `effect/http`
export, P10). Time (P9) and the current executor are read inside the method body on every call. The database is reached
only through `database.use((db) => …)` and `database.transaction(effect)` (`apps/api/src/db/database.ts`); `withTransaction`
and `nowMs` are no longer called from recipe code after E3.

The service table (paths under `apps/api/src/modules/recipe/services/`; "layer file" is the area composition file of P4
that lists the service; the owning task converts the file and adds it to its layer file):

| File | Service | Depends on (inside the layer) | Layer file | Task |
| --- | --- | --- | --- | --- |
| `import/capabilities.ts` | `ImportCapabilities` | `AppConfig` | `import/layer.ts` | T01 |
| `ocr/index.ts` | `Ocr` | `AppConfig` | `ocr/layer.ts` | T02 |
| `ocr/pdf.ts` | `PdfText` | `AppConfig`, `Ocr` | `ocr/layer.ts` | T02 |
| `import/files.ts` | `ImportFiles` | `AppConfig` | `ocr/layer.ts` | T02 |
| `import/ocr/index.ts` | `OcrImporter` | `Ocr`, `PdfText`, `ImportFiles` | `ocr/layer.ts` | T02 |
| `import/url/fetch.ts` | `ImportHttp` | `AppConfig` (+ `FetchHttpClient.layer` provided inside) | `import/url/layer.ts` | T03 |
| `recipes/tags.service.ts` | `RecipeTags` | `Database` | `recipes/layer.ts` | T04 |
| `cards/cards.service.ts` | `Cards` | `Database` | `cards/layer.ts` | T04 |
| `shopping/lists.service.ts` | `ShoppingLists` | `Database` | `shopping/layer.ts` | T04 |
| `shopping/idempotency.ts` | `ShoppingMutations` | `Database` | `shopping/layer.ts` | T04 |
| `import/drafts.ts` | `ImportDrafts` | `Database` | `import/layer.ts` | T04 |
| `import/url/image.ts` | `HeroImages` | `ImportHttp`, `ImportFiles`, `Thumbnails` | `import/url/layer.ts` | T05 |
| `recipes/remoteImage.ts` | `RemoteImages` | `AppConfig`, `HeroImages` | `import/url/layer.ts` | T05 |
| `import/url/index.ts` | `UrlImporter` | `ImportHttp`, `HeroImages` | `import/url/layer.ts` | T05 |
| `recipes/recipes.service.ts` | `Recipes` | `Database`, `RecipeTags`, `RemoteImages` | `recipes/layer.ts` | T06 |
| `recipes/collections.service.ts` | `RecipeCollections` | `Database`, `Recipes`, `RemoteImages` | `recipes/layer.ts` | T06 |
| `import/commit.ts` | `ImportCommit` | `Database`, `RemoteImages` | `import/layer.ts` | T07 |
| `plan/plan.service.ts` | `MealPlan` | `Database`, `Recipes` | `plan/layer.ts` | T08 |
| `recipes/cookLog.ts` | `CookLog` | `Database`, `Recipes`, `MealPlan` | `plan/layer.ts` | T08 |
| `shopping/fromPlan.service.ts` | `ShoppingFromPlan` | `Database`, `MealPlan`, `ShoppingLists` | `plan/layer.ts` | T08 |
| `shopping/items.service.ts` | `ShoppingItems` | `Database`, `Recipes`, `ShoppingLists`, `ShoppingMutations` | `shopping/layer.ts` | T09 |
| `shopping/bought.service.ts` | `ShoppingBought` | `Database`, `ShoppingLists`, `ShoppingMutations` | `shopping/layer.ts` | T09 |

Files that stay plain modules (no service; pure or a seam): `recipes/mappers.ts`, `plan/mappers.ts`, `shopping/mappers.ts`,
`import/parsed.ts`, `import/times.ts`, `import/html/{entities,parse}.ts`, `import/ocr/{segment,quantity-fix}.ts`,
`import/url/{jsonld,microdata,meta,schema-map,sections}.ts`, `import/url/adapters/*.ts` (the schema-map and adapters are
pure code, the milestone goal), `ocr/types.ts` (the `OcrEngine` Promise interface: the test seam's contract, P11),
`ocr/tesseract.ts` (its pure `parseTesseractOutput` / `normalizeLangs` plus the scoped native run of P11 and the
`TesseractEngine` adapter), `ocr/preprocess.ts` (sharp, wrapped as a service-free `Effect.fnUntraced`, P11),
`import/url/ssrf.ts` (the guard: pure checks plus a service-free DNS effect, P10), `import/db.ts` (the import-DB seam,
P6). **Shared helpers across a service cycle** (`items.service.ts` `applyAdditions` ↔ `bought.service.ts`
`appendBoughtItem`, `pruneBoughtLog`): they become exported `Effect.fnUntraced` helpers whose requirement is `Database`
(not a service of the other file), provided inside the calling method with `Effect.provideService(Database, database)`
(the E2 pattern of `HouseholdModules` running a hook); no service depends on a service of its own cycle. Membership
checks: `assertCanModifyOwned(m, row)` → `yield* checkCanModifyOwned(m, row)` (`core/services/households/membership.ts`,
R = never); `assertRole` is dropped from `recipes.service.ts` (unused import).

**P3 — The module contract carries module services (E7; SPEC §2).** E3-T01 changes `apps/api/src/modules/types.ts`:
- `ModuleRequirements = InfraServices | CoreServices` (type-only imports from `apps/api/src/infra.ts` and
  `apps/api/src/core/services/layer.ts`): what a module layer may need.
- `ApiModule<Services = never>`: `layer?: Layer.Layer<Services, never, ModuleRequirements>`; every hook keeps its E2
  type (R = `Database`, error `HookError`) except `healthFeatures?(): Effect.Effect<Record<string, boolean>, never,
  AppConfig>` (an Effect now; the milestone goal), `start?()` and `shutdown?()` unchanged (`Effect<void, unknown>`).
- `apps/api/src/modules/index.ts` exports `type ModuleServices = RecipeServices` (type-only import from
  `./recipe/layer.ts`; E4 adds `FinanceServices`), and `API_MODULES` holds `recipeModule` UNWRAPPED plus
  `fromPromiseModule(financeModule)`; the lazy `Proxy` stays.
- `apps/api/src/runtime.ts`: `AppServices = InfraServices | CoreServices | ModuleServices`; `appLayer()` nests the
  modules OVER the core (a module may use core services): `Layer.mergeAll(...moduleLayers())` (with a leading
  `Layer.empty` if `mergeAll` needs one argument; look up `src/Layer.ts` `mergeAll`) `.pipe(Layer.provideMerge(
  coreServicesLayer()), Layer.provideMerge(infraLayer()))`, still annotated `Layer.Layer<AppServices, AppLayerError,
  never>`. **Typing (looked up for this plan):** `Layer`'s `ROut` is CONTRAVARIANT (`src/Layer.ts` ~103, `Variance<in ROut,
  out E, out RIn>`) and `mergeAll` wants at least one layer (~1275, a non-empty tuple). So a `Layer<RecipeServices, …>` is
  assignable to `Layer<never, …>` but not the other way round: the registry list stays typed `readonly ApiModule[]`
  (`Services = never`, which every manifest satisfies), and `moduleLayers()` returns `Layer.Layer<ModuleServices, never,
  ModuleRequirements>[]` with ONE documented cast (the registry is the place that knows which module brings which
  services). The compile-time guard sits at the manifest: `recipeModule: ApiModule<RecipeServices>` with `layer:
  Layer.suspend(recipeLayer)` fails `tsc` when `recipeLayer()` leaves a recipe service requirement open (`RIn` covariant,
  must be within `ModuleRequirements`) or does not output every service `RecipeServices` names (`ROut`); `runtime.ts` keeps its
  `never` requirement annotation for the whole `AppLayer`. T01 confirms both directions by a local experiment (not committed).
- `adapter.ts` `fromPromiseModule` wraps a synchronous Promise-module `healthFeatures` as `Effect.sync` (finance has
  none today); `core/health.ts` collects the modules' features with `Effect.forEach` in module order, merged after
  `verifiedEmailRequired` (same JSON key order as today: `verifiedEmailRequired`, `ocrImport`, `pdfImport`).
- `PromiseApiModule`, `fromPromiseModule` and `runModuleHook` stay for finance (E4) and for the core callers outside the
  runtime (`runMigrations`, `collectUploadReferences(database)`, `scripts/seed.ts`).
- `docs/SPEC.md` §2's code block and its "Hooks added after M0" paragraph are updated in the same commit (the `layer`
  output and `healthFeatures` as an Effect).

**P4 — One composition for the module, areas nested by dependency (E7; CLAUDE.md "One composition point").**
`apps/api/src/modules/recipe/layer.ts` (new, E3-T01, final form written once) exports `type RecipeServices` (the union of
the area types) and the hoisted `export function recipeLayer()`:
```ts
export function recipeLayer() {
  return planLayer().pipe(
    Layer.provideMerge(shoppingLayer()),
    Layer.provideMerge(recipesLayer()),
    Layer.provideMerge(Layer.mergeAll(importLayer(), cardsLayer())),
    Layer.provideMerge(urlImportLayer()),
    Layer.provideMerge(ocrLayer()),
  );
}
```
Each area function is a hoisted `export function` in its own file, with `export type <Area>Services` beside it; E3-T01
creates every one as `Layer.empty` with the type `never` (except `importLayer()`, which holds `ImportCapabilities` from
T01), and the owning task replaces the body and widens the type (owners per wave, section 3):
`services/ocr/layer.ts` `ocrLayer()` (T02: `Ocr`, `PdfText`, `ImportFiles`, `OcrImporter`), `services/import/url/layer.ts`
`urlImportLayer()` (T03: `ImportHttp`; T05: `HeroImages`, `RemoteImages`, `UrlImporter`), `services/import/layer.ts`
`importLayer()` (T01: `ImportCapabilities`; T04: `ImportDrafts`; T07: `ImportCommit`), `services/cards/layer.ts`
`cardsLayer()` (T04), `services/recipes/layer.ts` `recipesLayer()` (T04: `RecipeTags`; T06: `Recipes`,
`RecipeCollections`), `services/shopping/layer.ts` `shoppingLayer()` (T04: `ShoppingLists`, `ShoppingMutations`; T09:
`ShoppingItems`, `ShoppingBought`), `services/plan/layer.ts` `planLayer()` (T08: `MealPlan`, `CookLog`,
`ShoppingFromPlan`). Inside an area, a service that needs a sibling goes in an outer `Layer.provideMerge` step, never
beside it in one `Layer.mergeAll` (`mergeAll` feeds no member into another). The outer nesting above satisfies every
cross-area edge of the P2 table (`urlImportLayer` needs `ImportFiles` from `ocrLayer`; `importLayer` needs `RemoteImages`;
`recipesLayer` needs `RemoteImages`; `shoppingLayer` needs `Recipes`; `planLayer` needs `Recipes`, `ShoppingLists`); a
task whose service needs an edge the nesting lacks stops and reports it. The manifest exports the layer as
`layer: Layer.suspend(recipeLayer)` (`recipeLayer` is a hoisted function binding, initialized before any module code runs,
so this is TDZ-safe at the manifest's module scope).

**P5 — The hooks as Effects (E7; module doc 4a "Fold columns and the backfill").** In E3-T01:
- `afterMigrate: () => foldBackfill()`, where `apps/api/src/modules/recipe/migrate.ts` exports `foldBackfill =
  Effect.fn("RecipeModule.foldBackfill")(function* () { … })` (R = `Database`; the two SELECTs and the per-row UPDATEs
  through `database.use`; idempotent, NO transaction, returns the count as today) and keeps the bridge
  `backfillFoldedColumns(database: DrizzleDatabase = sharedDb): Promise<number>` = `runModuleHook(foldBackfill(),
  database)`. `migrate.ts` imports neither `runtime.ts` nor `env.ts` nor the manifest (`scripts/legacy/recipe.ts` imports
  it after the redirect; `apps/api/test/legacy-cli.test.ts` guards the order). Same idempotency, same count.
- `uploadReferences: () => recipeUploadReferences()` (an `Effect.fn` over `Database` with the same four columns and the
  same `typeof value === "string" && value.length > 0` filter; use `Predicate.isString`).
- `seedDemo: (context) => seedRecipeDemo(context)`: `seed.ts` keeps its body (the German demo content is content,
  `Date.now()` there is outside `services/`) behind `const database = yield* Database; yield* database.use((db) =>
  seedRecipeDemoOn(db, context))`; idempotent as today (`apps/api/scripts/seed.ts` runs it through `runModuleHook`).
- `healthFeatures: () => capabilityFlags` with `capabilityFlags: Effect<{ ocrImport, pdfImport }, never, AppConfig>`
  from `import/capabilities.ts` (P7).
- `shutdown: () => Effect.tryPromise({ try: () => shutdownOcr(), catch: (cause) => cause })` (the module-level engine
  state of `ocr/index.ts`; `index.ts` logs a failure as today). No `start`, no `onHouseholdCreated` / `onEnable` /
  `onMemberRemoving` (module doc 1.2).

**P6 — The import database seam stays (module doc 4a "Import route tests use real sessions").**
`services/import/db.ts` keeps `importDb()` and `setImportDbForTests(db | null)` (throws outside `NODE_ENV=test`) and gains
`withImportDb<A, E, R>(effect): Effect<A, E, R>`: when an override is installed it returns
`Database.withExecutor(override)(effect)`, otherwise `effect` unchanged (production: the runtime's root IS the shared
`db`). Services never call `importDb()`; every import route handler effect is wrapped once with `withImportDb(...)`
(E3-T11), so drafts, commit and the recipes the commit writes go to the file DB the pinned tests installed, exactly as
`createDraft(importDb(), …)` / `commitDraft(importDb(), …)` did. `Database.transaction` on that handed-in root opens a real
transaction on it (the runtime's `transactionsSupported` is true on the temp file DB).

**P7 — Capability flags from `AppConfig` (module doc 4b R20).** `ImportCapabilities` (`import/capabilities.ts`): methods
`ocrImportEnabled`, `pdfImportEnabled` (`Effect<boolean>`), `checkOcrImportEnabled`, `checkPdfImportEnabled`,
`checkAnyUploadImportEnabled` (`Effect<void, ApiFailure>`: `501 ocr_disabled` with exactly today's texts and the same
choice between `server.import.pdfDisabled` and `server.import.ocrDisabled`). The values come from `AppConfig`
(`ocrImportEnabled`, `pdfImportEnabled`, captured at build) overridden by the module-level seams
`setOcrImportEnabled` / `setPdfImportEnabled`, READ AT CALL TIME (a test flips them between requests). The service-free
`capabilityFlags` effect (R = `AppConfig`) serves `healthFeatures`. The sync exports `isOcrImportEnabled()`,
`isPdfImportEnabled()` stay (pure reads of `env` plus the seams; `recipe-module.test.ts` and `ocr-disabled.test.ts` read
them) and `assertOcrImportEnabled` / `assertPdfImportEnabled` / `assertAnyUploadImportEnabled` become sync bridges for
`routes/imports.ts` until E3-T11. `serverFeatures()` has no caller and is deleted (which leaves the core
`isVerifiedEmailRequired` bridge with a test caller only, P20).

**P8 — Errors (E6, E12; as E2 P4 and P2 "Catch-all stays catch-all").** Every recipe refusal becomes a family member with
the same status, code, text and details:

| Old | New |
| --- | --- |
| `throw ApiError.notFound(T)` / `ApiError.notFound()` | `return yield* new NotFound({ text: T })` / `new NotFound()` |
| `throw ApiError.badRequest(T, D?)` | `return yield* new BadRequest({ text: T, details: D })` (omit `details` when absent) |
| `throw ApiError.forbidden(T)` | `return yield* new Forbidden({ text: T })` |
| `throw ApiError.conflict(C, T)` | `return yield* new Conflict({ code: C, text: T })` |
| `throw ApiError.payloadTooLarge(T)` | `return yield* new PayloadTooLarge({ text: T })` |
| `throw ApiError.unsupportedMediaType(T)` | `return yield* new UnsupportedMediaType({ text: T })` |
| `throw ApiError.validationFailed(D, T?)` | `return yield* new ValidationFailed({ details: D, text: T })` |
| `throw new ApiError(S, C, T, D?)` / a returned `new ApiError(S, C, T, D)` | `new ApiFailure({ status: S, code: C, text: T, details: D })` (raised with `return yield*`, or returned as a value where the old code returned one) |
| `x instanceof ApiError` in module code | `isApiError(x)` (a `Predicate`, `lib/errors.ts`) or `Effect.catchTag(s)` |
| `try { insert } catch (e) { if (isUniqueViolation(e)) … else throw e }` | `database.use(…).pipe(Effect.catchTag("DatabaseError", (e) => isUniqueViolation(e.cause) ? <recovery> : Effect.fail(e)))` (the `DatabaseError` carries the driver error as `cause`) |

Types: `ErrorText` stays (`lib/errors.ts`); `SsrfError` becomes a `Schema.TaggedError` OUTSIDE the API family (fields
`reason: Schema.String`, `text` as `ApiFailure`'s `Text`; `message` = `serverText("en", text)`; keeps `instanceof
SsrfError` and `.reason` for the pinned test) whose mapping to `ApiFailure({ status: 400, code: "fetch_failed", text,
details: { reason } })` happens once, in `ImportHttp`. **Catch-all stays catch-all** (a synchronous throw inside a
generator and an `Effect.promise` rejection are defects that `Effect.catch` does not see): every site whose old code
caught everything keeps catching everything with `Effect.tryPromise` + `Effect.catchCause` / `Effect.ignoreCause`: the hero
image download (any failure → `undefined`), `localizeImageUrl` (any failure → the remote URL kept), the body
`cancel().catch(() => undefined)` calls, the temp-directory `rm(...).catch(() => undefined)` cleanups in `tesseract.ts` /
`pdf.ts`, `readFile(...).catch(() => "")` of the tesseract outputs, and the "delete the stored upload on ANY failure,
then rethrow" of `importFromImage` / `importFromPdf` (`Effect.onError` with the deletion; it sees failures, defects and
interruption; look up its signature in `src/Effect.ts`). After E3 no file under `apps/api/src/modules/recipe/` imports
`ApiError` (E3-T13 greps it).

**P9 — Time through `Clock` (E7, E12; as E2 P7).** Every `nowMs()` and every `Date.now()` in a recipe service becomes
`yield* Clock.currentTimeMillis`, read inside the method body; a duration (`durationMs: Date.now() - startedAt`) is the
difference of two such reads. The mappers stay pure (they format stored numbers with `toIso`). `seed.ts`, `schema.ts`
(`$defaultFn` column defaults) and `routes/shopping.ts` `parseSinceQuery` (a pure route helper, clamps a query value to the
wall clock) keep `Date.now()`: they are outside `services/` and outside rule (11); recorded, not converted.

**P10 — `ImportHttp`: the URL fetch through an `HttpClient` wrapped by the SSRF guard (E7, E12; module doc 4b R16, R18;
`agent-patterns/effect-http-client.md` 2(d), 2(e), 6).** In `import/url/fetch.ts` (E3-T03):
- `ImportHttp` shape: `fetchHtml(url: string, limits?: { timeoutMs?, maxBytes?, maxRedirects? }): Effect<FetchedHtml,
  ApiFailure>` and `fetchImage(url: string, options: { refererUrl?, timeoutMs?, maxBytes? }): Effect<Uint8Array |
  undefined>` (never fails: today's "no photo" contract, P8). `FetchedHtml` unchanged (`url`, `status`, `contentType`,
  `html`, `hops`).
- `ImportHttp.layer` = `Layer.effect(this, gen: config = yield* AppConfig; client = (yield* HttpClient.HttpClient) …)
  .pipe(Layer.provide(FetchHttpClient.layer))`. The guard options come from `AppConfig.allowPrivateImportHosts` (dev only,
  ignored in production by `config.ts`, the warning `[import] IMPORT_ALLOW_PRIVATE_HOSTS=1 — …` once as today) and the
  module-level test seam `setImportGuardForTests(options: { allowHosts?: readonly string[]; resolve?: Resolver } | null)`
  (new; its `NODE_ENV=test` guard is the tolerated seam `throw` of P1; read at call time; used by E3-T03's
  `import-http.test.ts` and E3-T13's local-fixture `app.request` test, never by a pinned test). **`allowHosts` is an
  exact-host allow list, not the escape hatch:** a URL whose lower-cased, bracket-stripped hostname is in the list passes
  after the scheme, credential and empty-host checks (as the escape hatch does, without its warning); EVERY OTHER hostname
  still runs every check (blocked names, `isPrivateAddress`, the numeric-host refusal, the DNS lookup and the private-record
  check), so a hop to `http://169.254.169.254/` is refused with `private_ip` before any request even while `127.0.0.1` is
  allowed. The seam deliberately has no `allowPrivateHosts`: under the escape hatch (`AppConfig.allowPrivateImportHosts`, dev
  only, unchanged) the guard returns right after the empty-host check and skips every host check, the metadata address
  included (`ssrf.ts` ~295), so a test driven through it could not prove a refusal and would send a real request to the
  link-local metadata address (a hang until the 10 s budget on a dev box, the real metadata endpoint on a cloud CI runner).
  The guard options of `checkPublicUrl(input, guard)` are therefore `{ allowPrivateHosts: boolean; allowHosts:
  ReadonlySet<string>; resolve?: Resolver; skipDns?: boolean }` (`allowHosts` empty unless the seam sets it; the escape
  hatch check keeps its place, the allow-list check sits beside it).
- The hop loop stays the module's own (NOT `HttpClient.followRedirects`, which re-validates nothing): per hop
  `checkPublicUrl(target, guard)` (the guard as a service-free `Effect.fnUntraced` in `ssrf.ts`: the same syntactic checks
  in the same order, then the DNS lookup through `Effect.tryPromise` of the injectable resolver, failing with
  `SsrfError(reason, text)` exactly as today), then ONE request through the client with `FetchHttpClient.RequestInit`
  `{ redirect: "manual" }` provided around the call, the same five request headers (`User-Agent`
  `IMPORT_USER_AGENT`, `Accept`, `Accept-Language: de-DE,de;q=0.9,en;q=0.6`, `Cache-Control: no-cache`, `Pragma:
  no-cache`), and `HttpClient.TracerPropagationEnabled` provided as `false` (no `traceparent`/`b3` to recipe sites:
  the request is byte-for-byte today's). 3xx without `Location` → `server.import.redirectNoLocation`; more than
  `maxRedirects` → `server.import.tooManyRedirects`; a relative `Location` resolves against the current hop; non-2xx →
  `server.import.pageHttpError` with `status`; a non-HTML-ish content type → `server.import.pageNotHtml` with the bare type;
  `Content-Length` over the cap → `server.import.pageTooLarge`; the body read from `response.stream` with a running byte
  count that stops (and so cancels the body) as soon as the cap is passed → `server.import.pageTooLarge`; decoding by the
  existing pure `decodeBody`. Every response that is not returned has its body discarded (pattern 6 "consume or discard").
- Failures: a `TransportError` → `server.import.pageLoadFailed` with `reason` = the cause's `message` when it is an
  `Error`, else `"network error"` (today's text); the 10 s overall budget is `Effect.timeoutOrElse` over the whole hop
  loop → `server.import.pageTimeout` (the interruption aborts the fetch through the client's signal); an `SsrfError` on
  any hop → `ApiFailure(400, fetch_failed, its text, { reason })`, and the blocked URL is never requested. All as
  `ApiFailure({ status: 400, code: "fetch_failed", … })`, so `instanceof ApiError`, `.status`, `.code`, `.text`,
  `.message` ("HTTP 404") hold for the pinned assertions.
- `fetchImage`: same guard for the FIRST URL only and `redirect: "follow"` (today's behaviour of `downloadHeroImage`),
  headers `User-Agent`, `Accept: image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8`, `Accept-Language:
  de-DE,de;q=0.9`, `Referer` when given; 8 s budget; non-2xx, a declared or actual size over 4 MB, an empty body, a guard
  refusal, any transport failure or defect → `undefined` (catch-all).
- **The pinned-test entry points stay Promise functions with today's signatures:** `fetchHtml(rawUrl, options:
  FetchHtmlOptions = {})` (with `fetchImpl`, `resolve`, `skipDns`, `timeoutMs`, `maxBytes`, `maxRedirects`) runs the
  SAME service-free core (`fetchHtmlWith(client, guard, limits)`) through `Effect.runPromise`, with `FetchHttpClient.layer`
  provided and `FetchHttpClient.Fetch` set to `options.fetchImpl ?? globalThis.fetch`; a failure rejects with the
  `ApiFailure` itself; `assertPublicUrl(input, options)` = `Effect.runPromise(checkPublicUrl(...))`, rejecting with the
  `SsrfError` itself. They read `env.allowPrivateImportHosts` (the `AppConfig` value) because they run outside the runtime.
  `apps/api/test/import/ssrf.test.ts` and `helpers.ts` stay byte-identical and green (the scripted fetch receives a `URL`
  as input and reads `init.headers`: both supported by the helper).

**P11 — OCR and PDF: scoped subprocesses, the engine seam, the gate and the hard timeout (E3, E7; module doc 4b R20, R22,
R23, R34).** In E3-T02:
- **The spawn primitive stays `Bun.spawn`, inside `Effect.acquireRelease`.** `effect/process`'s `ChildProcessSpawner`
  (Bun's re-export of the Node spawner) reports a missing binary as a `PlatformError` whose message differs from Bun's
  (`Executable not found in $PATH: "tesseract"`), and that message reaches the wire as `details.cause` of the documented
  `422 ocr_failed` / `422 pdf_no_text_layer`. So: acquire = `Effect.try(() => Bun.spawn([...], { stdin, stdout:
  "ignore", stderr: "pipe" }))` (a synchronous ENOENT → today's `unavailableError` / `noTextLayerError` with the same
  `cause` text); release = kill the child when it has not exited (this replaces the AbortSignal listener: an interrupted
  run, i.e. the hard timeout, kills `tesseract` / `pdftoppm` through the scope); stderr is read with `Effect.promise(() =>
  new Response(child.stderr).text())` or a `Stream` (`Stream.fromReadableStream` + `Stream.decodeText` + `Stream.mkString`);
  the exit code is compared and mapped exactly as today (`failedError` with `missingLanguage`, the last three stderr lines,
  200 characters). Temp directories: `Effect.acquireRelease(mkdtemp, rm … catch-all)`. **Where the scope closes:**
  each native run (one `tesseractRecognize`: temp directory, spawn, output reads; one poppler `rasterizePdf`: temp
  directory, spawn, page reads) is wrapped in its OWN `Effect.scoped(...)` (`src/Effect.ts` ~6617), and that scoped region
  sits INSIDE the `withOcrTimeout` / `Effect.timeoutOrElse` region, so the child is killed and the temp directory removed
  when that run ends: success, failure, or the timeout's interruption. `Scope` never reaches a service method's
  requirement (every method's shape type has R = `never`, so a forgotten `Effect.scoped` is a `tsc` error) and is never
  satisfied from a layer's scope (`Layer.effect` excludes `Scope`, `src/Layer.ts` ~1039; children and temp directories held
  there would live until `runtime.dispose()`, breaking R34's "the abandoned work is still aborted").
  `agent-patterns/effect-stream.md` §7 is corrected in the same task (its line "E3 turns them into a `ChildProcessSpawner` service" is wrong for this
  reason).
- **The engine seam stays a Promise interface.** `ocr/types.ts` `OcrEngine` (`recognize(input, options?): Promise<OcrResult>`,
  `shutdown(): Promise<void>`) is the contract of `setOcrEngine(engine)` and of `createFakeOcrEngine` in the pinned
  `helpers.ts`. `Ocr.recognize(bytes, options)` reads the module-level engine AT CALL TIME: with an override installed it
  runs `Effect.tryPromise({ try: (signal) => engine.recognize(prepared, { ...options, signal }), catch: (cause) => cause })`
  followed by one recovery: an API-family rejection (`isApiError`) stays a typed failure, unchanged; ANY OTHER rejection
  becomes a DEFECT carrying the original object (`Effect.die(cause)`), never a mapped `ApiFailure`. Today the raw error
  propagates (`apps/api/test/import/ocr-segment.test.ts` ~395 expects `rejects.toThrow("worker died")`) and the route
  answers `500 internal_error`; with the defect `Cause.squash` is the original error, `runPromise` rejects with it (the
  assertion holds unchanged) and `onErrorHandler` answers the same 500; P8's upload deletion (`Effect.onError`) sees defects
  too. Without an override it runs the native
  scoped program directly (`tesseractRecognize`, an `Effect.fnUntraced` in `tesseract.ts`). `TesseractEngine` stays as the
  Promise adapter (`recognize` = `Effect.runPromise(tesseractRecognize(...), { signal })`) for `getOcrEngine()`;
  `shutdownOcr()` keeps its Promise signature and semantics (drops and shuts down the current engine; the native engine
  holds no worker, so the hook is the formality the file's header describes; a fake engine counts `shutdownCalls`).
- **The hard timeout keeps its guarantee** (R34: "the client always gets an answer at `timeoutMs`, and the abandoned work
  is still aborted"): `withOcrTimeout(effect, timeoutMs, text)` becomes `Effect.timeoutOrElse` over an effect whose
  Promise parts are `Effect.tryPromise` (interruption aborts their signal and does not await them, section 1.1), failing
  with `ApiFailure({ status: 504, code: "ocr_failed", text, details: { timeoutMs } })`. `unpdf`'s `extractText` ignores the
  signal: it is wrapped in `Effect.tryPromise` too, so the 504 still arrives at the budget. The existing test that runs an
  operation which ignores its signal for 5 s under a 30 ms budget proves it; it must keep passing with its timing
  assertion. The module doc's R34 row is updated by E3-T13 to name the Effect form.
- **The concurrency gate stays the hand-written FIFO with the baton pass** (its waiter cap `MAX_WAITERS_PER_SLOT`, the
  `OCR_SLOT_WAIT_MS` wait, the immediate 429 when the queue is full, the slot handed to the next waiter on release,
  `IMPORT_OCR_CONCURRENCY` from `AppConfig`, `setOcrConcurrencyForTests`, `ocrInFlight()`, `ocrQueued()`). Its Effect
  form is `withOcrSlot(effect, waitMs?)` = `Effect.scoped(Effect.andThen(Effect.acquireRelease(acquireSlot(waitMs), () =>
  releaseSlot(), { interruptible: true }), effect))`. NOT `Effect.acquireUseRelease`: in effect@4.0.5 it runs the acquire
  inside `uninterruptibleMask` without `restore` (`src/internal/effect.ts` ~4405-4417), so an interrupt would never reach a
  queued waiter; `acquireRelease`'s `interruptible` option runs the acquire under `restore` (~4143-4157) and registers the
  release only once the acquire has succeeded. `acquireSlot` is an `Effect.callback` (`src/Effect.ts` ~1260) whose register
  takes a free slot at once; fails at once with today's `429 rate_limited` `server.ocr.tooManyConcurrentRecognitions`
  `{ maxConcurrent }` when the queue is full; otherwise enqueues a waiter `{ granted: false, resume }`, starts the
  `OCR_SLOT_WAIT_MS` timer (on expiry: dequeue, resume with the same 429) and RETURNS the cancel effect. The cancel effect
  (run when the waiting fiber is interrupted) clears the timer, removes the waiter while it is still queued, and, when the
  baton pass already set `granted = true` (the slot was handed over but the fiber was interrupted before its release was
  registered), hands that slot on with `releaseSlot()`. So an interrupted waiter leaves `ocrQueued()` at once and never
  leaks a slot; a waiter that is not interrupted is bounded by `OCR_SLOT_WAIT_MS` as today. `OCR_TIMEOUT_MS` starts after
  the slot is acquired, as today. E3-T02 adds ONE gate test to `ocr-segment.test.ts`: concurrency 1, the slot held, a
  waiter forked and interrupted (`Fiber.interrupt`): `ocrQueued()` is 0 right after the interrupt returns, `ocrInFlight()`
  stays 1, and the next waiter still gets the slot when the holder releases.
- `PdfText` (`ocr/pdf.ts`): `extractPdfTextLayer`, `rasterizePdf` (the `setPdfRasterizer` seam read at call time; the
  poppler path scoped as above), `pdfToText(bytes, options)` (the engine is `Ocr`'s current engine; the old explicit
  `engine` parameter of the Promise function is replaced by the seam, which is what every caller passes today).
  `preprocessImage` becomes a service-free `Effect.fnUntraced` with today's `ApiFailure` on an undecodable image.
- `OcrImporter` (`import/ocr/index.ts`): `importFromImage(bytes, options)`, `importFromPdf(bytes, options)` (the old
  `engine` option is replaced by the `setOcrEngine` seam, which the routes and tests already use; `mimeType`,
  `originalName`, `timeoutMs`, `maxPages`, `useTextLayer`, `store` stay) with the stored upload deleted on any failure (P8), durations from the `Clock` (P9), the same `sourceMeta` keys in the same
  order; `parseRecipeText` stays a pure function.
- **`importFromText` is not pure** (today: `throw ApiError.badRequest("server.import.pastedTextEmpty")` and two
  `Date.now()` reads for `durationMs`, `import/ocr/index.ts` ~199-213), and it must stay SYNCHRONOUS and keep throwing an
  `ApiError` instance: the pinned `ocr-disabled.test.ts` (~173) uses its return value directly and `ocr-segment.test.ts`
  (~366) asserts `toThrow(ApiError)`. Form: a module-level service-free `importFromTextEffect = Effect.fnUntraced(function*
  (rawText: string, options: TextPasteOptions = {}): Effect.fn.Return<TextImportResult, BadRequest> { … })` with today's
  steps in today's order (clamp the trimmed text; an empty text is `return yield* new BadRequest({ text:
  "server.import.pastedTextEmpty" })`; `parseRecipeText`; then `const startedAt = yield* Clock.currentTimeMillis` and
  `durationMs: (yield* Clock.currentTimeMillis) - startedAt`, both reads AFTER the parse as today). `OcrImporter` exposes it
  as the method `importFromText(rawText, options?)` (what `routes/imports.ts` yields from E3-T11 on), and the bridge section
  keeps the sync export `export function importFromText(rawText: string, options: TextPasteOptions = {}):
  TextImportResult { return Effect.runSync(importFromTextEffect(rawText, options)); }` with its callers named. `runSync`
  throws `Cause.squash` of the failure (`src/internal/effect.ts` ~5820-5830), i.e. the `BadRequest` itself, which is
  `instanceof ApiError`; the `Clock` is the default one, no service is needed. No `throw`, `ApiError` or `Date.now(` remains
  in the file, so E3-T02's grep, E3-T07's removal of the rule (11) entry, E3-T11's removal of the rule (10) entry and
  E3-T13's `ApiError` grep all hold without touching it again.

**P12 — Images (E7; module doc 4a "Remote images become local copies on write", 4b R18, R60).** In E3-T05:
`HeroImages.downloadHeroImage(imageUrl, options?)` (a `data:` URL decoded and stored, else `ImportHttp.fetchImage`, then
the magic-byte sniff, `ImportFiles.storeUpload`, and `Thumbnails.warm(filename)` started with `Effect.forkDetach` and its
cause ignored, never awaited: the old unawaited `warmThumbnail(...)`); `RemoteImages.localizeImageUrl(value, previous?)`
(the downloader seam `setRemoteImageDownloaderForTests` read at call time, its `NODE_ENV=test` guard kept as P1's tolerated
seam `throw`; under `NODE_ENV=test` the default downloader
stays offline, from `AppConfig.isTest`; a PATCH that sends back the unchanged remote URL is not retried; any failure keeps
the remote URL); `UrlImporter.importFromUrl(rawUrl, options?)` (the hero image is a candidate list with
`MAX_IMAGE_ATTEMPTS`, collected in `consider()` before the merge, R18; `extractRecipeFromHtml` stays pure). Every write path
keeps localizing BEFORE its transaction opens (`createRecipe`, `updateRecipe`, `commitDraft`, `createCollection`,
`updateCollection`).

**P13 — Shopping (E7; module doc 4a "The shopping list outbox is wired through the manifest", 4b R40, R47).** The merge
rule (`shoppingItemKey`, U+001F separator, `addAmounts`, `mergeNotes`, `mergeSourceIds`), the catalog ("Häufig gekauft"),
the bought log with its 90-day TTL and the `mutationId` ledger move unchanged: `ShoppingMutations.claimMutation` runs
INSIDE the same `database.transaction` as the write it guards (as `claimMutation(tx, …)` does today), so a replayed
`mutationId` applies once; the prunes (`pruneBoughtLog`, `pruneMutationLedger`) run where they run today. Every by-id read
keeps its `householdId` filter (D8).

**P14 — Routes on the runtime (E7, E8 order unchanged; as E2 P12).** Handler shape: `async (c) => { BODY }` becomes `(c)
=> runtime.runPromise(Effect.gen(function* () { BODY' }))` with the services yielded at the top of the generator and each
`await fn(db, args)` replaced by `yield* service.fn(args)`; `requireUser(c)` / `requireMembership(c)` → `yield*
currentUser(c)` / `yield* currentMembership(c)`; Hono context operations stay inside the generator; `await c.req.json()` /
`await c.req.formData()` (already validated or a plain read whose rejection was a 500) → `yield* Effect.promise(() =>
c.req.json())` / `yield* Effect.promise(() => c.req.formData())` (a rejection stays a defect, answered `500
internal_error` by `onErrorHandler` as before). Middleware arguments (`requireSession()`, `requireHouseholdRole("admin")`,
`requireVerifiedEmail()`, `validate(...)`), `c.req.valid(...)`, the mount order of `routes/index.ts` (imports, shopping
lists, plan, then the catch-all recipe router) and every `householdId` filter stay. Import routes (E3-T11): the whole
handler effect is wrapped with `withImportDb(...)` (P6); `enforceRateLimit(c, "import", user.id, IMPORT_RULE)` → `yield*
rateLimiter.enforce("import", user.id, IMPORT_RULE)` (the boundary mapper sets `Retry-After` for a `RateLimited`); the
order in the three upload handlers stays capability check → rate limit → body read (`ocr-disabled.test.ts` pins that a
disabled upload reads no body and spends no slot); `readJson` becomes an `Effect.fnUntraced` that maps a JSON parse
failure to `BadRequest({ text: "server.import.invalidJsonBody" })` and then `decode(schema, body)`; the
`/:draftId/source` response (`Bun.file`, the three headers) is unchanged. Cards (E3-T11): `routes/cards.ts` keeps
`requireSession()` and `requireVerifiedEmail()` and its raw-body decode (R32: `decode(...)` so the `Schema.SchemaError`
still ends in `toApiError` with `i18n`).

**P15 — Tests (E9; as E2 P14).** A recipe test that calls a converted function directly is rewritten onto the service in
the SAME task and file, keeping every assertion (status, code, text, rows, counts, timing bounds): `runTest(Svc.use((s) =>
s.method(...)))`, on another database `….pipe(Database.withExecutor(db))`, a refusal `await runTest(Effect.flip(effect))`
(`apps/api/test/support/effect.ts`). Seams stay and are handed back in `afterAll` / `afterEach` (never `mock.module`).
**Pinned, never edited in E3** (the exit criteria and E2's pins): `apps/api/test/import/routes.test.ts`,
`apps/api/test/import/ocr-disabled.test.ts`, `apps/api/test/import/ssrf.test.ts`, `apps/api/test/import/helpers.ts`,
`apps/api/test/recipe-cross-household.test.ts`, `apps/api/test/api-doc.test.ts`, `apps/api/test/middleware.test.ts`,
`apps/api/test/import-order.test.ts`, `apps/api/test/db-pragmas.test.ts`, `apps/api/test/placeholders.test.ts`,
`apps/api/test/security.test.ts`, and the `app.request`-only recipe tests `apps/api/test/recipes.test.ts`,
`apps/api/test/recipes-cooked.test.ts`, `apps/api/test/plan.test.ts`, `apps/api/test/cards.test.ts`,
`apps/api/test/tags-kind.test.ts`, `apps/api/test/shopping.test.ts`, `apps/api/test/shopping-bought.test.ts`,
`apps/api/test/shopping-from-plan.test.ts`, `apps/api/test/legacy-recipe.test.ts` (the V-PINNED check of P18). A task
whose conversion would need one of them changed stops and reports it. `bun test` never drops below 14658 passes.

**P16 — The idioms gate (E12).** `apps/api/test/effect-idioms.test.ts` is touched by exactly three tasks, each in a wave of
its own for that file:
- E3-T07 removes the entry `"apps/api/src/modules/recipe/services/": …` from `ALLOW_SERVICE_DATE` (rule (11)): the last
  four `Date.now()` sites under recipe `services/` (`import/drafts.ts` T04, `import/ocr/index.ts` T02,
  `import/url/index.ts` T05, `import/commit.ts` T07) are all converted on T07's branch (its dependencies), and the
  stale-entry test would fail on the next merge otherwise.
- E3-T11 removes `"apps/api/src/modules/recipe/": …` from `ALLOW_THROW_API_ERROR` (rule (10)): after the services (T02 to
  T09) the only `throw ApiError` lines left are in `routes/imports.ts` and `routes/cards.ts`, which T11 converts; T10's
  route files have none.
- E3-T13 widens the `nowMs(` scan of rule (11) from `apps/api/src/core/` to `apps/api/src/core/` plus
  `apps/api/src/modules/recipe/` (recipe reads the `Clock` after E3; a tightening, its "the rule bites" case unchanged), and
  states in the rule comments that only finance's entries remain (E4).
No task relaxes a rule; an entry leaves the list in the commit that makes it stale.

**P17 — Import cycle and TDZ (CLAUDE.md "API import cycle", "Middleware factories are TDZ-safe").** The cycle is now
`runtime.ts` → `modules/index.ts` → `recipe/index.ts` → `routes/*` → `services/*` → (`runtime.ts` for bridges, `database.ts`,
core services). Rules for every file of the module: nothing runs an effect or reads `API_MODULES` at module scope; static
`layer` initializers read only `effect` exports and their own class (P2); area layer files and `recipe/layer.ts` export
hoisted functions only; module-scope constants built with `Effect.fn` / `Effect.fnUntraced` read only `effect` at
definition; the manifest's `layer: Layer.suspend(recipeLayer)` reads a hoisted function binding. E3-T01 adds
`./src/modules/recipe/layer.ts` and `./src/modules/recipe/migrate.ts` to `apps/api/test/import-order-effect.test.ts`;
E3-T13 adds `./src/modules/recipe/services/recipes/recipes.service.ts`, `./src/modules/recipe/services/import/url/fetch.ts`
and `./src/modules/recipe/services/ocr/index.ts` (all three load first and build the `AppLayer` on the base tree, probed at
plan time). `apps/api/test/import-order.test.ts` stays pinned. **The route files are NOT entries.** Imported FIRST in a fresh
process, `./src/modules/recipe/routes/recipes.ts` and `./src/modules/recipe/routes/imports.ts` die ON THE BASE TREE
(`ReferenceError: Cannot access 'recipeRoutes' before initialization` at `routes/index.ts:27`, `importRoutes` at line 24,
reproduced at plan time): route file → middleware → `runtime.ts` → `modules/index.ts` → `recipe/index.ts` →
`routes/index.ts`, whose `.route(...)` chain reads the still-evaluating route binding at module scope. Making
`routes/index.ts` lazy is a router redesign (the manifest's `householdRouter` is read at its module scope and Hono copies a
sub-app's routes at `.route()` time), which belongs to E7, where HttpApi replaces the Hono routers. No route file is a real
entry point (the server and the tests import `src/index.ts`, the app or the manifest), `./src/modules/recipe/index.ts`
stays an entry and covers the route files in the real order, and the direct `runtime.ts` import E3-T10 and E3-T11 add to
the route files keeps the same cycle without making it worse. Section 7 item 9 records it; E3-T13 lists it in
`docs/open-work.md` for E7.

**P18 — Verification snippets.** Every task runs, among its own commands:
- V-SUITE: `cd /home/erics/software/toon-household && L=$(mktemp) && bun test > "$L" 2>&1; S=$?; tail -6 "$L"; [ $S -eq 0 ]
  && grep -oE '^ *[0-9]+ pass' "$L" | awk '{exit !($1 >= 14658)}'` (a failing run keeps its `(fail)` lines and any
  `Unhandled error` block in the log; CLAUDE.md "A test that runs sharp carries an explicit time budget").
- V-PINNED: `cd /home/erics/software/toon-household && git diff --quiet ddc48af87 -- apps/api/test/import/routes.test.ts
  apps/api/test/import/ocr-disabled.test.ts apps/api/test/import/ssrf.test.ts apps/api/test/import/helpers.ts
  apps/api/test/recipe-cross-household.test.ts apps/api/test/api-doc.test.ts apps/api/test/middleware.test.ts
  apps/api/test/import-order.test.ts apps/api/test/db-pragmas.test.ts apps/api/test/placeholders.test.ts
  apps/api/test/security.test.ts apps/api/test/recipes.test.ts apps/api/test/recipes-cooked.test.ts
  apps/api/test/plan.test.ts apps/api/test/cards.test.ts apps/api/test/tags-kind.test.ts apps/api/test/shopping.test.ts
  apps/api/test/shopping-bought.test.ts apps/api/test/shopping-from-plan.test.ts apps/api/test/legacy-recipe.test.ts
  docs/API.md apps/api/drizzle packages/shared apps/web`.
- V-TYPES: `cd /home/erics/software/toon-household && bun run typecheck`.
- V-IDIOMS: `cd /home/erics/software/toon-household && bun test apps/api/test/effect-idioms.test.ts`.
- V-REPOS: `cd /home/erics/software/toon-household && git status --porcelain repos/ | wc -l | grep -qx 0`.
- V-ORDER: `cd /home/erics/software/toon-household && bun test apps/api/test/import-order.test.ts
  apps/api/test/import-order-effect.test.ts apps/api/test/legacy-cli.test.ts`.

**P19 — Documentation (E3 goal "docs/modules/recipe.md … service names updated").** Owners: `docs/SPEC.md` §2 (E3-T01);
`agent-patterns/effect-services.md` §7 "As built (E3)" (E3-T01: the module layer and its nesting);
`agent-patterns/effect-stream.md` §7 (E3-T02: Bun.spawn as a scoped resource, why not the spawner);
`agent-patterns/effect-http-client.md` §7 (E3-T03: the guarded client as built); everything else in E3-T13:
`docs/modules/recipe.md` (1.2 hooks table as Effects; the service names beside the file names in 1.2 and in the 4a/4b rows
that name a function: R16, R18, R20, R22, R23, R34, R43, R45, R60; the "Import route tests use real sessions" gotcha names
`withImportDb`), `CLAUDE.md` (Status, Layout "Recipe services (E3)", the gotcha "Bridges until E3 to E5" survivors, the
idioms paragraph, the ADR line unchanged unless a new ADR exists), `docs/adr/0014-transitional-core-bridges.md` (the
survivors after E3: section 9.2), `docs/open-work.md` (the route-file import-order observation of P17, for E7), `agent-patterns/effect-{core,errors,testing,datetime-clock}.md` ("As built (E3)"
examples from the code), and this plan's sections 9 and 10. `docs/API.md` is not edited (no row changes).

**P20 — Core bridges whose last caller leaves (E7; ADR 0014).** E3-T12 deletes the core bridges `enforceRateLimit`
(`core/services/auth/rateLimit.ts`), `storeUploadedImage` (`media/uploads.ts`), `warmThumbnail` (`media/thumbnails.ts`),
`isVerifiedEmailRequired` (`auth/verifiedEmail.ts`), `assertCanModifyOwned`, `assertRole` (`households/membership.ts`)
and rewrites their remaining test callers onto the services in the same commit, keeping every assertion:
`apps/api/test/rate-limiter.test.ts` (the three `enforceRateLimit` cases of its block "the synchronous bridges" onto
`RateLimiter.enforce`; the enabled path is `RateLimiter.layer` over `AppConfig.layerFrom(PRODUCTION)`, exactly as the file's
"RateLimiter.enforce" block already does; `enforceIn` stays module-private and no test-enabled switch is added; `Retry-After`
comes from the mapper; E3-T12 spells out the mapping), `apps/api/test/uploads.test.ts` (lines ~537-541 onto `Uploads`),
`apps/api/test/thumbnails.test.ts` (the `warmThumbnail` case onto `Thumbnails.warm`), `apps/api/test/verified-email-gate.test.ts`
(the `isVerifiedEmailRequired()` read onto `VerifiedEmail.isRequired`). `createSession` stays (the pinned import tests,
section 7); `requireUser`, `requireMembership`, `initializeHousehold`, `enableModule` stay for finance (E4);
`collectUploadReferences(database)`, `trySendMail`, `findUserByEmail`, `createPasswordResetToken` stay for the scripts (E5);
`checkRateLimit`, `resetRateLimits`, `setMailer`, `claimPlaceholderUser` stay for the tests (E8).

## 3. Waves and file ownership

| Wave | Tasks (parallel inside a wave) |
| --- | --- |
| 1 | E3-T01 the module contract, the composition skeleton, the hooks, `ImportCapabilities`, `withImportDb` |
| 2 | E3-T02 OCR, PDF, `ImportFiles`, `OcrImporter`; E3-T03 `ImportHttp` (the guarded `HttpClient`); E3-T04 the database leaves (`RecipeTags`, `Cards`, `ShoppingLists`, `ShoppingMutations`, `ImportDrafts`) |
| 3 | E3-T05 `HeroImages`, `RemoteImages`, `UrlImporter` |
| 4 | E3-T06 `Recipes`, `RecipeCollections`; E3-T07 `ImportCommit` (and rule (11)'s recipe entry) |
| 5 | E3-T08 `MealPlan`, `CookLog`, `ShoppingFromPlan`; E3-T09 `ShoppingItems`, `ShoppingBought` |
| 6 | E3-T10 the recipe, plan and shopping routes on the runtime (rewrite); E3-T11 the import and card routes (and rule (10)'s recipe entry) |
| 7 | E3-T12 the core bridges of P20 deleted, their four test files rewritten onto the services |
| 8 | E3-T13 integration: recipe bridges pruned, the local-fixture URL import test, docs, the record |

Shared files and their owners (never two tasks of one wave): `apps/api/src/modules/recipe/services/import/layer.ts` T01,
T04, T07; `services/recipes/layer.ts` T01 (stub), T04, T06; `services/shopping/layer.ts` T01, T04, T09;
`services/import/url/layer.ts` T01, T03, T05; `services/ocr/layer.ts` T01, T02; `services/cards/layer.ts` T01, T04;
`services/plan/layer.ts` T01, T08; `apps/api/src/modules/recipe/layer.ts`, `apps/api/src/runtime.ts`,
`apps/api/src/modules/{types,index,adapter}.ts`, `apps/api/src/core/health.ts`, `docs/SPEC.md` T01 only;
`apps/api/test/effect-idioms.test.ts` T07, T11, T13; `apps/api/test/import-order-effect.test.ts` T01, T13;
`apps/api/test/import/ocr-segment.test.ts` T02 only; `apps/api/test/import/commit.test.ts` T07 only (it also moves the
`ImportDrafts` calls); `services/import/capabilities.ts` and `services/import/db.ts` T01 only;
`apps/api/src/modules/recipe/index.ts` T01 then T13 (comment only); `services/import/url/fetch.ts` T03 then T13 (bridge
section only), likewise every recipe service file's bridge section after its owner; `CLAUDE.md`, `docs/modules/recipe.md`,
`docs/open-work.md`, `docs/adr/0014-transitional-core-bridges.md` T13 only; the five core files of P20 and their four test
files (`rate-limiter`, `uploads`, `thumbnails`, `verified-email-gate`) T12 only. Each task's `files` list is exact.

Dependencies: T02, T03, T04 need T01; T05 needs T02, T03; T06 needs T04, T05; T07 needs T04, T05; T08 needs T04, T06; T09
needs T04, T06; T10 needs T04, T06, T08, T09; T11 needs T02 to T09; T12 needs T10 and T11 (and through them T01, T04,
T05, T06: the last recipe callers of the P20 bridges are `serverFeatures()` T01, `cards.service.ts` T04, `image.ts` T05,
`recipes.service.ts` / `collections.service.ts` T06, `routes/recipes.ts` T10, `routes/imports.ts` T11); T13 needs every
task.

## 4. Tasks

Every task reads first: `docs/EFFECT.md` §1 (E3, E5, E6, E7, E9, E12) and §2; this plan's section 2 (the decisions its brief
names) and section 3; `CLAUDE.md` "Vendored reference code" and the gotchas "One composition point", "Bridges until E3 to
E5", "Catch-all stays catch-all", "The error family and the one boundary mapper", "The `Database` service and the shared
client", "Hooks are Effects behind `fromPromiseModule`", "API import cycle", "Cross-household guard (D8)";
`docs/modules/recipe.md` section 4a (all eight bullets) and the 4b rows its brief names; `repos/effect/LLMS.md` (whole, once);
`agent-patterns/effect-core.md`, `agent-patterns/effect-services.md`, `agent-patterns/effect-errors.md`,
`agent-patterns/effect-testing.md`. Every Effect signature is looked up in `repos/effect/packages/effect/src/`, never
recalled (v4, not v3: `repos/effect/migration/v3-to-v4.md`). Every task ends with V-TYPES, V-IDIOMS, V-PINNED, V-REPOS and
V-SUITE (P18) and commits with a body naming the EFFECT.md decisions and the files served, ending with the harness's
`Co-Authored-By` line.

### E3-T01 — The module contract, the composition skeleton, the hooks as Effects (core)

Read: P2, P3, P4, P5, P6, P7, P17, P19; `apps/api/src/runtime.ts`, `apps/api/src/infra.ts`,
`apps/api/src/core/services/layer.ts`, `apps/api/src/modules/{types,index,adapter,mount}.ts`, `apps/api/src/core/health.ts`,
`apps/api/src/db/{database,migrate,client}.ts`, `apps/api/src/core/services/media/references.ts`,
`apps/api/scripts/{seed,uploads-gc}.ts`, `apps/api/scripts/legacy/recipe.ts` (lines 40-50, 360-370),
`apps/api/src/modules/recipe/{index,migrate,seed}.ts`, `apps/api/src/modules/recipe/services/import/{capabilities,db}.ts`,
`apps/api/src/config.ts` (the `ocrImportEnabled` / `pdfImportEnabled` / `isTest` fields), the tests
`apps/api/test/{recipe-module,recipes-search,module-adapter,modules,runtime,smoke,import-order-effect,legacy-cli}.test.ts`;
`docs/SPEC.md` §2; `docs/plans/e2-api-core-services.md` P3, P11 and section 10 items 2 and 5;
`repos/effect/packages/effect/src/Layer.ts` (`mergeAll`, `provideMerge`, `suspend`, the `Variance` interface),
`repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts`, `repos/effect/ai-docs/src/01_effect/03_services/`.

Work:
1. `apps/api/src/modules/types.ts`: `ModuleRequirements`, `ApiModule<Services = never>` with `layer?:
   Layer.Layer<Services, never, ModuleRequirements>` and `healthFeatures?(): Effect.Effect<Record<string, boolean>, never,
   AppConfig>` (P3); remove the old `ModuleLayer` alias or redefine it generically (every use updated). `PromiseApiModule`
   unchanged.
2. `apps/api/src/modules/adapter.ts`: wrap a Promise module's synchronous `healthFeatures` with `Effect.sync`.
3. `apps/api/src/modules/recipe/layer.ts` (new): `RecipeServices` and `recipeLayer()` exactly as P4; the seven area files
   (new) with their hoisted functions and `never` types; `services/import/layer.ts` holds `ImportCapabilities.layer`.
4. `apps/api/src/modules/index.ts`: `ModuleServices`; `recipeModule` unwrapped in the lazy list; the doc comment says
   finance is the one Promise manifest left (E4).
5. `apps/api/src/runtime.ts`: `AppServices` with `ModuleServices`; `appLayer()` nests the modules over the core (P3);
   `moduleLayers()` typed as P3 says; the doc comment updated. `AppLayer` stays annotated with requirement `never`.
6. `apps/api/src/core/health.ts`: `healthFeatures` through `Effect.forEach`, same key order; the effect's requirement stays
   within `AppServices`.
7. `services/import/capabilities.ts`: `ImportCapabilities` (P7) plus `capabilityFlags`, the seams, the sync reads, the three
   sync `assert…` bridges for `routes/imports.ts`; `serverFeatures()` deleted.
8. `services/import/db.ts`: `withImportDb` (P6).
9. `migrate.ts`: `foldBackfill` and the bridge `backfillFoldedColumns(database = sharedDb)` through `runModuleHook` (P5);
   its imports stay off `runtime.ts`, `env.ts` and the manifest.
10. `seed.ts`: the Effect `seedRecipeDemo(context)` over `database.use` (body unchanged; rename the Promise body
    `seedRecipeDemoOn(db, context)`), typed to accept the executor `DbExecutor`.
11. `recipe/index.ts`: `export const recipeModule: ApiModule<RecipeServices>` with `layer: Layer.suspend(recipeLayer)` and
    the hooks of P5 (`uploadReferences` as an `Effect.fn` over `Database` in this file or `migrate.ts`).
12. Tests, same files, every assertion kept: `recipe-module.test.ts` (`healthFeatures` through `runTest(recipeModule
    .healthFeatures!())`; `backfillFoldedColumns(db)` on its own file DB through `runTest(foldBackfill().pipe(
    Database.withExecutor(db)))`; the core `collectUploadReferences(db, modules?)` through `runTest(UploadReferences.use((r)
    => r.collectUploadReferences(modules)).pipe(Database.withExecutor(db)))`; the manifest field assertions unchanged);
    `recipes-search.test.ts` (`backfillFoldedColumns(db)` → `runTest(foldBackfill())`, the shared db);
    `module-adapter.test.ts` (the "wraps the two manifests" case: recipe is now the manifest itself, add
    `expect(recipe).toBe(recipeModule)` and keep the finance assertions; the test count stays);
    `import-order-effect.test.ts` gains `./src/modules/recipe/layer.ts` and `./src/modules/recipe/migrate.ts`.
13. `docs/SPEC.md` §2 (P3) and `agent-patterns/effect-services.md` §7 "As built (E3, E3-T01)" (the module layer, its
    nesting over the core, `Layer.suspend(recipeLayer)` at the manifest's module scope).

Files: `apps/api/src/modules/types.ts`, `apps/api/src/modules/adapter.ts`, `apps/api/src/modules/index.ts`,
`apps/api/src/runtime.ts`, `apps/api/src/core/health.ts`, `apps/api/src/modules/recipe/index.ts`,
`apps/api/src/modules/recipe/layer.ts`, `apps/api/src/modules/recipe/migrate.ts`, `apps/api/src/modules/recipe/seed.ts`,
`apps/api/src/modules/recipe/services/import/capabilities.ts`, `apps/api/src/modules/recipe/services/import/db.ts`,
`apps/api/src/modules/recipe/services/import/layer.ts`, `apps/api/src/modules/recipe/services/ocr/layer.ts`,
`apps/api/src/modules/recipe/services/import/url/layer.ts`, `apps/api/src/modules/recipe/services/recipes/layer.ts`,
`apps/api/src/modules/recipe/services/cards/layer.ts`, `apps/api/src/modules/recipe/services/shopping/layer.ts`,
`apps/api/src/modules/recipe/services/plan/layer.ts`, `apps/api/test/recipe-module.test.ts`,
`apps/api/test/recipes-search.test.ts`, `apps/api/test/module-adapter.test.ts`, `apps/api/test/import-order-effect.test.ts`,
`docs/SPEC.md`, `agent-patterns/effect-services.md`.

Acceptance: `/api/health` answers the same JSON (keys and order) under `bun test` (`smoke.test.ts`, `runtime.test.ts`
unchanged and green); `bun run db:migrate` on a fresh temp DB exits 0 and the fold backfill runs (the `recipe-module.test.ts`
backfill cases); `legacy-cli.test.ts` green (the import order of `migrate-legacy.ts` holds with the new `migrate.ts`);
`grep -nE 'fromPromiseModule\(recipeModule' apps/api/src/modules/index.ts` empty; a deliberately unsatisfied requirement in
`recipe/layer.ts` and a service missing from it (both tried locally, not committed) are `tsc` errors at the manifest's `layer`.

Verify: V-TYPES, `cd /home/erics/software/toon-household && bun test apps/api/test/recipe-module.test.ts
apps/api/test/recipes-search.test.ts apps/api/test/module-adapter.test.ts apps/api/test/modules.test.ts
apps/api/test/runtime.test.ts apps/api/test/smoke.test.ts apps/api/test/import/ocr-disabled.test.ts
apps/api/test/import/routes.test.ts`, V-ORDER, V-IDIOMS, V-PINNED, V-REPOS, V-SUITE.

### E3-T02 — OCR, PDF, `ImportFiles` and `OcrImporter` (build)

Read: P1, P2, P8, P9, P11, P15; `agent-patterns/effect-stream.md` (whole), `agent-patterns/effect-datetime-clock.md` §2.1;
`repos/effect/ai-docs/src/01_effect/05_resources/`, `repos/effect/ai-docs/src/60_child-process/` (to understand why it is
not used); `repos/effect/packages/effect/src/Effect.ts` (`acquireRelease`, `acquireUseRelease`, `callback`,
`timeoutOrElse`, `onError`, `tryPromise`, `runPromise` options); `docs/modules/recipe.md` 4b R20, R21, R22, R23, R34,
R70; the files `apps/api/src/modules/recipe/services/ocr/{index,tesseract,pdf,preprocess,types}.ts`,
`services/import/files.ts`, `services/import/ocr/index.ts` (and its pure siblings `segment.ts`, `quantity-fix.ts`),
`routes/imports.ts` (the callers you must keep working through bridges), `apps/api/src/core/services/media/thumbnails.ts`
(`THUMBNAIL_SUFFIX`); tests `apps/api/test/import/{ocr-segment,pdf-rasterize,ocr-tesseract,helpers}.ts`.

Work: convert `ocr/index.ts` to `Ocr` (`recognize`, `withOcrSlot`, `withOcrTimeout`, `shutdown` semantics of P11, the
module-level engine and gate kept with their seams and diagnostics), `ocr/pdf.ts` to `PdfText`, `ocr/tesseract.ts` to the
scoped native run plus the `TesseractEngine` adapter, `ocr/preprocess.ts` to a service-free effect, `import/files.ts` to
`ImportFiles` (`readUploadedFile`, `storeUpload`, `deleteUpload`, `resolveUploadPath`, with `sniffMimeType`,
`extensionFor`, the MIME lists as pure exports; the upload directory from `AppConfig.uploadDir`), `import/ocr/index.ts` to
`OcrImporter` (P11, P8 "delete on any failure", P9 durations; `importFromText` exactly as P11's last bullet: the
service-free `importFromTextEffect`, the `OcrImporter.importFromText` method and the synchronous `Effect.runSync` export in
the bridge section). The engine call as P11 (an API-family rejection stays typed, anything else is a defect carrying the
original error); the gate as P11 (`Effect.acquireRelease` with `{ interruptible: true }` inside `Effect.scoped`, the cancel
effect with the granted-slot hand-back; no `acquireUseRelease`); every native run in its own `Effect.scoped` inside the
timeout region (P11). Add the four services to `ocrLayer()` with the internal nesting
(`OcrImporter` over `PdfText` over `Ocr`, `ImportFiles` beside `Ocr`) and widen `OcrServices`. Bridges (P1) for every export
`routes/imports.ts` and `services/import/url/image.ts` still call (`readUploadedFile`, `storeUpload`, `deleteUpload`,
`resolveUploadPath`, `importFromImage`, `importFromPdf`, `withOcrSlot` as Promise functions with today's signatures; the
`withOcrSlot(operation: () => Promise<T>, waitMs?)` bridge drives the same module-level gate). `shutdownOcr()` keeps its
signature (the manifest's `shutdown` hook calls it, P5). Rewrite `ocr-segment.test.ts` and `pdf-rasterize.test.ts` onto the
services (every assertion kept; the gate tests keep their `ocrInFlight()` / `ocrQueued()` reads and timing; the
signal-ignoring timeout test keeps its bound; the "worker died" case keeps `rejects.toThrow("worker died")` with the fake
engine installed through `setOcrEngine`; the `importFromText` cases keep calling the synchronous export, `toThrow(ApiError)`
unchanged; `setPdfRasterizer` and `setOcrEngine` handed back as today) and add ONE gate test, the interrupted waiter of
P11. Correct
`agent-patterns/effect-stream.md` §7 (P11).

Files: `apps/api/src/modules/recipe/services/ocr/index.ts`, `apps/api/src/modules/recipe/services/ocr/pdf.ts`,
`apps/api/src/modules/recipe/services/ocr/tesseract.ts`, `apps/api/src/modules/recipe/services/ocr/preprocess.ts`,
`apps/api/src/modules/recipe/services/ocr/layer.ts`, `apps/api/src/modules/recipe/services/import/files.ts`,
`apps/api/src/modules/recipe/services/import/ocr/index.ts`, `apps/api/test/import/ocr-segment.test.ts`,
`apps/api/test/import/pdf-rasterize.test.ts`, `agent-patterns/effect-stream.md`.

Acceptance: no `throw`, `ApiError`, `Date.now(` or `nowMs(` left in the seven source files (`grep -nE
'\bthrow\b|ApiError|Date\.now|nowMs\(' …` empty except comments); `Bun.spawn` appears only inside an `Effect.acquireRelease`
acquire, each such acquire runs inside an `Effect.scoped` that sits within the timeout region (no service method's shape
names `Scope`); `grep -n acquireUseRelease apps/api/src/modules/recipe/services/ocr/index.ts` empty; `importFromText` stays
synchronous (`export function importFromText(…): TextImportResult` whose body is one `Effect.runSync(...)`);
`routes.test.ts` (fake engine, the three upload routes) and `ocr-disabled.test.ts` green unchanged; `pdf-rasterize.test.ts`
green with the real `pdftoppm` and its test count unchanged; `ocr-segment.test.ts` at its old count plus exactly one (the
interrupted waiter: `ocrQueued()` 0 right after the interrupt, the slot still handed on); `ocr-tesseract.test.ts`
unchanged.

Verify: V-TYPES, `cd /home/erics/software/toon-household && bun test apps/api/test/import`, V-ORDER, V-IDIOMS, V-PINNED,
V-REPOS, V-SUITE.

### E3-T03 — `ImportHttp`: the guarded `HttpClient` (build)

Read: P1, P2, P8, P10, P15; `agent-patterns/effect-http-client.md` (whole); `repos/effect/LLMS.md` "Effect HttpClient";
`repos/effect/ai-docs/src/50_http-client/10_basics.ts`; `repos/effect/packages/effect/src/http/{HttpClient,FetchHttpClient,
HttpClientRequest,HttpClientResponse,HttpClientError}.ts` (`make`, `execute`, `TracerPropagationEnabled`, `RequestInit`,
`Fetch`, `stream`, the error reasons); `repos/effect/packages/effect/test/HttpClient.test.ts`; `docs/modules/recipe.md` 4b
R16, R18; the files `services/import/url/{ssrf,fetch,image,index}.ts` (image and index are T05's, read for the callers you
keep working), `apps/api/src/config.ts` (`allowPrivateImportHosts`); tests `apps/api/test/import/{ssrf,helpers,url-pipeline}.ts`.

Work: `ssrf.ts`: `SsrfError` as a `Schema.TaggedError` outside the family (P8), `checkPublicUrl(input, guard)` as a
service-free `Effect.fnUntraced` (identical checks, order, reasons and texts; the DNS lookup through `Effect.tryPromise` of
`guard.resolve ?? defaultResolve`), `assertPublicUrl` as the Promise entry point (P10), the pure exports unchanged.
`fetch.ts`: the service-free core `fetchHtmlWith`, the `ImportHttp` service and layer (P10, including `fetchImage` for T05),
the seam `setImportGuardForTests` with its exact-host `allowHosts` list and its `NODE_ENV=test` guard (P10, P1), the Promise
entry point `fetchHtml` with today's `FetchHtmlOptions`. Add `ImportHttp` to
`urlImportLayer()` and widen `UrlImportServices`. New test file `apps/api/test/import/import-http.test.ts`: the service path
with `FetchHttpClient.Fetch` provided as a scripted fetch (the `createScriptedFetch` / `createResolver` helpers): the five
request headers and NO `traceparent` / `b3` header, a public redirect followed, a redirect into `169.254.169.254` refused
without a second request, the streamed body cap, `fetchImage` answering `undefined` for a 404, a non-image type, a refusal
and a thrown fetch, and the seam: `setImportGuardForTests({ allowHosts: ["127.0.0.1"] })` lets `http://127.0.0.1:<port>/`
through, while `http://127.0.0.2/` and a redirect from the allowed host into `http://169.254.169.254/` are still refused
with the reasons the guard gives today and without any request to the refused URL (the scripted fetch's call log); the seam
is handed back with `null` in `afterEach`; its throw outside `NODE_ENV=test` is not testable in-process and is not asserted. Correct `agent-patterns/effect-http-client.md` §7 to the
code as built.

Files: `apps/api/src/modules/recipe/services/import/url/ssrf.ts`, `apps/api/src/modules/recipe/services/import/url/fetch.ts`,
`apps/api/src/modules/recipe/services/import/url/layer.ts`, `apps/api/test/import/import-http.test.ts`,
`agent-patterns/effect-http-client.md`.

Acceptance: `ssrf.test.ts` and `helpers.ts` byte-identical and green (V-PINNED); `url-pipeline.test.ts` green unchanged (it
still calls `importFromUrl` / `downloadHeroImage`, which call the `fetchHtml` entry point until T05); no `throw`,
`ApiError` or `fetch(` call left in `fetch.ts` and `ssrf.ts` outside comments, the seam's `NODE_ENV=test` guard line excepted (P1: `grep -nE '\bthrow\b|ApiError|\bfetch\(' … | grep -v
'is only available under NODE_ENV=test'`; `globalThis.fetch` as the default of the `Fetch` reference is the one mention);
`allowHosts` skips the host checks only for a listed hostname (the new test's 169.254.169.254 case); no import of `effect/unstable` (idioms).

Verify: V-TYPES, `cd /home/erics/software/toon-household && bun test apps/api/test/import/ssrf.test.ts
apps/api/test/import/import-http.test.ts apps/api/test/import/url-pipeline.test.ts apps/api/test/import/routes.test.ts`,
V-ORDER, V-IDIOMS, V-PINNED, V-REPOS, V-SUITE.

### E3-T04 — The database leaves: `RecipeTags`, `Cards`, `ShoppingLists`, `ShoppingMutations`, `ImportDrafts` (build)

Read: P1, P2, P8, P9, P13, P15; `agent-patterns/effect-datetime-clock.md` §2.1 and "As built (E2)"; the E2 example
`apps/api/src/core/services/households/modules.ts` (a service with `database.use` / `database.transaction`, its bridges);
`apps/api/src/db/database.ts`; `apps/api/src/core/services/households/membership.ts` (`checkCanModifyOwned`);
`docs/modules/recipe.md` 4b R40, R43, R44, R45, R47; the files `services/recipes/tags.service.ts`,
`services/cards/cards.service.ts`, `services/shopping/{lists.service,idempotency,mappers}.ts`, `services/import/drafts.ts`, and
their callers (`routes/*.ts`, `services/recipes/recipes.service.ts`, `services/shopping/{items,bought,fromPlan}.service.ts`,
`services/import/commit.ts`, `apps/api/test/import/{commit,ocr-disabled}.test.ts`) for the bridge list.

Work: convert the five files to the five services of the P2 table (methods = the old exported functions without `db`;
`nowMs()` → `Clock`; `Date.now()` in `drafts.ts` → `Clock`; refusals per P8; `assertCanModifyOwned` → `checkCanModifyOwned`;
`ShoppingMutations.claimMutation` keeps running on the CURRENT executor, so a caller's open transaction is the one it writes
in; `hasAppliedMutation`, `pruneMutationLedger` likewise; `ImportDrafts.getDraftOr404` keeps its `householdId` filter (D8),
`toDraftWire` and `storedFilenameOf` stay pure exports). Bridges (P1) for every old export a route, an unconverted service
or a test still calls (e.g. `loadTagRow`, `getOrCreateTagIds`, `tagsByRecipe` for `recipes.service.ts` and `commit.ts`;
`loadShoppingListRow`, `getShoppingListDetail`, `countListItems` for the shopping services; `claimMutation`,
`pruneMutationLedger` for `items` / `bought`; `createDraft`, `getDraftOr404`, `listDrafts`, `updateDraft`, `deleteDraft` for
`routes/imports.ts` and the import tests); measure the list with `grep -rn` over `apps/api/src`, `apps/api/scripts`,
`apps/api/test`. Fill `recipesLayer()` (`RecipeTags`), `cardsLayer()` (`Cards`), `shoppingLayer()` (`ShoppingLists`,
`ShoppingMutations`), and add `ImportDrafts` to `importLayer()`; widen the area types.

Files: `apps/api/src/modules/recipe/services/recipes/tags.service.ts`, `apps/api/src/modules/recipe/services/cards/cards.service.ts`,
`apps/api/src/modules/recipe/services/shopping/lists.service.ts`, `apps/api/src/modules/recipe/services/shopping/idempotency.ts`,
`apps/api/src/modules/recipe/services/import/drafts.ts`, `apps/api/src/modules/recipe/services/recipes/layer.ts`,
`apps/api/src/modules/recipe/services/cards/layer.ts`, `apps/api/src/modules/recipe/services/shopping/layer.ts`,
`apps/api/src/modules/recipe/services/import/layer.ts`.

Acceptance: no `throw`, `ApiError`, `nowMs(`, `Date.now(`, `withTransaction(` or `assertCanModifyOwned` left in the five
source files outside comments and the bridge section; `cards.test.ts`, `tags-kind.test.ts`, `shopping*.test.ts`,
`recipe-cross-household.test.ts`, `import/commit.test.ts`, `import/ocr-disabled.test.ts`, `import/routes.test.ts` green
unchanged.

Verify: V-TYPES, `cd /home/erics/software/toon-household && bun test apps/api/test/cards.test.ts apps/api/test/tags-kind.test.ts
apps/api/test/shopping.test.ts apps/api/test/shopping-bought.test.ts apps/api/test/shopping-from-plan.test.ts
apps/api/test/recipe-cross-household.test.ts apps/api/test/import`, V-ORDER, V-IDIOMS, V-PINNED, V-REPOS, V-SUITE.

### E3-T05 — `HeroImages`, `RemoteImages`, `UrlImporter` (build)

Read: P1, P2, P8, P9, P10, P12, P15; `agent-patterns/effect-http-client.md` §2(d), §6; `agent-patterns/effect-errors.md`
(catch-all); `docs/modules/recipe.md` 4a "Remote images become local copies on write", 4b R16, R17, R18, R60; the files
`services/import/url/{image,index,fetch,ssrf}.ts`, `services/recipes/remoteImage.ts`, `services/import/files.ts` (T02's
`ImportFiles`), `apps/api/src/core/services/media/thumbnails.ts` (`Thumbnails.warm`), and the callers of the old exports
(`services/recipes/{recipes,collections}.service.ts`, `services/import/commit.ts`, `apps/api/scripts/localize-images.ts`);
tests `apps/api/test/import/url-pipeline.test.ts`, `apps/api/test/recipe-remote-image.test.ts`,
`apps/api/test/import/url-extract.test.ts` (pure, unchanged), the fixtures under `apps/api/test/fixtures/import/`.

Work: `image.ts` → `HeroImages.downloadHeroImage` (P12: `data:` URLs, `ImportHttp.fetchImage`, sniff, `ImportFiles.storeUpload`,
the detached thumbnail warm through `Thumbnails`; the core `warmThumbnail` bridge is no longer called from here);
`remoteImage.ts` → `RemoteImages.localizeImageUrl` (the seam and the offline default under test kept, P12) with
`isRemoteImageUrl` pure; `url/index.ts` → `UrlImporter.importFromUrl` (via `ImportHttp.fetchHtml` and `HeroImages`; the
`Date.now()` durations through the `Clock`; the hero image candidate list unchanged). Add the three to `urlImportLayer()` with
the nesting (`RemoteImages` and `UrlImporter` over `HeroImages` over `ImportHttp`); widen the type. Bridges (P1):
`localizeImageUrl(value, previous?)` (callers `recipes.service.ts`, `collections.service.ts`, `commit.ts` until T06/T07;
`apps/api/scripts/localize-images.ts`, E5), `downloadHeroImage` only if a caller outside remains (none after the test rewrite:
delete it then). Rewrite `url-pipeline.test.ts` and `recipe-remote-image.test.ts` onto the services: the scripted fetch of
the old `fetchImpl` option becomes `FetchHttpClient.Fetch` provided around the run (or a test layer of `ImportHttp` built
with the scripted fetch and resolver); every assertion kept.

Files: `apps/api/src/modules/recipe/services/import/url/image.ts`, `apps/api/src/modules/recipe/services/import/url/index.ts`,
`apps/api/src/modules/recipe/services/recipes/remoteImage.ts`, `apps/api/src/modules/recipe/services/import/url/layer.ts`,
`apps/api/test/import/url-pipeline.test.ts`, `apps/api/test/recipe-remote-image.test.ts`.

Acceptance: no `throw`, `ApiError`, `Date.now(`, `warmThumbnail` or `fetch(` left in the three source files outside
comments and bridge sections, the `NODE_ENV=test` guard of `setRemoteImageDownloaderForTests` excepted (P1: the grep's output
piped through `grep -v 'is only available under NODE_ENV=test'`); the image download still follows redirects (`redirect: "follow"`) with the guard on the first
URL only (today's behaviour, P10); the test counts of the two rewritten files unchanged; `recipes.test.ts`,
`recipe-cross-household.test.ts`, `import/routes.test.ts`, `import/ssrf.test.ts` green unchanged.

Verify: V-TYPES, `cd /home/erics/software/toon-household && bun test apps/api/test/import apps/api/test/recipe-remote-image.test.ts
apps/api/test/recipes.test.ts apps/api/test/recipe-cross-household.test.ts`, V-ORDER, V-IDIOMS, V-PINNED, V-REPOS, V-SUITE.

### E3-T06 — `Recipes` and `RecipeCollections` (build)

Read: P1, P2, P8, P9, P12, P15; the E2 examples `apps/api/src/core/services/households/households.service.ts` (a large
service with transactions) and `modules.ts`; `apps/api/src/db/database.ts` (`transaction`: inline inside an open one, a
savepoint on a handed-in transaction, sequential on `:memory:`); `docs/modules/recipe.md` 4a "Fold columns and the
backfill", "Remote images become local copies on write", 4b R43, R44, R45; the files
`services/recipes/{recipes.service,collections.service,mappers,tags.service,remoteImage}.ts`; the callers of the old exports
(`routes/recipes.ts`, `services/plan/plan.service.ts`, `services/recipes/cookLog.ts`, `services/shopping/items.service.ts`);
tests `apps/api/test/{recipes,recipes-search,recipes-cooked,recipe-cross-household,tags-kind}.test.ts` (unchanged).

Work: `recipes.service.ts` → `Recipes` (`loadRecipeRow`, `buildRecipeListItems`, `listRecipes`, `getRecipeDetail`,
`createRecipe`, `updateRecipe`, `deleteRecipe`, `setRecipeImage`, `scaleRecipe`, `assertCanModifyRecipe` as an Effect
check; `buildIngredientRows`, `buildStepRows`, `deriveTotalMinutes` stay pure exports); localization through `RemoteImages`
BEFORE `database.transaction` (P12); folds written with `foldText` on every write (the pre-folded search, R45); tags through
`RecipeTags`; `assertRole` import dropped; `nowMs()` → `Clock`. `collections.service.ts` → `RecipeCollections` (through
`Recipes.loadRecipeRow` / `buildRecipeListItems`, `RemoteImages`, `checkCanModifyOwned`). Extend `recipesLayer()`
(`RecipeCollections` over `Recipes` over `RecipeTags`); widen the type. Bridges (P1) for `routes/recipes.ts` and for
`loadRecipeRow` (plan, cookLog, items until T08/T09).

Files: `apps/api/src/modules/recipe/services/recipes/recipes.service.ts`,
`apps/api/src/modules/recipe/services/recipes/collections.service.ts`, `apps/api/src/modules/recipe/services/recipes/layer.ts`.

Acceptance: no `throw`, `ApiError`, `nowMs(`, `withTransaction(`, `assertCanModifyOwned` or `assertRole` left in the two
source files outside comments and the bridge section; every `loadRecipeRow` / collection lookup filters by `householdId`
(D8); `recipes.test.ts`, `recipes-search.test.ts`, `recipes-cooked.test.ts`, `recipe-cross-household.test.ts`,
`recipe-remote-image.test.ts`, `plan.test.ts`, `shopping*.test.ts` green unchanged (the last two through the bridges).

Verify: V-TYPES, `cd /home/erics/software/toon-household && bun test apps/api/test/recipes.test.ts
apps/api/test/recipes-search.test.ts apps/api/test/recipes-cooked.test.ts apps/api/test/recipe-cross-household.test.ts
apps/api/test/recipe-remote-image.test.ts apps/api/test/tags-kind.test.ts apps/api/test/plan.test.ts
apps/api/test/shopping.test.ts`, V-ORDER, V-IDIOMS, V-PINNED, V-REPOS, V-SUITE.

### E3-T07 — `ImportCommit` and rule (11)'s recipe entry (build)

Read: P1, P2, P8, P9, P12, P15, P16; `apps/api/src/db/database.ts`; `docs/modules/recipe.md` 4a "Import route tests use real
sessions", "Remote images become local copies on write", 4b R5 (in section 2); the files `services/import/{commit,drafts,
parsed,db}.ts`, `routes/imports.ts` (caller); `apps/api/test/effect-idioms.test.ts` rule (11); tests
`apps/api/test/import/commit.test.ts`, `apps/api/test/import/routes.test.ts` (pinned, read-only).

Work: `commit.ts` → `ImportCommit` (`commitDraft(input)`, `countRecipes(householdId)`; the hero image localized BEFORE the
transaction; tags get-or-create and collection links as today; the draft marked reviewed in the same transaction; `Date.now()`
→ `Clock`; refusals per P8). Add `ImportCommit` to `importLayer()` (it needs `RemoteImages`, provided by the outer nesting of
P4); widen the type. Bridge `commitDraft(db, input)` for `routes/imports.ts` until T11. Rewrite `commit.test.ts` onto
`ImportCommit` and `ImportDrafts` with `Database.withExecutor(db)` on its own file DB (every assertion kept). In
`effect-idioms.test.ts` remove the `ALLOW_SERVICE_DATE` entry `"apps/api/src/modules/recipe/services/"` (P16) and nothing else.

Files: `apps/api/src/modules/recipe/services/import/commit.ts`, `apps/api/src/modules/recipe/services/import/layer.ts`,
`apps/api/test/import/commit.test.ts`, `apps/api/test/effect-idioms.test.ts`.

Acceptance: `grep -rnE '\bDate\.now\s*\(|\bnew\s+Date\s*\(' apps/api/src/modules/recipe/services` empty outside comments; the
idioms test green with the entry removed; `commit.test.ts` keeps its test count; `routes.test.ts` (the commit route through
the bridge and `importDb()`) green unchanged.

Verify: V-TYPES, `cd /home/erics/software/toon-household && bun test apps/api/test/import apps/api/test/effect-idioms.test.ts`,
V-ORDER, V-PINNED, V-REPOS, V-SUITE.

### E3-T08 — `MealPlan`, `CookLog`, `ShoppingFromPlan` (build)

Read: P1, P2, P8, P9, P13, P15; `docs/modules/recipe.md` 4b R45 (`last_cooked_at` written only by the cook log), the plan
section of `docs/API.md` "Recipe module" (idempotent `POST /plan`: 201 new, 200 existing, the second call's `servings`
applies); the files `services/plan/{plan.service,mappers}.ts`, `services/recipes/cookLog.ts`,
`services/shopping/fromPlan.service.ts`, `services/recipes/recipes.service.ts` (`Recipes`, T06),
`services/shopping/lists.service.ts` (`ShoppingLists`, T04), `apps/api/src/core/services/auth/users.ts`
(`isUniqueViolation`); callers `routes/plan.ts`, `routes/recipes.ts`, `routes/shopping.ts`; tests
`apps/api/test/{plan,recipes-cooked,shopping-from-plan,recipe-cross-household}.test.ts` (unchanged).

Work: `plan.service.ts` → `MealPlan` (`listPlanEntries`, `listLastPlanned`, `loadPlanEntryRow`, `findPlanEntryForRecipeOnDay`,
`createPlanEntry` with the unique-violation recovery of P8, `updatePlanEntry` with the position re-tailing in one
transaction, `deletePlanEntry`); `cookLog.ts` → `CookLog` (`recordCooked`, `undoCooked`, `COOK_UNDO_WINDOW_MS` kept as a
pure export; the window compared against `Clock`); `fromPlan.service.ts` → `ShoppingFromPlan` (`planShoppingPreview`). Fill
`planLayer()` (`CookLog` and `ShoppingFromPlan` over `MealPlan`); widen the type. Bridges for the routes until T10.

Files: `apps/api/src/modules/recipe/services/plan/plan.service.ts`, `apps/api/src/modules/recipe/services/recipes/cookLog.ts`,
`apps/api/src/modules/recipe/services/shopping/fromPlan.service.ts`, `apps/api/src/modules/recipe/services/plan/layer.ts`.

Acceptance: no `throw`, `ApiError`, `nowMs(` or `withTransaction(` left in the three source files outside comments and the
bridge section; `plan.test.ts`, `recipes-cooked.test.ts`, `shopping-from-plan.test.ts`, `recipe-cross-household.test.ts`
green unchanged.

Verify: V-TYPES, `cd /home/erics/software/toon-household && bun test apps/api/test/plan.test.ts apps/api/test/recipes-cooked.test.ts
apps/api/test/shopping-from-plan.test.ts apps/api/test/recipe-cross-household.test.ts apps/api/test/recipes.test.ts`, V-ORDER,
V-IDIOMS, V-PINNED, V-REPOS, V-SUITE.

### E3-T09 — `ShoppingItems` and `ShoppingBought` (build)

Read: P1, P2, P8, P9, P13, P15; `docs/modules/recipe.md` 4a "The shopping list outbox is wired through the manifest", 4b R40,
R44, R47; `docs/API.md` "Shopping lists" rows; the files
`services/shopping/{items.service,bought.service,lists.service,idempotency,mappers}.ts`, `services/recipes/recipes.service.ts` (`Recipes.loadRecipeRow`), `packages/shared/src/modules/recipe/shopping.ts`
(the pure merge rule, unchanged); caller `routes/shopping.ts`; tests `apps/api/test/{shopping,shopping-bought,
recipe-cross-household}.test.ts` (unchanged; "mutationId (offline replay safety)" is an exit criterion).

Work: `items.service.ts` → `ShoppingItems` (every export of the file except the re-exported pure `ingredientToShoppingItem`,
which stays); `bought.service.ts` → `ShoppingBought` (`clearBoughtSection`, `undoBoughtItem`, `listBoughtItems`;
`BOUGHT_LOG_TTL_MS` pure). The cycle (P2): `applyAdditions` (items) and `appendBoughtItem`, `pruneBoughtLog` (bought) become
exported `Effect.fnUntraced` helpers requiring `Database`, provided inside the calling methods. `claimMutation` runs inside
the same `database.transaction` as the write it guards (P13); the 90-day prune and the ledger prune where they run today;
`nowMs()` → `Clock`. Extend `shoppingLayer()` (`ShoppingItems`, `ShoppingBought` over `ShoppingLists`,
`ShoppingMutations`); widen the type. Bridges for `routes/shopping.ts` until T10.

Files: `apps/api/src/modules/recipe/services/shopping/items.service.ts`,
`apps/api/src/modules/recipe/services/shopping/bought.service.ts`, `apps/api/src/modules/recipe/services/shopping/layer.ts`.

Acceptance: no `throw`, `ApiError`, `nowMs(` or `withTransaction(` left in the two source files outside comments and the
bridge section; `shopping.test.ts` (the replay block included), `shopping-bought.test.ts` (the replay cases included),
`shopping-from-plan.test.ts`, `recipe-cross-household.test.ts` green unchanged.

Verify: V-TYPES, `cd /home/erics/software/toon-household && bun test apps/api/test/shopping.test.ts
apps/api/test/shopping-bought.test.ts apps/api/test/shopping-from-plan.test.ts apps/api/test/recipe-cross-household.test.ts`,
V-ORDER, V-IDIOMS, V-PINNED, V-REPOS, V-SUITE.

### E3-T10 — The recipe, plan and shopping routes on the runtime (rewrite)

Read: this section's tables only, plus P14 and the three route files. Files: `apps/api/src/modules/recipe/routes/recipes.ts`,
`apps/api/src/modules/recipe/routes/plan.ts`, `apps/api/src/modules/recipe/routes/shopping.ts`. Touch no other file and no line
the tables do not name. The service classes and method names exist (P2: a method is named exactly like the old function, minus
its `db` argument); if a call does not match a row (a function not listed, a first argument that is not `db`), stop and report
it instead of designing.

Table A — imports, per file (keep every other import line as it is):

| File | Old | New |
| --- | --- | --- |
| all three | `import { db } from "../../../db/client.ts";` | delete the line |
| all three | `import { requireMembership, requireUser } from "../../../lib/types.ts";` | `import { currentMembership, currentUser } from "../../../lib/types.ts";` (only the names the file then uses) |
| `recipes.ts`, `plan.ts` | (no `effect` import yet) | add `import { Effect } from "effect";` as the first import line |
| `shopping.ts` | `import { Option } from "effect";` | `import { Effect, Option } from "effect";` |
| all three | (add, after the `../../../lib/validate.ts` import) | `import { runtime } from "../../../runtime.ts";` |
| `recipes.ts` | `import { addRecipeToCollection, createCollection, deleteCollection, getCollectionDetail, listCollections, removeRecipeFromCollection, updateCollection, } from "../services/recipes/collections.service.ts";` (multi-line) | `import { RecipeCollections } from "../services/recipes/collections.service.ts";` |
| `recipes.ts` | `import { createRecipe, deleteRecipe, getRecipeDetail, listRecipes, scaleRecipe, setRecipeImage, updateRecipe, } from "../services/recipes/recipes.service.ts";` (multi-line) | `import { Recipes } from "../services/recipes/recipes.service.ts";` |
| `recipes.ts` | `import { recordCooked, undoCooked } from "../services/recipes/cookLog.ts";` | `import { CookLog } from "../services/recipes/cookLog.ts";` |
| `recipes.ts` | `import { createTag, deleteTag, listTags, updateTag } from "../services/recipes/tags.service.ts";` | `import { RecipeTags } from "../services/recipes/tags.service.ts";` |
| `recipes.ts` | `import { storeUploadedImage } from "../../../core/services/media/uploads.ts";` | `import { Uploads } from "../../../core/services/media/uploads.ts";` |
| `plan.ts` | `import { createPlanEntry, deletePlanEntry, listLastPlanned, listPlanEntries, updatePlanEntry, } from "../services/plan/plan.service.ts";` (multi-line) | `import { MealPlan } from "../services/plan/plan.service.ts";` |
| `shopping.ts` | `import { clearBoughtSection, listBoughtItems, undoBoughtItem, } from "../services/shopping/bought.service.ts";` | `import { ShoppingBought } from "../services/shopping/bought.service.ts";` |
| `shopping.ts` | `import { planShoppingPreview } from "../services/shopping/fromPlan.service.ts";` | `import { ShoppingFromPlan } from "../services/shopping/fromPlan.service.ts";` |
| `shopping.ts` | `import { addCatalogEntryToList, …, updateShoppingItem, } from "../services/shopping/items.service.ts";` (multi-line) | `import { ShoppingItems } from "../services/shopping/items.service.ts";` |
| `shopping.ts` | `import { createShoppingList, …, updateShoppingList, } from "../services/shopping/lists.service.ts";` (multi-line) | `import { ShoppingLists } from "../services/shopping/lists.service.ts";` |

Table B — which service a function comes from, and the variable that holds it (declare it ONCE at the top of each generator
that uses it, before any other statement: `const <variable> = yield* <Service>;`):

| Old functions (imported from) | Service | Variable |
| --- | --- | --- |
| `listRecipes`, `createRecipe`, `getRecipeDetail`, `updateRecipe`, `deleteRecipe`, `setRecipeImage`, `scaleRecipe` (`recipes.service.ts`) | `Recipes` | `recipeService` |
| `listCollections`, `createCollection`, `getCollectionDetail`, `updateCollection`, `deleteCollection`, `addRecipeToCollection`, `removeRecipeFromCollection` (`collections.service.ts`) | `RecipeCollections` | `collectionService` |
| `recordCooked`, `undoCooked` (`cookLog.ts`) | `CookLog` | `cookLogService` |
| `listTags`, `createTag`, `updateTag`, `deleteTag` (`tags.service.ts`) | `RecipeTags` | `tagService` |
| `storeUploadedImage` (`core/services/media/uploads.ts`) | `Uploads` | `uploads` |
| `listPlanEntries`, `listLastPlanned`, `createPlanEntry`, `updatePlanEntry`, `deletePlanEntry` (`plan.service.ts`) | `MealPlan` | `planService` |
| `listShoppingLists`, `createShoppingList`, `getShoppingListDetail`, `updateShoppingList`, `deleteShoppingList` (`lists.service.ts`) | `ShoppingLists` | `listService` |
| `addShoppingItems`, `clearShoppingList`, `updateShoppingItem`, `deleteShoppingItem`, `checkShoppingItem`, `addRecipeToShoppingList`, `removeRecipeFromList`, `listShoppingCatalog`, `setCatalogEntryHidden`, `addCatalogEntryToList`, `deleteCatalogEntry` (`items.service.ts`) | `ShoppingItems` | `itemService` |
| `listBoughtItems`, `clearBoughtSection`, `undoBoughtItem` (`bought.service.ts`) | `ShoppingBought` | `boughtService` |
| `planShoppingPreview` (`fromPlan.service.ts`) | `ShoppingFromPlan` | `fromPlanService` |

Table C — statements inside a handler (the handler is the LAST argument of `router.get/post/patch/delete/put`):

| Old | New |
| --- | --- |
| `async (c) => {` BODY `}` | `(c) =>` `runtime.runPromise(` `Effect.gen(function* () {` BODY' `}),` `)` (BODY' = BODY with the rows below applied; the service variables of Table B first) |
| `async (c) => EXPR` (an expression body, e.g. `async (c) => json(c, await f(db, X))`) | `(c) => runtime.runPromise(Effect.gen(function* () { <service variables>; return EXPR'; }))` |
| `await <fn>(db, A…)` for a function of Table B, anywhere in the handler (a statement, an initializer, inside `json(...)` or an object literal) | `yield* <variable>.<fn>(A…)` (the `db` argument removed, every other argument unchanged and in order) |
| `<fn>(\n      db,\n      A…,\n    )` spread over lines | the same as the row above: drop the `db,` line, keep the others |
| `const membership = requireMembership(c);` | `const membership = yield* currentMembership(c);` |
| `const user = requireUser(c);` | `const user = yield* currentUser(c);` |
| `const { householdId } = requireMembership(c);` | `const { householdId } = yield* currentMembership(c);` |
| `await c.req.json()` (inside `keepOnlySentKeys(...)`) | `yield* Effect.promise(() => c.req.json())` |
| `await storeUploadedImage(await c.req.formData())` | `yield* uploads.storeUploadedImage(yield* Effect.promise(() => c.req.formData()))` |

What stays exactly as it is: the router declarations, `router.use("*", requireVerifiedEmail())`, every middleware argument
(`validate(...)`, `requireHouseholdRole("admin")`), `c.req.valid(...)`, `c.req.param(...)`, `c.req.query(...)`,
`keepOnlySentKeys`, `parseCsvParam`, `json(...)`, `created(...)`, `noContent(...)`, every `return`, the doc comments, and the
helper `parseSinceQuery` in `shopping.ts` (with its `Date.now()`, P9). A handler with no `await` is still wrapped (row 1),
so every handler has the same shape.

Acceptance: `grep -nE '\bdb\b|requireMembership|requireUser|async \(c\)|\bawait\b' apps/api/src/modules/recipe/routes/{recipes,plan,shopping}.ts`
prints only comment lines; `grep -c 'runtime.runPromise' …` equals the number of handlers per file; `recipes.test.ts`,
`recipes-search.test.ts`, `recipes-cooked.test.ts`, `tags-kind.test.ts`, `plan.test.ts`, `shopping.test.ts`,
`shopping-bought.test.ts`, `shopping-from-plan.test.ts`, `recipe-cross-household.test.ts`, `api-doc.test.ts`,
`middleware.test.ts` green unchanged.

Verify: V-TYPES, `cd /home/erics/software/toon-household && bun test apps/api/test/recipes.test.ts
apps/api/test/recipes-search.test.ts apps/api/test/recipes-cooked.test.ts apps/api/test/tags-kind.test.ts
apps/api/test/plan.test.ts apps/api/test/shopping.test.ts apps/api/test/shopping-bought.test.ts
apps/api/test/shopping-from-plan.test.ts apps/api/test/recipe-cross-household.test.ts apps/api/test/api-doc.test.ts
apps/api/test/middleware.test.ts`, V-ORDER, V-IDIOMS, V-PINNED, V-REPOS, V-SUITE.

### E3-T11 — The import and card routes on the runtime, and rule (10)'s recipe entry (build)

Read: P6, P7, P8, P14, P15, P16; `docs/plans/e2-api-core-services.md` section 4 E2-T10 and E2-T11 (the route shape) and the
converted `apps/api/src/core/routes/auth.ts` (a route file on the runtime with JSON-reading helpers);
`apps/api/src/lib/{types,validate,errors,http}.ts`; `apps/api/src/core/services/auth/rateLimit.ts` (`RateLimiter.enforce`);
`docs/modules/recipe.md` 4a "Import route tests use real sessions", 4b R4, R20, R31, R32, R34; `docs/API.md` "Recipe module"
rows for `/imports` and `/api/recipe/cards`; the files `routes/imports.ts`, `routes/cards.ts`, `routes/index.ts` (order, read
only), the services of T01 to T07 they call; tests `apps/api/test/import/{routes,ocr-disabled}.test.ts` (pinned),
`apps/api/test/cards.test.ts` (pinned), `apps/api/test/recipe-cross-household.test.ts` (pinned),
`apps/api/test/effect-idioms.test.ts` rule (10).

Work: `routes/imports.ts`: every handler as P14 (the shape of E3-T10 Table C) wrapped with `withImportDb(...)` (P6); services
`ImportCapabilities`, `ImportFiles`, `OcrImporter`, `Ocr` (`withOcrSlot` as an Effect around the OCR import, the slot taken
AFTER the body is read, as today), `UrlImporter`, `ImportDrafts`, `ImportCommit`, `RateLimiter`; `readJson` as an
`Effect.fnUntraced` (P14); the three upload handlers keep the order capability check → rate limit → body read →
per-kind check; the pasted-text handler yields `ocrImporter.importFromText(...)` (the Effect method of P11, never the
synchronous export inside a generator, where its throw would turn into a defect); the `/:draftId/source` handler keeps `existsSync`, `Bun.file` and the three
headers, its two `NotFound` texts and its `householdId`-scoped draft lookup; every `ApiError` raise per P8 (the two
`Conflict("conflict", "server.import.draftAlreadyCommitted")`). `routes/cards.ts`: handlers on the runtime with `Cards`,
`requireSession()` / `requireVerifiedEmail()` unchanged, the raw-body decode through `decode(...)` (R32), refusals per P8, the
user-scoped lookups unchanged (another user's card is `404`). The bridges the two route files were the last caller of (the sync `assert…Enabled` of
`capabilities.ts`, the `ImportFiles` / `OcrImporter` / `withOcrSlot` / `ImportDrafts` / `commitDraft` / `Cards` bridges) are
NOT deleted here: their files belong to earlier tasks, and E3-T13 owns the prune (they hold no literal `throw`, so they do not
block rule (10)). In `effect-idioms.test.ts` remove the `ALLOW_THROW_API_ERROR` entry `"apps/api/src/modules/recipe/"` (P16)
and nothing else.

Files: `apps/api/src/modules/recipe/routes/imports.ts`, `apps/api/src/modules/recipe/routes/cards.ts`,
`apps/api/test/effect-idioms.test.ts`.

Acceptance: `grep -rnE '\bthrow\s+(new\s+)?ApiError\b' apps/api/src/modules/recipe` empty; the idioms test green with the
entry removed; `import/routes.test.ts`, `import/ocr-disabled.test.ts` (no body read and no rate-limit slot spent while
disabled), `cards.test.ts`, `recipe-cross-household.test.ts`, `api-doc.test.ts` green unchanged; `grep -nE '\bdb\b|importDb\(\)|enforceRateLimit|requireMembership|requireUser'
apps/api/src/modules/recipe/routes/{imports,cards}.ts` prints only comment lines.

Verify: V-TYPES, `cd /home/erics/software/toon-household && bun test apps/api/test/import apps/api/test/cards.test.ts
apps/api/test/recipe-cross-household.test.ts apps/api/test/api-doc.test.ts apps/api/test/effect-idioms.test.ts`, V-ORDER,
V-PINNED, V-REPOS, V-SUITE.

### E3-T12 — The core bridges of P20 deleted, their test callers on the services (build)

Read: P1, P15, P20; `docs/plans/e2-api-core-services.md` section 9.2 (the bridge table) and P9; `docs/adr/0014-transitional-core-bridges.md`;
the bridge sections of `apps/api/src/core/services/auth/rateLimit.ts`, `apps/api/src/core/services/media/uploads.ts`,
`apps/api/src/core/services/media/thumbnails.ts`, `apps/api/src/core/services/auth/verifiedEmail.ts`,
`apps/api/src/core/services/households/membership.ts`; `apps/api/src/lib/errors.ts` (`RateLimited`; `onErrorHandler` sets
`Retry-After`, ~367); `apps/api/test/support/effect.ts` (`runTest`); the four test files; how E3-T05 starts a thumbnail warm
(`services/import/url/image.ts`).

Work:
1. Measure first: `grep -rnE '\b(enforceRateLimit|storeUploadedImage|warmThumbnail|isVerifiedEmailRequired|assertCanModifyOwned|assertRole)\b'
   apps/api/src apps/api/scripts apps/api/test` shows, outside the five defining files and comments, only the four test files
   below (recipe's last callers left in E3-T01 `serverFeatures()`, E3-T04, E3-T05, E3-T06, E3-T10, E3-T11). A non-comment
   caller anywhere else stops the task and is reported. (`Uploads.storeUploadedImage` is a service METHOD of the same name and
   stays; only the module-level bridge function goes.)
2. Delete the six bridges and every import or helper only they used; a bridge section's header comment lists what remains
   (P20's survivors), or the section goes when it is empty.
3. `apps/api/test/rate-limiter.test.ts`, block "the synchronous bridges" (renamed "enforce at the boundary"; its test count
   stays; `checkRateLimit` and `resetRateLimits` stay, P20). Hoist the "RateLimiter.enforce" block's `PRODUCTION` object to
   file scope and define `productionLimiter = RateLimiter.layer.pipe(Layer.provide(AppConfig.layerFrom(PRODUCTION)))`: a
   production `AppConfig` IS the enabled path, as that block already proves; `enforceIn` stays module-private and no
   test-enabled switch is added to `RateLimiter`.
   (a) "answers 200 then 429 with Retry-After in a Hono route": the handler is `(c) => Effect.runPromise(enforce("t",
   id).pipe(Effect.map((key) => c.json({ key })), Effect.provide(productionLimiter)))`; the rejection (the `RateLimited`
   itself, `Cause.squash`) reaches `app.onError(onErrorHandler)`, which sets `Retry-After`. Every assertion stays (200 and the
   key, 429, `Retry-After` digits, `rate_limited`, the message containing the seconds); the typed-assignment comment goes.
   (b) "a direct call outside Hono": the first `enforce` under `productionLimiter` answers the key; the second through
   `Effect.flip` is the error: `isApiError`, `code`, `_tag`, `retryAfterSeconds > 0` asserted as before; the `Retry-After`
   assertion moves to where the header is now set: that error handed to the route of (a) (or a one-route Hono app whose handler
   fails with it) answers `Retry-After` equal to `String(error.retryAfterSeconds)`.
   (c) "the default for `enabled` is off under NODE_ENV=test": two `enforce` calls through `runTest` (the test `AppConfig`)
   answer the same key, as the two bridge calls did.
4. `apps/api/test/uploads.test.ts` "the Promise bridge stores the same way and rejects with the family error" (~537-545):
   onto `runtime.runPromise(Uploads.use((u) => u.storeUploadedImage(form)))` (the runtime from `apps/api/src/runtime.ts`;
   the Promise path that replaces the bridge), every assertion kept (the stored filename pattern, the removal, the rejection
   `toBeInstanceOf(ApiError)` with status 400); the test title names the runtime instead of the bridge.
5. `apps/api/test/thumbnails.test.ts` "warm is a no-op under the test env and warmThumbnail returns undefined synchronously"
   (~283): a case that pins the bridge's own calling convention is rewritten to the convention that replaces it: inside
   `runTest`, `Effect.forkDetach(thumbnails.warm("missing.png"))` (E3-T05's form) returns a fiber at once and the test env's
   warm completes without a file; the existing `runTest(Thumbnails.use((t) => t.warm("missing.png")))` line stays; the test
   count stays; `SHARP_TEST_TIMEOUT_MS` budgets untouched.
6. `apps/api/test/verified-email-gate.test.ts` (~456): `expect(isVerifiedEmailRequired()).toBe(false)` onto `expect(await
   runTest(VerifiedEmail.use((v) => v.isRequired))).toBe(false)` (`isRequired` is an `Effect<boolean>` member,
   `verifiedEmail.ts` ~74), with `setVerifiedEmailRequired` handed back as today.
7. ADR 0014, `CLAUDE.md` and the E2 record are NOT edited here (E3-T13 writes the survivors). The commit body lists the six
   deleted bridges and every rewritten case by its title.

Files: `apps/api/src/core/services/auth/rateLimit.ts`, `apps/api/src/core/services/media/uploads.ts`,
`apps/api/src/core/services/media/thumbnails.ts`, `apps/api/src/core/services/auth/verifiedEmail.ts`,
`apps/api/src/core/services/households/membership.ts`, `apps/api/test/rate-limiter.test.ts`, `apps/api/test/uploads.test.ts`,
`apps/api/test/thumbnails.test.ts`, `apps/api/test/verified-email-gate.test.ts`.

Acceptance: the grep of step 1 prints no non-comment line (`grep -vE ':[0-9]+:\s*(\*|//|/\*)'`) except the
`Uploads.storeUploadedImage` method and its service calls; the four test files keep their test counts and every kept
assertion; the 429 path with `Retry-After` is still proven end to end (case (a)); `auth.test.ts` (pinned rate-limit block via
`checkRateLimit`) green unchanged; V-PINNED clean.

Verify: V-TYPES, `cd /home/erics/software/toon-household && bun test apps/api/test/rate-limiter.test.ts
apps/api/test/uploads.test.ts apps/api/test/thumbnails.test.ts apps/api/test/verified-email-gate.test.ts
apps/api/test/auth.test.ts apps/api/test/import`, `cd /home/erics/software/toon-household && ! (grep -rnE
'\b(enforceRateLimit|warmThumbnail|isVerifiedEmailRequired|assertCanModifyOwned|assertRole)\b' apps/api/src apps/api/scripts
apps/api/test | grep -vE ':[0-9]+:\s*(\*|//|/\*)')`, V-ORDER, V-IDIOMS, V-PINNED, V-REPOS, V-SUITE.

### E3-T13 — Integration: recipe bridges pruned, the local-fixture URL import, docs, the record (build)

Read: every decision of section 2; `docs/plans/e2-api-core-services.md` sections 9 and 10 (the shape of the record);
`docs/adr/0014-transitional-core-bridges.md`; `CLAUDE.md` (Status, Layout, the gotchas named in section 4's preamble, "The
idioms test is the E12 gate", "Headless runs", "Long commands", "A test that runs `sharp` carries an explicit time budget");
`docs/modules/recipe.md` (whole); `docs/open-work.md`; the commit bodies of E3-T01 to E3-T12 (`git log ddc48af87..HEAD`),
which carry every recorded deviation and E3-T12's list of deleted core bridges.

Work:
1. Bridges: list every `/* legacy bridges … */` section under `apps/api/src/modules/recipe/`; delete every bridge without a
   caller outside the converted set (measure with `grep -rn` over `apps/api/src`, `apps/api/scripts`, `apps/api/test`); the
   recipe survivors are exactly P1's list (the core bridges of P20 are already gone, E3-T12; the core files are not touched
   here). The seam guards of P1 stay. No non-comment line under `apps/api/src/modules/recipe` names `ApiError` (P8), calls `nowMs(` or `withTransaction(`
   (the verify command below; doc comments that still say `@throws ApiError` are reworded to the family member).
2. Idioms: widen rule (11)'s `nowMs(` scan to `apps/api/src/modules/recipe/` (P16); its comments name only finance's entries
   as left for E4. `import-order-effect.test.ts` gains the three service entries of P17 (never the two route files; P17 says
why).
3. The local-fixture URL import as an `app.request` test, new file `apps/api/test/import/url-import-local.test.ts`: a
   `Bun.serve` on `127.0.0.1:0` serving a recipe page from `apps/api/test/fixtures/import/` (one with JSON-LD and a hero image,
   e.g. the chefkoch fixture with its image URL pointed at the local server) and a real PNG (`makeTestPng` from
   `helpers.ts`); `setImportGuardForTests({ allowHosts: ["127.0.0.1"] })` (P10: an exact-host allow list under which every
   other host keeps every check; NEVER the private-hosts escape hatch, which skips the metadata check) and
   `setImportDbForTests` as the pinned route tests do (user, session, household, membership and the `household_modules` row
   in the shared db, the FK rows in the file DB); `POST /api/households/:id/recipe/imports/url` → `201` with a draft whose
   `parsed.title` is the fixture's and whose `parsed.imageUrl` is a local `/uploads/…` file; `POST …/imports/:draftId/commit`
   → `201` with `Location`; a fixture route answering `302` with `Location: http://169.254.169.254/latest/meta-data/` →
   `400 fetch_failed` with `details.reason` `"private_ip"` (the guard's reason for that address; confirm it with
   `assertPublicUrl("http://169.254.169.254/")` before writing the assertion), answered within 2000 ms of the request (a
   `performance.now()` bound: a refusal by the guard, not the 10 s page timeout), with the fixture server's request log
   showing that route hit exactly once. Nothing is sent to the metadata address: the guard refuses the hop before the request.
   Every test of the file passes an explicit timeout `URL_IMPORT_TEST_TIMEOUT_MS = 30_000` as the `test(...)` timeout (above
   the 10 s page budget, so a hang fails on the route's own assertion instead of bun's 5 s default; the stored hero image
   warms a thumbnail with `sharp`). In `afterAll`: `setImportGuardForTests(null)`, `setImportDbForTests(null)`, the fixture
   server stopped, every stored upload and its `.thumb.webp` deleted. The offline replay is the existing pinned pair (`shopping.test.ts` "mutationId (offline replay safety)",
   `shopping-bought.test.ts` replay cases): run them and quote them in the record.
4. Gates (section 5) and the boot check: a migrated temp DB, `NODE_ENV=development`, the server entry file run directly
   (`bun apps/api/src/index.ts`, its pid; `dev:api` is a wrapper, E2 section 10 item 9), `/api/health` 200 with
   `modules: ["recipe","finance"]` and `features.ocrImport` / `pdfImport`; with `IMPORT_ALLOW_PRIVATE_HOSTS=1` and a local
   fixture server, the curl walkthrough register → create household → `POST …/recipe/imports/url` (201) → commit (201) →
   `GET …/recipe/recipes` (the recipe listed) → `POST …/recipe/shopping-lists` (201) → `POST …/items` with a `mutationId`
   twice (the second answers the same list, the quantity not doubled); then SIGTERM: the log ends `[api] SIGTERM — stopping
   modules …`, `[db] database closed`, `[api] runtime disposed`, exit 0. Long commands to the background with a log ending in
   `exit=$?` (CLAUDE.md "Long commands"); never `pkill -f`.
5. Docs (P19): `docs/modules/recipe.md`, `CLAUDE.md`, `docs/adr/0014-transitional-core-bridges.md` (the survivors after E3,
   recipe's of P1 and the core's of P20 after E3-T12, and a sentence that recipe is no longer behind `fromPromiseModule`),
   `docs/open-work.md` (one observation for E7: the two recipe route files cannot be imported first, P17), `agent-patterns/effect-{core,errors,testing,datetime-clock}.md`
   "As built (E3)"; `apps/api/src/modules/recipe/index.ts`'s header comment (the manifest as an `ApiModule`, the hooks as
   Effects). No new ADR unless a recorded deviation changes a SPEC §1 or EFFECT.md §1 decision (none expected, section 7).
6. The record: this plan's sections 9 (gates with quoted log lines, the bridge survivors table with callers and removal
   milestones, exit greps, boot and walkthrough, the pass count against 14658) and 10 (every deviation from the task commits,
   numbered), the status line set to DONE; commit the plan.

Files: `apps/api/src/modules/recipe/services/**/*.ts` (bridge sections only), `apps/api/src/modules/recipe/index.ts` (header
comment), `apps/api/src/modules/recipe/services/import/capabilities.ts`, `apps/api/test/effect-idioms.test.ts`,
`apps/api/test/import-order-effect.test.ts`, `apps/api/test/import/url-import-local.test.ts`, `docs/modules/recipe.md`,
`docs/open-work.md`, `CLAUDE.md`,
`docs/adr/0014-transitional-core-bridges.md`, `agent-patterns/effect-core.md`, `agent-patterns/effect-errors.md`,
`agent-patterns/effect-testing.md`, `agent-patterns/effect-datetime-clock.md`, `docs/plans/e3-recipe-services.md`.

Acceptance: section 5 entirely; `docs-paths.test.ts` green (every path the edited docs name exists); the survivors are exactly
P1's and P20's lists; the pass count above 14658 by the tests E3 added.

Verify: `cd /home/erics/software/toon-household && bun install --frozen-lockfile`, V-TYPES, V-SUITE, V-IDIOMS, V-ORDER, V-PINNED,
V-REPOS, `cd /home/erics/software/toon-household && bun test apps/api/test/import/url-import-local.test.ts
apps/api/test/docs-paths.test.ts apps/api/test/api-doc.test.ts`, `cd /home/erics/software/toon-household && bun run build`,
`cd /home/erics/software/toon-household && L=$(mktemp) && (bun run i18n:check > "$L" 2>&1 < /dev/null; true) && grep -q
'\[i18n:check\] OK' "$L"`, `cd /home/erics/software/toon-household && ! (grep -rnE '\bApiError\b|\bnowMs\s*\(|\bwithTransaction\s*\('
apps/api/src/modules/recipe | grep -vE ':[0-9]+:\s*(\*|//|/\*)')`, the boot check:
`cd /home/erics/software/toon-household && D=$(mktemp -d) && DATABASE_URL=file:$D/b.db bun run db:migrate > $D/m.log 2>&1 &&
D=$D bun -e 'const d=process.env.D;const env={...process.env,NODE_ENV:"development",DATABASE_URL:"file:"+d+"/b.db",SESSION_SECRET:"e3-boot-check-0123456789abcdef",API_PORT:"3917",WEB_ORIGIN:"http://127.0.0.1:3917",UPLOAD_DIR:d+"/up"};const p=Bun.spawn(["bun","apps/api/src/index.ts"],{env,stdout:"pipe",stderr:"pipe"});let ok=false;for(let i=0;i<150&&!ok;i++){await Bun.sleep(200);try{const r=await fetch("http://127.0.0.1:3917/api/health");const j=await r.json();ok=r.status===200&&j.modules.includes("recipe")&&typeof j.features.ocrImport==="boolean";}catch{}}p.kill("SIGTERM");const code=await p.exited;const out=await new Response(p.stdout).text();console.log(out);process.exit(ok&&code===0&&out.includes("[db] database closed")&&out.includes("[api] runtime disposed")?0:1)'`.

## 5. Acceptance summary

- Gates: `bun install --frozen-lockfile` (no dependency change in E3: `effect/http` is part of the installed `effect@4.0.5`),
  `bun run typecheck`, `bun test` (pass count ≥ 14658 after every task, above it at the end), `bun run build`, `bun run
  i18n:check` (parity OK; every leftover hit classified, the known 147 plus any comment line E3 moved, no new German string),
  `git status --porcelain repos/` empty, `bun test apps/api/test/effect-idioms.test.ts` with the recipe entries of rules (10)
  and (11) gone and the `nowMs(` scan widened to recipe.
- Behaviour: V-PINNED clean against `ddc48af87` (the import route tests, the SSRF test and its helpers, the cross-household
  test, the api-doc test and the `app.request` recipe tests byte-identical and green); every recipe row of `docs/API.md` served
  (`api-doc.test.ts`); `docs/API.md`, `apps/api/drizzle`, `packages/shared`, `apps/web` untouched.
- Structure: every service of the P2 table is a `Context.Service` with a static `layer` listed in its area layer file;
  `recipeModule` is an `ApiModule<RecipeServices>` (not wrapped), its `layer` is part of `AppLayer`, its hooks are Effects;
  no recipe route imports `db`, `requireUser`, `requireMembership` or `enforceRateLimit`; no non-comment line under
  `apps/api/src/modules/recipe` names `ApiError`, `nowMs(` or `withTransaction(`; `Bun.spawn` only inside
  `Effect.acquireRelease`, each run in its own `Effect.scoped`; no `fetch(` call in the import services (the `HttpClient`
  does it); the six core bridges of P20 deleted (E3-T12).
- The new `apps/api/test/import/url-import-local.test.ts` (a URL import from a local `Bun.serve` fixture server through
  `app.request` under the guard's exact-host allow list, the redirect into the metadata address refused by the guard
  before any request, explicit per-test timeouts) and the pinned offline-replay cases pass; the boot check
  answers `/api/health` and SIGTERM closes the database (`[db] database closed`, `[api] runtime disposed`, exit 0).
- Records: sections 9 and 10 of this plan; `docs/modules/recipe.md` and `CLAUDE.md` name the services; ADR 0014 lists the
  bridges that survive E3.

## 6. Risks

- **The `HttpClient` path is not byte-identical to the old `fetch` call.** Header casing and order, the `URL` object handed
  to `fetch`, the tracer headers, `redirect: "manual"` through `RequestInit`, the streamed body cap, the mapping of a
  `TransportError` and of the timeout interruption. Mitigation: P10 spells every one out; the pinned `ssrf.test.ts` drives the
  Promise entry point through the SAME core with a scripted fetch, so a divergence fails 20 pinned assertions; E3-T03's new
  test asserts the absence of `traceparent` / `b3`; E3-T13's local-fixture test runs the real `FetchHttpClient` against a real
  socket.
- **Interruption semantics of the hard timeouts.** If `Effect.tryPromise`'s interruption awaited the abandoned promise, a stuck
  `unpdf` would hold a request open (R34). Mitigation: the source fact of section 1.1 and the existing signal-ignoring timeout
  test, which keeps its bound; the release of the `Bun.spawn` scope kills the child.
- **Leaked OCR slots.** A waiter interrupted while queued must leave the queue and a holder interrupted mid-run must release.
  Mitigation: `Effect.acquireRelease(acquireSlot, release, { interruptible: true })` inside `Effect.scoped`, never
  `acquireUseRelease` (its acquire is uninterruptible in v4), and a cancel effect that dequeues the waiter or hands an
  already granted slot on (P11); the gate tests read `ocrInFlight()` / `ocrQueued()` back to 0 and E3-T02's new test
  interrupts a queued waiter.
- **A test that reaches a real address.** A guard seam that skipped the host checks would let the local-fixture test send a
  request to the link-local metadata address (a hang on a dev box, the real endpoint on a cloud runner). Mitigation: the
  seam is an exact-host allow list (P10); the refusal is asserted with its `reason`, a 2 s bound and the fixture's request
  log; every test carries an explicit timeout.
- **Bridges inside open transactions.** A bridge that ignored its `db` argument would write through the root while an
  unconverted caller holds a transaction (SQLite lock wait, then `SQLITE_BUSY` after 5 s). Mitigation: P1's first rule; the
  shopping and plan tests exercise the transactional paths through the bridges in waves 2 to 5.
- **The import cycle.** New module-scope reads (area layers, `Effect.fn` constants, the manifest's `layer`) could hit a TDZ in
  some import order. Mitigation: P17, V-ORDER in every task, the new entries of `import-order-effect.test.ts`. The two
  recipe route files already die when imported first on the base tree; they stay out of the guard (P17) and go to
  `docs/open-work.md` for E7.
- **Merge conflicts between parallel worktrees.** Mitigation: the area layer files (P4) give each task of a wave its own
  composition file; `effect-idioms.test.ts` is edited by one task per wave; `CLAUDE.md` and the module doc only by E3-T13.
- **The services' surface is large** (22 services, about 200 methods): an agent may rename a method or change an argument
  order, which breaks E3-T10's table. Mitigation: P2's naming rule is binding; E3-T10 stops and reports on a mismatch instead of
  designing.
- **Test time and load.** The suite took 30.5 s at baseline; E2 measured 70 to 118 s under a load average of 14 to 50.
  `runtime.runPromise` per request adds a little per-route overhead. Mitigation: none needed for correctness; a sharp test keeps
  its explicit budget; E3-T13 records the time and the host load.

## 7. Deviations expected (each recorded in section 10 when it happens)

1. **`createSession` survives E3** (E2 section 9.2 said "E3 for the two import tests"): `import/routes.test.ts` and
   `import/ocr-disabled.test.ts` are pinned unchanged by E3's own exit criteria, and both call it; it now goes with the pinned
   `middleware.test.ts` (E8). Likewise `createDraft(db, input)` survives for `ocr-disabled.test.ts`, and `fetchHtml` /
   `assertPublicUrl` keep their Promise entry points for `ssrf.test.ts` (P1, P10).
2. **The subprocess primitive stays `Bun.spawn`** inside `Effect.acquireRelease` instead of `effect/process`'s
   `ChildProcessSpawner` (P11): the spawner changes the `details.cause` text of the documented 422s. `agent-patterns/effect-stream.md`
   §7 is corrected in E3-T02.
3. **The `OcrEngine` seam stays a Promise interface** (P11), like the mail transport interface of E2 P8: it is the contract of the
   pinned tests' fake engine.
4. **`healthFeatures` becomes an Effect** (P3), a change of the SPEC §2 contract made in E3-T01 with the SPEC text, inside E7's
   "hooks become Effects" (no ADR, as E2's contract edit).
5. **`Date.now()` stays in `seed.ts`, `schema.ts` and `routes/shopping.ts` `parseSinceQuery`** (P9): outside `services/` and
   outside rule (11).
6. **`ImportHttp.layer` provides `FetchHttpClient.layer` in its static initializer** (P2's one exception): an `effect/http`
   export cannot be in the import cycle.
7. **Pure helper modules are not services** (`ssrf.ts`, `preprocess.ts`, `tesseract.ts`'s parsers, the mappers, parsers and
   adapters, P2): the goal's "every file under services/" is read as "every file that does I/O"; E3 says pure code stays pure.
8. **`importFromText` stays a synchronous export over `Effect.runSync`** (P11): its Effect form is the `OcrImporter` method the
   route yields; the sync function keeps the pinned `ocr-disabled.test.ts` and the `toThrow(ApiError)` case working, and it
   survives E3 as a pinned-test entry point (P1, E8).
9. **The two recipe route files are not entries of `import-order-effect.test.ts`** (P17): imported first they die on the base
   tree because `routes/index.ts` reads them at module scope; fixing it is a router redesign for E7; recorded in
   `docs/open-work.md`.
10. **A new test-only seam `setImportGuardForTests` with an exact-host `allowHosts` list** (P10): no production behaviour
   changes (`IMPORT_ALLOW_PRIVATE_HOSTS` keeps its semantics); it exists so a real-socket test can reach `127.0.0.1` while the
   guard still refuses every other private address.
11. **The `NODE_ENV=test` guard of a test seam keeps its `throw new Error(...)`** (P1): the one tolerated `throw` in recipe
   code, exempted by a fixed message in the acceptance greps.

## 8. Out of this milestone

The finance module (E4: its services, routes, `requireFinanceParticipant`, the `start` hook with `Schedule`); `fromPromiseModule`,
`PromiseApiModule` and `runModuleHook` (E4 removes them once finance moves; `runModuleHook` may stay for the scripts, E5); the
scripts as Effect programs (`localize-images.ts`, `uploads-gc.ts`, `seed.ts`, `migrate-legacy.ts` and `scripts/legacy/recipe.ts`
keep calling the Promise bridges, E5); the web (E6); replacing Hono (E7; the routes stay Hono handlers calling the runtime);
`@effect/sql-libsql`; any `docs/API.md` row, UI or copy change; the bridges that pinned tests need (E8).

## 9. Integration record

Written by E3-T13 on 2026-11-05, on `main` at `f740b24cb` (E3-T12) plus this task's changes, Bun 1.4.3. Every log was read; what follows quotes
it. The host load average was about 3 during the full suite (a quiet machine).

### 9.1 Gates

- `bun install --frozen-lockfile`: `Checked 439 installs across 628 packages (no changes)`, `exit=0`.
- `bun run typecheck`: five projects, `[typecheck] OK`.
- Full `bun test`:
  ```
   14684 pass
   0 fail
   383581 expect() calls
  Ran 14684 tests across 160 files. [32.88s]
  ```
  The floor was 14658 in 158 files (section 1.2); E3 added 26 tests and two files net of the rewritten cases (the new `import-http.test.ts` and
  `url-import-local.test.ts`, the three `import-order-effect` entries, the interrupted-OCR-waiter test, among others). 32.88 s against the baseline's 30.52 s (both quiet).
- `bun run build`: `@toon/web build: Exited with code 0`, `precache  104 entries (1456.28 KiB)` (E3 touches no web file).
- `bun run i18n:check`: `[i18n:check] OK` (parity) and `FAILED — 147 possible German literal(s)`, the same count as E2's record (146 known plus the
  `Effect.die(` stopword hit in `apps/api/src/modules/adapter.ts`). The hits under `apps/api/src/modules/recipe/` are doc comments
  quoting German UI copy ("Häufig gekauft", "Nicht mehr vorschlagen", …) and the recipe content vocabulary (`html/entities.ts` 7,
  `schema.ts` 4, `routes/shopping.ts` 6, `items.service.ts` 6, one each in the other service headers): all false positives. E3 added no
  German string and no catalog change.
- `bun test apps/api/test/effect-idioms.test.ts`: `25 pass`, `0 fail`, with the recipe entries of rules (10) (E3-T11) and (11) (E3-T07) gone and
  the `nowMs(` scan widened to `apps/api/src/modules/recipe/` (this task; its "rule bites" case unchanged).
- V-ORDER (`import-order.test.ts`, `import-order-effect.test.ts`, `legacy-cli.test.ts`): `55 pass`, `0 fail`; the new entries are
  `recipes.service.ts`, `import/url/fetch.ts` and `ocr/index.ts` (P17), never the two route files.
- V-PINNED: `git diff --quiet ddc48af87 -- <the pinned list> docs/API.md apps/api/drizzle packages/shared apps/web` exits 0.
- `git status --porcelain repos/`: empty.
- `bun test apps/api/test/import/url-import-local.test.ts apps/api/test/docs-paths.test.ts apps/api/test/api-doc.test.ts apps/api/test/shopping.test.ts
  apps/api/test/shopping-bought.test.ts`: `73 pass`, `0 fail`.

### 9.2 The recipe bridges after the prune

E3-T13 deleted 71 recipe bridge functions (every one whose callers were only recipe routes, recipe services or tests rewritten onto the services),
measured with `grep -rn` over `apps/api/src`, `apps/api/scripts` and `apps/api/test`, plus the now unused imports (`runtime`, `DbLike`).
**Six survive**, each with its explicit return type and no literal `throw`:

| Bridge (file under `apps/api/src/modules/recipe/`) | Convention | Callers outside the converted set | Removed by |
| --- | --- | --- | --- |
| `backfillFoldedColumns(database?)` (`migrate.ts`) | Promise, through `runModuleHook` (no runtime import) | `apps/api/scripts/legacy/recipe.ts`, `apps/api/test/legacy-recipe.test.ts` (pinned) | E5 |
| `localizeImageUrl(value, previous?)` (`services/recipes/remoteImage.ts`) | Promise, never rejects | `apps/api/scripts/localize-images.ts` | E5 |
| `createDraft(db, input)` (`services/import/drafts.ts`) | Promise, honours `db` with `Database.withExecutor` | `apps/api/test/import/ocr-disabled.test.ts` (pinned) | E8 |
| `importFromText(rawText, options)` (`services/import/ocr/index.ts`) | SYNCHRONOUS, `Effect.runSync`, throws the `400` family member | `apps/api/test/import/ocr-disabled.test.ts` (pinned), `apps/api/test/import/ocr-segment.test.ts` | E8 |
| `fetchHtml(url, options)` (`services/import/url/fetch.ts`) | Promise, `Effect.runPromise` over the same core as `ImportHttp` | `apps/api/test/import/ssrf.test.ts` (pinned) | E8 |
| `assertPublicUrl(input, options)` (`services/import/url/ssrf.ts`) | Promise, rejects with the `SsrfError` | `apps/api/test/import/ssrf.test.ts` (pinned) | E8 |

The core survivors after E3-T12 are listed in ADR 0014 ("Status after E3's integration"): `requireUser`, `requireMembership`, `initializeHousehold`,
`enableModule` (E4); `checkRateLimit`, `resetRateLimits`, `setMailer`, `getMailer`, `isMailerOverridden`, `claimPlaceholderUser`, `createSession`
(tests, E8); `collectUploadReferences`, `trySendMail`, `isMailConfigured`, `findUserByEmail`, `createPasswordResetToken` (scripts, E5). The recipe
manifest is no longer behind `fromPromiseModule`.

### 9.3 Exit greps

- `grep -rnE '\bApiError\b|\bnowMs\s*\(|\bwithTransaction\s*\(' apps/api/src/modules/recipe` outside comment lines: empty.
- `grep -nE 'routes/(recipes|imports)\.ts' apps/api/test/import-order-effect.test.ts`: empty.
- The seam `throw` lines left in recipe code are the three `NODE_ENV=test` guards (`is only available under NODE_ENV=test`).
- Idioms rule (10)'s allow list is finance's prefix alone; rule (11)'s service-date list is `households/support.ts` alone.

### 9.4 The local-fixture URL import test

`apps/api/test/import/url-import-local.test.ts` (3 tests, `3 pass`, 21 `expect()` calls, 0.26 s): a `Bun.serve` fixture on `127.0.0.1:0` serves
`chefkoch-jsonld.html` with its image URLs pointed at itself and a real PNG (`makeTestPng`); the guard is opened for `127.0.0.1` with
`setImportGuardForTests({ allowHosts: ["127.0.0.1"] })`, never the private-hosts escape hatch. `assertPublicUrl("http://169.254.169.254/")` was
confirmed to reject with reason `private_ip` before the assertion was written. (1) `POST …/imports/url` answers 201, the draft title is "Klassische
Pfannkuchen", `parsed.imageUrl` is a local `/uploads/…` path, and the fixture log holds `GET /recipe` and `GET /hero.png`; the commit answers 201 with
`Location: /api/households/<id>/recipe/recipes/<recipeId>`. (2) The `302` to `http://169.254.169.254/latest/meta-data/` answers `400 fetch_failed`,
`details.reason` `private_ip`, in under 2000 ms, the fixture request log exactly `["GET /to-metadata"]`. (3) A third case, `127.0.0.2` on the same
port, shows the allow list is exact (400 `private_ip`, no request reaches the fixture). Every test carries `URL_IMPORT_TEST_TIMEOUT_MS = 30_000`; `afterAll`
hands both seams back, stops the server and removes every stored upload and its `.thumb.webp` (`data/uploads` is empty afterwards).

### 9.5 Boot, walkthrough, SIGTERM and the offline replay

The boot check of the task (a migrated temp DB, `NODE_ENV=development`, `bun apps/api/src/index.ts`, port 3917) answered `/api/health` 200 with
`modules` containing `recipe` and a boolean `features.ocrImport`, and the server log ended:

```
[api] SIGTERM — stopping modules …
[db] database closed
[api] runtime disposed
```

exit 0. The curl-equivalent walkthrough (one script with a `Bun.serve` fixture, the real server process, `IMPORT_ALLOW_PRIVATE_HOSTS=1`, the limiter on):

| Step | Result |
| --- | --- |
| `GET /api/health` | 200, `{"modules":["recipe","finance"],"features":{"verifiedEmailRequired":false,"ocrImport":false,"pdfImport":false}}` |
| `POST /api/auth/register` | 201 |
| `POST …/recipe/imports/url` (fixture page) | 201, title "Klassische Pfannkuchen", `imageUrl` `/uploads/<uuid>…` |
| `POST …/recipe/imports/:draftId/commit` | 201, `Location: /api/households/<id>/recipe/recipes/<id>` |
| `GET …/recipe/recipes` | `total` 1, `["Klassische Pfannkuchen"]` |
| `POST …/recipe/shopping-lists` `{"name":"Rewe"}` | 201 |
| `POST …/items` `{items:[{name:"Milch",quantity:2,unit:"l"}], mutationId}` twice | 200 and 200, both `["Milch:2"]` (the replay applied once) |
| SIGTERM | exit 0, the three lines above |

The offline-replay pair, run on its own (`bun test apps/api/test/shopping.test.ts apps/api/test/shopping-bought.test.ts -t replay`): `8 pass`, `0 fail`
(`mutationId (offline replay safety)` in `shopping.test.ts`, `a replayed mutationId appends no second row` in `shopping-bought.test.ts`); both files
are byte-identical to the base.

### 9.6 Documentation sync

`docs/modules/recipe.md` (section 1.2 "Services (E3)" with the service table and the hooks as Effects, the gotchas "Fold columns and the backfill", "Import
route tests use real sessions" (`withImportDb`, the local-fixture test) and "Remote images become local copies on write", the 4b rows R16, R18, R20, R22,
R23, R34, R45, R60), `CLAUDE.md` (Status, Layout "Recipe services (E3)", the gotchas "Bridges until E4 to E8", "Hooks are Effects; finance is still behind
`fromPromiseModule`" and the new "The recipe module's services and the URL import guard", the idioms paragraph), `docs/adr/0014-transitional-core-bridges.md`
("Status after E3's integration"), `docs/open-work.md` (O-6, the route-file import-order observation for E7), `agent-patterns/effect-{core,errors,testing,datetime-clock}.md`
("As built (E3)", examples copied from the code), `apps/api/src/modules/recipe/index.ts` (its header already described the manifest as an `ApiModule`).
No ADR was added: no deviation changes a SPEC §1 or EFFECT.md §1 decision.

## 10. What changed vs plan

Everything section 7 expected (items 1 to 11) happened as written. In order, what else differs and what each task recorded:

1. **71 recipe bridges deleted, measured** (E3-T13): no caller outside the converted set was found for any of them, including the three synchronous
   `assert…ImportEnabled` bridges and `resolveUploadPath`, `readUploadedFile`, `deleteUpload` and `withOcrSlot`, whose last callers moved with E3-T11.
   The unused `runtime`, `DbLike` and `DrizzleDatabase` imports the deletion left were removed in the same commit.
2. **Two core comments were touched** (`apps/api/src/core/services/auth/sessions.ts`, `apps/api/src/lib/types.ts`): the plan said the core files are not touched
   in this task, but the caller lists of `createSession`, `requireUser` and `requireMembership` still named recipe callers that no longer exist. Comment lines only.
3. **A third test in `url-import-local.test.ts`** (the exact-host allow list: `127.0.0.2` stays refused) beside the two the plan spelled out.
4. **The comment in `import-order-effect.test.ts` does not spell the route file paths**: the verify command greps the file for `routes/(recipes|imports).ts` and
   must find nothing, so the comment says "the recipe and import route files".
5. **The boot check's walkthrough used a single script** (fixture server, register, import, commit, list, shopping list and the doubled `mutationId`, SIGTERM)
   instead of separate `curl` calls; the requests and statuses are the ones the plan lists.
6. **Pass count 14684 in 160 files against the floor 14658** (section 9.1).
7. **No new ADR**: ADR 0014 gained its "Status after E3's integration" section only.
8. **Left for later milestones** (section 8, unchanged): finance (E4; `PromiseApiModule`, `fromPromiseModule`, `runModuleHook`), the scripts (E5; the
   bridges `backfillFoldedColumns` and `localizeImageUrl`), the web (E6), Hono and the route-file import order (E7; `docs/open-work.md` O-6), and the bridges the
   pinned tests need (E8).
