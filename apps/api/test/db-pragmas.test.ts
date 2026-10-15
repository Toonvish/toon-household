/**
 * SPEC D7: a local `file:` database runs WAL + `synchronous = FULL` (the ledger
 * lives in this file), sent per connection by `createDatabase()`. `:memory:` gets
 * no pragmas (no journal, nothing to tune). Checked through `@libsql/client`.
 *
 * M3b-T06 (toon-finance 1715207, gotcha 74): `foreign_keys = ON` is sent explicitly too, and the
 * data directory `createDatabase()` creates is 0700.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../src/db/client.ts";

const dir = mkdtempSync(join(tmpdir(), "toon-household-pragmas-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function pragma(created: ReturnType<typeof createDatabase>, name: string): Promise<unknown> {
  const result = await created.client.execute(`PRAGMA ${name}`);
  return result.rows[0]?.[0];
}

describe("connection pragmas", () => {
  test("a file: DB runs synchronous = FULL (2) and journal_mode = wal", async () => {
    const created = createDatabase({ url: `file:${join(dir, "pragmas.db")}` });
    try {
      await created.ready;
      expect(Number(await pragma(created, "synchronous"))).toBe(2);
      expect(String(await pragma(created, "journal_mode")).toLowerCase()).toBe("wal");
      expect(Number(await pragma(created, "foreign_keys"))).toBe(1);
    } finally {
      created.client.close();
    }
  });

  test("the data directory a file: DB needs is created with mode 0700", async () => {
    const nested = join(dir, "data", "nested");
    const created = createDatabase({ url: `file:${join(nested, "private.db")}` });
    try {
      await created.ready;
      expect(statSync(nested).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, "data")).mode & 0o777).toBe(0o700);
    } finally {
      created.client.close();
    }
  });

  test("a :memory: DB gets no pragmas", async () => {
    const created = createDatabase({ url: "file::memory:" });
    try {
      await created.ready;
      // `memory` is SQLite's own journal mode for an in-memory DB; WAL was never sent.
      expect(String(await pragma(created, "journal_mode")).toLowerCase()).toBe("memory");
      // busy_timeout is a pragma we send to file DBs only; the default is 0.
      expect(Number(await pragma(created, "busy_timeout"))).toBe(0);
    } finally {
      created.client.close();
    }
  });
});
