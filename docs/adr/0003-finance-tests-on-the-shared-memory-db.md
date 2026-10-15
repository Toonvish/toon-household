# 0003: Finance tests run on the shared memory DB, real transactions are proven on a file DB (amends D13)

Superseded by ADR 0009.

Date: 2026-10-14

## Context

toon-finance's CLAUDE.md gotcha 2 says the ledger's tests must run against a database that gives
real transactions, because "a ledger whose tests never see a real transaction does not test its
most important property". toon-finance ran its suite on a temp file DB for that reason.

In the household app `bun test` is ONE process for the core, recipe and finance files, and
`env.ts` forces `file::memory:` for all of it. libSQL's `client.transaction()` opens a second
connection, and for an in-memory URL (`file::memory:`) a second connection is a different,
empty database, so the core's `withTransaction` (`core/services/households/support.ts`) degrades
to sequential statements on the shared client (`transactionsSupported = false`). Switching the
whole suite to a temp file would make every core and recipe `withTransaction` real for the first
time, with the lock behaviour of a second libSQL connection untested for those paths. That is
outside M3's scope. Plan decision 15 (M3) records the choice; SPEC D13 makes the source gotchas
binding, so the deviation needs this ADR.

## Decision

- Finance's `withTransaction` (`modules/finance/services/support.ts`) opens a REAL transaction on
  every database except the shared `file::memory:` client under `bun test`, where it runs the
  statements sequentially (same statement order, no rollback).
- The ledger's transaction guarantees are proven in `apps/api/test/finance-file-db.test.ts`, which
  builds its own temp `file:` database (`createDatabase` + `runMigrations`, removed in `afterAll`)
  and checks: a throw after an insert rolls the insert back; `createSettlement` with a repeated
  `mutationId` books one row and holds one claim; a `createTransaction` whose tag insert fails
  leaves neither the transaction nor its claim (and the same `mutationId` stays deliverable); and
  the shared memory client still degrades (the boundary is documented by a test, so a libSQL
  upgrade that changes it shows up).
- Every other finance test runs on the shared memory DB through the real routes and services.

D13 in `docs/SPEC.md` gets one sentence naming this ADR, in the same commit.

## Consequences

- On the memory DB the finance suite covers the full write path but not rollback; the file-DB
  test is the ledger's transaction proof and must stay green. A new finance write path that opens
  a transaction should get a case there.
- Production (a `file:` database or Turso) always uses real transactions.
- Switching the whole suite to a temp file is a later, separate decision; it would supersede this
  ADR once the core and recipe write paths have been run that way.
