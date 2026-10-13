/**
 * drizzle-kit config. Reads DATABASE_URL/DATABASE_AUTH_TOKEN from the environment
 * so the same commands work for a local file DB and for Turso cloud.
 *
 *   bun run db:generate   -> writes SQL into apps/api/drizzle
 *   bun run db:migrate    -> applies them (scripts/migrate.ts)
 *   bun run db:studio     -> drizzle studio
 */
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "file:../../data/local.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: authToken ? { url, authToken } : { url },
  strict: true,
  verbose: true,
});
