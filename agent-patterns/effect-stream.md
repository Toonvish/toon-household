# effect-stream: Stream, NDJSON, child processes, Bun adapters (Effect 4.0.5)

Distilled from the vendored source only (`repos/effect/LLMS.md` "Working with Streams" and "Working with child processes",
`repos/effect/ai-docs/src/03_stream/`, `repos/effect/ai-docs/src/60_child-process/`,
`repos/effect/packages/platform/bun/src/{BunChildProcessSpawner,BunStream,BunFileSystem,BunServices}.ts`, plus the signatures in
`repos/effect/packages/effect/src/Stream.ts`, `process/ChildProcess.ts`, `process/ChildProcessSpawner.ts`, `encoding/Ndjson.ts`).
Look a signature up there before using it. Your memory of Effect is v3; section 5 lists what changed.

## 1. What this is for, and the imports

A `Stream<A, E, R>` is an effectful, pull-based sequence of `A` that can fail with `E` and needs `R`. It is emitted in
non-empty array chunks internally, so every `run*` consumer gets the elements one by one while the pipeline stays batched. In this
repo it is for things that are not one value: process output (tesseract, pdftoppm), file bytes, NDJSON, polled sources, and the
bridge to Web `ReadableStream` at the HTTP edge. A single async value is an `Effect`, not a `Stream`.

```ts
import { Console, Effect, FileSystem, Option, Queue, Schedule, Schema, Sink, Stream } from "effect"
import { Ndjson, SchemaBinary } from "effect/encoding"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { BunChildProcessSpawner, BunFileSystem, BunServices, BunStream } from "@effect/platform-bun"
```

`Stream`, `Sink`, `Queue`, `Cause`, `PlatformError` are root exports of `effect`; `effect/encoding` and `effect/process` are
subpath barrels (stable path, not `effect/unstable/*`). The Bun adapters come from `@effect/platform-bun` (pinned in
`apps/api/package.json`). `BunStream` re-exports the Node stream adapters (`fromReadable`, `toReadable`, `toString`, ...) and adds
`fromReadableStream`; `BunChildProcessSpawner` re-exports the Node spawner (`layer`).

## 2. Constructors and the call shapes this repo uses

Build from values, iterables, pages, async iterables, callbacks:

```ts
export const numbers = Stream.fromIterable<number>([1, 2, 3, 4, 5])

export const fetchJobsPage = Stream.paginate(
  0, // the cursor
  Effect.fn(function*(page) {
    const results = [`Job ${page}`]
    const nextPage = page <= 10 ? Option.some(page + 1) : Option.none()
    return [results, nextPage] as const
  })
)

export const letters = Stream.fromAsyncIterable(asyncIterable(), (cause) => new LetterError({ cause }))
```
(`ai-docs/src/03_stream/10_creating-streams.ts`; `Option` is `import * as Option from "effect/Option"` there, also a root export.)
The second argument of `fromAsyncIterable` turns a thrown value into the typed error; there is no default.

Callback-based sources with a finalizer (`Stream.callback`, replaces v3 `Stream.async*`):

```ts
export const callbackStream = Stream.callback<PointerEvent>(Effect.fn(function*(queue) {
  function onEvent(event: PointerEvent) {
    Queue.offerUnsafe(queue, event)
  }
  yield* Effect.acquireRelease(
    Effect.sync(() => button.addEventListener("click", onEvent)),
    () => Effect.sync(() => button.removeEventListener("click", onEvent))
  )
}))
```
(same file.) End from the callback with `Queue.endUnsafe(queue)` (`Stream.ts` docs of `callback`).

Transform and consume (`ai-docs/src/03_stream/20_consuming-streams.ts`):

```ts
const normalized = orderEvents.pipe(Stream.map((o) => ({ ...o, totalCents: o.subtotalCents + o.shippingCents })))
const paid = normalized.pipe(Stream.filter((o) => o.status === "paid"))
const enriched = paid.pipe(Stream.mapEffect(enrichOrder, { concurrency: 4 }))   // effectful, bounded
const all = Stream.make("US", "CA").pipe(Stream.flatMap((c) => Stream.range(1, 50), { concurrency: 2 }))

const rows = Stream.runCollect(enriched)                                          // Effect<Array<A>, E, R>
const total = enriched.pipe(Stream.runFold(() => 0, (acc: number, o) => acc + o.grandTotalCents))
const first = enriched.pipe(Stream.runHead)                                       // Effect<Option<A>>
const each = enriched.pipe(Stream.runForEach((o) => Effect.logInfo(o.id)))
const viaSink = enriched.pipe(Stream.map((o) => o.grandTotalCents), Stream.run(Sink.sum))
```
`runDrain` runs for effects only; `take`, `drop`, `takeWhile` shape what is seen. The mapper of `mapEffect` also receives the
index (`(a, i) => ...`).

Child processes: `ChildProcessSpawner` is a service; get it, build a `ChildProcess.make(...)` command value, hand it over:

```ts
const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

const version = spawner.string(ChildProcess.make("node", ["--version"]))                 // Effect<string, PlatformError>
const files = yield* spawner.lines(ChildProcess.make("git", ["diff", "--name-only", `${baseRef}...HEAD`]))
const piped = spawner.lines(
  ChildProcess.make("git", ["log", "--pretty=format:%s", "-n", "20"]).pipe(
    ChildProcess.pipeTo(ChildProcess.make("head", ["-n", "5"]))
  )
)

const run = Effect.gen(function*() {
  const handle = yield* spawner.spawn(ChildProcess.make("pnpm", ["lint-fix"], { env: { FORCE_COLOR: "1" }, extendEnv: true }))
  yield* handle.all.pipe(Stream.decodeText(), Stream.splitLines, Stream.runForEach((line) => Console.log(line)))
  const exitCode = yield* handle.exitCode
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) { /* fail with a tagged error */ }
}).pipe(Effect.scoped)   // spawn needs a Scope: the child is killed when the scope closes
```
(`ai-docs/src/60_child-process/10_working-with-child-processes.ts`; `Console` is a root export.) The service also has `exitCode`,
`streamString` and `streamLines` (a `Stream`, `{ includeStderr: true }` interleaves stderr). A command is `make(cmd, args?, options?)`,
a template literal (`ChildProcess.make\`ls -la\``) or `make({ cwd })\`...\``; options include `cwd`, `env` + `extendEnv`, `stdin` /
`stdout` / `stderr` (`"pipe" | "inherit" | "ignore"`, or a `Stream` for stdin), `killSignal`, `forceKillAfter`, `shell`
(`process/ChildProcess.ts`). `handle` has `stdin` (a `Sink`), `stdout`, `stderr`, `all` (streams of `Uint8Array`), `exitCode`,
`isRunning`, `kill`, `pid` (`process/ChildProcessSpawner.ts`).

## 3. Composing, encoding and decoding, providing

Text: `Stream.decodeText()` (`Uint8Array` to `string`, stateful decoder, optional `{ encoding }`), `Stream.encodeText`,
`Stream.splitLines` (splits across chunk boundaries, handles `\n`, `\r`, `\r\n`), `Stream.mkString` (join to one string).

NDJSON and binary framing are `Channel`s piped through `Stream.pipeThroughChannel` (`ai-docs/src/03_stream/30_encoding.ts`):

```ts
class LogEntry extends Schema.Class<LogEntry>("LogEntry")({
  timestamp: Schema.DateTimeUtcFromString,
  level: Schema.Literals(["info", "warn", "error"]),
  message: Schema.String
}) {}

const decoded = Stream.make(ndjsonText).pipe(
  Stream.pipeThroughChannel(Ndjson.decodeSchemaString(LogEntry)()),   // lines -> validated LogEntry
  Stream.filter((entry) => entry.level === "error"),
  Stream.pipeThroughChannel(Ndjson.encodeSchemaString(LogEntry)()),   // back to NDJSON strings
  Stream.runCollect
)
const blanksOk = Ndjson.decodeString({ ignoreEmptyLines: true })
const binary = Ndjson.decode()  // Uint8Array in; Ndjson.encode() makes Uint8Array
const framed = SchemaBinary.decode(Schema.Struct({ id: Schema.Int, name: Schema.String }))()
```
The `Schema` variants decode and validate in one channel; note the trailing `()` (a thunk of options) after the schema argument.

Bun and Web/Node bridges:

```ts
BunStream.fromReadableStream({ evaluate: () => response.body!, onError: (cause) => new BodyError({ cause }) })  // Web ReadableStream in
BunStream.fromReadable({ evaluate: () => someNodeReadable, onError: (cause) => new X({ cause }) })              // Node Readable in
Stream.toReadableStream(Stream.encodeText(textStream))                                                          // Web ReadableStream out (no R)
Stream.toReadableStreamEffect(stream)                                                                           // with services captured
BunStream.toString(() => readable, { maxBytes: "2 MiB" })                                                       // Effect<string>, capped
```
(`BunStream.ts`, `platform/node-shared/src/NodeStream.ts`, `Stream.ts`.) The `FileSystem` service (`import { FileSystem } from "effect"`; `BunFileSystem.layer` provides it) has
`stream(path, { chunkSize, offset, bytesToRead })` (a `Stream<Uint8Array, PlatformError>`) and `sink(path)`.

Providing: `BunServices.layer` provides `ChildProcessSpawner | Crypto | FileSystem | Path | Terminal | Stdio` in one go;
`BunChildProcessSpawner.layer` needs `FileSystem | Path` (provide `BunFileSystem.layer` and `BunPath.layer`, or just use `BunServices.layer`).
A service that spawns reads `ChildProcessSpawner` in its `Layer.effect` and its `static layer` is `Layer.provide`d with the platform layer
(see the `DevTools` example). `Stream.scoped(stream)` ties a stream's resources to the stream; `Stream.unwrap(effectOfStream)` flattens an effect that builds one.

## 4. Error handling

- Stream errors are typed and ordered like Effect errors: `Stream.catch((e) => recovery)`, `Stream.catchTag("NdjsonError", ...)`,
  `Stream.catchTags({ ... })` (only tags the union has), `Stream.catchCause`, `Stream.mapError`, `Stream.orDie` (typed failure becomes a defect),
  `Stream.timeoutOrElse({ duration, orElse })`. A recovery returns a `Stream`.
- Spawner, file and stream operations fail with `PlatformError` (`_tag: "PlatformError"`, `reason: BadArgument | SystemError`;
  `effect/PlatformError`). `Ndjson` fails with `Ndjson.NdjsonError` (`kind: "Pack" | "Unpack"`, `cause`). Map them to the module's tagged error once,
  at the service edge (`Effect.mapError((cause) => new DevToolsError({ cause }))`, with `cause: Schema.Defect()` in the error), see `effect-errors.md`.
- Consuming (`run*`) returns an `Effect` carrying the stream's `E`; defects (a throw inside `map`) are not in `E` and surface as a die. Nothing
  reaches the HTTP boundary except what the service maps (E6): an unmapped `PlatformError` is a defect, answered `500 internal_error`.
- End of stream is `Cause.Done` (`Cause.done()`, `Cause.isDone`) and is excluded from the visible error type; do not model it as a failure.
- A non-zero child exit is NOT an error: `spawner.string` and `lines` return output whatever the code, and `handle.exitCode` is a plain
  `ExitCode`. Compare it (`ChildProcessSpawner.ExitCode(0)`) and raise your own tagged error. `exitCode` itself fails only if a signal killed the process.

## 5. v3 to v4 renames that bite

| v3 | v4 |
| --- | --- |
| `Stream.catchAll`, `catchAllCause`, `orElse` | `Stream.catch`, `Stream.catchCause`, `Stream.catch(self, () => that())` |
| `Stream.async`, `asyncScoped`, `asyncPush` | `Stream.callback((queue) => ...)` with `Queue.offerUnsafe` / `Queue.endUnsafe` |
| `Chunk` everywhere (`runCollect` gave a `Chunk`) | plain arrays: `runCollect` is `Effect<Array<A>>`; `Chunk` ops are `*Array` (`fromChunk` is `fromArray`, `mapChunks` is `mapArray`) |
| `runFold(init, f)` with a value | `runFold(() => init, f)` (initial value is a thunk); `scan(() => init, f)` likewise |
| `runScoped`, `runForEachScoped`, `runFoldScoped` | gone: `run*` manage the scope; `Stream.toPull` for manual scoped pulling |
| `runFoldWhile` | none: `Stream.runForEachWhile` with a mutable accumulator |
| `Stream.repeatEffectWithSchedule` | `Stream.fromEffectSchedule` |
| `Stream.timeoutFail`, `timeoutTo` | `Stream.timeoutOrElse({ duration, orElse })` |
| `Stream.acquireRelease` | `Stream.scoped(Stream.fromEffect(Effect.acquireRelease(...)))` |
| `Stream.either`, `mergeEither` | `Stream.result`, `Stream.mergeResult` (`Result`, not `Either`) |
| `Command` from `@effect/platform`, `CommandExecutor`, `BunCommandExecutor.layer` | `ChildProcess.make`, `ChildProcessSpawner`, `BunChildProcessSpawner.layer` (`effect/process`) |
| `Command.string` / `lines` / `start` | `spawner.string` / `lines` / `spawn`; `Command.env` is `ChildProcess.setEnv`, `workingDirectory` is `setCwd` or the `cwd` option; `feed` is a `stdin` Stream |
| `BunContext.BunContext` / `.layer` | `BunServices.BunServices` / `BunServices.layer` |
| `toReadableStreamRuntime(runtime)` | `Stream.toReadableStreamWith(context)` or `toReadableStreamEffect` |
| `Channel` type parameters `<OutElem, InElem, OutErr, InErr, OutDone, InDone, Env>` | `<OutElem, OutErr, OutDone, InElem, InErr, InDone, Env>` (rarely written by hand) |

(`repos/effect/migration/v3-to-v4.md`, the `Stream.*`, `Channel.*`, `Command.*`, `BunContext` entries.)

## 6. Pitfalls

- `spawner.spawn` needs a `Scope` (`Effect.scoped`); `stdout` and `all` share the same pipe, so consuming both interleaves and loses data. Read one.
- `env` without `extendEnv: true` replaces the environment, `PATH` included. `shell: true` is disadvised (`CommandOptions` docs). `forceKillAfter` defaults
  to never sending SIGKILL: a tesseract that ignores SIGTERM stays; set it where a timeout matters.
- A `Stream` is a description: every `run*` re-runs it from the start, and a `Stream.fromReadableStream`/`fromReadable` source can be read once.
  Use `evaluate: () => ...` (lazy) so a re-run gets a fresh source.
- `Stream.runCollect` and `spawner.string` buffer everything: cap untrusted input (`maxBytes` on `BunStream.toString`, `Stream.take`, a size check before) as the
  SSRF and upload limits do today.
- `Stream.decodeText()` keeps decoder state across chunks; call it per stream, not per chunk, or multi-byte characters split.
- `Stream.mapEffect` without `concurrency` is sequential; `flatMap` is sequential unless `{ concurrency }` is passed.
- Use `Predicate` helpers, not hand-written guards, on stream values (`LLMS.md`). `Date`/`Date.now` in a stream step goes through `Clock`/`DateTime`.
- Never import from `repos/` or the `NodeStream`/`NodeServices` of `@effect/platform-node` (the docs examples do; this repo is Bun: `@effect/platform-bun`).
- The ai-docs examples run under vitest; here tests are `bun test` and provide `BunServices.layer` or a fake `ChildProcessSpawner` via `ChildProcessSpawner.make(spawn)`
  (derives `string`, `lines`, `exitCode` from one `spawn`), see `effect-testing.md`.

## 7. In this repo

- `apps/api/src/modules/recipe/services/ocr/tesseract.ts` and `apps/api/src/modules/recipe/services/ocr/pdf.ts` keep `Bun.spawn` as the spawn
  primitive and do NOT use `ChildProcessSpawner` (E3-T02, plan `docs/plans/e3-recipe-services.md` P11). The Node-based spawner reports a missing binary as a
  `PlatformError` whose message differs from Bun's (`Executable not found in $PATH: "tesseract"`), and that message reaches the wire as `details.cause`
  of the documented `422 ocr_failed` / `422 pdf_no_text_layer`, so the primitive is not swapped. What the section 2 and 6 patterns still give them:
  the child is a scoped resource, `Effect.acquireRelease(Effect.try(() => Bun.spawn(...)), (child) => Effect.sync(() => { if (child.exitCode === null) child.kill() }))`,
  and so is the temp directory (`mkdtemp` / `rm`, catch-all). **Each native run is its own `Effect.scoped(...)`** (`Effect.fnUntraced(body, Effect.scoped)`: the
  scope never reaches a method's requirement, R = `never`) and that scoped region sits INSIDE the hard timeout (`Effect.timeoutOrElse`), so the child is
  killed and the directory removed when the run ends: success, failure, or the timeout's interruption. A scope taken from a layer would hold them until
  `runtime.dispose()`. The exit code is compared and mapped as before (`failedError`, the last three stderr lines); stderr and the exit code are read with
  `Effect.promise(() => Promise.all([child.exited, new Response(child.stderr).text()]))` (a `Stream.decodeText` + `Stream.mkString` would do the same).
  The test engine seam stays a Promise interface (`OcrEngine`): `fromSeamPromise` (`ocr/seam.ts`) turns it into an effect with `Effect.tryPromise`, an API-family
  rejection stays typed and any other rejection is a defect (`Effect.die`) carrying the original error.
- `apps/api/src/middleware/staticWeb.ts`, `apps/api/src/index.ts` and `apps/api/src/modules/recipe/routes/imports.ts` serve `Bun.file(...)`: they stay
  until E7; `Stream.toReadableStream` / `FileSystem.stream` is the bridge if a handler must return an Effect-built body.
- `apps/api/scripts/legacy/`, `apps/api/scripts/finance-import/` (E5) read workbooks and databases; line- or record-oriented inputs become
  `Stream`s with `mapEffect({ concurrency })` only where the output order and the report lines stay identical.
- Rule served: E3 ("Effect wraps what is fallible, asynchronous, resourceful or needs a dependency", a child process is all four) with E7 (services on one
  `Layer`, the spawner is a dependency, never a global) and E12 (`Effect.fn` / `Effect.gen`, `Schema.TaggedError` for the mapped failure, `Effect.catchTag`).
