# 0009: The whole test suite runs on a temp file DB (supersedes 0003, restores D13 for toon-finance gotcha 2)

Date: 2026-10-15

## Context

toon-finance's CLAUDE.md gotcha 2 says `bun test` must run on a fresh temp file database, never
`file::memory:`: libSQL's `client.transaction()` uses a second connection, a memory URL degrades
`withTransaction` to sequential statements, and "a ledger whose tests never see a real transaction
does not test its most important property". SPEC D13 makes that gotcha binding for the finance
module. M3 did not follow it: `env.ts` forced `file::memory:` for the one `bun test` process that
runs the core, recipe and finance files together, and ADR 0003 recorded the deviation, with
`finance-file-db.test.ts` proving the ledger's rollback on a private file database and a promise
that "switching the whole suite to a temp file is a later, separate decision". Plan
`m7-harden.md` decision 7 took it, with a go/no-go rule: green three runs in a row and a median
wall time of at most 3x the 24.5 s planning baseline (73.5 s).

## Decision

- Under `NODE_ENV=test`, `env.ts` sets `DATABASE_URL = TEST_DATABASE_URL ??
  file:<os.tmpdir()>/toon-household-test-<pid>-<uuid>.db` (toon-finance's
  `defaultTestDatabaseUrl()`, plus the pid). The shared client, every route and every service of
  the core, recipe and finance therefore run on a WAL file database with the D7 pragmas, and every
  `withTransaction` opens a real transaction with rollback, exactly as in production.
- Cleanup: a synchronous `process.on("exit")` removes the file and its `-wal` / `-shm` / `-journal`
  siblings, errors ignored. `bun test` 1.4 emits neither `exit` nor `beforeExit` for its own
  process (measured), so each run also deletes, before it creates its own, every
  `toon-household-test-<pid>-…` file whose pid is no longer running. At most one run's database
  (a few MB) stays in the temp directory.
- `transactionsSupported` stays: an explicit `TEST_DATABASE_URL=file::memory:` still degrades.
- `finance-file-db.test.ts` keeps (a) to (c) on its own file database; case (d) now proves that a
  throw inside the finance and the core `withTransaction` on the SHARED client rolls the insert
  back (it used to document that it did not).
- `db/client.ts` passes the busy timeout to `createClient` as `timeout` (5000 ms) for a local
  file. The switch exposed that @libsql/client 0.18's connection pool runs the
  `LOCAL_FILE_PRAGMAS` on its first connection only: a connection opened while a transaction holds
  the first one had `busy_timeout = 0` (and libSQL's default page cache and no mmap). The client
  option reaches every pooled connection; `db-pragmas.test.ts` pins the second connection's
  values. This is a production fix (a CLI writing while the server holds the lock no longer fails
  at once on a secondary connection).
- `EXPLAIN` in tests goes through `test/support/explain.ts`, which uses a separate client and
  closes it. libSQL 0.5.29 leaves an EXPLAIN statement busy after `all()` (`sqlite_stmt.busy = 1`
  until garbage collection), which pins that pooled connection's read snapshot; on the file DB
  the next write to borrow it failed with `SQLITE_BUSY_SNAPSHOT` and a migration COMMIT with
  "SQL statements in progress", in whichever test file ran next (first run: 28 failures across
  shopping-bought, placeholders, tags-kind, verified-email-gate, legacy-placeholders,
  finance-settlements). Nothing under `src/` runs EXPLAIN.

## Consequences

- Measured on the developer machine (Bun 1.4.3, ext4 on NVMe), `bun test` from the repo root:
  baseline on `file::memory:` 2418 pass in 29.03 / 28.05 / 27.46 s (Bun's own figure; median
  28.05 s); on the temp file DB 2420 pass (two new tests) in 26.56 / 26.72 / 27.75 s wall
  (Bun: 26.52 / 26.68 / 27.70 s; median 26.72 s), green three runs in a row. The file DB is not
  slower; `synchronous = FULL` fsyncs stay well inside the 73.5 s cap. CI on a disk-backed `/tmp`
  may be slower; the cap is the reference if it grows.
- toon-finance's gotcha 2 holds again inside the finance module (SPEC D13 no longer names an
  exception for it), and the core and recipe write paths are now tested with real transactions
  too. A test that hands a write to the outer `db` inside a `withTransaction`, or two transactions
  that contend, now behaves as in production rather than silently serialising.
- The rule "`file::memory:` is per client" still applies: a test that goes through `app.request`
  must use the shared `db`; `createDatabase({ url: "file::memory:" })` is a separate, empty
  database (tests such as `smoke.test.ts` and `recipe-module.test.ts` use one on purpose).
- An `EXPLAIN` against the shared client in a new test must use `explain()` from
  `test/support/explain.ts`.
- `TEST_DATABASE_URL` still overrides the default; pointing it at `file::memory:` brings back
  ADR 0003's degraded mode, which is then the user's explicit choice.
