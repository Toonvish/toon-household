/**
 * `EXPLAIN` / `EXPLAIN QUERY PLAN` for the index and opcode assertions (M7-T02, ADR 0009).
 *
 * libSQL 0.5.29 (the native driver under @libsql/client 0.18.0) leaves an EXPLAIN statement
 * BUSY after `all()` has returned every row: `sqlite_stmt` lists it with `busy = 1` until the
 * statement is garbage-collected. While it is busy the connection never leaves its read
 * transaction, so on a `file:` database that pooled connection keeps an ever older WAL
 * snapshot, and the next write that happens to borrow it fails with `SQLITE_BUSY_SNAPSHOT`
 * ("database is locked") and a migration's COMMIT on it with "cannot commit transaction - SQL
 * statements in progress" — in whichever test file runs next. Ordinary SELECTs reach
 * SQLITE_DONE and do not do this; nothing under `src/` runs EXPLAIN.
 *
 * So the plan is read on a separate client for the shared test database, closed right after
 * (closing finalizes the statement). The `file::memory:` fallback (an explicit
 * `TEST_DATABASE_URL=file::memory:`) has no second connection to the same data, so it uses the
 * shared client, where a stale snapshot cannot exist.
 */
import { type InArgs, type ResultSet, createClient } from "@libsql/client";
import { client as sharedClient } from "../../src/db/client.ts";
import { env } from "../../src/env.ts";

export async function explain(sql: string, args: InArgs = []): Promise<ResultSet> {
  if (env.databaseUrl.includes(":memory:")) return sharedClient.execute({ sql, args });
  const own = createClient({ url: env.databaseUrl });
  try {
    return await own.execute({ sql, args });
  } finally {
    own.close();
  }
}
