/**
 * Applies the generated SQL migrations in apps/api/drizzle.
 * Used by `bun run db:migrate` AND by integration tests against
 * DATABASE_URL="file::memory:".
 *
 * toon-recipe's `runMigrations` also ran a JS backfill of the pre-folded search
 * columns (`backfillFoldedColumns`) after migrating. Those columns belong to the
 * recipe module's tables, so that backfill returns with the recipe module in M2;
 * until then this is migrate only.
 */
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "./client.ts";
import { db as sharedDb } from "./client.ts";

/** Absolute path of the migrations folder, independent of process.cwd(). */
export const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");

/** Applies all pending migrations to `database` (defaults to the shared db). */
export async function runMigrations(database: Database = sharedDb): Promise<void> {
  await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
}
