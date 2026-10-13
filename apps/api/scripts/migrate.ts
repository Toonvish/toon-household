/**
 * bun run db:migrate — applies apps/api/drizzle/*.sql to DATABASE_URL.
 */
import { client } from "../src/db/client.ts";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/db/migrate.ts";
import { env } from "../src/env.ts";

console.log(`[db:migrate] ${env.databaseKind} database: ${env.DATABASE_URL}`);
console.log(`[db:migrate] migrations: ${MIGRATIONS_FOLDER}`);
await runMigrations();
console.log("[db:migrate] done");
client.close();
