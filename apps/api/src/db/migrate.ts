/**
 * Applies the generated SQL migrations in apps/api/drizzle, then every build
 * module's `afterMigrate` hook (SPEC §2, plan M2 decision 4).
 * Used by `bun run db:migrate`, `bun run seed`, `migrate:legacy` AND by integration tests against
 * the per-process temp `file:` test database (env.ts, ADR 0009).
 *
 * toon-recipe's `runMigrations` ran its JS backfill of the pre-folded search
 * columns (`backfillFoldedColumns`) right here. Those columns belong to the recipe
 * module's tables, so the backfill lives in the module and runs as its
 * `afterMigrate`; the core reaches it only through `modules/index.ts`.
 *
 * `migrateDatabase` is the migration as an Effect (docs/EFFECT.md E5, E7; plan `docs/plans/e5-scripts.md` P8): drizzle's
 * `migrate` on the current executor of `Database`, then each module's `afterMigrate` effect on the same `Database`.
 * `runMigrations(database)` is its Promise door for the callers that hold a bare drizzle instance (the tests that
 * migrate their own temp database, `migrate-legacy.ts` until E5-T08).
 *
 * Import rule: this file never imports `src/runtime.ts` and loads nothing of `src/env.ts` beyond what `db/client.ts`
 * already loads, so `scripts/migrate-legacy.ts` keeps its import order (CLAUDE.md "The CLI never imports
 * `src/env.ts`, and its import order is load-bearing"; `apps/api/test/import-order.test.ts` probes it first).
 */
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { Effect } from "effect";
import { isDatabaseError } from "../lib/errors.ts";
import { API_MODULES } from "../modules/index.ts";
import type { Database as DrizzleDatabase } from "./client.ts";
import { db as sharedDb } from "./client.ts";
import { Database } from "./database.ts";

/** Absolute path of the migrations folder, independent of process.cwd(). */
export const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");

/**
 * Applies all pending migrations to the current executor of `Database` (a failure is a `DatabaseError`), then runs
 * each module's `afterMigrate` in `API_MODULES` order on the same `Database`. `API_MODULES` is read here, inside the
 * generator, never at module load: a manifest's own imports may reach this file before `modules/index.ts` has
 * finished evaluating.
 */
export const migrateDatabase = Effect.fn("db.migrate")(function* () {
  const database = yield* Database;
  yield* database.use((db) => migrate(db as DrizzleDatabase, { migrationsFolder: MIGRATIONS_FOLDER }));
  for (const module of API_MODULES) {
    if (module.afterMigrate) yield* module.afterMigrate();
  }
});

/* legacy bridges: callers listed; the Promise door of migrateDatabase (plan e5 P8, P11: it survives E5) */

/**
 * The Promise door of `migrateDatabase` on a bare drizzle instance (defaults to the shared db). Callers: the ~20 test
 * files that migrate a temp database of their own (several pinned), `scripts/migrate-legacy.ts` (until E5-T08). It
 * rejects with what the old code rejected with: a `DatabaseError`'s `cause` (the raw libSQL error the bare `await
 * migrate(...)` threw), anything else unchanged.
 */
export function runMigrations(database: DrizzleDatabase = sharedDb): Promise<void> {
  return Effect.runPromise(migrateDatabase().pipe(Effect.provide(Database.layerFromExecutor(database)))).then(
    undefined,
    (error: unknown) => Promise.reject(isDatabaseError(error) ? error.cause : error),
  );
}
