/**
 * Applies the generated SQL migrations in apps/api/drizzle, then every build
 * module's `afterMigrate` hook (SPEC §2, plan M2 decision 4).
 * Used by `bun run db:migrate`, `bun run seed` AND by integration tests against
 * DATABASE_URL="file::memory:".
 *
 * toon-recipe's `runMigrations` ran its JS backfill of the pre-folded search
 * columns (`backfillFoldedColumns`) right here. Those columns belong to the recipe
 * module's tables, so the backfill lives in the module and runs as its
 * `afterMigrate`; the core reaches it only through `modules/index.ts`.
 */
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { API_MODULES } from "../modules/index.ts";
import type { Database } from "./client.ts";
import { db as sharedDb } from "./client.ts";

/** Absolute path of the migrations folder, independent of process.cwd(). */
export const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");

/**
 * Applies all pending migrations to `database` (defaults to the shared db), then
 * runs each module's `afterMigrate` in `API_MODULES` order. `API_MODULES` is read
 * here, inside the function, never at module load: a manifest's own imports may
 * reach this file before `modules/index.ts` has finished evaluating.
 */
export async function runMigrations(database: Database = sharedDb): Promise<void> {
  await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
  for (const module of API_MODULES) {
    await module.afterMigrate?.(database);
  }
}
