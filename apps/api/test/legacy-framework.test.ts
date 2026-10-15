/**
 * The `migrate:legacy` framework (plan m5 M5-T02, decisions 3, 4, 7, 8, 15) on temp file
 * databases only; never the shared `file::memory:` db, never `env.uploadDir`.
 *
 * (a) `snapshotDatabase` of a WAL database whose rows live only in the WAL copies `<db>` +
 *     `<db>-wal` (never `-shm`) and the copy has every row; the source bytes are unchanged.
 * (b) `openLegacy`: the schema gate ("N of 9"), read-only copy (`query_only`), input errors.
 * (c) `copyTable` in chunks with the ledger, and the idempotent second run.
 * (d) a row whose insert fails is skipped alone (per-row fallback), with no ledger entry.
 * (e) a transform that omits (or adds) a target column is a programming error that writes nothing.
 * (f) `renderReport`: the headings of decision 15 in order and the five final lines; `exitCodeFor`.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { type Client, createClient } from "@libsql/client";
import { users } from "../src/db/schema.ts";
import { createDatabase } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import {
  CHUNK_SIZE,
  CopyProgrammingError,
  columnNames,
  copyTable,
  insertStatement,
  renameColumns,
  writeEntries,
} from "../scripts/legacy/copy.ts";
import { ledgerStatement, loadAll, lookupMany } from "../scripts/legacy/ledger.ts";
import {
  addCount,
  createReport,
  exitCodeFor,
  REPORT_HEADINGS,
  renderProposal,
  renderReport,
  reportToJson,
  totalWritten,
} from "../scripts/legacy/report.ts";
import { LEGACY_SCHEMAS, LegacyInputError, openLegacy, readAll, snapshotDatabase } from "../scripts/legacy/sources.ts";
import type { LegacyDb, MigrationContext, Report, Row, TableCount } from "../scripts/legacy/types.ts";

const root = mkdtempSync(join(tmpdir(), "toon-legacy-framework-"));
const openClients: Client[] = [];

afterAll(() => {
  for (const client of openClients) client.close();
  rmSync(root, { recursive: true, force: true });
});

function freshDir(name: string): string {
  const dir = join(root, `${name}-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function track(client: Client): Client {
  openClients.push(client);
  return client;
}

/** A plain libSQL file client (rollback journal unless the test switches it to WAL). */
function plainClient(path: string): Client {
  return track(createClient({ url: `file:${path}` }));
}

async function count(client: Client, sql: string, args: (string | number)[] = []): Promise<number> {
  const result = await client.execute({ sql, args });
  return Number(result.rows[0]?.n ?? 0);
}

/** A drizzle journal with `n` rows, the last at `lastCreatedAt` (the gate reads only this table). */
async function writeJournal(client: Client, n: number, lastCreatedAt: number): Promise<void> {
  await client.execute(
    "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)",
  );
  for (let index = 0; index < n; index += 1) {
    await client.execute({
      sql: "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      args: [`hash-${index}`, lastCreatedAt - (n - 1 - index) * 1000],
    });
  }
}

describe("(a) snapshotDatabase", () => {
  test("copies <db> and <db>-wal, never -shm; WAL-only rows survive; the source bytes are unchanged", async () => {
    const dir = freshDir("wal");
    const source = join(dir, "local.db");
    const writer = plainClient(source);
    await writer.execute("PRAGMA journal_mode = WAL");
    await writer.execute("PRAGMA wal_autocheckpoint = 0");
    await writer.execute("CREATE TABLE items (id TEXT PRIMARY KEY, label TEXT NOT NULL)");
    for (let index = 0; index < 7; index += 1) {
      await writer.execute({ sql: "INSERT INTO items (id, label) VALUES (?, ?)", args: [`i${index}`, `Item ${index}`] });
    }
    // The writer stays open: closing the last connection would checkpoint the WAL into the main file.
    expect(existsSync(`${source}-wal`)).toBe(true);
    expect(existsSync(`${source}-shm`)).toBe(true);
    const before = { main: sha256(source), wal: sha256(`${source}-wal`) };

    // The main file alone does not hold the rows: they are only in the WAL.
    const mainOnly = join(dir, "main-only.db");
    copyFileSync(source, mainOnly);
    const mainOnlyClient = plainClient(mainOnly);
    expect(
      await count(mainOnlyClient, "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'items'"),
    ).toBe(0);

    const snapshot = join(dir, "snapshot.db");
    expect(snapshotDatabase(source, snapshot)).toEqual({ wal: true });
    expect(existsSync(`${snapshot}-wal`)).toBe(true);
    expect(existsSync(`${snapshot}-shm`)).toBe(false);
    const copy = plainClient(snapshot);
    expect(await count(copy, "SELECT count(*) AS n FROM items")).toBe(7);

    expect(sha256(source)).toBe(before.main);
    expect(sha256(`${source}-wal`)).toBe(before.wal);
  });

  test("a database without a WAL is copied alone", () => {
    const dir = freshDir("nowal");
    const source = join(dir, "local.db");
    copyFileSync(join(import.meta.dir, "../drizzle/0000_core.sql"), source); // any regular file
    const snapshot = join(dir, "copy.db");
    expect(snapshotDatabase(source, snapshot)).toEqual({ wal: false });
    expect(existsSync(`${snapshot}-wal`)).toBe(false);
  });

  test("a missing path or a directory is a LegacyInputError with exit code 2", () => {
    const dir = freshDir("missing");
    for (const path of [join(dir, "nope.db"), dir]) {
      let caught: unknown;
      try {
        snapshotDatabase(path, join(dir, "copy.db"));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LegacyInputError);
      expect((caught as LegacyInputError).exitCode).toBe(2);
    }
  });
});

describe("(b) openLegacy and the schema gate", () => {
  async function legacyFile(n: number, lastCreatedAt: number): Promise<string> {
    const dir = freshDir("gate-src");
    const path = join(dir, "local.db");
    const client = createClient({ url: `file:${path}` });
    await writeJournal(client, n, lastCreatedAt);
    await client.execute("CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
    await client.execute("INSERT INTO groups (id, name) VALUES ('g1', 'Familie')");
    client.close();
    return path;
  }

  async function refusal(path: string, source: "recipe" | "finance" = "recipe"): Promise<LegacyInputError> {
    const before = sha256(path);
    let caught: unknown;
    try {
      await openLegacy(source, path, freshDir("gate-scratch"));
    } catch (error) {
      caught = error;
    }
    expect(sha256(path)).toBe(before);
    expect(caught).toBeInstanceOf(LegacyInputError);
    expect((caught as LegacyInputError).exitCode).toBe(2);
    return caught as LegacyInputError;
  }

  test("fewer journal rows are refused with 'N of 9'", async () => {
    const error = await refusal(await legacyFile(8, 1788859780811 - 5000));
    expect(error.message).toBe(
      "legacy recipe database is at migration 8 of 9 (its last migration is from 1788859775811, expected 0008_shopping_bought at 1788859780811); start the old app once (it migrates on boot) and copy it again",
    );
  });

  test("nine rows ending at an older created_at are refused too", async () => {
    const error = await refusal(await legacyFile(9, 1788859780811 - 1));
    expect(error.message).toContain("legacy recipe database is at migration 9 of 9");
    expect(error.message).toContain("start the old app once (it migrates on boot) and copy it again");
  });

  test("a database without a drizzle journal is at migration 0", async () => {
    const dir = freshDir("nojournal");
    const path = join(dir, "local.db");
    const client = createClient({ url: `file:${path}` });
    await client.execute("CREATE TABLE t (x)");
    client.close();
    expect((await refusal(path)).message).toContain("at migration 0 of 9");
  });

  test("a file that is not a SQLite database is refused", async () => {
    const dir = freshDir("notdb");
    const path = join(dir, "local.db");
    copyFileSync(join(import.meta.dir, "../drizzle/0000_core.sql"), path);
    expect((await refusal(path)).message).toContain("cannot be read");
  });

  test("a missing file names the source", async () => {
    const error = await refusal2(join(freshDir("nofile"), "local.db"));
    expect(error.message).toContain("legacy finance database not found");
  });

  async function refusal2(path: string): Promise<LegacyInputError> {
    let caught: unknown;
    try {
      await openLegacy("finance", path, freshDir("gate-scratch"));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LegacyInputError);
    return caught as LegacyInputError;
  }

  test("nine rows ending at 1788859780811 open as a read-only snapshot", async () => {
    const path = await legacyFile(LEGACY_SCHEMAS.recipe.migrations, LEGACY_SCHEMAS.recipe.lastCreatedAt);
    const before = sha256(path);
    const scratch = freshDir("gate-scratch");
    const legacy = await openLegacy("recipe", path, scratch);
    track(legacy.client);
    expect(legacy.source).toBe("recipe");
    expect(legacy.originalPath).toBe(path);
    expect(legacy.snapshotPath).toBe(join(scratch, "recipe.db"));
    expect(await readAll(legacy, "SELECT id, name FROM groups")).toEqual([{ id: "g1", name: "Familie" }]);
    await expect(legacy.client.execute("INSERT INTO groups (id, name) VALUES ('g2', 'Zwei')")).rejects.toThrow();
    await expect(legacy.client.execute("CREATE TABLE x (y)")).rejects.toThrow();
    expect(await readAll(legacy, "SELECT count(*) AS n FROM groups")).toEqual([{ n: 1 }]);
    expect(sha256(path)).toBe(before);
  });

  test("the finance gate uses its own journal", async () => {
    const ok = await legacyFile(LEGACY_SCHEMAS.finance.migrations, LEGACY_SCHEMAS.finance.lastCreatedAt);
    const legacy = await openLegacy("finance", ok, freshDir("gate-scratch"));
    track(legacy.client);
    expect(legacy.source).toBe("finance");
    const error = await refusal(await legacyFile(1, LEGACY_SCHEMAS.finance.lastCreatedAt - 10_000), "finance");
    expect(error.message).toContain("legacy finance database is at migration 1 of 3");
  });

  test("a 2-migration finance database (before 0002_placeholder_members) is refused naming that migration", async () => {
    const error = await refusal(await legacyFile(2, 1787307431957), "finance");
    expect(error.message).toContain("legacy finance database is at migration 2 of 3");
    expect(error.message).toContain("expected 0002_placeholder_members at 1789194481486");
  });
});

/* -------------------------------------------------------------------------- */
/* copier                                                                     */
/* -------------------------------------------------------------------------- */

const PEOPLE = [
  { id: "p1", email: " Anna@Example.test ", name: "Anna", created_at: 1_700_000_000_001 },
  { id: "p2", email: "ben@example.test", name: "Ben", created_at: 1_700_000_000_002 },
  { id: "p3", email: "cleo@example.test", name: "Cleo", created_at: 1_700_000_000_003 },
  { id: "p4", email: "dana@example.test", name: "Dana", created_at: 1_700_000_000_004 },
  { id: "p5", email: "emil@example.test", name: "Emil", created_at: 1_700_000_000_005 },
];

interface CopyRun {
  ctx: MigrationContext;
  target: Client;
  batches: () => number;
}

async function copyRun(chunkSize: number): Promise<CopyRun> {
  const dir = freshDir("copy");
  // the toy legacy table, opened like a snapshot (the gate is (b)'s subject)
  const legacyPath = join(dir, "legacy.db");
  const legacyClient = plainClient(legacyPath);
  await legacyClient.execute("CREATE TABLE people (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)");
  for (const person of PEOPLE) {
    await legacyClient.execute({
      sql: "INSERT INTO people (id, email, name, created_at) VALUES (?, ?, ?, ?)",
      args: [person.id, person.email, person.name, person.created_at],
    });
  }
  const legacy: LegacyDb = { source: "recipe", client: legacyClient, originalPath: legacyPath, snapshotPath: legacyPath };

  const url = `file:${join(dir, "target.db")}`;
  const created = createDatabase({ url });
  track(created.client);
  await created.ready;
  await runMigrations(created.db);

  let batchCalls = 0;
  const batch = created.client.batch.bind(created.client);
  created.client.batch = ((...args: Parameters<Client["batch"]>) => {
    batchCalls += 1;
    return batch(...args);
  }) as Client["batch"];

  const ctx: MigrationContext = {
    mode: "apply",
    recipe: legacy,
    target: { db: created.db, client: created.client, url },
    ids: { users: { recipe: new Map(), finance: new Map() }, households: { recipe: new Map(), finance: new Map() } },
    report: createReport("apply", url),
    uploads: { targetDir: join(dir, "uploads-target"), copy: false },
    chunkSize,
  };
  return { ctx, target: created.client, batches: () => batchCalls };
}

/** people -> users: every target column, SQL names, storage values. */
function personToUser(row: Row): Row {
  const renamed = renameColumns(row, { created_at: "created_at" });
  return {
    id: renamed.id ?? null,
    email: String(renamed.email).trim().toLowerCase(),
    name: renamed.name ?? null,
    avatar_url: null,
    email_verified: 0,
    email_verified_at: null,
    password_hash: null,
    active_household_id: null,
    locale: null,
    created_at: renamed.created_at ?? null,
    updated_at: renamed.created_at ?? null,
  };
}

const peopleSpec = { source: "recipe" as const, legacyTable: "people", target: users, transform: personToUser };

describe("(c) copyTable with the ledger", () => {
  test("5 rows in chunks of 2: 5 rows and 5 ledger entries in 3 batches; a second run writes 0", async () => {
    const run = await copyRun(2);
    const first = await copyTable(run.ctx, peopleSpec);
    expect(first).toEqual({ table: "users", source: "recipe", read: 5, written: 5, alreadyMigrated: 0, skipped: 0 });
    expect(run.batches()).toBe(3);
    expect(await count(run.target, "SELECT count(*) AS n FROM users")).toBe(5);
    expect(
      await count(run.target, `SELECT count(*) AS n FROM legacy_ids WHERE "table" = 'users' AND legacy_source = 'recipe'`),
    ).toBe(5);
    const anna = await run.target.execute("SELECT email, email_verified, created_at, updated_at FROM users WHERE id = 'p1'");
    expect(anna.rows[0]?.email).toBe("anna@example.test");
    expect(anna.rows[0]?.email_verified).toBe(0);
    expect(anna.rows[0]?.updated_at).toBe(1_700_000_000_001);
    expect(await loadAll(run.target, "users", "recipe")).toEqual(new Map(PEOPLE.map((p) => [p.id, p.id])));
    expect(run.ctx.report.counts).toEqual([first]);

    const second = await copyTable(run.ctx, peopleSpec);
    expect(second).toEqual({ table: "users", source: "recipe", read: 5, written: 0, alreadyMigrated: 5, skipped: 0 });
    expect(run.batches()).toBe(3);
    expect(await count(run.target, "SELECT count(*) AS n FROM users")).toBe(5);
    expect(totalWritten(run.ctx.report)).toBe(5);
    expect(exitCodeFor(run.ctx.report)).toBe(0);
  });

  test("an interrupted run resumes from the first unmapped row", async () => {
    const run = await copyRun(CHUNK_SIZE);
    // p1 and p2 were written by an earlier run (row + ledger entry in one batch)
    for (const person of PEOPLE.slice(0, 2)) {
      const values = personToUser(person as unknown as Row);
      await run.target.batch([insertStatement(users, values), ledgerStatement("users", "recipe", person.id, person.id)], "write");
    }
    const result = await copyTable(run.ctx, peopleSpec);
    expect(result).toMatchObject({ read: 5, written: 3, alreadyMigrated: 2, skipped: 0 });
    expect(await count(run.target, "SELECT count(*) AS n FROM users")).toBe(5);
  });

  test("newId and ledgerTable overrides land in the ledger; skips are counted and recorded", async () => {
    const run = await copyRun(10);
    const result = await copyTable(run.ctx, {
      ...peopleSpec,
      ledgerTable: "users-toy",
      transform: (row) => (row.id === "p3" ? { skip: "user p3 not migrated", error: true } : row.id === "p4" ? { skip: "by design" } : personToUser(row)),
      newId: (values) => `new-${String(values.id)}`,
    });
    expect(result).toMatchObject({ read: 5, written: 3, skipped: 2 });
    expect(await lookupMany(run.target, "users-toy", "recipe", ["p1", "p3", "p4", "p5", "p1"])).toEqual(
      new Map([
        ["p1", "new-p1"],
        ["p5", "new-p5"],
      ]),
    );
    expect(run.ctx.report.skipped).toEqual([
      { table: "users", source: "recipe", legacyId: "p3", reason: "user p3 not migrated", error: true },
      { table: "users", source: "recipe", legacyId: "p4", reason: "by design", error: false },
    ]);
    expect(run.ctx.report.errors).toEqual(["users (recipe) p3: user p3 not migrated"]);
    expect(exitCodeFor(run.ctx.report)).toBe(1);
  });
});

describe("(d) per-row fallback", () => {
  test("a row whose e-mail already exists fails alone: 4 written, 1 skipped with a UNIQUE reason, no ledger entry", async () => {
    const run = await copyRun(2);
    await run.target.execute({
      sql: "INSERT INTO users (id, email, name, email_verified, created_at, updated_at) VALUES ('existing', 'cleo@example.test', 'Cleo neu', 0, 1, 1)",
      args: [],
    });
    const result = await copyTable(run.ctx, peopleSpec);
    expect(result).toEqual({ table: "users", source: "recipe", read: 5, written: 4, alreadyMigrated: 0, skipped: 1 });
    expect(await count(run.target, "SELECT count(*) AS n FROM users")).toBe(5);
    // p4 shared the failed batch with p3 and was written by the per-row retry
    expect(await count(run.target, "SELECT count(*) AS n FROM users WHERE id = 'p4'")).toBe(1);
    expect(await count(run.target, "SELECT count(*) AS n FROM users WHERE id = 'p3'")).toBe(0);
    expect(await count(run.target, "SELECT count(*) AS n FROM legacy_ids WHERE legacy_id = 'p3'")).toBe(0);
    expect(await count(run.target, "SELECT count(*) AS n FROM legacy_ids")).toBe(4);
    expect(run.ctx.report.skipped).toHaveLength(1);
    const skipped = run.ctx.report.skipped[0];
    expect(skipped).toMatchObject({ table: "users", source: "recipe", legacyId: "p3", error: true });
    expect(skipped?.reason.startsWith("insert failed: ")).toBe(true);
    expect(skipped?.reason).toContain("UNIQUE");
    expect(run.ctx.report.errors).toHaveLength(1);
    expect(exitCodeFor(run.ctx.report)).toBe(1);

    // the next run retries only the failed row (it is still unmapped) and fails it again
    const again = await copyTable(run.ctx, peopleSpec);
    expect(again).toMatchObject({ written: 0, alreadyMigrated: 4, skipped: 1 });
  });

  test("writeEntries writes ledger-only entries and returns what it wrote", async () => {
    const run = await copyRun(2);
    const tally: TableCount = { table: "users", source: "finance", read: 0, written: 0, alreadyMigrated: 0, skipped: 0 };
    const written = await writeEntries(
      run.ctx,
      users,
      [
        { values: null, ledger: [{ source: "finance", legacyId: "f1" }], newId: "merged-target", label: "decision f1" },
        {
          values: personToUser(PEOPLE[1] as unknown as Row),
          ledger: [
            { source: "recipe", legacyId: "p2" },
            { source: "finance", legacyId: "f2" },
          ],
          newId: "p2",
          label: "users ben@example.test",
        },
      ],
      tally,
    );
    expect(written.map((entry) => entry.label)).toEqual(["decision f1", "users ben@example.test"]);
    expect(tally.written).toBe(2);
    expect(await loadAll(run.target, "users", "finance")).toEqual(
      new Map([
        ["f1", "merged-target"],
        ["f2", "p2"],
      ]),
    );
    expect(await count(run.target, "SELECT count(*) AS n FROM users")).toBe(1);
    addCount(run.ctx.report, tally);
    addCount(run.ctx.report, tally);
    expect(run.ctx.report.counts).toEqual([tally]);
  });
});

describe("(e) programming errors", () => {
  test("a transform that omits a target column throws and writes nothing", async () => {
    const run = await copyRun(2);
    const spec = {
      ...peopleSpec,
      transform: (row: Row): Row => {
        const { locale: _locale, ...rest } = personToUser(row);
        return rest;
      },
    };
    let caught: unknown;
    try {
      await copyTable(run.ctx, spec);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CopyProgrammingError);
    expect((caught as Error).message).toContain("missing: locale");
    expect(await count(run.target, "SELECT count(*) AS n FROM users")).toBe(0);
    expect(await count(run.target, "SELECT count(*) AS n FROM legacy_ids")).toBe(0);
    expect(run.batches()).toBe(0);
  });

  test("an extra key or an undefined value throws too", () => {
    const values = personToUser(PEOPLE[0] as unknown as Row);
    expect(() => insertStatement(users, { ...values, group_id: "g1" })).toThrow("extra: group_id");
    expect(() => insertStatement(users, { ...values, locale: undefined as unknown as null })).toThrow("undefined values in locale");
    expect(columnNames(users)).toEqual(Object.keys(values));
  });
});

/* -------------------------------------------------------------------------- */
/* report                                                                     */
/* -------------------------------------------------------------------------- */

function handBuiltReport(mode: "dry-run" | "apply"): Report {
  const report = createReport(mode, "file:/tmp/target.db");
  report.inputs.push({ source: "recipe", path: "/in/recipe/local.db", schema: "0008_shopping_bought", tables: { users: 3, groups: 2 } });
  report.decisions.push({
    financeHouseholdId: "fh1",
    financeName: "WG",
    memberEmails: ["anna@example.test", "ben@example.test"],
    decision: "merge",
    targetHouseholdId: "g1",
    targetName: "Familie",
    reason: "only-group",
    addMembers: [],
  });
  report.users = { recipe: 3, finance: 2, placeholders: 1, target: 4, collisions: [] };
  addCount(report, { table: "users", source: "recipe", read: 3, written: 3, alreadyMigrated: 0, skipped: 0 });
  report.notMigrated.push({ table: "sessions", source: "recipe", rows: 1, reason: "everyone logs in again" });
  report.uploads = {
    sourceFiles: 2,
    copied: mode === "apply" ? 2 : 0,
    wouldCopy: mode === "apply" ? 0 : 2,
    alreadyPresent: 0,
    bytesCopied: 10,
    conflicts: [],
    missingReferenced: [],
    ignoredEntries: [],
  };
  report.balances.push({
    financeHouseholdId: "fh1",
    targetHouseholdId: "g1",
    name: "WG",
    slot1Email: "anna@example.test",
    legacyBalanceCents: -1234,
    migratedBalanceCents: -1234,
    legacyTransactionCount: 4,
    migratedTransactionCount: 4,
    legacyAmountSumCents: 5000,
    migratedAmountSumCents: 5000,
    slot1Matches: true,
    ok: true,
  });
  return report;
}

function lastLine(text: string): string {
  return text.trimEnd().split("\n").at(-1) ?? "";
}

describe("(f) report", () => {
  test("every heading of decision 15, in order, once", () => {
    const text = renderReport(handBuiltReport("dry-run"));
    const lines = text.split("\n");
    const positions = REPORT_HEADINGS.map((heading) => lines.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const heading of REPORT_HEADINGS) expect(lines.filter((line) => line === heading)).toHaveLength(1);
    expect(REPORT_HEADINGS).toEqual([
      "== Inputs ==",
      "== Household mapping proposal ==",
      "== Users ==",
      "== Rows per table ==",
      "== Skipped rows ==",
      "== Not migrated by design ==",
      "== Uploads ==",
      "== Finance balance per household ==",
      "== Warnings ==",
      "== Errors ==",
    ]);
    expect(text).toContain("-1234 ct");
    expect(text).not.toMatch(/-12\.34/);
    // empty sections print (none) (Inputs and Users always print their header lines)
    const empty = renderReport(createReport("dry-run", "file:/tmp/t.db")).split("\n");
    for (const heading of REPORT_HEADINGS.filter((h) => h !== "== Inputs ==" && h !== "== Users ==")) {
      expect(empty[empty.indexOf(heading) + 1]).toBe("(none)");
    }
  });

  test("the five final lines", () => {
    expect(lastLine(renderReport(handBuiltReport("dry-run")))).toBe(
      "[migrate:legacy] dry run complete: 3 rows would be written, 2 files would be copied. Nothing was written.",
    );
    expect(lastLine(renderReport(createReport("dry-run", "file:/tmp/t.db")))).toBe(
      "[migrate:legacy] dry run complete: already migrated, nothing would be written. Nothing was written.",
    );
    expect(lastLine(renderReport(handBuiltReport("apply")))).toBe("[migrate:legacy] applied: 3 rows written, 2 files copied.");
    expect(lastLine(renderReport(createReport("apply", "file:/tmp/t.db")))).toBe(
      "[migrate:legacy] already migrated: nothing written.",
    );
    const failedApply = handBuiltReport("apply");
    failedApply.errors.push("balance of WG differs", "users (recipe) p3: insert failed: UNIQUE");
    expect(lastLine(renderReport(failedApply))).toBe("[migrate:legacy] FAILED: 2 error(s), see Errors above.");
    const failedDry = handBuiltReport("dry-run");
    failedDry.errors.push("balance of WG differs");
    expect(lastLine(renderReport(failedDry))).toBe(
      "[migrate:legacy] FAILED: 1 error(s), see Errors above. Nothing was written.",
    );
  });

  test("exitCodeFor is 1 with an error and 0 without", () => {
    const report = handBuiltReport("apply");
    expect(exitCodeFor(report)).toBe(0);
    report.warnings.push("one participant; seat the second with PUT …/finance/participants");
    expect(exitCodeFor(report)).toBe(0);
    report.errors.push("upload conflict: a.jpg");
    expect(exitCodeFor(report)).toBe(1);
    const skippedOnly = handBuiltReport("apply");
    skippedOnly.skipped.push({ table: "users", source: "recipe", legacyId: "x", reason: "boom", error: true });
    expect(exitCodeFor(skippedOnly)).toBe(1);
  });

  test("the proposal table and the JSON form", () => {
    const report = handBuiltReport("dry-run");
    report.decisions.push({
      financeHouseholdId: "fh5",
      financeName: "Leer",
      memberEmails: [],
      decision: "skip",
      reason: "no-members",
      addMembers: [],
    });
    const proposal = renderProposal(report.decisions).split("\n");
    expect(proposal[0]).toMatch(/^Finance household\s+Members\s+Decision\s+Target household\s+Reason$/);
    expect(proposal[2]).toContain("WG (fh1)");
    expect(proposal[2]).toContain("Familie (g1)");
    expect(proposal[3]).toMatch(/Leer \(fh5\)\s+-\s+skip\s+-\s+no-members/);
    expect(renderProposal([])).toBe("(none)");
    const json = JSON.parse(reportToJson(report));
    expect(json.mode).toBe("dry-run");
    expect(json.summary).toMatchObject({ rowsWritten: 3, files: 2, errors: 0, exitCode: 0 });
  });
});
