/**
 * bun run seed — creates the demo user demo@toon.local and the demo household "Familie"
 * (owner), with the default module rows, then every build module's `seedDemo` hook (recipe's
 * demo content from M2-T05, finance's demo ledger and its two extra logins from M3).
 * Idempotent — each hook must be too.
 *
 * The password (plan m3b decision 17, toon-finance 1715207 gotcha 74) is resolved ONCE here
 * and handed to every module in the `seedDemo` context, so no demo login of any module has
 * another one:
 *   - production: refused unless `ALLOW_SEED=1` AND an own `SEED_PASSWORD` (>= 10 chars) are
 *     set — accounts whose password is printed in the README must never appear on a public
 *     origin by accident. The refusal happens BEFORE the database is opened, so it writes
 *     nothing (`runtime.ts` and every database module are imported dynamically below, after the
 *     refusal, for exactly that reason: plan `docs/plans/e5-scripts.md` P2 row 2);
 *   - otherwise: `SEED_PASSWORD` when set, else `demo1234`.
 *
 * Login: demo@toon.local / demo1234 (development default)
 *
 * An Effect program on the one `AppLayer` (docs/EFFECT.md E10): `runScript` runs it, the layer's
 * scope closes the client (`[db] database closed`, P3) before the process exits. Only `effect`,
 * the script runner and `src/config.ts` (no database) are static imports (P2).
 */
import { Clock, Console, Effect } from "effect";
import { AppConfig } from "../src/config.ts";
import { ScriptExit, runScript } from "./support/main.ts";

const DEMO_EMAIL = "demo@toon.local";
const DEFAULT_DEMO_PASSWORD = "demo1234";
const MIN_PRODUCTION_PASSWORD_LENGTH = 10;

/** The one demo password, or the refusal (exit 1, nothing written: no database module is loaded yet). */
const resolveDemoPassword = Effect.gen(function* () {
  const config = yield* AppConfig;
  const seedPassword = process.env.SEED_PASSWORD;
  if (config.isProduction) {
    if (process.env.ALLOW_SEED !== "1") {
      yield* Console.error("[seed] refusing to run with NODE_ENV=production. Set ALLOW_SEED=1 if you really mean it.");
      return yield* new ScriptExit({ code: 1 });
    }
    if (!seedPassword || seedPassword.length < MIN_PRODUCTION_PASSWORD_LENGTH) {
      yield* Console.error(
        `[seed] SEED_PASSWORD (>= ${MIN_PRODUCTION_PASSWORD_LENGTH} chars) is required in production — the default is public.`,
      );
      return yield* new ScriptExit({ code: 1 });
    }
    return seedPassword;
  }
  return seedPassword && seedPassword.length > 0 ? seedPassword : DEFAULT_DEMO_PASSWORD;
});

const seed = Effect.gen(function* () {
  const config = yield* AppConfig;
  const demoPassword = yield* resolveDemoPassword;

  // Only now the database: `db/client.ts` opens (and creates) the file when `runtime.ts` loads.
  const { eq } = yield* Effect.promise(() => import("drizzle-orm"));
  const { AppLayer } = yield* Effect.promise(() => import("../src/runtime.ts"));
  const { Database } = yield* Effect.promise(() => import("../src/db/database.ts"));
  const { migrateDatabase } = yield* Effect.promise(() => import("../src/db/migrate.ts"));
  const { householdMembers, households, users } = yield* Effect.promise(() => import("../src/db/schema.ts"));
  const { HouseholdModules } = yield* Effect.promise(() => import("../src/core/services/households/modules.ts"));
  const { API_MODULES } = yield* Effect.promise(() => import("../src/modules/index.ts"));

  yield* Effect.gen(function* () {
    const database = yield* Database;
    const modules = yield* HouseholdModules;

    yield* migrateDatabase();

    const now = yield* Clock.currentTimeMillis;

    const existingUser = yield* database.use((db) =>
      db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1),
    );
    let userId = existingUser[0]?.id;

    if (!userId) {
      const newUserId = crypto.randomUUID();
      userId = newUserId;
      const passwordHash = yield* Effect.tryPromise(() => Bun.password.hash(demoPassword, { algorithm: "argon2id" }));
      yield* database.use((db) =>
        db.insert(users).values({
          id: newUserId,
          email: DEMO_EMAIL,
          name: "Demo Koch",
          // The flag and its evidence ALWAYS move together — see the column comment in
          // db/schema/core.ts and markEmailVerified() in core/services/auth/emailVerification.ts.
          // `true` is fine here because the demo account's address is fictional and the
          // seed is the thing vouching for it; leaving `emailVerifiedAt` null would have
          // shipped a row that contradicts the invariant.
          emailVerified: true,
          emailVerifiedAt: now,
          passwordHash,
          createdAt: now,
          updatedAt: now,
        }),
      );
      yield* Console.log(config.isProduction ? `[seed] user ${DEMO_EMAIL}` : `[seed] user ${DEMO_EMAIL} / ${demoPassword}`);
    }
    const seedUserId = userId;

    const existingHousehold = yield* database.use((db) =>
      db.select().from(households).where(eq(households.createdBy, seedUserId)).limit(1),
    );
    let householdId = existingHousehold[0]?.id;

    if (!householdId) {
      const newHouseholdId = crypto.randomUUID();
      householdId = newHouseholdId;
      yield* database.use((db) =>
        db.insert(households).values({
          id: newHouseholdId,
          name: "Familie",
          description: "Unsere gemeinsamen Rezepte",
          createdBy: seedUserId,
          createdAt: now,
          updatedAt: now,
        }),
      );
      yield* database.use((db) =>
        db.insert(householdMembers).values({
          id: crypto.randomUUID(),
          householdId: newHouseholdId,
          userId: seedUserId,
          role: "owner",
          createdAt: now,
        }),
      );
      yield* modules.initializeHousehold(newHouseholdId);
      yield* database.use((db) =>
        db.update(users).set({ activeHouseholdId: newHouseholdId, updatedAt: now }).where(eq(users.id, seedUserId)),
      );
      yield* Console.log(`[seed] household "Familie" (${newHouseholdId})`);
    }
    const seedHouseholdId = householdId;

    // Module demo content (SPEC §2, plan M2 decision 4): recipe's tags, courses, demo recipes,
    // plan entries, cook log and shopping list (toon-recipe scripts/seed.ts) arrive through its
    // `seedDemo`; the core names no module here. The hooks are Effects over `Database`, so they
    // run on the AppLayer directly (plan e5 E5-T02).
    for (const module of API_MODULES) {
      if (module.seedDemo) {
        yield* module.seedDemo({ householdId: seedHouseholdId, userId: seedUserId, demoPassword });
      }
    }

    yield* Console.log("[seed] done");
    yield* Console.log("");
    yield* Console.log("  Login:    " + DEMO_EMAIL);
    yield* Console.log("  Passwort: " + (config.isProduction ? "(SEED_PASSWORD)" : demoPassword));
    yield* Console.log("");
  }).pipe(Effect.provide(AppLayer));
});

if (import.meta.main) {
  runScript(seed.pipe(Effect.provide(AppConfig.layer)));
}
