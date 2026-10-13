/**
 * bun run db:migrate — applies apps/api/drizzle/*.sql to DATABASE_URL.
 *
 * Migrating needs the database only. env.ts requires SESSION_SECRET for the
 * running server, so a placeholder is supplied here (never overriding a real
 * value) rather than forcing operators to invent a secret to create tables.
 * The imports are dynamic because static imports are hoisted above this line.
 */
process.env.SESSION_SECRET ||= "db-migrate-does-not-use-the-session-secret";

const { client } = await import("../src/db/client.ts");
const { MIGRATIONS_FOLDER, runMigrations } = await import("../src/db/migrate.ts");
const { env } = await import("../src/env.ts");

console.log(`[db:migrate] ${env.databaseKind} database: ${env.DATABASE_URL}`);
console.log(`[db:migrate] migrations: ${MIGRATIONS_FOLDER}`);
await runMigrations();
console.log("[db:migrate] done");
client.close();
