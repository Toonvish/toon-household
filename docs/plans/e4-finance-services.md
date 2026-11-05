# E4 — finance-services: plan

**Status: DONE (2026-11-05; integration record sections 9 and 10), planned and revised once after the plan review (2026-11-05: the two pinned bridges of
`finance-module.test.ts`, `module-adapter.test.ts` in E4-T01, idioms rule (10) in E4-T06, the local memo map of
`withFinanceServices`, `balance_stale` as `ApiFailure`, the seed's TDZ-safe provide, the multi-line route handlers).** Base commit `47907f200` (`E3 docs sync after the review: pass count, review round,
effect-schema pattern`), Bun 1.4.3 on the host (`.bun-version` says 1.4.2; nothing here depends on the difference). Sections 9
and 10 (the integration record and "what changed vs plan") are written by E4-T10.

E4 is the fifth milestone of the Effect migration (`docs/EFFECT.md` §4 E4; decisions E3, E5, E6, E7 for the finance module,
E9 for its tests, E12 for the idioms). Every finance file that does I/O becomes a `Context.Service` with a static `layer`
(participants, settings, categories, tags, the mutation claims, balance, transactions, summary, settlements, plan, accrual,
setup); the module's own `layer` is exported from the manifest and merged into the one `AppLayer`; the manifest stops being a
`PromiseApiModule` and implements `ApiModule<FinanceServices>` directly, so `PromiseApiModule` and `fromPromiseModule` are
deleted (`runModuleHook` stays for the scripts, E5); the hooks `onHouseholdCreated` (the 21 categories), `onEnable` (two
participants, D3, still BEFORE the `household_modules` upsert), `onMemberRemoving` (`409 member_has_ledger`, ADR 0004),
`seedDemo`, `start` and `shutdown` are Effects; the boot catch-up and the 6-hour accrual tick run on `Schedule` driven by the
`Clock`, with a `TestClock` test that advances six hours; `requireFinanceParticipant` and the finance routes call the runtime
(Hono stays until E7). The guiding sentence holds: how the code is written changes, not what it does. No `docs/API.md` row,
German string, table, migration, exit code, `details` payload or pinned log line changes.

Exit (`docs/EFFECT.md` §4 E4 and the milestone task): gates green (`bun install --frozen-lockfile`, `bun run typecheck`,
`bun test`, `bun run build`, `bun run i18n:check` read by hand); the pass count not below E3's record (14686, re-measured as this
plan's baseline, section 1.2); `halfForOther(-101) = -50` (`packages/shared/test/finance-money.test.ts`), the single-rounding
plan share and "a SECOND retroactive correction" and `isPeriodBooked` (`apps/api/test/finance-plan.test.ts`), `balance_stale`
(`apps/api/test/finance-settlements.test.ts`), `member_has_ledger` (`apps/api/test/finance-participants.test.ts`) and
`apps/api/test/finance-cross-household.test.ts` pass with their files unchanged (V-PINNED, P14); the fixed-cost boot catch-up
still books the two fixture rows of 51400 ct (CLAUDE.md "The first boot catches the fixed-cost plan up"; a new test pins it at
the M6 moment with a `TestClock`, E4-T06); the finance greps `LINKS_FIN`, `NOROUTER`, `NOCORE`, `NOSHADOW` of
`docs/modules/finance.md` §5.1 are clean; `git status --porcelain repos/` empty; `apps/api/test/effect-idioms.test.ts` green with
the finance entry of rule (10) removed and rule (11)'s `nowMs(` scan widened to finance; a boot of the API answers
`/api/health` and SIGTERM ends with `[db] database closed`, `[api] runtime disposed`, exit 0.

## 1. Context

### 1.1 State of the tree at plan time (`47907f200`, measured 2026-11-05)

- **E3 is done** (`docs/plans/e3-recipe-services.md` sections 9 and 10). `apps/api/src/runtime.ts` builds
  `AppLayer = Layer.suspend(appLayer)` with `appLayer()` = `Layer.mergeAll(Layer.empty, ...moduleLayers()).pipe(
  Layer.provideMerge(coreServicesLayer()), Layer.provideMerge(infraLayer()))`, annotated `Layer.Layer<AppServices,
  AppLayerError, never>`; `AppServices = InfraServices | CoreServices | ModuleServices`; `moduleLayers()` reads `API_MODULES`
  inside the function and casts each `module.layer` to `ModuleLayer<ModuleServices>` (the one documented cast).
  `apps/api/src/modules/types.ts` has `ApiModule<Services = never>` (hooks as Effects; the database hooks need
  `DatabaseService` only and fail with `HookError = ApiErrorFamily | DatabaseError`; `start?()` and `shutdown?()` are
  `Effect.Effect<void, unknown>` with NO requirement; `layer?: ModuleLayer<Services>` = `Layer.Layer<Services, never,
  ModuleRequirements>`, `ModuleRequirements = InfraServices | CoreServices`) and still the Promise contract `PromiseApiModule`.
  `apps/api/src/modules/index.ts`: `ModuleServices = RecipeServices`; `API_MODULES` is a lazy `Proxy` over
  `[recipeModule, fromPromiseModule(financeModule)]`. `apps/api/src/modules/adapter.ts` has `fromPromiseModule` and
  `runModuleHook` (never imports `runtime.ts`).
- **The core runs the database hooks with `Database` only.** `HouseholdModules` (`apps/api/src/core/services/households/modules.ts`)
  calls `module.onHouseholdCreated(id).pipe(Effect.provideService(Database, database))` and, inside `database.transaction`,
  `module.onEnable(...)` BEFORE the upsert; `removeMember` calls `onMemberRemoving` likewise. Outside the runtime
  `runMigrations`, `collectUploadReferences(database)` and `apps/api/scripts/seed.ts` run hooks through
  `runModuleHook(effect, executor)` (`Database.layerFromExecutor`), so a hook effect can rely on `Database` and nothing else.
  `apps/api/src/index.ts` runs `module.start()` and `module.shutdown()` through `runtime.runPromise` (boot after
  `await runtime.runPromise(Effect.void)`; SIGTERM/SIGINT: every module's `shutdown`, then `runtime.dispose()`).
- **The finance module** (`apps/api/src/modules/finance/`, 31 TS files, 4239 lines): services 2660 lines under
  `services/{participants,settings,categories,tags,ledger,plan}/` plus `services/support.ts`; routes 487 lines in 8 files;
  `setup.ts` (the household hooks), `seed.ts`, `middleware.ts`, `lib/clock.ts`, `schema.ts`, `index.ts` (a
  `PromiseApiModule`). Every service function takes the drizzle handle first (`db: DbLike` / `db: Database`), returns a
  `Promise`, throws `ApiError` (57 `ApiError` mentions in 11 files; idioms rule (10) allows them by the prefix
  `apps/api/src/modules/finance/`) and reads time from the module clock `lib/clock.ts` `nowMs()` (30 calls; `setClockForTest`
  is the test seam, F gotcha 4). Eight `withTransaction(` calls (`services/support.ts`'s finance variant: the shared client
  on a memory URL degrades, everything else opens a real transaction). No `Date.now(` / `new Date(` under finance
  `services/` (rule (11) holds); `Date.now()` / `new Date(` remain in `seed.ts` and `schema.ts` (outside `services/`).
- **The service graph** (who imports whom; it decides the waves, section 3): leaves over the database only:
  `participants.service.ts` (+ core `isPlaceholderUser`, `isUniqueViolation`, pure), `settings.service.ts` (+ `env.defaultLocale`),
  `categories.service.ts`, `tags.service.ts`, `ledger/idempotency.ts`, `ledger/aggregateExclusion.ts` (a query helper);
  `ledger/dateRange.ts` (pure, throws `ApiError.validationFailed`); `ledger/balance.service.ts` → participants,
  aggregateExclusion (`computeBalanceDelta` is pure); `ledger/transactions.service.ts` → participants, categories, tags,
  aggregateExclusion, balance (pure `computeBalanceDelta` only), dateRange, idempotency; `ledger/summary.service.ts` →
  participants, aggregateExclusion, balance (pure), dateRange; `ledger/settlements.service.ts` → settings, participants,
  categories, transactions (`toTransactionResponse`), idempotency, balance; `plan/plan.service.ts` → participants,
  `plan/period-scan.ts` (pure); `plan/accrual.service.ts` → categories, settings, participants, transactions
  (`toTransactionResponse`), tags, period-scan, plan; `plan/scheduler.ts` → accrual (a `setInterval` holder);
  `setup.ts` → categories `defaults.ts` (pure), participants, settings; `seed.ts` → core `enableModule` (Promise bridge),
  categories, balance, settlements, transactions, accrual, plan. Acyclic.
- **Finance → core imports** (what the conversion replaces): `db` (`db/client.ts`) in the eight route files, `middleware.ts`
  and `scheduler.ts`; `ApiError`; `requireUser` / `requireMembership` (sync bridges, `lib/types.ts`); `enableModule` (Promise
  bridge, `core/services/households/modules.ts`, finance seed only); `transactionsSupported` / `DbLike` / `Tx`
  (`core/services/households/support.ts`); `isPlaceholderUser`, `isUniqueViolation` (pure); `toIso` (pure); `env`
  (`defaultLocale`, `isProduction` in the seed); the middlewares `requireVerifiedEmail`, `requireHouseholdRole`; `validate`,
  `decodeOption`; `requestLocale`.
- **Outside callers of finance code** (they keep working through bridges, P1): `apps/api/scripts/plan-run.ts` (`runCatchUp`),
  `apps/api/scripts/legacy/balance.ts` (`getBalance`, inside `migrate:legacy`, whose import order is load-bearing),
  `apps/api/scripts/finance-import-xlsx.ts` (`slot1UserId`, `requireOtherMemberId`, `categoryIdBySlug`, `syncTransactionTags`,
  `withTransaction`, all on an executor it holds, `syncTransactionTags` INSIDE its own `withTransaction(db, async (tx) => …)`),
  `apps/api/src/index.ts` (`start`, `shutdown`), `apps/api/src/core/services/households/{modules,households.service}.ts` (the
  hooks), `apps/api/scripts/seed.ts` (`seedDemo` through `runModuleHook`).
- **Tests that call finance code directly** (everything else goes through `app.request`): `apps/api/test/finance-idempotency.test.ts`
  (`claimMutation`, `linkMutationClaim`, `pruneMutationClaims` on the shared `db`), `apps/api/test/finance-file-db.test.ts`
  (`createTransaction`, `createSettlement`, `ensureFinanceHousehold` on its own file DB; the finance and the core
  `withTransaction`, `transactionsSupported`), `apps/api/test/finance-seed.test.ts` (`seedFinanceDemo(db, ctx)`, the core
  `initializeHousehold` bridge), `apps/api/test/finance-security.test.ts` (`setClockForTest`; `runCatchUp(failing, …)` with a
  `Proxy` whose `transaction` rejects, asserting `rejects.toThrow("insert into")` and the audit marker `"TypeError: see server
  log"`), `apps/api/test/finance-participants.test.ts` (the probe `requireFinanceParticipant()` +
  `requireFinanceParticipantContext(c2)`, synchronous), `apps/api/test/finance-plan.test.ts` (`setClockForTest`),
  `apps/api/test/finance-module.test.ts` (`setClockForTest`; `financeModule`'s fields; and in `describe("(i)
  assignParticipants")` the Promise functions `assignParticipants(db, householdId, assignment)` (lines 341, 355, 365, 379) and
  `updateParticipantDisplayName(db, householdId, userId, displayName)` (line 374) imported from
  `services/participants/participants.service.ts` with the type `ParticipantAssignmentEntry`, its `rejection()` helper expecting
  `toBeInstanceOf(ApiError)`; the file is pinned, so both functions survive E4 as bridges, P1),
  `apps/api/test/legacy-finance.test.ts` (`getBalance(run.target.db, …)`), `apps/api/test/module-adapter.test.ts`
  (`fromPromiseModule`, `runModuleHook`, the registry case whose line 275 asserts `expect(finance?.layer).toBeUndefined()`, and
  line 207 `Effect.runPromise(start())` on a `fromPromiseModule` result, which stops typechecking once `start` requires
  `DatabaseService`: both are E4-T01's, P3),
  `apps/api/test/modules.test.ts` ((h), (h'), (i): `PromiseApiModule` literals wrapped by `fromPromiseModule`),
  `apps/api/test/support/finance-harness.ts` (`assignParticipants(db, …)`, `ensureFinanceHousehold(db, …)`, `nowMs()`).
- **Core bridges whose last outside caller is finance** (ADR 0014 "Status after E3"): `requireUser`, `requireMembership`
  (`apps/api/src/lib/types.ts`; finance routes and middleware; also called by `apps/api/test/errors.test.ts`,
  `apps/api/test/middleware.test.ts` (pinned), `apps/api/test/modules.test.ts`), `enableModule` (finance seed only),
  `initializeHousehold` (`apps/api/scripts/seed.ts` (E5), `apps/api/test/finance-seed.test.ts`). The core `nowMs()` of
  `apps/api/src/core/services/households/support.ts` has NO caller (finance uses its own `lib/clock.ts`); it is kept alive only
  by two allow-list entries of idioms rule (11).
- **Effect API facts looked up for this plan** (vendored `effect@4.0.5`): `Effect.schedule(self, schedule)`
  (`src/Effect.ts` ~8045) is `scheduleFrom(self, undefined, schedule)`, and `scheduleFrom` (`src/internal/schedule.ts` ~187-224)
  runs `step(initial)` BEFORE the first `self`: with `Schedule.spaced("6 hours")` the first execution comes after six hours,
  then six hours after each end (the `setInterval` shape; `Effect.repeat` would run once at once). `Schedule.spaced`
  (`src/Schedule.ts` ~1231), `Schedule.fixed` (~960), `Effect.forkDetach` (~8917), `Effect.catchCause` (~3333),
  `Effect.ignoreCause` (~4392), `Effect.onError` (~7000), `Fiber.interrupt` (`src/Fiber.ts` ~387), `Cause.squash` (~763),
  `Cause.hasInterruptsOnly` (~648), `Predicate.hasProperty` (`src/Predicate.ts` ~1172), `TestClock.layer`, `TestClock.adjust`,
  `TestClock.setTime` (`src/testing/TestClock.ts` ~553-667). `AppConfig.layer` is `Layer.sync(AppConfig, resolveProcessEnv)`
  (`apps/api/src/config.ts` ~616; the env is resolved once per process and cached). `Database.transaction` on a handed-in root
  calls that executor's `.transaction(…)`; a rejection of it becomes `DatabaseError({ cause })` (`apps/api/src/db/database.ts`
  ~105-123); `database.use(f)` maps a rejection to `DatabaseError({ cause })` too.

### 1.2 Baseline

`bun test` at `47907f200`, 2026-11-05, load average about 4: **14686 pass, 0 fail, 383591 expect() calls, 14686 tests in 160
files, 32.36 s** (log ends `exit=0`). This equals E3's record after its review (section 9.5b of the E3 plan). Every task verifies
`pass >= 14686` (P14); E4 adds tests, so the record at the end is higher. The four finance greps print nothing at the base.

### 1.3 Bundle size

Not asked for E4 (E6 and E7 record it). E4 touches no web file (`apps/web` is in V-PINNED); `bun run build` is run by E4-T10 as a
gate only.

## 2. Decisions (binding for the tasks)

Each names the `docs/EFFECT.md` decision it serves. A task that cannot follow one makes the smallest deviation and records it in
its commit body; E4-T10 copies it to section 10. Where a decision says "as E3 P<n>", the E3 plan's text
(`docs/plans/e3-recipe-services.md` section 2) applies with finance paths.

**P1 — Bridges keep every outside caller working, WITHOUT the runtime (E3, E7; ADR 0014).** The services convert in dependency
waves (section 3) and the routes and the manifest last, so a converted file keeps, for every old export a caller OUTSIDE the
task's own files still uses (a route, an unconverted service, `setup.ts`, `seed.ts`, the old manifest, a script, a test not
rewritten in this task), a bridge with the old name and signature, in the section `/* legacy bridges: callers listed; E3
(recipe), E4 (finance), E5 (scripts) remove them */` at the end of the file, each with a one-line comment naming its callers and
an explicit return type copied from the old signature. Finance bridges differ from recipe's in one point: **they never import
`apps/api/src/runtime.ts`.** `scripts/legacy/balance.ts` runs inside `migrate:legacy` (CLAUDE.md "The CLI never imports
`src/env.ts`, and its import order is load-bearing": the library takes the target `db` and must never use the shared one), and
`finance-import-xlsx.ts` calls a bridge inside an open drizzle transaction. So every finance Promise bridge is

```ts
export function slot1UserId(db: DbLike, householdId: string): Promise<string> {
  return runFinanceBridge(FinanceParticipants.use((service) => service.slot1UserId(householdId)), db);
}
```

with `runFinanceBridge(effect, executor)` (`apps/api/src/modules/finance/bridge.ts`, E4-T01): `runModuleHook(
withFinanceServices(effect), executor)` (P4: the services built with a local memo map over the handed executor), whose rejection is mapped once: a `DatabaseError` rejects with its
`cause` (the raw driver error the old Promise function threw: `plan-run.ts` prints `error.message`, and
`finance-security.test.ts` asserts `rejects.toThrow("insert into")`), anything else rejects with the squashed value unchanged (a
family refusal is the same object, `instanceof ApiError` holds). The mapping uses `.then(undefined, (error: unknown) =>
Promise.reject(isDatabaseError(error) ? error.cause : error))`, so the file holds no literal `throw`. The executor handed in is
honoured: `Database.layerFromExecutor(db)` makes it the root, so a bridge called inside an unconverted `withTransaction(db, async
(tx) => …)` runs on `tx`. A SYNCHRONOUS export stays synchronous over a service-free effect with `Effect.runSync` (no literal
`throw`): `requireFinanceParticipantContext(c)` (P9), `assertOwnClaim(claim)` (until E4-T04), `parseRangeBound(value, edge)`
(until E4-T04). A bridge whose last caller moves is deleted in that commit when its file belongs to the task that moved the
caller; otherwise E4-T09 deletes it (a dead bridge holds no `throw` and blocks no gate). **The survivors after E4 are exactly these nine**:
`runCatchUp(db, householdId, options)` (`services/plan/accrual.service.ts`; `apps/api/scripts/plan-run.ts` E5,
`apps/api/test/finance-security.test.ts` pinned), `getBalance(db, householdId, viewerUserId, viewerSlot, includeAggregates)`
(`services/ledger/balance.service.ts`; `apps/api/scripts/legacy/balance.ts` E5, `apps/api/test/legacy-finance.test.ts`),
`slot1UserId`, `requireOtherMemberId` (`services/participants/participants.service.ts`), `categoryIdBySlug`
(`services/categories/categories.service.ts`), `syncTransactionTags` (`services/tags/tags.service.ts`) (all four
`apps/api/scripts/finance-import-xlsx.ts`, E5), `assignParticipants(db, householdId, assignment): Promise<void>` and
`updateParticipantDisplayName(db, householdId, userId, displayName)` (its old result type) (`services/participants/participants.service.ts`;
Promise bridges over `runFinanceBridge`; a refusal rejects with the family member itself, which is `instanceof ApiError`, as the
test's `rejection()` helper wants; caller `apps/api/test/finance-module.test.ts` `describe("(i) assignParticipants")`, pinned,
E8; the type export `ParticipantAssignmentEntry` stays beside them), and the synchronous `requireFinanceParticipantContext(c)`
(`middleware.ts`; `apps/api/test/finance-participants.test.ts` pinned, E8). Copy each old signature exactly from the base
commit (`git show 47907f200:<path>`). `services/support.ts` keeps `withTransaction` (a plain Promise helper,
not a bridge: `finance-import-xlsx.ts` E5, `finance-file-db.test.ts` (a) and (d)), `escapeLikePattern` (pure) and the `DbLike`
/ `Tx` type re-exports.

**P2 — Service conventions (E7, E12; as E3 P2).** One `Context.Service` class per file, id
`"toon/api/modules/finance/<path from finance/ without .ts>/<Name>"` (e.g.
`"toon/api/modules/finance/services/participants/participants.service/FinanceParticipants"`), shape
`Context.Service<Self, { readonly method: (...) => Effect.Effect<A, E> }>()(id)`. **Method names are the old exported function
names with the leading `db` parameter dropped**; every other parameter, its order, its default and its result type stay
(`Promise<T>` becomes `Effect.Effect<T, E>` with every failure declared), so the route rewrite (E4-T08) is a table. Every method is
`Effect.fn("FinanceX.method")(function* (...) { … })` (`Effect.fnUntraced` for per-row helpers); combinators as extra
arguments of `Effect.fn`, never `.pipe` on it; `return yield*` when raising. `static readonly layer = Layer.effect(this,
Effect.gen(function* () { const database = yield* Database; const participants = yield* FinanceParticipants; … return
FinanceX.of({ … }) }))`: the static initializer reads no imported binding but `effect` exports and the class itself;
dependencies are yielded inside the generator; requirements stay open (never `Layer.provide(Other.layer)` in a static, CLAUDE.md
"One composition point"). Time (P6) and the current executor are read inside the method body on every call. The database is
reached only through `database.use((db) => …)` and `database.transaction(effect)`; no finance service calls `withTransaction`
or `nowMs` after its conversion. A private helper of a file (`loadPlanRow`-style readers, `recordRun`, `toResponse`) is a
`const` built with `Effect.fnUntraced` INSIDE the layer generator (it closes over `database` and the dependencies), or an
exported service-free helper whose only requirement is `Database` (as `sammelbuchungTransactionIds`, P2 table).

The service table (paths under `apps/api/src/modules/finance/`; "area" is the composition file of P4 that lists the service; the
owning task converts the file and adds the service to its area):

| File | Service | Depends on (inside the module layer) | Area file | Task |
| --- | --- | --- | --- | --- |
| `services/participants/participants.service.ts` | `FinanceParticipants` | `Database` | `services/participants/layer.ts` | T02 |
| `services/settings/settings.service.ts` | `FinanceSettings` | `Database`, `AppConfig` | `services/participants/layer.ts` | T02 |
| `services/categories/categories.service.ts` | `FinanceCategories` | `Database` | `services/categories/layer.ts` | T03 |
| `services/tags/tags.service.ts` | `FinanceTags` | `Database` | `services/categories/layer.ts` | T03 |
| `services/ledger/idempotency.ts` | `FinanceMutationClaims` | `Database` | `services/categories/layer.ts` | T03 |
| `services/ledger/balance.service.ts` | `FinanceBalance` | `Database`, `FinanceParticipants` | `services/ledger/layer.ts` | T04 |
| `services/ledger/transactions.service.ts` | `FinanceTransactions` | `Database`, `FinanceParticipants`, `FinanceCategories`, `FinanceTags`, `FinanceMutationClaims` | `services/ledger/layer.ts` | T04 |
| `services/ledger/summary.service.ts` | `FinanceSummary` | `Database`, `FinanceParticipants` | `services/ledger/layer.ts` | T04 |
| `services/ledger/settlements.service.ts` | `FinanceSettlements` | `Database`, `FinanceSettings`, `FinanceParticipants`, `FinanceCategories`, `FinanceTransactions`, `FinanceMutationClaims`, `FinanceBalance` | `services/ledger/layer.ts` | T04 |
| `services/plan/plan.service.ts` | `FinancePlan` | `Database`, `FinanceParticipants` | `services/plan/layer.ts` | T05 |
| `services/plan/accrual.service.ts` | `FinanceAccrual` | `Database`, `FinanceCategories`, `FinanceSettings`, `FinanceParticipants`, `FinanceTransactions`, `FinanceTags`, `FinancePlan` | `services/plan/layer.ts` | T06 |
| `setup.ts` | `FinanceSetup` | `Database`, `AppConfig`, `FinanceParticipants`, `FinanceSettings` | `services/setup/layer.ts` | T07 |

Methods (old names, `db` dropped): `FinanceParticipants`: `listParticipants`, `getParticipant`, `participantSlotOf`,
`otherMemberId`, `requireOtherMemberId`, `slot1UserId`, `assignParticipants`, `assertParticipantMayLeave`, `saveParticipants`,
`updateParticipantDisplayName`, `renamePlaceholderParticipant`. `FinanceSettings`: `loadHouseholdRow`, `ensureFinanceSettings`.
`FinanceCategories`: `listCategories`, `createCategory`, `updateCategory`, `deleteCategory`, `systemCategoryId`,
`categoryIdBySlug`, `categorySlugOf`, `categorySlugsByIds`. `FinanceTags`: `upsertTagsByName`, `syncTransactionTags`,
`clearTransactionTags`, `tagRefsOf`, `tagRefsByTransactionIds`, `listTags`, `updateTag`, `deleteTag` (`toTagResponse` stays a
pure export). `FinanceMutationClaims`: `claimMutation`, `linkMutationClaim`, `peekMutationClaim`, `pruneMutationClaims`
(`MUTATION_CLAIM_TTL_MS`, the `ClaimResult` type stay exports; `assertOwnClaim` becomes the service-free
`checkOwnClaim(claim): Effect<void, Conflict>`). `FinanceBalance`: `getBalance`, `getBalanceHistory` (`computeBalanceDelta`
stays a pure export). `FinanceTransactions`: `createTransaction`, `updateTransaction`, `deleteTransaction`, `getTransaction`,
`listTransactions`, `toTransactionResponse` (the old `export { toResponse as toTransactionResponse }`; `otherShareOf` stays a
pure export). `FinanceSummary`: `getTransactionSummary`. `FinanceSettlements`: `createSettlement`. `FinancePlan`:
`loadPlanRow`, `listPlanInputRows`, `isPeriodBooked`, `getPlanResponse`, `updatePlan`, `previewPlan`, `createFixedCostItem`,
`updateFixedCostItem`, `deleteFixedCostItem`, `createIncome`, `updateIncome`, `deleteIncome`, `listAccrualRuns`
(`toAccrualRunResponse` stays a pure export). `FinanceAccrual`: `runCatchUp`, `runPlanNow`, `recalculatePlan`. `FinanceSetup`:
`seedDefaultCategories`, `onFinanceHouseholdCreated`, `ensureFinanceHousehold`, `onFinanceEnable`.

Files that stay plain modules (no service; pure, a seam or a lifecycle): `services/categories/defaults.ts`,
`services/plan/period-scan.ts` (pure), `services/ledger/dateRange.ts` (`parseRangeBound` becomes a service-free
`Effect.fnUntraced` failing with `ValidationFailed` carrying today's details byte for byte, `{ path: edge, code:
"invalid_date", message: "\"<edge>\" is not a valid date or period" }` and no `i18n`), `services/ledger/aggregateExclusion.ts`
(`sammelbuchungTransactionIds(householdId)`: an exported `Effect.fnUntraced` whose requirement is `Database`, provided inside the
calling method with `Effect.provideService(Database, database)`), `services/support.ts` (P1), `services/plan/scheduler.ts` (the
process's one tick fiber, P8), `lib/clock.ts` (P6), `bridge.ts` and `layer.ts` (P4), `middleware.ts` (P9), `schema.ts`.

**P3 — The module contract (E7; SPEC §2).** E4-T01 changes `apps/api/src/modules/types.ts`: `start?(): Effect.Effect<void,
unknown, DatabaseService>` (was no requirement): the boot catch-up needs the database, and `apps/api/src/index.ts` already runs
`start()` through `runtime.runPromise`, which provides it; `shutdown?()` keeps no requirement. `docs/SPEC.md` §2's code block and
its "Hooks added after M0" text are updated in the same commit (no ADR: a §2 contract edit inside E7's "hooks become Effects", as
E3 did for `healthFeatures`). `apps/api/src/modules/index.ts`: `type ModuleServices = RecipeServices | FinanceServices`
(type-only import from `./finance/layer.ts`); until E4-T07 the finance entry is `{ ...fromPromiseModule(financeModule), layer:
Layer.suspend(financeLayer) }`, so the module's services are in the `AppLayer` (the routes and the middleware yield them) while
the hooks still come from the Promise manifest. That entry gives the registry's finance module a `layer`, so E4-T01 also changes the one assertion
`expect(finance?.layer).toBeUndefined()` of `apps/api/test/module-adapter.test.ts` (the registry case, line 275) to
`expect(finance?.layer).toBeDefined()` (its intent stays: the registry entry carries what the module provides; E4-T09 tightens it
to `toBe(financeModule.layer)` once the manifest is unwrapped), and, because `start?()` now requires `DatabaseService` and
`fromPromiseModule` returns `ApiModule`, its line 207 `await expect(Effect.runPromise(start())).rejects.toBe(reason)` becomes
`await expect(onPrimary(start())).rejects.toBe(reason)` (the file's own helper that provides `Database.layerFrom(primary)`; same
assertion). `fromPromiseModule`'s signature is not narrowed. Nothing else in that file changes before E4-T09. E4-T07 lists
`financeModule` unwrapped (`ApiModule<FinanceServices>`, the
compile-time guard of E3 P3 at the manifest). E4-T09 deletes `PromiseApiModule` (`types.ts`), `fromPromiseModule` and its private
helpers (`adapter.ts`; `runModuleHook` stays for `runMigrations`, `collectUploadReferences`, `scripts/seed.ts` and recipe's
`backfillFoldedColumns`, E5) and the `PromiseApiModule` paragraphs of `docs/SPEC.md` §2.

**P4 — One composition for the module, the hooks and the bridges (E7; CLAUDE.md "One composition point").**
`apps/api/src/modules/finance/layer.ts` (new, E4-T01, final form written once) exports `type FinanceServices` (the union of the
area types) and three hoisted functions:

```ts
/** Every finance service, the areas nested by dependency. */
export function financeLayer() {
  return Layer.mergeAll(setupLayer(), planLayer()).pipe(
    Layer.provideMerge(ledgerLayer()),
    Layer.provideMerge(Layer.mergeAll(participantsLayer(), categoriesLayer())),
  );
}

/** The same services with `AppConfig` provided: what a hook or a bridge needs besides `Database`. */
export function financeStandaloneLayer() {
  return financeLayer().pipe(Layer.provide(AppConfig.layer));
}

/**
 * Runs `effect` with the finance services built over the CURRENT `Database` (hooks, bridges, the scheduler), with a fresh
 * memo map (`local: true`), so a copy memoized by the runtime's `AppLayer` is never reused.
 */
export function withFinanceServices<A, E>(effect: Effect.Effect<A, E, FinanceServices | DatabaseService>): Effect.Effect<A, E, DatabaseService> {
  return effect.pipe(Effect.provide(financeStandaloneLayer(), { local: true }));
}
```

The area functions, each a hoisted `export function` with `export type <Area>Services` beside it, created by E4-T01 as
`Layer.empty` typed `never` and filled by their owner (P2 table): `services/participants/layer.ts` `participantsLayer()`
(T02: `Layer.mergeAll(FinanceParticipants.layer, FinanceSettings.layer)`), `services/categories/layer.ts` `categoriesLayer()`
(T03: `Layer.mergeAll(FinanceCategories.layer, FinanceTags.layer, FinanceMutationClaims.layer)`), `services/ledger/layer.ts`
`ledgerLayer()` (T04: `FinanceSettlements.layer.pipe(Layer.provideMerge(Layer.mergeAll(FinanceBalance.layer,
FinanceTransactions.layer, FinanceSummary.layer)))`), `services/plan/layer.ts` `planLayer()` (T05: `FinancePlan.layer`; T06:
`FinanceAccrual.layer.pipe(Layer.provideMerge(FinancePlan.layer))`), `services/setup/layer.ts` `setupLayer()` (T07:
`FinanceSetup.layer`). Inside an area a service that needs a sibling sits in an outer `Layer.provideMerge` step, never beside it
in one `Layer.mergeAll`. The outer nesting satisfies every cross-area edge of the P2 table (ledger needs participants and
categories; plan needs ledger, participants and categories; setup needs participants); a task whose service needs an edge the
nesting lacks stops and reports it. What `financeLayer()` leaves open is `Database | AppConfig` (both `ModuleRequirements`); the
manifest exports it as `layer: Layer.suspend(financeLayer)`.

**Why the hooks build their own services, and why with a local memo map.** The database hooks are typed `Effect<void,
HookError, DatabaseService>` and are run OUTSIDE the runtime too (`runModuleHook` in `scripts/seed.ts`, `runMigrations`), where
nothing but `Database` exists; a `Layer`'s output is contravariant, so the registry cannot carry module-service requirements on
the hooks. Each finance hook therefore wraps its program in `withFinanceServices(...)`, and so do the bridges (P1, through
`runFinanceBridge`) and the scheduler (P8). The `{ local: true }` is load-bearing: a plain `Effect.provide(layer)` builds through
`Layer.buildWithScope`, which takes `CurrentMemoMap.forkOrCreate(fiber.context)` (`repos/effect/packages/effect/src/Layer.ts`
~781-794), a CHILD of the runtime's `appMemoMap`, and `MemoMapImpl.get` (~431-441) falls back to the parent for a layer the child
lacks; inside the runtime the static leaf layers (`FinanceParticipants.layer`, …), already memoized when `AppLayer` was built and
bound to the runtime's `Database` service, would be reused. `Effect.provide(layer, { local: true })` builds with
`Layer.makeMemoMapUnsafe()` (`src/internal/layer.ts` ~12-18): every finance service is built (stateless closures, microseconds)
over the `Database` service the calling fiber holds. Inside the runtime that is the runtime's `Database` (whose current executor
is the core's transaction for a hook, exactly the `tx` the Promise hook received); in a test that provides `Database.layerFrom(…)`
/ `layerFromUrl(…)` or `Database.withExecutor(db)`, it is that database, never the shared test DB by accident. The runtime's own
copy (the manifest `layer`) serves the routes and the middleware. No finance service holds state, so the copies cannot disagree.
The same rule holds for any other layer finance code provides itself (`HouseholdModules.layer` in the seed, P5):
`Effect.provide(<layer>, { local: true })`.

**P5 — The hooks as Effects (E7; module doc 1.4, 4a "Enabling finance needs two participants", "A seated participant cannot
leave while the ledger has rows").** In E4-T07, `apps/api/src/modules/finance/index.ts`:
- `onHouseholdCreated: (householdId) => withFinanceServices(FinanceSetup.use((setup) =>
  setup.onFinanceHouseholdCreated(householdId)))`: the 21 categories and the `finance_settings` row (creator's locale if `de`/`en`,
  else `AppConfig.defaultLocale`), on every new household, finance enabled or not.
- `onEnable: (householdId, settings) => withFinanceServices(FinanceSetup.use((setup) => setup.onFinanceEnable(householdId,
  settings)))`: settings with `participants` decode with `decodeOption(FinanceEnableSettingsSchema, …)` and go through
  `assignParticipants` (PUT rules), without them the two seats must exist, else `422 finance_participants_required` and nothing
  written; then `ensureFinanceHousehold` (plan row `enabled: false`, payer slot 1, `start_period` = the module clock's period). The
  core still runs it BEFORE the upsert, inside its transaction (unchanged `HouseholdModules.enableModule`). The `"participants"
  in settings` guard becomes `Predicate.hasProperty(settings, "participants")`.
- `onMemberRemoving: (householdId, userId) => withFinanceServices(FinanceParticipants.use((participants) =>
  participants.assertParticipantMayLeave(householdId, userId)))`: the veto `409 member_has_ledger` and the seat release with the
  slot-1 re-seat and the payer move (ADR 0004), on the one executor of the core's `removeMember`.
- `seedDemo: (context) => seedFinanceDemo(context)` where `seed.ts` exports `seedFinanceDemo = Effect.fn("FinanceModule.seedDemo")
  (…)` whose body runs through `withFinanceServices` and `HouseholdModules.layer` (the core service, reached through its tag; its
  layer needs `Database` only), so the hook's requirement stays `Database` under `runModuleHook`. **TDZ rule (P13):** `seed.ts`
  sits inside the cycle `users.ts` → core `households/modules.ts` → `modules/index.ts` → `finance/index.ts` → `seed.ts` → core
  `households/modules.ts` (still evaluating), so nothing at the module scope of `seed.ts` may READ `HouseholdModules` (or any core
  binding). The combinators passed to `Effect.fn` are evaluated at module scope, so they must be lambdas that read the bindings
  only when called: `export const seedFinanceDemo = Effect.fn("FinanceModule.seedDemo")(function* (context: SeedContext) { … },
  (effect) => effect.pipe(Effect.provide(HouseholdModules.layer, { local: true })), (effect) => withFinanceServices(effect))`
  (never `Effect.provide(HouseholdModules.layer)` written directly as an argument). The pinned `import-order.test.ts` probes
  `users.ts` first and catches the mistake. The seed
  enables finance with `HouseholdModules.enableModule(householdId, "finance", { participants: [...] })` instead of the core
  `enableModule` Promise bridge (deleted in the same commit). Same idempotency, same `[seed] …` lines, same German demo content.
  `Date.now()` / `new Date(…)` stay in `seed.ts` (outside `services/`, as recipe's seed, E3 P9) except the module-clock read
  `nowMs()`, which becomes `yield* financeTimeMillis` (P6). `Bun.password.hash` runs in `Effect.promise`.
- `start: () => startAccrualSchedule()` and `shutdown: () => stopAccrualSchedule()` (P8).
- No `afterMigrate`, `uploadReferences` or `healthFeatures`: finance stores no upload and needs no backfill (unchanged absence;
  `apps/api/src/core/services/media/references.ts` is not touched).

**P6 — Time: the module clock becomes an Effect over the `Clock` (E7, E12; module doc 4a "The `start` hook and the clock", F
gotcha 4).** E4-T01 adds to `apps/api/src/modules/finance/lib/clock.ts`:
`export const financeTimeMillis: Effect.Effect<number> = Effect.suspend(() => override === null ? Clock.currentTimeMillis :
Effect.succeed(override));` (module scope reads only `effect` exports and the file's own `override`). Every `nowMs()` in a
converted file becomes `yield* financeTimeMillis`, read inside the method body. `setClockForTest(ms | null)` stays (the pinned
`finance-plan.test.ts`, `finance-module.test.ts`, `finance-security.test.ts` pin "now" with it before going through `app.request`;
the override wins over any `Clock`), and so does the synchronous `nowMs()` (its one caller after E4 is
`apps/api/test/support/finance-harness.ts`; the definition is allow-listed in rule (11), P12). Without an override the time is the
fiber's `Clock`, so a `TestClock` drives the scheduler, the catch-up and every row stamp (E9). Never capture the time at layer
build.

**P7 — Errors (E6, E12; as E3 P8).** Every finance refusal becomes a family member with the same status, code, text and details:

| Old | New |
| --- | --- |
| `throw ApiError.notFound(T)` / `ApiError.notFound()` | `return yield* new NotFound({ text: T })` / `new NotFound()` |
| `throw ApiError.badRequest(T, D?)` | `return yield* new BadRequest({ text: T, details: D })` |
| `throw ApiError.forbidden()` | `return yield* new Forbidden()` |
| `throw ApiError.conflict(C, T)` (e.g. `member_has_ledger`, `plan_disabled`; NO details) | `return yield* new Conflict({ code: C, text: T })` (`Conflict` has only `code` and `text`, `apps/api/src/lib/errors.ts` ~113-121) |
| `throw ApiError.validationFailed(D, T?)` | `return yield* new ValidationFailed({ details: D, text: T })` |
| `throw ApiError.internal()` (`slot1UserId`) | `return yield* new Internal()` |
| `new ApiError(S, C, T, D?)` (e.g. `422 finance_participants_required`, `403 finance_not_participant`) | `new ApiFailure({ status: S, code: C, text: T, details: D })`, raised with `return yield*` |
| `throw new ApiError(409, "balance_stale", { key: "server.balance.stale", values }, { currentBalanceCents })` (`settlements.service.ts` ~76-81) | `return yield* new ApiFailure({ status: 409, code: "balance_stale", text: { key: "server.balance.stale", values }, details: { currentBalanceCents } })`: the one 409 that carries `details`, so it is an `ApiFailure`, never a `Conflict` (a `Conflict` would be a tsc excess-property error, or drop `details.currentBalanceCents` from the wire; the pinned `finance-settlements.test.ts` reads it) |
| `try { write } catch (e) { if (isUniqueViolation(e)) <recover> else throw e }` | `database.use(…).pipe(Effect.catchTag("DatabaseError", (e) => isUniqueViolation(e.cause) ? <recovery> : Effect.fail(e)))` (F gotcha 51: `isUniqueViolation` walks drizzle's cause chain) |
| a helper that returned an `ApiError` (`participantsRequired()`, `participantInUse()`, `notParticipant()`) | a module-level function returning the family member (`new ApiFailure(...)` / `new Conflict(...)`), raised with `return yield*` |

Look up each class's fields and defaults in `apps/api/src/lib/errors.ts` before writing (`Conflict` takes `code` and `text`
only, `Forbidden` defaults its text; any refusal with `details` other than `ValidationFailed` / `BadRequest` is an `ApiFailure`). **Catch-all stays catch-all** (CLAUDE.md "Catch-all stays catch-all"): `accrual.service.ts`'s `catch (error)`
around the booking transaction becomes `Effect.catchCause((cause) => …)` that, unless `Cause.hasInterruptsOnly(cause)`, logs
`[plan] catch-up failed for household <id>:` with the ORIGINAL error (`const squashed = Cause.squash(cause); const original =
isDatabaseError(squashed) ? squashed.cause : squashed`), writes the audit row with `error` = `` `${original.name}: see server log` ``
when `Predicate.isError(original)`, else `"unknown error: see server log"` (F gotcha 73: the name only, never the message), and
then fails with the SAME cause (`Effect.failCause(cause)`); the scheduler's per-household loop recovers every cause (P8). After E4 no
non-comment line under `apps/api/src/modules/finance/` names `ApiError` (E4-T09 greps it, `nothrow` of P14).

**P8 — The scheduler: boot catch-up and the 6-hour tick on `Schedule`, driven by the `Clock` (E7, E12; module doc 4a "The `start`
hook and the clock", HD4).** In E4-T06, `services/plan/scheduler.ts` becomes a plain module (not a service: it holds the
process's one tick fiber, a lifecycle, not a dependency):
- `financeHouseholdIds` = `Effect.fnUntraced` over `Database` (same join: households with a `household_modules` row
  `finance`).
- `runForEveryHousehold(trigger: "boot" | "interval")` = `Effect.fn("FinanceScheduler.runForEveryHousehold")`, requirement
  `FinanceAccrual | Database`: for each id, `accrual.runCatchUp(id, { trigger, requireEnabled: false, throwOnIncomplete: false })`
  recovered with `Effect.catchCause` that logs `` `[plan] catch-up failed for household ${id}:` `` and the squashed cause (a
  `DatabaseError` logs its `cause`), today's line; the other households still get their run. It never fails on a household.
- `startAccrualSchedule(): Effect.Effect<void, DatabaseError, DatabaseService>` = `withFinanceServices(Effect.gen(…))`:
  `yield* runForEveryHousehold("boot")` (awaited, as today; a failure of `financeHouseholdIds` itself fails `start`, which
  `apps/api/src/index.ts` logs as `[api] start of module finance failed:` and the tick is then not started, as today), then,
  unless a tick fiber is already stored (idempotent), `tickFiber = yield* Effect.forkDetach(intervalTick)` where
  `intervalTick = Effect.schedule(runForEveryHousehold("interval").pipe(Effect.catchCause((cause) => Effect.sync(() =>
  console.error("[plan] interval catch-up failed:", Cause.squash(cause))))), Schedule.spaced("6 hours"))`: the first interval
  run comes six hours after the start (section 1.1: `Effect.schedule` steps the schedule before the first run), one tick's
  failure never ends the schedule (today an interval rejection was an unhandled rejection and `setInterval` went on). The forked
  fiber inherits the start fiber's context (`Database`, its executor, the `Clock`), and builds its own finance services through
  `withFinanceServices`. `tickFiber` is a module-level `let` (the old `intervalHandle`).
- `stopAccrualSchedule(): Effect.Effect<void>` = `Effect.suspend(() => { const fiber = tickFiber; tickFiber = undefined; return
  fiber === undefined ? Effect.void : Fiber.interrupt(fiber); })`: the manifest's `shutdown`, which `apps/api/src/index.ts` runs
  BEFORE `runtime.dispose()`, so the tick never outlives the database.
- Under `bun test` `start` is never called (unchanged); the tests call `startAccrualSchedule` / `stopAccrualSchedule` themselves.
- **The `TestClock` test** (new `apps/api/test/finance-scheduler.test.ts`, E4-T06), on the legacy fixtures (P11): one
  `runTest(…, { clock: "test" })` with `Database.withExecutor(run.target.db)`: `TestClock.setTime(Date.UTC(2026, 9, 31, 20, 0))`
  (31 Oct 2026 21:00 Berlin), `startAccrualSchedule()` books `2026-09` and `2026-10` for FH1 (boot rows), `TestClock.adjust("5
  hours")` + a bounded real-time poll: no `interval` run and no `2026-11` row; `TestClock.adjust("1 hour")` (1 Nov 2026 03:00
  Berlin) + a bounded real-time poll (`Effect.promise(() => Bun.sleep(10))`, at most 500 rounds: the catch-up's database I/O is
  real and finishes after `adjust` returns): one `finance_accrual_runs` row with `trigger = "interval"` per finance household and a
  `fixed_plan` row for `2026-11` of 51400 ct with `booked_at` = 1 Nov 2026 00:00 Berlin; `stopAccrualSchedule()` in
  `Effect.ensuring`. Explicit test timeout 60 s (CLAUDE.md "A test that runs sharp carries an explicit time budget": the same
  reason, load).
- **The boot catch-up of the fixtures** (same file): `TestClock.setTime(Date.UTC(2026, 9, 15, 8, 59, 36))` (the M6 rehearsal's
  boot, 15 Oct 2026 10:59:36 Berlin), `startAccrualSchedule()` then `stopAccrualSchedule()`: exactly two new `fixed_plan` rows for
  FH1, `Fixkostenanteil 09/2026` and `Fixkostenanteil 10/2026` (the household's locale), 51400 ct each, and `getBalance` for FH1
  from slot 1 = 222286 ct (= the report's 119486 + 2 x 51400); FH2's balance stays 2100 ct (CLAUDE.md "The first boot catches
  the fixed-cost plan up").

**P9 — Routes and the participant gate on the runtime (E7, E8 order unchanged; as E3 P14; module doc 4a "Participants and the
gate").** `apps/api/src/modules/finance/middleware.ts` (E4-T02): `requireFinanceParticipant()` stays a hoisted `function`
declaration whose body reads no imported binding until a request arrives (CLAUDE.md "Middleware factories are TDZ-safe"); the
returned handler does its database work as ONE `await runtime.runPromise(Effect.gen(function* () { const membership = yield*
currentMembership(c); const participants = yield* FinanceParticipants; const slot = yield*
participants.participantSlotOf(membership.householdId, membership.userId); if (slot === null) return yield* notParticipant();
return { householdId: membership.householdId, userId: membership.userId, memberSlot: slot }; }))`, then `c.set(
"financeParticipant", …)` and `await next()` outside the effect. `notParticipant()` = `new ApiFailure({ status: 403, code:
"finance_not_participant", text: "server.finance.notParticipant" })`. New: `export const currentFinanceParticipant =
Effect.fnUntraced(function* (c: AppContext): Effect.fn.Return<FinanceParticipantContext, ApiFailure> { … })` (the variable, or the
same 403). Kept: the module-local `declare module "hono" { interface ContextVariableMap { financeParticipant: … } }` and the
`FinanceParticipantContext` interface; the synchronous `requireFinanceParticipantContext(c)` becomes the bridge
`Effect.runSync(currentFinanceParticipant(c))` (pinned `finance-participants.test.ts`, E8). Routes (E4-T08): handler shape
`(c) => runtime.runPromise(Effect.gen(function* () { … }))`, services yielded at the top, `requireHouseholdContext(c)` →
`yield* currentFinanceParticipant(c)`, `requireUser(c)` / `requireMembership(c)` → `yield* currentUser(c)` / `yield*
currentMembership(c)`, `await fn(db, args)` → `yield* service.fn(args)` (one-line and multi-line calls, E4-T08's table). Middleware arguments (`requireVerifiedEmail()`,
`requireFinanceParticipant()`, `requireHouseholdRole("admin")`, `validate(...)`), `c.req.valid(...)`, `requestLocale(c)`, the
`created(c, body, location)` / `json` / `noContent` responses, the `/summary` before `/:transactionId` order and
`routes/index.ts` stay. Every by-id lookup keeps its `householdId` filter in the service (D8; `finance-cross-household.test.ts`
pinned).

**P10 — Transactions and idempotency inside the services (E5; F gotchas 2, 10, 47, 73).** `withTransaction(db, async (tx) => …)`
becomes `database.transaction(Effect.gen(function* () { … }))`; every sibling-service call inside it runs on the open transaction
automatically (the current executor is a `Context.Reference` read per call), so the claim, the row and the tag sync of
`createTransaction` stay atomic (`finance-file-db.test.ts` (c): a failing tag insert leaves neither the row nor the claim).
`claimMutation` stays an `INSERT … ON CONFLICT DO NOTHING RETURNING` on the primary key; a replay answers the current state with
`applied: false`; the read paths filter on the household. `saveParticipants` = `database.transaction(assignParticipants(...))`;
inside the core's enable transaction `assignParticipants` runs inline (a nested `transaction` runs inline, no savepoint), exactly
as `assignParticipants(tx, …)` did. The accrual booking and `lastBookedPeriod` share one transaction; the audit row is written
after it settles (P7). `Promise.all` (`listAccrualRuns`, anywhere else) becomes `Effect.all([...])` (sequential is fine: one
connection; results identical).

**P11 — Tests (E9; as E3 P15).** A finance test that calls a converted function directly is rewritten onto the service in the
task that converts it, keeping every assertion: `runTest(Service.use((s) => s.method(...)))`, on another database
`….pipe(Database.withExecutor(db))`, a refusal `await runTest(Effect.flip(effect))` (`apps/api/test/support/effect.ts`). Owners:
`finance-idempotency.test.ts` (T03), `finance-file-db.test.ts` (b) and (c) (T04) and its `ensureFinanceHousehold` call (T07),
`finance-seed.test.ts` and `support/finance-harness.ts` (T07, the harness's exports and their behaviour unchanged),
`module-adapter.test.ts` lines 207 and 275 (T01, P3: the `start` call through `onPrimary`, the registry's finance `layer`
defined), `modules.test.ts` (h), (h'), (i) and the rest of `module-adapter.test.ts` (T09: the `PromiseApiModule` literals become `ApiModule` literals
with Effect hooks, e.g. `onEnable: () => Effect.fail(refusal)`; every case keeps its assertion, `rejects.toBe(refusal)` included,
and the count of cases in each file does not drop; T09 tightens the registry line to `expect(finance?.layer).toBe(financeModule.layer)`).
A test that runs finance code on a database other than the shared one hands it in with `Database.withExecutor(db)` or a
`Database` layer (`layerFrom`, `layerFromUrl`); both reach the finance services because `withFinanceServices` builds them with a
local memo map (P4), and the routes' copy is never used on such a database. The pinned `finance-module.test.ts` keeps calling the
two participant bridges of P1. New tests: `apps/api/test/finance-clock.test.ts` (T01: `financeTimeMillis`
returns the override, else the `TestClock`'s time; `runFinanceBridge` resolves a value, rejects a family refusal as the same
object and a `DatabaseError` with its `cause`; at least 5 cases), `apps/api/test/finance-scheduler.test.ts` (T06, P8: the tick at
+6 h and the fixtures' boot catch-up). **Pinned, never edited in E4** (V-PINNED, P14): `finance-plan`, `finance-settlements`,
`finance-participants`, `finance-cross-household`, `finance-balance`, `finance-transactions`, `finance-categories`,
`finance-tags`, `finance-module`, `finance-security` (it keeps calling the `runCatchUp` bridge, P1; E5 rewrites it when
`plan-run.ts` moves), `finance-import-xlsx`, `legacy-finance`, `legacy-cli`, `legacy-placeholders`, `api-doc`, `middleware`,
`import-order`, `db-pragmas`, `placeholders`, `security` (all `apps/api/test/*.test.ts`), plus `docs/API.md`, `apps/api/drizzle`,
`apps/api/scripts`, `apps/api/src/modules/recipe`, `packages/shared`, `apps/web`. A task whose conversion would need one of them
changed stops and reports it. `bun test` never drops below 14686 passes. Seams stay and are handed back (`setClockForTest(null)`
in `afterAll` / `afterEach`, never `mock.module`, F gotcha 4).

**P12 — The idioms gate (E12).** `apps/api/test/effect-idioms.test.ts` is touched by E4-T06 (rule (10)) and E4-T09 (rule (11)),
never by two tasks of one wave. (a) Rule (10), in E4-T06: the only lines that match `THROW_API_ERROR`
(`/\bthrow\s+(?:new\s+)?ApiError\b/`) are in the finance service files (at the base: categories 6, `dateRange.ts` 1,
`idempotency.ts` 1, settlements 5, transactions 5, participants 7, accrual 3, plan 10, tags 2; `setup.ts` and `middleware.ts`
throw helpers the regex does not match). The task that converts the last of them is E4-T06 (`accrual.service.ts`, wave 4, after
T02 to T05). From that commit on, the test "every allow-list entry still matches" (`expectNoStaleEntries` over
`ALLOW_THROW_API_ERROR`) would fail on the stale `"apps/api/src/modules/finance/"` entry, so E4-T06 removes it in the same commit
(empty list; `expectNoStaleEntries` passes on an empty list) after checking `grep -rnE 'throw\s+(new\s+)?ApiError\b'
apps/api/src` prints nothing, and updates the list's comment (E3 and E4 done). If that grep still hits after E4-T06's conversion
(a bridge or a helper of an earlier task kept a literal `throw`), E4-T06 stops and reports the line instead of keeping the entry.
(b) Rule (11), in E4-T09: the core `nowMs()` of
`apps/api/src/core/services/households/support.ts` is deleted (no caller) and with it its entries in `ALLOW_SERVICE_DATE` and
`ALLOW_NOW_MS`; (c) the `nowMs(` scan (`CORE_FILES`) widens to `apps/api/src/modules/finance/` with the one allow entry
`"apps/api/src/modules/finance/lib/clock.ts"` (the definition of the module clock's synchronous read, kept for the test harness);
the comments name E4 as done and the "rule bites" cases stay. No task relaxes a rule.

**P13 — Import cycle and TDZ (CLAUDE.md "API import cycle", "Middleware factories are TDZ-safe"; E3 P17).** Nothing in the
module runs an effect or reads `API_MODULES` at module scope; static `layer` initializers read only `effect` exports and their
class; `layer.ts`, the area files and `bridge.ts` export hoisted functions only; module-scope constants built with `Effect.fn` /
`Effect.fnUntraced` / `Effect.suspend` read only `effect` (and `lib/clock.ts`'s own `override`), and a combinator passed to
`Effect.fn` that needs a core or finance binding is a lambda that reads it when called (the seed's `HouseholdModules.layer`, P5);
the manifest reads
`financeLayer` (a hoisted function binding) at module scope and everything else inside function bodies. E4-T01 adds
`./src/modules/finance/layer.ts`, `./src/modules/finance/bridge.ts` and `./src/modules/finance/lib/clock.ts` to
`apps/api/test/import-order-effect.test.ts`; E4-T09 probes each converted service file, `middleware.ts`, `setup.ts`, `seed.ts`
and the eight route files first in a fresh process and adds every file that loads first and builds the `AppLayer`; a route file
that dies when imported first (the E3 shape: `routes/index.ts` reads the route bindings at module scope) is NOT added and joins
`docs/open-work.md` O-6 (E4-T10).

**P14 — Verification.** E4-T01 creates `docs/plans/e4-verify.sh` with exactly the content of the block below (executable with
`bash`; it is the one place the long commands live); every task runs, among its own commands, `bash docs/plans/e4-verify.sh
types`, `idioms`, `order`, `pinned`, `repos`, `greps` and `suite` (or `all`, which runs them in that order):

```bash
#!/usr/bin/env bash
# The verification snippets of plan docs/plans/e4-finance-services.md (P14). Run from anywhere:
#   bash docs/plans/e4-verify.sh <suite|pinned|greps|repos|nothrow|types|idioms|order|all>
# Each subcommand exits 0 on success and non-zero with the evidence printed on failure.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

BASE=47907f200   # E4 base commit (plan section 1.1)
FLOOR=14686      # pass count of the base (plan section 1.2)

suite() {
  local log
  log="$(mktemp)"
  bun test >"$log" 2>&1
  local status=$?
  tail -6 "$log"
  if [ "$status" -ne 0 ]; then
    grep -nE '^\(fail\)|Unhandled error' "$log" | head -40
    echo "[e4-verify] bun test exited $status (log: $log)"
    return 1
  fi
  local pass
  pass="$(grep -oE '^ *[0-9]+ pass' "$log" | awk '{print $1}' | tail -1)"
  if [ -z "$pass" ] || [ "$pass" -lt "$FLOOR" ]; then
    echo "[e4-verify] pass count ${pass:-?} is below the floor $FLOOR"
    return 1
  fi
  echo "[e4-verify] suite OK: $pass pass (floor $FLOOR)"
}

pinned() {
  git diff --quiet "$BASE" -- \
    apps/api/test/finance-plan.test.ts \
    apps/api/test/finance-settlements.test.ts \
    apps/api/test/finance-participants.test.ts \
    apps/api/test/finance-cross-household.test.ts \
    apps/api/test/finance-balance.test.ts \
    apps/api/test/finance-transactions.test.ts \
    apps/api/test/finance-categories.test.ts \
    apps/api/test/finance-tags.test.ts \
    apps/api/test/finance-module.test.ts \
    apps/api/test/finance-security.test.ts \
    apps/api/test/finance-import-xlsx.test.ts \
    apps/api/test/legacy-finance.test.ts \
    apps/api/test/legacy-cli.test.ts \
    apps/api/test/legacy-placeholders.test.ts \
    apps/api/test/api-doc.test.ts \
    apps/api/test/middleware.test.ts \
    apps/api/test/import-order.test.ts \
    apps/api/test/db-pragmas.test.ts \
    apps/api/test/placeholders.test.ts \
    apps/api/test/security.test.ts \
    docs/API.md apps/api/drizzle apps/api/scripts apps/api/src/modules/recipe packages/shared apps/web \
    && echo "[e4-verify] pinned files unchanged since $BASE" \
    || { echo "[e4-verify] a pinned file changed:"; git diff --stat "$BASE" -- apps/api/test docs/API.md apps/api/drizzle apps/api/scripts apps/api/src/modules/recipe packages/shared apps/web | tail -20; return 1; }
}

greps() {
  local failed=0
  # LINKS_FIN: no unprefixed (toon-finance) link target in the module
  if grep -rnE "(\bto[=:] ?|\bgo\(|\bgoTo\()[\"'\`]/(transactions|new|plan|categories|household)\b|\bto[=:] ?[\"']/[\"']" apps/web/src/modules/finance; then
    echo "[e4-verify] LINKS_FIN hit"; failed=1
  fi
  # NOROUTER: typed router hooks do not survive in screens
  if grep -rnE "\b(Link|useNavigate|useParams|useBlocker)\b[^;]*from \"@tanstack/react-router\"" apps/web/src/modules/finance/features apps/web/src/modules/finance/components; then
    echo "[e4-verify] NOROUTER hit"; failed=1
  fi
  # NOCORE: no unprefixed catalog keys
  if grep -rnE "[\"'\`](common|nav|transactions|categories|plan|balance|settings)\.[a-zA-Z]" apps/web/src/modules/finance --include='*.ts' --include='*.tsx' --exclude-dir=catalogs; then
    echo "[e4-verify] NOCORE hit"; failed=1
  fi
  # NOSHADOW: no bare tag or pagination names from @toon/shared
  local d
  d=$(command ls -d apps/web/src/modules/finance apps/api/src/modules/finance apps/api/scripts 2>/dev/null; true)
  # shellcheck disable=SC2086
  if grep -rnP '^\s*(type )?(TagListResponse|TagResponse|UpdateTagRequest|PaginationQuery)(Schema)?,?\s*$|^import (type )?\{[^}]*(?<!as )(?<![A-Za-z])(TagListResponse|TagResponse|UpdateTagRequest|PaginationQuery)(Schema)?(?![A-Za-z])[^}]*\} from "@toon/shared"' $d; then
    echo "[e4-verify] NOSHADOW hit"; failed=1
  fi
  [ "$failed" -eq 0 ] && echo "[e4-verify] finance greps clean (LINKS_FIN, NOROUTER, NOCORE, NOSHADOW)"
  return "$failed"
}

repos() {
  local dirty
  dirty="$(git status --porcelain repos/ | wc -l)"
  [ "$dirty" -eq 0 ] && echo "[e4-verify] repos/ clean" || { git status --porcelain repos/ | head; return 1; }
}

# Non-comment lines under the finance module that still name ApiError, nowMs( (outside lib/clock.ts) or withTransaction(
# (outside services/support.ts, the Promise helper the xlsx script keeps until E5). Used by E4-T09 and E4-T10 only.
nothrow() {
  local hits
  hits="$(grep -rnE '\bApiError\b|\bnowMs\s*\(|\bwithTransaction\s*\(' apps/api/src/modules/finance \
    | grep -vE '^[^:]+:[0-9]+:\s*(\*|//|/\*)' \
    | grep -vE '^apps/api/src/modules/finance/lib/clock\.ts:' \
    | grep -vE '^apps/api/src/modules/finance/services/support\.ts:' || true)"
  if [ -n "$hits" ]; then echo "$hits"; echo "[e4-verify] ApiError / nowMs( / withTransaction( left in finance code"; return 1; fi
  echo "[e4-verify] no ApiError, nowMs( or withTransaction( in finance code (comments, lib/clock.ts and services/support.ts aside)"
}

types() { bun run typecheck; }
idioms() { bun test apps/api/test/effect-idioms.test.ts; }
order() { bun test apps/api/test/import-order.test.ts apps/api/test/import-order-effect.test.ts apps/api/test/legacy-cli.test.ts; }

case "${1:-}" in
  suite) suite ;;
  pinned) pinned ;;
  greps) greps ;;
  repos) repos ;;
  nothrow) nothrow ;;
  types) types ;;
  idioms) idioms ;;
  order) order ;;
  all) types && idioms && order && pinned && repos && greps && suite ;;
  *) echo "usage: bash docs/plans/e4-verify.sh <suite|pinned|greps|repos|nothrow|types|idioms|order|all>"; exit 2 ;;
esac
```

The planner ran `pinned`, `greps`, `repos` and `nothrow` of this block at the base: the first three pass, `nothrow` lists the 57
`ApiError` lines (expected until E4-T09). A failing suite keeps its `(fail)` lines and any `Unhandled error` block in the log
(CLAUDE.md "A test that runs sharp carries an explicit time budget").

**P15 — Documentation (E4 goal "docs/modules/finance.md … service names updated").** Owners: `docs/SPEC.md` §2 (T01: the
`start` requirement; T09: the `PromiseApiModule` text removed); `agent-patterns/effect-datetime-clock.md` and
`agent-patterns/effect-testing.md` (T06 corrects a wrong line it finds, e.g. §7's "`plan:run` with `Schedule.spaced("6 hours")`
through `Effect.repeat`", which would run at once); everything else in E4-T10: `docs/modules/finance.md` (1.3 last paragraph and
1.4 hooks table with the service names and the hooks as Effects; 4a "A seated participant cannot leave…" (`FinanceParticipants.
assertParticipantMayLeave`), "Plan payer and income person…" (`FinancePlan`), "Participants and the gate" (the middleware on the
runtime, `currentFinanceParticipant`), "The `start` hook and the clock" (`financeTimeMillis`, `startAccrualSchedule`, the
`TestClock` test); the 4b rows that name a function: F4, F10, F35, F36, F37, F40, F44, F45, F46, F48, F54, F71, F73), `CLAUDE.md`
(Status, Layout "Finance services (E4)", the gotchas "Bridges until E4 to E8" (the nine survivors of P1, the two participant
bridges of the pinned `finance-module.test.ts` included), "Hooks are Effects; finance is still
behind `fromPromiseModule`" (rewritten: both manifests are `ApiModule`s, `withFinanceServices`, `runModuleHook` until E5), the
idioms paragraph (rules (10) and (11) as of E4)), `docs/adr/0014-transitional-core-bridges.md` ("Status after E4's
integration": the same nine finance survivors with callers and removal milestones), `docs/open-work.md` (O-6 extended if a finance route file dies when imported first, P13),
`agent-patterns/effect-{core,services,errors,testing,datetime-clock}.md` ("As built (E4)" examples copied from the code), and this
plan's sections 9 and 10. `docs/API.md` is not edited (no row changes).

**P16 — Core bridges and helpers whose last caller leaves (E7; ADR 0014).** E4-T07 deletes the core `enableModule` bridge
(`apps/api/src/core/services/households/modules.ts`; its one caller, the finance seed, moves to `HouseholdModules`) and updates the
caller list of `initializeHousehold` (`apps/api/scripts/seed.ts`, E5; `finance-seed.test.ts` moves to the service). E4-T09
deletes the core `nowMs()` (P12) and updates the caller lists of `requireUser` / `requireMembership` (`apps/api/src/lib/types.ts`):
no finance caller remains, the tests `errors.test.ts`, `middleware.test.ts` (pinned) and `modules.test.ts` keep them until E8.

## 3. Waves and file ownership

| Wave | Tasks (parallel inside a wave) |
| --- | --- |
| 1 | E4-T01 the contract, the composition skeleton, the module clock, the bridge runner, `e4-verify.sh` |
| 2 | E4-T02 `FinanceParticipants`, `FinanceSettings`, the participant gate on the runtime; E4-T03 `FinanceCategories`, `FinanceTags`, `FinanceMutationClaims` |
| 3 | E4-T04 the ledger: `FinanceBalance`, `FinanceTransactions`, `FinanceSummary`, `FinanceSettlements`; E4-T05 `FinancePlan` |
| 4 | E4-T06 `FinanceAccrual`, the scheduler on `Schedule`, the `TestClock` and boot catch-up tests |
| 5 | E4-T07 `FinanceSetup`, the manifest as `ApiModule<FinanceServices>`, the seed (core); E4-T08 the finance routes on the runtime (rewrite) |
| 6 | E4-T09 the adapter deleted, the bridges pruned, idioms rules (10) and (11), the import-order entries |
| 7 | E4-T10 integration: docs, the boot check, the record |

Shared files and their owners (never two tasks of one wave): `apps/api/src/modules/finance/layer.ts`, `bridge.ts`,
`lib/clock.ts`, `apps/api/src/modules/types.ts`, `docs/plans/e4-verify.sh`, `apps/api/test/finance-clock.test.ts` T01;
`apps/api/src/modules/index.ts` T01 then T07; `docs/SPEC.md` T01 then T09; `apps/api/src/runtime.ts` T01 (comments) then T09
(comments, only if the T09 grep hits it); `apps/api/src/modules/adapter.ts` T01 (comments) then T09;
`apps/api/test/module-adapter.test.ts` T01 (lines 207 and 275 only, P3) then T09; `apps/api/test/effect-idioms.test.ts` T06
(rule (10), P12) then T09 (rule (11));
`apps/api/test/import-order-effect.test.ts` T01 then T09; `services/participants/layer.ts` T01 (stub) then T02;
`services/categories/layer.ts` T01 then T03; `services/ledger/layer.ts` T01 then T04; `services/plan/layer.ts` T01, T05, T06;
`services/setup/layer.ts` T01 then T07; `middleware.ts` T02 (then T09 for its bridge section only);
`apps/api/test/finance-file-db.test.ts` T04 then T07; `apps/api/src/core/services/households/support.ts`,
`apps/api/src/lib/types.ts` (comments), `apps/api/test/modules.test.ts` T09 only; `apps/api/src/core/services/households/modules.ts`
T07 then T09 (comments, only if the T09 grep hits it); `apps/api/test/support/finance-harness.ts`,
`apps/api/test/finance-seed.test.ts`, `finance/index.ts`, `setup.ts`, `seed.ts` T07 only; the eight route files T08 only; every service file's bridge section after its owner: T09; `CLAUDE.md`,
`docs/modules/finance.md`, `docs/open-work.md`, `docs/adr/0014-transitional-core-bridges.md`, the pattern files' "As built (E4)"
sections T10. Each task's `files` list is exact.

Dependencies: T02, T03 need T01; T04 needs T02, T03; T05 needs T02; T06 needs T03, T04, T05; T07 needs T02 to T06; T08 needs
T02 to T06; T09 needs T07, T08; T10 needs every task.

## 4. Tasks

Every task reads first: `docs/EFFECT.md` §1 (E3, E5, E6, E7, E9, E12) and §2; this plan's section 2 (the decisions its brief
names) and section 3; `CLAUDE.md` "Vendored reference code" and the gotchas "One composition point", "Bridges until E4 to E8",
"Catch-all stays catch-all", "The error family and the one boundary mapper", "The `Database` service and the shared client",
"Hooks are Effects; finance is still behind `fromPromiseModule`", "Middleware factories are TDZ-safe", "API import cycle",
"Cross-household guard (D8)"; `docs/modules/finance.md` section 1.9 (the ledger rules), section 4a (all bullets) and the 4b rows its
brief names; `repos/effect/LLMS.md` (whole, once); `agent-patterns/effect-core.md`, `agent-patterns/effect-services.md`,
`agent-patterns/effect-errors.md`, `agent-patterns/effect-testing.md`, `agent-patterns/effect-datetime-clock.md`. The converted
recipe module is the worked example (`apps/api/src/modules/recipe/layer.ts`, `services/shopping/layer.ts`,
`services/plan/plan.service.ts`, `routes/plan.ts`, `index.ts`). Every Effect signature is looked up in
`repos/effect/packages/effect/src/`, never recalled (v4, not v3: `repos/effect/migration/v3-to-v4.md`). Every task ends with
`bash docs/plans/e4-verify.sh all` (P14) and commits with a body naming the EFFECT.md decisions and the files served, ending with
the harness's `Co-Authored-By` line.

### E4-T01 — The contract, the composition skeleton, the module clock, the bridge runner (core)

Read: P1, P3, P4, P6, P13, P14; `apps/api/src/runtime.ts`, `apps/api/src/modules/{types,index,adapter}.ts`,
`apps/api/src/db/database.ts` (`layerFromExecutor`, `use`, `transaction`), `apps/api/src/config.ts` (`AppConfig.layer`),
`apps/api/src/lib/errors.ts` (`isDatabaseError`), `apps/api/src/modules/recipe/layer.ts`, `apps/api/src/index.ts` (boot,
shutdown), `apps/api/src/modules/finance/{index,lib/clock}.ts`, `apps/api/test/{import-order-effect,module-adapter,runtime}.test.ts`,
`apps/api/test/support/effect.ts`, `docs/SPEC.md` §2; `repos/effect/packages/effect/src/Layer.ts` (`suspend`, `mergeAll`,
`provideMerge`, `provide`, `empty`, `buildWithScope` ~775-794, `MemoMapImpl.get` ~425-441), `src/Effect.ts` (`suspend`,
`provide` and its `local` option ~5979-6060), `src/internal/layer.ts` (~1-40, the `local` branch), `src/Clock.ts`,
`src/testing/TestClock.ts`.

Steps: (1) create `docs/plans/e4-verify.sh` with the P14 block verbatim; (2) `lib/clock.ts` gains `financeTimeMillis` (P6),
keeps `nowMs` and `setClockForTest`; (3) the five area stubs (P4) as `Layer.empty` with `export type <Area>Services = never`;
(4) `finance/layer.ts` with `FinanceServices`, `financeLayer()`, `financeStandaloneLayer()`, `withFinanceServices()` in their final
form (P4); (5) `finance/bridge.ts` with `runFinanceBridge<A, E>(effect: Effect.Effect<A, E, FinanceServices | DatabaseService>,
executor: DbExecutor): Promise<A>` (P1; imports `runModuleHook` from `../adapter.ts`, never `runtime.ts`); (6) `types.ts`:
`start?()` requires `DatabaseService` (P3) with its doc comment; (7) `modules/index.ts`: `ModuleServices = RecipeServices |
FinanceServices`, the interim finance entry `{ ...fromPromiseModule(financeModule), layer: Layer.suspend(financeLayer) }`
(P3); (7b) `apps/api/test/module-adapter.test.ts`: exactly the two lines of P3 (line 275 `toBeUndefined()` → `toBeDefined()`
for `finance?.layer`; line 207 `Effect.runPromise(start())` → `onPrimary(start())`), nothing else; (8) `runtime.ts` and
`adapter.ts` comments name E4 WITHOUT writing the identifiers `fromPromiseModule` or `PromiseApiModule` into `runtime.ts` (E4-T09's
final grep covers `apps/api/src`; `adapter.ts` is T09's anyway); (9) `docs/SPEC.md` §2 (the `start` line); (10)
`import-order-effect.test.ts` gains `./src/modules/finance/layer.ts`, `./src/modules/finance/bridge.ts`,
`./src/modules/finance/lib/clock.ts` (probe each first); (11) new `apps/api/test/finance-clock.test.ts` (P11), including one
case that proves the local memo map: inside `runTest`, `withFinanceServices` over a `Database.layerFrom(<a private temp DB>)`
reaches that DB, not the shared one (once a service exists this is re-asserted by T02 through
`FinanceParticipants.listParticipants`; in T01 the area layers are empty, so the case asserts through `Database` itself that
`withFinanceServices(Database.use(...))` sees the private DB).

### E4-T02 — `FinanceParticipants`, `FinanceSettings`, the participant gate on the runtime (build)

Read: P1, P2, P6, P7, P9, P10, P11; `docs/modules/finance.md` 1.2, 4a "A seated participant cannot leave…", "Participants and the
gate", 4b F48, F51, F68, F69, F72; ADR 0004, ADR 0006; the two service files, `middleware.ts`, `setup.ts` (callers),
`apps/api/src/lib/types.ts` (`currentMembership`), `apps/api/src/core/services/auth/users.ts` (`isPlaceholderUser`,
`isUniqueViolation`), the recipe example `apps/api/src/modules/recipe/services/shopping/lists.service.ts`.

Converts the two files (P2 table and method list), fills `participantsLayer()`, converts `middleware.ts` (P9: the runtime-based
`requireFinanceParticipant`, `currentFinanceParticipant`, the sync bridge `requireFinanceParticipantContext`), keeps a bridge for
every old export with an outside caller (the routes, `setup.ts`, `seed.ts`, the other services, the harness, the xlsx script), each
over `runFinanceBridge`. `assignParticipants`: the order of checks, the delete-then-insert, the unique-violation → `409
finance_participant_in_use` (`Effect.catchTag("DatabaseError", …)`), the payer move; `assertParticipantMayLeave`: the veto, the
seat delete, the slot-1 re-seat, the payer move, on the current executor (no own transaction: the core opened it).
`saveParticipants` = `database.transaction(...)`. `FinanceSettings.loadHouseholdRow` falls back to `AppConfig.defaultLocale`
(yielded at build). The bridges `assignParticipants(db, householdId, assignment): Promise<void>` and
`updateParticipantDisplayName(db, householdId, userId, displayName)` are P1 SURVIVORS (the pinned `finance-module.test.ts` calls
them and wants `toBeInstanceOf(ApiError)` on a refusal), and `export type ParticipantAssignmentEntry` stays. New
`apps/api/test/finance-services-local.test.ts` (the local memo map with a real service, P4): a participant row written on a private
temp DB (`createDatabase` + `runMigrations`, as `finance-file-db.test.ts` opens its own) is listed by
`runTest(withFinanceServices(FinanceParticipants.use((s) => s.listParticipants(id))).pipe(Effect.provide(Database.layerFrom(created))))`
and the same household id lists nothing on the shared DB; at least 2 cases.

### E4-T03 — `FinanceCategories`, `FinanceTags`, `FinanceMutationClaims` (build)

Read: P1, P2, P6, P7, P10, P11; `docs/modules/finance.md` 1.1, 1.9 "Idempotency of writes", 4b F10, F38, F47, F51, F71, F73; the
three files, `services/categories/defaults.ts`, `services/support.ts` (`escapeLikePattern`), `apps/api/test/finance-idempotency.test.ts`.

Converts the three files, fills `categoriesLayer()`, keeps bridges for outside callers (routes, transactions, settlements, accrual,
setup, seed, the xlsx script), adds `checkOwnClaim` (service-free, `Conflict` `conflict` / `server.error.conflict`) and keeps
`assertOwnClaim` as a sync bridge over it. Rewrites `finance-idempotency.test.ts` onto `FinanceMutationClaims` (the race of two
first deliveries stays a real concurrent pair: `Effect.all([...], { concurrency: 2 })` or two `runTest` promises in
`Promise.all`; the TTL boundary is driven by `setClockForTest` or a `TestClock` exactly as the old test drove `nowMs`).

### E4-T04 — The ledger: `FinanceBalance`, `FinanceTransactions`, `FinanceSummary`, `FinanceSettlements` (build)

Read: P1, P2, P6, P7, P10, P11; `docs/modules/finance.md` 1.9 (the four kinds, the sign, `isExpense`, the odd cent,
settlements and `expectedBalanceCents`, idempotency, content language), 4b F32, F33, F37, F38, F39, F40, F42, F52, F71, F73; the
four service files plus `aggregateExclusion.ts`, `dateRange.ts`; `apps/api/test/finance-file-db.test.ts`.

Converts the four services and the two helpers (P2: `sammelbuchungTransactionIds` over `Database`, `parseRangeBound` service-free
failing with today's `ValidationFailed` details), fills `ledgerLayer()`, switches `assertOwnClaim` callers to `yield*
checkOwnClaim(...)`, keeps bridges (`getBalance` survives, P1; the others until their callers move). `createSettlement`: the
`409 balance_stale` with `details.currentBalanceCents` raised as `return yield* new ApiFailure({ status: 409, code:
"balance_stale", text: { key: "server.balance.stale", values }, details: { currentBalanceCents } })` (P7: never a `Conflict`,
which has no `details`), the default amount `|balance|`, the debtor as payer, the description in the
household's locale, the claim. Rewrites `finance-file-db.test.ts` (b) and (c) onto `FinanceSettlements` / `FinanceTransactions`
with `Database.withExecutor(created.db)`; (a), (d) and the `ensureFinanceHousehold` call stay.

### E4-T05 — `FinancePlan` (build)

Read: P1, P2, P6, P7, P11; `docs/modules/finance.md` 1.9 (the plan share, the catch-up, `lastBookedPeriod`, the plan and imported
history), 4a "Plan payer and income person must be participants", 4b F34, F35, F45, F46, F48, F54, F68, F70; `plan.service.ts`,
`period-scan.ts`.

Converts `plan.service.ts` (the participant checks with `server.finance.personNotParticipant` field details, `409
plan_period_locked`, `isPeriodBooked` across origins, the unique-violation recovery of `createIncome` / `updateIncome`), fills
`planLayer()` with `FinancePlan.layer`, keeps bridges (routes, accrual, seed).

### E4-T06 — `FinanceAccrual`, the scheduler on `Schedule`, the `TestClock` and boot catch-up tests (build)

Read: P1, P2, P6, P7, P8, P10, P11; `docs/modules/finance.md` 1.4 (`start`, `shutdown`), 1.9 (the monthly booking, the catch-up,
booked periods are immutable, adjustment keys), 4a "The `start` hook and the clock", 4b F35, F36, F42, F43, F44, F45, F54, F73;
CLAUDE.md "The first boot catches the fixed-cost plan up"; `docs/plans/m6-deploy.md` section 9.7 (the 222286 ct record);
`accrual.service.ts`, `scheduler.ts`, `apps/api/test/support/legacy-harness.ts`, `apps/api/test/legacy-finance.test.ts` (how
it migrates the fixtures), `apps/api/test/fixtures/legacy/facts.ts` (FH1, FH2); `agent-patterns/effect-datetime-clock.md` 2.5
and §3 TestClock; `repos/effect/packages/effect/src/internal/schedule.ts` ~187-224; `src/testing/TestClock.ts`.

Converts `accrual.service.ts` (P7's catch-all, P10's transaction), fills `planLayer()` with the nesting of P4, converts
`scheduler.ts` (P8) and keeps the old manifest's three lifecycle bridges (`runBootCatchUp(): Promise<void>`,
`startAccrualScheduler(): void`, `stopAccrualScheduler(): void`) until E4-T07; keeps the bridges `runCatchUp` (survivor),
`runPlanNow`, `recalculatePlan` (routes until T08). New `apps/api/test/finance-scheduler.test.ts` (P8: the tick at +6 h across the
month boundary; the fixtures' boot catch-up at the M6 moment: two rows of 51400 ct, 222286 ct), whose databases are handed in with
`Database.withExecutor(run.target.db)` (the scheduler builds its services through `withFinanceServices`, local memo map, P4).
Removes the entry `"apps/api/src/modules/finance/"` from `ALLOW_THROW_API_ERROR` in `apps/api/test/effect-idioms.test.ts` (P12 (a):
after this conversion no line under `apps/api/src` matches rule (10); check with `grep -rnE 'throw\s+(new\s+)?ApiError\b'
apps/api/src` first, STOP and report if it prints anything). Corrects the wrong E4 line of
`agent-patterns/effect-datetime-clock.md` §7 (P15).

### E4-T07 — `FinanceSetup`, the manifest as `ApiModule<FinanceServices>`, the seed (core)

Read: P1, P3, P4, P5, P6, P7, P11, P16; `docs/modules/finance.md` 1.4, 1.8, 4a "Enabling finance needs two participants", "The
finance test harness…"; `apps/api/src/modules/finance/{index,setup,seed}.ts`, `apps/api/src/modules/index.ts`,
`apps/api/src/core/services/households/{modules,households.service}.ts`, `apps/api/scripts/seed.ts` (how `seedDemo` runs),
`apps/api/src/modules/recipe/index.ts` (the shape), the tests `finance-seed`, `finance-file-db`, `finance-module` (pinned: what it
asserts on the manifest), `module-adapter` (the registry case), `support/finance-harness.ts`.

Converts `setup.ts` to `FinanceSetup` (P2), fills `setupLayer()`, rewrites `index.ts` (P5) as `financeModule:
ApiModule<FinanceServices>` with `layer: Layer.suspend(financeLayer)`, converts `seed.ts` (P5), lists `financeModule` unwrapped in
`modules/index.ts`, deletes the core `enableModule` bridge (P16), rewrites `finance-seed.test.ts` (through
`financeModule.seedDemo!(ctx)` and `HouseholdModules.initializeHousehold`, with `Database.withExecutor(created.db)` for the private
DB; the finance services reach it because `withFinanceServices` builds with a local memo map, P4), the `ensureFinanceHousehold`
call of `finance-file-db.test.ts`, and `support/finance-harness.ts` (`assignParticipants` / `ensureFinanceHousehold` through
`runTest`; exports and behaviour unchanged). `seed.ts` follows P5's TDZ rule: the `Effect.fn` combinators are lambdas
(`(effect) => effect.pipe(Effect.provide(HouseholdModules.layer, { local: true }))`), never a module-scope read of
`HouseholdModules`. The comments it rewrites name no removed identifier: `modules/index.ts` loses its `fromPromiseModule` import
and every mention of `fromPromiseModule` / `PromiseApiModule` in its comments, and the header comment of
`apps/api/src/core/services/households/modules.ts` (line 11, "a Promise-based manifest behind `fromPromiseModule`") is rewritten
to say what holds after this task (both manifests are `ApiModule`s; a hook reads the open transaction as the current executor of
`Database`), without either identifier.

### E4-T08 — The finance routes on the runtime (rewrite)

The substitution table is the brief (section 4 of the structured task and below). Files: `apps/api/src/modules/finance/routes/
{participants,transactions,categories,tags,plan,balance,settlements}.ts`; `routes/index.ts` is not touched.

| Old | New |
| --- | --- |
| `import { db } from "../../../db/client.ts";` | (deleted) |
| (no Effect import) | `import { Effect } from "effect";` and `import { runtime } from "../../../runtime.ts";` (first import lines) |
| `requireFinanceParticipantContext as requireHouseholdContext` in the `../middleware.ts` import | `currentFinanceParticipant` (keep `requireFinanceParticipant`) |
| `requireFinanceParticipantContext` in `participants.ts`'s `../middleware.ts` import | `currentFinanceParticipant` |
| `import { requireUser } from "../../../lib/types.ts";` / `import { requireMembership, requireUser } from …` | `import { currentUser } from …` / `import { currentMembership, currentUser } from …` (only the names the file still uses) |
| `import { a, b } from "../services/<path>.ts";` (function imports) | `import { <Service> } from "../services/<path>.ts";` (service per the next table) |
| `async (c) => {` (the head of a one-line route call, `x.get("/", …, async (c) => {`) | `(c) =>` newline `runtime.runPromise(` newline `Effect.gen(function* () {` |
| `});` (the end of that one-line route call, column 0) | `}),` newline `),` newline `);` |
| `  async (c) => {` (the head of a MULTI-LINE route call: the route path and each middleware on its own line, the handler as the last argument at two spaces; the PUT `/`, PATCH `/me` and PATCH `/:userId` of `routes/participants.ts`) | `  (c) =>` newline `    runtime.runPromise(` newline `      Effect.gen(function* () {` |
| `  },` newline `);` (the end of that multi-line route call: the handler's `},` at two spaces, then `);` at column 0) | `      }),` newline `    ),` newline `);` (the `);` of the route call stays; the body lines between head and end move right by four spaces) |
| a multi-line call `await <fn>(` newline `db,` newline `ARG1,` … newline `)` | `yield* <variable>.<fn>(` newline `ARG1,` … newline `)`: the line holding only `db,` is DELETED, every other argument line stays |
| `const household = requireHouseholdContext(c);` | `const household = yield* currentFinanceParticipant(c);` |
| `const participant = requireFinanceParticipantContext(c);` | `const participant = yield* currentFinanceParticipant(c);` |
| `const membership = requireMembership(c);` | `const membership = yield* currentMembership(c);` |
| `const user = requireUser(c);` | `const user = yield* currentUser(c);` |
| `await <fn>(db, ARGS)` | `yield* <variable>.<fn>(ARGS)`, with `const <variable> = yield* <Service>;` as the FIRST line of that handler's generator (once per service the handler uses) |

| Functions | Service (import from) | Variable |
| --- | --- | --- |
| `listParticipants`, `saveParticipants`, `updateParticipantDisplayName`, `renamePlaceholderParticipant` | `FinanceParticipants` (`../services/participants/participants.service.ts`) | `participantsService` |
| `listTransactions`, `createTransaction`, `getTransaction`, `updateTransaction`, `deleteTransaction` | `FinanceTransactions` (`../services/ledger/transactions.service.ts`) | `transactionsService` |
| `getTransactionSummary` | `FinanceSummary` (`../services/ledger/summary.service.ts`) | `summaryService` |
| `listCategories`, `createCategory`, `updateCategory`, `deleteCategory` | `FinanceCategories` (`../services/categories/categories.service.ts`) | `categoriesService` |
| `listTags`, `updateTag`, `deleteTag` | `FinanceTags` (`../services/tags/tags.service.ts`) | `tagsService` |
| `getPlanResponse`, `updatePlan`, `previewPlan`, `createFixedCostItem`, `updateFixedCostItem`, `deleteFixedCostItem`, `createIncome`, `updateIncome`, `deleteIncome`, `listAccrualRuns` | `FinancePlan` (`../services/plan/plan.service.ts`) | `planService` |
| `runPlanNow`, `recalculatePlan` | `FinanceAccrual` (`../services/plan/accrual.service.ts`) | `accrualService` |
| `getBalance`, `getBalanceHistory` | `FinanceBalance` (`../services/ledger/balance.service.ts`) | `balanceService` |
| `createSettlement` | `FinanceSettlements` (`../services/ledger/settlements.service.ts`) | `settlementsService` |

`routes/participants.ts`'s helper `async function participantList(c: AppContext, householdId: string):
Promise<FinanceParticipantListResponse> { … }` becomes exactly:

```ts
const participantList = Effect.fnUntraced(function* (c: AppContext, householdId: string) {
  const participantsService = yield* FinanceParticipants;
  const viewerId = (yield* currentUser(c)).id;
  const items = yield* participantsService.listParticipants(householdId);
  const viewer = items.find((item) => item.userId === viewerId);
  const payload: FinanceParticipantListResponse = { items, viewerSlot: viewer?.memberSlot ?? null };
  return payload;
});
```

and its calls `await participantList(c, X)` become `yield* participantList(c, X)`. Nothing else changes: comments, middleware
arguments, `c.req.valid(...)`, `c.req.param(...)`, `c.req.query(...)`, `requestLocale(c)`, the response helpers and their
arguments, the type annotations of payload constants. A call whose method name or argument list differs from the service shape
is a STOP (report it, never adapt the service).

### E4-T09 — The adapter deleted, the bridges pruned, idioms rules (10) and (11), the import-order entries (build)

Read: P1, P3, P11, P12, P13, P16; `apps/api/src/modules/{types,adapter}.ts`, `apps/api/test/{modules,module-adapter,
effect-idioms,import-order-effect}.test.ts`, `apps/api/src/core/services/households/support.ts`, `apps/api/src/lib/types.ts`,
`docs/SPEC.md` §2, every finance file's bridge section.

Deletes `PromiseApiModule` and `fromPromiseModule` (+ `callWithExecutor`, `asRoot`, `fromLifecycle`) and rewrites the two tests
(P11; the registry line becomes `expect(finance?.layer).toBe(financeModule.layer)`); deletes every finance bridge whose callers are
gone, measured with `grep -rn` over `apps/api/src`, `apps/api/scripts`, `apps/api/test` (the survivors are exactly P1's nine:
`runCatchUp`, `getBalance`, `slot1UserId`, `requireOtherMemberId`, `categoryIdBySlug`, `syncTransactionTags`,
`assignParticipants`, `updateParticipantDisplayName`, `requireFinanceParticipantContext`; if another bridge still has a caller,
STOP and report it) and the imports the deletion leaves unused; switches idioms rule (11) (P12 (b), (c); rule (10) was done by
E4-T06); removes any remaining mention of `fromPromiseModule` / `PromiseApiModule` from comments in `apps/api/src/runtime.ts`
and `apps/api/src/core/services/households/modules.ts` (both in this task's files for that purpose only);
deletes the core `nowMs()` and updates the `requireUser` / `requireMembership` caller comments (P16); probes and adds the
import-order entries (P13); removes the `PromiseApiModule` paragraphs of `docs/SPEC.md` §2. `bash docs/plans/e4-verify.sh
nothrow` exits 0.

### E4-T10 — Integration: docs, the boot check, the record (build)

Read: everything above; `docs/plans/e3-recipe-services.md` sections 9 and 10 (the shape of the record); `docs/deployment.md`
"Local stack test" is NOT run (no Dockerfile change). Writes the docs of P15 and sections 9 and 10 of this plan. Gates: `bun
install --frozen-lockfile`, `bash docs/plans/e4-verify.sh all`, `nothrow`, `bun run build`, `bun run i18n:check` (every hit
classified: the known 147 plus any comment line E4 moved; no new German string). The boot check: the fixture `migrate:legacy
--apply` (CLAUDE.md "Commands") into a temp DB, `NODE_ENV=development DATABASE_URL=file:<tmp>/target.db UPLOAD_DIR=<tmp>/uploads
SESSION_SECRET=<32 hex> API_PORT=<free port> bun apps/api/src/index.ts` in the background with one log ending `exit=$?`;
`/api/health` 200 with `modules` `["recipe","finance"]`; the `fixed_plan` rows the boot booked for FH1 (on 2026-11-05 expect
`2026-09`, `2026-10` and `2026-11`, 51400 ct each; the "two rows" of the exit criterion are pinned at the M6 moment by
`finance-scheduler.test.ts`, P8); a walkthrough as anna (login, `GET …/finance/balance` = 119486 + n x 51400 ct, a booking of
each kind, `POST …/settlements` with a stale `expectedBalanceCents` → `409 balance_stale` with `details.currentBalanceCents`, then
the right one → 201, a replayed `mutationId` → 200 and one row, `POST …/plan/run` → 200); SIGTERM → `[api] SIGTERM — stopping
modules …`, `[db] database closed`, `[api] runtime disposed`, exit 0. `bun run seed` twice on a fresh temp DB (the second prints
`[seed] finance ledger already present`). Records the pass count against 14686, the time and the host load.

## 5. Acceptance summary

- Gates: `bun install --frozen-lockfile` (no dependency change), `bun run typecheck`, `bun test` (pass count ≥ 14686 after every
  task, above it at the end), `bun run build`, `bun run i18n:check` (parity OK; every leftover hit classified), `git status
  --porcelain repos/` empty, `bun test apps/api/test/effect-idioms.test.ts` with rule (10)'s list empty (from E4-T06 on) and rule
  (11) as P12 says.
- Behaviour: V-PINNED clean against `47907f200`; the four finance greps clean; the fixtures' boot catch-up books the two rows of
  51400 ct at the M6 moment (222286 ct); the tick books the next period six hours later under a `TestClock`.
- Structure: every service of the P2 table is a `Context.Service` with a static `layer` listed in its area file; `financeModule` is
  an `ApiModule<FinanceServices>` (not wrapped), its `layer` is part of `AppLayer`, its hooks are Effects; `PromiseApiModule` and
  `fromPromiseModule` are gone (`runModuleHook` stays; no line under `apps/api/src`, `apps/api/test` or `apps/api/scripts` names
  either); no finance route imports `db`, `requireUser`, `requireMembership` or a service function; `nothrow` (P14) is clean; the
  finance bridges are exactly P1's nine survivors; `withFinanceServices` builds with a local memo map; no finance file imports
  `apps/api/src/runtime.ts` except `middleware.ts` and the route files.
- Records: sections 9 and 10 of this plan; `docs/modules/finance.md` and `CLAUDE.md` name the services; ADR 0014 lists the bridges
  that survive E4.

## 6. Risks

- **The hook copies of the services.** A hook builds the finance services over its `Database` (P4); if a service ever held state,
  the copies would disagree. Mitigation: P4 forbids state in a finance service (the scheduler's fiber lives in `scheduler.ts`, not
  in a service); the hooks are exercised through `app.request` by the pinned `finance-module.test.ts`, `finance-participants.test.ts`
  and `modules.test.ts` (g'), and through `runModuleHook` by `bun run seed` (E4-T10).
- **A memoized service on the wrong database.** Inside the runtime a plain `Effect.provide(layer)` reuses the `AppLayer`'s
  memoized leaf layers (a child memo map falls back to its parent), bound to the runtime's `Database`; a test that provides its own
  `Database` layer would then silently query the shared test DB. Mitigation: `withFinanceServices` uses `{ local: true }` (P4), so
  do the seed's `HouseholdModules.layer` provide (P5); `finance-clock.test.ts` (T01) and `finance-services-local.test.ts` (T02)
  prove a private DB is reached.
- **Pinned tests that import service functions.** `finance-module.test.ts` (`assignParticipants`, `updateParticipantDisplayName`),
  `finance-security.test.ts` (`runCatchUp`), `legacy-finance.test.ts` (`getBalance`) and `finance-participants.test.ts`
  (`requireFinanceParticipantContext`) are pinned. Mitigation: their functions are P1 survivors; the planner listed every finance
  import of every pinned test at the base.
- **The idioms gate between waves.** Rule (10)'s stale-entry check fails the moment the last finance `throw ApiError` goes.
  Mitigation: E4-T06, which removes the last one, removes the entry in the same commit (P12 (a)).
- **`DatabaseError` changes what a caller sees.** A driver error inside a service is now a `DatabaseError` whose `cause` is the old
  error; the accrual audit marker would read `DatabaseError: see server log` and `plan-run.ts` would print an empty message.
  Mitigation: P7 (the marker and the log take the `cause`) and P1 (bridges reject with the `cause`); the pinned
  `finance-security.test.ts` asserts both.
- **Bridges inside open transactions.** `finance-import-xlsx.ts` calls `syncTransactionTags(tx, …)` inside its own transaction; a
  bridge that ignored its executor would write through the root and wait on SQLite's lock. Mitigation: P1 (`runModuleHook` makes the
  handed executor the root); `finance-import-xlsx.test.ts` (pinned) runs the real import.
- **The `TestClock` test and real I/O.** `TestClock.adjust` wakes the tick, but the catch-up's queries are real Promises that finish
  later; an unbounded wait hangs, a too-short one flakes under load. Mitigation: a bounded real-time poll (P8), an explicit 60 s test
  timeout, a private target database per test (the legacy harness), `stopAccrualSchedule` in `Effect.ensuring`.
- **The scheduler's first run.** `Effect.repeat` runs at once, `Effect.schedule` waits a period first (section 1.1). Mitigation: P8
  names `Effect.schedule` and the test asserts no `interval` run before +6 h.
- **The real date moves.** On 2026-11-05 the fixtures' first boot books three periods, not the M6 rehearsal's two. Mitigation: the
  exit criterion is pinned at the M6 moment by the test (P8); E4-T10's boot records the real-date result and explains it.
- **The import cycle.** New module-scope reads (area layers, `Effect.fn` constants, `financeTimeMillis`, the manifest's `layer`) could
  hit a TDZ in some import order. Mitigation: P13, V-ORDER (`order`) in every task, the new `import-order-effect.test.ts` entries.
- **The rewrite task meets a shape mismatch.** Mitigation: P2's naming rule is binding and E4-T08 stops and reports instead of
  designing.
- **Merge conflicts between parallel worktrees.** Mitigation: section 3's ownership (the area files give each wave-2 and wave-3
  task its own composition file; the idioms test and the adapter are E4-T09's alone; docs are E4-T10's).
- **Test time and load.** The suite took 32.4 s at baseline; `runtime.runPromise` per request and per-hook layer builds add a
  little. Mitigation: none needed for correctness; E4-T10 records the time and the load.

## 7. Deviations expected (each recorded in section 10 when it happens)

1. **The hooks, the bridges and the scheduler build their own finance services** (`withFinanceServices`, `financeStandaloneLayer()`
   with `AppConfig.layer` inside, P4): the database hooks' contract requires `Database` only, and `runModuleHook` runs them outside the
   runtime.
2. **`start` requires `Database`** (P3), a SPEC §2 contract edit made with the SPEC text in E4-T01 (no ADR, as E3's `healthFeatures`).
3. **`scheduler.ts` is not a service** (P8): it holds the process's one tick fiber; `startAccrualSchedule` / `stopAccrualSchedule` are
   the manifest's `start` / `shutdown`.
4. **Finance bridges never use the runtime** (P1, `runFinanceBridge`), unlike E3's: `scripts/legacy/balance.ts` runs inside
   `migrate:legacy`, whose library must never touch the shared database.
5. **A bridge rejects with a `DatabaseError`'s `cause`** (P1): the old Promise functions threw the raw driver error, which
   `plan-run.ts` prints and `finance-security.test.ts` asserts.
6. **`setClockForTest` and the synchronous `nowMs()` survive** (P6): the pinned plan tests pin "now" through the seam; the module
   clock is otherwise the `Clock`.
7. **`finance-security.test.ts` stays on the `runCatchUp` bridge** (P11): it is pinned and its bridge survives for `plan-run.ts`; E5
   rewrites it.
8. **`requireUser`, `requireMembership` and `initializeHousehold` survive E4** (P16): their remaining callers are tests (E8) and
   `scripts/seed.ts` (E5); `enableModule` and the core `nowMs()` are deleted.
9. **A failed interval tick logs `[plan] interval catch-up failed:`** (P8), a new English log line where `setInterval` produced an
   unhandled rejection; the per-household line is unchanged.
10. **Pure and helper modules are not services** (`defaults.ts`, `period-scan.ts`, `dateRange.ts`, `aggregateExclusion.ts`,
    `support.ts`, `lib/clock.ts`, P2): the goal's "every file under services/ and lib/" is read as "every file that does I/O", as in
    E3 (pure code stays pure, E3).
11. **Finance has no `uploadReferences`, `afterMigrate` or `healthFeatures`** (P5): none existed; the goal's list names the contract,
    not new behaviour.
12. **The real boot books three plan rows on 2026-11-05** (E4-T10): the date moved since the M6 rehearsal; the "two rows" are pinned
    at the M6 moment by `finance-scheduler.test.ts`.
13. **`assignParticipants` and `updateParticipantDisplayName` survive E4 as Promise bridges** (P1): the pinned
    `finance-module.test.ts` calls them with a drizzle handle; E8 rewrites that test.
14. **`module-adapter.test.ts` changes two lines in E4-T01** (P3): the interim registry entry carries the finance `layer` (line 275
    `toBeUndefined()` → `toBeDefined()`, tightened to `toBe(financeModule.layer)` by E4-T09) and `start` requires `Database` (line 207
    runs through the file's `onPrimary`); every assertion's intent stays.
15. **Idioms rule (10)'s allow list empties in E4-T06, not E4-T09** (P12 (a)): the stale-entry check fails as soon as the last
    finance `throw ApiError` is converted.
16. **`withFinanceServices` provides with `{ local: true }`** (P4): a fresh memo map, so a hook, a bridge or the scheduler never
    reuses the runtime's memoized finance services on another `Database`.

## 8. Out of this milestone

The scripts as Effect programs (E5: `plan-run.ts`, `finance-import-xlsx.ts`, `scripts/legacy/*`, `seed.ts` keep calling the
Promise bridges and `runModuleHook`; `finance-security.test.ts`, `legacy-finance.test.ts` with them); the web (E6); replacing Hono
(E7; the routes stay Hono handlers calling the runtime, the route-file import order of O-6); `@effect/sql-libsql`; any `docs/API.md`
row, UI or copy change; the bridges pinned tests need (E8: `requireFinanceParticipantContext`, `requireUser`, `requireMembership`);
the N-person ledger (D3).

## 9. Integration record

Written by E4-T10 on 2026-11-05, on `main` at `cce971389` (E4-T09) plus this task's changes (documents only), Bun 1.4.3. Every log was read; what follows
quotes it. The host load average was 3.60 at the start of the full gate run and 3.72 at its end (a quiet machine).

### 9.1 Gates

- `bun install --frozen-lockfile`: `Checked 439 installs across 628 packages (no changes)`, `exit=0`.
- `bash docs/plans/e4-verify.sh all` (`exit=0`, 53 s in all):
  ```
  [typecheck] OK                                   (five projects)
   25 pass / 0 fail   Ran 25 tests across 1 file.   (effect-idioms.test.ts)
   74 pass / 0 fail   Ran 74 tests across 3 files.  (import-order, import-order-effect, legacy-cli: V-ORDER)
  [e4-verify] pinned files unchanged since 47907f200
  [e4-verify] repos/ clean
  [e4-verify] finance greps clean (LINKS_FIN, NOROUTER, NOCORE, NOSHADOW)
   14725 pass
   0 fail
   383719 expect() calls
  Ran 14725 tests across 163 files. [37.07s]
  [e4-verify] suite OK: 14725 pass (floor 14686)
  ```
  The floor was 14686 in 160 files (section 1.2). E4 added 39 tests and three files net of the rewritten cases (`finance-clock.test.ts` 11 cases,
  `finance-scheduler.test.ts` 3, `finance-services-local.test.ts`, the `checkOwnClaim` and idempotency boundary cases, the interim and final entries of
  `import-order-effect.test.ts`). 37.07 s against the baseline's 32.4 s (both quiet hosts; the per-request `runtime.runPromise` and the per-hook layer
  builds cost the difference).
- `bash docs/plans/e4-verify.sh nothrow`: `[e4-verify] no ApiError, nowMs( or withTransaction( in finance code (comments, lib/clock.ts and
  services/support.ts aside)`, `exit=0`.
- `bun run build`: `@toon/web build: Exited with code 0`, `precache  104 entries (1456.28 KiB)` (E4 touches no web file; the same size as E3).
- `bun run i18n:check`: `[i18n:check] OK` (parity) and `FAILED — 145 possible German literal(s)`, two fewer than E3's 147. The run at the base commit
  `47907f200` (a throw-away worktree) printed 147; the line-number-free diff of the two lists is exactly two removed lines and nothing added:
  `apps/api/src/modules/adapter.ts` `Effect.catch((cause) => (isApiError(cause) ? Effect.fail(cause) : Effect.die(cause))),` (the stopword "die"; the
  adapter lost `fromPromiseModule` and with it that line) and `apps/api/src/modules/finance/lib/clock.ts` ("catch-up ([API-DOMÄNE]) — goes through
  `nowMs()` instead of calling", reworded by E4-T01, the stopword no longer on the line). The 145 left are the classified false positives of
  E3's record: German quoted in doc comments ("Häufig gekauft", "Verfügbare Module", "Für den Teig", …), the recipe content vocabulary, and the finance web
  screens' doc comments quoting UI copy; none is under `apps/api/src/modules/finance/`. E4 added no German string and no catalog change.
- V-PINNED: `git diff --quiet 47907f200 -- <the pinned list> docs/API.md apps/api/drizzle apps/api/scripts apps/api/src/modules/recipe packages/shared
  apps/web` exits 0 (`pinned files unchanged since 47907f200`).
- `git status --porcelain repos/`: empty.
- `bun test apps/api/test/docs-paths.test.ts apps/api/test/api-doc.test.ts`: see 9.7 (run after the last documentation edit).

### 9.2 The finance bridges after the prune

E4-T09 deleted every finance bridge whose callers were only finance routes, finance services or tests rewritten onto the services, measured with
`grep -rnw` over `apps/api/src`, `apps/api/scripts` and `apps/api/test`. **Nine survive**, each with its explicit return type and no literal `throw`;
`runFinanceBridge` (`apps/api/src/modules/finance/bridge.ts`) never imports `apps/api/src/runtime.ts`:

| Bridge (file under `apps/api/src/modules/finance/`) | Convention | Callers outside the converted set | Removed by |
| --- | --- | --- | --- |
| `runCatchUp(db, householdId, options)` (`services/plan/accrual.service.ts`) | Promise over `runFinanceBridge` | `apps/api/scripts/plan-run.ts`, `apps/api/test/finance-security.test.ts` (pinned) | E5 |
| `getBalance(db, householdId, viewerUserId, viewerSlot, includeAggregates)` (`services/ledger/balance.service.ts`) | Promise over `runFinanceBridge` | `apps/api/scripts/legacy/balance.ts`, `apps/api/test/legacy-finance.test.ts` (pinned), `apps/api/test/finance-scheduler.test.ts` | E5 |
| `slot1UserId(db, householdId)` (`services/participants/participants.service.ts`) | Promise over `runFinanceBridge` | `apps/api/scripts/finance-import-xlsx.ts` | E5 |
| `requireOtherMemberId(db, householdId, viewerId)` (same file) | Promise over `runFinanceBridge` | `apps/api/scripts/finance-import-xlsx.ts` | E5 |
| `categoryIdBySlug(db, householdId, slug)` (`services/categories/categories.service.ts`) | Promise over `runFinanceBridge` | `apps/api/scripts/finance-import-xlsx.ts` | E5 |
| `syncTransactionTags(db, householdId, transactionId, tagNames)` (`services/tags/tags.service.ts`) | Promise over `runFinanceBridge`, inside the script's open transaction | `apps/api/scripts/finance-import-xlsx.ts` | E5 |
| `assignParticipants(db, householdId, assignment)` (`services/participants/participants.service.ts`) | Promise; a refusal is the family member itself | `apps/api/test/finance-module.test.ts` (pinned) | E8 |
| `updateParticipantDisplayName(db, householdId, userId, displayName)` (same file) | Promise over `runFinanceBridge` | `apps/api/test/finance-module.test.ts` (pinned) | E8 |
| `requireFinanceParticipantContext(c)` (`middleware.ts`) | SYNCHRONOUS, `Effect.runSync` over a service-free effect | `apps/api/test/finance-participants.test.ts` (pinned) | E8 |

Beside them `services/support.ts` keeps `withTransaction` (a plain Promise helper, not a bridge: `apps/api/scripts/finance-import-xlsx.ts`,
`apps/api/test/finance-file-db.test.ts`; E5), `escapeLikePattern` and the `DbLike` / `Tx` types. The core survivors after E4 (ADR 0014, "Status after E4's
integration"): `requireUser`, `requireMembership` (the tests `errors.test.ts`, `middleware.test.ts`, `modules.test.ts`; E8), `initializeHousehold`
(`apps/api/scripts/seed.ts`; E5), the test seams (`checkRateLimit`, `resetRateLimits`, `setMailer`, `getMailer`, `isMailerOverridden`,
`claimPlaceholderUser`, `createSession`; E8) and the scripts' ones (`collectUploadReferences`, `trySendMail`, `isMailConfigured`, `findUserByEmail`,
`createPasswordResetToken`; E5). Deleted in E4: the core `enableModule` bridge (E4-T07) and the core `nowMs()` (E4-T09). Both manifests are `ApiModule`s;
`PromiseApiModule` and `fromPromiseModule` are gone, `runModuleHook` stays (`apps/api/src/modules/adapter.ts`).

### 9.3 Exit greps

- `bash docs/plans/e4-verify.sh nothrow` (above): no `ApiError`, `nowMs(` or `withTransaction(` in finance code outside comments, `lib/clock.ts` and `services/support.ts`.
- `grep -rnE 'PromiseApiModule|fromPromiseModule' apps packages scripts`: empty; the words survive in `docs/EFFECT.md` (the E7 text, not mine to edit) and in
  the "As built (E2)" part of `agent-patterns/effect-testing.md` (an example of the E2 test shape).
- The four finance greps `LINKS_FIN`, `NOROUTER`, `NOCORE`, `NOSHADOW`: `finance greps clean`.
- Idioms rule (10)'s allow list is empty (`ALLOW_THROW_API_ERROR = {}` since E4-T06); rule (11)'s service-date list is empty and its `nowMs(` scan covers
  `apps/api/src/core/`, `apps/api/src/modules/recipe/` and `apps/api/src/modules/finance/` with the one `lib/clock.ts` definition line.
- The finance route files, probed one by one in a fresh process (`bun -e "await import('./apps/api/src/modules/finance/routes/<name>.ts')"`): `balance`,
  `categories`, `participants`, `plan`, `settlements`, `tags` and `transactions` die with `ReferenceError: Cannot access '<name>Routes' before initialization`,
  `routes/index.ts` with `Cannot access 'financeHouseholdRouter' before initialization`; `middleware.ts` imports first. This is the E3 shape (P13); the eight
  files are not entries of `apps/api/test/import-order-effect.test.ts`, which probes `apps/api/src/modules/finance/index.ts` in the real order and the
  middleware, `setup.ts`, `seed.ts` and every converted service file one by one. `docs/open-work.md` O-6 names them for E7.

### 9.4 Boot check (the fixtures, a temp database)

`D=$(mktemp -d)`; `NODE_ENV=development DATABASE_URL=file:$D/target.db UPLOAD_DIR=$D/uploads bun run migrate:legacy -- --recipe-db
apps/api/test/fixtures/legacy/recipe.db --recipe-uploads apps/api/test/fixtures/legacy/uploads --finance-db apps/api/test/fixtures/legacy/finance.db --apply
--report $D/report<n>.json` twice: the first `[migrate:legacy] applied: 274 rows written, 7 files copied.`, the second `[migrate:legacy] already migrated:
nothing written.`, both exit 0. Then `NODE_ENV=development DATABASE_URL=file:$D/target.db UPLOAD_DIR=$D/uploads SESSION_SECRET=<32 hex> API_PORT=3947 bun
apps/api/src/index.ts` in the background with one log ending `exit=$?`:

- `GET /api/health`: `200`, `{"ok":true,"status":"ok","version":"0.1.0","database":"file","modules":["recipe","finance"],"features":{"verifiedEmailRequired":false,"ocrImport":false,"pdfImport":false}}`.
- **The `fixed_plan` rows of the first boot (deviation 12).** FH1 ("Familie Beispiel", `startPeriod 2026-07`, `lastBookedPeriod 2026-08`) got three `Fixkostenanteil`
  rows from this boot, `2026-09`, `2026-10` and `2026-11`, 51400 ct each, because the real date is 2026-11-05 and the plan walks up to the current
  period; the M6 rehearsal (15 Oct 2026) booked two. `GET …/plan/runs` shows the run as `["boot",3,null]` beside the migrated `["boot",2,null]`. The "two rows of
  51400 ct" exit criterion is pinned at the M6 moment by `apps/api/test/finance-scheduler.test.ts` (a `TestClock` set to 15 Oct 2026), green in the suite.
- The walkthrough as `anna@example.test` (one script against the real server process, `recipe-pass-anna`, household "Familie Beispiel"):

| Step | Result |
| --- | --- |
| `POST /api/auth/login` | 200 |
| `GET /api/auth/me` | 200, `["Familie Beispiel",["recipe","finance"]]` and `["Freundeskreis",["recipe","finance"]]` |
| `GET …/finance/participants` | 200, `viewerSlot` 1, Anna (1) and Ben (2) |
| `GET …/finance/balance` | 200, `balanceCents` **273686** = 119486 + 3 x 51400 (the migration report's balance plus the three rows above), `transactionCount` 16 |
| `POST …/transactions` once per kind (`MINE_SPLIT`, `THEIRS_SPLIT`, `FOR_THEM`, `TRANSFER`, 1001 ct, tag `walk`, a `mutationId` each) | 201 each, `Location` set; `splitMode` `SPLIT_EQUAL`, `SPLIT_EQUAL`, `OTHER_ONLY`, `SETTLEMENT` as the API.md table says, `otherShareCents` 500, 500, 1001, 1001 |
| `POST …/transactions` with one `mutationId` twice | 201, then **200** with the same row id; `GET …/transactions?q=walk replay` has `total` 1 |
| `GET …/finance/balance` | 274686 |
| `POST …/settlements` `{expectedBalanceCents: 274687}` | **409 `balance_stale`**, `details: {"currentBalanceCents":274686}` (the dev log line: `[api] POST …/settlements -> 409 balance_stale: The balance has changed. It is now 2.746,86 €.`) |
| `POST …/settlements` `{expectedBalanceCents: 274686}` | 201, `balance.balanceCents` 0 |
| the same settlement `mutationId` again | 200 |
| `POST …/plan/run` | 200, `bookedPeriods: []`, a `manual` run row |
| `GET …/transactions?origin=fixed_plan` | the three new rows plus the two migrated ones |

- SIGTERM to the server pid: the log ends

  ```
  [api] SIGTERM — stopping modules …
  [db] database closed
  [api] runtime disposed
  exit=0
  ```

  and port 3947 is free afterwards.
- `bun run seed` twice on a fresh temp file database (`NODE_ENV=development`, `SESSION_SECRET` set): both `exit 0`; the first prints `[seed] finance enabled: demo =
  Person 1, Robin = Person 2, Kim stays a non-participant`, the second `[seed] finance ledger already present`.

The scratch directory holding the migration report and the apply log (the apply output carries live claim links, CLAUDE.md "Claim links are credentials") was
deleted after the run; nothing of it is in the tree.

### 9.5 Documentation sync

`docs/modules/finance.md` (section 1.3 "Services (E4)" with the service table and the nine bridges, section 1.4 the hooks table with the service names, `withFinanceServices` and
the three absent hooks, section 4a "A seated participant cannot leave while the ledger has rows.", "Plan payer and income person must be participants", "Participants and
the gate" and "The `start` hook and the clock" (`financeTimeMillis`, `startAccrualSchedule`, `Effect.schedule` waiting first, the `TestClock` test), the 4b rows F4, F10, F35,
F36, F37, F44, F45, F46, F48, F54, F71 and F73, section 5.2 the three new tests), `CLAUDE.md` (the Status paragraph and the pass count, Layout "Finance services (E4)", the gotchas
"Bridges until E5 to E8" (the nine survivors), "The error family and the one boundary mapper" (`ApiError` stays for the tests until E8), "Hooks are Effects; both manifests are
`ApiModule`s" (rewritten: `withFinanceServices` with its local memo map, `runModuleHook` until E5, the scheduler on `Schedule`), the idioms paragraph (rules (10) and (11) as of
E4) and the `i18n:check` count), `docs/adr/0014-transitional-core-bridges.md` ("Status after E4's integration": the nine bridges with callers and removal milestones), `docs/open-work.md`
(O-6 extended to the eight finance route files), `agent-patterns/effect-{core,services,errors,testing,datetime-clock}.md` ("As built (E4)", examples copied from the code;
`effect-testing` and `effect-datetime-clock` already carried their E4-T06 notes, which also corrected the wrong `Effect.repeat` line of section 7). `docs/SPEC.md` §2 was edited by
E4-T01 and E4-T09 (the `start` requirement, the `PromiseApiModule` text removed). `docs/API.md` is not edited (no row changes). No ADR was added: no deviation changes a SPEC §1 or
`docs/EFFECT.md` §1 decision.

### 9.6 Not run

The local stack test (`docs/deployment.md` "Local stack test") was not run: E4 changes no `Dockerfile`, compose file, Caddyfile or workflow.

### 9.7 Last gate after the documentation edits

The verify command of the task, after the last edit (one log, `exit=0`): `bun install --frozen-lockfile` (`Checked 439 installs across 628 packages (no changes)`) && `bash docs/plans/e4-verify.sh all`
(`Ran 14725 tests across 163 files. [36.66s]`, `14725 pass`, `0 fail`, `suite OK: 14725 pass (floor 14686)`, pinned unchanged, `repos/` clean, finance greps clean) && `nothrow` (clean) &&
`bun run build` (`Exited with code 0`) && `bun test apps/api/test/docs-paths.test.ts apps/api/test/api-doc.test.ts` (`14 pass`, `0 fail`) && `test -z "$(git status --porcelain repos/)"`. The host
load average was 1.98 at the start and 2.56 at the end of that run. The first documentation edit had put three bare `scripts/…` paths into `CLAUDE.md`, which
`docs-paths.test.ts` caught (`scripts/legacy/balance.ts`, `scripts/seed.ts`); they are repo-relative from the root now. The final pass count is **14725 in 163 files against the floor of 14686**; the suite
took 36.66 s to 37.07 s on a host with a load average of 2 to 4 (the baseline's 32.4 s was measured on a quieter one).

## 10. What changed vs plan

Section 7 expected sixteen deviations; every one happened as written. In order, with what each task recorded:

1. **The hooks, the bridges and the scheduler build their own finance services** (`withFinanceServices`, `financeStandaloneLayer()` with `AppConfig.layer` inside; E4-T01, used by T02 to T08).
2. **`start` requires `Database`** (E4-T01): the SPEC §2 contract text edited in the same commit, no ADR.
3. **`scheduler.ts` is not a service** (E4-T06): `tickFiber` is a module-level variable; `startAccrualSchedule` is an `Effect.fn` (the T06 fix commit `e06f1f513` made it one
   after the first version was a plain function wrapping `Effect.gen`).
4. **Finance bridges never use the runtime** (E4-T01, `runFinanceBridge`), unlike E3's: `apps/api/scripts/legacy/balance.ts` runs inside `migrate:legacy`.
5. **A bridge rejects with a `DatabaseError`'s `cause`** (E4-T01): `finance-security.test.ts` still asserts `rejects.toThrow("insert into")`; the accrual audit marker and the log line
   take the original error too (E4-T06).
6. **`setClockForTest` and the synchronous `nowMs()` survive** (E4-T01): the pinned plan tests pin "now" through the seam; `nowMs()` is called only by the harness.
7. **`finance-security.test.ts` stays on the `runCatchUp` bridge** (E4-T06): pinned, E5 rewrites it.
8. **`requireUser`, `requireMembership` and `initializeHousehold` survive E4** (E4-T07, T09): their callers are tests (E8) and `apps/api/scripts/seed.ts` (E5); `enableModule` (T07) and the core
   `nowMs()` (T09) are deleted.
9. **A failed interval tick logs `[plan] interval catch-up failed:`** (E4-T06), a new English log line; the per-household line is unchanged.
10. **Pure and helper modules are not services** (E4-T02 to T05): `defaults.ts`, `period-scan.ts`, `dateRange.ts`, `aggregateExclusion.ts`, `support.ts` and `lib/clock.ts`.
11. **Finance has no `uploadReferences`, `afterMigrate` or `healthFeatures`** (E4-T07).
12. **The real boot books three plan rows on 2026-11-05** (E4-T10, section 9.4): `2026-09`, `2026-10` and `2026-11` of 51400 ct, balance 273686 ct; the "two rows" are pinned at the M6
    moment by `finance-scheduler.test.ts`.
13. **`assignParticipants` and `updateParticipantDisplayName` survive as Promise bridges** (E4-T02): the pinned `finance-module.test.ts` calls them with a drizzle handle; E8 rewrites it.
14. **`module-adapter.test.ts` changed two lines in E4-T01** (line 207 through the file's `onPrimary`, line 275 `toBeUndefined()` to `toBeDefined()`); E4-T09 then moved it, and
    `modules.test.ts`, onto `ApiModule` literals with the same case counts (12 and 11 as at the base) and tightened the entry to `expect(finance?.layer).toBe(financeModule.layer)`.
15. **Idioms rule (10)'s allow list emptied in E4-T06, not E4-T09** (the stale-entry check fails as soon as the last finance `throw ApiError` goes).
16. **`withFinanceServices` provides with `{ local: true }`** (E4-T01): proven by `finance-clock.test.ts` and `finance-services-local.test.ts`; the seed's `HouseholdModules.layer` provide
    uses it too (E4-T07), and its combinators are lambdas so the manifest's module scope reads no core binding (P13).

What else differs, in order:

17. **The finance `409 balance_stale` is an `ApiFailure`** (E4-T04), because `Conflict` has no `details` and the wire carries `details.currentBalanceCents`; the response is byte-identical.
18. **The income-overlap unique-violation recovery uses `Effect.catchTag("DatabaseError")`** (E4-T05, `createIncome` / `updateIncome`): `isUniqueViolation` reads the `DatabaseError`'s `cause`,
    as the old `catch` read the driver error.
19. **The agent-pattern corrections of E4-T06** (`effect-datetime-clock.md` section 7 said the tick was `Effect.repeat`, which runs at once) were made by the task that found them, as P15
    asked; E4-T10 added the "As built (E4)" sections to `effect-core`, `effect-services` and `effect-errors` and one more to `effect-testing` and `effect-datetime-clock`.
20. **The `i18n:check` count is 145, not 147** (section 9.1): two lines left the list, none was added.
21. **No ADR**: ADR 0014 gained its "Status after E4's integration" section only.
22. **Left for later milestones** (section 8, unchanged): the scripts (E5: `plan-run.ts`, `finance-import-xlsx.ts`, `scripts/legacy/*`, `seed.ts` and the finance bridges they call,
    `runModuleHook`), the web (E6), Hono and the route-file import order (E7; `docs/open-work.md` O-6), and the bridges the pinned tests need (E8).
