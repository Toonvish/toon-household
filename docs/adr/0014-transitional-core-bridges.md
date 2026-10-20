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
