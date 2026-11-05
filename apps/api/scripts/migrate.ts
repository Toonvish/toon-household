/**
 * bun run db:migrate — applies apps/api/drizzle/*.sql to DATABASE_URL.
 *
 * Migrating needs the database only. env.ts requires SESSION_SECRET for the
 * running server, so a placeholder is supplied here (never overriding a real
 * value) rather than forcing operators to invent a secret to create tables.
 * The application imports are dynamic because static imports are hoisted above
 * this line; only `effect` and the script runner (which imports nothing of the
 * repo) are static (plan `docs/plans/e5-scripts.md` P2 row 1).
 *
 * An Effect program on the one `AppLayer` (docs/EFFECT.md E10): `AppConfig` gives the
 * two header lines, `migrateDatabase` migrates the shared database, and the layer's
 * scope closes the client (`[db] database closed`, P3) before `runScript` exits.
 */
import { Console, Effect } from "effect";
import { runScript } from "./support/main.ts";

process.env.SESSION_SECRET ||= "db-migrate-does-not-use-the-session-secret";

if (import.meta.main) {
  runScript(
    Effect.gen(function* () {
      const { AppLayer } = yield* Effect.promise(() => import("../src/runtime.ts"));
      const { AppConfig } = yield* Effect.promise(() => import("../src/config.ts"));
      const { MIGRATIONS_FOLDER, migrateDatabase } = yield* Effect.promise(() => import("../src/db/migrate.ts"));
      yield* Effect.gen(function* () {
        const config = yield* AppConfig;
        yield* Console.log(`[db:migrate] ${config.databaseKind} database: ${config.DATABASE_URL}`);
        yield* Console.log(`[db:migrate] migrations: ${MIGRATIONS_FOLDER}`);
        yield* migrateDatabase();
        yield* Console.log("[db:migrate] done");
      }).pipe(Effect.provide(AppLayer));
    }),
  );
}
