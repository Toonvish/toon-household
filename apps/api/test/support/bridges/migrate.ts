/**
 * The test door of `apps/api/src/db/migrate.ts` (docs/EFFECT.md E7, E9; plan `docs/plans/e8-harden.md` P1): moved from
 * `apps/api/src/db/migrate.ts` at E8 (plan e8 P1). `src` keeps the Effect form `migrateDatabase`; this file keeps the
 * Promise door the tests call on a bare drizzle instance.
 *
 * Import rule: like its source module, it never imports `src/runtime.ts`.
 */
import { Effect } from "effect";
import type { Database as DrizzleDatabase } from "../../../src/db/client.ts";
import { db as sharedDb } from "../../../src/db/client.ts";
import { Database } from "../../../src/db/database.ts";
import { migrateDatabase } from "../../../src/db/migrate.ts";
import { isDatabaseError } from "../../../src/lib/errors.ts";

/**
 * The Promise door of `migrateDatabase` on a bare drizzle instance (defaults to the shared db). Moved from
 * `apps/api/src/db/migrate.ts` at E8 (plan e8 P1). Callers: the test files that migrate the shared db or a temp
 * database of their own, `apps/api/test/support/legacy-harness.ts`. It rejects with what the old code rejected with: a
 * `DatabaseError`'s `cause` (the raw libSQL error the bare `await migrate(...)` threw), anything else unchanged.
 */
export function runMigrations(database: DrizzleDatabase = sharedDb): Promise<void> {
  return Effect.runPromise(migrateDatabase().pipe(Effect.provide(Database.layerFromExecutor(database)))).then(
    undefined,
    (error: unknown) => Promise.reject(isDatabaseError(error) ? error.cause : error),
  );
}
