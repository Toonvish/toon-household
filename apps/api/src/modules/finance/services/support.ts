/**
 * Transaction plumbing of the finance services (toon-finance
 * `apps/api/src/services/support.ts`, plan M3 decision 15).
 *
 * `DbLike` / `Tx` are the core's (one definition for every service). `withTransaction`
 * is the module's own: toon-finance gotcha 2 says a ledger whose tests never see a real
 * transaction does not test its most important property. Since ADR 0009 (M7-T02) the
 * whole `bun test` run uses a fresh temp `file:` database (env.ts), so this opens a REAL
 * transaction everywhere, under test too, and `test/finance-file-db.test.ts` (d) proves a
 * rollback on the shared client. The one remaining exception is a shared client on a
 * memory URL (an explicit `TEST_DATABASE_URL=file::memory:`): there libSQL's
 * `client.transaction()` may open a second connection that is a fresh, empty database
 * (see the core `support.ts`), so the statements run sequentially on the shared client
 * instead. A database a test hands in itself (`createDatabase` + `runMigrations`) always
 * gets a real transaction. ADR 0003 (written by M3-T09) recorded the memory-DB arrangement and
 * is superseded by ADR 0009.
 */
import { type Database, db as sharedDb } from "../../../db/client.ts";
import { transactionsSupported } from "../../../core/services/households/support.ts";
import type { DbLike } from "../../../core/services/households/support.ts";

export type { DbLike, Tx } from "../../../core/services/households/support.ts";

/** Runs `work` inside a transaction wherever libSQL supports one (see above). */
export async function withTransaction<T>(db: Database, work: (tx: DbLike) => Promise<T>): Promise<T> {
  if (db === sharedDb && !transactionsSupported) return work(db);
  return db.transaction(async (tx) => work(tx));
}

/**
 * Escapes the LIKE metacharacters in a user-typed search term so `%` and `_` match themselves
 * (toon-finance 1715207). Use together with `ESCAPE '\\'` in the query: a bare
 * `like ${'%' + q + '%'}` lets `q = "%"` match every row.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
