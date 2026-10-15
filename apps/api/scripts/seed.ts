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
 *     nothing (the db modules are imported dynamically below for exactly that reason);
 *   - otherwise: `SEED_PASSWORD` when set, else `demo1234`.
 *
 * Login: demo@toon.local / demo1234 (development default)
 */
import { env } from "../src/env.ts";

const DEMO_EMAIL = "demo@toon.local";
const DEFAULT_DEMO_PASSWORD = "demo1234";
const MIN_PRODUCTION_PASSWORD_LENGTH = 10;

function resolveDemoPassword(): string {
  const seedPassword = process.env.SEED_PASSWORD;
  if (env.isProduction) {
    if (process.env.ALLOW_SEED !== "1") {
      console.error("[seed] refusing to run with NODE_ENV=production. Set ALLOW_SEED=1 if you really mean it.");
      process.exit(1);
    }
    if (!seedPassword || seedPassword.length < MIN_PRODUCTION_PASSWORD_LENGTH) {
      console.error(
        `[seed] SEED_PASSWORD (>= ${MIN_PRODUCTION_PASSWORD_LENGTH} chars) is required in production — the default is public.`,
      );
      process.exit(1);
    }
    return seedPassword;
  }
  return seedPassword && seedPassword.length > 0 ? seedPassword : DEFAULT_DEMO_PASSWORD;
}

const DEMO_PASSWORD = resolveDemoPassword();

// Only now the database: `db/client.ts` opens (and creates) the file on import.
const { eq } = await import("drizzle-orm");
const { initializeHousehold } = await import("../src/core/services/households/modules.ts");
const { client, db } = await import("../src/db/client.ts");
const { runMigrations } = await import("../src/db/migrate.ts");
const { householdMembers, households, users } = await import("../src/db/schema.ts");
const { API_MODULES } = await import("../src/modules/index.ts");

await runMigrations();

const now = Date.now();

const existingUser = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
let userId = existingUser[0]?.id;

if (!userId) {
  userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email: DEMO_EMAIL,
    name: "Demo Koch",
    // The flag and its evidence ALWAYS move together — see the column comment in
    // db/schema/core.ts and markEmailVerified() in core/services/auth/emailVerification.ts.
    // `true` is fine here because the demo account's address is fictional and the
    // seed is the thing vouching for it; leaving `emailVerifiedAt` null would have
    // shipped a row that contradicts the invariant.
    emailVerified: true,
    emailVerifiedAt: now,
    passwordHash: await Bun.password.hash(DEMO_PASSWORD, { algorithm: "argon2id" }),
    createdAt: now,
    updatedAt: now,
  });
  console.log(env.isProduction ? `[seed] user ${DEMO_EMAIL}` : `[seed] user ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

const existingHousehold = await db.select().from(households).where(eq(households.createdBy, userId)).limit(1);
let householdId = existingHousehold[0]?.id;

if (!householdId) {
  householdId = crypto.randomUUID();
  await db.insert(households).values({
    id: householdId,
    name: "Familie",
    description: "Unsere gemeinsamen Rezepte",
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(householdMembers).values({
    id: crypto.randomUUID(),
    householdId,
    userId,
    role: "owner",
    createdAt: now,
  });
  await initializeHousehold(db, householdId);
  await db.update(users).set({ activeHouseholdId: householdId, updatedAt: now }).where(eq(users.id, userId));
  console.log(`[seed] household "Familie" (${householdId})`);
}

// Module demo content (SPEC §2, plan M2 decision 4): recipe's tags, courses, demo recipes,
// plan entries, cook log and shopping list (toon-recipe scripts/seed.ts) arrive through its
// `seedDemo`; the core names no module here.
for (const module of API_MODULES) {
  await module.seedDemo?.(db, { householdId, userId, demoPassword: DEMO_PASSWORD });
}

console.log("[seed] done");
console.log("");
console.log("  Login:    " + DEMO_EMAIL);
console.log("  Passwort: " + (env.isProduction ? "(SEED_PASSWORD)" : DEMO_PASSWORD));
console.log("");
client.close();
