# effect-cli: command-line programs with `effect/cli`, `BunRuntime.runMain` and exit codes (Effect 4.0.5)

Distilled from the vendored source only (`repos/effect/LLMS.md` "Building CLI applications", `repos/effect/ai-docs/src/70_cli/10_basics.ts`,
`repos/effect/packages/effect/src/cli/{Command,Flag,Argument,GlobalFlag,CliConfig,CliError,CliOutput}.ts`, `Runtime.ts`, `Console.ts`,
`Logger.ts`, `Stdio.ts`, `repos/effect/packages/platform/bun/src/{BunRuntime,BunServices,BunStdio}.ts`, `repos/effect/migration/v3-to-v4.md`).
Look a signature up there before using it. Your memory of Effect is v3; section 5 lists what changed.

## 1. What this is for, and the imports

`effect/cli` parses `process.argv` into typed values (flags, positional arguments, subcommands), renders `--help` / `--version`, and runs
a handler Effect. In this repo it is for the E5 scripts (`apps/api/scripts/*.ts`, EFFECT.md E10). It is OPTIONAL there ("`effect/cli` may
parse arguments"): a script whose usage text or exit code a doc or test pins byte for byte may keep `node:util` `parseArgs` and wrap only
the body in an Effect (section 6). The program is a plain `Effect` run by `BunRuntime.runMain`; there is no CLI-specific runtime.

```ts
import { Console, Effect, Layer, Option, Runtime, Schema } from "effect"
import { Argument, CliConfig, CliError, Command, Flag, GlobalFlag } from "effect/cli"
import { BunRuntime, BunServices } from "@effect/platform-bun"
```

`effect/cli` is a stable subpath barrel (not `effect/unstable/*`; the `Command`, `Flag`, ... docs carry `@stability unstable` as a doc tag
only). `Command.Environment` is `FileSystem | Path | Terminal | ChildProcessSpawner | Stdio`; `BunServices.layer` provides exactly that set.
`@effect/platform-bun` is pinned in `apps/api/package.json`.

## 2. Constructors and the call shapes this repo uses

Flags and arguments are values that can be defined once and reused; `Flag.X(name)` is `--name`, `Argument.X(name)` is positional.
Modifiers: `Flag.withAlias`, `withDescription`, `withDefault`, `optional` (gives an `Option`), `withSchema`; `Argument.variadic`.

```ts
const workspace = Flag.String("workspace").pipe(
  Flag.withAlias("w"),
  Flag.withDescription("Workspace to operate on"),
  Flag.withDefault("personal")
)
const Email = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: "Expected a valid email address" }))
)
```
(`ai-docs/src/70_cli/10_basics.ts`)

One command with a config record of parameters and a handler (`Command.make(name, config, handler)`); the handler receives the parsed
record, `Flag.optional` yields `Option`, `Flag.Literals(name, [...])` a literal union, `Flag.withSchema` / `Argument.withSchema` validate
or transform with any schema at parse time:

```ts
const create = Command.make(
  "create",
  {
    title: Argument.String("title").pipe(Argument.withSchema(Schema.NonEmptyString)),
    priority: Flag.Literals("priority", ["low", "normal", "high"]).pipe(Flag.withDefault("normal")),
    assignee: Flag.String("assignee").pipe(Flag.withSchema(Email), Flag.optional)
  },
  Effect.fn(function*({ assignee, priority, title }) {
    yield* Console.log(`Created "${title}" with ${priority} priority`)
    if (Option.isSome(assignee)) yield* Console.log(`Assigned to ${assignee.value}`)
  })
)
```
(`ai-docs/src/70_cli/10_basics.ts`; the handler type is `(config) => Effect<void, E, R>`, so it returns nothing.)

Subcommands and flags shared with them; a subcommand reads the parent's input by yielding the parent command:

```ts
const tasks = Command.make("tasks").pipe(
  Command.withSharedFlags({ workspace }),
  Command.withDescription("Track and manage tasks")
)
// inside a subcommand handler: const root = yield* tasks   // root.workspace
tasks.pipe(Command.withSubcommands([create, list]), Command.run({ version: "1.0.0" }), ...)
```
(`ai-docs/src/70_cli/10_basics.ts`; `Command.withSubcommands`, `Command.withAlias`, `Command.withExamples` in `cli/Command.ts`.)

Run it: `Command.run(command, { version })` reads the arguments from the `Stdio` service (`process.argv.slice(2)`), so the only
platform wiring is the Bun layer and `BunRuntime.runMain`:

```ts
create.pipe(
  Command.run({ version: "1.0.0" }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain
)
```
(shape of `ai-docs/src/70_cli/10_basics.ts` with `BunRuntime` / `BunServices` for Node's; `cli/Command.ts` `run`; `platform/bun/src/BunRuntime.ts`.)

`Command.runWith(command, { version })(argv)` takes an explicit `ReadonlyArray<string>` instead; it is the test entry point (section 3).

## 3. Composing, providing, testing

Provide the script's own services to the handler with `Command.provide(layer | (input) => layer)` (the input is the parsed config, so a
`--db` flag can choose the `Database` layer), or provide them on the whole program with `Effect.provide` before `runMain`. The handler's
`R` has the built-in settings excluded; whatever else it needs must be in a layer, or `tsc` fails at `runMain`.

```ts
const program = migrate.pipe(
  Command.provide((input) => Database.layerFromUrl(input.databaseUrl)),   // repo layer, see effect-services.md
  Command.run({ version: "1.0.0" })
)
```
(`cli/Command.ts` `provide`, `provideEffect`, `provideSync`.)

Global flags: `CliConfig` is a `Context.Reference` whose default `builtIns` is `GlobalFlag.BuiltIns` = `--help`, `--version`, `--wizard`,
`--completions`, `--log-level`. Replace or drop them with `Effect.provide(CliConfig.layer({ builtIns: [GlobalFlag.Help] }))` (a script
that already owns a `-h` or `--version` meaning must not inherit these). `Command.withGlobalFlags` adds your own `GlobalFlag.Action` /
`GlobalFlag.Setting`.

Testing without a process (bun test): `Command.runWith(cmd, { version })(argv)` plus a layer that satisfies `Command.Environment`; the
vendored doc comments build it from `FileSystem.layerNoop({})`, `Path.layer`, `Stdio.layerTest({})`, a `Terminal.make({...})` and a
`ChildProcessSpawner.make(...)` merged with `Layer.mergeAll` (`cli/Command.ts`, `runWith` example). `Stdio.layerTest({ args:
Effect.succeed([...]) })` feeds `Command.run`. Assert on the exit with `Effect.exit` (`agent-patterns/effect-testing.md`).

Output stays byte-identical when it goes through `Console.log(...)` (stdout) and `Console.error(...)` (stderr): the default `Console` is
`globalThis.console` itself (`Console.ts` `Console`), so a line is the same string with the same newline, and a test spying on
`console.log` still sees it. `Effect.log*` is NOT a substitute: the default logger formats a timestamp, level and fiber id and writes
through `console.log` unless `Layer.succeed(Logger.LogToStderr, true)` is provided (`Logger.ts` `LogToStderr`, `consolePretty`).

## 4. Error handling

- Parse and validation failures (`UnrecognizedOption`, `MissingOption`, `MissingArgument`, `InvalidValue`, `UnknownSubcommand`, ...) are
  `CliError` tagged errors (`CliError.isCliError` is the guard). `Command.run` turns them into `CliError.ShowHelp`: the help text for the
  command path goes to stdout, the error list to stderr, then `ShowHelp` fails; `ShowHelp` carries exit code `1` when it has errors and
  `0` for a plain `--help` (`cli/CliError.ts`).
- A handler's typed failure `E` stays in the channel: `Command.run` returns `Effect<void, E | CliError, R | Environment>`. Handle domain
  failures with `Effect.catchTag` / `catchTags` inside the handler (`agent-patterns/effect-errors.md`) so the boundary only sees what it
  should print.
- `CliError.UserError({ cause, userMessage? })` is the "print this to the user" error: `Command.run` renders it with the installed
  `CliOutput.Formatter` on stderr (unless `renderErrors: false`) and marks it as reported.
- `Terminal.QuitError` (Ctrl+C in a prompt) becomes an interrupt, exit `130`.
- At the edge `BunRuntime.runMain(effect, { disableErrorReporting?, teardown? })` maps the `Exit` to a process exit code
  (`Runtime.defaultTeardown`): success `0`, interruption only `130`, otherwise the squashed error's `[Runtime.errorExitCode]` number if
  it has one, else `1`. Before that, an error whose `[Runtime.errorReported]` is not `false` is logged with `Effect.logError(cause)`.
  `process.exit(code)` is called only when `code !== 0` or a signal arrived; a success returns and the event loop ends the process.
- A defect (`Effect.die`, a throw inside `Effect.sync`) also ends as exit `1` via `Cause.squash`; `Effect.catch*` never sees it
  (`agent-patterns/effect-errors.md`).

A script's own exit code (this repo: `0` success, `1` errors found, `2` usage or input problem, as `docs/migration.md` pins) is the marker
on a tagged error, copied from `ShowHelp`:

```ts
export class UsageError extends Schema.TaggedError<UsageError>()("UsageError", { detail: Schema.String }) {
  override readonly [Runtime.errorExitCode] = 2
  override readonly [Runtime.errorReported] = false   // the handler already printed the text to stderr
}
```
(pattern of `cli/CliError.ts` `ShowHelp`: `override readonly [Runtime.errorExitCode] = ...`, `[Runtime.errorReported] = false`; check the
`Schema.TaggedError` call shape against `agent-patterns/effect-errors.md`.) A handler then does `return yield* new UsageError({ detail })`.
The alternative that bypasses the markers is `teardown`: `BunRuntime.runMain(program, { teardown: (exit, onExit) => ... })`.

## 5. v3 → v4 renames that bite for this module

| v3 (or the Node runner of the vendored example) | v4 |
| --- | --- |
| package `@effect/cli` | `effect/cli` (barrel; submodules `Command`, `Argument`, `Flag`, ...) |
| `@effect/cli/Args` | `effect/cli/Argument` |
| `@effect/cli/Options` | `effect/cli/Flag` |
| `@effect/cli/BuiltInOptions` | `effect/cli/GlobalFlag` (built-ins are `GlobalFlag.BuiltIns`, configured through `CliConfig`) |
| `@effect/cli/ValidationError` | `effect/cli/CliError` |
| `@effect/cli/CommandDescriptor` | `effect/cli/Completions` |
| `NodeRuntime.runMain` + `NodeServices.layer` (`@effect/platform-node`) | `BunRuntime.runMain` + `BunServices.layer` (`@effect/platform-bun`) |
| `Effect.catchAll`, `Effect.catchTag` on handler errors | `Effect.catch`, `Effect.catchTag` / `catchTags` (`migration/error-handling.md`) |
| `Context.Tag` services in handlers | `Context.Service` with a static `layer` (`migration/services.md`) |

Everything not in this table (the exact parameter-combinator names, `Command.make`'s config-record form, `Command.run({ version })`
taking the name from the command) is the v4 source; do not port a v3 call shape from memory.

## 6. Pitfalls

- **Built-in flags are not yours.** Without `CliConfig.layer({ builtIns: [] })` the runner owns `--help`, `--version`, `--wizard`,
  `--completions`, `--log-level` and prints help in its own format (`CliOutput.defaultFormatter`). A script whose usage text is pinned
  (`reset-password`'s `Usage: bun run auth:reset-password <email> [--send]`, the `migrate:legacy` usage and its exit `2` for a usage error,
  not the `1` that `ShowHelp` with errors gives) either keeps `parseArgs` and its text, or runs with `renderErrors: false` and maps the
  `CliError` to its own `UsageError`. Check each script's pinned lines before choosing; never change a doc'd line to fit the library.
- **A handler returns `void`.** `Command.make`'s handler type is `Effect<void, E, R>`; put the exit code on a failure (section 4), never on
  a return value.
- **`Effect.log` is not `console.log`** (section 3). Use `Console.log` / `Console.error` for every line a doc or test pins.
- **Do not call `process.exit` inside a handler.** It skips finalizers (the `Database` release that closes the libSQL client). Fail with a
  marked error instead; `runMain` exits after the scope has closed. Conversely a script that leaves a client open keeps the event loop
  alive on success: close resources through layers.
- **Layers build at the edge, not at import.** The E5 rule for `migrate-legacy.ts` (nothing may load `src/env.ts` or `src/db/client.ts`
  before the target is redirected) holds: no layer or service import at module scope that reads `env`; build the explicit layer inside
  `Command.provide((input) => ...)` or in the handler, after the flags are parsed.
- **Booleans are presence flags.** `Flag.Boolean("apply").pipe(Flag.withDefault(false))`; a value-taking flag is `Flag.String` /
  `Flag.Path` (`pathType`, `mustExist` options).
- **No `.pipe` on a handler built with `Effect.fn`.** Pass combinators as extra arguments of `Effect.fn` (E12).

## 7. In this repo

Where it is applied (milestone E5, EFFECT.md E10): `apps/api/scripts/{migrate,seed,reset-password,uploads-gc,plan-run,
localize-images,finance-import-xlsx,migrate-legacy}.ts`; each is a hand parse feeding an Effect body run through
`BunRuntime.runMain` on `AppLayer` (`runScript`), or on explicit values for `migrate-legacy.ts`. **`effect/cli` was not adopted** (plan
`docs/plans/e5-scripts.md` P4, deviation 2): E10 says "may", the flags and usage texts are pinned byte for byte, and `Command.run` owns
`--help`, `--version`, `--completions` and a parse-error exit of 1 that the scripts' exit 2 contract cannot take. The root scripts `scripts/{dev,typecheck,i18n-check,icons}.ts`
stay plain Bun. A script's exit-code error lives next to its script or in `apps/api/src/lib/errors.ts` style (a `Schema.TaggedError`).
Nothing here runs `Command.runWith`. The proof that the output lines and exit codes did not move is subprocess tests (`apps/api/test/legacy-cli.test.ts`,
`apps/api/test/legacy-cli-usage.test.ts`, `apps/api/test/scripts-main.test.ts`, `apps/api/test/scripts-seed.test.ts`) plus unit cases of the runner's exit-code rules (`makeScriptTeardown`).

From `apps/api/scripts/support/main.ts`, the one runner every `AppLayer` script goes through (`effect/cli` itself is not used):

```ts
export class ScriptExit extends Schema.TaggedError<ScriptExit>()("ScriptExit", { code: Schema.Number }) {
  override readonly [Runtime.errorExitCode] = this.code;
  override readonly [Runtime.errorReported] = false;
}

export function runScript<E>(program: Effect.Effect<number | void, E, never>): void {
  BunRuntime.runMain(program, { teardown: makeScriptTeardown((code) => process.exit(code)) });
}
```

and how a script uses it (`apps/api/scripts/plan-run.ts`: the program returns its exit code as a number, the layer is provided before the runner sees it):

```ts
if (import.meta.main) {
  runScript(planRun(process.argv[2]).pipe(Effect.provide(AppLayer)));
}
```

Rule served: **E10** (scripts are Effect programs with the same CLI surface: every flag, exit code 0/1/2 and output line that
`docs/migration.md`, `docs/deployment.md` or a test pins is unchanged), together with **E12** (`Effect.fn`, `return yield*` when raising,
`Schema.TaggedError`, `Effect.catchTag(s)`).

**As built (E5)** (plan `docs/plans/e5-scripts.md` P1, P10, P18; the code is the source):

- `apps/api/scripts/support/main.ts` exports `ScriptExit` (`Schema.TaggedError` with `code`, `override readonly [Runtime.errorExitCode] = this.code`,
  `override readonly [Runtime.errorReported] = false`: the shape of `ShowHelp` in section 4), `makeScriptTeardown(exitProcess)` and `runScript(program)`.
  A script prints its own line, then `return yield* new ScriptExit({ code })`; a program that succeeds with a number exits with it; the
  teardown calls `exitProcess` after the scope closed, in every case (a lingering handle never keeps a finished script alive).
- `migrate-legacy.ts` does NOT use `runScript`: it calls `BunRuntime.runMain(main(), { teardown })` where the teardown only sets
  `process.exitCode` (never `process.exit`, so a long report reaches a pipe in full) from the program's numeric success value, else the
  default code. `main` is an `Effect.fn` whose success value is the exit code 0, 1 or 2; its scratch directory, scratch client, legacy
  snapshots and real target are scoped resources released in reverse order.
- **A synchronous throw is a defect, so every exit-2 thrower is lifted by name** (plan P10, risk 12). A pure parser that `throw`s
  `CliUsageError`, `MappingError` or `LegacyInputError` inside a generator bypasses `Effect.catchTags`, and the CLI would exit 1 where
  it must exit 2 while every in-process `rejects.toMatchObject({ exitCode: 2 })` stays green (`Cause.squash` returns the same object). The lift,
  `liftExitTwo` in the CLI file and `liftTagged` in `apps/api/scripts/legacy/io.ts`: `Effect.suspend(() => { try { return Effect.succeed(f()); } catch (error) { if (isLifted(error)) return
  Effect.fail(error); throw error; } })` with `isLifted` a `Predicate.isTagged` test on the tag names (a foreign throw is rethrown and stays a
  defect, as it was a crash before); then `Effect.catchTags(program, { CliUsageError, MappingError, LegacyInputError })` maps each tag to its stderr lines and exit 2, accepted by
  `tsc` without a cast (a bogus key fails it). A subprocess case per exit-2 path (`apps/api/test/legacy-cli-usage.test.ts`) is the proof.
- Call a service as a value (`const accrual = yield* FinanceAccrual; accrual.runCatchUp(…)`), never as a static (P18).
