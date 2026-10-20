# E2 — api-core-services: plan

**Status: DONE (2026-10-20), planned and revised once after the three critics (feasibility, behaviour preservation,
Effect v4 idioms).** Base commit `6991769c9` (the three Learn-phase pattern files `effect-config`, `effect-stream`,
`effect-datetime-clock`). Sections 9 and 10 (the integration record and "what changed vs plan") were written by
E2-T13.

E2 is the third milestone of the Effect migration (`docs/EFFECT.md` §4 E2; decisions E5, E6, E7 for the core, E9
for the tests, E12 for the idioms). The core of the API becomes Effect underneath while Hono stays on top: the
environment becomes the `AppConfig` service, the libSQL connection the `Database` service, `ApiError` a family of
`Schema.TaggedError` classes rendered by one boundary mapper, mail, uploads, thumbnails and the rate limiter
services, every module under `apps/api/src/core/services/` a `Context.Service` with a static `layer`, the core
routes and the middlewares call `runtime.runPromise(...)`, and the `ApiModule` hooks are Effects behind an adapter
that keeps the Promise-based recipe and finance manifests working until E3 and E4. The guiding sentence holds:
how the code is written changes, not what it does. No `docs/API.md` row, German string, table, migration, exit
code or pinned log line changes.

Exit (`docs/EFFECT.md` §4 E2 and the milestone task): gates green (`bun install --frozen-lockfile`, `bun run
typecheck`, `bun test`, `bun run build`, `bun run i18n:check` with its 146 classified hits); the pass count not
below E1's record; `apps/api/test/db-pragmas.test.ts`, `apps/api/test/middleware.test.ts`,
`apps/api/test/import-order.test.ts`, `apps/api/test/placeholders.test.ts` (the two-claim race), the rate-limit
tests (`apps/api/test/auth.test.ts` "rate limit" block) and the origin-guard tests
(`apps/api/test/security.test.ts`) pass with their files unchanged; `bun run dev:api` boots in the background,
`/api/health` answers, SIGTERM closes the database through the runtime scope (the log shows `[db] database
closed`) and the process exits 0; the curl walkthrough register → create household → invite → accept (the core
rows of `docs/plans/m7-harden.md` §9.3) gives the documented statuses; `git status --porcelain repos/` empty;
`apps/api/test/effect-idioms.test.ts` green with the two E2 rules switched on.

**Revision 1 (critics' findings, 2026-10-20).** What changed against the first draft, so a reader of the record can
follow it: sync and fire-and-forget bridges keep their sync / `void` nature with explicit return types (P1, P9,
P10; the import rate limit of recipe would otherwise have silently become a Promise); every catch-all `try/catch`
keeps catch-all semantics through `Effect.catchCause` (P2, P12; `Effect.catch` sees typed failures only); the
constructors of the error family are permissive and `DatabaseError` is outside the family (P4); `Database` gains
`layerFromExecutor` and `runModuleHook` takes a bare executor (P6, P11); the layer nesting is spelled out, siblings
inside one tier are `provideMerge`d (P3); `nowMs()` leaves the core services too (P7, rule (11)); the middleware
factories called at module scope are hoisted and a second fresh-process import test covers the files the runtime
pulls into the cycle (P12, P21); `smtp.ts` gets its date through an optional `now` on `SmtpMailer.send` (P8); the
former E2-T06 is split into E2-T06 (`HouseholdModules`, `Passwords`, `Users`) and E2-T07 (`Sessions`,
`AuthInvites`, `spendableToken`), which renumbers every later task by one (E2-T13 is the integration);
`assertSpendableToken` keeps its default until E2-T08 converts its two callers; E2-T11's Table B spells out the
`Promise.all` handler and the conditional rate-limit statement.

## 1. Context

### 1.1 State of the tree at plan time (`6991769c9`, measured 2026-10-20)

- **Effect so far.** `apps/api/src/runtime.ts` holds `AppLayer = Layer.empty` (typed `Layer.Layer<never>`),
  `appMemoMap` and the one `runtime`; `apps/api/src/core/health.ts` `healthResponse` is the only effect run on it
  (`GET /api/health`); `apps/api/src/index.ts` disposes the runtime after the modules' `shutdown()` on
  SIGTERM/SIGINT. `apps/api/src/lib/validate.ts` decodes synchronously with `Schema.decodeUnknownSync(…,
  ALL_ISSUES)` and throws `Schema.SchemaError`; `toApiError` in `apps/api/src/lib/errors.ts` maps it to `422
  validation_failed` through `toValidationIssues`. `apps/api/src/env.ts` (542 lines) decodes a local `Schema`
  (`EnvFields` → `EnvValue` with six cross-field refinements, `errors: "all"`) through the pure `parseEnv(source)`
  and exports the eager `env`, `REPO_ROOT`, `Env`, `ParsedEnv`; `apps/api/test/env-parse.test.ts` (40 tests) pins
  every message line.
- **`ApiError`** (`apps/api/src/lib/errors.ts`, 142 lines): a class with `status`, `code`, `text` (a `ServerKey`
  or `{ key, values }`), `details`, an English `message` for the log, `toBody(locale)` and ten static helpers
  (`badRequest` 400, `unauthorized` 401, `invalidCredentials` 401, `forbidden` 403, `notFound` 404, `conflict`
  409 with a code argument, `payloadTooLarge` 413, `unsupportedMediaType` 415, `validationFailed` 422,
  `internal` 500). `onErrorHandler` logs `[api] METHOD path ->` plus the error for status ≥ 500 and, under
  `NODE_ENV=development`, `[api] METHOD path -> status code: message` otherwise; `notFoundHandler` answers
  `server.error.routeUnknown`. Throw sites: 87 `throw ApiError.x(...)` / `throw new ApiError(...)` in the core
  (`core/routes/**` 23, `core/services/**` 47, `lib/oauth.ts` 7, `lib/types.ts` 2, `middleware/**` 8), 29
  module files in `apps/api/src/modules/**`, none in `apps/api/scripts/**`. Modules also use `ApiError` as a
  return TYPE (`function participantsRequired(): ApiError`, `ssrf.ts` `toApiError(): ApiError`,
  `recipe/services/ocr/index.ts` `instanceof ApiError`).
- **Database** (`apps/api/src/db/client.ts`, 173 lines): `createDatabase({ url?, authToken? })` returns `{ client,
  db, ready }`, sends the six D7 pragmas once and passes `timeout: 5000` to `createClient` for a local file;
  module scope creates the shared instance and exports `client`, `db`, `dbReady` and the drizzle TYPE `Database`
  (`db/client.ts` is imported by 38 files under `apps/api/src/modules` and `apps/api/scripts`, for `db` and for the
  type). `withTransaction(db, work)` and `transactionsSupported`
  live in `apps/api/src/core/services/households/support.ts` (degrade to sequential on a `:memory:` URL).
- **Core services** (`apps/api/src/core/services/`, 4 areas, 28 files, ~4300 lines): every function takes the
  drizzle handle first (`db: DbLike` / `database: Database`), returns a `Promise` and throws `ApiError`. Time is
  read with `Date.now()` / `new Date()` at 29 places in 13 files, plus 8 calls of `support.ts`'s
  `nowMs()` in `households.service.ts`, `invites.service.ts` and `households/modules.ts` (section 2, P7). Module-level state:
  `rateLimit.ts` (`buckets`), `mail/index.ts` (`mailer`, the `setMailer` seam), `verifiedEmail.ts` (the
  `setVerifiedEmailRequired` seam), `thumbnails.ts` (`inFlight`, `failedAt`, the slot counter, the lazy `sharp`).
- **Who calls the core from outside it** (the bridge inventory of P1; measured with `grep` over `apps/api/src/modules`,
  `apps/api/scripts`, `apps/api/test`):
  - recipe and finance (E3/E4 move them): `db` and the type `Database` (`db/client.ts`), `ApiError` (all helpers and
    `new ApiError`), `support.ts` (`DbLike`, `withTransaction`, `nowMs`, `transactionsSupported`, `foldText`,
    `eqFolded`, `likeFolded`, `likeStoredFold`, `toCountMap`, `unique`), `assertRole` and `assertCanModifyOwned`
    (`membership.ts`), `toPublicUser` (`mappers.ts`), `isUniqueViolation` and `isPlaceholderUser` (`users.ts`),
    `keepOnlySentKeys` (`validation.ts`), `storeUploadedImage` (`uploads.ts`), `thumbnailUrlFor`,
    `listImageUrlFor`, `THUMBNAIL_SUFFIX`, `warmThumbnail` (`thumbnails.ts`), `IMPORT_RULE` and
    `enforceRateLimit` (`rateLimit.ts`; SYNC, called as a plain unawaited statement in `recipe/routes/imports.ts`), `isVerifiedEmailRequired` (`verifiedEmail.ts`), `enableModule`
    (`households/modules.ts`, finance seed), `requireUser` and `requireMembership` (`lib/types.ts`),
    `requireSession`, `requireHouseholdRole`, `requireModule`, `requireVerifiedEmail` (middleware), `env`.
  - scripts (E5 moves them): `db`, `client`, `dbReady`, `createDatabase`, `runMigrations`, `env`,
    `initializeHousehold` (`seed.ts`), `API_MODULES[i].seedDemo` (`seed.ts`), `generateInviteToken` and
    `INVITE_TTL_MS` (`scripts/legacy/claims.ts`), `filenameOf`, `collectUploadReferences`, `originalOfThumbnail`
    (`uploads-gc.ts`, `legacy/uploads.ts`), `findUserByEmail`, `createPasswordResetToken`,
    `PASSWORD_RESET_TTL_MINUTES`, `isMailConfigured`, `passwordResetMail`, `trySendMail`, `webUrl`
    (`reset-password.ts`).
  - tests pinned unchanged by the exit criteria: `createSession(db, userId)` (`middleware.test.ts`),
    `claimPlaceholderUser(db, …)` (`placeholders.test.ts`), `checkRateLimit`, `resetRateLimits`, `LOGIN_RULE`
    (`auth.test.ts`), `createDatabase`, `client` (`db-pragmas.test.ts`), `isForeignOrigin`, `clientIp`,
    `inlineScriptHashes` (`security.test.ts`). The test seams every suite uses: `setMailer`,
    `setVerifiedEmailRequired`, `resetRateLimits`.
  - module tests (E3/E4 move them): `initializeHousehold(created.db, …)` (`finance-seed.test.ts`),
    `collectUploadReferences`, `filenameOf` (`recipe-module.test.ts`), `isUniqueViolation`, `resetRateLimits`,
    `ApiError` with `instanceof` (`finance-module.test.ts`), `localeMiddleware`, `onErrorHandler`,
    `notFoundHandler` (`finance-participants.test.ts`).
- **Core tests that call a core service directly** (rewritten onto the service by the task that converts it, P14):
  `auth.test.ts` (users, auth invites, oauth accounts, passwords; NOT its rate-limit block), `password-reset.test.ts`
  (email verification, password reset, `hashToken`), `verified-email-gate.test.ts` (`markEmailVerified`),
  `placeholders-core.test.ts` (`toUserDto`, `requireAccountEmail`, `listMembers`, `previewInvite`,
  `toHouseholdInvite`), `households.test.ts` (`createOwnedHousehold`), `modules.test.ts` (`enableModule`,
  `initializeHousehold`), `mail.test.ts` and `mail/smtp.test.ts` (the mail adapters), `uploads.test.ts`
  (`storeUploadedImage`), `thumbnails.test.ts` (the thumbnail functions).
- **The ApiModule hooks** are called at seven places: `src/index.ts` (`start`, `shutdown`), `src/db/migrate.ts`
  (`afterMigrate`), `core/services/media/references.ts` (`uploadReferences`),
  `core/services/households/households.service.ts` (`onMemberRemoving`),
  `core/services/households/modules.ts` (`onHouseholdCreated`, `onEnable`), `scripts/seed.ts` (`seedDemo`);
  `modules.test.ts` builds three fake modules with Promise hooks. `healthFeatures` is synchronous and stays so.
- **The import cycle** (CLAUDE.md "API import cycle"): `middleware/session.ts` → `auth/users.ts` →
  `households/modules.ts` → `modules/index.ts` → the recipe manifest → `routes/cards.ts` (calls `requireSession()`
  at module scope). Plus `auth/bootstrap.ts` → `households.service.ts` → `auth/users.ts`. Every new module-scope
  read of an imported binding on that path is a TDZ crash in some import order; `import-order.test.ts` loads 14
  entry points first in a fresh process.
- **Bun.** `.bun-version` says 1.4.2; the host runs 1.4.3 (the same as at E1's review). Nothing in E2 depends on
  the difference.

### 1.2 Baseline

`bun test` at `6991769c9`, 2026-10-20: **14507 pass, 1 fail, 14508 tests in 150 files, 39.79 s**. The one failure is
a stale documentation guard, `apps/api/test/validation-wire.test.ts` "the wire change stays an open owner decision
until acknowledged (ADR 0013, open-work D-7)": commit `724042d79` recorded the owner's acceptance of D-7 (ADR 0013
`Status: accepted by the owner on 2026-10-16`, the D-7 row removed from `docs/open-work.md`) but left the test
that pins the open state. E2-T01 turns it into a guard of the accepted state (P16), which brings the record to
**14508 pass, 0 fail**; every later task verifies `pass >= 14508`. E1's record (14508 pass) is the floor of the
exit criterion.

### 1.3 Bundle size

Not asked for E2 (E6 and E7 record it). E2 touches no web file.

## 2. Decisions (binding for the tasks)

Each names the `docs/EFFECT.md` decision it serves. A task that cannot follow one makes the smallest deviation
and records it in its commit body; E2-T13 copies it to section 10.

**P1 — Legacy bridges keep every outside caller working (E3, E7, E10).** A converted core file exports the
`Context.Service` AND, for every old export that a caller outside the converted set still uses, a bridge with the
old name and the old signature. A bridge:
- takes the old `db` / `database` first argument and honours it through `Database.withExecutor(db)` (P6);
- **keeps the old function's calling convention exactly, and says so with an explicit return type annotation copied
  from the old signature** (`: string`, `: void`, `: RateLimitResult`, `: Promise<UserRow | undefined>`), so `tsc`
  refuses a bridge that turned sync into async:
  - an old `async` / `Promise`-returning export runs the service through `runtime.runPromise(...)`; a failure
    rejects with the tagged error itself (the squashed cause);
  - an old SYNCHRONOUS export stays synchronous: `Effect.runSync(...)` over a service-free effect (one that reads
    only the default services, i.e. the `Clock`, and module-level state; never `AppConfig` or `Database`, which it
    gets as plain values: `env` (P5) or an argument). A failure throws the tagged error synchronously
    (`Effect.runSync` throws `Cause.squash`, `src/internal/effect.ts` `runSyncWith`). The sync bridges of E2:
    `checkRateLimit`, `enforceRateLimit`, `resetRateLimits` (P9), `requireUser`, `requireMembership` (P19),
    `toUserDto`, `requireAccountEmail` (E2-T06), `assertRole`, `assertCanModifyOwned` (E2-T09),
    `requireProviderConfigured` (E2-T08), `isVerifiedEmailRequired`, `getMailer`, `isMailConfigured` (E2-T04);
  - an old fire-and-forget `void` export stays `void` and never rejects: it starts the work with
    `runtime.runFork(effect.pipe(Effect.ignoreCause))` (or `void runtime.runPromise(...).catch(() => undefined)`)
    and returns nothing (`warmThumbnail`, P10);
- holds no literal `throw`;
- sits in a section `/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */`
  at the end of the file, each with a one-line comment naming its remaining callers.
Bridges exist while the routes and middlewares are converted (waves 3 to 7). E2-T13 deletes every bridge whose
only callers were core routes, middlewares, `src/index.ts` or rewritten core tests; what survives E2 is exactly
the inventory of section 1.1 (modules, scripts, pinned tests, module tests, the three test seams). Pure helpers
(no I/O, no time, no failure) are not bridges: they stay plain exported functions forever (P2).

**P2 — Service conventions (E7, E12).**
- One `Context.Service` class per service file, named as in the service table below, id string
  `"toon/api/<path from src without extension>/<Name>"` (e.g. `"toon/api/core/services/auth/users/Users"`).
  Shape: `Context.Service<Self, { readonly method: (...) => Effect.Effect<A, E> }>()(id)`; the type params
  first, the id second (`agent-patterns/effect-services.md` §2.1).
- **Method names are the old exported function names with the leading `db` / `database` parameter dropped**;
  every other parameter and the result type stay (`Promise<T>` becomes `Effect.Effect<T, E>`). Example:
  `listHouseholdsForUser(db, userId)` becomes `Households.listHouseholdsForUser(userId)`. This makes the route
  rewrite of E2-T11 a table.
- Every method is `Effect.fn("Name.method")(function* (...) {...})`; hot pure-ish helpers may use
  `Effect.fnUntraced`. Combinators go in as extra arguments of `Effect.fn`, never `.pipe` on it. `return yield*`
  when raising. Failures are declared: `Effect.Effect<A, NotFound | Conflict | DatabaseError>` (P4).
- `static readonly layer = Layer.effect(this, Effect.gen(function* () { const database = yield* Database; …
  return Name.of({ … }) }))`. The layer leaves its service dependencies OPEN (they appear in its requirements);
  it never calls `Layer.provide(Other.layer)`. **A static initializer references no imported binding other than
  `effect` exports and the class itself**: dependencies are yielded INSIDE the generator, which runs at build
  time. Reason: the import cycle of section 1.1 evaluates some service files before others in some orders; a
  static `Layer.provide(Other.layer)` would read `Other` in its TDZ (CLAUDE.md "API import cycle").
- Dependencies are captured at layer build (`const database = yield* Database`), EXCEPT time (P7) and the current
  executor (P6), which are read inside the method body on every call so a per-run `TestClock` or transaction
  reaches them.
- **Catch-all stays catch-all.** `Effect.catch` and `Effect.catchTag(s)` see the typed error channel only; a
  synchronous throw inside a generator and an `Effect.promise` rejection are DEFECTS and pass them by. Every place
  whose old code caught everything keeps catching everything: a Promise is wrapped with `Effect.tryPromise` (its
  rejection becomes a typed failure; look up in `src/Effect.ts` ~990 whether a synchronous throw of the thunk is
  caught too, and wrap the thunk with `Effect.try` if not), and the recovery handles the WHOLE cause with
  `Effect.catchCause` (`Cause.squash(cause)` gives the value the old `catch (error)` saw) or `Effect.ignoreCause`
  where the old code swallowed silently. The sites: `verifyPassword` (a malformed hash is `false`, never a 500;
  E2-T06), `sweepExpiredSessions` (E2-T07), `sweepExpiredResetTokens` and `sweepExpiredVerificationTokens` (E2-T08),
  `trySendMail` (never fails, same log line; E2-T04), the thumbnail generation and its failure cache (E2-T04), and
  in the routes `sendVerificationLinkQuietly` and the OAuth callback (E2-T10, P12). The fire-and-forget sweeps
  (`void sweepExpired…(db)` today) stay fire-and-forget inside the service: `Effect.forkDetach` (`src/Effect.ts`
  ~8917) of the sweep with its cause ignored, never awaited by the request.
- Files that hold only pure helpers stay plain modules (no service): `auth/tokens.ts` (except `spendableToken`,
  an `Effect.fnUntraced` reading the `Clock`, P7), `households/mappers.ts`, `households/validation.ts`,
  `households/support.ts` (the module helpers, P1), `mail/templates.ts`, `mail/types.ts`; the transport classes
  `ConsoleMailer`, `SmtpMailer`, `ResendMailer` stay classes wrapped by the `Mailer` layers (P8).
- Service table (file → class, owner task):

| File | Service | Depends on | Task |
| --- | --- | --- | --- |
| `apps/api/src/config.ts` | `AppConfig` | (the environment) | E2-T02 |
| `apps/api/src/db/database.ts` | `Database` | `AppConfig` | E2-T03 |
| `core/services/mail/index.ts` | `Mailer` | `AppConfig` | E2-T04 |
| `core/services/auth/rateLimit.ts` | `RateLimiter` | `AppConfig` | E2-T04 |
| `core/services/auth/verifiedEmail.ts` | `VerifiedEmail` | `AppConfig`, `Mailer` | E2-T04 |
| `core/services/media/thumbnails.ts` | `Thumbnails` | `AppConfig` | E2-T04 |
| `core/services/media/uploads.ts` | `Uploads` | `AppConfig`, `Thumbnails` | E2-T04 |
| `core/services/media/references.ts` | `UploadReferences` | `Database` | E2-T05 |
| `core/services/households/modules.ts` | `HouseholdModules` | `Database` | E2-T06 |
| `core/services/auth/passwords.ts` | `Passwords` | (none) | E2-T06 |
| `core/services/auth/users.ts` | `Users` | `Database`, `HouseholdModules` | E2-T06 |
| `core/services/auth/sessions.ts` | `Sessions` | `Database` | E2-T07 |
| `core/services/auth/invites.ts` | `AuthInvites` | `Database`, `Users` | E2-T07 |
| `core/services/auth/emailVerification.ts` | `EmailVerification` | `Database`, `Users` | E2-T08 |
| `core/services/auth/passwordReset.ts` | `PasswordReset` | `Database`, `Users`, `Sessions`, `Passwords` | E2-T08 |
| `apps/api/src/lib/oauth.ts` | `OAuthProviders` | `AppConfig` | E2-T08 |
| `core/services/auth/oauthAccounts.ts` | `OAuthAccounts` | `Database`, `Users` | E2-T08 |
| `core/services/households/households.service.ts` | `Households` | `Database`, `Users`, `HouseholdModules` | E2-T09 |
| `core/services/households/invites.service.ts` | `HouseholdInvites` | `Database`, `Households`, `AppConfig`, `Mailer` | E2-T09 |
| `core/services/auth/bootstrap.ts` | `AuthBootstrap` | `Database`, `Households` | E2-T09 |

`households/membership.ts` becomes Effect checks (`checkRole`, `checkCanModifyOwned`, R = never) plus the
sync bridges `assertRole` and `assertCanModifyOwned` for recipe; its one DB helper `countOwners` becomes a method of
`Households` (E2-T09 keeps a bridge only if a caller outside remains; today none does).

**P3 — One composition point, evaluated lazily, siblings nested explicitly (E7, CLAUDE.md "API import cycle").**
`Layer.mergeAll` feeds no member's output into another member's input (`src/Layer.ts` ~1275); `Layer.provideMerge(
that)(self)` (~1582) satisfies `self`'s requirements from `that` and keeps both outputs, and requirements left open
travel outward to the next `provideMerge`. So a service that needs a service of the SAME composition step is put
in an outer step under it, never beside it in one `mergeAll`. The compositions, final form (owner in brackets):
- `apps/api/src/runtime.ts` [E2-T03, `moduleLayers()` E2-T05]: `export const AppLayer = Layer.suspend(appLayer)`
  where `appLayer` is a HOISTED `function` declaration returning
  `Layer.mergeAll(coreServicesLayer(), ...moduleLayers()).pipe(Layer.provideMerge(infraLayer()))`;
  `moduleLayers()` reads `API_MODULES` inside the function and returns `[]` for both modules today. The file keeps
  `appMemoMap` and the one `runtime = ManagedRuntime.make(AppLayer, { memoMap: appMemoMap })`. Its module scope
  reads no imported binding except `Layer` and `ManagedRuntime`, so `runtime.ts` can be imported from anywhere in
  the cycle (the bridges of P1 import it). `AppLayer` carries an explicit type annotation whose third parameter
  is `never` (`Layer.Layer<AppServices, AppLayerError, never>`), so a requirement left open by a wrong nesting is
  a `tsc` error in `runtime.ts`, not a surprise in `ManagedRuntime.make`.
- `apps/api/src/infra.ts` [E2-T03, then E2-T04]: `export function infraLayer()`. E2-T03:
  `Database.layer.pipe(Layer.provideMerge(AppConfig.layer))`. E2-T04, final:
  `Layer.mergeAll(RateLimiter.layer, VerifiedEmail.layer, Uploads.layer).pipe(Layer.provideMerge(Layer.mergeAll(
  Mailer.layer, Thumbnails.layer)), Layer.provideMerge(Database.layer), Layer.provideMerge(AppConfig.layer))`
  (`VerifiedEmail` needs `Mailer`, `Uploads` needs `Thumbnails`; everything needs `AppConfig`).
- `apps/api/src/core/services/layer.ts` [E2-T03 stub, E2-T05, E2-T06, E2-T07]: `export function
  coreServicesLayer()` = `Layer.mergeAll(authServicesLayer(), householdServicesLayer()).pipe(Layer.provideMerge(
  baseServicesLayer()))` and `export function baseServicesLayer()` in the same file:
  - E2-T03: `Layer.empty`;
  - E2-T05: `UploadReferences.layer`;
  - E2-T06: `Users.layer.pipe(Layer.provideMerge(Layer.mergeAll(HouseholdModules.layer, Passwords.layer,
    UploadReferences.layer)))`;
  - E2-T07, final: `AuthInvites.layer.pipe(Layer.provideMerge(Layer.mergeAll(Users.layer, Sessions.layer)),
    Layer.provideMerge(Layer.mergeAll(HouseholdModules.layer, Passwords.layer, UploadReferences.layer)))`.
- `apps/api/src/core/services/auth/layer.ts` [E2-T03 stub `Layer.empty`, E2-T08]: `export function
  authServicesLayer()` = `Layer.mergeAll(EmailVerification.layer, PasswordReset.layer, OAuthProviders.layer,
  OAuthAccounts.layer)` (no sibling dependencies: all stand on the base tier and the infra).
- `apps/api/src/core/services/households/layer.ts` [E2-T03 stub `Layer.empty`, E2-T09]: `export function
  householdServicesLayer()` = `Layer.mergeAll(HouseholdInvites.layer, AuthBootstrap.layer).pipe(
  Layer.provideMerge(Households.layer))`.
- Every composition file exports hoisted functions only; nothing in them runs at import. A task that adds a
  service whose dependencies differ from the P2 table nests it accordingly and records it.

**P4 — The error family and the one boundary mapper (E6, E12).** In `apps/api/src/lib/errors.ts`:
- One `Schema.TaggedError` class per static helper, carrying `status`, `code` and `text` exactly as the helper:
  `BadRequest` (400 `bad_request`, default `server.error.badRequest`, optional `details`), `Unauthorized` (401
  `unauthorized`), `InvalidCredentials` (401 `invalid_credentials`), `Forbidden` (403 `forbidden`), `NotFound`
  (404 `not_found`), `Conflict` (409, `code` field defaulting to `conflict`, default text `server.error.conflict`),
  `PayloadTooLarge` (413), `UnsupportedMediaType` (415), `ValidationFailed` (422 `validation_failed`, `details`),
  `Internal` (500 `internal_error`); plus `RateLimited` (429 `rate_limited`, field `retryAfterSeconds`, text
  `{ key: "server.error.tooManyAttempts", values: { seconds } }`; the mapper sets `Retry-After`) and `ApiFailure`
  (generic: `status`, `code`, `text`, optional `details`; for `email_unverified`, `module_disabled`,
  `member_has_ledger`, every other code). `new NotFound()` and `new NotFound({ text })` are both valid (defaults
  through `Schema.withConstructorDefault`, `src/Schema.ts` ~5930); each instance's `message` is the English text
  (`serverText("en", text)`), what the log shows today.
- **The constructors never throw on a value today's code passes.** A `Schema.TaggedError` constructor VALIDATES its
  fields (`src/Schema.ts` ~16278 builds on `Schema.Error`; `disableChecks` ~126 skips it), and a throwing
  constructor would surface as `422 validation_failed` with constructor issues inside an error path. So the field
  schemas are permissive: `status: Schema.Number`, `code: Schema.String`, `text` a `Schema.declare` that accepts a
  string or any object (typed as today's `ServerText`, no check on `values`), `details: Schema.optional(
  Schema.Unknown)` (accepts an explicit `undefined`), `retryAfterSeconds: Schema.Number`; and the legacy `ApiError`
  constructor and its static helpers pass `{ disableChecks: true }` (look the option up, ~126 and ~16054) so no
  module call can make them throw.
- `DatabaseError` (`cause: Schema.Defect()`) is a `Schema.TaggedError` that is **NOT a member of the API family**:
  `ApiErrorFamily` does not include it, `isApiError` is `false` for it, and `ApiError[Symbol.hasInstance]` is
  `false` for it, so module code's `instanceof ApiError` (e.g. `recipe/services/ocr/index.ts`) and the OAuth
  callback's code choice never treat a database failure as an API error. The mapper renders it as `500
  internal_error` and the log line shows its `cause`. `MailError` (P8) is outside the family too and never reaches
  the wire.
- `ApiErrorFamily` (the union type of the twelve classes above, `ApiError` included through `ApiFailure`) and
  `isApiError(u)` (a `Predicate` over the family's tags, no `instanceof`).
- **The legacy class stays for the modules:** `export class ApiError extends ApiFailure` with the old positional
  constructor `(status, code, text, details?)`, the ten static helpers returning `ApiError` instances with the same
  status/code/text as today, `toBody(locale)` (delegates to `errorBody`), and `static [Symbol.hasInstance](u) {
  return isApiError(u) }` so `x instanceof ApiError` stays true for EVERY family member (module code, module tests
  and rewritten core tests that assert `toBeInstanceOf(ApiError)`). Module code keeps compiling unchanged, because
  the helpers still return the type `ApiError`.
- The mapper: `toApiError(unknown, locale)` → a family member (a family member as is; `Schema.isSchemaError` →
  `ValidationFailed` with `toValidationIssues(error.issue, locale)`; a Hono `HTTPException` → `ApiFailure(status,
  401/403/404/else-400 code, "server.error.requestFailed")`; a `DatabaseError` and anything else, a non-`Error`
  defect such as the string `"ManagedRuntime disposed"` included → `Internal`); `errorBody(error, locale)` → the
  envelope `{ error: { code, message, details? } }` byte-identical to today's `toBody`; `onErrorHandler` and
  `notFoundHandler` keep their names, their log lines (≥ 500: `console.error("[api] METHOD path ->", original)`
  with the ORIGINAL thrown value, for a `DatabaseError` its `cause`; < 500 under `NODE_ENV=development`:
  `console.warn("[api] METHOD path -> status code: message")`) and their responses; `Retry-After` for a
  `RateLimited`.

**P5 — `AppConfig` (E7, E10).** `apps/api/src/config.ts` defines `AppConfig` (`Context.Service<AppConfig, Env>`,
the resolved object `env` is today, every derived field included), the variable schema moved from `env.ts`
(messages unchanged), `AppConfig.config: Config.Config<Env>` (reads every known variable from the current
`ConfigProvider` and decodes them through the moved schema with every issue collected; a failure is a
`Config.ConfigError` whose formatted lines equal `parseEnv`'s), `AppConfig.layer` (the process value, resolved
ONCE per process: the root `.env` then `.env.local` loaded with process env winning and nothing loaded under
`NODE_ENV=test`, empty and whitespace-only values unset, `NODE_ENV=test` picking `TEST_DATABASE_URL` or a fresh
temp file and the placeholder `SESSION_SECRET`, a bad environment printing the same `Invalid environment
variables — check your .env (template: .env.example):` block and exiting 1) and `AppConfig.layerFrom(values)`
(explicit raw values, no `process.env`, no dotenv, no test rules: for E5's `migrate-legacy.ts` and for tests).
`apps/api/src/env.ts` becomes the re-export: `export const env: Env` is the SAME object `AppConfig.layer` provides,
plus `REPO_ROOT`, `parseEnv`, `Env`, `ParsedEnv`; every file that imports `env` keeps compiling. Note
`agent-patterns/effect-config.md` §6: `Config.schema` decodes without `errors: "all"` and `fromEnv` treats `""` as
missing, so the struct decode stays the moved `Schema` with `ALL_ISSUES`, applied in `Config.mapEffect`, and
`parseEnv(source)` keeps `""` as a value. `config.ts` imports nothing from the API (it is the root of the graph).

**P6 — `Database` (E5).** `apps/api/src/db/database.ts` (new; `db/client.ts` keeps exporting the drizzle TYPE
`Database` that the module and script files import, plus a new alias `DrizzleDatabase`; the service class lives in
its own file so the two names never collide). Shape:
`{ drizzle: DbExecutor; client: Client | undefined; url: string | undefined; transactionsSupported: boolean;
executor: Effect<DbExecutor>; use<A>(f: (db: DbExecutor) => Promise<A>): Effect<A, DatabaseError>; transaction<A, E,
R>(effect: Effect<A, E, R>): Effect<A, E | DatabaseError, R> }` with `DbExecutor = DrizzleDatabase |
DrizzleTransaction` (equal to `support.ts`'s `DbLike` and `modules/types.ts`'s `DbExecutor`). `client` and `url` are
`undefined` only for `layerFromExecutor`; no core service reads them (the release, the tests and `layerFromUrl` do).
- **The current executor** is a `Context.Reference` read on every `use` / `executor` call: inside `transaction` it
  is the open transaction; `Database.withExecutor(db)(effect)` sets it to a handed-in instance (the P1 bridges);
  otherwise the service's root `drizzle`. Each executor carries a flag "root" or "open transaction".
- **`transaction(effect)`**: when the current executor is an OPEN transaction that `Database.transaction` itself
  opened, `effect` runs inline (no savepoint: today's code passes `tx` down without a nested transaction). Otherwise
  the current executor counts as a ROOT, a handed-in one included, and `transaction` calls its `.transaction(...)`;
  when the handed-in executor is itself a drizzle transaction that is a savepoint, exactly what today's
  `withTransaction(tx, …)` does. When `transactionsSupported` is false (an explicit `:memory:` URL) `effect` runs
  without a transaction (same statement order, no rollback guarantee: today's `withTransaction` rule). A typed
  failure or a defect of `effect` rolls back and surfaces unchanged (same tagged error, same identity); success
  commits.
- Layers:
  - `Database.layer` wraps the process-wide instance of `db/client.ts` (`db`, `client`, `dbReady`): acquire awaits
    `dbReady` (the pragmas; a broken database fails the build at boot), release closes `client` and logs `[db]
    database closed`, EXCEPT under `NODE_ENV=test`, where release does nothing (the tests share one process and one
    client; `apps/api/test/runtime.test.ts` (d) disposes a throwaway `AppLayer` runtime).
  - `Database.layerFrom({ db, client, url })` wraps an existing created instance and never closes it
    (tests, and the scripts E5 moves onto layers). `transactionsSupported` = `!url.includes(":memory:")`.
  - `Database.layerFromExecutor(executor)` wraps a BARE drizzle executor (a root instance or an open drizzle
    transaction, which is all the hook call sites of E2-T05 hold) and never closes anything: `drizzle` is that
    executor (a root in the sense above, so a `transaction` inside opens a savepoint on a handed-in `tx`, as today's
    hooks calling `withTransaction(tx, …)` do), `client` and `url` are `undefined`, and `transactionsSupported` is
    the process-wide rule today's `withTransaction` applies to ANY handed-in `db`: `!env.databaseUrl.includes(
    ":memory:")` (`support.ts`'s exported `transactionsSupported`, read inside the layer, not at import).
  - `Database.layerFromUrl(url, authToken?)` is fully scoped: `createDatabase`, await `ready`, close on release
    (E10's explicit layer); `transactionsSupported` from its `url`.
  The process-wide instance stays created at import of `db/client.ts` because recipe, finance and the scripts
  import `db` until E3 to E5: this is the one transitional deviation from E5's "owns", recorded in ADR 0014 (P17).
- `db/client.ts` keeps `createDatabase`, the pragma list and comments, `client`, `db`, `dbReady`, `schema`
  untouched in behaviour (`apps/api/test/db-pragmas.test.ts` unchanged and green, the pooled connection
  included); `CreatedDatabase` gains `url`.

**P7 — Time through `Clock` / `DateTime` (E7, E12).** In `apps/api/src/core/services/**` every `Date.now()` AND
every `nowMs()` call (8 today: 5 in `households.service.ts`, 2 in `invites.service.ts`, 1 in `households/modules.ts`;
`nowMs` reads `Date.now()` in the allow-listed `support.ts`, so a call bypasses the `Clock` as surely as a literal)
becomes `yield* Clock.currentTimeMillis` (unix ms for a DB row), and every `new Date(...)` a `DateTime` value
(`DateTime.formatIso`, `DateTime.toDateUtc` where an API wants a `Date`, e.g. the SMTP `Date` header, P8), read
INSIDE the method body (never captured at layer build), so `TestClock.layer()` provided around one run reaches it.
Pure helpers that took `now = Date.now()` as a default parameter (`mappers.ts` `toInviteStatus`,
`emailVerification.ts` `markEmailVerified`, `smtp.ts` `buildMessage`) lose the default; their callers pass the
Clock's value. `tokens.ts` `assertSpendableToken` keeps its default until its two callers move: E2-T07 adds
`spendableToken` (the Clock-reading Effect) beside it, E2-T08 moves `emailVerification.ts` and `passwordReset.ts` onto
`spendableToken` and then deletes `assertSpendableToken`. The one `Date.now()` left under `core/services` after
E2 is `households/support.ts` `nowMs()` itself, the module helper of P1 (recipe and finance call it until E3/E4);
nothing under `apps/api/src/core/` calls it (rule (11), P15). `lib/**` (`cookies.ts`, `http.ts`, `uploadUrls.ts`)
is outside the rule and unchanged.

**P8 — `Mailer` (E7).** `Mailer` (`core/services/mail/index.ts`) has `{ name: "console" | "smtp" | "resend" |
string; send(message): Effect<void, MailError>; trySendMail(message): Effect<MailSendResult> }` (`trySendMail`
never fails, catches the whole cause (P2) including a transport whose `send` throws synchronously, and logs `[mail]
Sending to <redacted> failed (<transport>): <reason>` exactly as today). Layers: `Mailer.layerConsole`,
`Mailer.layerSmtp(config)`, `Mailer.layerResend(apiKey, from)` and `Mailer.layer = Layer.unwrap(...)` choosing by
`AppConfig.mailTransport` (always console, silent, under `NODE_ENV=test`). The test seam stays: `setMailer(m)` /
`setMailer(null)` swap a module-level override that every `Mailer` built by these layers consults at send time and
that `isMailConfigured()` reads, so the through-the-app tests that install a fake keep working unchanged. Sync
exports kept: `getMailer`, `setMailer`, `isMailerOverridden`, `isMailConfigured`, `mailDeliveryOf`,
`redactAddress`, the transports, `templates.ts`; `trySendMail(message)` stays as a bridge (reset-password script,
routes until E2-T10). `MailError` is a `Schema.TaggedError` outside the API family (it never reaches the wire).
**The SMTP date:** the shared transport interface (`mail/types.ts` `Mailer.send(message): Promise<void>`, which the
`setMailer` fakes implement) does not change. `SmtpMailer.send(message, now?: Date)` gains an OPTIONAL second
parameter that it hands to `deliver` and on to `buildMessage(…, from, now)`; `buildMessage`'s `now` loses its `new
Date()` default and becomes required. Only the `Mailer` layer passes it:
`layerSmtp`'s `send` reads `DateTime.nowAsDate` (`src/DateTime.ts` ~882, the `Clock`'s time as a `Date`) and calls
`transport.send(message, now)`. A direct `SmtpMailer.send(message)` without `now` (the transport tests, a caller
through `getMailer()`) uses `DateTime.toDateUtc(DateTime.nowUnsafe())` (~909, ~1572), so `smtp.ts` holds no `new
Date(`; `mail/smtp.test.ts` keeps its fixed-date `buildMessage` cases, which pass `now` explicitly as they do today.

**P9 — `RateLimiter` (E7).** The buckets stay ONE module-level store shared by the service and the bridges. The
core of the file is a service-free `Effect.fnUntraced` `checkIn(key, rule): Effect<RateLimitResult>` (time from
`Clock.currentTimeMillis`, the store) and `enforceIn(scope, identifier, rule, enabled: boolean): Effect<string,
RateLimited>` (the key is `${scope}:${identifier.toLowerCase()}`; when `enabled` is false it returns the key and
records nothing, which is today's `NODE_ENV=test` no-op; a refusal fails with `RateLimited({ retryAfterSeconds })`).
- `RateLimiter` (`core/services/auth/rateLimit.ts`): `check(key, rule)` = `checkIn`, `enforce(scope, identifier,
  rule)` = `enforceIn(…, !config.isTest)` with `config` from `AppConfig` captured at build, `reset(key?)`.
- **The bridges stay SYNCHRONOUS (P1), with explicit return types:** `checkRateLimit(key, rule): RateLimitResult` =
  `Effect.runSync(checkIn(key, rule))`; `resetRateLimits(key?): void`; `enforceRateLimit(c, scope, identifier,
  rule, enabled: boolean = !env.isTest): string` = `Effect.runSync(enforceIn(…, enabled).pipe(Effect.tapError((e) =>
  Effect.sync(() => c.header("Retry-After", String(e.retryAfterSeconds))))))`: it returns the key or THROWS the
  `RateLimited` synchronously, and sets the header on `c` as today. Recipe's `imports.ts` calls it as a plain,
  unawaited statement (`imports.ts:109, 161, 206`, untouched in E2); a Promise-returning bridge would typecheck there,
  stay green under test (where it is a no-op) and in production drop the import limit and leave an unhandled
  rejection. The trailing `enabled` parameter is new and optional (recipe's calls are unchanged); it exists so a test
  can switch the limiter on under `NODE_ENV=test`.
- The rules (`LOGIN_RULE`, …, `INVITE_RULE` 10/h, `HOUSEHOLD_CREATE_RULE` 5/h, `IMPORT_RULE`) and `clientIp(c)`
  (LAST `X-Forwarded-For` entry under `TRUST_PROXY`) are unchanged pure exports. `Retry-After` on the response comes
  from the mapper for a `RateLimited` (P4) and, for the bridge, from `c.header` as well (same value).
- `apps/api/test/rate-limiter.test.ts` (E2-T04) proves the enforce → 429 path that the suite never exercised (the
  limiter is off under test): see E2-T04.

**P10 — `Uploads`, `Thumbnails`, `UploadReferences` (E7).** `Thumbnails` (`resolveThumbnail`, `warm`; the in-flight
sharing, the failure cache with `FAILURE_TTL_MS` on the Clock, the concurrency slot (a `Semaphore` from `effect` or
the existing counter), the lazy `sharp`, the `[thumbs]` warning, silent under test; the generation keeps its
catch-all: ANY failure of sharp, a sync throw included, records the failure time and answers "fall back to the
original", P2); `Uploads` (`storeUploadedImage(formData, field?)` failing with `BadRequest` / `PayloadTooLarge` /
`UnsupportedMediaType` with today's texts, warming the thumbnail with a detached fork that ignores its cause;
`sniffImageType` stays pure); `UploadReferences` (`collectUploadReferences()`, the module `uploadReferences` hooks
through the adapter, P11). Pure exports unchanged: `THUMBNAIL_SUFFIX`, `THUMBNAIL_WIDTH`, `isThumbnailName`,
`originalOfThumbnail`, `thumbnailUrlFor`, `listImageUrlFor`, `filenameOf`. Bridges: `storeUploadedImage`,
`resolveThumbnail` (until E2-T12 moves `/uploads` onto the service), `collectUploadReferences(database)`, and
**`warmThumbnail(filename): void`, which stays `void`, returns before any work, never rejects and never throws**
(recipe's `import/url/image.ts:126` calls it unawaited): under `NODE_ENV=test` it returns at once as today;
otherwise `runtime.runFork(thumbnails.warm(filename).pipe(Effect.ignoreCause))` (with `Thumbnails` yielded inside
the forked effect).

**P11 — The module contract on Effects (E7; SPEC §2).** `apps/api/src/modules/types.ts`:
- `ApiModule` (the target contract): `id`, `householdRouter?`, `userRouter?`, `schema`, `healthFeatures?()` (sync,
  unchanged), `layer?: Layer.Layer<…>` (the module's own services, E3/E4; absent for both today), and the hooks as
  Effects: `onHouseholdCreated?(householdId): Effect<void, HookError, Database>`, `onEnable?(householdId,
  settings): Effect<…>`, `onMemberRemoving?(householdId, userId): Effect<…>`, `afterMigrate?(): Effect<…>`,
  `start?(): Effect<void, unknown>`, `shutdown?(): Effect<void, unknown>`, `seedDemo?(context): Effect<…>`,
  `uploadReferences?(): Effect<string[], HookError, Database>`; `HookError = ApiErrorFamily | DatabaseError`
  (`DatabaseError` is named separately because it is not in the family, P4). The transaction reaches a hook through
  the `Database` current executor (P6), not through a parameter.
- `PromiseApiModule`: today's interface verbatim (hooks with `tx: DbExecutor` / `database` parameters).
  `recipe/index.ts` and `finance/index.ts` change ONE line each, the annotation `: ApiModule` → `:
  PromiseApiModule` (and its import); nothing else in a module directory changes in E2.
- `apps/api/src/modules/adapter.ts` (new): `fromPromiseModule(m: PromiseApiModule): ApiModule` wraps each Promise
  hook: it reads the current executor (`(yield* Database).executor`), calls the hook with it, and maps a rejection: a
  family member (`isApiError`) becomes the typed failure UNCHANGED (same object: `modules.test.ts` (h) asserts
  `toBe(refusal)`), anything else a defect.
- **`runModuleHook<A, E>(effect: Effect<A, E, Database>, executor: DbExecutor): Promise<A>`** (in `adapter.ts`):
  runs a hook effect outside the runtime on a BARE executor: `Effect.runPromise(effect.pipe(Effect.provide(
  Database.layerFromExecutor(executor))))`; a failure rejects with the squashed value (a family refusal is the same
  object). The executor is whatever the caller holds: a root drizzle instance (`runMigrations(database)` passes
  its drizzle `database`, `collectUploadReferences(database)` its argument, `scripts/seed.ts` its `db`) or an open drizzle
  transaction (`initializeHousehold(tx, …)` inside `createHousehold`'s transaction, `enableModule`'s and
  `removeMember`'s `tx`). The Promise hook receives exactly that executor, as today (the adapter reads it back from
  the current executor; for the hooks typed with a root `database: Database` (`afterMigrate`, `uploadReferences`,
  `seedDemo`) the adapter narrows it with a one-line cast, since every call site of those passes a root). It never imports `runtime.ts`, so `db/migrate.ts` keeps `migrate-legacy.ts`'s import-order
  rule (CLAUDE.md "The CLI never imports `src/env.ts`").
- Inside a converted service (E2-T06 `HouseholdModules`, E2-T09 `Households.removeMember`) a hook runs with `yield*
  hook(...).pipe(Effect.provideService(Database, database))` inside `database.transaction(...)`; the current
  executor (a `Context.Reference`) is the open transaction there, so the Promise hook gets the `tx` it gets today.
- `modules/index.ts`: `API_MODULES: readonly ApiModule[] = [fromPromiseModule(recipeModule),
  fromPromiseModule(financeModule)]` (the same module-scope reads as today's array literal, no new TDZ).
- SPEC §2's code block and its "Hooks added after M0" paragraph are updated in the same commit.

**P12 — Routes and middlewares on the runtime (E7, E8 order unchanged).**
- Handler shape: `async (c) => { BODY }` becomes `(c) => runtime.runPromise(Effect.gen(function* () { BODY' }))`
  where `BODY'` yields services at its top (`const households = yield* Households;`) and replaces each `await
  fn(db, args)` by `yield* households.fn(args)`. Hono context operations (`c.req.*`, `c.json`, `json(c, …)`,
  `created`, `noContent`, cookies) are synchronous and stay inside the generator; the handler returns the
  `Response` from it. `requireUser(c)` → `yield* currentUser(c)`, `requireMembership(c)` → `yield*
  currentMembership(c)` (P19); `Promise.all([a, b])` → `yield* Effect.all([a', b'], { concurrency: "unbounded" })`
  where `a'`, `b'` are the service calls WITHOUT `yield*`; `throw ApiError.x(...)` / `throw new ApiError(...)` →
  `return yield* new <Class>(...)` (P4 mapping table in E2-T11's brief).
- **Catch-all stays catch-all in the routes (P2).** The OAuth callback's `try { … } catch (error)` caught every
  throw: an `ApiError` chose the redirect's `error` code, anything else was logged `[auth] OAuth callback failed:`
  and became `oauth_failed`. Its Effect form wraps the flow with `Effect.catchCause((cause) => …)`, `const error =
  Cause.squash(cause)`, `isApiError(error) ? String(error.code) : "oauth_failed"`, the log for every non-family
  value (a defect, a `DatabaseError`, an `Effect.promise` rejection), and the same two redirects; never
  `Effect.catch` / `Effect.catchTags` there, which would let a defect through as `500 internal_error` JSON.
  `sendVerificationLinkQuietly` ("lets nothing escape") likewise ends in `Effect.catchCause` with today's log line.
- Middlewares keep their exported names and signatures (`middleware.test.ts`, `security.test.ts`,
  `static-web.test.ts` call them unchanged). Their service and database work runs as ONE `await
  runtime.runPromise(...)` before `await next()`; `next()` is never called inside an effect. A refusal fails the
  effect with the tagged error, which reaches `onErrorHandler` as before. The mount order of `src/index.ts` and the
  chain `requireSession()` → `requireHouseholdRole("member")` → `requireModule(id)` are untouched (CLAUDE.md
  "Middleware chain order is load-bearing"). `securityHeaders(dir)` and `webAppMiddleware(dir)` stay pure response
  shaping over a directory handed in by `src/index.ts`; `originGuard(origins)` and `localeMiddleware` keep reading
  the resolved config value (`env` is `AppConfig`'s value, P5) because they run on every request before any service
  and their failure path is the only effect (origin refusal through the runtime).
- **Every middleware factory a router calls at module scope is TDZ-safe.** After E2-T12, `middleware/household.ts`,
  `module.ts`, `verifiedEmail.ts` and `originGuard.ts` import `runtime.ts` and services, which puts them on the
  cycle `runtime.ts` → `modules/index.ts` → the recipe and finance routers → these files; the routers call
  `requireHouseholdRole("admin")`, `requireVerifiedEmail()`, `requireModule(id)` at module scope, possibly while the
  middleware file is still evaluating. So every exported middleware factory (`requireSession`, `optionalSession`,
  `requireHouseholdRole`, `requireHouseholdMember`, `requireHouseholdAdmin`, `requireHouseholdOwner`,
  `requireModule`, `requireVerifiedEmail`, `originGuard`) is a hoisted `function` declaration (the three
  `export const requireHousehold… = () => …` arrows of `household.ts` become `export function` declarations,
  same behaviour), and the factory body reads NO imported binding and no module-level `const` / `let` / class
  until request time: it only captures its arguments and returns a hoisted handler (or a closure) that reads
  `runtime`, services, `READ_METHODS`, `RESOURCE_PARAMS` and the like when a request arrives. An `Effect.fn`
  constant used by a middleware is referenced from inside the handler, never from the factory. `requireHandler` and
  `optionalHandler` in `session.ts` stay hoisted `async function` declarations. `lib/errors.ts`, `lib/types.ts`
  and `lib/validate.ts` import neither `runtime.ts` nor a service (they stay off the cycle; `validate(…)` is called
  at module scope by every router).

**P13 — Test support (E9).** `apps/api/test/support/effect.ts` (new, E2-T03): `runTest(effect, options?)` and
`runTestExit(effect, options?)` run on the APP `runtime` (the one the routes use, never disposed in a test, its
`Database` on the shared temp file DB of ADR 0009); `options.clock: "test"` provides `TestClock.layer()` around
the effect (`import { TestClock } from "effect/testing"`); `itEffect(name, effect | () => effect, timeoutMs?)`
wraps `bun:test`'s `test`. E2-T04 adds `recordingMailer()` (a `Mailer` transport that records `MailMessage`s,
optionally failing) and `withMailer(mailer, effect)` (installs it through the `setMailer` seam for the run, P8).
`AppServices` = the context type the runtime provides. No test disposes `runtime`; no test builds its own
`AppLayer` runtime except `runtime.test.ts` (d), which is safe because `Database.layer` never closes under
`NODE_ENV=test` (P6).

**P14 — Tests (E9).** A core test that calls a converted service directly is rewritten onto the service in the
SAME task as the conversion, in the SAME file, keeping every assertion (status, code, rows, mails). A task with a
large test rewrite (E2-T06, E2-T07, E2-T08) commits the service conversion with its bridges first (old tests
still green through the bridges) and the test rewrite as a SECOND commit of the same task (`E2-T0N: … (tests onto
the services)`); both commits are green on their own. `expect(error).toBeInstanceOf(ApiError)` may stay as written
(P4 `Symbol.hasInstance`); a rejected promise becomes `const error = await runTest(Effect.flip(effect))`. The pinned
files of the exit criteria are NEVER edited: `db-pragmas.test.ts`, `middleware.test.ts`, `import-order.test.ts`,
`placeholders.test.ts`, `security.test.ts`, and in `auth.test.ts` the rate-limit `describe` block (the rest of
`auth.test.ts` is rewritten). Through-the-app tests (`app.request`) and every recipe, finance and legacy test stay
untouched. The pass count never drops (`pass >= 14508` from E2-T01 on).

**P15 — The idioms gate (E12).** E2-T13 turns the `PENDING_RULES` line for E2 in
`apps/api/test/effect-idioms.test.ts` into two `describe`s (the E7 line stays pending):
- `(10) no throw of ApiError (E6, E12)`: the regex `\bthrow\s+(?:new\s+)?ApiError\b` over the non-comment lines
  of `apps/api/src/**`, with a pinned PREFIX allow list `{ "apps/api/src/modules/recipe/": "E3 moves recipe onto
  the tagged family", "apps/api/src/modules/finance/": "E4 moves finance onto the tagged family" }`.
- `(11) no Date.now() / new Date( in services (E7, E12)`: the regexes `\bDate\.now\s*\(` and `\bnew\s+Date\s*\(`
  over `apps/api/src/**/services/**`, allow list `{ "apps/api/src/core/services/households/support.ts": "nowMs(),
  the module helper recipe and finance call until E3/E4", "apps/api/src/modules/recipe/services/": "E3",
  "apps/api/src/modules/finance/services/": "E4" }` (prefix match); plus the regex `\bnowMs\s*\(` over
  `apps/api/src/core/**` with the one allowed file `apps/api/src/core/services/households/support.ts` (its
  definition): a core call of the module helper bypasses the `Clock` (P7).
Each rule gets a self-test line like the existing rules if the file has them; a listed entry that no longer
matches fails (the shape of the design-system test's pinned records).

**P16 — The stale ADR 0013 guard (E9 floor).** `apps/api/test/validation-wire.test.ts`'s last `describe` becomes
"the wire change is accepted (ADR 0013)": it asserts that ADR 0013 carries `Status: accepted by the owner on
2026-10-16` and that `docs/open-work.md` has no `| D-7 |` row. One test, same count.

**P17 — ADR 0014 (E5, E7 transitional).** `docs/adr/0014-transitional-core-bridges.md` (E2-T03): the process-wide
database instance stays created at import of `db/client.ts` while modules and scripts import `db` (E3 to E5), and
`Database.layer` owns its lifetime (acquire awaits the pragmas, release closes, never under test); the P1 bridges
(their calling conventions kept, the sync ones included) and their removal milestones; `PromiseApiModule`,
`fromPromiseModule` and `runModuleHook` until E3/E4 (P11); the `setMailer` / `setVerifiedEmailRequired` /
`resetRateLimits` seams as the tests' doors into the live services. It edits `docs/EFFECT.md` E5 and E7 with one
sentence each pointing at it, in the same commit. CLAUDE.md's ADR list is updated by E2-T13.

**P18 — Boot and shutdown (E7).** `src/index.ts` (E2-T12): before serving, `await runtime.runPromise(
Effect.void)` builds the whole `AppLayer` (config, database acquire with the pragmas, mailer, the rest), so a
database that cannot be opened fails at boot as `await dbReady` did; then each module's `start()` effect through
the runtime (a failure logged `[api] start of module <id> failed:` as today). SIGTERM/SIGINT: `[api] <signal> —
stopping modules …`, each module's `shutdown()` effect (a failure logged as today), `await runtime.dispose()`
(which runs `Database.layer`'s release: `[db] database closed`), `[api] runtime disposed`, `process.exit(0)`;
the failed-dispose line stays.

**P19 — Effect request helpers (E7, E12).** `apps/api/src/lib/types.ts` gains `currentUser(c): Effect<User,
Unauthorized>` and `currentMembership(c): Effect<Membership, Forbidden>` (same texts as today); `requireUser` and
`requireMembership` become sync bridges (`Effect.runSync`, explicit return types) for the modules.
`apps/api/src/lib/validate.ts` gains `decode(schema, input): Effect<Decoded<S>, Schema.SchemaError>`
(`Schema.decodeUnknownEffect(schema)(input, ALL_ISSUES)`); `validate`, `decodeOrThrow`, `decodeOption` stay
(`validate.test.ts` unchanged).

**P20 — Verification snippets (E3 "pass count").** Every task after E2-T01 verifies the full suite with:
`cd /home/erics/software/toon-household && L=$(mktemp) && bun test > "$L" 2>&1; S=$?; tail -6 "$L"; [ $S -eq 0 ]
&& grep -oE '^ *[0-9]+ pass' "$L" | awk '{exit !($1 >= 14508)}'`. E2-T02 (parallel to E2-T01, on a branch that
still has the stale guard) uses the tolerant form in its own verify list. A failing gate keeps its `(fail)` lines
and any `Unhandled error` block in the log (CLAUDE.md "A test that runs sharp carries an explicit time budget").

**P21 — A second fresh-process import test (CLAUDE.md "API import cycle").** `apps/api/test/import-order.test.ts`
is pinned unchanged, so the files E2 pulls into the cycle get their own guard: `apps/api/test/import-order-effect.test.ts`
(new, E2-T03; same shape: one `Bun.spawn(["bun", "-e", …])` per entry, `NODE_ENV=test`, exit 0 and no `ReferenceError`
in stderr). Each child imports the entry FIRST, then `./src/runtime.ts`, then runs `await runtime.runPromise(
Effect.void)` (the whole `AppLayer` builds after that import order; under `NODE_ENV=test` it uses its own temp DB
and its release does not close, P6). E2-T03 lists `./src/config.ts`, `./src/db/database.ts`, `./src/infra.ts`,
`./src/core/services/layer.ts`, `./src/runtime.ts`; E2-T05 adds `./src/modules/adapter.ts`; E2-T12 adds
`./src/middleware/household.ts`, `./src/middleware/module.ts`, `./src/middleware/verifiedEmail.ts`,
`./src/middleware/originGuard.ts`, `./src/core/routes/auth.ts`, `./src/core/routes/households.ts`,
`./src/core/services/households/households.service.ts`, `./src/core/services/auth/sessions.ts`,
`./src/modules/finance/index.ts`, `./src/modules/recipe/index.ts`.

## 3. Waves and file ownership

| Wave | Tasks (parallel inside a wave) |
| --- | --- |
| 1 | E2-T01 errors, E2-T02 AppConfig |
| 2 | E2-T03 Database, runtime composition, test support, ADR 0014 |
| 3 | E2-T04 infra services, E2-T05 module contract |
| 4 | E2-T06 `HouseholdModules`, `Passwords`, `Users` |
| 5 | E2-T07 `Sessions`, `AuthInvites`, `spendableToken` |
| 6 | E2-T08 auth flows, E2-T09 households domain |
| 7 | E2-T10 auth routes, E2-T11 household routes, E2-T12 middlewares and boot |
| 8 | E2-T13 integration, idioms rules, docs, record |

Shared files and their owners (always in different waves): `apps/api/src/runtime.ts` T03 then T05;
`apps/api/src/infra.ts` T03 then T04; `apps/api/src/core/services/layer.ts` T03, T05, T06, T07;
`apps/api/src/core/services/auth/layer.ts` T03 then T08; `apps/api/src/core/services/households/layer.ts` T03 then
T09; `apps/api/src/db/database.ts` T03 only; `apps/api/test/support/effect.ts` T03 then T04;
`apps/api/test/import-order-effect.test.ts` T03, T05, T12; `apps/api/src/index.ts` T05 then T12;
`apps/api/test/auth.test.ts` T06, T07, T08 (never its rate-limit block); `apps/api/test/placeholders-core.test.ts` T06
then T09; `apps/api/test/modules.test.ts` T05 then T06; `core/services/auth/tokens.ts` T07 then T08;
`core/services/households/modules.ts` T05 (hook call sites only) then T06; `households.service.ts` T05 (the
`removeMember` hook call only) then T09; `apps/api/src/lib/errors.ts` T01 only; `apps/api/test/effect-idioms.test.ts`,
`CLAUDE.md` T13 only; `docs/SPEC.md` T05; `docs/EFFECT.md` T03 (and T13 for the status line if needed). No two tasks
of one wave share a file (each task's `files`).

## 4. Tasks

Every task: read `repos/effect/LLMS.md` whole once (CLAUDE.md "Vendored reference code"), then the pattern files
and sources it names; look every Effect signature up under `repos/effect/packages/effect/src/`, never from memory
(v3 → v4: `repos/effect/migration/v3-to-v4.md`). Never edit `repos/`. Commit per task, message `E2-TNN: <title>`,
body naming the EFFECT.md decisions and the plan decisions served, ending with the `Co-Authored-By` line the
workflow gives (a task with a large test rewrite commits twice, P14). Verify lists are in the structured plan and
in each section below.

### E2-T01 — The error family, the boundary mapper and the request helpers (core)

Read: `docs/EFFECT.md` E6, E12; `agent-patterns/effect-errors.md` (whole), `agent-patterns/effect-core.md` §2,
§4; `repos/effect/LLMS.md` "Error handling", "Runtime type guards"; `repos/effect/ai-docs/src/01_effect/04_errors/`
(all three files); `repos/effect/migration/error-handling.md`; the source of `Schema.TaggedError`
(`repos/effect/packages/effect/src/Schema.ts` ~16278, and `Schema.Error` just above it), the constructor option
`disableChecks` (~126, ~16054), `Schema.withConstructorDefault` (~5930), `Schema.declare` (~579), `Schema.optional`
(~2460), `Schema.Defect` (~9343), `Predicate.isTagged` (`src/Predicate.ts`), `Effect.runSync` (`src/Effect.ts`
~9440). Repo: `apps/api/src/lib/errors.ts`, `apps/api/src/lib/types.ts`, `apps/api/src/lib/validate.ts`,
`apps/api/src/lib/locale.ts`, `packages/shared/src/core/i18n/` (`serverText`, `ServerKey`, `MessageValues`,
`toValidationIssues`, `ALL_ISSUES`), `docs/API.md` "Conventions" and "Error codes", `apps/api/test/smoke.test.ts`,
`apps/api/test/validate.test.ts`, `apps/api/test/validation-wire.test.ts`,
`docs/adr/0013-validation-details-from-the-schema-adapter.md` (Status line), `docs/open-work.md`; for the shapes
module code passes: `grep -rn "new ApiError(" apps/api/src/modules` and `grep -rn "validationFailed(" apps/api/src`.
CLAUDE.md "Validation details come from the wire-issue vocabulary". Decisions P4, P16, P19.

Build: the family with permissive field schemas, `DatabaseError` OUTSIDE the family, `ApiErrorFamily`,
`isApiError`, the legacy `ApiError` with `disableChecks` (P4), `toApiError`, `errorBody`, `onErrorHandler`,
`notFoundHandler`; `currentUser`, `currentMembership` and the two sync bridges with explicit return types (P19,
P1); `decode` in `validate.ts`; the P16 guard. `lib/errors.ts`, `lib/types.ts` and `lib/validate.ts` import neither
`runtime.ts` nor a service (P12). New `apps/api/test/errors.test.ts`:
- for every class and every static helper, de and en bodies pinned as literals equal to what
  `ApiError.x(...).toBody(locale)` returned at `6991769c9` (compute them first from the old code and paste them);
- the constructor shapes today's code passes never throw and render as before: `ApiError.validationFailed(undefined)`
  → 422 `validation_failed` without `details`; `new ApiError(409, "member_has_ledger", <a finance text>, {
  nested: { list: [1, "a"] } })` → 409 with those `details`; `new ApiError(429, "rate_limited", { key:
  "server.error.tooManyAttempts", values: { seconds: 7 } })`; `new ValidationFailed({ details: undefined })`;
- `new ApiError(429, …)` and every tagged family class are `instanceof ApiError`; `new DatabaseError({ cause })`
  is NOT `instanceof ApiError` and `isApiError` is false for it, for `new Error()` and for a string;
- `toApiError` on a `SchemaError`, an `HTTPException(403)`, a `DatabaseError` (→ `Internal`), the string
  `"ManagedRuntime disposed"`;
- `onErrorHandler` through a tiny Hono app: a `RateLimited` sets `Retry-After`, a defect answers `500
  internal_error`, a `DatabaseError` answers `500 internal_error` and logs its `cause`, `Effect.runPromise(
  Effect.fail(new NotFound()))`'s rejection renders 404.
`smoke.test.ts` stays unchanged and green. Do NOT touch any `throw` site outside the three lib files (the services,
routes and middlewares are later tasks); a thrown legacy `ApiError` must render exactly as before. Update
`agent-patterns/effect-errors.md` §7 "As built (E2)".

Acceptance: the family and mapper exist as P4; `bun test apps/api/test/errors.test.ts
apps/api/test/smoke.test.ts apps/api/test/validate.test.ts apps/api/test/validation-wire.test.ts
apps/api/test/middleware.test.ts` green; full suite 0 fail, ≥ 14508 pass; typecheck green.

### E2-T02 — `AppConfig` from the environment (core)

Read: `docs/EFFECT.md` E7, E10; `agent-patterns/effect-config.md` (whole), `agent-patterns/effect-services.md`
§2.1, §2.4; `repos/effect/packages/effect/CONFIG.md` (whole, in chunks); the source of `Config.schema`,
`Config.mapEffect`, `Config.all`, `Config.option` (`src/Config.ts` ~850), `ConfigProvider.fromEnv` (~945),
`fromUnknown` (~797), `ConfigProvider.layer` (~682); `repos/effect/ai-docs/src/01_effect/03_services/20_layer-unwrap.ts`.
Repo: `apps/api/src/env.ts` (whole), `apps/api/test/env-parse.test.ts` (whole: it is the oracle), `.env.example`,
`docs/adr/0009-test-suite-on-a-temp-file-db.md`, `apps/api/scripts/migrate-legacy.ts` (`resolveCliEnv`, why the
CLI never imports `env.ts`). CLAUDE.md "The CLI never imports `src/env.ts`", "Subprocess tests of the CLI set
`NODE_ENV=development`", "Core hardening from `1715207`" (the `change-me` refusal). Decision P5.

Build `apps/api/src/config.ts` and rewrite `apps/api/src/env.ts` as its re-export (P5). The schema text and every
message move verbatim. New `apps/api/test/config.test.ts`: `AppConfig.layer` provides the same object as `env`
(identity); a second resolution returns the same object (one temp DB per process); `AppConfig.layerFrom` with
`BASE`-like explicit values decodes the derived fields (`webOrigins` split and trimmed, `databaseKind`,
`mailPort` defaulting from `MAIL_SECURITY`, `pdfImportEnabled` following the OCR flag); `layerFrom` with bad
values fails with a `ConfigError` whose formatted lines equal `parseEnv`'s for the same map (all issues, the
`(env)` cross-field lines); a subprocess (`bun -e`, `NODE_ENV=production`, `SESSION_SECRET=change-me-…`,
`DATABASE_URL=file:<tmp>`) exits 1 and prints the `.env.example placeholder` line. `env-parse.test.ts` stays
unchanged and green. Update `agent-patterns/effect-config.md` §7 "As built (E2)".

Acceptance: `env-parse.test.ts`, `config.test.ts`, `import-order.test.ts`, `legacy-cli.test.ts` green; full suite
has no failure other than the stale ADR 0013 guard (fixed by E2-T01 in the same wave); typecheck green.

### E2-T03 — `Database`, the runtime composition and the test support (core)

Read: `docs/EFFECT.md` E5, E7, E9; `agent-patterns/effect-services.md` (whole), `agent-patterns/effect-testing.md`
(whole), `agent-patterns/effect-core.md` §3; `repos/effect/LLMS.md` "Managing resources and `Scope`s", "Writing
Effect services", "Integrating Effect into existing applications", "Testing Effect programs";
`repos/effect/ai-docs/src/01_effect/05_resources/` (all), `repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts`,
`repos/effect/ai-docs/src/09_testing/` (both); the source of `Layer.suspend` (~1165), `Layer.effect`,
`Layer.provideMerge` (~1582), `Layer.mergeAll` (~1275) (`src/Layer.ts`), `Effect.acquireRelease`,
`Effect.runPromiseExitWith`, `Effect.context`, `Effect.provideService` (`src/Effect.ts`), `Context.Reference`
(`src/Context.ts` ~1366), `ManagedRuntime.Context` (`src/ManagedRuntime.ts`), `TestClock.layer`
(`src/testing/TestClock.ts` ~553). Repo: `apps/api/src/db/client.ts`,
`apps/api/src/core/services/households/support.ts` (`withTransaction`, `transactionsSupported`),
`apps/api/src/modules/types.ts` (`DbExecutor`), `apps/api/src/runtime.ts`, `apps/api/src/core/health.ts`,
`apps/api/test/runtime.test.ts`, `apps/api/test/db-pragmas.test.ts`, `apps/api/test/import-order.test.ts` (the shape
of P21), `apps/api/test/finance-file-db.test.ts` (the rollback proof on the shared client),
`docs/adr/0012-effect-application-framework.md` (ADR shape). CLAUDE.md "One runtime, disposed on shutdown (E0)",
"D7 pragmas", "API import cycle", "Retired gotchas" (`file::memory:` is per client). Decisions P3, P6, P13, P17,
P21.

Build: `apps/api/src/db/database.ts` (P6: the service, `withExecutor`, the root/open-transaction flag,
`transaction`, and the four layers `layer`, `layerFrom`, `layerFromExecutor`, `layerFromUrl`), the small additions
to `db/client.ts` (`DrizzleDatabase` alias, `url` on `CreatedDatabase`; nothing else), `apps/api/src/infra.ts`
(`Database.layer.pipe(Layer.provideMerge(AppConfig.layer))`), `apps/api/src/core/services/layer.ts`,
`apps/api/src/core/services/auth/layer.ts`, `apps/api/src/core/services/households/layer.ts` (stubs, P3),
`apps/api/src/runtime.ts` (P3 with the `never`-requirement annotation of `AppLayer`; `moduleLayers()` is E2-T05's),
`apps/api/test/support/effect.ts` (P13 without the mailer helpers), `apps/api/test/import-order-effect.test.ts` (P21
with E2-T03's five entries), ADR 0014 plus the two EFFECT.md sentences (P17). New `apps/api/test/database.test.ts`:
`use` on the root; `transaction` commits; a typed failure inside rolls back and surfaces the SAME error object; a
defect rolls back; a `use` inside `transaction` sees the uncommitted row; nested `transaction` runs inline;
`withExecutor(other)` runs `use` and `transaction` on the other instance; `layerFromExecutor(tx)` inside a drizzle
transaction opened by the test: `executor` is that `tx`, a write through it is rolled back with the outer
transaction, and a `transaction` inside opens a savepoint (an inner failure rolls back only the inner write);
`layerFromExecutor(db)` reports `transactionsSupported` equal to `support.ts`'s value; `layerFromUrl("file::memory:")`
reports `transactionsSupported: false` and runs sequentially; `layerFromUrl(<temp file>)` applies `journal_mode =
wal` and closes its client when the scope ends; `Database.layer` under the test env does not close the shared
client (run it in a throwaway `ManagedRuntime`, dispose, then query the shared `client`). `runtime.test.ts`: keep
every assertion; (d) keeps building `ManagedRuntime.make(AppLayer)` and now also proves the shared client survives
its dispose. `db-pragmas.test.ts` unchanged and green. Update `agent-patterns/effect-services.md` §7 and
`agent-patterns/effect-testing.md` §7 "As built (E2)".

Acceptance: `bun test apps/api/test/database.test.ts apps/api/test/runtime.test.ts apps/api/test/db-pragmas.test.ts
apps/api/test/import-order.test.ts apps/api/test/import-order-effect.test.ts apps/api/test/finance-file-db.test.ts`
green; full suite ≥ 14508, 0 fail; typecheck green; idioms test green (`ManagedRuntime.make(` only in `runtime.ts`
among non-test sources).

### E2-T04 — `Mailer`, `RateLimiter`, `VerifiedEmail`, `Uploads` and `Thumbnails` (build)

Read: `docs/EFFECT.md` E7, E12; `agent-patterns/effect-services.md` §2.3, §2.4, §3; `agent-patterns/effect-datetime-clock.md`
(whole); `agent-patterns/effect-testing.md` §2.2, §6; `agent-patterns/effect-stream.md` §1 and §6 only if a
stream helps the upload write (it is not required); `repos/effect/ai-docs/src/01_effect/03_services/20_layer-unwrap.ts`,
`repos/effect/ai-docs/src/07_datetime/`; the source of `Clock.currentTimeMillis`, `DateTime.now`,
`DateTime.nowAsDate` (~882), `DateTime.nowUnsafe` (~909), `DateTime.toDateUtc` (~1572), `Semaphore.make` /
`Semaphore.withPermits` (`src/Semaphore.ts`), `Layer.unwrap`, `Layer.mergeAll`, `Layer.provideMerge`,
`Effect.runSync`, `Effect.tapError`, `Effect.catchCause` (~3333), `Effect.ignoreCause` (~4392), `Effect.forkDetach`
(~8917), `Effect.tryPromise` (~990), `ManagedRuntime.runFork`. Repo: every file under
`apps/api/src/core/services/mail/`, `apps/api/src/core/services/auth/rateLimit.ts`,
`apps/api/src/core/services/auth/verifiedEmail.ts`, `apps/api/src/core/services/media/uploads.ts`,
`apps/api/src/core/services/media/thumbnails.ts`, `apps/api/src/infra.ts`, `apps/api/test/support/effect.ts`,
`apps/api/test/mail.test.ts`, `apps/api/test/mail/smtp.test.ts`, `apps/api/test/uploads.test.ts`,
`apps/api/test/thumbnails.test.ts`, `apps/api/test/auth.test.ts` (the rate-limit block: read only),
`apps/api/test/verified-email-gate.test.ts` (read only), the unawaited callers `apps/api/src/modules/recipe/routes/imports.ts`
(lines 109, 161, 206) and `apps/api/src/modules/recipe/services/import/url/image.ts` (line 126) (read only),
`docs/modules/recipe.md` R33, R79. CLAUDE.md "Core hardening from `1715207`", "Uploads are signed, not
cookie-checked", "A test that runs `sharp` carries an explicit time budget". Decisions P1, P2, P3, P7, P8, P9, P10,
P13.

Build the five services with their layers; `infraLayer()` in the final nesting of P3 (`RateLimiter`,
`VerifiedEmail`, `Uploads` over `Mailer` + `Thumbnails` over `Database` over `AppConfig`). Keep the bridges of
P8–P10 with their calling conventions: `checkRateLimit`, `enforceRateLimit` (with the new optional `enabled`) and
`resetRateLimits` SYNCHRONOUS, `warmThumbnail` `void` and never rejecting, `isVerifiedEmailRequired`, `getMailer`,
`isMailConfigured` sync, each with the explicit return type of the old signature (P1). `trySendMail` and the
thumbnail generation keep catch-all semantics (P2). `SmtpMailer.send(message, now?)` and the required `now` of
`buildMessage` (P8). Add `recordingMailer()` and `withMailer()` to the test support. Tests: rewrite the direct calls
of `mail.test.ts`, `mail/smtp.test.ts` (only where a converted function is called; the transport classes stay),
`uploads.test.ts` (`storeUploadedImage` direct cases onto `Uploads`) and `thumbnails.test.ts` (direct calls onto
`Thumbnails`, keep `SHARP_TEST_TIMEOUT_MS`) onto the services, same assertions; add to `mail.test.ts` one case where
a transport's `send` throws SYNCHRONOUSLY and `trySendMail` still returns the failed result and logs the `[mail]`
line. New `apps/api/test/rate-limiter.test.ts`:
- with `runTest(…, { clock: "test" })` the 11th `LOGIN_RULE` check in one window is refused with
  `retryAfterSeconds` 60, `TestClock.adjust("61 seconds")` lets it through again; `HOUSEHOLD_CREATE_RULE` allows 5
  then refuses within the hour; `INVITE_RULE` 10 per hour;
- `RateLimiter.layer` built over `AppConfig.layerFrom({ NODE_ENV: "production", … })` (a non-test config, its own
  `Effect.provide`, never the app runtime): `enforce("Login", "A@B.C", { limit: 1, windowMs: 60_000 })` returns
  `"login:a@b.c"`-style lower-cased key on the first call and fails with `RateLimited` (`retryAfterSeconds` > 0) on
  the second; with `AppConfig.layer` (the test env) `enforce` returns the key and records nothing;
- the bridge is synchronous and throws: in a tiny Hono app with `onErrorHandler`, a route that calls
  `const key: string = enforceRateLimit(c, "t", id, { limit: 1, windowMs: 60_000 }, true)` (a typed assignment, so a
  Promise would fail `tsc`) answers 200 then `429 rate_limited` with a `Retry-After` header equal to the
  `retryAfterSeconds` in the body's text; a direct call outside Hono (a minimal context stub) `toThrow`s a value
  that `isApiError` accepts with `code` `rate_limited`;
- `reset(key)` and the bridge `resetRateLimits(key)` act on the same store;
- `warmThumbnail("missing.png")` returns `undefined` synchronously (not a thenable) and no unhandled rejection
  follows (under the test env it is a no-op; assert the return value only).
Update `agent-patterns/effect-datetime-clock.md` §7 "As built (E2)". Do not touch `references.ts`, `src/index.ts`
or any route.

Acceptance: those tests plus the pinned `auth.test.ts` rate-limit block, `verified-email-gate.test.ts`,
`core-walkthrough.test.ts`, `households.test.ts`, `placeholders.test.ts`, `recipe-remote-image.test.ts` green
unchanged; no `Date.now()` / `new Date(` left in the five service files and `smtp.ts`; full suite ≥ 14508;
`import-order-effect.test.ts` green; typecheck green.

### E2-T05 — The module contract on Effects and `UploadReferences` (core)

Read: `docs/EFFECT.md` E7; `docs/SPEC.md` §2 (whole); `agent-patterns/effect-services.md` §2.2, §6;
`agent-patterns/effect-errors.md` §2 (`tryPromise`), §4; `repos/effect/LLMS.md` "Integrating Effect into existing
applications"; the source of `Effect.tryPromise`, `Effect.catch`, `Effect.die`, `Effect.runPromise`,
`Effect.provide`. Repo: `apps/api/src/modules/types.ts`, `apps/api/src/modules/index.ts`, `apps/api/src/modules/mount.ts`,
`apps/api/src/modules/recipe/index.ts`, `apps/api/src/modules/finance/index.ts`,
`apps/api/src/modules/finance/setup.ts` (the Promise hooks; read only), `apps/api/src/db/migrate.ts`,
`apps/api/src/db/database.ts` (`layerFromExecutor`), `apps/api/src/core/services/media/references.ts`,
`apps/api/src/core/services/households/modules.ts`, `apps/api/src/core/services/households/households.service.ts`
(`removeMember`), `apps/api/src/index.ts`, `apps/api/scripts/seed.ts`, `apps/api/scripts/uploads-gc.ts`,
`apps/api/scripts/migrate-legacy.ts` (its import order), `apps/api/src/runtime.ts`, `apps/api/src/core/services/layer.ts`,
`apps/api/test/modules.test.ts`, `apps/api/test/recipe-module.test.ts`, `apps/api/test/finance-seed.test.ts`,
`apps/api/test/legacy-cli.test.ts`, `apps/api/test/import-order-effect.test.ts`. CLAUDE.md "A `household_modules`
row is the enabled state", "API import cycle", "The CLI never imports `src/env.ts`, and its import order is
load-bearing". `docs/modules/finance.md` "Enabling finance needs two participants (D3)", "A seated participant cannot
leave while the ledger has rows.". Decisions P1, P3, P6, P11.

Build P11: the contract, `PromiseApiModule`, `modules/adapter.ts` (`fromPromiseModule` and `runModuleHook(effect,
executor: DbExecutor)` over `Database.layerFromExecutor`), the registry, the two one-line manifest annotations,
`moduleLayers()` in `runtime.ts`, `baseServicesLayer()` = `UploadReferences.layer` (P3), and every hook call site
moved onto the Effect hooks: `db/migrate.ts` (`runMigrations(database)` stays Promise and runs each `afterMigrate`
through `runModuleHook(hook, database)` (its argument is the drizzle instance); no `runtime.ts` import), `references.ts` becomes the `UploadReferences`
service with the bridge `collectUploadReferences(database)` (via `runModuleHook`), `households/modules.ts`
(`initializeHousehold(db, …)` runs `onHouseholdCreated` with `runModuleHook(hook, db)`, `enableModule` runs `onEnable`
with `runModuleHook(hook, tx)` on the `tx` its `withTransaction` opened, still BEFORE the upsert; until E2-T06
rewrites the file), `households.service.ts` `removeMember` (`onMemberRemoving` with `runModuleHook(hook, tx)`, the
veto loop otherwise unchanged; until E2-T09), `src/index.ts` (`start` / `shutdown` through `runtime.runPromise`, same
log lines), `scripts/seed.ts` (`seedDemo` through `runModuleHook(hook, db)`). `modules.test.ts`: the fake modules
become `PromiseApiModule` passed as `[fromPromiseModule(fake)]`; every assertion stays (`rejects.toBe(refusal)`
included). Add `./src/modules/adapter.ts` to `import-order-effect.test.ts` (P21). New
`apps/api/test/module-adapter.test.ts`: a Promise hook receives the current transaction inside
`Database.transaction` and the root outside; `runModuleHook(hook, tx)` inside a drizzle transaction hands the hook
that very `tx` (identity); a rejected `ApiError` arrives as the same object in the error channel and as the same
object from `runModuleHook`'s rejection; a rejected plain `Error` is a defect (`Cause.hasDies`); `afterMigrate`
through `runMigrations(createDatabase(...).db)` runs on that database; `API_MODULES` ids are `["recipe", "finance"]`
and `healthFeatures` is the manifests'. SPEC §2 updated (P11).

Acceptance: `modules.test.ts`, `module-adapter.test.ts`, `recipe-module.test.ts`, `finance-seed.test.ts`,
`finance-module.test.ts`, `finance-participants.test.ts`, `legacy-cli.test.ts`, `import-order.test.ts`,
`import-order-effect.test.ts` green; `git diff --stat` shows exactly one changed line pair (annotation and import)
in each manifest and no other file under `apps/api/src/modules/recipe/` or `apps/api/src/modules/finance/`; full
suite ≥ 14508; typecheck green.

### E2-T06 — Base domain services, part 1: `HouseholdModules`, `Passwords`, `Users` (core)

Read: `docs/EFFECT.md` E6, E7, E12; `agent-patterns/effect-services.md` (whole), `agent-patterns/effect-errors.md`
§3, §4, `agent-patterns/effect-datetime-clock.md` §2.1, §6; `repos/effect/LLMS.md` "Using Effect.fn and
Effect.fnUntraced", "Context.Service", "Error handling basics"; `repos/effect/ai-docs/src/01_effect/01_basics/02_effect-fn.ts`,
`repos/effect/ai-docs/src/01_effect/03_services/` (all); the source of `Effect.tryPromise` (~990),
`Effect.catchCause` (~3333), `Effect.runSync`. Repo: `apps/api/src/core/services/households/modules.ts`,
`apps/api/src/core/services/auth/{users,passwords,index}.ts`, their callers (`grep -rn` the old names under
`apps/api/src`, `apps/api/scripts`, `apps/api/test`), `apps/api/src/db/database.ts`, `apps/api/src/modules/adapter.ts`,
`apps/api/src/core/services/layer.ts`, `apps/api/test/support/effect.ts`, the tests
`apps/api/test/{modules,auth,households,placeholders-core,placeholders,middleware}.test.ts`. CLAUDE.md
"Placeholders and claim invites" (ONE conditional `UPDATE … RETURNING`, zero rows `409 member_has_account`, a
unique violation `409 email_taken`, never check-then-write), "A `household_modules` row is the enabled state"
(`onEnable` BEFORE the upsert; a refusal writes nothing even without transactions), "Core hardening from
`1715207`" (passwords capped at 200 before argon2). Decisions P1, P2, P3, P6, P7, P11, P14.

Build the three services with the bridges every remaining caller needs (P1: at least `claimPlaceholderUser`,
`findUserByEmail`, `findUserById`, `createUser`, `createPlaceholderUser`, `createOwnedHousehold`,
`setActiveHousehold`, `updateUser`, `hashPassword`, `verifyPassword`, `fakeVerifyPassword`, `enabledModulesFor`,
`initializeHousehold`, `enableModule`, `disableModule`, all `Promise` as today; `toUserDto` and
`requireAccountEmail` become `userDto` / `accountEmail` Effects plus SYNC bridges under the old names with their
old return types; the pure `isPlaceholderUser`, `isUniqueViolation`, `displayNameFromEmail`, `DEFAULT_HOUSEHOLD_NAME`
stay plain). `HouseholdModules` runs the module hooks with `yield*` inside `database.transaction` (P11: the hook
effect gets `Effect.provideService(Database, database)`, the open transaction reaches it as the current executor),
keeps `modules = API_MODULES` as a default parameter read inside the method, keeps the order hook-then-upsert, and
reads `enabledAt` from `Clock.currentTimeMillis` instead of `nowMs()` (P7). `verifyPassword` keeps catch-all: a
malformed hash, a sync throw of argon2 included, is `false`, never a failure (P2). `baseServicesLayer()` in the
E2-T06 form of P3 (`Users` over `HouseholdModules` + `Passwords` + `UploadReferences`).

Two commits (P14). Commit 1, the services and bridges: every existing test green through the bridges. Commit 2,
the tests onto the services (same assertions): `modules.test.ts` (enable/initialize), the users and passwords parts
of `auth.test.ts` (NOT the rate-limit block, NOT its sessions, invites or OAuth parts), `households.test.ts`
(`createOwnedHousehold`), `placeholders-core.test.ts` (`toUserDto`, `requireAccountEmail`; its `listMembers` /
`previewInvite` / `toHouseholdInvite` parts are E2-T09's).

Acceptance: the pinned `placeholders.test.ts` (two-claim race through the bridge) and `middleware.test.ts` green
unchanged; the rewritten tests green with unchanged assertions; `auth.test.ts` "verifyPassword" on `"not-a-hash"`
still `false`; no `Date.now()` / `new Date(` / `nowMs(` and no `throw` of `ApiError` left in the three service files;
full suite ≥ 14508; `import-order.test.ts` and `import-order-effect.test.ts` green; typecheck green.

### E2-T07 — Base domain services, part 2: `Sessions`, `AuthInvites`, `spendableToken` (core)

Read: as E2-T06, plus `agent-patterns/effect-testing.md` §2.2 (`TestClock`), the source of `Effect.forkDetach`
(~8917) and `Effect.ignoreCause` (~4392). Repo: `apps/api/src/core/services/auth/{sessions,invites,tokens,index}.ts`,
`apps/api/src/lib/cookies.ts` (`SESSION_TTL_MS`), the services of E2-T06, `apps/api/src/core/services/layer.ts`,
`apps/api/test/support/effect.ts`, the tests `apps/api/test/{auth,middleware,placeholders}.test.ts`, the callers of
`assertSpendableToken` (`emailVerification.ts:105`, `passwordReset.ts:95`: read only, E2-T08's). CLAUDE.md
"Placeholders and claim invites" (a claim invite is redeemed ONLY by register; a spent claim token is `404
invite_invalid`). Decisions P1, P2, P3, P6, P7, P14.

Build `Sessions` and `AuthInvites` with the bridges (P1: at least `createSession`, `resolveSession`,
`deleteSession`, `deleteOtherSessions`, `listSessionsForUser`, `findSessionByHandle`, `findInviteByToken`,
`loadRedeemableInvite`, `acceptInvite`, `claimInvite`, all `Promise`; the pure `generateSessionId`,
`sessionHandle`, `generateInviteToken`, `INVITE_TTL_MS` stay plain). `sweepExpiredSessions` keeps catch-all and stays
fire-and-forget inside `resolveSession` (a detached fork whose cause is ignored, P2), with its once-per-interval
throttle on the Clock. In `tokens.ts` add `spendableToken(row, invalid)`: an `Effect.fnUntraced` with the logic of
`assertSpendableToken`, reading `Clock.currentTimeMillis`, failing with the given refusal; **leave
`assertSpendableToken` and its `now = Date.now()` default exactly as they are** (its two callers belong to E2-T08,
which moves them and deletes it; do not edit `emailVerification.ts` or `passwordReset.ts` here).
`baseServicesLayer()` in its final P3 form (`AuthInvites` over `Users` + `Sessions` over the first tier).

Two commits (P14). Commit 2 rewrites the sessions and auth-invites parts of `auth.test.ts` onto the services (same
assertions) and adds `apps/api/test/sessions-clock.test.ts`: with `runTest(…, { clock: "test" })` a session created
at T resolves at T + 1 min, and after `TestClock.adjust` past `SESSION_TTL_MS` it no longer resolves; one
`spendableToken` case each for a fresh, an expired and a used row.

Acceptance: the pinned `middleware.test.ts` (`createSession` bridge) and `placeholders.test.ts` green unchanged;
`auth.test.ts`, `sessions-clock.test.ts`, `password-reset.test.ts`, `verified-email-gate.test.ts` green; no `Date.now()` /
`new Date(` / `throw` of `ApiError` left in `sessions.ts` and `invites.ts`; full suite ≥ 14508;
`import-order.test.ts` and `import-order-effect.test.ts` green; typecheck green.

### E2-T08 — Auth flows: `EmailVerification`, `PasswordReset`, `OAuthProviders`, `OAuthAccounts` (build)

Read: `docs/EFFECT.md` E6, E7; `agent-patterns/effect-services.md` §2, `agent-patterns/effect-errors.md` §2 (wrapping
`fetch` with `tryPromise`), `agent-patterns/effect-datetime-clock.md` §2.1; `repos/effect/LLMS.md` "Effect.fn"; the
source of `Effect.tryPromise`, `Effect.catchCause`, `Effect.forkDetach`, `Effect.ignoreCause`. Repo:
`apps/api/src/core/services/auth/{emailVerification,passwordReset,oauthAccounts,tokens}.ts`, `apps/api/src/lib/oauth.ts`,
`apps/api/src/core/services/auth/layer.ts`, the base services of E2-T06 and E2-T07, `apps/api/test/support/effect.ts`,
the tests `apps/api/test/{password-reset,verified-email-gate,auth,oauth-claims}.test.ts`,
`apps/api/scripts/reset-password.ts`. CLAUDE.md "Core hardening from `1715207`", D4 in `docs/SPEC.md` (explicit OAuth
linking only). Decisions P1, P2, P3, P7, P14.

Build the four services (the `fetch` calls of `exchangeCodeForProfile` through `Effect.tryPromise` mapped onto
today's `ApiError` texts; the pure parsers `parseGoogleClaims`, `parseGitHubUser`, `parseGitHubEmails`,
`safeNextPath`, `webUrl`, `callbackUrl`, `createAuthorization`, `isProviderConfigured` stay pure; the timing-safe
token comparisons unchanged), `authServicesLayer()` in its P3 form, and the bridges (P1: at least
`createEmailVerificationToken`, `findUsableEmailVerification`, `confirmEmailVerification`, `markEmailVerified`,
`createPasswordResetToken`, `findUsablePasswordReset`, `consumePasswordReset`, `loginWithOAuthProfile`,
`listOAuthAccounts`, `linkOAuthAccount`, `unlinkOAuthAccount`, `exchangeCodeForProfile` as `Promise`;
`requireProviderConfigured` SYNC with return type `void`). `findUsableEmailVerification` and
`findUsablePasswordReset` move onto `spendableToken`; then delete `assertSpendableToken` from `tokens.ts` (no caller
is left; `grep -rn assertSpendableToken apps/api` empty). `sweepExpiredResetTokens` and
`sweepExpiredVerificationTokens` keep catch-all and stay fire-and-forget (P2). `markEmailVerified` loses its `now`
default (its callers pass the Clock's value, P7).

Two commits (P14). Commit 2 rewrites onto the services: `password-reset.test.ts`, `verified-email-gate.test.ts`
(`markEmailVerified`), the oauth-account parts of `auth.test.ts`. `oauth-claims.test.ts` stays unchanged.

Acceptance: those tests green with unchanged assertions; no `Date.now()` / `new Date(` / `throw` of `ApiError` in the
four files and `tokens.ts`; full suite ≥ 14508; typecheck green.

### E2-T09 — Households domain: `Households`, `HouseholdInvites`, `AuthBootstrap`, the membership checks (build)

Read: `docs/EFFECT.md` E6, E7; `agent-patterns/effect-services.md` §2, `agent-patterns/effect-errors.md` §3;
`agent-patterns/effect-core.md` §3 (`Effect.all` with concurrency). Repo:
`apps/api/src/core/services/households/{households.service,invites.service,membership,mappers,support,validation}.ts`,
`apps/api/src/core/services/auth/bootstrap.ts`, `apps/api/src/core/services/households/layer.ts`, the base services
of E2-T06 and E2-T07, `apps/api/src/modules/adapter.ts`, `apps/api/src/core/services/mail/index.ts` (the `Mailer` and
`templates.ts`), the tests `apps/api/test/{placeholders-core,households,placeholders,core-walkthrough}.test.ts`.
CLAUDE.md "Placeholders and claim invites" (creating a claim invite is admin+ and revokes the older pending one; a
spent claim token is `404 invite_invalid`; deleting a household deletes its placeholder users; `removeMember` runs
every module's `onMemberRemoving` veto first), "Core hardening from `1715207`" (invites rate limited per user,
enforced in the route), "Claim links are credentials", ADR 0004, ADR 0006. Decisions P1, P2, P3, P7, P11, P14.

Build `Households` (with `countOwners` as a method), `HouseholdInvites` (mail through `Mailer.trySendMail`;
`mailDeliveryOf` unchanged), `AuthBootstrap`, the membership Effect checks with the SYNC recipe bridges
(`assertRole`, `assertCanModifyOwned`, explicit `void` return types), `toInviteStatus` without its `Date.now()`
default (callers pass the Clock's value), every `nowMs()` call of `households.service.ts` (5) and
`invites.service.ts` (2) replaced by `yield* Clock.currentTimeMillis` (P7; `support.ts` and its `nowMs` stay for the
modules), `householdServicesLayer()` in its P3 form (`HouseholdInvites` + `AuthBootstrap` over `Households`), and the
bridges for the routes (every exported function of the two service files and of `bootstrap.ts`, `Promise` as today).
`removeMember` keeps: veto hooks first, inside the transaction, nothing deleted on a veto (the hook through P11's
in-service form, replacing E2-T05's interim `runModuleHook(hook, tx)`). Rewrite onto the services: the
`listMembers`, `previewInvite` and `toHouseholdInvite` parts of `placeholders-core.test.ts`.

Acceptance: `placeholders-core.test.ts`, `households.test.ts`, `placeholders.test.ts` (unchanged),
`core-walkthrough.test.ts`, `finance-participants.test.ts` (the `member_has_ledger` veto through the app) green;
`grep -rn 'nowMs' apps/api/src/core --include='*.ts'` lists only `households/support.ts`; no `Date.now()` / `new
Date(` / `throw` of `ApiError` in the six files except `support.ts`'s `nowMs`; full suite ≥ 14508; typecheck green.

### E2-T10 — The auth routes on the runtime (build)

Read: `docs/EFFECT.md` E6, E7; `agent-patterns/effect-errors.md` §3, §4; `repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts`;
the source of `Effect.catchCause` (`src/Effect.ts` ~3333), `Effect.catchDefect` (~3387), `Cause.squash`
(`src/Cause.ts` ~763). Repo: `apps/api/src/core/routes/auth.ts` (whole), the services of E2-T04, E2-T06, E2-T07,
E2-T08, E2-T09, `apps/api/src/lib/{types,validate,cookies,oauth,errors}.ts`, `docs/API.md` section "Auth" (every
row), `apps/api/test/{auth,password-reset,verified-email-gate,oauth-claims,security,api-doc}.test.ts`. CLAUDE.md
"The origin guard trusts `WEB_ORIGIN`" (`readJson` wants `Content-Type: application/json`), "Core hardening from
`1715207`", "Placeholders and claim invites" (a claim invite is redeemed ONLY by register). Decisions P2, P12, P19.

Rewrite every handler of `auth.ts` to the P12 shape: `readJson` becomes an `Effect.fn` that keeps the
`Content-Type` check and decodes with `decode` (P19); `startSession`, `authPayload`, `mailVerificationLink`,
`sendVerificationLinkQuietly` become `Effect.fn`s in the file (`sendVerificationLinkQuietly` ends in
`Effect.catchCause` and keeps today's log line: nothing escapes, a defect included); `enforceRateLimit(c, …)` →
`yield* rateLimiter.enforce(…)`; every `throw` of `ApiError` → `return yield* new <Class>(…)` with the same status,
code and text; cookies are set on `c` inside the generator before the response is returned. **The OAuth callback**
(today lines 599-641): the steps before the `try` (`readProvider`, `requireProviderConfigured`, the rate limit, the
cookie read and clear) stay outside the recovery as today; the body of the `try` becomes an exported `Effect.fn`
`oauthCallbackFlow(c, provider, cookies, next, linking)` returning the success redirect, and the handler applies
`Effect.catchCause` to it exactly as P12 says: `const error = Cause.squash(cause)`, `isApiError(error) ?
String(error.code) : "oauth_failed"`, `console.error("[auth] OAuth callback failed:", error)` for every non-family
value, then the linking or login redirect with `error=<code>`. Never `Effect.catch` / `catchTags` there. Response
bodies, status codes, headers, cookies and log lines are unchanged; no existing test file changes.

New `apps/api/test/oauth-callback.test.ts` (the catch-all has no test today): a tiny Hono app with
`onErrorHandler` whose route runs the handler's recovery over `oauthCallbackFlow` on the app `runtime` with
`Effect.provideService(OAuthProviders, fake)` (the fake's `exchangeCodeForProfile` is the variable part), the
request carrying the state cookie and `?code=x&state=<same>`:
(a) the exchange throws a plain `Error` synchronously inside the effect (`Effect.sync(() => { throw new Error("boom")
})`): 302 to `/login?error=oauth_failed`, the `[auth] OAuth callback failed:` line logged (spy on
`console.error`); (b) the exchange rejects (`Effect.promise(() => Promise.reject(new Error("x")))`): the same;
(c) it fails with `new DatabaseError({ cause })`: `oauth_failed` and the log; (d) it fails with
`new ApiFailure({ status: 400, code: "oauth_failed", text: "server.auth.oauthSessionExpired" })`: the redirect
carries that code and nothing is logged; (e) `?error=access_denied` without a code: `oauth_failed` redirect, no log.

Acceptance: `auth.test.ts`, `password-reset.test.ts`, `verified-email-gate.test.ts`, `security.test.ts`,
`api-doc.test.ts`, `core-walkthrough.test.ts`, `placeholders.test.ts`, `validation-wire.test.ts`,
`oauth-claims.test.ts` green unchanged; `oauth-callback.test.ts` green;
`grep -nE 'await [a-zA-Z]+\(db' apps/api/src/core/routes/auth.ts` empty; no `throw` of `ApiError` and no `instanceof
ApiError` in the file; full suite ≥ 14508; typecheck green.

### E2-T11 — The household routes on the runtime (rewrite)

Read: this section's tables only, plus the four route files and P12. Files: `apps/api/src/core/routes/households.ts`,
`members.ts`, `invites.ts`, `modules.ts`. Touch no other file and no line the tables do not name.

Table A — imports, per file:

| Old | New |
| --- | --- |
| `import { db } from "../../db/client.ts";` | delete |
| `import { requireMembership, requireUser } from "../../lib/types.ts";` (or one of them) | `import { currentMembership, currentUser } from "../../lib/types.ts";` (the ones the file uses) |
| `import { ApiError } from "../../lib/errors.ts";` (`modules.ts`) | `import { NotFound, ValidationFailed } from "../../lib/errors.ts";` (Table B2) |
| `import { HOUSEHOLD_CREATE_RULE, enforceRateLimit } from "../services/auth/rateLimit.ts";` | `import { HOUSEHOLD_CREATE_RULE, RateLimiter } from "../services/auth/rateLimit.ts";` |
| `import { INVITE_RULE, enforceRateLimit } from "../services/auth/rateLimit.ts";` | `import { INVITE_RULE, RateLimiter } from "../services/auth/rateLimit.ts";` |
| `import { createHousehold, … } from "../services/households/households.service.ts";` | `import { Households } from "../services/households/households.service.ts";` |
| `import { acceptInvite, createInvite, listInvites, previewInvite, revokeInvite } from "../services/households/invites.service.ts";` | `import { HouseholdInvites } from "../services/households/invites.service.ts";` |
| `import { disableModule, enableModule } from "../services/households/modules.ts";` | `import { HouseholdModules } from "../services/households/modules.ts";` |
| `import { decodeOrThrow } from "../../lib/validate.ts";` (`modules.ts`) | `import { decode } from "../../lib/validate.ts";` |
| (add, every file) | `import { Effect } from "effect";` and `import { runtime } from "../../runtime.ts";` |

Table B — statements inside a handler:

| Old | New |
| --- | --- |
| `async (c) => {` … `}` (a route handler, the last argument of `router.get/post/patch/delete`) | `(c) => runtime.runPromise(Effect.gen(function* () {` … `}))` |
| `async (c) => json(c, await previewInvite(db, X))` | `(c) => runtime.runPromise(Effect.gen(function* () { const invites = yield* HouseholdInvites; return json(c, yield* invites.previewInvite(X)); }))` |
| `const user = requireUser(c);` | `const user = yield* currentUser(c);` |
| `const membership = requireMembership(c);` | `const membership = yield* currentMembership(c);` |
| `await <fn>(db, A…)` where `<fn>` came from `households.service.ts` | `yield* households.<fn>(A…)` and, once at the top of that generator, `const households = yield* Households;` |
| `await <fn>(db, A…)` where `<fn>` came from `invites.service.ts` | `yield* invites.<fn>(A…)` and `const invites = yield* HouseholdInvites;` |
| `await enableModule(db, A…)` / `await disableModule(db, A…)` | `yield* modules.enableModule(A…)` / `yield* modules.disableModule(A…)` and `const modules = yield* HouseholdModules;` |
| `enforceRateLimit(c, S, I, R);` | `yield* rateLimiter.enforce(S, I, R);` and `const rateLimiter = yield* RateLimiter;` |
| `const [a, b] = await Promise.all([X, Y]);` | `const [a, b] = yield* Effect.all([X', Y'], { concurrency: "unbounded" });` where X', Y' follow the next row (NO `yield*` on them) |
| `<fn>(db, A…)` WITHOUT `await`, as an element of a `Promise.all([...])` array | `households.<fn>(A…)` (or `invites.<fn>(A…)`), with NO `yield*`: `Effect.all` runs the effects (the one case is spelled out below as Table B3) |
| `if (COND) enforceRateLimit(c, S, I, R);` (`invites.ts`, the e-mail invite) | `if (COND) yield* rateLimiter.enforce(S, I, R);` and `const rateLimiter = yield* RateLimiter;` |
| `const moduleId = moduleIdParam(c);` (`modules.ts`) | `const moduleId = yield* moduleIdParam(c);` |
| `const { settings } = await enableBody(c);` (`modules.ts`) | `const { settings } = yield* enableBody(c);` |

Table B2 — the two helpers of `modules.ts`, replaced whole (doc comments above them stay):

```ts
// old
function moduleIdParam(c: AppContext): ModuleId {
  const moduleId = c.req.param("moduleId");
  if (!moduleId || !isModuleId(moduleId)) throw ApiError.notFound();
  return moduleId;
}
// new
const moduleIdParam = Effect.fnUntraced(function* (c: AppContext): Effect.fn.Return<ModuleId, NotFound> {
  const moduleId = c.req.param("moduleId");
  if (!moduleId || !isModuleId(moduleId)) return yield* new NotFound();
  return moduleId;
});

// old
async function enableBody(c: AppContext): Promise<{ settings?: Record<string, unknown> }> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw ApiError.validationFailed(undefined);
  }
  return decodeOrThrow(EnableModuleRequestSchema, raw);
}
// new
const enableBody = Effect.fnUntraced(function* (
  c: AppContext,
): Effect.fn.Return<{ settings?: Record<string, unknown> }, ValidationFailed | Schema.SchemaError> {
  const text = yield* Effect.promise(() => c.req.text());
  if (text.trim() === "") return {};
  const raw = yield* Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: () => new ValidationFailed({ details: undefined }),
  });
  return yield* decode(EnableModuleRequestSchema, raw);
});
```

For `modules.ts` Table A adds `import { NotFound, ValidationFailed } from "../../lib/errors.ts";` (replacing the
`ApiError` import) and `Schema` to the `effect` import (`import { Effect, Schema } from "effect";`). If E2-T01 gave
`ValidationFailed`'s constructor a different field shape, use the shape it exports and note it in the commit body.

Table B3 — the one `Promise.all` handler, `GET /:householdId` in `households.ts`, replaced whole (its doc comment
stays):

```ts
// old
householdRoutes.get("/:householdId", requireSession(), requireHouseholdRole("member"), async (c) => {
  const membership = requireMembership(c);
  const [household, members] = await Promise.all([
    getHouseholdWithRole(db, membership.householdId, membership.role),
    listMembers(db, membership.householdId),
  ]);
  return json(c, { household, members });
});
// new
householdRoutes.get("/:householdId", requireSession(), requireHouseholdRole("member"), (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const households = yield* Households;
      const membership = yield* currentMembership(c);
      const [household, members] = yield* Effect.all(
        [
          households.getHouseholdWithRole(membership.householdId, membership.role),
          households.listMembers(membership.householdId),
        ],
        { concurrency: "unbounded" },
      );
      return json(c, { household, members });
    }),
  ),
);
```

Table C — raising:

| Old | New |
| --- | --- |
| `throw ApiError.notFound(T)` | `return yield* new NotFound({ text: T })` |
| `throw ApiError.notFound()` | `return yield* new NotFound()` |
| `throw ApiError.badRequest(T)` | `return yield* new BadRequest({ text: T })` |
| `throw ApiError.forbidden(T)` | `return yield* new Forbidden({ text: T })` |
| `throw new ApiError(S, C, T)` | `return yield* new ApiFailure({ status: S, code: C, text: T })` |

If a handler only reads (`json(c, …)`) and never awaits, it is still wrapped (Table B row 1) so every handler has
the same shape. Middleware arguments (`requireSession()`, `requireHouseholdRole(…)`, `requireVerifiedEmail()`,
`validate(…)`) and `c.req.valid(…)` stay exactly as they are. The register-order lines (`registerInviteTokenRoutes`
first) are not touched. If a call does not match a row (a function not listed, an argument shape the table does not
cover), stop and report it instead of designing. `modules.ts` also calls `getHouseholdWithRole(db, …)` from
`households.service.ts` (the `await` row with `Households` applies) and `members.ts` calls `removeMember(db,
membership, …)` (the same row: `yield* households.removeMember(membership, …)`).

Acceptance: `grep -nE '\bdb\b' apps/api/src/core/routes/{households,members,invites,modules}.ts` empty;
`grep -nE 'throw ' …` empty; `households.test.ts`, `modules.test.ts`, `placeholders.test.ts`,
`placeholders-core.test.ts`, `core-walkthrough.test.ts`, `api-doc.test.ts`, `middleware.test.ts`,
`finance-participants.test.ts` green unchanged; `grep -n 'Promise.all' apps/api/src/core/routes/households.ts` empty;
full suite ≥ 14508; typecheck green.

### E2-T12 — The middlewares, health and the boot on the runtime (build)

Read: `docs/EFFECT.md` E6, E7, E8 (the order); `agent-patterns/effect-services.md` §3.2, §6;
`repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts`. Repo: `apps/api/src/middleware/*.ts`,
`apps/api/src/lib/locale.ts`, `apps/api/src/lib/types.ts`, `apps/api/src/core/health.ts`, `apps/api/src/index.ts`,
`apps/api/src/runtime.ts`, the services of E2-T04, E2-T06, E2-T07 (`Sessions`, `Users.userDto`),
`apps/api/src/db/database.ts`, the routers that call middleware factories at module scope (`grep -rn
"requireHouseholdRole(\|requireVerifiedEmail(\|requireModule(\|requireSession(" apps/api/src/modules
apps/api/src/core/routes`), the tests `apps/api/test/{middleware,security,static-web,runtime,import-order,import-order-effect,uploads,thumbnails,smoke}.test.ts`.
CLAUDE.md "Middleware chain order is load-bearing", "API import cycle" (hoisted `requireHandler` /
`optionalHandler`), "One runtime, disposed on shutdown (E0)", "The origin guard trusts `WEB_ORIGIN`", "The CSP and
the baked API URL", "Uploads are signed, not cookie-checked". Decisions P12, P18, P21.

Rewrite `session.ts` (`loadSession` as one effect over `Sessions.resolveSession` and `userDto`, cookie writes on
`c`), `household.ts` (`resolveHouseholdId`, `resolveMembership` as effects over `Database`, the 404/403/role
ladder with the same texts; the exported names keep their Promise signatures as thin bridges where a test or
module calls them), `module.ts` (`404 module_disabled` as `ApiFailure`), `verifiedEmail.ts` (`VerifiedEmail.check`),
`originGuard.ts` (refusal as `Forbidden(server.error.originMismatch)` through the runtime; `isForeignOrigin` pure
and unchanged), `lib/locale.ts` unchanged in behaviour, `securityHeaders.ts` / `staticWeb.ts` unchanged unless a
`throw` or a `Date` needs it; `core/health.ts` reads `AppConfig` and `VerifiedEmail` inside the generator
(`healthResponse` stays one constant: `runtime.test.ts` (b) spies on it); `src/index.ts`: `/uploads/:filename`
through `Thumbnails.resolveThumbnail` (same 404s, same `Cache-Control` values), the boot of P18, the shutdown of
P18. **The TDZ rule of P12 for every factory:** `requireSession`, `optionalSession`, `requireHouseholdRole`,
`requireModule`, `requireVerifiedEmail`, `originGuard` stay or become hoisted `function` declarations; the three
`export const requireHouseholdMember/Admin/Owner = () => …` arrows of `household.ts` become `export function`
declarations with the same bodies; no factory body reads an imported binding or a module-level `const` until a
request arrives (move any such read into the returned handler). Add to `import-order-effect.test.ts` the E2-T12
entries of P21 (the four middleware files, the two route files, `households.service.ts`, `sessions.ts`, the two
module manifests). No existing test file changes.

Acceptance: the nine tests above green unchanged (`import-order-effect.test.ts` with its new entries); every entry
of `import-order.test.ts` and `import-order-effect.test.ts` loads first in a fresh process and the `AppLayer` builds
after it; `grep -nE '^export const require' apps/api/src/middleware/*.ts` empty; no `throw` of `ApiError` under
`apps/api/src/middleware/` and `apps/api/src/lib/`; full suite ≥ 14508; typecheck green.

### E2-T13 — Integration: bridges pruned, the idioms rules, docs, the record (build)

Read: this whole plan; `docs/EFFECT.md` §4 E2 and §5; `apps/api/test/effect-idioms.test.ts` (whole);
`apps/web/src/styles/design-system.test.ts` (the pinned-record shape); CLAUDE.md (whole), `docs/plans/e1-shared-schema.md`
§9 and §10 (the record's shape), `docs/plans/m7-harden.md` §9.3 (the walkthrough), `docs/plans/e1-shared-schema.md`
§9.4 (the boot script). Decisions P1, P15, P17, P18, P20.

1. Delete every P1 bridge whose callers are gone (grep each name under `apps/api/src`, `apps/api/scripts`,
   `apps/api/test`; delete `apps/api/src/core/services/auth/index.ts` if nothing imports it); list the survivors in
   section 9 with their callers, their calling convention (sync, `Promise`, `void`) and removal milestone. Check
   that every surviving sync or `void` bridge still carries its explicit return type (P1).
2. `effect-idioms.test.ts`: rules (10) and (11) of P15 (rule (11) with its `nowMs(` part over `apps/api/src/core/`);
   the `PENDING_RULES` comment keeps only E7.
3. CLAUDE.md: Layout (`apps/api/src/config.ts`, `apps/api/src/infra.ts`, `apps/api/src/db/database.ts`,
   `apps/api/src/core/services/layer.ts` and the two area `layer.ts`, `apps/api/src/modules/adapter.ts`,
   `apps/api/test/support/effect.ts`, `apps/api/test/import-order-effect.test.ts`), Status (E2 done, the pass count),
   the ADR list (0014), gotchas: "One composition point" (P3: the TDZ rule for static layers, siblings nested with
   `provideMerge`), "Bridges until E3–E5" (P1: calling conventions kept, explicit return types; the recipe import
   rate limit is sync), "Catch-all stays catch-all" (P2: `Effect.catch` misses defects), "The Database service and
   the shared client" (P6, never close under test, `layerFromExecutor`), "The mail seam" (P8), "Hooks are Effects
   behind `fromPromiseModule`" (P11, `runModuleHook`), "Middleware factories are TDZ-safe" (P12, P21), the "One
   runtime" gotcha updated for `[db] database closed` (P18); the pattern files' §7 where the code proved a line
   wrong; `docs/open-work.md` only if something is left open.
4. The gates: `bun install --frozen-lockfile`, `bun run typecheck`, `bun test` (pass count vs 14508), `bun run
   build`, `bun run i18n:check` (classify every hit; the count stays 146 unless a new comment quotes German, which
   is then classified in the record), `git status --porcelain repos/`.
5. Boot and shutdown: a migrated temp DB, `NODE_ENV=development DATABASE_URL=file:<tmp>/boot.db SESSION_SECRET=<32
   hex> API_PORT=3902 WEB_ORIGIN=http://127.0.0.1:3902 bun run dev:api` in the background with one log ending
   `exit=$?`; `/api/health` 200; the walkthrough with curl and a cookie jar: `POST /api/auth/register` 201, `POST
   /api/households` 201, `POST /api/households/:id/invites` (link invite) 201, a second user registers 201, `GET
   /api/households/invites/:token` 200, `POST /api/households/invites/accept` 200, `GET /api/households/:id` 200
   with `memberCount` 2, `GET /api/auth/me` without cookie 401, a 422 with German `details` as in E1 §9.4; the
   live rate limit (the server runs under `NODE_ENV=development`, so the limiter is ON): `POST
   /api/households` by the same user until its sixth create within the hour (the walkthrough's included) answers `429 rate_limited` with a `Retry-After` header
   (`HOUSEHOLD_CREATE_RULE` 5/h); then `kill -TERM <pid>` (never `pkill -f`): the log ends `[api] SIGTERM —
   stopping modules …`, `[db] database closed`, `[api] runtime disposed`, and the exit is 0.
6. Sections 9 (gates, greps, the survivors table, boot and walkthrough transcripts with statuses) and 10 (what
   changed vs plan, the deviations each task recorded) of this plan; Status line DONE.

## 5. Acceptance summary

| Exit criterion | Proved by |
| --- | --- |
| gates green, pass ≥ 14508 | E2-T13 step 4; P20 in every task |
| `db-pragmas`, `middleware`, `import-order`, `placeholders`, rate-limit, origin-guard tests unchanged | P14; E2-T13 records the empty output of `git diff 6991769c9 -- <those files>` (the rate-limit block by a diff of `auth.test.ts` restricted to that `describe`) |
| `AppConfig`, `Database`, the error family, `Mailer`, `Uploads`/`Thumbnails`, `RateLimiter`, Clock in core services | E2-T01 to E2-T09; idioms rules (10), (11) |
| every `core/services` module a `Context.Service` with a static `layer` | P2 table; E2-T13 greps `Context.Service` per file |
| routes and middlewares through `runtime.runPromise`, order unchanged | E2-T10 to E2-T12; `middleware.test.ts`, `api-doc.test.ts` |
| hooks typed as Effects, Promise manifests adapted | E2-T05; `module-adapter.test.ts` |
| the bridges keep their calling conventions (sync rate limit, `void` warm) | P1, P9, P10; `rate-limiter.test.ts`; E2-T13 step 1 |
| catch-all sites keep catch-all | P2, P12; `oauth-callback.test.ts`, `mail.test.ts`, `auth.test.ts` (`verifyPassword`) |
| boot, `/api/health`, SIGTERM closes the database through the scope, exit 0 | E2-T13 step 5 |
| walkthrough statuses (and the live 429) | E2-T13 step 5 |

## 6. Risks

- **TDZ in the import cycle.** A static `layer` that reads another service class, a composition that runs at
  import, or a middleware factory that reads a module-level binding crashes an entry point in a fresh process
  while every in-process test passes (the M2-T12 failure). Mitigation: P2 (no imported binding in a static
  initializer), P3 (hoisted composition functions, `Layer.suspend`), P12 (hoisted, binding-free factories), P21 (the
  second fresh-process test, which also builds the `AppLayer` after each import order); every task runs both
  import-order tests.
- **A sync bridge turned async.** `enforceRateLimit` is called unawaited by recipe and is a no-op under test: an
  async bridge would pass every gate and drop the import limit in production. Mitigation: P1 explicit return types,
  P9 `Effect.runSync`, `rate-limiter.test.ts` with the limiter switched on, the live 429 of E2-T13 step 5.
- **Defects past `Effect.catch`.** A catch-all `try/catch` rewritten with `Effect.catch` lets a sync throw or a
  promise rejection through as a 500. Mitigation: P2, P12 (`Effect.catchCause`), `oauth-callback.test.ts`.
- **Closing the shared client.** Any layer whose release closes `client` and that a test builds and disposes kills
  every later test file in the process. Mitigation: P6 (no close under `NODE_ENV=test`), `database.test.ts` proves it.
- **Transaction semantics.** Running an Effect inside drizzle's callback transaction must roll back on a typed
  failure and on a defect, and must surface the same error object (`modules.test.ts` (h) `toBe(refusal)`); a hook
  handed a bare `tx` must see that `tx`. Mitigation: P6 tests in E2-T03 (`layerFromExecutor` included),
  `finance-file-db.test.ts`, `module-adapter.test.ts`.
- **Error identity, `instanceof` and throwing constructors.** Module code and module tests rely on `instanceof
  ApiError` and on `ApiError` as a return type; a validating constructor could throw on a module's `details`.
  Mitigation: P4 (legacy class, `Symbol.hasInstance`, permissive fields, `disableChecks`, `DatabaseError` outside),
  `errors.test.ts`.
- **Layer nesting.** A sibling dependency inside one `mergeAll` leaves a requirement open. Mitigation: P3 spelled
  out, the `never` annotation on `AppLayer`.
- **Config parity.** `Config` decodes without `errors: "all"` and treats `""` as missing; `env-parse.test.ts` pins
  every line. Mitigation: P5 (the struct schema stays the decoder; `Config` reads the provider).
- **Per-request runtime overhead.** One `runPromise` per handler and middleware adds microseconds; the suite's 40 s
  must not grow beyond noise. E2-T13 records the suite time next to the baseline (39.79 s).
- **Mail through the seam.** A service that captured a transport at build would ignore `setMailer` and break the
  through-the-app tests that install a failing relay (`households.test.ts`, `placeholders.test.ts`). Mitigation: P8
  (the override is read at send time).
- **Parallel worktrees.** Load makes sharp tests slow (CLAUDE.md gotcha); keep `SHARP_TEST_TIMEOUT_MS`.

## 7. Deviations expected (each recorded in section 10 when it happens)

1. The process-wide database instance is created at import of `db/client.ts`, not by the layer (P6, ADR 0014).
2. `Database` service class in `apps/api/src/db/database.ts` instead of `db/client.ts` (EFFECT.md §3.2 lists
   `db/{client,migrate,schema}.ts`), because the drizzle type `Database` keeps its name for the module and script
   files until E3 to E5.
3. Legacy bridges, `PromiseApiModule`, `fromPromiseModule` and `runModuleHook` live through E2 (P1, P11, ADR 0014);
   the two manifests change one annotation each.
4. `RateLimited` joins the family beside the one-class-per-helper set (P4) to carry `Retry-After`; `DatabaseError`
   is a tagged error outside the family, rendered as a 500.
5. The stale ADR 0013 guard test is rewritten to the accepted state (P16), a documentation guard, not behaviour.
6. `originGuard`, `localeMiddleware`, `securityHeaders` and `staticWeb` keep reading the resolved config value
   instead of yielding `AppConfig` per request (P12).
7. `enforceRateLimit` gains an optional trailing `enabled` parameter (P9) and `SmtpMailer.send` an optional `now`
   (P8): additive, every existing call unchanged.

## 8. Out of this milestone

The recipe and finance services, routes and their tests (E3, E4); the scripts as Effect programs (E5; E2 edits
`scripts/seed.ts` at one call site only); the web (E6); replacing Hono (E7); `@effect/sql-libsql`, OpenTelemetry,
any `docs/API.md` row, any UI or copy change; removing the bridges that modules and scripts still need.

## 9. Integration record

Written by E2-T13 on 2026-10-20, on `main` at `6d27c4d50` (E2-T12) plus this task's changes, Bun 1.4.3. Every log was
read; what follows quotes it. The load average on the host during the full suite was about 14 to 25 (parallel
sessions), against a quiet machine for the 39.79 s baseline of section 1.2.

### 9.1 Gates

- `bun install --frozen-lockfile`: `Checked 439 installs across 628 packages (no changes)`, `exit=0`.
- `bun run typecheck`: five projects, `[typecheck] OK`.
- Full `bun test`:
  ```
   14657 pass
   0 fail
  Ran 14657 tests across 158 files. [118.62s]
  ```
  A second run after the documentation edits: `14657 pass`, `0 fail`, `Ran 14657 tests across 158 files. [69.96s]` (load
  average 50.6 at its end). The floor was 14508 (E1's record, 150 files). E2 added eight test files (`config`, `database`, `errors`,
  `import-order-effect`, `module-adapter`, `oauth-callback`, `rate-limiter`, `sessions-clock`) and rules (10) and (11) of the
  idioms test: 149 more tests. The 118.62 s and 69.96 s were measured under the host load named above (parallel sessions), 1.8x to 3x the
  baseline of section 1.2; the per-request overhead risk of section 6 is therefore NOT settled by this number, and a
  quiet-machine time is not claimed (`bun test` alone on a quiet host is the check, expected near 40 s).
- `bun run build`: `@toon/web build: Exited with code 0`, `precache  104 entries (1456.28 KiB)` (the same as E1: E2 touches
  no web file).
- `bun run i18n:check`: `[i18n:check] OK` (parity) and `FAILED — 147 possible German literal(s)`: the known 146 plus ONE new
  hit, classified: `apps/api/src/modules/adapter.ts:40: Effect.catch((cause) => (isApiError(cause) ? Effect.fail(cause) :
  Effect.die(cause)))`, a false positive (the stopword `die` of the German-literal scan matches the Effect API
  `Effect.die`, English code, no German). Every other hit in a file E2 touched is a doc comment quoting German that
  was already counted: `core/services/mail/smtp.ts` 3, `core/services/mail/index.ts` 1, `core/services/auth/passwordReset.ts` 1,
  `core/services/households/support.ts` 3, `db/schema/core.ts` 1. The other 135 are the known false positives (recipe content
  vocabulary, doc comments). The first run, started in the background, never finished (idle, no child process) and was
  killed; the same command in the foreground with `< /dev/null` finished in under a minute.
- `bun test apps/api/test/effect-idioms.test.ts`: `25 pass`, `0 fail` (rules (1) to (11)); `docs-paths.test.ts` and
  `api-doc.test.ts`: `13 pass` after the CLAUDE.md edit (a first run found `scripts/seed.ts`, fixed to
  `apps/api/scripts/seed.ts`).
- `git status --porcelain repos/`: empty.
- The pinned test files of the exit criteria against the base: `git diff --quiet 6991769c9 -- apps/api/test/db-pragmas.test.ts
  apps/api/test/middleware.test.ts apps/api/test/import-order.test.ts apps/api/test/placeholders.test.ts
  apps/api/test/security.test.ts` exits 0 (no difference). The rate-limit block of `apps/api/test/auth.test.ts` (from
  `the sliding-window rate limiter blocks after the limit` to the end of the file) is identical to the base
  (`diff` of the two extracts: no output); the rest of that file was rewritten onto the services by E2-T06 to E2-T08.

### 9.2 The legacy bridges after the prune

Before E2-T13: 81 bridges (and two pure helpers under the same marker) in 20 files; 12 files keep a marker. **59 were deleted**: every bridge whose
callers were only core routes, middlewares, `apps/api/src/index.ts` or rewritten core tests, all of
`auth/index.ts` (the old barrel, imported by nothing, `git rm`), and the two bridges of `lib/oauth.ts`
(`requireProviderConfigured` became `Effect.runSync(checkProviderConfigured(...))` inside `createAuthorization`, which is
its only caller; `exchangeCodeForProfile` had none). The files `auth/passwords.ts`, `auth/bootstrap.ts`,
`auth/invites.ts`, `auth/emailVerification.ts`, `auth/oauthAccounts.ts`, `households/households.service.ts` and
`households/invites.service.ts` have no bridge section left; the files that keep one say which of their exports survive.
`apps/api/src` lost 668 lines and gained 53 (comments only) in this task.

**22 bridges survive.** Every one carries its explicit return type (checked in each file: `: string`, `: void`,
`: RateLimitResult`, `: boolean`, `: User`, `: Membership`, `: Mailer`, `: Promise<…>`), and none holds a literal `throw`.

| Bridge (file) | Convention | Callers outside the converted set | Removed by |
| --- | --- | --- | --- |
| `requireUser`, `requireMembership` (`lib/types.ts`) | sync `: User`, `: Membership` (`Effect.runSync`, throws the tagged error) | recipe routes (`imports`, `shopping`, `plan`, `recipes`, `cards`), finance routes (`plan`, `participants`, `transactions`) and `finance/middleware.ts`; `modules.test.ts`, `middleware.test.ts` (pinned), `errors.test.ts` | E3, E4 |
| `checkRateLimit`, `resetRateLimits` (`auth/rateLimit.ts`) | sync `: RateLimitResult`, `: void` | `auth.test.ts` rate-limit block (pinned), `rate-limiter.test.ts`, `modules.test.ts`, `finance-module.test.ts` | the test seams go with E9's support, E8 at the latest |
| `enforceRateLimit` (`auth/rateLimit.ts`) | sync `: string` (throws `RateLimited`, sets `Retry-After`); an unawaited statement in recipe | recipe `routes/imports.ts` (3 calls), `rate-limiter.test.ts` | E3 |
| `isVerifiedEmailRequired` (`auth/verifiedEmail.ts`) | sync `: boolean` | recipe `import/capabilities.ts`, `verified-email-gate.test.ts` | E3 |
| `getMailer`, `setMailer`, `isMailerOverridden`, `isMailConfigured` (`mail/index.ts`) | sync (the seam `setMailer(null)` restores the configured adapter) | `setMailer`: eight test files and `test/support/effect.ts`; `getMailer`, `isMailerOverridden`: `mail.test.ts`; `isMailConfigured`: `auth/verifiedEmail.ts` (the service's own rule), `scripts/reset-password.ts`, `mail.test.ts` | the seam with E9/E8; the script's use with E5 |
| `trySendMail` (`mail/index.ts`) | Promise | `scripts/reset-password.ts`, `mail.test.ts` | E5 |
| `collectUploadReferences` (`media/references.ts`) | Promise (through `runModuleHook`, no runtime import) | `scripts/uploads-gc.ts`, `recipe-module.test.ts` | E5, E3 |
| `storeUploadedImage` (`media/uploads.ts`) | Promise | recipe `routes/recipes.ts`, `uploads.test.ts` | E3 |
| `warmThumbnail` (`media/thumbnails.ts`) | `: void`, returns before any work, never rejects | recipe `import/url/image.ts` (unawaited), `thumbnails.test.ts` | E3 |
| `createSession` (`auth/sessions.ts`) | Promise | `middleware.test.ts` (pinned), `test/import/routes.test.ts`, `test/import/ocr-disabled.test.ts` | E3 for the two import tests; the pinned test with E8 |
| `findUserByEmail` (`auth/users.ts`) | Promise | `scripts/reset-password.ts` | E5 |
| `claimPlaceholderUser` (`auth/users.ts`) | Promise | `placeholders.test.ts` (pinned: the two-claim race) | E8 (a pinned file) |
| `createPasswordResetToken` (`auth/passwordReset.ts`) | Promise | `scripts/reset-password.ts` | E5 |
| `initializeHousehold` (`households/modules.ts`) | Promise | `scripts/seed.ts` (a dynamic import), `finance-seed.test.ts` | E5, E4 |
| `enableModule` (`households/modules.ts`) | Promise | finance `seed.ts` | E4 |
| `assertCanModifyOwned` (`households/membership.ts`) | sync `: void` | recipe `recipes.service.ts`, `collections.service.ts`, `shopping/lists.service.ts` | E3 |
| `assertRole` (`households/membership.ts`) | sync `: void` | none reads it: `recipes.service.ts` still imports it unused | E3 (deleted with that import) |

Not bridges, and not removed: the pure helpers that sit under the same marker (`mailDeliveryOf`, `redactAddress`, kept in
`mail/index.ts`, now commented as such), `generateInviteToken` and `INVITE_TTL_MS`, `isUniqueViolation`, `isPlaceholderUser`,
`nowMs`, `withTransaction`; the seam `setVerifiedEmailRequired`; and the contract shims of P11 (`PromiseApiModule`,
`fromPromiseModule`, `runModuleHook`, E3 and E4). ADR 0014 carries the same list in prose.

### 9.3 Exit greps

- `grep -rnE '\bthrow\s+(new\s+)?ApiError\b' apps/api/src` outside comment lines: 63 lines under `apps/api/src/modules/recipe/`, 40
  under `apps/api/src/modules/finance/`, none in `core/`, `lib/`, `middleware/`, `db/` or `index.ts` (rule (10)'s allow list is
  exactly those two prefixes).
- `grep -rnE 'Date\.now|new Date' apps/api/src/core` outside comments: one line, `core/services/households/support.ts:52`
  (`nowMs()`'s body); `grep -rnE '\bnowMs\s*\(' apps/api/src/core`: its definition only (rule (11)). No `Date` is read under any
  `core/services` file.
- `Context.Service` classes: 20 files (`config.ts`, `db/database.ts`, `lib/oauth.ts` and the 17 service files of
  `core/services/{auth,households,mail,media}`); the files of `core/services` without one are the pure helper modules
  (`auth/tokens.ts`, `households/{mappers,membership,support,validation}.ts`, `mail/{types,templates,console,resend,smtp}.ts`) and
  the three `layer.ts`.
- `grep -nE '^export const require' apps/api/src/middleware/*.ts`: empty.

### 9.4 Boot, walkthrough, live 429 and SIGTERM

One script (`kill -TERM` of the server's pid), a migrated temp DB (`migrate_exit=0`), `NODE_ENV=development
DATABASE_URL=file:<tmp>/boot.db API_PORT=3902 WEB_ORIGIN=http://127.0.0.1:3902 bun apps/api/src/index.ts` (the limiter is ON).
`dev:api` is `bun --filter @toon/api dev` (`bun --watch`), a wrapper whose pid is not the server's, so the check ran the
entry file directly, as E1's boot script did. Every request with its status (bodies abbreviated):

| Request | Status | Notes |
| --- | --- | --- |
| `GET /api/health` | 200 | `{"ok":true,"status":"ok","version":"0.1.0","time":"2026-10-20T12:31:13.791Z","database":"file","modules":["recipe","finance"],"features":{"verifiedEmailRequired":false,"ocrImport":false,"pdfImport":false}}` |
| `GET /api/auth/me` without cookie | 401 | `{"error":{"code":"unauthorized","message":"Nicht angemeldet"}}` |
| `POST /api/auth/register` `{"email":"x","name":"","password":"kurz"}` | 422 | `validation_failed`, `Eingabe ist ungültig`, `details` with `Bitte eine gültige E-Mail-Adresse angeben`, `Name fehlt`, ... and `i18n` as in E1 section 9.4 |
| `POST /api/auth/register` A | 201 | the verification mail printed to the console log (`MAIL_TRANSPORT` unset) |
| `POST /api/households` (create 1) | 201 | `role: "owner"`, `memberCount: 1`, `modules: ["recipe"]` |
| `POST /api/households/:id/invites` | 201 | link invite with an e-mail; the invite mail printed |
| `POST /api/auth/register` B | 201 | |
| `GET /api/households/invites/:token` | 200 | `householdName: "WG"`, `invitedByName: "Anna"`, `status: "pending"` |
| `POST /api/households/invites/accept` (B) | 200 | `role: "member"`, `memberCount: 2` |
| `GET /api/households/:id` (A) | 200 | `memberCount: 2` |
| `GET /api/auth/me` (A) | 200 | `activeHouseholdId` is the created household |
| `POST /api/households` (create 2 to 5) | 201 x4 | |
| `POST /api/households` (create 6) | **429** | `{"error":{"code":"rate_limited","message":"Zu viele Versuche. Bitte in 3600 Sekunden erneut probieren."}}`, header `Retry-After: 3600` |
| `POST /api/households` (create 7) | 429 | `Retry-After: 3600` again |
| `GET /api/households` (A) | 200 | unaffected by the limiter |

(`HOUSEHOLD_CREATE_RULE` is 5 per hour: the walkthrough's own create was the first of the five.) After `kill -TERM 3670313`
the server log ends:

```
[api] SIGTERM — stopping modules …
[db] database closed
[api] runtime disposed
```

and the script printed `server_exit=0`. The 429 line of the server log is `[api] POST /api/households -> 429 rate_limited: Too many
attempts. Please try again in 3600 seconds.` (development logging, as before). The boot log's first line is `[api] toon-household API on
http://localhost:3902 (db: file, origins: http://127.0.0.1:3902, mail: console, web: extern)`.

## 10. What changed vs plan

Everything section 7 expected happened as written; in order, what else differs from the plan, and what each task recorded:

1. **The service class is `MailerService`** (E2-T04, P2 table said `Mailer`): the transport interface `Mailer` of
   `core/services/mail/types.ts` is what the pinned tests (`placeholders.test.ts`, `households.test.ts`) import from
   `mail/index.ts`, so the service takes the other name; CLAUDE.md's layout says so.
2. **`API_MODULES` is a lazy array** (E2-T12, P11 spelled a plain array literal): a manifest imported FIRST in a fresh process
   reaches `modules/index.ts` while its own binding is in the TDZ (found by the new `import-order-effect.test.ts`), so the
   exported list is a `Proxy` over the wrapped manifests built on first access. Same reads (`.map`, `for…of`, `.length`), still
   fails loudly at module scope.
3. **Rule (11)'s allow list has no finance entry** (E2-T13, P15 listed `apps/api/src/modules/finance/services/`): finance's
   services hold no `Date.now(` / `new Date(` today, and the stale-entry test of the rule (new, in the shape of the design-system
   gate) refuses an entry that matches nothing. Recipe's prefix and `support.ts` stay. Rules (10) and (11) each also carry a "the rule
   bites" test on sample lines.
4. **`requireProviderConfigured`, `toUserDto`, `requireAccountEmail`, `resolveThumbnail`, `assertEmailVerified` were not survivors**
   (P1 listed the first three as sync bridges, P10 the fourth): no caller outside the converted set remained after E2-T10 to E2-T12,
   so E2-T13 deleted them; the OAuth check is inlined in `createAuthorization` as `Effect.runSync(checkProviderConfigured(...))`.
   `assertRole` survives with no reader (an unused import in recipe, section 9.2).
5. **`runtime.ts` was edited by E2-T06 and E2-T07** to grow `AppServices` (not in those tasks' file lists); from E2-T07 on
   `core/services/layer.ts` alone grows it, as P3 intended.
6. **`AppConfig`'s process value is a memoized plain function, not a provider chain** (E2-T02, recorded in
   `agent-patterns/effect-config.md`): parity with `env-parse.test.ts` (40 messages) and the old dotenv loader decided it; the
   `Config` only reads, the moved `Schema` decodes with every issue collected.
7. **`OAuthTransportError` is a tagged error outside the family** (E2-T08): a transport failure of the provider exchange is
   logged and redirected as `oauth_failed`, as the raw `TypeError` was; it never reaches the wire.
8. **`i18n:check` counts 147, not 146** (section 9.1): one new false positive, `Effect.die(` in `modules/adapter.ts`
   (the German stopword `die`). No German string was added, no catalog changed.
9. **The boot check ran the entry file, not `bun run dev:api`** (section 9.4): the wrapper's pid is not the server's.
10. **Pass count 14657 against the floor 14508** (section 9.1), eight new test files; the one stale guard (ADR 0013, P16) was
    turned into the accepted-state guard by E2-T01 with the same test count.
11. **Docs written by this task**: `CLAUDE.md` (the ADR list with 0014; Status; Layout "Effect core (E2)"; the gotchas "One runtime"
    updated and "One composition point", "Bridges until E3 to E5", "Catch-all stays catch-all", "The error family and the one
    boundary mapper", "The `Database` service and the shared client", "The mail seam", "Hooks are Effects behind
    `fromPromiseModule`", "Middleware factories are TDZ-safe"; the idioms gate paragraph with rules (10) and (11)),
    `agent-patterns/effect-{core,services,errors,datetime-clock,testing}.md` ("As built (E2, integration)"), ADR 0014 (the
    survivors), this plan. `docs/open-work.md` and `docs/EFFECT.md` needed no change: no new open item, and E5 and E7 already
    point at ADR 0014.
12. **Left for later milestones** (section 8, unchanged): the recipe and finance services, routes and tests (E3, E4), the scripts as
    Effect programs (E5; the bridges of section 9.2 end there), the web (E6), Hono (E7). The `PENDING_RULES` comment of the idioms
    test keeps only E7's rule (no `hono`).
