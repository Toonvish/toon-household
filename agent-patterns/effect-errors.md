# effect-errors: typed failures, defects, recovery (Effect 4.0.5)

Distilled from the vendored source only (`repos/effect/LLMS.md` "Error handling", `repos/effect/migration/error-handling.md`,
`repos/effect/migration/cause.md`, `repos/effect/packages/effect/src/Effect.ts`, `Cause.ts`, `Exit.ts`, `Filter.ts`).
Look a signature up there before using it. Your memory of Effect is v3; section 5 lists what changed.

## 1. What this is for, and the imports

Every `Effect<A, E, R>` has a typed failure channel `E` (expected, recoverable, part of the signature) and, besides it, defects
(bugs, thrown exceptions, `Effect.die`), which are NOT in `E`. `Cause<E>` is the full record of how an effect ended; `Exit<A, E>` is
success or a `Cause`. In this repo `E` carries the API's tagged error family (E6); defects become `500 internal_error`.

```ts
import { Cause, Data, Effect, Exit, Filter, Option, Predicate, Result, Schema } from "effect"
```

All of these are root exports of `effect` (v4: no `@effect/platform`, no `effect/unstable/*`). `Effect.catch` and `Effect.try` are
reserved-word exports, written exactly like that (`Effect.catch(...)`).

## 2. Constructors and the call shapes this repo uses

Define errors with `Schema.TaggedError` (class, yieldable, `_tag` filled in; it is what E6 and E12 require):

```ts
export class ReservedPortError extends Schema.TaggedError<ReservedPortError>()("ReservedPortError", {
  port: Schema.Int
}) {}
```
(`repos/effect/LLMS.md` "Error handling basics"; signature `Schema.TaggedError` in `packages/effect/src/Schema.ts`.) The first type
argument is the class itself; omitting it is a type error (`MissingSelfGeneric`). Fields are a struct-fields object or a `Schema.Struct`.

Raise with `return yield*` inside a generator, so TypeScript sees that control stops:

```ts
export const validateBatchSize = Effect.fnUntraced(function*(size: number): Effect.fn.Return<number, SomeError> {
  if (!Number.isInteger(size) || size <= 0) {
    return yield* new SomeError({ message: "Batch size must be a positive integer" })
  }
  return size
})
```
(`repos/effect/LLMS.md` "Using Effect.fn and Effect.fnUntraced".) Without a generator: `Effect.fail(new SomeError({ ... }))`.

Wrap code that throws or rejects, mapping the cause into a tagged error (no `catch` means `Cause.UnknownError`):

```ts
const getTodo = (id: number) =>
  Effect.tryPromise({
    try: () => Promise.reject(`Todo ${id} is unavailable`),
    catch: (cause) => new TodoFetchError({ cause })
  })
// Effect.try({ try: () => JSON.parse(input), catch: (cause) => new JsonParsingError({ cause }) }) for sync code
```
(`Effect.ts`, docs of `tryPromise` and `try`.) A `cause: unknown` field is declared `Schema.Defect()` in a Schema error
(`repos/effect/LLMS.md` `DatabaseError`). `Data.TaggedError("X")<{ ... }>` is the schema-less variant; this repo uses `Schema.TaggedError`.

Defects: `Effect.die(defect)` (a bug, never in `E`) and `Effect.orDie(effect)`, which turns every typed failure into a defect and
returns `Effect<A, never, R>`.

## 3. Composing: recovering, translating, observing

```ts
export const recovered = loadPort("80").pipe(
  Effect.catchTag(["ParseError", "ReservedPortError"], (_) => Effect.succeed(3000))   // several tags, one handler
)
export const withFinalFallback = loadPort("invalid").pipe(
  Effect.catchTag("ReservedPortError", (_) => Effect.succeed(3000)),                 // one tag
  Effect.catch((_) => Effect.succeed(3000))                                          // whatever typed error is left
)
```
(`ai-docs/src/01_effect/04_errors/01_error-handling.ts`.)

```ts
export const userOrFallback = fetchUser("123").pipe(
  Effect.catchTags({
    ValidationError: (error) => Effect.succeed(`Validation failed: ${error.message}`),
    NetworkError: (error) => Effect.succeed(`Network request failed with status ${error.statusCode}`)
  })
)
```
(`ai-docs/src/01_effect/04_errors/10_catch-tags.ts`.) `catchTags` keys must be tags present in `E` (extra keys are a type error); an
optional second argument `orElse` handles every tag you did not list; without it the unlisted ones stay in `E`.

Reasons (a tagged error whose `reason` field is a union of tagged errors):

```ts
callModel.pipe(Effect.catchReason("AiError", "RateLimitError", (reason) => Effect.succeed(`Retry after ${reason.retryAfter} seconds`)))
callModel.pipe(Effect.unwrapReason("AiError"), Effect.catchTags({ /* one handler per reason tag */ }))
```
(`ai-docs/src/01_effect/04_errors/20_reason-errors.ts`; also `Effect.catchReasons("AiError", { Tag: handler })`.)

Other combinators, each with its source signature in `Effect.ts`:

- `Effect.mapError(effect, (e) => other)`: translate the error type (e.g. a driver error to `DatabaseError`); `Effect.mapBoth` does both channels.
- `Effect.catchIf(refinementOrPredicate, f, orElse?)` and `Effect.catchFilter(Filter.tagged("NotFound"), f)` for a condition that is not a plain tag.
- `Effect.tapError(f)` / `Effect.tapCause(f)` / `Effect.tapDefect(f)`: run a side effect (log) and keep the failure unchanged.
- `Effect.orElseSucceed(f)`: replace any typed failure with a value; `Effect.ignore`: drop the failure, returns `void`.
- `Effect.flip` swaps success and failure (the usual way to assert an error in a test: `Effect.runPromise(Effect.flip(program))`).
- `Effect.exit(effect)`, `Effect.result(effect)`, `Effect.option(effect)`: reify the outcome into the success channel (error type `never`).

## 4. Error handling: failures vs defects, and the boundary

- **Typed failure (`E`)**: expected, domain-level, recoverable by the caller: not found, forbidden, conflict, validation, quota. Declare it in
  the signature (`Effect.Effect<A, NotFound | Forbidden>`) and recover with `Effect.catchTag` / `Effect.catchTags`, never `instanceof` (E6, E12).
- **Defect**: a bug or a broken invariant (null where the schema promised a value, a failed assertion). Not in `E`; `Effect.catch`,
  `catchTag` and `catchTags` do NOT see it. Only `Effect.catchCause`, `Effect.catchDefect`, `Effect.tapDefect`, `Effect.exit` and the runners do.
  Do not recover from a defect to keep going; log it and answer a 500 at the edge.
- **Cause**: v4 `Cause<E>` is `{ reasons: ReadonlyArray<Fail<E> | Die | Interrupt> }`, flat. Inspect with `Cause.hasFails`, `Cause.hasDies`,
  `Cause.hasInterruptsOnly`, `Cause.findErrorOption(cause)` (`Option<E>`), `Cause.isFailReason(reason)`, `Cause.isDieReason(reason)`;
  render for a log with `Cause.pretty(cause)`; `Cause.squash(cause)` gives the one `unknown` value (error or defect) to report.
- **The boundary** runs the effect with `runtime.runPromiseExit(effect)` (`ManagedRuntime`) or `Effect.runPromiseExit` and reads the `Exit`,
  instead of letting `runPromise` reject:

```ts
const exit = await runtime.runPromiseExit(handler)
return Exit.match(exit, {
  onSuccess: (value) => ok(value),
  onFailure: (cause) => {
    const failure = Cause.findErrorOption(cause)       // typed family: map once to status + code + text (E6)
    return Option.isSome(failure) ? errorResponse(failure.value) : internalError(Cause.pretty(cause))   // defect: log in English, 500
  }
})
```
(Adapted from `Exit.match` in `Exit.ts`, `Cause.findErrorOption` in `Cause.ts`, `ManagedRuntime.runPromiseExit`.)
Inside the program, translate third-party errors at the edge of each service (`mapError`) so the union that reaches the boundary is only the
tagged family.

## 5. v3 to v4 renames that bite

| v3 | v4 |
| --- | --- |
| `Effect.catchAll` | `Effect.catch` |
| `Effect.catchAllCause` | `Effect.catchCause` |
| `Effect.catchAllDefect` | `Effect.catchDefect` |
| `Effect.catchSome` (returned `Option<Effect>`) | `Effect.catchFilter(Filter.fromPredicate(...), f)` |
| `Effect.catchSomeCause` | `Effect.catchCauseFilter` |
| `Effect.catchSomeDefect` | removed |
| `Effect.catchTag`, `catchTags`, `catchIf` | unchanged (`catchTag` also takes an array of tags) |
| `Cause` as a recursive tree (`Empty`, `Sequential`, `Parallel`) | flat `cause.reasons` of `Fail | Die | Interrupt` |
| `Cause.isFailure`, `isDie`, `isInterrupted` | `Cause.hasFails`, `hasDies`, `hasInterrupts` |
| `Cause.isFailType(c)` etc. | `Cause.isFailReason(reason)`, `isDieReason`, `isInterruptReason` |
| `Cause.failureOption`, `dieOption` | `Cause.findErrorOption`, `Cause.findDefect` (returns `Result`, not `Option`) |
| `Cause.sequential(a, b)`, `Cause.parallel(a, b)` | `Cause.combine(a, b)` |
| `Cause.TimeoutException`, `NoSuchElementException`, `UnknownException` | `Cause.TimeoutError`, `NoSuchElementError`, `UnknownError` (all `*Exception` are `*Error`) |
| `Either` | `Result` (`Effect.result`, `Result.isFailure`) |

New in v4: `Effect.catchReason`, `Effect.catchReasons`, `Effect.unwrapReason`, `Effect.catchEager`, `Cause.fromReasons`, `Cause.annotate`, `Cause.Done`.
Source: `migration/error-handling.md`, `migration/cause.md`.

## 6. Pitfalls

- **`Effect.catch` does not catch defects** (`Effect.ts` doc: "will not recover from unrecoverable defects"). A thrown exception inside
  `Effect.sync`, or an `Effect.die`, passes through every `catchTag(s)`. Wrap fallible JS with `Effect.try` / `Effect.tryPromise` so it becomes a typed failure.
- **Always `return yield* new MyError(...)`**, never a bare `yield*`; otherwise TypeScript thinks the code after it runs (LLMS.md).
- **`Effect.tryPromise(() => ...)` without `catch` fails with `Cause.UnknownError`**, which is a typed failure but carries no domain meaning: map it.
- **`catchTags` rejects tags that are not in `E`** at compile time; a handler for a tag the effect cannot raise is a bug, not a no-op.
- **`catchTag` with no `orElse` leaves the other tags in `E`**; with `orElse` (or a final `Effect.catch`) they are consumed. Do not
  swallow with a blanket `Effect.catch` where one `catchTags` and the compiler would have shown you the unhandled case.
- **`tapError` keeps the failure and adds the tap's own failure to `E`**; use it for logging, not recovery.
- **Do not use `.pipe` on `Effect.fn`**; pass combinators as extra arguments (`Effect.fn("name")(function*(){...}, Effect.catch(...))`) (LLMS.md).
- **`findError` / `findDefect` return `Result`**, `findErrorOption` returns `Option`; do not mix them up when porting v3 `failureOption`.
- **`Schema.Defect()` is a function call** (`cause: Schema.Defect()`), a JSON-safe carrier for an unknown cause, not a schema for every JS value.
- **`Effect.orDie` on a recoverable domain error hides it from the type**; reserve it for failures that really are invariant violations.
- Never `try`/`catch` around a `yield*` for typed failures, and never compare `_tag` by hand where `catchTag` or `Predicate.isTagged` exists.

## 7. In this repo

- `apps/api/src/lib/errors.ts`: today's `ApiError` (a class with `status`, `code`, `text`, `toBody(locale)`, static helpers, thrown and caught by
  Hono's `onError`). E2 turns it into a family of `Schema.TaggedError` classes with the same `status`, `code`, `text`, plus one `toApiError` /
  `errorBody` mapper at the HTTP boundary (`ERROR_CODES` in `packages/shared` stays the wire contract; "As built (E2)" below).
- `apps/api/src/core/services/**` and `apps/api/src/modules/<id>/services/**`: methods are `Effect.fn("Service.method")` with the failures in
  the signature; handlers recover with `Effect.catchTag(s)`. `apps/api/src/runtime.ts` (E0, new) is where `runPromiseExit` meets Hono until E7.
- `apps/api/test/effect-idioms.test.ts` (E0, new) pins "no `throw new ApiError`" after E2 and "no `Context.Tag(`".
- Tests assert a failure with `Effect.flip` or `Effect.exit` + `Exit.isFailure`; a defect shows up as `Cause.hasDies`.

Rule served: **E6** ("Errors are tagged, typed and mapped once"; defects logged in English and answered as the same `500 internal_error`;
handlers `Effect.catchTag(s)`, never `instanceof`), with **E12** for the idioms (`Schema.TaggedError`, `return yield*`).

**As built (E0):** there is no tagged error in the repo yet (`ApiError` is untouched until E2). What E0 proves is the
defect side: after `ManagedRuntime.dispose`, `runPromise` REJECTS with the plain string `"ManagedRuntime disposed"`
(the squashed `Effect.die`, not an `Error`, so `instanceof Error` is false), while `runPromiseExit` resolves to
`Exit.isFailure(exit)` with `Cause.hasDies(exit.cause)` and `Cause.squash(exit.cause) === "ManagedRuntime disposed"`
(`apps/api/test/runtime.test.ts`, test d). The E6 boundary mapper must therefore treat a non-`Error` rejection as a
defect and answer `500 internal_error`, never read `.message` off it.

**As built (E1):** the first Effect error on the wire is a library one, `Schema.SchemaError`, and it is THROWN, not failed: the
API decodes synchronously (`Schema.decodeUnknownSync(schema, ALL_ISSUES)` in `apps/api/src/lib/validate.ts`) and `toApiError`
in `apps/api/src/lib/errors.ts` maps it once, with the library's guard instead of `instanceof`:
```ts
if (Schema.isSchemaError(error)) {
  return ApiError.validationFailed(toValidationIssues(error.issue, locale));
}
```
`error.issue` is the `SchemaIssue.Issue` tree; the adapter `packages/shared/src/core/i18n/issues.ts` walks it and never reads an
Effect message (E4: the wording is the catalog's). `Schema.decodeUnknownResult` returns the same issue as `result.failure.issue`
for callers that must not throw (tests, web forms). Never log a `SchemaError` built with `reportInput: true` (it can carry
secrets). E2 puts the tagged `ApiError` family beside this branch and turns the `instanceof ApiError` line into `catchTag`;
the `SchemaError` branch stays and becomes the `422 validation_failed` arm.

**As built (E2):** `apps/api/src/lib/errors.ts` holds the family (plan `docs/plans/e2-api-core-services.md` P4): `BadRequest`,
`Unauthorized`, `InvalidCredentials`, `Forbidden`, `NotFound`, `Conflict`, `PayloadTooLarge`, `UnsupportedMediaType`,
`ValidationFailed`, `Internal`, `RateLimited` and the generic `ApiFailure` (`status`, `code`, `text`, `details`), the union type
`ApiErrorFamily`, `isApiError` (a `Predicate` over the tags, no `instanceof`), `toApiError(unknown, locale)`, `errorBody(error,
locale)`, `onErrorHandler`, `notFoundHandler`; `DatabaseError` (`cause: Schema.Defect()`) sits OUTSIDE the family. Raise with
`return yield* new NotFound()` / `new NotFound({ text })` / `new Conflict({ code: "email_taken", text })` / `new ApiFailure({ status,
code, text })` / `new RateLimited({ retryAfterSeconds })` (the mapper sets `Retry-After`). What the source showed while building it:
- **A `Schema.TaggedError` constructor validates and THROWS** (`makeClass` in `Schema.ts` calls `struct.make(input, options)`; a
  failure is `Error("Schema validation failed")` with the issue as `cause`). Inside an error path that would turn into a 500, so the
  field schemas are permissive: `Schema.Number`, `Schema.String`, `text` a `Schema.declare<ErrorText>` that accepts any string or
  object, `details: Schema.optional(Schema.Unknown)` (an explicit `undefined` included).
- **`{ disableChecks: true }` (the second constructor argument, `MakeOptions`) skips only `.check(...)` refinements**, not the field
  TYPES: `new E({ n: "x" }, { disableChecks: true })` with `n: Schema.Number` still throws. Permissive schemas are the real guarantee.
- **Constructor defaults:** `text: Text.pipe(Schema.withConstructorDefault(Effect.succeed("server.error.notFound")))` makes the key
  optional in the constructor input (`new NotFound()` works) while the instance type keeps it required; no `optionalKey` needed.
- **Fixed per-class values are plain class fields** (`readonly status = 404; readonly code = "not_found"`), never schema fields, and
  never a bare `readonly x: T` redeclaration of a schema field (with ES2022 class fields it would overwrite the constructor's value
  with `undefined`).
- **`message`:** the class passes `args.message` to `Error`, so a family without a `message` field has none of its own; an
  `override get message(): string { return serverText("en", this.text) }` on each class gives the English log text (TS accepts the
  accessor because `Error.message` is declared in an interface). The class `name` is the identifier (the tag).
- **The legacy `ApiError extends ApiFailure`** keeps the positional constructor (it calls `super({ status, code, text, details },
  { disableChecks: true })`), the ten helpers and `toBody`, sets `name = "ApiError"`, and has `static override
  [Symbol.hasInstance](u): u is ApiError { return isApiError(u) }`, so `x instanceof ApiError` holds for every family member (TS
  5.3+ narrows through it; only a legacy instance really has `toBody`, so code that may see a tagged member uses `errorBody`).
- **The sync bridges:** `Effect.runSync(effect)` throws `Cause.squash(cause)`, i.e. the tagged error itself
  (`internal/effect.ts` `runSyncWith`); `requireUser(c)` is `Effect.runSync(currentUser(c))` with the explicit return type `User`.
- **Hono's `compose` passes only `Error` instances to `onError`**; a thrown non-`Error` (the string `"ManagedRuntime disposed"`)
  is rethrown by Hono, so `toApiError` maps it to `Internal` for callers outside Hono, and a route never lets one escape.
- **Bun's `expect(() => new X()).not.toThrow()` fails when the arrow RETURNS an Error**; construct outside the arrow
  (`apps/api/test/errors.test.ts`).

**As built (E2, integration):** `grep -rnE 'throw (new )?ApiError' apps/api/src` is now only `apps/api/src/modules/recipe/` and
`apps/api/src/modules/finance/` (idioms rule (10), pinned allow list that E3 and E4 empty). Catch-all sites are the ones that went
wrong in review, so keep them in mind when converting a `try { … } catch`: `Effect.catch` and `Effect.catchTag(s)` never see a synchronous
throw or an `Effect.promise` rejection (defects); the OAuth callback, `sendVerificationLinkQuietly`, `verifyPassword`, `trySendMail`,
the expired-token sweeps and the thumbnail generation all use `Effect.catchCause` / `Effect.ignoreCause` and `Cause.squash(cause)` for
the old `catch (error)` value. `apps/api/test/oauth-callback.test.ts` pins the callback (a defect still redirects with `oauth_failed`).
