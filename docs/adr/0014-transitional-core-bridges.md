# 0014: Transitional bridges while the core moves onto Effect (records plan e2 P1, P6, P11, P17; E5, E7)

Date: 2026-10-20

## Context

Milestone E2 of `docs/EFFECT.md` (plan `docs/plans/e2-api-core-services.md`) turns the core of the API into
`Context.Service` classes with static layers on one `ManagedRuntime` (E7), with a `Database` service that owns the
libSQL client and the drizzle instance and is closed by the runtime's scope (E5). The recipe and finance modules
and the scripts are converted later (E3, E4, E5 of `docs/EFFECT.md` §4), and until then they keep calling the core
the old way: they import `db`, `client` and `dbReady` from `apps/api/src/db/client.ts`, call core functions that
take a `db` first and return Promises (or return synchronously), implement the Promise-based `ApiModule` hooks, and
the test suites swap the mailer, the verified-e-mail gate and the rate-limit buckets through module-level seams.
E5 and E7 read as if the switch happened at once. It cannot without converting the modules and the scripts in the
same milestone, which E3 ("one layer per milestone") forbids.

## Decision

The core keeps four transitional doors open until the milestone that moves the last caller, and no longer:

- **The process-wide database instance.** `apps/api/src/db/client.ts` still creates the shared client and drizzle
  instance at import (`client`, `db`, `dbReady`), because recipe, finance and the scripts import `db` until E3 to
  E5. The `Database` service (`apps/api/src/db/database.ts`) owns its LIFETIME: `Database.layer` wraps that
  instance, its acquire awaits the D7 pragmas (`dbReady`, so a broken database fails the layer build at boot), and
  its release closes the client and logs `[db] database closed` when the runtime is disposed, except under
  `NODE_ENV=test`, where every test file shares one process and one client (ADR 0009) and the release does
  nothing. `Database.layerFrom`, `Database.layerFromExecutor` and the fully scoped `Database.layerFromUrl` are the
  explicit constructors (tests, module hooks, E10's scripts). The current executor (the open transaction, or a
  handed-in instance through `Database.withExecutor`) is a `Context.Reference`, so `transaction(effect)` replaces
  `withTransaction` with the same degradation rule on a `:memory:` URL. E5 (scripts) is the last importer of `db`;
  after it the instance is created by the layer alone and `db`, `client` and `dbReady` leave `client.ts`.
- **Legacy bridges (plan e2 P1).** A converted core file exports, next to its service, a bridge with the old name
  and the old signature for every export a caller outside the converted set still uses. A bridge honours its old
  `db` argument through `Database.withExecutor(db)` and keeps its calling convention, written as an explicit
  return type: a Promise export runs through `runtime.runPromise`, a synchronous one (`checkRateLimit`,
  `enforceRateLimit`, `resetRateLimits`, `requireUser`, `requireMembership`, `toUserDto`, `requireAccountEmail`,
  `assertRole`, `assertCanModifyOwned`, `requireProviderConfigured`, `isVerifiedEmailRequired`, `getMailer`,
  `isMailConfigured`) through `Effect.runSync` over a service-free effect, a fire-and-forget `void` one
  (`warmThumbnail`) through `runtime.runFork` with its cause ignored. Bridges sit in a marked section at the end of
  their file, each naming its callers. E2's integration task deletes every bridge whose only callers were core
  routes, middlewares, `apps/api/src/index.ts` or rewritten core tests; E3 removes the ones recipe uses, E4 the
  finance ones, E5 the scripts' ones.
- **The Promise module contract (plan e2 P11).** `ApiModule` gets Effect hooks; the Promise-shaped interface
  survives as `PromiseApiModule`, which `apps/api/src/modules/adapter.ts` turns into an `ApiModule`
  (`fromPromiseModule`; a module's refusal becomes the typed failure unchanged) and whose hooks run on a bare
  executor outside the runtime through `runModuleHook` (`Database.layerFromExecutor`). E3 and E4 rewrite the two
  manifests onto Effect hooks and delete `PromiseApiModule`, `fromPromiseModule` and `runModuleHook`.
- **The test seams.** `setMailer`, `setVerifiedEmailRequired` and `resetRateLimits` stay the tests' doors into the
  live `Mailer`, `VerifiedEmail` and `RateLimiter` services (the services read the same module-level state the
  seams write), because `apps/api/test/auth.test.ts`'s rate-limit block and the through-the-app suites are pinned
  unchanged. They go when E9's test support replaces each with a layer (`apps/api/test/support/effect.ts`), at the
  latest in E8.

## Consequences

- `docs/EFFECT.md` E5 and E7 each gain one sentence pointing at this ADR (same commit). CLAUDE.md's ADR list names
  it from E2's integration task on.
- Two ways into the same database coexist until E5: the shared `db` of `client.ts` and the `Database` service.
  They are the same client, so a row written through one is visible through the other, and a transaction opened by
  the service is invisible to a module that writes through the imported `db` (as with `withTransaction` today:
  the transaction is only joined by code that receives the `tx`).
- The runtime's `dispose` closes the shared client in production and development; any module or script code that
  still holds `db` after the dispose fails, which is the order `apps/api/src/index.ts` already keeps (modules'
  `shutdown` first, then `runtime.dispose()`).
- Each bridge is a debt with a named owner milestone; a bridge that outlives its milestone is a finding of that
  milestone's review.

## Status after E2's integration (2026-10-20)

E2's integration task pruned the bridges: 59 were deleted (every one whose callers were only core routes, middlewares,
`apps/api/src/index.ts` or rewritten core tests, and the old `auth/index.ts` barrel) and 22 survive, listed with their callers,
calling convention and removal milestone in `docs/plans/e2-api-core-services.md` section 9.2. Of the synchronous
bridges named above, `toUserDto`, `requireAccountEmail` and `requireProviderConfigured` no longer exist (no caller was left);
`assertRole` survives with no reader (an unused import in recipe). The idioms test pins the two rules that make the
transition honest: `throw ApiError` only under `apps/api/src/modules/recipe/` and `finance/` (rule (10)), and no `Date.now(` /
`new Date(` in a `services/` directory and no `nowMs(` call under `apps/api/src/core/` outside the pinned entries (rule (11)).

## Status after E3's integration (2026-11-05)

E3 (recipe-services, `docs/plans/e3-recipe-services.md`) moved the recipe module onto `Context.Service` classes and its
routes onto `runtime.runPromise`. **The recipe manifest is no longer behind `fromPromiseModule`**: `recipeModule` implements the
Effect contract `ApiModule<RecipeServices>` directly, its hooks are Effects and its `layer` is part of the one `AppLayer`; finance is
the one manifest still wrapped (E4 deletes `PromiseApiModule`, `fromPromiseModule` and `runModuleHook`).

E3-T12 deleted six core bridges whose last caller was recipe: `enforceRateLimit`, `storeUploadedImage`, `warmThumbnail`,
`isVerifiedEmailRequired`, `assertCanModifyOwned` and `assertRole`, with their remaining test callers rewritten onto the services.
E3-T13 deleted every recipe bridge whose callers were only recipe routes, recipe services or rewritten tests. The bridges that
survive E3 (callers and removal milestones in `docs/plans/e3-recipe-services.md` section 9.2):

- recipe: `backfillFoldedColumns(database?)` (`apps/api/src/modules/recipe/migrate.ts`; `apps/api/scripts/legacy/recipe.ts`,
  `apps/api/test/legacy-recipe.test.ts`; E5), `localizeImageUrl` (`apps/api/src/modules/recipe/services/recipes/remoteImage.ts`;
  `apps/api/scripts/localize-images.ts`; E5), `createDraft(db, input)` (`services/import/drafts.ts`), the synchronous `importFromText`
  (`services/import/ocr/index.ts`), `fetchHtml` (`services/import/url/fetch.ts`) and `assertPublicUrl` (`services/import/url/ssrf.ts`),
  the last four for the pinned tests `apps/api/test/import/ocr-disabled.test.ts` and `apps/api/test/import/ssrf.test.ts` (E8).
- core: `requireUser`, `requireMembership` (finance routes; E4), `initializeHousehold`, `enableModule` (finance seed; E4, E5),
  `checkRateLimit`, `resetRateLimits`, `setMailer`, `getMailer`, `isMailerOverridden`, `claimPlaceholderUser` and `createSession`
  (tests, some pinned; E8 at the latest, with E9's layer-based test support), `collectUploadReferences`, `trySendMail`,
  `isMailConfigured`, `findUserByEmail`, `createPasswordResetToken` (scripts; E5).

The idioms test pins the progress: rule (10) allows `throw ApiError` only under `apps/api/src/modules/finance/` and rule (11)'s
`nowMs(` scan covers `apps/api/src/core/` and `apps/api/src/modules/recipe/`.

## Status after E4's integration (2026-11-05)

E4 (finance-services, `docs/plans/e4-finance-services.md`) moved the finance module onto `Context.Service` classes (`FinanceParticipants`,
`FinanceSettings`, `FinanceCategories`, `FinanceTags`, `FinanceMutationClaims`, `FinanceBalance`, `FinanceTransactions`, `FinanceSummary`,
`FinanceSettlements`, `FinancePlan`, `FinanceAccrual`, `FinanceSetup`) and its routes onto `runtime.runPromise`. **Both manifests implement
`ApiModule` directly now**: `PromiseApiModule` and `fromPromiseModule` are deleted, `financeModule` is an `ApiModule<FinanceServices>` whose
`layer` is part of the one `AppLayer`, and its hooks are Effects. `runModuleHook` (`apps/api/src/modules/adapter.ts`) stays, unchanged in
purpose: it runs a hook or a bridge on a bare drizzle executor outside the runtime (`runMigrations`, `collectUploadReferences(database)`,
`apps/api/scripts/seed.ts`, and every finance bridge through `runFinanceBridge`); E5 removes it with the last script that needs it.
The finance hooks, the bridges and the scheduler build the finance services themselves over the CURRENT `Database` with a local memo map
(`withFinanceServices`, `apps/api/src/modules/finance/layer.ts`), because the hook contract requires `Database` only and the same code runs
inside and outside the runtime.

Finance bridges differ from recipe's in one point: **they never import `apps/api/src/runtime.ts`** (`runFinanceBridge`,
`apps/api/src/modules/finance/bridge.ts`), because `apps/api/scripts/legacy/balance.ts` runs inside `migrate:legacy`, whose library must never
reach the shared database, and `apps/api/scripts/finance-import-xlsx.ts` calls a bridge inside an open drizzle transaction (the handed
executor is honoured). A bridge rejects with a `DatabaseError`'s `cause` (the raw driver error the old function threw) and with a refusal of
the API error family unchanged. The nine finance bridges that survive E4, each with its explicit return type and no literal `throw`:

| Bridge (file under `apps/api/src/modules/finance/`) | Convention | Callers outside the converted set | Removed by |
| --- | --- | --- | --- |
| `runCatchUp(db, householdId, options)` (`services/plan/accrual.service.ts`) | Promise over `runFinanceBridge` | `apps/api/scripts/plan-run.ts`, `apps/api/test/finance-security.test.ts` (pinned) | E5 |
| `getBalance(db, householdId, viewerUserId, viewerSlot, includeAggregates)` (`services/ledger/balance.service.ts`) | Promise over `runFinanceBridge` | `apps/api/scripts/legacy/balance.ts`, `apps/api/test/legacy-finance.test.ts` (pinned), `apps/api/test/finance-scheduler.test.ts` | E5 |
| `slot1UserId(db, householdId)` (`services/participants/participants.service.ts`) | Promise over `runFinanceBridge` | `apps/api/scripts/finance-import-xlsx.ts` | E5 |
| `requireOtherMemberId(db, householdId, viewerId)` (`services/participants/participants.service.ts`) | Promise over `runFinanceBridge` | `apps/api/scripts/finance-import-xlsx.ts` | E5 |
| `categoryIdBySlug(db, householdId, slug)` (`services/categories/categories.service.ts`) | Promise over `runFinanceBridge` | `apps/api/scripts/finance-import-xlsx.ts` | E5 |
| `syncTransactionTags(db, householdId, transactionId, tagNames)` (`services/tags/tags.service.ts`) | Promise over `runFinanceBridge`, inside the script's open transaction | `apps/api/scripts/finance-import-xlsx.ts` | E5 |
| `assignParticipants(db, householdId, assignment)` (`services/participants/participants.service.ts`) | Promise over `runFinanceBridge`; a refusal is the family member itself | `apps/api/test/finance-module.test.ts` (pinned, `(i) assignParticipants`) | E8 |
| `updateParticipantDisplayName(db, householdId, userId, displayName)` (`services/participants/participants.service.ts`) | Promise over `runFinanceBridge` | `apps/api/test/finance-module.test.ts` (pinned) | E8 |
| `requireFinanceParticipantContext(c)` (`middleware.ts`) | SYNCHRONOUS, `Effect.runSync` over a service-free effect | `apps/api/test/finance-participants.test.ts` (pinned) | E8 |

`services/support.ts` keeps `withTransaction` (a plain Promise helper, not a bridge: `apps/api/scripts/finance-import-xlsx.ts`,
`apps/api/test/finance-file-db.test.ts`; E5). Two core files lost bridges: `enableModule` (its one caller, the finance seed, moved to the
`HouseholdModules` service) and the core `nowMs()` of `households/support.ts` (no caller was left) are deleted. The core survivors after E4:
`requireUser` and `requireMembership` (`apps/api/src/lib/types.ts`; the tests `apps/api/test/errors.test.ts`, `apps/api/test/middleware.test.ts`,
`apps/api/test/modules.test.ts`; E8), `initializeHousehold` (`apps/api/scripts/seed.ts`; E5), the test seams (`checkRateLimit`,
`resetRateLimits`, `setMailer`, `getMailer`, `isMailerOverridden`, `claimPlaceholderUser`, `createSession`; E8) and the scripts' ones
(`collectUploadReferences`, `trySendMail`, `isMailConfigured`, `findUserByEmail`, `createPasswordResetToken`; E5).

The idioms test pins the progress: rule (10)'s allow list is empty (no `throw ApiError` anywhere under `apps/api/src`; the `ApiError` class
itself and its ten static helpers remain until E8 for the tests that call them), and rule (11) covers `Date.now(` / `new Date(` in every
`services/` directory with no entry and `nowMs(` under `apps/api/src/core/`, `apps/api/src/modules/recipe/` and `apps/api/src/modules/finance/`
with the one definition line of the finance module clock.

## Status after E5's integration (2026-11-05)

E5 (scripts, `docs/plans/e5-scripts.md`) moved the eight operator scripts onto Effect programs: seven (`migrate`, `seed`, `reset-password`,
`uploads-gc`, `plan-run`, `localize-images`, `finance-import-xlsx`) run on the one `AppLayer` through `runScript`
(`apps/api/scripts/support/main.ts`, `BunRuntime.runMain` with a teardown that ends the process after the layer's scope closed), and
`migrate-legacy.ts` runs under `BunRuntime.runMain` on explicit values it resolved itself (the `LegacyMigration` service,
`apps/api/scripts/legacy/service.ts`), because its import order is load-bearing. The `migrate:legacy` library is Effect functions; `finance-import/*`
stays pure.

**Bridges deleted** (each in the commit that moved its last non-test caller): core `initializeHousehold`, `findUserByEmail`,
`createPasswordResetToken`, `collectUploadReferences`; recipe `backfillFoldedColumns`, `localizeImageUrl`; finance `runCatchUp`, `getBalance`,
`slot1UserId`, `requireOtherMemberId`, `categoryIdBySlug`, `syncTransactionTags` and the finance `withTransaction` helper. **`runModuleHook` and
`apps/api/src/modules/adapter.ts` are deleted** (E5-T09): `runFinanceBridge` runs the effect over `Database.layerFromExecutor(executor)` itself and
`runMigrations` is a Promise door over `migrateDatabase` (`apps/api/src/db/migrate.ts`). Idioms rule (12) pins the result: every file directly under
`apps/api/scripts/` runs through `runScript(` or `BunRuntime.runMain(`, no `process.exit(` under `apps/api/scripts/` but the runner's one line, no `await`
in `apps/api/scripts/legacy/` or `apps/api/scripts/finance-import/`, no `runModuleHook` anywhere.

**Survivors after E5** (all removed by E8 with the pinned tests or E9's layer-based test support):

| Bridge | File | Callers | Convention |
| --- | --- | --- | --- |
| `requireUser`, `requireMembership` | `apps/api/src/lib/types.ts` | `apps/api/test/errors.test.ts`, `apps/api/test/middleware.test.ts`, `apps/api/test/modules.test.ts` | synchronous |
| `checkRateLimit`, `resetRateLimits` | `apps/api/src/core/services/auth/rateLimit.ts` | `apps/api/test/auth.test.ts` (pinned), `apps/api/test/rate-limiter.test.ts` and others | synchronous |
| `setMailer`, `getMailer`, `isMailerOverridden`, `trySendMail` | `apps/api/src/core/services/mail/index.ts` | tests; `trySendMail` only `apps/api/test/mail.test.ts` (the `auth:reset-password` script yields the `Mailer` service) | synchronous (`trySendMail`: Promise) |
| `claimPlaceholderUser` | `apps/api/src/core/services/auth/users.ts` | `apps/api/test/placeholders.test.ts` (pinned) | Promise |
| `createSession` | `apps/api/src/core/services/auth/sessions.ts` | `apps/api/test/middleware.test.ts`, `apps/api/test/import/routes.test.ts` | Promise |
| `assignParticipants`, `updateParticipantDisplayName` | `apps/api/src/modules/finance/services/participants/participants.service.ts` | `apps/api/test/finance-module.test.ts` (pinned) | Promise over `runFinanceBridge` |
| `requireFinanceParticipantContext` | `apps/api/src/modules/finance/middleware.ts` | `apps/api/test/finance-participants.test.ts` (pinned) | synchronous |
| recipe `createDraft`, `importFromText`, `fetchHtml`, `assertPublicUrl` | `apps/api/src/modules/recipe/services/import/` | `apps/api/test/import/ocr-disabled.test.ts`, `apps/api/test/import/ssrf.test.ts` (pinned) | as before |
| `runLegacyMigration`, `migrateUsers`, `migrateHouseholds`, `migrateRecipe`, `openLegacy` | `apps/api/scripts/legacy/{run,users,households,recipe,sources}.ts` | the pinned `apps/api/test/legacy-cli.test.ts`, `apps/api/test/legacy-placeholders.test.ts` and `apps/api/test/support/legacy-harness.ts` | Promise over `runLegacy`, next to an `…Effect` form |
| `runMigrations(database?)` | `apps/api/src/db/migrate.ts` | about 20 test files | Promise over `migrateDatabase` |
| `runFinanceBridge` | `apps/api/src/modules/finance/bridge.ts` | the runner of the finance survivors | Promise |

**The process-wide client stays created at import of `apps/api/src/db/client.ts`** (plan deviation 6), against the first Decision bullet's
"after E5 the instance is created by the layer alone": the tests' shared `db` (ADR 0009, `app.request` sees only that database) and
`apps/api/scripts/migrate-legacy.ts` (its dynamic import of `src/db/client.ts` after the `DATABASE_URL` redirect is the pinned order of
`apps/api/test/import-order.test.ts` and `apps/api/test/legacy-cli.test.ts`) read it. `db`, `client` and `dbReady` therefore stay exported from
`client.ts` until E8 decides whether to create the client inside `Database.layer`; `docs/EFFECT.md` E5's sentence says so in this commit.
Consequence for operators: every script on the `AppLayer` ends with one added English line, `[db] database closed` (`Database.layer`'s release),
and a SIGINT or SIGTERM interrupts the program, runs its finalizers and exits 130 where the old scripts died at once.
