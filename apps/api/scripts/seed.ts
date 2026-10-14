/**
 * bun run seed — creates the demo user demo@toon.local / demo1234 and the demo household "Familie"
 * (owner), with the default module rows, then every build module's `seedDemo` hook (recipe's
 * demo content from M2-T05, finance's demo ledger from M3). Idempotent — each hook must be too.
 *
 * Login: demo@toon.local / demo1234
 */
import { eq } from "drizzle-orm";
import { initializeHousehold } from "../src/core/services/households/modules.ts";
import { client, db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { householdMembers, households, users } from "../src/db/schema.ts";
import { API_MODULES } from "../src/modules/index.ts";

const DEMO_EMAIL = "demo@toon.local";
const DEMO_PASSWORD = "demo1234";

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
  console.log(`[seed] user ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
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
  await module.seedDemo?.(db, { householdId, userId });
}

console.log("[seed] done");
console.log("");
console.log("  Login:    " + DEMO_EMAIL);
console.log("  Passwort: " + DEMO_PASSWORD);
console.log("");
client.close();
