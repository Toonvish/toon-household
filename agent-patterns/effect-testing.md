# effect-testing: testing Effect programs under plain `bun test`

Distilled from the vendored Effect source (`repos/effect`, effect@4.0.5). Read-only reference; every API name
below was grepped in `repos/effect/packages/effect/src`. No `@effect/vitest` here (E9): the vendored docs use it
(`it.effect`, `layer(...)`); this file shows what each of those does by hand under `bun:test`.

## 1. What it is for, and the imports

Tests of Effect programs need three things: run an Effect from a plain `async` test, control time
(`Effect.sleep`, timeouts, schedules, `Clock`) and capture console output. `effect/testing` provides the last two
as layers; running is `Effect.runPromise`.

```ts
import { describe, expect, test } from "bun:test"
import { Clock, Context, Effect, Exit, Fiber, Layer, ManagedRuntime, Schema } from "effect"
import { TestClock, TestConsole, TestCrypto, TestSchema } from "effect/testing"
```

`effect/testing` is the barrel (`repos/effect/packages/effect/src/testing/index.ts`: `TestClock`, `TestConsole`, `TestCrypto`,
`TestSchema`); it is a real export of the package (`"./testing"`), not an `effect/unstable/*` path. Never
`import ... from "@effect/vitest"`, never from `repos/`.

## 2. Constructors and call shapes

### 2.1 Run one effect with its layers, as a Promise (the `it.effect` replacement)

```ts
const program = Effect.gen(function*() {
  const value = yield* Effect.succeed(1)
  return value + 1
}).pipe(Effect.provide(Layer.mergeAll(TestClock.layer(), TestConsole.layer)))

test("runs", async () => {
  expect(await Effect.runPromise(program)).toBe(2)
})
```

`Effect.runPromise(effect, options?)` needs `R = never`, so every service is provided first
(`Effect.provide(layer)`). A typed failure rejects the promise with the squashed cause, i.e. the failure value
itself (`internal/effect.ts` `runPromiseWith`: `throw causeSquash(exit.cause)`).
Source: `repos/effect/packages/effect/src/Effect.ts` (`runPromise`, `runPromiseExit`, `provide`), `migration/v3-to-v4.md`
("`TestContext.TestContext` -> `Layer.mergeAll(TestConsole.layer, TestClock.layer())`: the v4 test layer used by
`@effect/vitest`").

### 2.2 TestClock: fork, adjust, join

```ts
const program = Effect.gen(function*() {
  const fiber = yield* Effect.forkChild(Effect.sleep(60_000).pipe(Effect.as("done" as const)))
  // Move virtual time forward to complete sleeping fibers immediately.
  yield* TestClock.adjust(60_000)
  return yield* Fiber.join(fiber)
}).pipe(Effect.provide(TestClock.layer()))
```

Source: `ai-docs/src/09_testing/10_effect-tests.ts` (the `it.effect("controls time with TestClock")` body, with
`Effect.forkChild`), `repos/effect/packages/effect/src/testing/TestClock.ts` header. Also `TestClock.setTime(timestampMs)`
(jump to an instant), `TestClock.withLive(effect)` (run one effect on the real clock),
`TestClock.testClockWith((testClock) => ...)`. Time starts at epoch 0; read it with `Clock.currentTimeMillis`
(virtual under the layer). `TestClock.layer(options?)` takes `{ warningDelay }`.

### 2.3 TestConsole: capture `Console.log` / `Console.error`

```ts
const program = Effect.gen(function*() {
  yield* Console.log("Hello")
  yield* Console.error("boom")
  return [yield* TestConsole.logLines, yield* TestConsole.errorLines] // [["Hello"], ["boom"]]
}).pipe(Effect.provide(TestConsole.layer))
```

(add `Console` to the `effect` import.) Source: `repos/effect/packages/effect/src/testing/TestConsole.ts` (`layer`,
`logLines`, `errorLines`, `testConsoleWith`). Captured lines are the raw arguments, flattened per call.

### 2.4 Test layers for services (mock, hand-written, shared)

```ts
class UserService extends Context.Service<UserService, {
  readonly getUser: (id: string) => Effect.Effect<{ id: string; name: string }, Error>
  readonly deleteUser: (id: string) => Effect.Effect<void, Error>
}>()("UserService") {}

// Partial mock: a member you omit dies with UnimplementedError when used.
const testUser = Layer.mock(UserService, {
  getUser: (id) => Effect.succeed({ id, name: "Test User" })
})
```

Source: `repos/effect/packages/effect/src/Layer.ts` (`Layer.mock`, `Layer.succeed(Service, value)`, `Layer.effect(Service,
effect)`). A stateful in-memory double with a test `Ref` and `Layer.provideMerge` (so the test can reach the ref):
`ai-docs/src/09_testing/20_layer-tests.ts` (`TodoRepo.layerTest` = `Layer.effect(...).pipe(Layer.provideMerge(
TodoRepoTestRef.layer))`; `static readonly layerTest` on the service class).

### 2.5 A layer shared by a whole describe block (the `layer(...)` replacement)

`layer(L)("name", (it) => ...)` of `@effect/vitest` builds `L` once and tears it down in `afterAll`. Under bun:

```ts
const runtime = ManagedRuntime.make(TodoRepo.layerTest) // nothing is built yet
afterAll(() => runtime.dispose())                       // closes the layer scope
test("a", async () => { await runtime.runPromise(Effect.gen(function*() { /* yield* TodoRepo */ })) })
```

(`afterAll` from `bun:test`.) Source: `repos/effect/packages/effect/src/ManagedRuntime.ts` (`make(layer, { memoMap? })`,
`runPromise`, `runPromiseExit`, `dispose`, `disposeEffect`, `context`, `contextEffect`). The build is lazy and
memoized: the first run builds the layer, later runs reuse it (state is shared between tests, as in the vendored
example).

## 3. Composing, providing

- `Effect.provide(layer)` / `Effect.provide([layerA, layerB])` / `Effect.provide(context)`; compose layers first
  (`Layer.mergeAll`, `Layer.provide`, `Layer.provideMerge`), provide once. v4 shares the layer memo map across
  `Effect.provide` calls; `{ local: true }` opts out (`migration/layer-memoization.md`).
- A test that needs the fake clock AND a service: `Effect.provide(Layer.mergeAll(TestClock.layer(), Service.layerTest))`.
  The test layer must wrap the WHOLE program, forks included (children inherit the fiber's services).
- `Effect.provideService(Service, impl)`, `Effect.provideContext(context)` for a one-off value.
- A `Context` you built yourself: `Effect.runPromiseWith(context)(effect)`; `Layer.build(layer)` needs a `Scope`
  (`Effect.scoped`).
- `Effect.runSync(effect)` for pure or synchronous programs (shared and web tests); `Effect.runSyncExit` too.
- Deterministic randomness: `TestCrypto.layer(seed)` (needs a platform `Crypto`); UUIDv7 and ULID also read the
  `Clock`, so provide `TestClock.layer()` as well when the full value must repeat.
- Schemas: `new TestSchema.Asserts(schema).decoding().succeed(input, expected)` and `.fail(input, message)` return
  Promises (`.succeedEffect` / `.failEffect` are the lazy Effect forms); `.encoding()`, `.make()` likewise
  (`repos/effect/packages/effect/src/testing/TestSchema.ts`, `@stability unstable`; it asserts with `node:assert`, a mismatch
  rejects with an `AssertionError`).

## 4. Error handling in tests

- Assert a typed failure without `try/catch`: `Effect.flip` swaps the channels, so the error is the value.

```ts
const error = await Effect.runPromise(Effect.flip(failing)) // failing: Effect<_, NotFound>
expect(error._tag).toBe("NotFound")
```

- Or `const exit = await Effect.runPromiseExit(program)` then `Exit.isFailure(exit)` / `Exit.isSuccess(exit)`;
  `exit.cause` is a `Cause` (`Cause.squash`, `Cause.findError`, `Cause.hasDies`, `Cause.pretty`).
  A rejected `runPromise` carries the squashed cause: the typed error instance for a failure, the thrown value for
  a defect: `await expect(Effect.runPromise(p)).rejects.toBeInstanceOf(NotFound)`.
- Typed failures (`Effect.fail`, a `Schema.TaggedError`) are in the E channel and are caught with
  `Effect.catchTag` / `Effect.catchTags` / `Effect.catch`; defects (`Effect.die`, a thrown exception,
  `Layer.mock`'s `UnimplementedError`) are not, only `Effect.catchDefect` / `Effect.catchCause` / `Effect.exit` see
  them. A test that must show a defect uses `runPromiseExit` and `Cause.hasDies`.
- `Effect.timeout(duration)` fails with `Cause.TimeoutError`; under TestClock that needs `TestClock.adjust` past
  the duration (the `TestClock.ts` header example forks `sleep("5 minutes")` with `timeout("1 minute")`, adjusts one
  minute, `Fiber.await`s and finds a failure).
- What reaches a test boundary is what you choose: `runPromise` rejects, `runPromiseExit` never rejects.

## 5. v3 to v4 renames that bite in tests

| v3 | v4 |
| --- | --- |
| `import { TestClock } from "effect/TestClock"` | `import { TestClock } from "effect/testing"` (`effect/testing/TestClock`) |
| `TestContext.TestContext` | `Layer.mergeAll(TestConsole.layer, TestClock.layer())` |
| `TestClock.defaultTestClock` | `TestClock.layer()` |
| `TestClock.currentTimeMillis` | `Clock.currentTimeMillis` (virtual under the layer) |
| `TestClock.adjustWith(d)(eff)` | `Effect.zipWith(eff, TestClock.adjust(d), (result) => result, { concurrent: true })` |
| `TestClock.sleeps`, `.save`, `.makeData` | removed: fork the sleepers, adjust, join; `TestClock.setTime` for a start instant |
| `Effect.fork` / `Effect.forkDaemon` | `Effect.forkChild` / `Effect.forkDetach` |
| `Effect.catchAll` / `catchAllCause` / `catchAllDefect` | `Effect.catch` / `catchCause` / `catchDefect` |
| `Context.Tag` / `Effect.Tag` / `Effect.Service` | `Context.Service` (class form, static `layer`) |
| `Layer.scoped(Tag, eff)` | `Layer.effect(Tag, eff)` (supplies and excludes the layer `Scope`) |
| `Runtime.runPromise(runtime)`, `Layer.toRuntime` | `Effect.runPromiseWith(context)`, `Layer.build` or `ManagedRuntime.make` |
| `ManagedRuntime.runtimeEffect` / `.runtime` | `contextEffect` / `context` (no longer an Effect itself) |
| `it.scoped`, `it.scopedLive` (`@effect/vitest`) | `it.effect`, `it.live`: not used here |

Sources: `migration/v3-to-v4.md` ("effect/TestClock", "effect/TestContext", "effect/ManagedRuntime", "Layer.scoped",
"Runtime.runPromise"), `migration/forking.md`, `migration/error-handling.md`, `migration/services.md`.

## 6. Pitfalls

- A forked `sleep` blocks until the test clock reaches it. Without `TestClock.adjust` the test hangs until bun's
  timeout. Fork first, then adjust, then join (`TestClock.ts`: "Fork the effect being tested, then adjust the clock
  time, and finally verify").
- `TestClock.layer()` starts at epoch 0, so `DateTime.now` / `Clock.currentTimeMillis` read 1970 until
  `TestClock.setTime(...)`. `DateTime.nowUnsafe`, `Date.now()` and `new Date()` ignore it: services must read the
  `Clock` (E12 "DateTime/Clock instead of Date") or they cannot be tested.
- `TestClock.make()` built by hand does not install the tracking scheduler; use the layer (`TestClock.ts` gotcha).
- A real timer is needed (a subprocess, a socket, bun's own I/O)? Wrap just that part in `TestClock.withLive(...)`.
- Do not run `Effect.runPromise` for a program that still requires a service: the types stop you; a runtime
  shortcut (`as any`) would die with a missing-service defect.
- Providing the same layer twice builds it once (shared memo map): a test that wants a fresh state per test builds
  a fresh layer per test (`Effect.provide(layer, { local: true })` or `Layer.fresh(layer)`), a shared one uses a
  `ManagedRuntime` per describe.
- `Layer.mock` members you omit are defects, not typed failures; a test that reaches one fails loudly by design.
- Assertions inside `Effect.gen` that throw become defects of the fiber; `runPromise` rejects with the thrown
  error, so `expect(...)` failures still surface as bun failures. Prefer asserting after the run on the returned
  value.
- Console capture covers the Effect `Console` service only (`Console.log`, `Console.error`), not a bare
  `console.log`.
- `TestConsole`, `TestCrypto` and `TestSchema` are `@stability unstable`; `TestClock` is stable.
- The vendored examples are `@effect/vitest` files and do not run here as written; `assert.*` becomes `expect`.

## 7. In this repo

Where it lives:
- `apps/api/test/support/effect.ts`: `runTest(effect, { clock? })`, `runTestExit`, `itEffect`, `recordingMailer`, `withMailer`. They run on the
  APP `runtime` (`apps/api/src/runtime.ts`), the one the routes use, so its `Database` is the shared temp file DB of ADR 0009 and a row a
  test writes through a service is the row `app.request` sees. `clock: "test"` wraps the effect in `Effect.provide(TestClock.layer())`.
  A test file does not assemble these layers itself.
- `apps/api/test/support/bridges/`: the "doors". `src` has no Promise or synchronous twin of an Effect function; a pinned test that still
  calls one (`runMigrations`, `createSession`, `runFinanceBridge`, `nowMs`, the legacy `ApiError` class, ...) imports it from the one file here
  that mirrors its source module, with the same name, signature and calling convention. `apps/api/test/bridges-core.test.ts` and
  `apps/api/test/bridges-modules.test.ts` pin each door against the Effect form it wraps. A door is test support, never imported by
  `src`, `scripts` or the web; a NEW test never needs one, it runs the service with `runTest`.
- `apps/api/test/runtime.test.ts` (the first Effect test) and `apps/api/test/database.test.ts` are the only files that build and dispose a
  THROWAWAY runtime from the real layers (`ManagedRuntime.make(AppLayer)`, its own memo map): safe because `Database.layer` never closes the shared
  client under `NODE_ENV=test`. Never `dispose()` the shared one: every test file shares one process and one runtime.
- `apps/api/test/import-order-effect.test.ts`: per entry a fresh `bun -e` child imports the entry first, then `./src/runtime.ts`, then awaits
  `runtime.runPromise(Effect.void)`, which builds the whole `AppLayer` after that import order.
- `apps/api/test/effect-idioms.test.ts`: the grep gate (one `describe` per rule, a pinned allow list, failures as `file:line: code`, a rule
  self-check and a stale-entry check). It allows `effect/testing`; it forbids `repos/` imports, v3 paths and `effect/unstable/*`.
- `packages/shared/test/*.test.ts` and the co-located `apps/web/src/**/*.test.ts(x)` call the decoders and `Effect.runPromise` directly.

Rule served: E9 (`bun test` stays, no vitest; Effect tests run through layers; the pass count never drops below the previous record) with
E12 (services read `Clock`, so time is testable).

A service test runs the call on the app runtime through `runTest` and reads a refusal with `Effect.flip`; a typed failure rejects with the
error itself, so `toBe(refusal)` holds (`apps/api/test/modules.test.ts`):
```ts
    const enable = (settings: Record<string, unknown> | undefined) =>
      HouseholdModules.use((modules) =>
        modules.enableModule(owner.householdId, "finance", settings, [refusing]),
      );
    expect(await runTest(Effect.flip(enable(undefined)))).toBe(refusal);
    expect(calls).toEqual([{ householdId: owner.householdId, settings: null }]);
    expect(await moduleRow(owner.householdId, "finance")).toBeUndefined();
```

A test against another database hands it in with `Database.withExecutor(db)` (`apps/api/test/import/commit.test.ts`), a finance test with a
private `Database.layerFrom(created)` under `withFinanceServices` (`apps/api/test/finance-services-local.test.ts`: the program reaches that
database from inside the app runtime, never the shared one):
```ts
function onDb<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  return runTest(effect.pipe(Database.withExecutor(db)));
}
const commitDraft = (input: CommitDraftInput) => onDb(ImportCommit.use((s) => s.commitDraft(input)));
```
```ts
function onPrivate<A, E>(
  effect: Effect.Effect<A, E, FinanceParticipants | FinanceSettings | Database>,
): Promise<A> {
  return runTest(withFinanceServices(effect).pipe(Effect.provide(Database.layerFrom(created))));
}
```

Time is the `TestClock`. `apps/api/test/finance-scheduler.test.ts` drives the real 6-hour tick: `TestClock.adjust` makes the tick FIRE, but the
catch-up's database I/O is real and settles after `adjust` returns, so the test polls in real time (`Effect.promise(() => Bun.sleep(...))`, a
bounded number of rounds) instead of asserting right after `adjust`, and a "nothing ran yet" assertion waits a few real rounds first. The whole
fork-adjust-poll sequence is ONE effect inside one `runTest(..., { clock: "test" })` (a new `TestClock` per run), with `stopAccrualSchedule()` in
`Effect.ensuring` and an explicit timeout on the `test(...)`:
```ts
      await runTest(
        Effect.gen(function* () {
          yield* TestClock.setTime(Date.UTC(2026, 9, 15, 8, 59, 36));
          yield* startAccrualSchedule();
        }).pipe(Effect.ensuring(stopAccrualSchedule()), Database.withExecutor(run.target.db)),
        { clock: "test" },
      );
```
A test that pins "now" through the finance seam `setClockForTest(ms)` hands it back in `afterEach` (F gotcha 4: never `mock.module`).

A test seam that stays in `src` (`setMailer`, `resetRateLimits`, `setVerifiedEmailRequired`, `setImportGuardForTests`,
`setImportDbForTests`, `setRemoteImageDownloaderForTests`, `setClockForTest`, listed in `effect-services.md` section 7) is installed in a
`beforeAll` / `withMailer` and handed back in `afterAll`. A test against a real socket opens the SSRF guard for ONE host
(`apps/api/test/import/url-import-local.test.ts`): a `Bun.serve` fixture on `127.0.0.1:0`,
`setImportGuardForTests({ allowHosts: ["127.0.0.1"] })` in `beforeAll`, `setImportGuardForTests(null)` and `server.stop(true)` in `afterAll`, an
explicit `URL_IMPORT_TEST_TIMEOUT_MS` as the third argument of every `test(...)`. Never the `IMPORT_ALLOW_PRIVATE_HOSTS` escape hatch: it skips
every host check.

Golden parity (`packages/shared/test/parity/{core,finance,recipe}.parity.test.ts`, runner `runGolden` in `packages/shared/test/support/schema.ts`):
the JSON under `packages/shared/test/fixtures/schema-golden/` was generated once from Zod 4.5.4 and is never regenerated; each case becomes a
`test`. A known divergence is an id in an allow map with its reason, and the runner fails a listed id that does NOT diverge. Wire pins
(`apps/api/test/validation-wire.test.ts`) drive a real route through `app.request` with a session cookie and `Accept-Language`.

A test that runs `sharp` (`apps/api/test/thumbnails.test.ts`) takes an explicit budget, `SHARP_TEST_TIMEOUT_MS = 60_000`, as the third argument of
`test(...)`; bun's 5 s default fails on a loaded host, and a failing gate log must keep its `(fail)` and `Unhandled error` lines.
