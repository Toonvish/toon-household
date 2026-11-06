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
(`repos/effect/LLMS.md` "Error handling basics"; signature `Schema.TaggedError` in `repos/effect/packages/effect/src/Schema.ts`.) The first type
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
- **The boundary** (in this repo an `HttpApiMiddleware`, section 7; the generic form is) runs the effect with `runtime.runPromiseExit(effect)` (`ManagedRuntime`) or `Effect.runPromiseExit` and reads the `Exit`,
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

Where it lives:
- `apps/api/src/lib/errors.ts`: the error family, one `Schema.TaggedError` per HTTP refusal (`BadRequest`, `Unauthorized`,
  `InvalidCredentials`, `Forbidden`, `NotFound`, `Conflict`, `PayloadTooLarge`, `UnsupportedMediaType`, `ValidationFailed`, `Internal`,
  `RateLimited` with `Retry-After`, and the generic `ApiFailure` with `status`, `code`, `text`, `details`), the union `ApiErrorFamily`,
  `isApiError` (a `Predicate` over the tags, no `instanceof`), `toApiError(unknown, locale)`, `errorBody`, `logBoundaryFailure`,
  `routeUnknown`. `DatabaseError` (`cause: Schema.Defect()`) sits OUTSIDE the family. `ERROR_CODES` in `packages/shared` stays the wire
  contract. The pre-E2 `ApiError` class is not in `src`: the pinned tests that still say `instanceof ApiError` import it from
  `apps/api/test/support/bridges/api-error.ts`, where it defers to `isApiError`.
- `apps/api/src/http/response.ts`: the ONE boundary. `ApiErrorBoundaryLayer` implements the `ApiErrorBoundary` `HttpApiMiddleware`
  (tag in `apps/api/src/http/middleware.ts`, outermost on every `HttpApi`): it recovers the whole cause of a handler (an interruption
  passes through) and `errorResponse` renders the envelope once, with `Retry-After` for `RateLimited`. A handler just does
  `return yield* new NotFound()`.
- `apps/api/src/core/services/**` and `apps/api/src/modules/<id>/services/**`: methods are `Effect.fn("Service.method")` with the
  failures in the signature; callers recover with `Effect.catchTag(s)`.
- `packages/shared/src/core/i18n/issues.ts` (`toValidationIssues`) and `apps/api/src/lib/validate.ts`: a `Schema.SchemaError` is thrown by
  the synchronous decode and mapped once, by `toApiError`, to `422 validation_failed`.
- Pinned by `apps/api/test/errors.test.ts` (the mapper and the 5xx log line), `apps/api/test/effect-idioms.test.ts` (rule (10): no
  `throw ApiError`; rules (16) and (17): `return yield*`, tagged errors) and `apps/api/test/oauth-callback.test.ts` (a defect still
  redirects with `oauth_failed`).

Rule served: **E6** ("Errors are tagged, typed and mapped once"; defects logged in English and answered as the same `500
internal_error`; handlers `Effect.catchTag(s)`, never `instanceof`), with **E12** for the idioms (`Schema.TaggedError`, `return yield*`).

The boundary is a layer over the whole cause. `apps/api/src/http/response.ts`:
```ts
export const ApiErrorBoundaryLayer: Layer.Layer<ApiErrorBoundary> = Layer.succeed(ApiErrorBoundary)((httpEffect) =>
  Effect.catchCause(httpEffect, (cause) =>
    Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : errorResponse(Cause.squash(cause)),
  ),
);
```
and the one mapper, `apps/api/src/lib/errors.ts`: a family member renders as itself, a `SchemaError` is the `422` arm, and everything else (a
`DatabaseError`, a defect, a non-`Error` value such as the string `"ManagedRuntime disposed"`) is `500 internal_error`:
```ts
export function toApiError(error: unknown, locale: Locale): ApiErrorFamily {
  if (isApiError(error)) return error;

  if (Schema.isSchemaError(error)) {
    return new ValidationFailed({ details: toValidationIssues(error.issue, locale) });
  }

  return new Internal();
}
```
A 5xx family member logs `[api] <METHOD> <path> -> <status> <code>: <English message>` plus its stack (`logBoundaryFailure`; a tagged error
passed to `console.error` alone prints Bun's object dump, not a line); a 4xx warns outside production.

What the source showed while building the family:
- **A `Schema.TaggedError` constructor validates and THROWS** (`makeClass` in `repos/effect/packages/effect/src/Schema.ts` calls
  `struct.make(input, options)`; a failure is `Error("Schema validation failed")` with the issue as `cause`). Inside an error path that
  would turn into a 500, so the field schemas are permissive: `Schema.Number`, `Schema.String`, `text` a `Schema.declare<ErrorText>` that
  accepts any string or object, `details: Schema.optional(Schema.Unknown)` (an explicit `undefined` included).
- **`{ disableChecks: true }` (the second constructor argument, `MakeOptions`) skips only `.check(...)` refinements**, not the field TYPES:
  permissive schemas are the real guarantee.
- **Constructor defaults:** `text: Text.pipe(Schema.withConstructorDefault(Effect.succeed("server.error.notFound")))` makes the key optional
  in the constructor input (`new NotFound()` works) while the instance type keeps it required.
- **Fixed per-class values are plain class fields** (`readonly status = 404; readonly code = "not_found"`), never schema fields, and never a
  bare `readonly x: T` redeclaration of a schema field (with ES2022 class fields it would overwrite the constructor's value with `undefined`).
- **`message`:** an `override get message(): string { return serverText("en", this.text) }` on each class gives the English log text.
- **Catch-all sites keep `Effect.catchCause`.** `Effect.catch` and `Effect.catchTag(s)` never see a synchronous throw or an `Effect.promise`
  rejection (defects); the OAuth callback, `sendVerificationLinkQuietly`, `verifyPassword`, `trySendMail`, the expired-token sweeps and the
  thumbnail generation use `Effect.catchCause` / `Effect.ignoreCause` and `Cause.squash(cause)` for the old `catch (error)` value.
- **Bun's `expect(() => new X()).not.toThrow()` fails when the arrow RETURNS an Error**; construct outside the arrow.

A refusal is the tagged error returned from the generator, with the catalog key as `text` and, where the wire code is not the class
default, the `code` (`apps/api/src/core/services/households/households.service.ts`):
```ts
      const loadHouseholdRow = Effect.fn("Households.loadHouseholdRow")(function* (householdId: string) {
        const [row] = yield* database.use((db) =>
          db.select().from(households).where(eq(households.id, householdId)).limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.group.notFound" });
        return row;
      });
```
A dedicated code with details is an `ApiFailure` (`apps/api/src/modules/finance/services/ledger/settlements.service.ts`, `409 balance_stale`
with the current balance):
```ts
              return yield* new ApiFailure({
                status: 409,
                code: "balance_stale",
                text: { key: "server.balance.stale", values: { amount: formatCents(currentBalanceCents) } },
                details: { currentBalanceCents },
              });
```
A test reads the failure with `Effect.flip` (`apps/api/test/modules.test.ts`: `expect(await runTest(Effect.flip(enable(undefined)))).toBe(refusal)`).

A Promise from a test seam (`setOcrEngine`, `setPdfRasterizer`) keeps its Promise contract and enters Effect through
`apps/api/src/modules/recipe/services/ocr/seam.ts`: a rejection that is a family member stays a typed failure, ANY other rejection is a
defect carrying the original object:
```ts
export const fromSeamPromise = <A>(evaluate: (signal: AbortSignal) => PromiseLike<A>): Effect.Effect<A, OcrFailure> =>
  Effect.tryPromise({ try: evaluate, catch: (cause) => cause }).pipe(
    // `orDie` turns the typed failure into a defect whose value is `cause` itself.
    Effect.catch((cause) => (isApiError(cause) ? Effect.fail(cause) : Effect.orDie(Effect.fail(cause)))),
  );
```

The SSRF guard's `SsrfError` is a `Schema.TaggedError` OUTSIDE the family (`apps/api/src/modules/recipe/services/import/url/ssrf.ts`): the
URL importer maps it once to `ApiFailure({ status: 400, code: "fetch_failed", text, details: { reason } })`.

A database failure inside a service is a `DatabaseError`, so the places that used to read the raw driver error unwrap its `cause`. The
catch-all of the booking transaction (`apps/api/src/modules/finance/services/plan/accrual.service.ts`) recovers the WHOLE cause, lets an
interruption through untouched and re-fails with the same cause; `accrual_runs.error` stores the error NAME only (the driver's message
carries the failed SQL with its bound parameters, F gotcha 73):
```ts
                if (Cause.hasInterruptsOnly(cause)) return yield* Effect.failCause(cause);
                const squashed = Cause.squash(cause);
                const original = isDatabaseError(squashed) ? squashed.cause : squashed;
                yield* Effect.sync(() => console.error(`[plan] catch-up failed for household ${householdId}:`, original));
                const marker = Predicate.isError(original) ? `${original.name}: see server log` : "unknown error: see server log";
                yield* recordRun(householdId, options.trigger, from, to, 0, 0, 0, marker, startedAt);
                return yield* Effect.failCause(cause);
```
