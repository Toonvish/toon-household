# E5 — scripts: plan

**Status: DONE (2026-11-05; integration record in sections 9 and 10), planned and revised the same day after the plan review** (P10 and E5-T08: every synchronous exit-2 throw of
the CLI lifted by name; P17: a fixture baseline that does not depend on the checkout path, plus the `xlsx-dry` and `statics`
checks; P18: v4 service calls, no static accessors; E5-T05: the dry run's import rule spelled out and checked by subprocess; E5-T06
split into E5-T06a and E5-T06b). Base commit `9a1272a8e` (`learn: effect-cli pattern file from the vendored Effect source`), Bun 1.4.3 on
the host (`.bun-version` says 1.4.2; nothing here depends on the difference). Sections 9 and 10 (the integration record and "what
changed vs plan") are written by E5-T10, which also commits this file.

E5 is the sixth milestone of the Effect migration (`docs/EFFECT.md` §4 E5; decision E10 for the scripts, E3, E5, E6, E7 for the
code they reach, E9 for their tests, E12 for the idioms). The eight operator scripts under `apps/api/scripts/` become Effect programs
run with `BunRuntime.runMain` (`@effect/platform-bun`): seven on the one `AppLayer` (`apps/api/src/runtime.ts`), `migrate-legacy.ts`
on explicit values it resolved itself, because its import order is load-bearing. The `migrate:legacy` library
(`apps/api/scripts/legacy/*`) becomes Effect functions behind one `LegacyMigration` service, reaching the finance balance and the recipe
fold backfill through layers built from the explicit TARGET it is handed, never the shared database. `finance-import/*` stays pure
(E3). The script-only bridges E2 to E4 left in the core and the modules are deleted with their last caller, and `runModuleHook`
goes. The guiding sentence holds: how the code is written changes, not what it does. No flag, exit code, `docs/API.md` row,
German string, table, migration or pinned output line changes.

Exit (`docs/EFFECT.md` §4 E5 and the milestone task): gates green (`bun install --frozen-lockfile`, `bun run typecheck`, `bun test`,
`bun run build`, `bun run i18n:check` read by hand); the pass count not below E4's record (14725, re-measured as this plan's baseline,
section 1.2); the fixture run of `migrate:legacy` from CLAUDE.md "Commands" (dry run, `--apply`, `--apply` again) prints the same
report (normalised, P17) and the same three exit codes, the dry run writes no target file and no `-wal`, the second `--apply` writes
nothing and ends `[migrate:legacy] already migrated: nothing written.`; `apps/api/test/legacy-cli.test.ts`,
`apps/api/test/legacy-placeholders.test.ts` (which cleans the shared DB) and `apps/api/test/legacy-fixtures.test.ts` pass with their
files unchanged; `seed` refuses `NODE_ENV=production` without `ALLOW_SEED=1` and a 10+ character `SEED_PASSWORD`, before the database
is opened; `git status --porcelain repos/` empty; `apps/api/test/effect-idioms.test.ts` green with rule (12) switched on (P14); a boot
of the API answers `/api/health` and SIGTERM ends with `[db] database closed`, `[api] runtime disposed`, exit 0.

## 1. Context

### 1.1 State of the tree at plan time (`9a1272a8e`, measured 2026-11-05)

- **E4 is done** (`docs/plans/e4-finance-services.md` sections 9 and 10). Both manifests are `ApiModule`s; `AppLayer`
  (`apps/api/src/runtime.ts`) = the module layers over `coreServicesLayer()` over `infraLayer()`; `runtime` is the one `ManagedRuntime`.
  `Database` (`apps/api/src/db/database.ts`) has `layer` (the shared client of `src/db/client.ts`, acquire awaits `dbReady`, release
  closes it and logs `[db] database closed`, never under `NODE_ENV=test`), `layerFrom({ db, client, url })`, `layerFromExecutor(executor)`
  (closes nothing), `layerFromUrl(url)` (opens with the pragmas, closes in the scope) and `withExecutor(db)`. `AppConfig`
  (`apps/api/src/config.ts`, the graph root: imports nothing from the API) has `layer` (`resolveProcessEnv`, once per process) and
  `layerFrom(values)`. `src/db/client.ts` still creates the process-wide client AT IMPORT from `env.databaseUrl` (ADR 0014; the tests'
  shared `db` of ADR 0009 and `migrate-legacy.ts` rely on it).
- **The scripts** (`apps/api/scripts/`, all plain async Bun, 1,545 lines without the libraries): `migrate.ts` (19 lines: placeholder
  `SESSION_SECRET`, then dynamic imports, `runMigrations()`, three `[db:migrate]` lines), `seed.ts` (119: the production refusal BEFORE
  `db/client.ts` is imported, then the demo user and household, `initializeHousehold` (core Promise bridge), every module's `seedDemo`
  through `runModuleHook`), `reset-password.ts` (90: `findUserByEmail`, `createPasswordResetToken`, `trySendMail`, `isMailConfigured`;
  usage exit 1, unknown address exit 2), `uploads-gc.ts` (105: `collectUploadReferences(db)` core bridge, `node:fs/promises`, 24 h
  grace, `--dry-run`, `--min-age-hours=N`), `plan-run.ts` (54: `runCatchUp` finance bridge per household; exit 1 when a household
  fails or the named one is missing), `localize-images.ts` (81: `localizeImageUrl` recipe bridge, `--dry-run`), `finance-import-xlsx.ts`
  (776: pure workbook parsing and the reconciliation report; the write path `writeImportRecords` / `seedFixedCostPlan` uses the finance
  bridges `slot1UserId`, `requireOtherMemberId`, `categoryIdBySlug`, `syncTransactionTags` and finance `withTransaction`, imported
  dynamically so `--dry-run` never loads the database module; guarded by `import.meta.main`, the test imports `buildImport`,
  `writeImportRecords`, `seedFixedCostPlan`), `migrate-legacy.ts` (321: `node:util` `parseArgs`, `resolveCliEnv` (pure, throws
  `CliUsageError`), the scratch copy, `process.env.DATABASE_URL` redirected BEFORE the first dynamic import, then `../src/db/client.ts`,
  `../src/db/migrate.ts`, `./legacy/*`; `process.exitCode = await main()` under `import.meta.main`).
- **The `migrate:legacy` library** (`apps/api/scripts/legacy/`, 14 files, 3,615 lines, about 140 `await`s): `types.ts` (types only,
  `Database` as a type), `sources.ts` (`snapshotDatabase` sync, `openLegacy`, `readAll`, `LegacyInputError` with `exitCode = 2`),
  `ledger.ts` (`lookupMany`, `loadAll`, `ledgerStatement` pure), `copy.ts` (`writeEntries` with the per-row retry, `copyTable` keyset
  reads, `CopyProgrammingError`, pure statement builders), `report.ts` and `mapping.ts` (pure; `MappingError` with `exitCode = 2`,
  thrown synchronously by `validateMappingOverride` / `parseMappingFile`), the steps `users.ts`, `households.ts`, `recipe.ts`
  (`backfillFoldedColumns(target.db)`, recipe bridge over `runModuleHook`), `uploads.ts` (`node:fs/promises`), `finance.ts`,
  `claims.ts`, `balance.ts` (`getBalance(target.db, …)`, finance bridge over `runFinanceBridge`), and `run.ts` (`runLegacyMigration`,
  `knownLegacyIds`). Every step takes the `MigrationContext` (`target: { db, client, url }`, the legacy clients, the report, the id
  maps) and mutates its report.
- **`finance-import/`** (5 files, 749 lines): `amounts.ts`, `categorize.ts`, `dates.ts`, `rent.ts` are pure; `xlsx-reader.ts`
  reads the workbook with `readFileSync` and `inflateRawSync` and parses it (synchronous, no dependency).
- **Bridges whose last outside caller is a script** (ADR 0014 "Status after E4's integration", CLAUDE.md "Bridges until E5 to E8"):
  core `initializeHousehold` (`households/modules.ts`; `seed.ts`), `findUserByEmail` (`auth/users.ts`; `reset-password.ts`),
  `createPasswordResetToken` (`auth/passwordReset.ts`; `reset-password.ts`), `collectUploadReferences(database, modules)`
  (`media/references.ts`; `uploads-gc.ts`), `trySendMail` (`mail/index.ts`; `reset-password.ts` and `apps/api/test/mail.test.ts`);
  recipe `backfillFoldedColumns(database?)` (`modules/recipe/migrate.ts`; `legacy/recipe.ts`, `apps/api/test/legacy-recipe.test.ts`),
  `localizeImageUrl` (`services/recipes/remoteImage.ts`; `localize-images.ts`); finance `runCatchUp` (`plan-run.ts`,
  `apps/api/test/finance-security.test.ts`), `getBalance` (`legacy/balance.ts`, `apps/api/test/legacy-finance.test.ts`,
  `apps/api/test/finance-scheduler.test.ts`), `slot1UserId`, `requireOtherMemberId`, `categoryIdBySlug`, `syncTransactionTags` (all
  `finance-import-xlsx.ts`), the finance `withTransaction` helper (`services/support.ts`; `finance-import-xlsx.ts`,
  `apps/api/test/finance-file-db.test.ts`); `runModuleHook` (`apps/api/src/modules/adapter.ts`; `src/db/migrate.ts` `runMigrations`,
  `seed.ts`, the references and recipe bridges, `runFinanceBridge`). `isMailConfigured` is NOT a bridge any more (a synchronous helper
  with a `src` caller, `auth/verifiedEmail.ts`).
- **Tests that reach the scripts or their libraries:** `apps/api/test/legacy-cli.test.ts` (in-process `runLegacyMigration`,
  `migrateUsers`, `migrateHouseholds`, `migrateRecipe`, `openLegacy`, `exitCodeFor`, `totalWritten`, `CliUsageError`, `resolveCliEnv`;
  eight subprocess spawns of the real CLI; the textual source-order guard), `apps/api/test/legacy-placeholders.test.ts`
  (`runLegacyMigration` into the SHARED test DB, `openLegacy`), `apps/api/test/legacy-fixtures.test.ts` (the fixture build only),
  `apps/api/test/support/legacy-harness.ts` (`createLegacyRun`: `openLegacy`, `createReport`, a temp target from `createDatabase`),
  `legacy-framework` (17 library call sites), `legacy-users` (29), `legacy-households` (18), `legacy-mapping` (pure), `legacy-recipe`
  (24), `legacy-finance` (13), `finance-scheduler` (4) — mostly `migrateUsers` / `migrateHouseholds` — plus `finance-import-xlsx.test.ts`
  (one subprocess `--dry-run`, `writeImportRecords` / `seedFixedCostPlan` on the shared `db`), `finance-security.test.ts`
  (`runCatchUp(failing, …)` on a `Proxy` whose `transaction` rejects: `rejects.toThrow("insert into")` and the audit marker),
  `finance-file-db.test.ts` (finance `withTransaction`), `module-adapter.test.ts` (three `runModuleHook` cases), `import-order.test.ts`
  (pinned: probes `./src/db/migrate.ts`, `./src/core/services/{households/modules,media/references,auth/users}.ts` and
  `./scripts/legacy/{run,households,finance,balance,claims}.ts` first in a fresh process). About 20 test files call
  `runMigrations(db)` (the Promise door; P8). No test runs `seed`, `reset-password`, `uploads-gc`, `plan-run`, `localize-images` or
  `db:migrate` today.
- **Pinned output** (P3): `docs/migration.md` (the `migrate:legacy` mode lines, section headings, final lines, exit codes 0/1/2, the
  dry-run excerpt), `legacy-cli.test.ts` (stdout/stderr substrings and final lines), `finance-import-xlsx.test.ts`
  (`Total transactions: …`, `no --household given: no database write performed.`), `docker/entrypoint.sh` runs `bun
  apps/api/scripts/migrate.ts` (`deploy-dockerfile.test.ts`), `docs/deployment.md` names `reset-password.ts <email>`. Every other
  script line is unpinned but stays byte-identical (P3).
- **Effect API facts looked up for this plan** (vendored `effect@4.0.5`): `BunRuntime.runMain`
  (`repos/effect/packages/platform/bun/src/BunRuntime.ts`) is `NodeRuntime.runMain` of
  `repos/effect/packages/platform/node-shared/src/NodeRuntime.ts`: `Runtime.makeRunMain` forks the program, installs SIGINT/SIGTERM
  handlers that interrupt it, and on completion calls `teardown(exit, onExit)` where `onExit(code)` calls `process.exit(code)` ONLY when
  `code !== 0` or a signal arrived (a success returns and the event loop ends the process). `Runtime.defaultTeardown`
  (`repos/effect/packages/effect/src/Runtime.ts` ~111) gives 0 on success, 130 on interruption only, else
  `getErrorExitCode(Cause.squash(cause))` (the error's `[Runtime.errorExitCode]` number, default 1). Before teardown `makeRunMain` logs
  the cause with `Effect.logError` unless `disableErrorReporting` or the squashed error's `[Runtime.errorReported]` is `false`.
  `Runtime.errorExitCode` is the string key `"~effect/Runtime/errorExitCode"` (~291), `Runtime.errorReported`
  `"~effect/Runtime/errorReported"` (~383). `effect/cli` is the stable subpath `./cli` of the package (not `effect/unstable/*`); its
  `Command.run` owns `--help`, `--version`, `--wizard`, `--completions`, `--log-level` and exits 1 on a parse error
  (`agent-patterns/effect-cli.md` sections 3, 4, 6). `Console.log` / `Console.error` write through `globalThis.console`
  (`agent-patterns/effect-cli.md` section 3). `Effect.provide(layer)` closes the layer's scope when the effect ends, so `Database.layer`'s
  release runs before `runMain`'s teardown.

### 1.2 Baseline

`bun test` at `9a1272a8e`, 2026-11-05, under a host load average of 10 to 16 (parallel work on the machine): **14725 pass, 0 fail,
383719 expect() calls, 14725 tests in 163 files, 62.01 s** (log ends `exit=0`). This equals E4's record (section 9.7 of the E4 plan,
36.66 s on a quiet host). Every task verifies `pass >= 14725` (P13, `docs/plans/e5-verify.sh suite`); E5 adds tests (each script gets
a characterisation test, P13), so the record at the end is higher.

### 1.3 Bundle size

Not asked for E5 (E6 and E7 record it). E5 touches no web file (`apps/web` is pinned, P13); `bun run build` is run by E5-T10 as a gate
only.

## 2. Decisions (binding for the tasks)

Each names the `docs/EFFECT.md` decision it serves. A task that cannot follow one makes the smallest deviation and records it in its
commit body; E5-T10 copies it to section 10. Where a decision says "as E4 P<n>", the E4 plan's text
(`docs/plans/e4-finance-services.md` section 2) applies with script paths.

**P1 — One script runner, `runScript` (E10, E12).** E5-T01 adds `apps/api/scripts/support/main.ts`, which imports ONLY `effect` and
`@effect/platform-bun` (never a repo file: `migrate.ts` and `seed.ts` import it statically before their pre-steps, P2). It exports:

- `class ScriptExit extends Schema.TaggedError<ScriptExit>()("ScriptExit", { code: Schema.Number })` with
  `[Runtime.errorExitCode]` returning `this.code` and `[Runtime.errorReported] = false` (the script printed its own line before
  failing; the shape of `agent-patterns/effect-cli.md` section 4; check the class-field form against `agent-patterns/effect-errors.md`).
  A script raises it with `return yield* new ScriptExit({ code: 1 })` after its `Console.error(...)`.
- `makeScriptTeardown(exitProcess: (code: number) => void): Runtime.Teardown`: `Runtime.defaultTeardown(exit, (code) => { onExit(code);
  exitProcess(Exit.isSuccess(exit) && Predicate.isNumber(exit.value) ? exit.value : code) })` (the exact composition is the task's; the
  rule is: a program that SUCCEEDS with a number exits with that number, with `void` exits 0, a failure exits with the error's marker
  code (1 when it has none), an interruption 130, and the process ALWAYS ends with an explicit `process.exit(code)` after the scope
  has closed — what the old scripts did with their trailing `process.exit(0)` / `process.exit(exitCode)`, so a lingering handle (a
  detached token sweep, an SMTP socket) never keeps a finished script alive).
- `runScript<E>(program: Effect.Effect<number | void, E, never>): void` = `BunRuntime.runMain(program, { teardown:
  makeScriptTeardown((code) => process.exit(code)) })`. The caller provides its layer (`Effect.provide(AppLayer)`) before calling it.
  The ONE `process.exit(` of the scripts' Effect code lives here (idioms rule (12), P14).

Every script calls it under `if (import.meta.main) { … }` (a test may import a script's exports without running it, as
`finance-import-xlsx.test.ts` and `legacy-cli.test.ts` do). A script's body is one `Effect.gen` value (or an `Effect.fn` where it takes
arguments); it never calls `process.exit`. `migrate-legacy.ts` does NOT use `runScript` (P10).

**P2 — Which layer each script runs on, and what it may import before (E10, E5, E7).** Seven scripts run on `AppLayer`
(`Effect.provide(AppLayer)`, a fresh memo map per process; `Database.layer` is the shared client, so the script writes `DATABASE_URL`
exactly as today). They never call a module's `start()` (no scheduler in a script). The import constraints of today stay:

| Script | Static imports allowed | The `AppLayer` is reached |
| --- | --- | --- |
| `migrate.ts` | `effect`, `./support/main.ts` | by a dynamic `import("../src/runtime.ts")` AFTER `process.env.SESSION_SECRET ||= "db-migrate-does-not-use-the-session-secret"` (statement order unchanged) |
| `seed.ts` | `effect`, `./support/main.ts`, `../src/config.ts` (the graph root: `AppConfig`, no database) | by a dynamic `import("../src/runtime.ts")` inside the program AFTER the production refusal (P5): nothing that imports `src/db/client.ts` loads before it, so a refusal creates no database file (tested, P13) |
| `reset-password.ts`, `uploads-gc.ts`, `plan-run.ts`, `localize-images.ts` | anything (they imported `db` statically before) | statically |
| `finance-import-xlsx.ts` | today's static imports (pure parsers, `@toon/shared`, `drizzle-orm`) plus `effect` and `./support/main.ts`; `Database`, the finance service classes (`FinanceParticipants`, `FinanceCategories`, `FinanceTags`) and the finance schema ONLY as `import type` | by dynamic imports INSIDE the generators, on the write path ONLY: `../src/runtime.ts` in the program's write branch, and `../src/db/database.ts`, the three service files and `../src/modules/finance/schema.ts` inside `writeImportRecords` / `seedFixedCostPlan` (as the file's lines 570-574 and 648-650 do today). `--dry-run` and the no-`--household` path never load `src/db/client.ts` (`docs/modules/finance.md` "prints the reconciliation report without opening the database"; checked by `e5-verify.sh xlsx-dry`, P17) |
| `migrate-legacy.ts` | node builtins, types, `effect`, `@effect/platform-bun` (P10) | never: explicit layers from the values it resolved (P9, P10) |

Writing `const { AppLayer } = yield* Effect.promise(() => import("../src/runtime.ts"))` inside a program and then
`yield* inner.pipe(Effect.provide(AppLayer))` is the shape for the dynamic cases (the provide is inside the program, so the layer's
scope still closes before the teardown).

**Why a value import is enough to break a dry run.** `apps/api/src/db/database.ts` statically imports `./client.ts` (its line 43),
and every finance service file imports `database.ts`; `src/db/client.ts` validates the environment and creates the database file AT
IMPORT. A value import of `Database`, a finance service class or the finance schema at a script's top level therefore opens (or, in
an operator's shell without `SESSION_SECRET` / `DATABASE_URL`, crashes on) the database on every run, a dry run included. Type
positions (`Effect.Effect<…, …, FinanceParticipants | Database>`, a parameter type) take `import type`; the values come from
`yield* Effect.promise(() => import("…"))` inside the generator that needs them, then `const participants = yield*
FinanceParticipants` from the imported module object (P18). A test that inherits `NODE_ENV=test` never sees the mistake (`env.ts`
quietly picks its own temp DB), which is why the check spawns with `NODE_ENV=development` and an explicit `DATABASE_URL` and asserts
that no file appeared (`e5-verify.sh xlsx-dry`, and a case in `finance-import-xlsx.test.ts`, E5-T05). The same rule binds `seed.ts`
(P5 refusal before any database module) and `migrate.ts` (P2 rows 1 and 2).

**P3 — Output is byte-identical; one line is added (E10).** Every line a script prints goes through `Console.log` / `Console.error`
/ `Console.warn` with the SAME arguments (a multi-argument `console.error(prefix, message)` stays two arguments), in the same order and
on the same stream; `migrate-legacy.ts` keeps `process.stdout.write(renderReport(...))` inside `Effect.sync` (the report ends in its
own newline). `Effect.log*` is never used for a script line (it adds a timestamp and level). **The one added line:** a script on
`AppLayer` ends, after its last line, with `[db] database closed` (the release of `Database.layer` when the program's scope closes,
the line the server prints at shutdown); no doc or test pins the last line of these seven scripts (section 1.1), the line is English
ops output (F gotcha 43) and it proves the scope closed. It is recorded as deviation 1 (section 7), not suppressed: a quiet variant
of `Database.layer` would be a second release path for one cosmetic line. `migrate-legacy.ts` closes its own clients and prints no
such line.

**P4 — Argument parsing stays hand-written; `effect/cli` is not adopted (E10 "may").** Every script's surface is pinned or
idiosyncratic: `migrate:legacy`'s `USAGE` text, its exit 2 for a usage error and `node:util` `parseArgs` messages
(`legacy-cli.test.ts`, `docs/migration.md`); `reset-password`'s usage text with exit 1; `finance-import-xlsx`'s `-h` and its exit 1 for
an unrecognised argument; `plan-run`'s single positional (where `--help` is a household id today); `uploads-gc`'s `--min-age-hours=N`
that silently falls back to 24 on a bad value. `Command.run` would add `--version`, `--wizard`, `--completions`, `--log-level`, render
its own help and exit 1 on a parse error. So each parser stays as it is, moved inside the program where it prints or exits (a
`process.exit(n)` of a parser becomes `return yield* new ScriptExit({ code: n })` after the same `Console` line; `finance-import-xlsx`'s
`--help` exits 0 that way). Pure parsers (`resolveCliEnv`, `parseCliArgs`, `readNumberFlag`) stay pure and keep their signatures.
Recorded as deviation 2.

**P5 — Errors (E6, E12).** Exit codes travel as values, never as `process.exit` calls inside the program: `ScriptExit` (P1) or a
numeric success (P1). Error classes of the scripts become `Schema.TaggedError`s that KEEP their observable fields:

| Class (file) | Tag | Fields | Kept members | Raised by |
| --- | --- | --- | --- | --- |
| `CliUsageError` (`migrate-legacy.ts`) | `"CliUsageError"` | `message: Schema.String` | `readonly exitCode = 2`, `instanceof`, `.message` byte-identical (`legacy-cli.test.ts` asserts all three) | `resolveCliEnv`, `parseCliArgs` (pure, still `throw new CliUsageError({ message })` synchronously; the test calls them in `try` / `expect(() => …).toThrow(CliUsageError)`) |
| `LegacyInputError` (`legacy/sources.ts`) | `"LegacyInputError"` | `message` | `exitCode = 2` | `snapshotDatabase` (sync throw, pure), `openLegacyEffect` (`return yield*`) |
| `MappingError` (`legacy/mapping.ts`) | `"MappingError"` | `message` | `exitCode = 2` | `validateMappingOverride`, `parseMappingFile` (pure, sync throw; `legacy-mapping.test.ts` asserts `toBeInstanceOf(MappingError)`) |
| `CopyProgrammingError` (`legacy/copy.ts`) | `"CopyProgrammingError"` | `message` | — | `copyTable` (`return yield*`) |

`AmountParseError` (`finance-import/amounts.ts`) stays a plain `Error` subclass: it belongs to a pure parser that `buildImport`
catches synchronously (P7). A pure function that throws one of the tagged errors is lifted into Effect code with `Effect.suspend(() => {
try { f(); return Effect.void } catch (error) { if (isX(error)) return Effect.fail(error); throw error } })` (a foreign throw stays a
defect, as it was a crash before; never `Effect.die(` — the `i18n:check` stopword "die", CLAUDE.md "Commands") with `isX` a `Predicate`
guard (`Predicate.isTagged(u, "MappingError")`), never `instanceof`. This lift is mandatory at EVERY call of such a function
inside Effect code, not a general preference: the call sites in the library are named in the E5-T06a, E5-T06b and E5-T07 briefs, the
CLI's in P10. Database failures of the library and the scripts are
`DatabaseError({ cause })` (`apps/api/src/lib/errors.ts`; outside the API family); every message a report line or an output line
shows is taken from the RAW error (`error.cause` of a `DatabaseError`, the squashed value otherwise), exactly the text the old `catch
(error)` saw: `insert failed: <driver message>` in `copy.ts`, `[plan-run] <name> (<id>) failed: <message>`. Handlers use
`Effect.catchTag(s)` and `Effect.exit` + `Cause.squash`, never `instanceof` and never `Effect.catch` where the old code caught
everything (CLAUDE.md "Catch-all stays catch-all": a defect must reach the same recovery the old `catch` gave it).

**P6 — Time (E7, E12).** Inside a converted Effect body, `Date.now()` becomes `yield* Clock.currentTimeMillis` (seed's `now`,
`uploads-gc`'s cutoff, the xlsx write path's `now`, `claims.ts`'s `runTime`); `new Date(x).toISOString()` used to FORMAT a value stays.
A pure helper that reads the clock today keeps doing so (`ledgerStatement`'s `Date.now()`, `finance-import-xlsx.ts`'s `todayBerlin()`
takes no argument today: the task may give it the Clock's millis as a parameter; behaviour identical). Rule (11) of the idioms test
covers `services/` only and gains nothing here.

**P7 — Pure stays pure (E3).** Not converted, not services: `finance-import/{amounts,categorize,dates,rent,xlsx-reader}.ts`
(`readWorkbook` is a synchronous read-and-parse; its one caller lifts it with `Effect.try` and maps a failure to the same
`[import-xlsx] …` handling as today), `buildImport`, `printReport`, the plan-seed extraction of `finance-import-xlsx.ts`,
`legacy/report.ts`, `legacy/mapping.ts`, `legacy/types.ts`, the statement builders and `recordSkip` of `legacy/copy.ts`,
`ledgerStatement`, `snapshotDatabase`, `resolveCliEnv`, `parseCliArgs`, the claim-link helpers of `legacy/claims.ts`. The milestone goal's
"`finance-import/*` as services" is therefore not taken (deviation 5): they have no dependency and no I/O beyond one synchronous file
read.

**P8 — The migration as an Effect (E5, E7).** E5-T01 adds to `apps/api/src/db/migrate.ts` an exported
`migrateDatabase = Effect.fn("db.migrate")(function* () { … })`: `const database = yield* Database`; drizzle's `migrate` on the
current root executor through `database.use(...)` (a failure is `DatabaseError({ cause })`); then, reading `API_MODULES` INSIDE the
generator, `yield* module.afterMigrate()` for each module that has one (the hook runs on the same `Database`; `HookError`).
`runMigrations(database = sharedDb): Promise<void>` stays with its signature as the Promise door of the ~20 test files that call it
(several pinned): `Effect.runPromise(migrateDatabase().pipe(Effect.provide(Database.layerFromExecutor(database))))`, rejecting with a
`DatabaseError`'s `cause` and with anything else unchanged (what `runModuleHook` and the bare `await migrate(...)` rejected with;
`.then(undefined, (error: unknown) => Promise.reject(isDatabaseError(error) ? error.cause : error))`, as `runFinanceBridge` does). The
file keeps its import rule: no `src/runtime.ts`, no `src/env.ts` beyond what `db/client.ts` already loads (`migrate-legacy.ts` imports
it after the redirect; `import-order.test.ts` probes it first in a fresh process). `runModuleHook` is no longer imported by it.

**P9 — The `migrate:legacy` library on Effect (E7, E10).** Every exported library function that does I/O becomes an Effect function
(`Effect.fn("legacy.<name>")` for the steps and `run`, `Effect.fnUntraced` for the per-row and per-chunk helpers `readAll`,
`lookupMany`, `loadAll`, `writeEntries`) over the SAME explicit inputs as today: the `MigrationContext` (target `{ db, client, url }`,
the legacy clients, the report, the id maps) or the client it was handed. **Nothing in the library yields `Database` from the
ambient context or reads the shared `db`.** The two places that reach API services build their layer from the explicit target:
`legacy/recipe.ts` runs `foldBackfill()` (`apps/api/src/modules/recipe/migrate.ts`) provided with
`Database.layerFromExecutor(ctx.target.db)`; `legacy/balance.ts` runs `FinanceBalance.use((balance) => balance.getBalance(...))` (P18) inside `withFinanceServices(...)`
(`apps/api/src/modules/finance/layer.ts`, its local memo map) provided with `Database.layerFromExecutor(ctx.target.db)`. The library
never imports `src/runtime.ts` (CLAUDE.md "The CLI never imports `src/env.ts`, and its import order is load-bearing"). Client calls go
through one helper of the new `apps/api/scripts/legacy/io.ts` (E5-T06a): `legacyTry(() => client.execute(...))` =
`Effect.tryPromise({ try, catch: (cause) => new DatabaseError({ cause }) })`; where the old code caught (the batch retry of
`writeEntries`, the `checkSchema` read, the upload copies) the Effect form catches the same failure (`Effect.result` / `Effect.catchTag`
on `DatabaseError`, `Effect.tryPromise` with the old `catch` mapping for `node:fs` calls) and records the same text. `io.ts` also exports
`runLegacy<A, E>(effect: Effect.Effect<A, E>): Promise<A>` = `Effect.runPromise(effect)` with the rejection mapped once (a
`DatabaseError` rejects with its `cause`, anything else with the squashed value: a `MappingError` is that object, so
`rejects.toMatchObject({ exitCode: 2 })` and `toBeInstanceOf(MappingError)` hold).

**Names.** The five functions the PINNED tests (`legacy-cli.test.ts`, `legacy-placeholders.test.ts`, `support/legacy-harness.ts`) call
as Promises keep their old name and signature as Promise bridges over `runLegacy`, in a section `/* legacy bridges: the pinned
legacy-cli and legacy-placeholders tests and legacy-harness.ts; E8 removes them */` at the end of their file, each with its callers in a
one-line comment and an explicit `Promise<T>` return type; their Effect forms get the suffix `Effect` (precedent:
`importFromTextEffect`, E3). Every other function converts IN PLACE under its old name, and its non-pinned test callers move onto it
in the same task (`await f(x)` → `await runLegacy(f(x))`, assertions unchanged):

| File | Effect form | Promise bridge kept | Task |
| --- | --- | --- | --- |
| `legacy/sources.ts` | `openLegacyEffect(source, path, scratchDir)`, `readAll(legacy, sql, args?)` | `openLegacy` || T06a |
| `legacy/ledger.ts` | `lookupMany`, `loadAll` | — || T06a |
| `legacy/copy.ts` | `writeEntries`, `copyTable` | — || T06a |
| `legacy/users.ts` | `migrateUsersEffect(ctx)` | `migrateUsers` || T06b |
| `legacy/households.ts` | `migrateHouseholdsEffect(ctx)` | `migrateHouseholds` || T06b |
| `legacy/claims.ts` | `migrateClaimInvites(ctx)` | — || T06b |
| `legacy/recipe.ts` | `migrateRecipeEffect(ctx)` (resolves `{ backfilled }`) | `migrateRecipe` | T07 |
| `legacy/uploads.ts` | `migrateUploads(ctx)`, `collectLegacyUploadReferences(recipe)` | — | T07 |
| `legacy/finance.ts` | `migrateFinance(ctx)` | — | T07 |
| `legacy/balance.ts` | `verifyBalances(ctx)`, `legacyBreakdown(...)` | — | T07 |
| `legacy/run.ts` | `runLegacyMigrationEffect(options)`, `knownLegacyIds(recipe?, finance?)` | `runLegacyMigration` | T07 |

Between T06a and T07 the files not converted yet call the converted Effects through `runLegacy(...)` where they awaited a primitive
(after T06a: `users.ts`, `households.ts`, `claims.ts` and the five T07 files; after T06b: the five T07 files only) (`await
runLegacy(readAll(...))`, `await runLegacy(copyTable(ctx, spec))`, `run.ts`'s `await runLegacy(migrateClaimInvites(ctx))`); T07 replaces
those interim calls by `yield*`. **The service.** E5-T07 adds `apps/api/scripts/legacy/service.ts`: `class LegacyMigration extends
Context.Service<LegacyMigration, { readonly open: (source, path, scratchDir) => Effect.Effect<LegacyDb, LegacyInputError | DatabaseError,
Scope.Scope>; readonly knownLegacyIds: (recipe?, finance?) => Effect.Effect<KnownIds, DatabaseError>; readonly run: (options: RunOptions)
=> Effect.Effect<Report, …> }>()("toon/api/scripts/legacy/service/LegacyMigration")` with `static readonly layer = Layer.sync(this, () =>
({ … }))` (the thunk reads the imported step functions lazily, never at class evaluation; CLAUDE.md "One composition point": a static
reads no imported binding at evaluation). `open` is `Effect.acquireRelease(openLegacyEffect(...), (legacy) => Effect.sync(() =>
legacy.client.close()))`, so the CLI's legacy clients close with its scope (P10). The CLI is the service's one consumer; the tests
use the functions.

**P10 — `migrate-legacy.ts` as an Effect program, its import discipline kept (E10).** E5-T08. The file:

- statically imports node builtins, TYPES, and the two packages `effect` and `@effect/platform-bun` (they read no environment and
  open no database; deviation 3: the header comment's "only node builtins and TYPES" becomes "only node builtins, the `effect` and
  `@effect/platform-bun` packages, and TYPES", the reason stated). It never imports a repo file statically and never mentions
  `src/env` (the guard's regex `^import [^t].*from "(\.\.\/src|\.\/legacy)\/` and its `not.toContain("src/env")` stay true);
- keeps `USAGE`, `CliUsageError` (P5), `resolveCliEnv`, `parseCliArgs`, `mergeRootDotEnv`, `snapshotTarget` (pure, same signatures and
  messages) and exports `main` as an Effect function `main(argv = process.argv.slice(2), env = process.env)` whose success value is the
  exit code (0, 1, 2) as today's `main` returned it;
- performs steps a to h of today's `main` inside one `Effect.gen` in the same order with the same lines: (a) parse, `--help` prints
  `USAGE` and returns 0; (b) `resolveCliEnv`, the two mode lines; (c) the scratch directory as `Effect.acquireRelease(mkdtempSync…,
  rmSync…)` acquired FIRST (so it is removed LAST), `snapshotTarget`, then the two `process.env` writes, the line
  `process.env.DATABASE_URL = \`file:${scratchTarget}\`` textually BEFORE the first `import(` of the file; (d) the dynamic imports in
  the order `import("../src/db/client.ts")`, `import("../src/db/migrate.ts")`, `import("./legacy/sources.ts")`, then the rest (the
  textual guards of `legacy-cli.test.ts` "no dynamic import before the DATABASE_URL redirect; the first one is the db client" and "the
  migrator follows the client and the library follows both" read the file text: the first occurrence of `import(` in the WHOLE file,
  comments included, must be `import("../src/db/client.ts")`), each through `Effect.promise(() => import(...))`; the shared scratch
  client's close as a finalizer; (e) the legacy inputs through `LegacyMigration.open` (scoped) and the mapping; (f) the dry pass on the
  scratch copy (`migrateDatabase` on `Database.layerFromExecutor(scratchDb)` after `dbReady`, then `LegacyMigration.run`); (g) on
  `--apply` with a clean dry pass, the real target as a scoped resource (`createDatabase({ url })` + `ready`, closed in the scope, or
  `Database.layerFromUrl(databaseUrl)` read back into a `TargetDb`; the task chooses and keeps the `PRAGMA wal_checkpoint(TRUNCATE)`
  before the close), `migrateDatabase` on it, the real pass with `webOrigin`; (h) the JSON report. Release order = today's `closers`
  reversed: real target, finance, recipe, scratch client, then the scratch directory.
- **lifts every synchronous exit-2 throw before it can become a defect.** `resolveCliEnv`, `parseCliArgs`, `snapshotTarget` and
  `parseMappingFile` stay pure and keep throwing synchronously (P4, P5, P7; the in-process tests call them that way). A `throw` inside
  `Effect.gen`, `Effect.sync` or a bare `Effect.suspend` thunk is a DEFECT: `Effect.catchTags` never sees it, `runMain` logs the cause
  and the run exits 1 without the three stderr lines (CLAUDE.md "Catch-all stays catch-all"). So the file defines ONE lift in itself
  (it may not import a repo file statically): `liftExitTwo = <A>(f: () => A): Effect.Effect<A, CliUsageError | MappingError |
  LegacyInputError> => Effect.suspend(() => { try { return Effect.succeed(f()) } catch (error) { if (isExitTwoError(error)) return
  Effect.fail(error); throw error } })`, with the guard `isExitTwoError = (u: unknown): u is CliUsageError | MappingError |
  LegacyInputError => Predicate.isTagged(u, "CliUsageError") || Predicate.isTagged(u, "MappingError") || Predicate.isTagged(u,
  "LegacyInputError")` (`MappingError` and `LegacyInputError` reach the file as `import type` from `./legacy/mapping.ts` and
  `./legacy/sources.ts`, which the textual guard `^import [^t]` allows; a foreign throw is rethrown and stays a defect, as the old
  `throw error` was a crash; never `Effect.die(`, never `instanceof`). The call sites, each written `yield* liftExitTwo(() => …)` and
  never called bare inside the generator:
  1. `parseCliArgs(argv, REPO_ROOT)` (step a: `node:util` `parseArgs` messages, `give at least one of --recipe-db and --finance-db`,
     `--recipe-uploads needs --recipe-db`, `--mapping needs --finance-db`);
  2. `resolveCliEnv(env, REPO_ROOT)` (step b: a missing, remote or in-memory `DATABASE_URL`);
  3. `snapshotTarget(targetPath, scratchTarget)` (step c: `the target is not a file: <path>`);
  4. `parseMappingFile(readFileSync(options.mapping, "utf8"), known)` (step e: `MappingError`; the `readFileSync` inside the same thunk,
     `known` yielded from `LegacyMigration.knownLegacyIds` BEFORE the lift, never inside the thunk);
  5. the inline `--mapping: file not found: <path>` check is not a pure call: it becomes `return yield* new CliUsageError({ message:
     \`--mapping: file not found: ${options.mapping}\` })` (typed, no lift).
  The library lifts its own throwers where it calls them (`snapshotDatabase` in `openLegacyEffect`, E5-T06a; `validateMappingOverride`
  in `migrateHouseholdsEffect`, E5-T06b, and in `runLegacyMigrationEffect`, E5-T07), so `LegacyMigration.open` and `.run` fail with
  them in the typed channel. Then `Effect.catchTags({ CliUsageError, MappingError, LegacyInputError })` maps the three to the stderr
  lines of today (`[migrate:legacy] error: <message>`, `Run with --help for the usage.` for `CliUsageError` only, `[migrate:legacy]
  nothing was written.`) and the value 2. `Effect.catchTags` has an excess-key check (`repos/effect/packages/effect/src/Effect.ts`
  ~2917: a key outside the error channel is typed `never`), so `tsc` accepting the call is the compile-time evidence that the lifts
  put the three tags into the channel: never cast past it. Anything else propagates (a crash, exit 1, as the old `throw error` did).
  The in-process `runLegacyMigration(...).rejects.toMatchObject({ exitCode: 2 })` of `legacy-cli.test.ts` CANNOT see a missing lift
  (`Cause.squash` of a defect is the same object); only a subprocess can, hence the five spawns of `legacy-cli-usage.test.ts`
  (E5-T08), two of which cover the paths no test reaches today (`the target is not a file`, `--mapping: file not found`);
- runs under `if (import.meta.main)` with `BunRuntime.runMain(main(), { teardown })` where `teardown` sets `process.exitCode` to the
  success value (or `Runtime.defaultTeardown`'s code for a failure) and NEVER calls `process.exit`: the report reaches a piped stdout
  exactly as today (`process.exitCode = await main()`), and the subprocess cases of `legacy-cli.test.ts` read it to its last line.

`legacy-cli.test.ts` is not edited (no file name changed, so its text guard needs no update; deviation none).

**P11 — Bridges removed by E5, and the survivors (ADR 0014).** A bridge is deleted in the commit that moves its last non-test caller,
and its test callers move onto the service in the same commit (a local helper with the old name in the test file is allowed, as
`apps/api/test/recipe-remote-image.test.ts` does, so the assertion lines stay byte-identical):

| Bridge | File | Moved callers | Task |
| --- | --- | --- | --- |
| `initializeHousehold` | `apps/api/src/core/services/households/modules.ts` | `seed.ts` | T02 |
| `findUserByEmail` | `apps/api/src/core/services/auth/users.ts` | `reset-password.ts` | T02 |
| `createPasswordResetToken` | `apps/api/src/core/services/auth/passwordReset.ts` | `reset-password.ts` | T02 |
| `trySendMail` | `apps/api/src/core/services/mail/index.ts` | `reset-password.ts`; it SURVIVES if `apps/api/test/mail.test.ts` (or another test) still calls it: then only its caller list changes (E8) | T02 |
| `runCatchUp` | `apps/api/src/modules/finance/services/plan/accrual.service.ts` | `plan-run.ts`, `finance-security.test.ts` (local helper over `runFinanceBridge`) | T03 |
| `collectUploadReferences(database, modules)` | `apps/api/src/core/services/media/references.ts` | `uploads-gc.ts` | T04 |
| `localizeImageUrl` | `apps/api/src/modules/recipe/services/recipes/remoteImage.ts` | `localize-images.ts` | T04 |
| `slot1UserId`, `requireOtherMemberId` | `.../participants/participants.service.ts` | `finance-import-xlsx.ts` | T05 |
| `categoryIdBySlug` | `.../categories/categories.service.ts` | `finance-import-xlsx.ts` | T05 |
| `syncTransactionTags` | `.../tags/tags.service.ts` | `finance-import-xlsx.ts` | T05 |
| finance `withTransaction` | `apps/api/src/modules/finance/services/support.ts` | `finance-import-xlsx.ts`, `finance-file-db.test.ts` cases (a) and (d) onto `Database.transaction` | T05 |
| `getBalance` | `.../ledger/balance.service.ts` | `legacy/balance.ts`, `legacy-finance.test.ts`, `finance-scheduler.test.ts` | T07 |
| `backfillFoldedColumns` | `apps/api/src/modules/recipe/migrate.ts` | `legacy/recipe.ts`, `legacy-recipe.test.ts` | T07 |
| `runModuleHook` and `apps/api/src/modules/adapter.ts` | — | `runMigrations` (T01), seed (T02), references (T04), recipe migrate (T07), `runFinanceBridge` inlines it, `module-adapter.test.ts` (P12) | T09 |

Measure "no caller left" with `grep -rnw '<name>' apps/api/src apps/api/scripts apps/api/test` and read each hit (a service METHOD of the
same name is not a caller of the bridge). **Survivors after E5** (E8 removes them; the pinned tests need them): finance
`assignParticipants`, `updateParticipantDisplayName`, `requireFinanceParticipantContext`; core `requireUser`, `requireMembership`, the test
seams (`checkRateLimit`, `resetRateLimits`, `setMailer`, `getMailer`, `isMailerOverridden`, `claimPlaceholderUser`, `createSession`),
`trySendMail` if a test still calls it; recipe `createDraft`, the synchronous `importFromText`, `fetchHtml`, `assertPublicUrl`; the
legacy library's five Promise bridges (P9); `runMigrations` (the Promise door, P8); `runFinanceBridge` (the runner of the finance
survivors). A bridge file whose `runtime` import loses its last user drops the import in the same commit.

**P12 — `runModuleHook` goes (E7; ADR 0014 "E5 removes it").** After T01 to T07 its only user is `runFinanceBridge`. E5-T09 inlines
it there (`Effect.runPromise(withFinanceServices(effect).pipe(Effect.provide(Database.layerFromExecutor(executor))))` with the existing
rejection mapping), deletes `apps/api/src/modules/adapter.ts`, moves the three `describe("runModuleHook")` cases of
`apps/api/test/module-adapter.test.ts` onto a local helper with the same body and the same assertions (case count unchanged),
replaces the entry `"./src/modules/adapter.ts"` of `apps/api/test/import-order-effect.test.ts` by `"./src/db/migrate.ts"` (count
unchanged; `migrate.ts` now holds `migrateDatabase`), and edits every repo path `apps/api/src/modules/adapter.ts` out of `CLAUDE.md`, the
module docs and `docs/open-work.md` in the same commit (`apps/api/test/docs-paths.test.ts` fails otherwise).

**P13 — Tests (E9).**

- **Pinned (unchanged since `9a1272a8e`, `bash docs/plans/e5-verify.sh pinned`):** `legacy-cli`, `legacy-placeholders`,
  `legacy-fixtures`, `legacy-migration-doc`, `import-order`, `db-pragmas`, `middleware`, `api-doc`, `placeholders`, `security`,
  `finance-plan`, `finance-settlements`, `finance-participants`, `finance-cross-household`, `finance-module`, `recipe-cross-household`,
  the six `deploy*` / `deployment-doc` tests, `apps/api/test/support/legacy-harness.ts`, `apps/api/test/fixtures/`, plus `docs/API.md`,
  `docs/migration.md`, `docs/deployment.md`, `apps/api/drizzle`, `packages/shared`, `apps/web`, `docker/`, `Dockerfile`,
  `docker-compose.yml`, `.github/`, the root `scripts/` (dev, typecheck, i18n-check, icons stay plain Bun), the three `package.json` and
  `bun.lock` (no dependency changes: `effect` and `@effect/platform-bun` are already pinned in `apps/api`).
- **Rewritten (assertions unchanged, in the task that removes what they call):** `finance-security.test.ts` (T03),
  `finance-import-xlsx.test.ts` and `finance-file-db.test.ts` (T05; `finance-import-xlsx.test.ts` also gains
  the `NODE_ENV=development` dry-run case), `legacy-framework` and `legacy-recipe` (T06a call sites of converted primitives;
  `legacy-users` and `legacy-households` call the kept bridges and stay as they are), `legacy-recipe`, `legacy-finance`, `finance-scheduler` (T07),
  `module-adapter.test.ts` and `import-order-effect.test.ts` (T09), `effect-idioms.test.ts` (T09, rule (12)).
- **Characterisation first.** A task that converts a script with no test today FIRST writes a subprocess test against the UNCONVERTED
  script, runs it green, THEN converts and runs it again unchanged; both in the same commit. Each such test spawns `bun
  apps/api/scripts/<name>.ts` with `cwd` the repo root and an explicit env: `NODE_ENV=development` (never the inherited `test`: under
  it `env.ts` picks its own temp DB, CLAUDE.md "Subprocess tests of the CLI set `NODE_ENV=development`"), an absolute
  `DATABASE_URL=file:<tmp>/x.db`, `UPLOAD_DIR=<tmp>/uploads`, `SESSION_SECRET` of 32 hex characters, and every other variable the
  assertion depends on; no network; a `test(...)` timeout of 120 s (parallel worktrees, CLAUDE.md "A test that runs `sharp` carries an
  explicit time budget"); temp dirs removed in `afterEach`. Assertions are on exit codes and on lines that exist in BOTH versions (the
  trailing `[db] database closed` of P3 is never asserted absent or present by these tests). New files: `apps/api/test/scripts-main.test.ts`
  (T01), `apps/api/test/scripts-seed.test.ts` (T02), `apps/api/test/scripts-plan-run.test.ts` (T03), `apps/api/test/scripts-uploads.test.ts`
  (T04), `apps/api/test/legacy-io.test.ts` (T06a), `apps/api/test/legacy-cli-usage.test.ts` (T08). E5-T05 adds one subprocess case to
  `finance-import-xlsx.test.ts` (the dry run with `NODE_ENV=development` leaves no database file).
- The pass count never drops below 14725 (`bash docs/plans/e5-verify.sh suite`); a removed case is replaced in the same commit.

**P14 — Idioms rule (12) (E12, E10).** E5-T09 adds to `apps/api/test/effect-idioms.test.ts`, in the shape of rules (10) and (11) (a
comment-free line scan, `file:line: code` failures, a pinned allow list with a stale-entry check), the rule **"(12) the scripts are
Effect programs (E10)"**: (a) every `.ts` file directly under `apps/api/scripts/` contains `runScript(` or `BunRuntime.runMain(`;
(b) no `process.exit(` under `apps/api/scripts/` except the one line of `apps/api/scripts/support/main.ts` (allow list:
that file, reason "the runner's teardown, P1"); (c) no `await ` under `apps/api/scripts/legacy/` and `apps/api/scripts/finance-import/`
(the library is Effect; the Promise bridges return `runLegacy(...)` without awaiting); (d) no `runModuleHook` anywhere under
`apps/api/src`, `apps/api/scripts`. The header comment's list ("E1 switched on rule (9), E2 rules (10) and (11)") gains "E5 rule (12)".
Never relax a rule to get green.

**P15 — Import order (CLAUDE.md "API import cycle", "The CLI never imports `src/env.ts`").** The pinned `import-order.test.ts` entries
keep loading first in a fresh process (`./src/db/migrate.ts`, the three core service files, the five legacy files). No library file,
`src/db/migrate.ts`, `src/modules/finance/bridge.ts` or `scripts/support/main.ts` imports `src/runtime.ts`. A service class static reads
no imported binding at evaluation (P9's `Layer.sync` thunk). `bun test apps/api/test/import-order.test.ts
apps/api/test/import-order-effect.test.ts apps/api/test/legacy-cli.test.ts` (`e5-verify.sh order` plus `legacy`) is in the verify list
of every task that touches these files.

**P16 — Documents and the ADR (E10; the SPEC rule for §1 text).** E5-T10 writes ADR 0014's "Status after E5's integration" (the bridges
removed, the survivors with callers and E8, `runModuleHook` deleted, and that the process-wide client stays created at import of
`src/db/client.ts` because the tests' shared `db` (ADR 0009) and `migrate-legacy.ts`'s pinned import order read it: deviation 6) and,
in the SAME commit, edits `docs/EFFECT.md` E5's sentence "Until E5 moves the last script, the process-wide instance is still created at
import …" to say it stays until E8 decides, citing ADR 0014. It updates CLAUDE.md (Status with the pass count, Layout "Scripts (E5)",
the gotchas "The CLI never imports `src/env.ts`…" (the static `effect` imports, the Effect program), "Bridges until E5 to E8" → "Bridges
until E8", "Hooks are Effects…" (`runModuleHook` gone), the idioms paragraph with rule (12), the `i18n:check` count), `docs/SPEC.md` §2's
`runModuleHook` sentence, `docs/modules/recipe.md` and `docs/modules/finance.md` (the bridge tables, the scripts' service use),
`agent-patterns/effect-cli.md` and `agent-patterns/effect-services.md` ("As built (E5)": `runScript`, the teardown, `LegacyMigration`,
copied from the code), and this file's sections 9 and 10. `docs/API.md`, `docs/migration.md` and `docs/deployment.md` are NOT edited (no
pinned line changes; the added `[db] database closed` line is recorded in this plan and CLAUDE.md, not in the operator guides).

**P17 — The verify script (E5-T01 writes it verbatim, later tasks run it).** `docs/plans/e5-verify.sh`:

```bash
#!/usr/bin/env bash
# The verification snippets of plan docs/plans/e5-scripts.md (P17). Run from anywhere:
#   bash docs/plans/e5-verify.sh <suite|pinned|repos|types|idioms|order|legacy|fixture|fixture-record|xlsx-dry|statics|all>
# Each subcommand exits 0 on success and non-zero with the evidence printed on failure.
# ROOT is the checkout (or worktree) that holds this copy of the script; E5_FIXDIR overrides where the fixture baseline lives
# (E5-T06a keeps a scratch baseline under the ignored migration-out/ before T01's is merged).
set -u
ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || exit 2
cd "$ROOT" || exit 2

BASE=9a1272a8e   # E5 base commit (plan section 1.1)
FLOOR=14725      # pass count of the base (plan section 1.2)
FIXDIR="${E5_FIXDIR:-docs/plans/e5-fixture}"

suite() {
  local log status pass
  log="$(mktemp)"
  bun test >"$log" 2>&1
  status=$?
  tail -6 "$log"
  if [ "$status" -ne 0 ]; then
    grep -nE '^\(fail\)|Unhandled error' "$log" | head -40
    echo "[e5-verify] bun test exited $status (log: $log)"
    return 1
  fi
  pass="$(grep -oE '^ *[0-9]+ pass' "$log" | awk '{print $1}' | tail -1)"
  if [ -z "$pass" ] || [ "$pass" -lt "$FLOOR" ]; then
    echo "[e5-verify] pass count ${pass:-?} is below the floor $FLOOR"
    return 1
  fi
  echo "[e5-verify] suite OK: $pass pass (floor $FLOOR)"
}

PINNED=(
  apps/api/test/legacy-cli.test.ts apps/api/test/legacy-placeholders.test.ts apps/api/test/legacy-fixtures.test.ts
  apps/api/test/legacy-migration-doc.test.ts apps/api/test/import-order.test.ts apps/api/test/db-pragmas.test.ts
  apps/api/test/middleware.test.ts apps/api/test/api-doc.test.ts apps/api/test/placeholders.test.ts apps/api/test/security.test.ts
  apps/api/test/finance-plan.test.ts apps/api/test/finance-settlements.test.ts apps/api/test/finance-participants.test.ts
  apps/api/test/finance-cross-household.test.ts apps/api/test/finance-module.test.ts apps/api/test/recipe-cross-household.test.ts
  apps/api/test/deploy-caddyfile.test.ts apps/api/test/deploy-compose.test.ts apps/api/test/deploy-dockerfile.test.ts
  apps/api/test/deploy-script.test.ts apps/api/test/deploy-workflows.test.ts apps/api/test/deployment-doc.test.ts
  apps/api/test/support/legacy-harness.ts apps/api/test/fixtures
  docs/API.md docs/migration.md docs/deployment.md apps/api/drizzle packages/shared apps/web
  docker Dockerfile docker-compose.yml .github scripts package.json apps/api/package.json bun.lock
)

pinned() {
  if git diff --quiet "$BASE" -- "${PINNED[@]}"; then
    echo "[e5-verify] pinned files unchanged since $BASE"
  else
    echo "[e5-verify] a pinned file changed:"
    git diff --stat "$BASE" -- "${PINNED[@]}" | tail -20
    return 1
  fi
}

repos() {
  local dirty
  dirty="$(git status --porcelain repos/ | wc -l)"
  if [ "$dirty" -eq 0 ]; then echo "[e5-verify] repos/ clean"; else git status --porcelain repos/ | head; return 1; fi
}

types() { bun run typecheck; }
idioms() { bun test apps/api/test/effect-idioms.test.ts; }
order() { bun test apps/api/test/import-order.test.ts apps/api/test/import-order-effect.test.ts; }
legacy() { bun test apps/api/test/legacy-cli.test.ts apps/api/test/legacy-placeholders.test.ts apps/api/test/legacy-fixtures.test.ts; }

# The fixture run of CLAUDE.md "Commands" (dry run, --apply, --apply again), straight through bun (no `bun run` prefix).
FIX_ARGS=(--recipe-db apps/api/test/fixtures/legacy/recipe.db --recipe-uploads apps/api/test/fixtures/legacy/uploads
  --finance-db apps/api/test/fixtures/legacy/finance.db)
fixture_run() {
  local d="$1"; shift
  NODE_ENV=development DATABASE_URL="file:$d/target.db" UPLOAD_DIR="$d/uploads" \
    bun apps/api/scripts/migrate-legacy.ts "${FIX_ARGS[@]}" "$@"
}
# The baseline must not depend on the checkout path: the report names the fixture inputs by absolute path
# (`recipe: <ROOT>/apps/api/test/fixtures/legacy/recipe.db (schema …)`, the missing-upload warning), and a task in a
# parallel worktree runs under <repo>/.worktrees/<slug>. So the checkout root is replaced FIRST, then the temp dir.
normalize() {
  sed -e "s#$ROOT#<ROOT>#g" -e "s#$1#<D>#g" \
    -E -e 's#[^ ]*toon-migrate-legacy-[A-Za-z0-9]+#<scratch>#g' \
    -e 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<uuid>/g' \
    -e 's#/invite/[A-Za-z0-9_-]+#/invite/<token>#g'
}
fixture() {
  local mode="${1:-check}" d failed=0 c1 c2 c3 name
  d="$(mktemp -d)"
  fixture_run "$d" >"$d/dry.out" 2>"$d/dry.err"; c1=$?
  if [ -e "$d/target.db" ] || [ -e "$d/target.db-wal" ]; then echo "[e5-verify] the dry run left a target file"; failed=1; fi
  fixture_run "$d" --apply >"$d/apply.out" 2>"$d/apply.err"; c2=$?
  fixture_run "$d" --apply >"$d/again.out" 2>"$d/again.err"; c3=$?
  echo "[e5-verify] fixture exit codes: dry=$c1 apply=$c2 again=$c3 (want 0 0 0)"
  [ "$c1$c2$c3" = "000" ] || failed=1
  for name in dry apply again; do
    if [ -s "$d/$name.err" ]; then echo "[e5-verify] stderr of $name:"; head -20 "$d/$name.err"; failed=1; fi
  done
  tail -n1 "$d/dry.out" | grep -qE '^\[migrate:legacy\] dry run complete: [0-9]+ rows would be written, [0-9]+ files would be copied\. Nothing was written\.$' \
    || { echo "[e5-verify] dry run: wrong last line"; failed=1; }
  tail -n1 "$d/apply.out" | grep -qE '^\[migrate:legacy\] applied: [0-9]+ rows written, 7 files copied\.$' \
    || { echo "[e5-verify] apply: wrong last line"; failed=1; }
  tail -n1 "$d/again.out" | grep -qxF '[migrate:legacy] already migrated: nothing written.' \
    || { echo "[e5-verify] second apply: wrong last line"; failed=1; }
  for name in dry apply again; do normalize "$d" <"$d/$name.out" >"$d/$name.norm"; done
  if grep -qF "$ROOT" "$d/dry.norm" "$d/apply.norm" "$d/again.norm"; then
    echo "[e5-verify] the normalised output still contains the checkout path $ROOT"; failed=1
  fi
  if [ "$mode" = "record" ]; then
    mkdir -p "$FIXDIR"
    for name in dry apply again; do cp "$d/$name.norm" "$FIXDIR/$name.norm"; done
    echo "[e5-verify] fixture outputs recorded in $FIXDIR"
  else
    for name in dry apply again; do diff -u "$FIXDIR/$name.norm" "$d/$name.norm" || failed=1; done
    [ "$failed" -eq 0 ] && echo "[e5-verify] fixture run identical to the recorded base output"
  fi
  rm -rf "$d"
  return "$failed"
}

# finance:import-xlsx --dry-run must never load src/db/client.ts (plan P2, E5-T05): spawned with NODE_ENV=development
# (never the inherited test), an explicit DATABASE_URL in a temp dir and NO SESSION_SECRET; exit 0, the dry-run lines, no file.
xlsx_dry() {
  local d failed=0 c1 c2
  d="$(mktemp -d)"
  bun -e "import { writeSyntheticWorkbook } from '$ROOT/apps/api/test/support/finance-synthetic-workbook.ts'; writeSyntheticWorkbook('$d/w.xlsx')" \
    || { echo "[e5-verify] could not write the synthetic workbook"; rm -rf "$d"; return 1; }
  env -u SESSION_SECRET -u TEST_DATABASE_URL NODE_ENV=development DATABASE_URL="file:$d/x.db" \
    bun apps/api/scripts/finance-import-xlsx.ts "$d/w.xlsx" --dry-run >"$d/a.out" 2>"$d/a.err"; c1=$?
  env -u SESSION_SECRET -u TEST_DATABASE_URL NODE_ENV=development DATABASE_URL="file:$d/x.db" \
    bun apps/api/scripts/finance-import-xlsx.ts "$d/w.xlsx" --household nope --dry-run >"$d/b.out" 2>"$d/b.err"; c2=$?
  echo "[e5-verify] xlsx dry-run exit codes: $c1 $c2 (want 0 0)"
  [ "$c1$c2" = "00" ] || { head -20 "$d/a.err" "$d/b.err"; failed=1; }
  grep -qxF '[import-xlsx] no --household given: no database write performed.' "$d/a.out" || { echo "[e5-verify] dry run: line missing"; failed=1; }
  grep -qxF '[import-xlsx] --dry-run: no database write performed.' "$d/b.out" || { echo "[e5-verify] --household --dry-run: line missing"; failed=1; }
  if [ -e "$d/x.db" ] || [ -e "$d/x.db-wal" ]; then echo "[e5-verify] the dry run opened the database (x.db exists)"; failed=1; fi
  [ "$failed" -eq 0 ] && echo "[e5-verify] xlsx dry run never touched the database"
  rm -rf "$d"
  return "$failed"
}

# No hand-written static accessors on a service class (plan P18): an added `static` member is a `layer…` or nothing.
statics() {
  local hits
  hits="$(git diff "$BASE" -- apps/api/src apps/api/scripts | grep -E '^\+[[:space:]]+static ' | grep -vE '^\+[[:space:]]+static readonly layer[A-Za-z]*[[:space:]]*[=:]')"
  if [ -n "$hits" ]; then echo "[e5-verify] added static members other than a layer:"; echo "$hits"; return 1; fi
  echo "[e5-verify] no static accessors added since $BASE"
}

case "${1:-}" in
  suite) suite ;;
  pinned) pinned ;;
  repos) repos ;;
  types) types ;;
  idioms) idioms ;;
  order) order ;;
  legacy) legacy ;;
  fixture) fixture check ;;
  fixture-record) fixture record ;;
  xlsx-dry) xlsx_dry ;;
  statics) statics ;;
  all) types && idioms && order && legacy && pinned && repos && statics && xlsx_dry && fixture check && suite ;;
  *) echo "usage: bash docs/plans/e5-verify.sh <suite|pinned|repos|types|idioms|order|legacy|fixture|fixture-record|xlsx-dry|statics|all>"; exit 2 ;;
esac
```

E5-T01 runs `fixture-record` on the UNCHANGED base tree (before its first edit: `runMigrations` is on the CLI's path), then
`fixture` once more to prove the normalised output is deterministic (if it is not, it extends `normalize` with the smallest further
rule, records why in its commit body, and records again), and commits the script with `docs/plans/e5-fixture/{dry,apply,again}.norm`.
**The baseline must not depend on the checkout path.** Wave 1 runs in isolated worktrees (`<repo>/.worktrees/<slug>`), so T01 records
it under a worktree path and every later task checks it in another worktree or on `main`; the report prints the fixture inputs by
absolute path, which is why `normalize` replaces `$ROOT` (the toplevel of the checkout holding the script) before anything else, and
`fixture` fails when a normalised file still contains `$ROOT`. Before committing, T01 also proves it: `grep -rlE
'/home/|\.worktrees' docs/plans/e5-fixture` is empty. A later task NEVER re-records the baseline (`fixture-record` is T01's alone,
on the base tree): a diff is a regression to fix, not a baseline to refresh; a genuinely environment-dependent line found later gets
one further `normalize` rule in a commit that says so, and the recorded files are re-normalised from themselves (`sed` with the new
rule), never re-recorded from a converted tree.
The normalised apply output contains no live credential (`/invite/<token>`; the fixture's token is test data of
`apps/api/test/fixtures/legacy/facts.ts` anyway). From then on `fixture` is the proof that the report and the exit codes did not move.

**P18 — Service calls are v4 calls; no static accessors (E12; `repos/effect/packages/effect/src/Context.ts` ~106-107 and ~300-303).**
In `effect@4.0.5` a `Context.Service` class has no accessors: its static side offers `use` / `useSync` and whatever the class
declares, and every service of this repo declares only `static readonly layer` (and `layer…` variants such as `Database.layerFrom`).
So `FinanceAccrual.runCatchUp(…)`, `HouseholdModules.initializeHousehold(…)`, `FinanceBalance.getBalance(…)` and the like do NOT
compile. A brief that names "the `runCatchUp` of `FinanceAccrual`" means one of the two v4 spellings:

```ts
const accrual = yield* FinanceAccrual            // the service value, once per program or step
const result = yield* accrual.runCatchUp(id, options)
// or, for a single call:
const result = yield* FinanceAccrual.use((accrual) => accrual.runCatchUp(id, options))
```

No task adds a static method, getter or field other than a `layer…` to a service class (or to any class under `apps/api/src`,
`apps/api/scripts`) to get the v3 shape back: idioms rule (4) does not see a hand-written accessor, `bash docs/plans/e5-verify.sh
statics` does. `ScriptExit` and the tagged errors carry instance members (`exitCode`, the `Runtime` symbols), not statics.

## 3. Waves and file ownership

Two tasks of one wave never share a file. Shared files: `CLAUDE.md` and the docs are edited by T09 (paths only) and T10; the idioms
test by T09; `apps/api/src/db/migrate.ts` by T01 only; `docs/plans/e5-verify.sh` and `docs/plans/e5-fixture/` by T01 only (T06a
keeps its own scratch copy under the ignored `migration-out/`, never committed). The legacy library is converted in three sequential
tasks (T06a primitives, T06b steps, T07 the rest and the service) so each lands with the fixture diff of P17 run against the base.

| Wave | Task | Tier | Owns (creates or edits) |
| --- | --- | --- | --- |
| 1 | E5-T01 runner, `migrateDatabase`, `db:migrate`, verify script | core | `apps/api/scripts/support/main.ts` (new), `apps/api/scripts/migrate.ts`, `apps/api/src/db/migrate.ts`, `apps/api/test/scripts-main.test.ts` (new), `docs/plans/e5-verify.sh` (new), `docs/plans/e5-fixture/*.norm` (new) |
| 1 | E5-T06a legacy library part 1: errors, `io.ts`, primitives | core | `apps/api/scripts/legacy/{io,sources,ledger,copy,mapping}.ts` (`io.ts` new), the interim call sites in `apps/api/scripts/legacy/{users,households,claims,recipe,finance,uploads,balance,run}.ts` (`runLegacy(...)` around a converted primitive, nothing else), `apps/api/test/{legacy-framework,legacy-recipe}.test.ts` (call sites only), `apps/api/test/legacy-io.test.ts` (new) |
| 2 | E5-T02 seed, reset-password | build | `apps/api/scripts/{seed,reset-password}.ts`, `apps/api/src/core/services/households/modules.ts`, `apps/api/src/core/services/auth/{users,passwordReset}.ts`, `apps/api/src/core/services/mail/index.ts`, `apps/api/test/scripts-seed.test.ts` (new), `apps/api/test/mail.test.ts` only if `trySendMail` callers move |
| 2 | E5-T03 plan-run | build | `apps/api/scripts/plan-run.ts`, `apps/api/src/modules/finance/services/plan/accrual.service.ts`, `apps/api/test/finance-security.test.ts`, `apps/api/test/scripts-plan-run.test.ts` (new) |
| 2 | E5-T04 uploads-gc, localize-images | build | `apps/api/scripts/{uploads-gc,localize-images}.ts`, `apps/api/src/core/services/media/references.ts`, `apps/api/src/modules/recipe/services/recipes/remoteImage.ts`, `apps/api/test/scripts-uploads.test.ts` (new) |
| 2 | E5-T05 finance-import-xlsx | build | `apps/api/scripts/finance-import-xlsx.ts`, `apps/api/src/modules/finance/services/{participants/participants.service,categories/categories.service,tags/tags.service,support}.ts`, `apps/api/test/{finance-import-xlsx,finance-file-db}.test.ts` |
| 2 | E5-T06b legacy library part 2: users, households, claims | core | `apps/api/scripts/legacy/{users,households,claims}.ts`, the interim call sites in `apps/api/scripts/legacy/{recipe,run}.ts` (`runLegacy(migrateUsersEffect(ctx))` and the like; nothing else) |
| 3 | E5-T07 legacy library part 3 and `LegacyMigration` | core | `apps/api/scripts/legacy/{recipe,finance,uploads,balance,run,service}.ts` (`service.ts` new), the one `knownLegacyIds` line of `apps/api/scripts/migrate-legacy.ts`, `apps/api/src/modules/recipe/migrate.ts`, `apps/api/src/modules/finance/services/ledger/balance.service.ts`, `apps/api/test/{legacy-recipe,legacy-finance,finance-scheduler}.test.ts` |
| 4 | E5-T08 the `migrate-legacy.ts` CLI | core | `apps/api/scripts/migrate-legacy.ts`, `apps/api/test/legacy-cli-usage.test.ts` (new) |
| 5 | E5-T09 `runModuleHook` gone, idioms rule (12) | build | `apps/api/src/modules/adapter.ts` (deleted), `apps/api/src/modules/finance/bridge.ts`, `apps/api/test/{module-adapter,import-order-effect,effect-idioms}.test.ts`, the `adapter.ts` path mentions in `CLAUDE.md`, `docs/modules/*.md`, `docs/open-work.md` |
| 6 | E5-T10 integration | build | `CLAUDE.md`, `docs/EFFECT.md` (E5 sentence), `docs/SPEC.md` (§2 sentence), `docs/adr/0014-transitional-core-bridges.md`, `docs/modules/{recipe,finance}.md`, `docs/open-work.md`, `agent-patterns/effect-{cli,services}.md`, `docs/plans/e5-scripts.md` (sections 9, 10; committed here) |

Deps: T02, T03, T04, T05 need T01 (`runScript`, `e5-verify.sh`); T06b needs T06a and T01; T07 needs T06b (and through it T06a,
T01); T08 needs T07 and T01; T09 needs T02 to T08; T10 needs all. `legacy-recipe.test.ts` is touched by T06a then T07, the five
T07-owned library files by T06a, T06b, then T07, `users.ts` / `households.ts` / `claims.ts` by T06a then T06b (all sequential).

## 4. Tasks

Every task reads first: `docs/EFFECT.md` §1 (E3, E5, E6, E7, E9, E10, E12) and §2; this plan's section 2 (the decisions its brief
names) and section 6 (risks); `repos/effect/LLMS.md` ("Writing Effect code", "Writing Effect services", "Error handling", "Managing
resources", "Running Effect programs"), `repos/effect/ai-docs/src/01_effect/06_running/10_run-main.ts`,
`repos/effect/ai-docs/src/01_effect/05_resources/10_acquire-release.ts`; `agent-patterns/effect-core.md`, `effect-services.md`,
`effect-errors.md`, `effect-cli.md` (sections 3, 4, 6, 7), `effect-config.md`; CLAUDE.md "Commands", "Catch-all stays catch-all",
"The error family and the one boundary mapper", "The `Database` service and the shared client", "API import cycle", "Bridges until E5
to E8", "Subprocess tests of the CLI set `NODE_ENV=development`", "Long commands". `agent-patterns/effect-stream.md` was read for the
plan: no script needs a `Stream` (the keyset loop of `copyTable` and the `readdir` loop of `uploads-gc` stay plain loops with `yield*`).
Every commit body names the EFFECT.md decision (E10 and the others the task serves), the plan decisions applied, and any deviation, and
ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `git -C /home/erics/software/toon-household status --porcelain
repos/` is empty after every task.

### E5-T01 — The script runner, `migrateDatabase`, `db:migrate`, the verify script (core)

Before any edit: write `docs/plans/e5-verify.sh` verbatim from P17, run `bash docs/plans/e5-verify.sh fixture-record` and then
`bash docs/plans/e5-verify.sh fixture` on the unchanged tree (deterministic or extend `normalize`); confirm the baseline is
checkout-independent (`grep -rlE '/home/|\.worktrees' docs/plans/e5-fixture` prints nothing; P17) and that `xlsx-dry` and `statics`
exit 0 on the base. Write
`apps/api/test/scripts-main.test.ts`'s subprocess part against the UNCONVERTED `apps/api/scripts/migrate.ts`: on a fresh temp file DB,
exit 0, stdout contains `[db:migrate] file database: file:<abs path>`, `[db:migrate] migrations: <abs>/apps/api/drizzle` and
`[db:migrate] done`; a second run exits 0 too (idempotent); the database then has the core tables (`users`, `household_modules`,
`legacy_ids`) and a recipe and a finance table. Then: `apps/api/scripts/support/main.ts` (P1), `migrateDatabase` and the Promise
door `runMigrations` in `apps/api/src/db/migrate.ts` (P8; no `runModuleHook` import any more), `apps/api/scripts/migrate.ts` as an
Effect program on `AppLayer` (P2 row 1; reads `databaseKind` and `DATABASE_URL` from `AppConfig`; the three lines through
`Console.log`). Unit cases in the same test file: `makeScriptTeardown` with a recording `exitProcess` gives 0 for a void success, the
number for a numeric success, `code` for `Exit.fail(new ScriptExit({ code: 2 }))`, 1 for an unmarked failure, 130 for an interruption;
`ScriptExit`'s `[Runtime.errorReported]` is `false`; `runMigrations(created.db)` on a `createDatabase` temp DB resolves and leaves
`__drizzle_migrations` and the module tables in place; after `created.client.close()` it rejects with the raw libSQL error (not a
`DatabaseError`: `isDatabaseError(rejection)` is false), as the bare `await migrate(...)` did. Acceptance: the subprocess cases pass before and after
the conversion; `migrateDatabase` is exported; `apps/api/scripts/support/main.ts` imports only `effect` and `@effect/platform-bun`;
`e5-verify.sh all` green.

### E5-T02 — `seed.ts` and `reset-password.ts` on the `AppLayer` (build)

Characterise first (P13) in `apps/api/test/scripts-seed.test.ts`: (1) `NODE_ENV=production` without `ALLOW_SEED`: exit 1, stderr
`[seed] refusing to run with NODE_ENV=production. Set ALLOW_SEED=1 if you really mean it.`, NO file at `DATABASE_URL`; (2) `ALLOW_SEED=1`
with `SEED_PASSWORD=short`: exit 1, stderr `[seed] SEED_PASSWORD (>= 10 chars) is required in production — the default is public.`, no
file; (3) `NODE_ENV=development` twice on one temp DB: both exit 0, the first prints `[seed] user demo@toon.local / demo1234` and `[seed]
household "Familie" (`, both end their seed output with `[seed] done` and the `Login:` / `Passwort:` block, the second prints no `[seed]
user` line (idempotent); (4) `reset-password` without arguments: exit 1, stderr starts `Usage: bun run auth:reset-password <email>
[--send]`; (5) unknown address: exit 2, stderr `No account with the address nobody@example.test found (DB: file).`; (6)
`demo@toon.local` on the seeded DB: exit 0, stdout has `Account:  Demo Koch <demo@toon.local>`, a line ending `/reset-password/<token>`,
`Valid:    ` and `The link can be used exactly ONCE and signs out every device afterwards.` (in production mode the env may need more
variables: the test supplies what the base version needs and nothing else). Then convert: `seed.ts` per P2 row 2 (the refusal as an
Effect over `AppConfig` provided by `AppConfig.layer`, failing with `ScriptExit({ code: 1 })` after the same `Console.error` line; only
then the dynamic `import("../src/runtime.ts")`; `migrateDatabase()`; the user and household inserts through `Database`; time from the
Clock (P6); `const modules = yield* HouseholdModules; yield* modules.initializeHousehold(householdId)` (P18: no static accessor);
each module's `seedDemo` effect yielded directly on the `AppLayer`
(it needs `Database`, which the layer provides; no `runModuleHook`); `Bun.password.hash(..., { algorithm: "argon2id" })` inside
`Effect.tryPromise` (not the `Passwords` service: its 200-character cap would change a long `SEED_PASSWORD`); the final lines
unchanged). `reset-password.ts` on `AppLayer`, each service yielded first and its method called on the value (P18): `const users = yield* Users` then `yield*
users.findUserByEmail(email)`, `const resets = yield* PasswordReset` then `yield* resets.createPasswordResetToken(user.id, {
requestedIp: "cli" })`, `webUrl`, `const mailer = yield* MailerService` then `yield* mailer.trySendMail(message)` (or the module
function if the service is not in `AppServices`; check `apps/api/src/infra.ts`), `isMailConfigured()` (synchronous helper, stays); exits 1 and 2 through `ScriptExit`. Delete the bridges of P11
rows 1 to 4 that lost their last caller (grep), and the `runtime` import of a file that no longer needs it. Acceptance: the six cases
green before and after; `grep -rnw 'initializeHousehold\|findUserByEmail\|createPasswordResetToken' apps/api/scripts` shows only
calls on a yielded service value; `bash docs/plans/e5-verify.sh order` and `statics` green (the three core files are pinned
import-order entries; no static accessor added to `HouseholdModules`, `Users`, `PasswordReset`, `MailerService`).

### E5-T03 — `plan-run.ts` on the `AppLayer`, the `runCatchUp` bridge removed (build)

Characterise first in `apps/api/test/scripts-plan-run.test.ts`: (1) on a migrated empty temp DB (run `bun apps/api/scripts/migrate.ts`
first, or the seed of (2) without finance) with no argument: exit 0, stderr `[plan-run] no households to run`; (2) after `bun
apps/api/scripts/seed.ts` (`NODE_ENV=development`, the demo household has finance enabled and a plan): no argument, exit 0, one stdout
line matching `^\[plan-run\] Familie \([0-9a-f-]{36}\): booked \d+ period\(s\), skipped \d+, -?\d+ ct total$`; the same with the id as
argument; (3) an unknown id: exit 1, stderr `[plan-run] no household nope with finance enabled`. Then convert `plan-run.ts`: the
household query through `Database`, `const accrual = yield* FinanceAccrual` once, then `accrual.runCatchUp(row.id, { trigger:
"manual", requireEnabled: false, throwOnIncomplete: false })` per household inside `Effect.exit` (P18: `FinanceAccrual` has no static
`runCatchUp`, and none is added); a failure prints `Console.error(\`[plan-run] ${row.name} (${row.id}) failed:\`,
message)` where `message` is the raw error's `message` (P5: a `DatabaseError`'s `cause`, else the squashed value; `instanceof Error`
replaced by `Predicate.isError`) and sets the exit code to 1; the program succeeds with the code (P1). Delete the `runCatchUp` bridge
(P11) and move `finance-security.test.ts`'s one call onto a local helper `runCatchUp(db, householdId, options)` =
`runFinanceBridge(FinanceAccrual.use((service) => service.runCatchUp(householdId, options)), db)` so the assertion
`rejects.toThrow("insert into")` and the audit-marker assertion stay byte-identical. Acceptance: the cases green before and after;
`finance-security.test.ts` green; no `runCatchUp(` bridge left in `accrual.service.ts`.

### E5-T04 — `uploads-gc.ts` and `localize-images.ts` on the `AppLayer` (build)

Characterise first in `apps/api/test/scripts-uploads.test.ts` (a migrated temp DB via `bun apps/api/scripts/migrate.ts`; files written
with `writeFileSync` and aged with `utimesSync`): `uploads-gc` with `UPLOAD_DIR` missing: exit 0, stdout `[uploads:gc] <dir> does not
exist — nothing to do.`; with `old.jpg` (48 h old), `young.jpg` (now), `old.thumb.webp` (48 h old, original `old.jpg` unreferenced):
`--dry-run` exits 0, prints `[uploads:gc] would delete: old.jpg (0 KB)` and the summary line `[uploads:gc] 3 files checked, 0
referenced, 1 too young (< 24 h), 2 deletable (0.0 MB).` (or whatever the base prints: record it, then assert it), and deletes nothing;
without `--dry-run` deletes the two and keeps `young.jpg`; `--min-age-hours=0` deletes `young.jpg` too; `--min-age-hours=abc` behaves as
24. `localize-images --dry-run` on a seeded DB (`bun apps/api/scripts/seed.ts`) with one recipe's `image_url` set to
`http://127.0.0.1:9/x.jpg` through `@libsql/client`: exit 0, `[recipe:localize-images] 1 recipe image(s), 0 collection cover(s) still
remote (dry run).` and the listed line `  recipe <id>  http://127.0.0.1:9/x.jpg`; without `--dry-run`: exit 0, `0 copied, 1 not
reachable (kept remote).` (the private-host guard refuses the address; no network). Then convert both on `AppLayer`:
`const references = yield* UploadReferences` then `yield* references.collectUploadReferences()` (P18), `originalOfThumbnail`, `node:fs/promises` calls wrapped with `Effect.tryPromise` and the
SAME catch behaviour (a failing `readdir` prints the "does not exist" line and succeeds; a failing `stat` skips the entry; a failing
`unlink` prints `Console.warn(\`[uploads:gc] ${entry} could not be deleted:\`, error)` with the raw error object and continues), the
cutoff from the Clock (P6); `remoteImages.localizeImageUrl(row.url)` on `const remoteImages = yield* RemoteImages` (P18) and the conditional updates through `Database`. Effect's
`FileSystem` service is not introduced (its `PlatformError` would change the printed error object). Delete the two bridges of P11 and
an unused `runtime` import. Acceptance: the cases green before and after; `import-order` entry `./src/core/services/media/references.ts`
still loads first.

### E5-T05 — `finance-import-xlsx.ts`'s write path on the finance services (build)

The pure part (`parseArgs` loop, `buildImport`, `printReport`, the extractors) is unchanged except that `parseArgs`'s three
`process.exit` calls become values the program turns into `ScriptExit` (P4: `--help`/`-h` prints the usage line and exits 0; an
unrecognised argument and a missing path print the same `[import-xlsx] …` line and exit 1). `main` becomes the program run by
`runScript` under `import.meta.main`.

**The import rule (P2 row 5 and its "Why a value import is enough to break a dry run").** `--dry-run` and the no-`--household` path
never load `src/runtime.ts`, `src/db/database.ts` or `src/db/client.ts`. Concretely:

- The file's STATIC imports stay what they are today (node builtins, `@toon/shared`, `drizzle-orm`, `./finance-import/*`) plus
  `effect` and `./support/main.ts`. `Database` (from `../src/db/database.ts`), `FinanceParticipants`, `FinanceCategories`,
  `FinanceTags` and the finance schema tables appear ONLY in `import type` declarations (for the `R` channel and parameter types).
  The existing `import type { Database } from "../src/db/client.ts"` (the drizzle TYPE) may stay or go.
- `writeImportRecords(householdId, records)` and `seedFixedCostPlan(householdId, seed)` become exported `Effect.fn`s whose generators
  load their values first, as lines 570-574 and 648-650 do today: `const { Database } = yield* Effect.promise(() =>
  import("../src/db/database.ts"))`, the same for `../src/modules/finance/services/participants/participants.service.ts`,
  `categories/categories.service.ts`, `tags/tags.service.ts` and `../src/modules/finance/schema.ts`; then `const database = yield*
  Database`, `const participants = yield* FinanceParticipants` and so on (P18: methods on the yielded value, never a static).
  `participants.slot1UserId` / `requireOtherMemberId`, `categories.categoryIdBySlug` memoised in the same `Map`,
  `tags.syncTransactionTags` INSIDE `database.transaction(...)` so it runs on the open transaction, the inserts through `database`,
  `now` from the Clock (P6).
- The write branch of the program loads `../src/runtime.ts` dynamically (P2's shape), provides `AppLayer` to the two calls and prints
  the same lines. The `--dry-run` / no-`--household` branch yields nothing that imports a database module.

`finance-import-xlsx.test.ts` moves its six `writeImportRecords` / `seedFixedCostPlan` calls onto `runTest(...)`
(`apps/api/test/support/effect.ts`; the shared test DB, as before) with the same assertions; its existing subprocess `--dry-run` case
is untouched and must stay green. It GAINS one subprocess case beside it (the existing case inherits `NODE_ENV=test`, under which
`env.ts` quietly picks a temp DB, so it cannot see a database opened by mistake): spawn `bun apps/api/scripts/finance-import-xlsx.ts
<SYNTHETIC_XLSX_PATH> --dry-run` and the same with `--household nope --dry-run`, with an env built from `process.env` MINUS
`SESSION_SECRET`, `TEST_DATABASE_URL` and `DATABASE_URL`, PLUS `NODE_ENV=development` and `DATABASE_URL=file:<tmp>/x.db`; assert exit
0 for both, the lines `[import-xlsx] no --household given: no database write performed.` and `[import-xlsx] --dry-run: no database
write performed.`, and that neither `<tmp>/x.db` nor `<tmp>/x.db-wal` exists afterwards (`existsSync`); temp dir removed in
`afterEach`; timeout 120 s (P13). Write and run this case against the UNCONVERTED script first (it passes there: verified at plan
time, `e5-verify.sh xlsx-dry` exits 0 at `9a1272a8e`), then convert.

Delete the four finance bridges and the finance `withTransaction` (P11); `finance-file-db.test.ts`'s cases (a) and (d) move from
finance `withTransaction` to `Database.transaction` (on `Database.layerFrom(created)` and on the shared `db` respectively) with the
same assertions (no row after a failing body; the shared client rolls back). Acceptance: both test files green including the new
case; `bash docs/plans/e5-verify.sh xlsx-dry` exits 0; `grep -nE '^import [^t].*(src/db/|src/runtime|src/modules/finance/)'
apps/api/scripts/finance-import-xlsx.ts` is empty (no value import of a database or finance module); `grep -rnw 'withTransaction'
apps/api/src/modules/finance` shows no definition or call left outside comments; the `nothrow`-style greps of
`docs/plans/e4-verify.sh` (`bash docs/plans/e4-verify.sh nothrow`) still clean; `statics` green; finance greps of
`docs/modules/finance.md` §5.1 untouched (no web file).

### E5-T06a — The `migrate:legacy` library, part 1: errors, I/O helpers, primitives (core)

Per P5 and P9. **The fixture diff in this worktree first.** T01 runs in parallel and its `docs/plans/e5-verify.sh` and baseline are
not in this worktree yet, so before the first edit: write P17's script verbatim to `migration-out/e5-verify.sh` (the directory is in
`.gitignore`; never commit it), then `E5_FIXDIR=migration-out/e5-t06a-base bash migration-out/e5-verify.sh fixture-record` on the
UNCHANGED tree; after the edits `E5_FIXDIR=migration-out/e5-t06a-base bash migration-out/e5-verify.sh fixture` must report the run
identical. (After the merge, `bash docs/plans/e5-verify.sh fixture` on `main` checks the same against T01's baseline.)

New `apps/api/scripts/legacy/io.ts` (`legacyTry`, `runLegacy`, and the one generic lift `liftTagged(tags, f)` = P5's `Effect.suspend`
+ `try` + `Predicate.isTagged` guard, a foreign throw rethrown as a defect, never `Effect.die(`; the library's lifts below use it).
`LegacyInputError`, `MappingError`, `CopyProgrammingError` as `Schema.TaggedError`s with `exitCode` and `message` (P5 table); every
construction site passes `{ message }`. `sources.ts`: `openLegacyEffect` (the synchronous `snapshotDatabase` called through the lift,
its `LegacyInputError` reworded with the source exactly as today; the client closed when `checkSchema` refuses, then the refusal;
`checkSchema`'s read failure becomes `LegacyInputError` with the raw reason), `readAll` as an Effect, the Promise bridge `openLegacy`.
`ledger.ts`: `lookupMany`, `loadAll` as Effects. `copy.ts`: `writeEntries` (one batch per chunk; on a `DatabaseError` the per-entry
retry; an entry that still fails is `recordSkip(..., \`insert failed: ${errorMessage(cause)}\`, true)` with the RAW driver error) and
`copyTable` as Effects (a `CopyProgrammingError` of a pure statement builder called inside `copyTable` goes through the lift, so it is
typed; `copyTable`'s own is `return yield*`). `mapping.ts` stays pure (P7); only its error class changes.

Interim call sites in `users.ts`, `households.ts`, `claims.ts`, `recipe.ts`, `finance.ts`, `uploads.ts`, `balance.ts`, `run.ts` wrap
the converted primitives in `await runLegacy(...)` and change NOTHING else (T06b and T07 convert them). `users.ts` gains no `catch`
by this (P9 and the text guard below). Move the non-pinned test call sites of the converted primitives
(`grep -rnwE 'readAll|lookupMany|loadAll|writeEntries|copyTable' apps/api/test`: `legacy-framework.test.ts`, `legacy-recipe.test.ts`)
onto `runLegacy(...)`; assertions unchanged. `legacy-mapping.test.ts` needs no edit (it calls the pure functions and checks
`toBeInstanceOf(MappingError)`, which a `Schema.TaggedError` subclass keeps). New `apps/api/test/legacy-io.test.ts`: `runLegacy` rejects
with a `DatabaseError`'s cause and with a `MappingError` unchanged (`exitCode` 2, `instanceof`); `legacyTry` maps a rejection to
`DatabaseError`; `liftTagged` turns a thrown `MappingError` into a typed failure (`Effect.exit` is a `Fail`, `catchTag("MappingError")`
sees it) and leaves a foreign `throw new Error("x")` a defect (the failed `Exit`'s cause satisfies `Cause.hasDies` and not `Cause.hasFails`,
`repos/effect/packages/effect/src/Cause.ts` ~789 and ~897); the three tagged errors keep `exitCode` and `message`.

Acceptance: every `legacy-*` test and `finance-scheduler.test.ts` green with the pinned ones unchanged; `bun test
apps/api/test/import-order.test.ts` green (the legacy entries); the CLI subprocess cases of `legacy-cli.test.ts` green; the fixture
run identical to the scratch base (above); no `await ` left (outside comments) in `io.ts`, `sources.ts`, `ledger.ts`, `copy.ts`,
`mapping.ts` (the bridge returns `runLegacy(...)` without awaiting); the only new `await` lines are the interim `await runLegacy(`
calls in the eight files named above.

### E5-T06b — The `migrate:legacy` library, part 2: users, households, claims (core)

Per P5 and P9, on T06a's primitives. `users.ts`: `migrateUsersEffect` + bridge `migrateUsers`; `households.ts`:
`migrateHouseholdsEffect` + bridge `migrateHouseholds`; `claims.ts`: `migrateClaimInvites` as an Effect (time from the Clock, P6).
**The synchronous throwers called by these steps go through T06a's lift** (P5; a bare call would turn a `MappingError` into a defect,
which the in-process tests cannot see because `Cause.squash` returns the same object, but the CLI would exit 1 instead of 2):
`validateMappingOverride(ctx.mapping, known)` in `migrateHouseholdsEffect` (today `households.ts` line 116; `known` yielded before
the lift) and `proposeHouseholdMapping(...)` (line 210; it throws `MappingError` for an override naming no recipe group or a group
taken in an earlier run). **`users.ts` must not contain the word `catch` outside comments** (nor `PRIMARY KEY`, `isUniqueViolation`,
`UNIQUE constraint`): `legacy-users.test.ts` "no code path catches a PRIMARY KEY error to pick a new id" reads the file's text, so
`users.ts` reaches the database only through `legacyTry` / `readAll` / `copyTable` / `writeEntries` (whose `catch:` lives in `io.ts`
and `copy.ts`) and uses no `Effect.catch*`. Replace T06a's interim `await runLegacy(...)` calls in these three files by `yield*`.
Interim call sites in `recipe.ts` and `run.ts` (`migrateUsers` / `migrateHouseholds` / `migrateClaimInvites` used there) become `await
runLegacy(migrateUsersEffect(ctx))` and the like and change NOTHING else (T07 converts them). No test file changes: the tests call
the kept Promise bridges `migrateUsers` / `migrateHouseholds` (P9), `migrateClaimInvites` has no test caller.

Acceptance: every `legacy-*` test and `finance-scheduler.test.ts` green with the pinned ones unchanged (`legacy-users.test.ts`'s text
guard on `users.ts` included); `bash docs/plans/e5-verify.sh fixture` identical to T01's baseline; `order` and `legacy` green; no
`await ` left (outside comments) in `users.ts`, `households.ts`, `claims.ts` (the bridges return `runLegacy(...)` without awaiting);
`grep -nE 'validateMappingOverride|proposeHouseholdMapping' apps/api/scripts/legacy/households.ts` shows each call inside a lift.

### E5-T07 — The `migrate:legacy` library, part 3, and `LegacyMigration` (core)

Per P9. `recipe.ts`: `migrateRecipeEffect` (its `foldBackfill()` on `Database.layerFromExecutor(ctx.target.db)`, resolving `{
backfilled }` as today) + bridge `migrateRecipe`; `uploads.ts`: `migrateUploads`, `collectLegacyUploadReferences` as Effects with
`node:fs/promises` wrapped and every old `catch` kept (P5); `finance.ts`: `migrateFinance`; `balance.ts`: `verifyBalances`,
`legacyBreakdown` (the balance through `withFinanceServices(FinanceBalance.use((balance) => balance.getBalance(...)))` on
`Database.layerFromExecutor(ctx.target.db)` (P18: `FinanceBalance` has no static `getBalance`, and none is added); a failure handled
exactly as the old `await getBalance(...)` was, i.e. propagated); `run.ts`: `runLegacyMigrationEffect` (same step order; a bad
`mapping` refused before `migrateUsersEffect`: today's `validateMappingOverride(mapping, await knownLegacyIds(recipe, finance))` at
`run.ts` line 106 becomes `known` yielded first, then the call through T06a's lift, so the `MappingError` is TYPED and reaches the
CLI's `catchTags` (P10)), `knownLegacyIds` as an Effect, bridge `runLegacyMigration`, a re-export of `runLegacy`. `service.ts`:
`LegacyMigration` (P9). Replace T06a's and T06b's interim `runLegacy(...)` calls by `yield*`. In `apps/api/scripts/migrate-legacy.ts`
change ONLY the `knownLegacyIds` call to `await runLegacy(knownLegacyIds(recipe, finance))` with `runLegacy` taken from the existing
`await import("./legacy/run.ts")` destructuring (T08 rewrites the file; the textual guard stays green). Delete the `getBalance` and
`backfillFoldedColumns` bridges (P11) and the now unused `runModuleHook` / `sharedDb` imports of `apps/api/src/modules/recipe/migrate.ts`;
move `legacy-finance.test.ts`, `finance-scheduler.test.ts` (`getBalance`) and `legacy-recipe.test.ts` (`backfillFoldedColumns`, the
converted steps) onto local helpers / `runLegacy` with the assertions unchanged. Acceptance: all `legacy-*`, `finance-scheduler` and
`recipe-module` tests green, the three pinned unchanged; `bash docs/plans/e5-verify.sh fixture` identical; `order` and `statics`
green; `grep -rn 'await ' apps/api/scripts/legacy` empty outside comments.

### E5-T08 — The `migrate-legacy.ts` CLI as an Effect program (core)

Characterise first in `apps/api/test/legacy-cli-usage.test.ts` (subprocess, `NODE_ENV=development`, `cwd` the repo root, an absolute
`DATABASE_URL=file:<tmp>/target.db` where a case needs one, `UPLOAD_DIR=<tmp>/uploads`, timeout 120 s; five spawns, each also asserts
that `<tmp>/target.db` and `<tmp>/target.db-wal` do NOT exist afterwards):
1. `--help` → exit 0, stdout equals the `USAGE` text plus a newline, stderr empty;
2. `--bogus` → exit 2, stderr contains `[migrate:legacy] error: `, `Run with --help for the usage.` and `[migrate:legacy] nothing was
   written.`, stdout empty;
3. `--recipe-uploads /x --finance-db <fixture finance.db>` (no `--recipe-db`) → exit 2 with `--recipe-uploads needs --recipe-db` and
   the two other lines;
4. `--finance-db <fixture finance.db> --mapping <tmp>/nope.json` (the file does not exist) → exit 2, stderr contains
   `[migrate:legacy] error: --mapping: file not found: <tmp>/nope.json`, `Run with --help for the usage.` and `[migrate:legacy] nothing
   was written.` (P10 call site 5; no test covers it today);
5. `--finance-db <fixture finance.db>` with `DATABASE_URL=file:<tmp>/adir` where `<tmp>/adir` is a DIRECTORY → exit 2, stderr contains
   `[migrate:legacy] error: the target is not a file: <tmp>/adir`, `Run with --help for the usage.` and `[migrate:legacy] nothing was
   written.` (P10 call site 3; no test covers it today; the directory is unchanged afterwards).
(A missing `DATABASE_URL` is not spawned: the CLI reads the REPO root's `.env`, which a developer may have; `legacy-cli.test.ts`'s
in-process `resolveCliEnv` cases pin that message.) Run the five against the UNCONVERTED file and read their output before writing
the assertions (if a stderr line differs from the text above, the base's text wins and the assertion follows it).

Then rewrite the file per P10, in particular its **lift bullet**: the four synchronous call sites `parseCliArgs`, `resolveCliEnv`,
`snapshotTarget`, `parseMappingFile` each through `yield* liftExitTwo(() => …)`, the `--mapping: file not found` check as `return
yield* new CliUsageError({ message })`, the guard `Predicate.isTagged`, a foreign throw rethrown (never `Effect.die(`, never
`instanceof`), and `Effect.catchTags({ CliUsageError, MappingError, LegacyInputError })` accepted by `tsc` WITHOUT a cast (its
excess-key check is the proof that the three tags are in the typed channel). Acceptance: `legacy-cli.test.ts` unchanged and green
(its subprocess block, including the bad-mapping and remote-target cases that expect exit 2, and its three textual guards); the five new
cases green before and after; `bash docs/plans/e5-verify.sh fixture` identical, `legacy`, `order` and `types` green; the file's
static imports are node builtins, types, `effect`, `@effect/platform-bun`; `grep -nE '(parseCliArgs|resolveCliEnv|snapshotTarget|
parseMappingFile)\(' apps/api/scripts/migrate-legacy.ts` shows every call inside the `main` program on a `liftExitTwo(() =>` line
(definitions excepted); `grep -n 'as any\|as never' apps/api/scripts/migrate-legacy.ts` empty.

### E5-T09 — `runModuleHook` deleted, idioms rule (12) (build)

Per P12 and P14. Confirm with `grep -rnw runModuleHook apps packages scripts` that `apps/api/src/modules/finance/bridge.ts` is its only
caller; inline it there; delete `apps/api/src/modules/adapter.ts`; `module-adapter.test.ts` and `import-order-effect.test.ts` per P12;
the `adapter.ts` paths in `CLAUDE.md`, `docs/modules/*.md`, `docs/open-work.md` (the text around them only as far as the path needs; T10
rewrites the gotchas); rule (12) in `effect-idioms.test.ts` with its allow list and stale-entry check. Acceptance: `bash
docs/plans/e5-verify.sh all` green; `bun test apps/api/test/docs-paths.test.ts` green; the module-adapter and import-order-effect case
counts equal to the base's.

### E5-T10 — Integration: the gates, the fixture run, the scripts on a real database, the boot, the docs, the record (build)

1. Gates: `bun install --frozen-lockfile`; `bash docs/plans/e5-verify.sh all` (one log ending `exit=$?`); `bun run build`; `bun run
   i18n:check` read by hand (parity OK; the hit list compared with a run at the base commit in a throw-away worktree, `git worktree add
   <scratch> 9a1272a8e`, line-number-free diff; every new or removed hit classified; expected 145 minus the `Effect.die(` line if
   nothing else moved).
2. The CLAUDE.md fixture run through `bun run migrate:legacy` (dry run, `--apply` twice, a temp dir): exit codes 0, 0, 0, the
   `@toon/api migrate:legacy: ` prefix on every line, no target file after the dry run, the last lines of P17; the scratch dir with the
   apply output deleted afterwards (claim links).
3. Each script once on a fresh temp file DB (`NODE_ENV=development`): `db:migrate` twice, `seed` twice, `plan:run`, `plan:run nope`
   (exit 1), `uploads:gc -- --dry-run`, `recipe:localize-images -- --dry-run`, `auth:reset-password demo@toon.local`,
   `finance:import-xlsx -- <synthetic xlsx of finance-import-xlsx.test.ts> --dry-run`; record exit codes and the last two lines of each
   (the added `[db] database closed`, P3).
4. Boot-and-shutdown (`docs/EFFECT.md` §5): `NODE_ENV=development DATABASE_URL=file:<tmp>/t.db SESSION_SECRET=<32 hex> API_PORT=<free>
   bun apps/api/src/index.ts` in the background with one log ending `exit=$?`; `/api/health` 200; SIGTERM to the pid; the log ends
   `[db] database closed`, `[api] runtime disposed`, `exit=0`.
5. Docker (if `docker` is available; otherwise recorded as not run): `docker build -t toon-household:e5 . > build.log 2>&1; echo
   "exit=$?" >> build.log` in the background, read `exit=0`; `docker run --rm` the image with `--entrypoint sh` and a temp volume to run
   `bun apps/api/scripts/migrate.ts` (the entrypoint's command) and `bun apps/api/scripts/plan-run.ts`, both exit 0 (the image's three
   `node_modules` copies carry `@effect/platform-bun`, CLAUDE.md "The Dockerfile refuses a bundle with the dev API URL"); remove the
   image and `build.log`.
6. Docs per P16; then `bun test apps/api/test/docs-paths.test.ts apps/api/test/api-doc.test.ts` and the gates once more after the last
   edit.
7. This file's sections 9 (the logs quoted) and 10 (every deviation, in order), committed together with the docs.

## 5. Acceptance summary

- `bash docs/plans/e5-verify.sh all` exits 0 on the final tree: typecheck, idioms (rule (12) on), order, the three pinned legacy tests,
  pinned files unchanged since `9a1272a8e`, `repos/` clean, no static accessor added (P18), the xlsx dry run opening no database (P2),
  the fixture run identical to the base's checkout-independent normalised output, suite `>= 14725`.
- Every exit-2 path of `migrate:legacy` exits 2 with the three stderr lines when spawned (`legacy-cli-usage.test.ts`, five cases, and
  the pinned `legacy-cli.test.ts`): the synchronous throwers are lifted (P10).
- `bun run build` exits 0; `bun run i18n:check` parity OK with every hit classified.
- Every script is an Effect program (`runScript` or `BunRuntime.runMain` under `import.meta.main`), no `process.exit(` in script code
  but the runner's, no `await` in the `legacy/` and `finance-import/` libraries, no `runModuleHook` in the tree.
- The bridges of P11 are gone; the survivors are exactly P11's list, written into ADR 0014 and CLAUDE.md.
- Seed refuses production without `ALLOW_SEED=1` and a 10+ character `SEED_PASSWORD`, writing no file (`scripts-seed.test.ts`).
- The boot check ends `[db] database closed`, `[api] runtime disposed`, `exit=0`.

## 6. Risks

1. **Report text drifts in the library rewrite** (T06a, T06b, T07). Every `report.errors` / `report.skipped` / warning string is built from the
   same template with the raw error message (P5). Mitigation: all `legacy-*` tests stay green, the pinned ones unchanged, and
   `e5-verify.sh fixture` diffs the whole normalised output against the base.
2. **A typed failure where the old code had a crash, or the reverse** (see also risk 12). A `DatabaseError` that the old code let propagate must still
   propagate (exit 1 in the CLI, a rejection in the bridge with the raw error); one the old code caught must still be caught. The
   `runLegacy` mapping keeps the rejection values the tests see. A `throw` inside `Effect.sync` / a generator is a defect: never rely
   on `Effect.catch*` for it (CLAUDE.md "Catch-all stays catch-all").
3. **Import order of the CLI.** The library now imports `apps/api/src/db/database.ts`, `apps/api/src/lib/errors.ts` and
   `apps/api/src/modules/finance/layer.ts`; each is loaded after the redirect only because the CLI imports `./legacy/*` after
   `db/client.ts`. A library file that imported `src/runtime.ts` (or anything that reads the shared `db` at module scope) would open the
   REAL target during a dry run. Mitigation: P9, P15, the subprocess cases of `legacy-cli.test.ts` (no target file, no `-wal` after a
   dry run), `import-order.test.ts`.
4. **Exit and flush.** `runScript` ends with `process.exit(code)` after the scope closed (the old scripts' `process.exit(0)`); a piped
   stdout of a few kilobytes reaches the reader, as it did for `uploads-gc`, `plan-run` and the xlsx dry run (whose subprocess test
   reads it). `migrate-legacy.ts` never calls `process.exit` (P10), because its report is the largest output and today it ends naturally.
5. **The `AppLayer` in a script.** Building it costs a second or two (the module layers, `sharp` loaded by the import graph anyway) and
   a database that cannot be opened now fails the layer build (logged by `runMain`, exit 1) instead of the first query (an uncaught
   rejection, exit 1). Same exit code; unpinned text.
6. **Detached fibers.** `createPasswordResetToken` forks `sweepExpiredResetTokens` detached; after the program the scope closes the
   client and `runScript` exits. The sweep is catch-all (CLAUDE.md "Catch-all stays catch-all"), and the old script `process.exit(0)`ed
   just as early.
7. **Signals.** `runMain` installs SIGINT/SIGTERM handlers: a Ctrl+C interrupts the program and runs its finalizers (closes the clients,
   removes the `migrate:legacy` scratch dir) and exits 130, where the old scripts died at once (deviation 7). A long `--apply`
   interrupted mid-batch is no different for the data: every batch is atomic and the run resumes (CLAUDE.md "`migrate:legacy` reads
   snapshots…").
8. **Load and timeouts.** The new subprocess tests each spawn Bun (with the `AppLayer` for most); under parallel worktrees the host load
   has reached 50. Every subprocess test carries an explicit 120 s timeout and the suite gate reads `(fail)` lines verbatim.
9. **`i18n:check` stopwords.** A comment or string with "die", "der", "und" … adds a false positive; `Effect.die(` is avoided (P5). E5-T10
   classifies every hit against the base run.
10. **Textual guards on library files.** `legacy-users.test.ts` scans `apps/api/scripts/legacy/users.ts` for `\bcatch\b`, `PRIMARY
    KEY`, `isUniqueViolation`, `UNIQUE constraint` (comments stripped); `legacy-cli.test.ts` scans `migrate-legacy.ts` for the first
    `import(` and static imports. An Effect idiom that spells `catch` (`Effect.catchTag`, `tryPromise({ catch })`) must not land in
    `users.ts` (T06a and T06b briefs). Grep `apps/api/test` for `Bun.file(`/`readFileSync(` of a script path before editing a script file.
11. **Pinned test drift.** A task that "needs" to edit a pinned test is wrong about the design; `e5-verify.sh pinned` fails it.
12. **A synchronous throw becomes a defect.** Inside Effect code a pure function's `throw` of `CliUsageError`, `MappingError` or
    `LegacyInputError` is a defect: `catchTags` misses it and the CLI exits 1 instead of 2, while every in-process assertion
    (`rejects.toMatchObject({ exitCode: 2 })`, `toBeInstanceOf`) stays green because `Cause.squash` returns the same object.
    Mitigation: the lifts named call site by call site (P10, E5-T06a, E5-T06b, E5-T07), `catchTags` compiled without a cast, and the
    subprocess cases of `legacy-cli-usage.test.ts` and `legacy-cli.test.ts`.
13. **A value import that opens the database.** `src/db/database.ts` imports `src/db/client.ts`, which opens the database at import;
    a static value import of it, of a finance service or of the finance schema from `finance-import-xlsx.ts` (or `seed.ts`,
    `migrate.ts` before their pre-steps) breaks the "no database" promise of a dry run or a refusal, invisibly under `NODE_ENV=test`.
    Mitigation: P2's `import type` rule, `e5-verify.sh xlsx-dry`, the `NODE_ENV=development` subprocess cases of
    `finance-import-xlsx.test.ts` and `scripts-seed.test.ts`.
14. **A checkout-dependent baseline.** The legacy report prints absolute input paths; a baseline recorded in a worktree would fail
    everywhere else and invite a re-record from a converted tree. Mitigation: P17's `$ROOT` rule, the checks in `fixture`, and the
    rule that only T01 records, on the base.
15. **v3 habits.** A brief read as `FinanceAccrual.runCatchUp(…)` does not compile in v4; the wrong fix is a hand-written static
    accessor. Mitigation: P18 and `e5-verify.sh statics`.

## 7. Deviations expected (each recorded in section 10 when it happens)

1. **Scripts on the `AppLayer` print a final `[db] database closed`** (P3): an added English ops line, no pinned line changes.
2. **`effect/cli` not adopted** (P4): hand parsing kept inside the programs; E10 says "may".
3. **`migrate-legacy.ts` imports `effect` and `@effect/platform-bun` statically** (P10): the header's "only node builtins and TYPES"
   is widened by the two packages; `legacy-cli.test.ts`'s guards are unchanged and pass.
4. **Five Promise bridges stay in the legacy library** (`runLegacyMigration`, `migrateUsers`, `migrateHouseholds`, `migrateRecipe`,
   `openLegacy`; P9) for the pinned tests, with `…Effect` forms; E8 removes them. `runMigrations` stays as the tests' Promise door (P8).
5. **`finance-import/*` stays pure, not services** (P7, E3), against the goal's wording.
6. **The process-wide client stays created at import of `src/db/client.ts`** (P16): ADR 0014 status and `docs/EFFECT.md` E5's
   sentence edited in one commit.
7. **Signals interrupt gracefully** (risk 7): exit 130 after the finalizers instead of an immediate death.
8. **Unexpected failures are printed by `runMain`'s reporter** (`Effect.logError` of the cause) instead of Bun's uncaught-error print;
   exit code 1 unchanged; no doc or test pins the crash text.
9. **`seed.ts` and `migrate.ts` end with an explicit `process.exit(0)`** in `runScript`'s teardown, where they ended naturally after
   `client.close()`; same output, same code.
10. **`LegacyMigration` is the one service of the library** (P9); the steps are `Effect.fn` functions over the explicit context, not
    services (E4 deviation 10's rule for helper modules).

## 8. Out of this milestone

The web (E6); Hono and the route-file import order (E7, `docs/open-work.md` O-6); the Promise doors and bridges the pinned tests need
(E8: the legacy library's five, `runMigrations`, `runFinanceBridge` with `assignParticipants`, `updateParticipantDisplayName`,
`requireFinanceParticipantContext`, the core test seams, recipe's `createDraft`, `importFromText`, `fetchHtml`, `assertPublicUrl`);
creating the database client inside `Database.layer` instead of at import (E8 decides, ADR 0014); `effect/cli`, Effect's `FileSystem`
and `Stream` for the scripts; the root scripts `scripts/{dev,typecheck,i18n-check,icons}.ts` (plain Bun by E10); `@effect/sql-libsql`;
any `docs/API.md` row, UI, copy, flag, exit code or operator-guide change; the N-person ledger (D3).

## 9. Integration record

Written by E5-T10 on `main` at `50126f11d` (E5-T09) plus this commit, 2026-11-05, Bun 1.4.3 on the host (`.bun-version` says 1.4.2), host load
average about 3 to 10 during the gates. Logs are quoted from the runs; no claim link or token is quoted.

### 9.1 Gates

- `bun install --frozen-lockfile`: `Checked 439 installs across 628 packages (no changes)`, `exit=0`.
- `bash docs/plans/e5-verify.sh all` (one log ending `exit=$?`), every step green, in order: typecheck (`[typecheck] OK` over the five projects), idioms
  (rule (12) on), order (`import-order` and `import-order-effect`, 55 pass), legacy (`legacy-cli`, `legacy-placeholders`, `legacy-fixtures`, 55 pass),
  `[e5-verify] pinned files unchanged since 9a1272a8e`, `[e5-verify] repos/ clean`, `[e5-verify] no static accessors added since 9a1272a8e`,
  `[e5-verify] xlsx dry-run exit codes: 0 0 (want 0 0)`, `[e5-verify] xlsx dry run never touched the database`,
  `[e5-verify] fixture exit codes: dry=0 apply=0 again=0 (want 0 0 0)`, `[e5-verify] fixture run identical to the recorded base output`, then the suite:
  `14785 pass, 0 fail, 383956 expect() calls, Ran 14785 tests across 170 files. [45.40s]`, `[e5-verify] suite OK: 14785 pass (floor 14725)`, `exit=0`.
  The record rises by 60 over the base's 14725 (the characterisation and library tests of section 4: `scripts-main`, `scripts-seed`,
  `scripts-plan-run`, `scripts-uploads`, `legacy-io`, `legacy-service`, `legacy-cli-usage`, the added xlsx cases).
- `bun run build`: `@toon/web build: Exited with code 0`, `exit=0` (`dist/sw.js` and `dist/workbox-8b1f5376.js` generated; E5 touches no web file).
- `bun run i18n:check`: `[i18n:check] OK` (parity) and `FAILED - 145 possible German literal(s)` (exit 1, by design). A run in a throw-away worktree at
  `9a1272a8e` (`git worktree add --detach <scratch> 9a1272a8e`, `node_modules` linked, removed afterwards) printed 145 hits too; with the line numbers
  stripped (`file | text`, sorted) the two lists are identical (`diff` empty). Every hit is a classified false positive of the known kinds (German
  quoted in doc comments such as "Häufig gekauft", "Verfügbare Module", recipe content vocabulary, umlaut entities); none is in a file E5 touched
  (`apps/api/scripts` is not scanned). The plan expected "145 minus the `Effect.die(` line", but E4 had already removed that line (CLAUDE.md "Status"), so the
  base count was 145 and no hit moved.

### 9.2 The fixture run through `bun run migrate:legacy`

The CLAUDE.md fixture run (scratch directory, `NODE_ENV=development DATABASE_URL=file:<d>/target.db UPLOAD_DIR=<d>/uploads bun run migrate:legacy --
--recipe-db apps/api/test/fixtures/legacy/recipe.db --recipe-uploads apps/api/test/fixtures/legacy/uploads --finance-db
apps/api/test/fixtures/legacy/finance.db`, then `--apply` twice): exit codes `0, 0, 0`; every stdout line carries the `@toon/api migrate:legacy: ` prefix (0
unprefixed lines of 174, 177, 172); after the dry run the directory held `dry.err dry.out` only (no `target.db`, no `-wal`); the last report lines:

```
[migrate:legacy] dry run complete: 274 rows would be written, 7 files would be copied. Nothing was written.
[migrate:legacy] applied: 274 rows written, 7 files copied.
[migrate:legacy] already migrated: nothing written.
```

The checkout-independent normalised comparison is `e5-verify.sh fixture` above (identical to `docs/plans/e5-fixture/*.norm`, recorded at the base by T01). The
scratch directory, which held the apply output with the fixture's claim links, was deleted afterwards.

### 9.3 Every script once on a fresh temp file DB (`NODE_ENV=development`, `DATABASE_URL=file:<tmp>/t.db`, `SESSION_SECRET` of 32 hex)

| Command | Exit | Last lines (workspace prefix dropped) |
| --- | --- | --- |
| `bun run db:migrate` (first) | 0 | `[db:migrate] done`, `[db] database closed` |
| `bun run db:migrate` (second) | 0 | same |
| `bun run seed` (first, second) | 0, 0 | `Passwort: demo1234`, an empty line, `[db] database closed` |
| `bun run plan:run` | 0 | `[plan-run] Familie (<id>): booked 0 period(s), skipped 0, 0 ct total`, `[db] database closed` |
| `bun run plan:run nope` | 1 | `[plan-run] no household nope with finance enabled`, `[db] database closed` |
| `bun run uploads:gc -- --dry-run` | 0 | `[uploads:gc] 0 files checked, 0 referenced, 0 too young (< 24 h), 0 deletable (0.0 MB).`, `[db] database closed` |
| `bun run recipe:localize-images -- --dry-run` | 0 | `[recipe:localize-images] 0 recipe image(s), 0 collection cover(s) still remote (dry run).`, `[db] database closed` |
| `bun run auth:reset-password demo@toon.local` | 0 | `The link can be used exactly ONCE and signs out every device afterwards.`, `[db] database closed` (the link above it is a credential and is not quoted) |
| `bun run finance:import-xlsx -- <synthetic workbook of finance-import-xlsx.test.ts> --dry-run` | 0 | `[import-xlsx] no --household given: no database write performed.` (no `[db] database closed`: the dry run never opens the database) |
| `bash docs/plans/e5-verify.sh xlsx-dry` | 0 | `exit codes: 0 0`, `never touched the database` |

The wrapper's own `Exited with code N` lines and, for the failing one, `error: script "plan:run" exited with code 1` come from `bun run`.

### 9.4 Boot and shutdown (`docs/EFFECT.md` §5)

`env -u TEST_DATABASE_URL NODE_ENV=development DATABASE_URL=file:<tmp>/t.db SESSION_SECRET=<32 hex> API_PORT=<free> bun apps/api/src/index.ts`
(after `bun apps/api/scripts/migrate.ts` on the same file) in the background with one log ending `exit=$?`: `GET /api/health` answered `200`
(`{"ok":true,"status":"ok","version":"0.1.0",…,"database":"file","modules":["recipe","finance"],…}`); `kill -TERM` of the server's pid; the log ends:

```
[api] SIGTERM - stopping modules …
[db] database closed
[api] runtime disposed
exit=0
```

(the first line carries the long dash the code prints; the port was free again).

### 9.5 Docker

`docker build -t toon-household:e5 . > build.log 2>&1; echo "exit=$?" >> build.log` in the background: `exit=0`. Then `docker run --rm --entrypoint sh -v
<tmp>:/app/data -e DATABASE_URL=file:/app/data/t.db -e SESSION_SECRET=<32 hex> -e UPLOAD_DIR=/app/data/uploads toon-household:e5 -c "…bun
apps/api/scripts/<script>.ts; echo exit=$?"`: `migrate.ts` printed `[db:migrate] done`, `[db] database closed`, `exit=0`; `plan-run.ts` printed
`[plan-run] no households to run`, `[db] database closed`, `exit=0` (the image's three `node_modules` copies carry `@effect/platform-bun`). The image
(`docker rmi`), the temp volume directory and the repo-root `build.log` were removed.

### 9.6 Docs, and the gates after the last edit

ADR 0014 "Status after E5's integration" and `docs/EFFECT.md` E5's sentence are edited in the same commit (plan deviation 6). Also updated: CLAUDE.md (Status
with the pass count and the E5 sentence, Layout "Scripts (E5)", the gotchas "Bridges until E8", "The `Database` service and the shared client", "Hooks are Effects"
(`runModuleHook` gone), the new "The scripts are Effect programs (E5)", "The CLI never imports `src/env.ts`…", the idioms paragraph with rule (12), the
`i18n:check` count), `docs/SPEC.md` §2's `runModuleHook` sentence, `docs/modules/recipe.md` and `docs/modules/finance.md` (the bridge tables, the scripts' service use),
`docs/open-work.md` (O-5's count, a new O-7), `agent-patterns/effect-cli.md` and `agent-patterns/effect-services.md` ("As built (E5)": `runScript`, the teardown,
`LegacyMigration`, P18's v4 call spelling, P10's lift), and `agent-patterns/effect-core.md` (one stale `runModuleHook` snippet). `docs/API.md`, `docs/migration.md` and
`docs/deployment.md` are NOT edited. `bun test apps/api/test/docs-paths.test.ts apps/api/test/api-doc.test.ts` and `bash docs/plans/e5-verify.sh all` were run again after
the last edit (section 9.7).

### 9.7 The final run

After the last doc edit (all docs above in place, `CLAUDE.md` path spans fixed after a first `docs-paths` failure on a stale `apps/api/src/modules/adapter.ts` mention):
`bun install --frozen-lockfile` `exit=0`; `bash docs/plans/e5-verify.sh all` `exit=0` (typecheck, idioms, order, legacy, pinned unchanged since `9a1272a8e`, repos clean, no
statics, xlsx dry run, fixture run identical, suite `14785 pass, 0 fail, 383956 expect() calls, Ran 14785 tests across 170 files. [45.43s]`); `bun run build` `exit=0`;
`bun test apps/api/test/docs-paths.test.ts apps/api/test/api-doc.test.ts`: `14 pass, 0 fail`; `test -z "$(git status --porcelain repos/)"` exit 0.

## 10. What changed vs plan

The ten deviations the plan expected (section 7), each as it happened, then the ones it did not:

1. **Added `[db] database closed` line** (plan deviation 1, P3). Every script on the `AppLayer` (`migrate`, `seed`, `reset-password`, `uploads-gc`, `plan-run`, `localize-images`,
   and `finance-import-xlsx`'s write branch) ends with it; recorded in T01, T02 and T05 commit bodies. `finance-import-xlsx --dry-run` and the no-`--household` path print
   nothing extra (they never open the database). No pinned line changed (`e5-verify.sh fixture` and the pinned tests prove it).
2. **`effect/cli` not adopted** (deviation 2, P4). No script imports `effect/cli`; the hand parse stays inside each program (`Command.run` would own `--help` and a parse-error
   exit 1 against the pinned exit-2 contract). `agent-patterns/effect-cli.md` records it.
3. **`migrate-legacy.ts` imports `effect` and `@effect/platform-bun` statically** (deviation 3, T08): its header says so; `legacy-cli.test.ts`'s textual guards are unchanged and pass.
4. **Five Promise bridges stay in the legacy library** (deviation 4; T06a, T06b, T07): `runLegacyMigration`, `migrateUsers`, `migrateHouseholds`, `migrateRecipe`, `openLegacy`, each beside
   an `…Effect` form; `runMigrations` stays the tests' Promise door over `migrateDatabase` (T01). E8 removes them.
5. **`finance-import/*` stays pure** (deviation 5, E3's rule), as does `mapping.ts`.
6. **The process-wide client stays created at import of `apps/api/src/db/client.ts`** (deviation 6): ADR 0014's first Decision bullet said E5 ends it; the ADR status and
   `docs/EFFECT.md` E5's sentence now say it stays until E8 decides, edited in one commit (this one).
7. **A signal interrupts gracefully** (deviation 7, T08): finalizers run (the `migrate:legacy` scratch directory is removed), exit 130.
8. **Unexpected failures are printed by `runMain`'s reporter** (deviation 8, T08), exit 1 unchanged.
9. **`runScript` ends with an explicit `process.exit(code)`** (deviation 9, T01), `seed.ts` and `migrate.ts` included; `migrate-legacy.ts` is the exception (its teardown sets
   `process.exitCode`, never `process.exit`, P10).
10. **`LegacyMigration` is the one service of the library** (deviation 10, T07): `Layer.sync` over a thunk, the steps stay `Effect.fn` functions over the explicit context.

Not expected by section 7:

11. **E5-T06 was split into T06a and T06b** (already in the plan's revision note; the tasks ran as `E5-T06a`, `E5-T06b`, then `E5-T07`), with a merge commit each for the parallel worktrees.
12. **T06a's scratch baseline.** T06a ran in a parallel worktree before T01's committed baseline was merged, so it recorded the fixture output of the unchanged base under the ignored
    `migration-out/e5-t06a-base` (not committed) and diffed against it; every later task, and this one, used the committed `docs/plans/e5-fixture/*.norm`.
13. **Tests added beyond the characterisation list:** `apps/api/test/legacy-service.test.ts` (T07, the service's `open`, `knownLegacyIds`, `run`, the typed `MappingError`, the import-first
    check) and extra cases in `finance-import-xlsx.test.ts` (the `NODE_ENV=development` dry-run subprocess). The suite grew from 14725 to 14785.
14. **The `i18n:check` expectation** (section 9.1): 145 at the base and at the end, not "145 minus one", because E4 had removed the `Effect.die(` hit.
15. **Survivor list.** Section P11 left `trySendMail` conditional; it survives (its one caller is `apps/api/test/mail.test.ts`), and the survivors are exactly the table in ADR 0014 "Status after
    E5's integration". `getBalance` and `backfillFoldedColumns` went in T07, not before; the finance `withTransaction` helper went in T05.
16. **Doc scope.** T10 also fixed a stale `runModuleHook` snippet in `agent-patterns/effect-core.md` and added `docs/open-work.md` O-7 (neither was on P16's list; "a milestone that finds a wrong line in
    a pattern file fixes it in the same commit"). `docs/plans/e5-scripts.md` itself was untracked until this commit.
17. **Bun** 1.4.3 on the host against `.bun-version` 1.4.2 (already noted at the top); nothing depended on it.
