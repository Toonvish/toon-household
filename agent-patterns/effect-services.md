# effect-services: Context.Service, Layer, ManagedRuntime, memo map, Scope (Effect 4.0.5)

Project-local distillation of the vendored source (`repos/effect/`), for an implementer in this repo (Bun 1.4,
`bun test`, Hono until E7, drizzle + `@libsql/client`, TanStack Query on the web). Every name below was grepped
in `repos/effect/packages/effect/src` or `repos/effect/packages/platform/bun/src`. Where a signature matters,
look it up there, not in memory: memory is Effect v3. Spec: `docs/EFFECT.md` E5, E7, E10.

## 1. What it is for, and the imports

A service is a typed slot in a `Context`; a `Layer<ROut, E, RIn>` says how to build it (what it provides, how
construction can fail, what it needs); a `ManagedRuntime` builds a layer once, caches the services and owns the
resources' scope until `dispose`. Behaviour lives in services so it is modular, testable and swappable
(`repos/effect/LLMS.md` "Writing Effect services").

```ts
import { Context, Effect, Layer, ManagedRuntime, Schema, Scope } from "effect"   // all one entry; no @effect/platform
import { BunRuntime } from "@effect/platform-bun"                                // or "@effect/platform-bun/BunRuntime"
```

Identifier strings name the package and path: `"toon/api/core/services/mail/Mailer"`. Two services with the same
string occupy the same slot (`Context.Service` gotcha in `Context.ts`).

## 2. Constructors and call shapes

### 2.1 Service class with a static `layer` (the default shape here)

```ts
export class Database extends Context.Service<Database, {
  query(sql: string): Effect.Effect<Array<unknown>, DatabaseError>
}>()("myapp/db/Database") {
  static readonly layer = Layer.effect(
    Database,
    Effect.gen(function*() {
      const query = Effect.fn("Database.query")(function*(sql: string) {
        yield* Effect.log("Executing SQL query:", sql)
        return [{ id: 1, name: "Alice" }]
      })
      return Database.of({ query })
    })
  )
}
export class DatabaseError extends Schema.TaggedError<DatabaseError>()("DatabaseError", {
  cause: Schema.Defect()
}) {}
export type DatabaseService = Database["Service"]   // the shape, when you need the type
```
Source: `repos/effect/LLMS.md` "Context.Service". Type params first (`<Self, Shape>()`), id string second.

### 2.2 Constructing a service from other services (dependencies)

```ts
const userServiceLayer = Layer.effect(UserService, Effect.gen(function*() {
  const database = yield* Database       // yield the key itself; the dependency shows up in RIn
  const logger = yield* Logger
  return {
    getUser: Effect.fn("UserService.getUser")(function*(id: string) {
      yield* logger.log(`Looking up user ${id}`)
      return yield* database.query(`SELECT * FROM users WHERE id = ${id}`)
    })
  }
}))
const userServiceWithDeps = userServiceLayer.pipe(Layer.provide(Layer.mergeAll(databaseLayer, loggerLayer)))
```
Source: `repos/effect/packages/effect/src/Layer.ts`, example of `provide`. `Layer.provide(dep)` keeps the dependency
private; `Layer.provideMerge(dep)` also exposes it (use it for the root `AppLayer` so tests and scripts can reach
`Database`). `Layer.mergeAll(a, b, c)` / `Layer.merge(a, b)` build independent layers concurrently.

### 2.3 Resources: acquire/release inside a layer

`Layer.effect` removes `Scope` from the requirements (`Exclude<R, Scope.Scope>` in its signature), so a scoped
acquisition is closed when the layer's scope closes (runtime `dispose`, end of `Effect.provide`, `Layer.launch`
interrupted). Signature: `Effect.acquireRelease(acquire, (a, exit) => release, options?)` in `Effect.ts`.

```ts
static readonly layer = Layer.effect(Database, Effect.gen(function*() {
  const client = yield* Effect.acquireRelease(
    Effect.sync(() => createClient({ url })),          // acquire (adapted: our libsql client)
    (client) => Effect.sync(() => client.close())      // release, never fails (error type never)
  )
  return Database.of({ /* … */ })
}))
```
Source: `Effect.ts` `acquireRelease`; `Layer.ts` `effect`. Background work with no service interface:
`Layer.effectDiscard(effect)` (`Layer.ts`); a fork tied to the layer's scope: `Effect.forkScoped`.

### 2.4 Test and static layers

```ts
const testLayer = Layer.succeed(Database, { query: Effect.fn("Database.query")((sql: string) => Effect.succeed([])) })
const partial = Layer.mock(UserService, { config: { apiUrl: "https://test-api.com" }, getUser: (id) => Effect.succeed({ id, name: "Test User" }) })
```
Source: `Layer.ts` `succeed` (curried form `Layer.succeed(Key)(impl)` also exists), `mock` (omitted Effect members die
with an `UnimplementedError`). `Layer.sync(Key, () => impl)` defers a pure value; `Layer.unwrap(effectOfLayer)` builds
a layer chosen by config (mailer: console / smtp / resend); `Layer.suspend(() => layer)` chooses lazily.
`Context.Reference<T>("id", { defaultValue: () => v })` is a service with a default (replaces v3 `FiberRef`).

## 3. Composing, running, providing

### 3.1 Providing to an effect

```ts
const main = program.pipe(Effect.provide(AppLayer))        // compose first, provide once
await Effect.runPromise(main)
Effect.provide(layer, { local: true })                     // build with a fresh memo map (test isolation)
```
Source: `Effect.ts` `provide` (options `{ local?: boolean }`); `repos/effect/migration/layer-memoization.md`.
Reading a service: `yield* Service` (explicit dependency, preferred) or `Service.use((s) => s.method(x))` /
`Service.useSync((s) => s.field)`.

### 3.2 One ManagedRuntime for non-Effect code (Hono handlers, scripts, web `queryFn`s)

```ts
export const appMemoMap = Layer.makeMemoMapUnsafe()
export const runtime = ManagedRuntime.make(TodoRepo.layer, { memoMap: appMemoMap })

app.get("/todos", async (context) => {
  const todos = await runtime.runPromise(TodoRepo.use((repo) => repo.getAll))
  return context.json(todos)
})

const shutdown = () => { void runtime.dispose() }
process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
```
Source: `repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts`. The runner family on the runtime
(`ManagedRuntime.ts`): `runPromise`, `runPromiseExit`, `runSync`, `runSyncExit`, `runFork`, `runCallback`,
`dispose()`, `disposeEffect`, `context()`; `ManagedRuntime.isManagedRuntime(x)` is the guard. The layer is built
lazily on the first run and the context cached; `ManagedRuntime.make` takes a `Layer<R, ER, never>` (every
requirement already provided).

### 3.3 Process entry: scripts and the server

```ts
BunRuntime.runMain(program.pipe(Effect.provide(AppLayer)))             // scripts (E10); options: disableErrorReporting, teardown
BunRuntime.runMain(Layer.launch(AppLayer))                             // a program that is only a layer; interrupt closes it
```
Source: `repos/effect/packages/platform/bun/src/BunRuntime.ts` (`runMain`); `Layer.ts` `launch` (builds the layer and
keeps it alive until interrupted, finalizers run on interrupt). `runMain` handles SIGINT/SIGTERM and exit codes;
the exit codes `docs/migration.md` pins (0/1/2) are set explicitly in the script, not left to the default.

## 4. Error handling

- A layer's `E` is a construction failure (bad config, unreachable DB). `Layer.orDie` turns it into a defect;
  `Layer.catchTag("ConfigError", () => fallbackLayer)`, `Layer.catch(...)` and `Layer.catchCause(...)` recover by
  switching layers (`Layer.ts`). Config errors at boot should stay fatal: keep `E` in the type until `runMain`.
- Service methods declare failures in the type (`Effect<A, NotFound | Forbidden>`) with `Schema.TaggedError`
  classes; raise with `return yield* new NotFound({ id })`; recover with `Effect.catchTag("NotFound", ...)`,
  `Effect.catchTags({ A: ..., B: ... })` or the array form `Effect.catchTag(["A", "B"], ...)`, never `instanceof`.
  `Effect.catch` recovers all typed errors; `Effect.catchCause` also sees defects. (`LLMS.md` "Error handling".)
- Defects (`Effect.die`, thrown exceptions, `orDie`) are bugs, not API errors. At the runtime edge prefer
  `runtime.runPromiseExit(effect)` and inspect: `Exit.isSuccess` / `Exit.isFailure`, then on `exit.cause`
  `Cause.findError(cause)` (a `Result` of the typed error), `Cause.hasDies(cause)`, `Cause.pretty(cause)`
  (log it in English). `runPromise` rejects on the first failure, which loses that split. A run on a
  runtime after `dispose` dies with `"ManagedRuntime disposed"`.
- Layer construction errors surface as the `ER` of every run on the runtime, at the first run (lazy build).

## 5. v3 to v4 renames that bite here

| v3 | v4 |
| --- | --- |
| `Context.Tag("X")<Self, S>()` / `Effect.Tag` | `Context.Service<Self, S>()("X")` (type params first, id second) |
| `Context.GenericTag<T>("X")` | `Context.Service<T>("X")` |
| `Effect.Service<Self>()("X", { effect, dependencies })` and generated `.Default` | `Context.Service<Self>()("X", { make })` plus an explicit `static layer = Layer.effect(this, this.make).pipe(Layer.provide(Dep.layer))`; no `dependencies`, no auto layer |
| static accessors `Notifications.notify("hi")` | `yield* Notifications` or `Notifications.use((n) => n.notify("hi"))`; generics survive |
| `Context.Reference<Self>()("X", opts)` | `Context.Reference<T>("X", { defaultValue: () => v })` |
| layer names `Default` / `Live` | `layer` (variants `layerTest`, `layerConfig`) |
| `Effect.catchAll` / `catchAllCause` | `Effect.catch` / `Effect.catchCause` |
| `Scope.extend(effect, scope)` | `Scope.provide(effect, scope)` (also `effect.pipe(Scope.provide(scope))`) |
| `Runtime<R>`, `Runtime.runFork(rt)` | `Effect.runForkWith(services)`; `ManagedRuntime` unchanged in spirit |
| layers memoized per `Effect.provide` call | memo map shared across `provide` calls; opt out with `Layer.fresh` or `provide(l, { local: true })` |
| `Context.get(ctx, tag)`, `Context.add(ctx, tag, impl)` | same names; the first argument is now called `map` (unchanged call shape) |

Sources: `repos/effect/migration/services.md`, `layer-memoization.md`, `scope.md`, `error-handling.md`, `runtime.md`.

## 6. Pitfalls

- **Prefer `yield*` over `use`.** `use` hides the dependency at the call site and makes it easy to leak a service
  requirement into a return value (`migration/services.md`).
- **Layers are memoized by reference.** Reuse one named layer value (one `Database.layer` constant) so a pool is
  built once; calling a layer factory twice builds two (`Layer.ts` `mergeAll`: "reuse a named layer value").
  `Layer.fresh` and `{ local: true }` are for deliberate isolation, e.g. one DB per test file (ADR 0009 stays in force).
- **Share the memo map.** A `ManagedRuntime` made without `memoMap` gets its own; pass `appMemoMap` when scripts,
  tests and the server runtime must share layers (`10_managed-runtime.ts`).
- **Dispose the runtime** on SIGTERM/SIGINT: that closes the layer scope (libsql client, background forks); it cannot
  be reused after disposal. Keep the signal handlers in one place (today `apps/api/src/index.ts` calls each module's
  `shutdown`; E7 turns those into finalizers).
- **No module-scope runs.** Layers are values; do not call
  `runtime.run*` or read the module registry at import time (CLAUDE.md "API import cycle"). A manifest may hold a
  `layer` value, never a core middleware call.
- **Do not wrap `Effect.gen` in a function that only returns it**; use `Effect.fn("Service.method")` (traced) or
  `Effect.fnUntraced` (hot paths). Extra behaviour goes in as further arguments of `Effect.fn`, never `.pipe` on it.
- **`runSync` throws on async work.** Use it only at pure edges; `runCallback(effect, { onExit })` returns an
  interrupt function for callback-only APIs.
- **Always `return yield*` when raising**, so TypeScript knows the generator stops.
- **A layer that needs `Scope` but is provided with `Effect.provide`** lives as long as that effect; for the process
  lifetime build it into the runtime (`ManagedRuntime.make`) or `Layer.launch`.
- Never `Layer.succeed` a mutable singleton you also close elsewhere; acquire it in `Layer.effect` with
  `acquireRelease` so one scope owns it.

## 7. In this repo

Where it will be applied:

- `apps/api/src/config.ts` (`AppConfig`), `apps/api/src/db/client.ts` (`Database`: scoped layer, D7 pragmas, closed by
  the runtime scope), `apps/api/src/core/services/**` and `apps/api/src/modules/<id>/services/**` (one
  `Context.Service` class with a static `layer` per service), `apps/api/src/runtime.ts` (`AppLayer` via
  `Layer.mergeAll` / `Layer.provideMerge`, ONE `ManagedRuntime.make(AppLayer, { memoMap })`, disposed from the
  SIGTERM/SIGINT handlers), the module manifests (`layer` field), `apps/api/scripts/*.ts` (`BunRuntime.runMain`), and
  `apps/api/test/support/effect.ts` (`runTest` = `Effect.provide` of the test `AppLayer`, `Layer.mock` for fakes).
- `apps/web/src/lib/runtime.ts`: the web's single `ManagedRuntime` behind `queryFn` / `mutationFn` (E11).

Rule it serves: **E7**, "Every service module is a `Context.Service` class with a static `layer`, one
`ManagedRuntime` per process, handlers call `runtime.runPromise(...)` until E7 replaces Hono", with **E5** (the
`Database` service owns the client and is closed by the runtime's scope) and E12 (`Context.Service` + static `layer`,
`Effect.fn("Service.method")`, `Effect.catchTag(s)`).
