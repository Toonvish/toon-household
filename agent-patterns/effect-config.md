# effect-config: Config, ConfigProvider and Redacted (Effect 4.0.5)

Distilled from the vendored source only (`repos/effect/LLMS.md`, `repos/effect/packages/effect/CONFIG.md`,
`repos/effect/packages/effect/src/{Config,ConfigProvider,Redacted}.ts`, `repos/effect/migration/{yieldable,schema}.md`
and the `effect/Config`, `effect/ConfigError`, `effect/ConfigProvider`, `effect/Secret` sections of
`repos/effect/migration/v3-to-v4.md`). Every API name below was grepped in `repos/effect/packages/effect/src`. Look
signatures up there, never from memory: your memory of Effect is v3, and v3's `Config.string`, `Config.fromMap`,
`ConfigError.isMissingData` and `Secret` are gone.

## 1. What it is for, and the imports

`Config` describes WHAT settings a program needs (names, types, defaults) and decodes them with a `Schema`;
`ConfigProvider` is WHERE the raw strings come from (`process.env`, a plain object, a `.env` string or file, a
directory tree); `Redacted` wraps a secret so logs, `toString` and JSON show `<redacted>`.

```ts
import { Config, ConfigProvider, Effect, Layer, Option, Redacted, Schema } from "effect"
```

- Everything is in the `effect` barrel; there is no `@effect/platform` and no `effect/unstable/*` path.
  `ConfigProvider.fromDotEnv` and `fromDir` need `FileSystem` / `Path` in the context (`BunServices.layer` from
  `@effect/platform-bun`, `repos/effect/packages/platform/bun/src/BunServices.ts`).
- A `Config<T>` IS an `Effect<T, Config.ConfigError>`: yield it in `Effect.gen` and it reads the current
  `ConfigProvider` from the context (`ConfigProvider.ConfigProvider`, a `Context.Reference` whose default is
  `fromEnv()`, so it needs no provision). `Config.isConfig` is the guard. `Config.ConfigError` is a class
  (`_tag = "ConfigError"`) with a `cause: ConfigProvider.SourceError | Schema.SchemaError`.

## 2. Constructors and the call shapes

Primitive constructors take the key name: `Config.String`, `NonEmptyString`, `Number`, `Finite`, `Int`, `Boolean`,
`Port` (1-65535), `URL`, `Date`, `Duration`, `ByteSize`, `LogLevel`, `Redacted`, `Literal(v, name)`,
`Literals([..], name)`, `Array(schema, name?, { separator })`, `Record(key, value, name?, { separator,
keyValueSeparator })`. `Config.Boolean` accepts `true/false`, `yes/no`, `on/off`, `1/0`, `y/n`.

Shape 1, one value with a default, yielded inside `Effect.gen`:

```ts
const program = Effect.gen(function*() {
  const name = yield* Config.String("NAME").pipe(Config.withDefault("world"))
  const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000))
  return { name, port }
})
```

(`repos/effect/migration/yieldable.md`, "Config and services remain Effects".)

Shape 2, a group of independent values, each with its own default (`Config.all` takes a record, a tuple or an
iterable):

```ts
const AppConfig = Config.all({
  host: Config.String("host"),
  port: Config.Int("port").pipe(Config.withDefault(8080)),
  debug: Config.Boolean("debug").pipe(Config.withDefault(false))
})
```

(`repos/effect/packages/effect/CONFIG.md`, "Config.all" and "Practical Example"; per-child defaults are the
documented way to keep the other supplied values.)

Shape 3, a validated struct read through a `Schema` (the schema decodes strings: `"8080"` becomes `8080`):

```ts
const ServerConfig = Config.schema(
  Schema.Struct({
    host: Schema.String,
    port: Schema.Int,
    logLevel: Schema.Literals(["debug", "info", "warn", "error"])
  }),
  "server"
)
// env: server_host=localhost server_port=3000 server_logLevel=debug
```

(`CONFIG.md`, "Practical Example: Web Server Config"; `Config.schema(codec, path?)` is the one primitive every
other constructor is a shortcut for, `Config.String(n)` = `Config.schema(Schema.String, n)`, `src/Config.ts`.)

Shape 4, a secret and an optional value:

```ts
const secret = Config.Redacted("SESSION_SECRET")               // Config<Redacted<string>>
const maybePort = Config.option(Config.Int("port"))            // Config<Option<number>>
Redacted.value(yield* secret)                                  // the raw string, at the trusted boundary only
String(Redacted.make("x"))                                     // "<redacted>"
```

(`src/Config.ts` `Redacted` and `option`; `src/Redacted.ts` `make`, `value`, `isRedacted`.)

## 3. Composing, providing providers, decoding

Config combinators (all dual: data-first or in `.pipe`): `Config.map`, `Config.mapEffect` (the function returns
`Effect<B, Config.ConfigError>`), `Config.flatMap`, `Config.withDefault`, `Config.option`, `Config.orElse`,
`Config.nested(prefix)`, `Config.all`, `Config.unwrap`, `Config.succeed`, `Config.fail`.

```ts
const dbConfig = Config.all({
  host: Config.String("host"),
  port: Config.Int("port")
}).pipe(Config.nested("database"))
// fromUnknown({ database: { host, port } })  or env  database_host / database_port
```

(`CONFIG.md`, "Config.nested". Several `nested` calls compose with the outermost prefix first.)

Providers. `fromEnv({ env?, preserveEmptyStrings? })` (default `process.env` merged with `import.meta.env`; names
are split on `_`, so `DATABASE_HOST` is reachable as `["DATABASE_HOST"]` and `["DATABASE","HOST"]`),
`fromUnknown(obj, { preserveEmptyStrings? })`, `fromDotEnvContents(string, { expandVariables? })`,
`fromDotEnv({ path? })` (an Effect, needs `FileSystem`), `fromDir({ rootPath })`, `make(path => Effect<Node |
undefined, SourceError>)` for a custom source, and the combinators `ConfigProvider.orElse(a, b)` (falls back when
`a` returns `undefined`; never catches `SourceError`), `nested`, `constantCase` (camelCase key to
`SCREAMING_SNAKE`), `mapInput`.

```ts
// a test or script: explicit values, no process.env
const provider = ConfigProvider.fromEnv({ env: { DATABASE_URL: "file:./data/m2.db", SESSION_SECRET: "x".repeat(32) } })
const url = yield* Config.String("DATABASE_URL").parse(provider)       // parse(provider): one-off, no layer
```

```ts
// install a provider for a whole program or runtime
const TestConfig = ConfigProvider.layer(ConfigProvider.fromUnknown({ port: 8080 }))
Effect.runSync(Effect.provide(program, TestConfig))
// a fallback instead of a replacement: process.env first, `defaults` second
const WithDefaults = ConfigProvider.layerAdd(ConfigProvider.fromUnknown({ HOST: "localhost" }))
// one-off override
program.pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider))
```

(`CONFIG.md`, "Installing a Provider" and "ConfigProvider Sources"; `src/ConfigProvider.ts` `layer`, `layerAdd`.
`layer` also takes an Effect that yields a provider, e.g. one that loads `.env` through `fromDotEnv`; the layer
is `Layer<never, E, ...>`, so a failing load is a layer failure.)

A service whose layer depends on config reads it inside the layer's generator (the `Layer.unwrap` shape of
`repos/effect/ai-docs/src/01_effect/03_services/20_layer-unwrap.ts`):

```ts
static readonly layer = Layer.unwrap(
  Effect.gen(function*() {
    const useInMemory = yield* Config.Boolean("MESSAGE_STORE_IN_MEMORY").pipe(Config.withDefault(false))
    if (useInMemory) return MessageStore.layerInMemory
    const remoteUrl = yield* Config.URL("MESSAGE_STORE_URL")
    return MessageStore.layerRemote(remoteUrl)
  })
)
```

Absence versus failure (`CONFIG.md`, "How Absence Is Decided"): `withDefault` and `option` replace only an ABSENT
value; a present but invalid value (`PORT=abc`) and a `SourceError` still fail. `orElse` handles absence and
every `ConfigError`, and the fallback's result replaces the original failure.

## 4. Error handling

- Typed failure: every Config is `Effect<T, Config.ConfigError>`. `error.cause` is a `ConfigProvider.SourceError`
  (the source could not be read: I/O, permissions) or a `Schema.SchemaError` (wrong type, out of range, missing
  key). Narrow with `error.cause._tag === "SchemaError"`, `Schema.isSchemaError(error.cause)` or
  `error.cause instanceof ConfigProvider.SourceError`. `error.message` renders the issue with the failing path.
- Recover with `Effect.catchTag("ConfigError", ...)` (the class carries `_tag`), or inside the Config with
  `Config.orElse((error) => ...)`; the callback receives the `ConfigError` and returns a `Config`
  (`Config.fail(error.cause)` re-raises). `Config.fail` takes a `SourceError | SchemaError`, not a message string.
- Defects are not config errors: `Config.orElse` never sees a defect or an interruption.
- A startup configuration failure is fatal: keep `Config.ConfigError` in the `E` of the layer so it reaches
  `ManagedRuntime` / `BunRuntime.runMain` (exit code non-zero), or turn it into a defect with `Effect.orDie`
  where a boot must stop with one readable message. Never swallow it into a default (this repo's `resolveProcessEnv` in `apps/api/src/config.ts`
  fails fast with the full list of bad variables).
- A failure message is built from the path and the schema issue; the secret value of a `Config.Redacted` never
  appears in it (the wrapper prints `<redacted>`).

## 5. v3 to v4 renames that bite

| v3 | v4 |
| --- | --- |
| `Config.string / number / integer / boolean / url / date / duration / logLevel / port` | `Config.String / Number / Int / Boolean / URL / Date / Duration / LogLevel / Port` (PascalCase; `Config.Finite` rejects NaN and Infinity) |
| `Config.nonEmptyString` | `Config.NonEmptyString` |
| `Config.secret`, `Secret`, `Config.redacted(config)` | `Config.Redacted(name)`; `Secret` is removed, use `Redacted<string>`; a Config argument becomes `Config.map(config, Redacted.make)` |
| `Config.literal("a", "b")` | `Config.Literals(["a", "b"], name)`; one value: `Config.Literal(v, name)` |
| `Config.array(c, name)`, `Config.repeat`, `Config.chunk`, `Config.hashSet` | `Config.Array(schema, name, { separator })`, or `Config.schema(Schema.Chunk(s), name)` |
| `Config.validate`, `Config.branded`, `Config.withDescription` | `Config.schema(schema.check(...), name)`, `Schema.brand`, `schema.annotate({ description })` |
| `Config.mapOrFail`, `Config.mapAttempt` | `Config.mapEffect` (returns `Effect<B, ConfigError>`) |
| `Config.zip`, `Config.zipWith` | `Config.all([a, b])` then `Config.map` |
| `Config.orElseIf`, `Config.orElse(() => ...)` | `Config.orElse((error: ConfigError) => ...)`; test the error in the callback |
| `Config.fail("msg")` | `Config.fail(new ConfigProvider.SourceError({ message }))` or a `Schema.SchemaError` |
| `Config.sync`, `Config.suspend` | `Config.succeed(undefined).pipe(Config.map(() => thunk()))`, `Config.schema(Schema.suspend(...))` |
| `ConfigProvider.fromMap`, `fromJson` | `ConfigProvider.fromUnknown` (expand delimited keys into a nested object; there is no `fromMap`) |
| `ConfigProvider.fromFlat / makeFlat / mapInputPath` | `ConfigProvider.make` / `mapInput` (complete path, numbers are array indexes) |
| `kebabCase`, `snakeCase`, `lowerCase`, `upperCase`, `unnested`, `within` | removed; `constantCase` stays, the rest through `ConfigProvider.mapInput` / `orElse` |
| `ConfigError.isMissingData`, `isMissingDataOnly`, `isInvalidData`, `ConfigError.And/Or` | removed; use `withDefault` / `option` for absence, `Schema.isSchemaError(error.cause)` for invalid data |
| `Schema.Redacted(s)` (decodes the value) | `Schema.RedactedFromValue(s)`; v4 `Schema.Redacted(s)` expects an already-`Redacted` input (`migration/schema.md`) |

## 6. Pitfalls

- Do not call the v3 lower-case constructors (`Config.string`, `Config.integer`); in v4 they do not exist. A group
  default replaces the WHOLE `Config.all` group; put `withDefault` on each child to keep the supplied values.
- `Config.parse(provider)` takes only the provider. Lookup prefixes belong to `Config.nested` or the `path`
  argument of `Config.schema`, never to `parse`.
- Literal EMPTY strings count as MISSING for `fromEnv`, `fromUnknown`, `fromDotEnv*` and `fromDir` (an empty
  file is missing too). `FOO=` therefore takes the `withDefault`. Pass `{ preserveEmptyStrings: true }` where an
  empty value must be kept as a value. Compare with this repo's `apps/api/src/config.ts`, which treats blank values on its own (`rawEnv`).
- `Config.schema` rejects opaque encodings (`Schema.Any`, `Unknown`, `ObjectKeyword`, `Json`) at construction
  time. For JSON in one variable use `Schema.fromJsonString(Schema.Json)`. A plain `Schema.Array` / `Schema.Record`
  accepts structural provider input only: separated strings (`"a,b,c"`) need `Config.Array` / `Config.Record`.
- A `Config.schema(Schema.Struct(...))` is ONE structured input: an existing object with a missing field fails.
  `Config.all` evaluates independent children and can default a partially supplied group. Pick on purpose.
- `Config.withDefault` and `option` never recover a `SourceError` or a validation failure; `Config.option` of a
  schema that accepts `undefined` is `Some(undefined)`, not `None`.
- `ConfigProvider.orElse` falls back only on `undefined` (not found), never on `SourceError`; `nested` and
  `mapInput` applied to an `orElse` provider apply to BOTH sides; `constantCase` before `nested` leaves the prefix
  untouched (put it after `nested` to convert the prefix too).
- `fromEnv` splits names on `_`: `WEB_ORIGIN` and a longer `WEB_ORIGIN_X` make `WEB_ORIGIN` a record node that
  also carries its own scalar value (`nodeAtEnv` in `src/ConfigProvider.ts` builds it with `makeRecord(keys, value)`);
  confirm with a test that the scalar read still resolves before relying on it for a variable that is a prefix of another.
- `ConfigProvider.fromEnv()` without `env` reads `process.env` at CALL time of `fromEnv`, and the default provider
  is created lazily; a dotenv loader must run before the first Config is evaluated, or be a provider of its own.
- `Redacted.value` exposes the secret: call it only where the value is used (argon2 salt, cookie signing, SMTP
  login), never to log or to put into an error `message`. `Redacted.wipeUnsafe(r)` deletes the stored value.
- Reading config at module scope with `Effect.runSync` re-creates the eager side effects the layer removes: build
  the config in a layer and let the runtime build it once.

## 7. In this repo

Where it lives:
- `apps/api/src/config.ts`: `AppConfig`, the validated environment as a service (`Context.Service<AppConfig, Env>`), with `AppConfig.config`
  (a `Config.Config<Env>` that only READS the variables), `AppConfig.layer` (the process value, `resolveProcessEnv()`, resolved once per
  process) and `AppConfig.layerFrom(values)` (explicit raw values, no `process.env`, no dotenv, no test rules); `configErrorLines`, `parseEnv`,
  `REPO_ROOT`. Importing the file has no side effect; only the first resolution does.
- `apps/api/src/env.ts`: re-exports `env` (`resolveProcessEnv()` at import), `parseEnv`, `REPO_ROOT` for the synchronous readers (the tests
  mutate `env` fields as seams) and the pinned import order of `apps/api/scripts/migrate-legacy.ts`; the client of
  `apps/api/src/db/client.ts` stays created at import (plan e8 P3). `AppConfig.layer` and `env` are the SAME object.
- `apps/api/src/infra.ts` provides `AppConfig.layer` to the infrastructure; services read it inside their generators
  (`const config = yield* AppConfig`).
- Tests: `apps/api/test/config.test.ts` and `apps/api/test/env-parse.test.ts` (every `parseEnv` line pinned).

Rule served: E7 (`AppConfig` is a cross-cutting service built with `Config`, keeping eager validation, the dotenv rules and the test temp-DB
rule of ADR 0009); a bad configuration stays fatal at boot (`resolveProcessEnv` prints the block and exits 1).

The sketch "`Config.all` of typed constructors, `Config.Redacted`, a dotenv provider chain" was NOT what behaviour parity allowed. The variable
schema stays ONE `Schema` struct (`EnvFields`, with the cross-field checks), decoded with `ALL_ISSUES` (every issue collected): `Config.schema`
stops at the first issue and the typed constructors word their own messages, and `apps/api/test/env-parse.test.ts` pins every line. So `Config`
only READS: every key of the struct as `Config.option(Config.String(key))`, the absent ones dropped, then one `Config.mapEffect` running the
schema decode, with the schema failure wrapped in `Config.ConfigError` (a plain class, `_tag = "ConfigError"`, `cause: SourceError | SchemaError`).
`apps/api/src/config.ts`:
```ts
const envConfig: Config.Config<Env> = Config.all(
  EffectRecord.fromIterableWith(ENV_KEYS, (key) => [key, Config.option(Config.String(key))] as const),
).pipe(
  Config.map(EffectRecord.getSomes),
  Config.mapEffect((raw) => decodeEnvEffect(raw).pipe(Effect.mapError((error) => new Config.ConfigError(error)))),
);
```
The service has the process layer and an explicit-values constructor. `ConfigProvider.fromUnknown(values, { preserveEmptyStrings: true })`:
without the flag `""` would be MISSING (section 6) and `WEB_ORIGIN=""` would take the default instead of failing; `fromUnknown` reads
`KEY_WITH_UNDERSCORES` as one flat key, where `fromEnv` would split it on `_`.
```ts
export class AppConfig extends Context.Service<AppConfig, Env>()("toon/api/config/AppConfig") {
  /** The configuration read from the current `ConfigProvider`; fails with a `Config.ConfigError`. */
  static readonly config: Config.Config<Env> = envConfig;

  /** The process value (`resolveProcessEnv`): the same object as `env`, one temp test DB per process. */
  static readonly layer: Layer.Layer<AppConfig> = Layer.sync(AppConfig, resolveProcessEnv);

  static layerFrom(values: Readonly<Record<string, string | undefined>>): Layer.Layer<AppConfig, Config.ConfigError> {
    return Layer.effect(
      AppConfig,
      envConfig.parse(ConfigProvider.fromUnknown(values, { preserveEmptyStrings: true })),
    );
  }
}
```
The process value is a memoized plain function, not a provider chain: `resolveProcessEnv()` loads the root `.env` / `.env.local` with a hand-written
loader (process env wins, nothing under `NODE_ENV=test`; its quoting and `#` rules are not `fromDotEnvContents`'), drops blank values, applies the ADR 0009
test rules (temp DB, placeholder secret), parses with `Effect.runSyncExit(envConfig.parse(provider))` and on failure prints the block and
`process.exit(1)`. It is memoized because `env` and every `AppConfig.layer` build must see the SAME object. Rule (20) of
`apps/api/test/effect-idioms.test.ts` allow-lists this one `Effect.runSyncExit`, the eager validation at import.

A test reads the config the way the layer does, against an explicit provider (`apps/api/test/config.test.ts`); a bad value is a
`Config.ConfigError` whose `configErrorLines` are the lines `apps/api/test/env-parse.test.ts` pins:
```ts
const readConfig = Effect.gen(function* () {
  return yield* AppConfig;
});

function fromLayer(layer: Layer.Layer<AppConfig, Config.ConfigError>): Exit.Exit<Env, Config.ConfigError> {
  return Effect.runSyncExit(Effect.provide(readConfig, layer));
}
```
A script that must not touch the process environment before its redirect (`apps/api/scripts/migrate-legacy.ts`) never imports `env.ts` or
`config.ts`'s process value: it resolves `DATABASE_URL` and `UPLOAD_DIR` itself (CLAUDE.md "The CLI never imports `src/env.ts`").
