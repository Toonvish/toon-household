# effect-core: Effect values, generators, functions, errors, Exit and Cause (Effect 4.0.5)

Distilled from the vendored source only (`repos/effect/LLMS.md`, `repos/effect/ai-docs/src/01_effect/`,
`repos/effect/packages/effect/src/Effect.ts`, `repos/effect/migration/{yieldable,cause,generators,error-handling,forking}.md`).
Every name below was grepped in `repos/effect/packages/effect/src`. Look signatures up there, never from memory:
your memory of Effect is v3.

## 1. What it is for, and the imports

An `Effect<A, E, R>` is a lazy description of work that succeeds with `A`, fails with a typed `E`, and needs services `R`.
Use it for what is fallible, asynchronous, resourceful or needs a dependency. Pure functions stay plain functions.

```ts
import { Cause, Effect, Exit, Option, Predicate, Result, Schema } from "effect"
```

- One package, `effect`, with flat module paths (`effect`, `effect/http`, ...). No `@effect/platform`, no
  `effect/unstable/*`. The Bun entry point is `import { BunRuntime } from "@effect/platform-bun"`
  (`packages/platform/bun/src/BunRuntime.ts`, `runMain`).
- Type extractors: `Effect.Success<T>`, `Effect.Error<T>`, `Effect.Services<T>` (`Effect.ts`). The generator return
  annotation is `Effect.fn.Return<A, E, R>` (`Effect.gen.Return` exists too).

## 2. Constructors and the call shapes this repo uses

Shape 1, inline code with `Effect.gen`, raising with `return yield*`:

```ts
Effect.gen(function*() {
  yield* Effect.log("Reading file...")
  // Always return when raising an error, so TypeScript knows the function stops.
  return yield* new FileProcessingError({ message: "Failed to read the file" })
}).pipe(
  Effect.catch((error) => Effect.logError(`An error occurred: ${error}`)),
  Effect.withSpan("fileProcessing")
)
```
(`repos/effect/ai-docs/src/01_effect/01_basics/01_effect-gen.ts`)

Shape 2, a reusable function: `Effect.fn("Name")` traced, `Effect.fnUntraced` on hot paths. Combinators are extra
ARGUMENTS after the generator, never `.pipe` on the result of `Effect.fn`:

```ts
export const effectFunction = Effect.fn("effectFunction")(
  function*(n: number): Effect.fn.Return<string, SomeError> {
    yield* Effect.logInfo("Received number:", n)
    return yield* new SomeError({ message: "Failed to read the file" })
  },
  Effect.catch((error) => Effect.logError(`An error occurred: ${error}`)),
  Effect.annotateLogs({ method: "effectFunction" })
)

export const validateBatchSize = Effect.fnUntraced(function*(size: number): Effect.fn.Return<number, SomeError> {
  if (!Number.isInteger(size) || size <= 0) {
    return yield* new SomeError({ message: "Batch size must be a positive integer" })
  }
  return size
})
```
(`.../01_basics/02_effect-fn.ts`. `Effect.fn(name, options?)`, `Effect.fn("Name")({ self }, body)` and the `Effect.fn(body)`
unnamed form are in `Effect.ts` around line 13895.)

Shape 3, lifting the fallible outside world (a thrown error or a rejected promise becomes a typed error):

```ts
export const parsePayload = Effect.fn("parsePayload")((input: string) =>
  Effect.try({
    try: () => JSON.parse(input) as { readonly userId: number },
    catch: (cause) => new InvalidPayload({ input, cause })
  })
)

export const fetchUser = Effect.fn("fetchUser")((userId: number) =>
  Effect.tryPromise({
    async try() { /* a Promise API: a drizzle query, fetch, sharp, ... */ },
    catch: (cause) => new UserLookupError({ userId, cause })
  })
)
```
(`.../01_basics/10_creating-effects.ts`.) Passing the bare thunk, `Effect.try(() => ...)` or
`Effect.tryPromise(() => ...)`, fails with `Cause.UnknownError`; always pass `{ try, catch }` in this repo.
`tryPromise`'s thunk receives an `AbortSignal` (`Effect.ts` line 990).

Shape 4, small constructors, same file:

```ts
Effect.succeed({ env: "prod", retries: 3 })      // a value you already have
Effect.sync(() => Date.now())                    // synchronous, cannot throw
Effect.fromNullishOr(requestHeaders.get("x-workspace-id")).pipe(
  Effect.mapError(() => new MissingWorkspaceId())  // null/undefined -> NoSuchElementError
)
Effect.callback<number>((resume) => {            // callback APIs; return a finalizer
  const id = setTimeout(() => resume(Effect.succeed(200)), 10)
  return Effect.sync(() => clearTimeout(id))
})
```
Also `Effect.fail(e)`, `Effect.die(defect)`, `Effect.promise(() => p)` (promise that never rejects).

## 3. Composing, converting, running

- Sequencing: `Effect.map(f)`, `Effect.flatMap(f)`, `Effect.andThen(f | effect)`, `Effect.tap(f)` (keeps the original
  value), `Effect.as(v)`, `Effect.asVoid`. Each has a data-first and a data-last form. Prefer `yield*` in a generator.
- Collections: `Effect.forEach(iterable, f, { concurrency, discard })`, `Effect.all([...] | { k: eff }, options)`.
  Default is sequential.
- Option and Result are plain values, NOT Effects. Convert explicitly (`migration/yieldable.md`):

```ts
const n = yield* Effect.fromOption(Option.some(42))               // NoSuchElementError on None
const m = yield* Effect.fromOption(Option.none(), () => "missing") // custom error
const r = yield* Effect.fromResult(Result.succeed(123))
```
  `Option.gen` and `Result.gen` exist for generator code inside those types. `Config` and `Context.Service` classes
  remain yieldable.
- Reifying the outcome: `Effect.result(self)` gives `Effect<Result<A, E>>`, `Effect.option(self)` gives `Option<A>`,
  `Effect.exit(self)` gives `Effect<Exit<A, E>>`, `Effect.flip(self)` swaps the channels (tests). None of the
  first three captures defects (`option`, `result`) or interrupts; only `exit` carries the whole `Cause`.
- Running at the edge only: `Effect.runPromise`, `Effect.runPromiseExit`, `Effect.runSync`, `Effect.runSyncExit`,
  and the `...With(context)` variants (`runPromiseWith`, `runForkWith`). Inside the app everything runs on the
  one runtime of E7; do not call `runPromise` inside a service.
- Providing: `Effect.provide(layer)`, `Effect.provideService(Tag, impl)` (see `effect-services`).

## 4. Error handling

- Typed failures live in `E` and are recoverable. Define them with `Schema.TaggedError` (a yieldable class):

```ts
export class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
  input: Schema.String,
  message: Schema.String
}) {}
```
  `Schema.Error<Self>("Name")({...})` is the untagged variant; `Data.TaggedError("Tag")<{...}>` (`Data.ts`) is the
  non-schema one. Use `Schema.Defect()` for a `cause` field. (`.../04_errors/01_error-handling.ts`)
- Recover by tag, never `instanceof`. `catchTag` takes one tag or an array of tags; `catchTags` an object:

```ts
loadPort("80").pipe(
  Effect.catchTag(["ParseError", "ReservedPortError"], (_) => Effect.succeed(3000))
)
fetchUser("123").pipe(
  Effect.catchTags({
    ValidationError: (error) => Effect.succeed(`Validation failed: ${error.message}`),
    NetworkError: (error) => Effect.succeed(`Network request failed with status ${error.statusCode}`)
  })
)
```
  (`.../04_errors/01_error-handling.ts`, `10_catch-tags.ts`.) Also `Effect.catch` (all typed errors),
  `Effect.catchIf(predicate, f)`, `Effect.catchFilter(Filter.tagged("NotFound"), f)`, `Effect.mapError`,
  `Effect.tapError`, `Effect.orElseSucceed`.
- Nested reasons (`.../20_reason-errors.ts`): `Effect.catchReason("AiError", "RateLimitError", handler)`,
  `Effect.catchReasons`, `Effect.unwrapReason("AiError")`.
- Defects are bugs, not part of `E`: `Effect.die(x)`, a throw inside `Effect.sync`, `Effect.orDie(self)` (turns a typed
  failure into a defect). `Effect.catch` and `catchTag` do NOT see defects. Defects are handled only at the boundary:
  `Effect.catchDefect(f)` or `Effect.catchCause(f)`, `Effect.tapCause`.
- What reaches the boundary: `Effect.runPromise` rejects with the squashed cause (`internal/effect.ts` `causeSquash`):
  the first typed error itself, else the first defect, else an `Error`. `Effect.runPromiseExit` / `Effect.exit` give
  an `Exit`; inspect it with `Exit.isSuccess`, `Exit.isFailure`, `Exit.match({ onSuccess, onFailure })`,
  `Exit.findError` (a `Result`), then the `Cause`:
  `cause.reasons` is a flat array of `Fail | Die | Interrupt`; `Cause.hasFails`, `Cause.hasDies`,
  `Cause.findErrorOption`, `Cause.findDefect`, `Cause.squash`, `Cause.pretty(cause)` for a log line.

## 5. v3 to v4 renames that bite here

| v3 | v4 |
| --- | --- |
| `Effect.catchAll` / `catchAllCause` / `catchAllDefect` | `Effect.catch` / `catchCause` / `catchDefect` |
| `Effect.catchSome` / `catchSomeCause` | `Effect.catchFilter` / `catchCauseFilter` (with `Filter`) |
| `Effect.tapErrorCause` | `Effect.tapCause` |
| `Effect.either` / `Either` | `Effect.result` / `Result` (`Result.succeed`, `Result.fail`) |
| `Effect.async` / `asyncEffect` | `Effect.callback` (cleanup may be an Effect) |
| `Effect.fork` / `forkDaemon` | `Effect.forkChild` / `forkDetach` (`forkScoped`, `forkIn` unchanged) |
| `Effect.gen(this, fn)` | `Effect.gen({ self: this }, fn)` |
| `Effect.fromNullable` | `Effect.fromNullishOr` (or `Effect.fromOption` of `Option.fromNullishOr`) |
| `Effect.zipRight` / `zipLeft` | `Effect.andThen` / `Effect.zip` + `Effect.map` |
| `Effect.dieMessage` | `Effect.die(new Error(...))` |
| `Effect.runtime` + `Runtime.runFork` | `Effect.context` + `Effect.runForkWith` |
| Option, Either, Ref, Deferred, Fiber are Effects | plain values: `Effect.fromOption`, `Effect.fromResult`, `Ref.get`, `Deferred.await`, `Fiber.join` |
| `Cause` tree (`Sequential`, `Parallel`, `Empty`) | flat `cause.reasons`; `isFailType` becomes `Cause.isFailReason`, `isFailure` becomes `Cause.hasFails`, `failureOption` becomes `Cause.findErrorOption`, `sequential`/`parallel` become `Cause.combine` |
| `Cause.NoSuchElementException`, `TimeoutException`, `UnknownException` | `Cause.NoSuchElementError`, `TimeoutError`, `UnknownError` (guards `isNoSuchElementError` ...) |
| `Effect.Tag`, `Context.Tag`, `Effect.Service` | `Context.Service` (see `effect-services`) |

(`migration/error-handling.md`, `cause.md`, `yieldable.md`, `forking.md`, `generators.md`, `runtime.md`, and the
per-symbol list in `migration/v3-to-v4.md`.)

## 6. Pitfalls

- Do not write a function that only wraps and returns an `Effect.gen`; use `Effect.fn` / `Effect.fnUntraced`.
- Do not `.pipe` on the result of `Effect.fn`; pass the combinators as further arguments.
- Raise with `return yield* new MyError(...)`, not `yield*` alone, or TypeScript thinks execution continues.
- You cannot `yield*` an `Option` or `Result` in `Effect.gen`: convert with `Effect.fromOption` / `Effect.fromResult`.
- If the `catch` callback of `Effect.try` / `Effect.tryPromise` itself throws, that value is a defect. Return the
  error, never throw it.
- `Effect.catch` does not recover from defects or interrupts; `Effect.result` / `Effect.option` do not capture them.
- `Effect.runSync` cannot run an asynchronous effect; `runPromise` rejects with the raw squashed error, not a wrapper.
- Never write `isRecord` / `isString` helpers: `Predicate.isObject`, `Predicate.isString`, `Predicate.isNumber`,
  `Predicate.isNullish`, `Predicate.isTagged`, `Predicate.and` / `or` / `not` (`Predicate.ts`).
- Use `Schema` to parse untrusted data, `DateTime` / `Clock` instead of `Date.now()` in services (LLMS.md).
- The comments in the vendored examples are illustration only; do not copy them into application code.

## 7. In this repo

- Applied first in `apps/api/src/runtime.ts` and `apps/api/src/lib/errors.ts` (E0, E2), then every
  `apps/api/src/core/services/**` and `apps/api/src/modules/<id>/services/**` function (E2 to E4), the
  `apps/api/scripts/*.ts` programs (E5) and `apps/web/src/lib/runtime.ts` (E6).
- Rules served: E12 (`Effect.gen` inline, `Effect.fn("Service.method")` / `Effect.fnUntraced`, `return yield*`,
  `Effect.catchTag(s)` instead of `instanceof`, Predicate instead of hand-written guards), pinned by
  `apps/api/test/effect-idioms.test.ts`; and E6 (typed `Schema.TaggedError` failures, defects logged and answered
  as `500 internal_error`).

**As built (E0):** `apps/api/src/core/health.ts` is the first Effect code of the repo: `healthResponse` is a plain
`Effect.gen(function* () { ... })` constant (no service dependency yet, so no `Effect.fn`), it reads the module
registry and the feature flags INSIDE the generator (never at module scope, the API import cycle) and takes its time
from `DateTime.formatIso(yield* DateTime.now)`. `DateTime.formatIso` is `Date#toISOString` of the UTC instant
(`repos/effect/packages/effect/src/DateTime.ts`, `Internal.formatIso`), so moving from `new Date().toISOString()` kept
the wire format. The route is `c.json(await runtime.runPromise(healthResponse))` in `apps/api/src/index.ts`; the
`async` shutdown handler there is plain `await`, since only `runtime.dispose()` is Effect-owned at E0.

**As built (E1):** E1 runs no `Effect` in the API; the core value it uses is `Option` / `Result`, because a decode at an edge
that ignores or inspects its failure is synchronous. `apps/api/src/lib/oauth.ts` builds the decoder once with
`Schema.decodeUnknownOption(...)` and unwraps it with `Option.getOrUndefined` (a provider payload that is not that shape is
`undefined`, never a throw):
```ts
const decodeGoogleClaims = Schema.decodeUnknownOption(GoogleClaimsSchema);
export function parseGoogleClaims(raw: unknown): typeof GoogleClaimsSchema.Type | undefined {
  return Option.getOrUndefined(decodeGoogleClaims(raw));
}
```
`apps/api/src/modules/recipe/services/import/drafts.ts` does the same with `Option.getOrElse(decodeOption(Schema, row), () => fallback)`.
The web, which has no throw-and-catch boundary, uses `Schema.decodeUnknownResult` and `Result.isSuccess`
(`apps/web/src/lib/validation.ts`: `decoded.success` on the happy arm, `decoded.failure.issue` on the other). A
`Result` has `success` / `failure`, not v3's `right` / `left`. `Effect` itself is touched only where a schema API asks for
one (`Schema.withDecodingDefault(Effect.succeed("member" as const))`, a default is an `Effect`).
