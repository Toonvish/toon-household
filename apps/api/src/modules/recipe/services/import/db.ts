/**
 * Database accessor for the import routes.
 *
 * Production behaviour is exactly "use the shared drizzle instance". The
 * indirection exists so integration tests can point the import routes at their
 * own database, which is REQUIRED here and not just convenient:
 *
 *   @libsql/client 0.17.4 lost an in-memory database as soon as a transaction
 *   was committed (0.18.0 no longer does, but the file DB is kept so a regression
 *   cannot hide here) — `client.transaction()` + `commit()` leaves the client talking
 *   to a fresh, empty `file::memory:` DB ("no such table: users"). Since
 *   `commitDraft` is transactional by design, its tests must run against a
 *   file-backed (or `?cache=shared`) database. See the agent report.
 *
 * The setter is inert outside NODE_ENV=test.
 */
import type { Database } from "../../../../db/client.ts";
import { db as sharedDb } from "../../../../db/client.ts";
import { env } from "../../../../env.ts";

let override: Database | null = null;

/** The database the import routes read and write. */
export function importDb(): Database {
  return override ?? sharedDb;
}

/** Test seam: point the import routes at another database (null = restore). */
export function setImportDbForTests(next: Database | null): void {
  if (!env.isTest) throw new Error("setImportDbForTests is only available under NODE_ENV=test");
  override = next;
}
