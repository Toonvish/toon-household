/**
 * The core test doors of `apps/api/test/support/bridges/` against the Effect forms they wrap (docs/EFFECT.md E6, E7, E9;
 * plan `docs/plans/e8-harden.md` P1, P2, P4, P8, E8-T05): `migrate`, `api-error`, `sessions`, `users`, `rate-limit`,
 * `mail`. One case per door: the door and the Effect form get the same input and must give the same outcome (the
 * resolved value, or the rejected error's `_tag`, `code` and identity rule). The Effect form runs the way the door runs
 * it: `migrateDatabase` with `Effect.runPromise` over `Database.layerFromExecutor`, the `Sessions`, `Users` and
 * `MailerService` methods on the app runtime through `runTest`, `checkIn` with `Effect.runSync`; the legacy `ApiError`
 * class is compared with the tagged family member each constructor and static helper stands for.
 *
 * Isolation (ADR 0009: one process, one shared database, one module-level rate-limit store): the rate-limit cases use
 * a key unique to this file and a rule object of their own, and `resetRateLimits()` runs in `afterAll`; the session and
 * claim cases run on rows this file creates, which `afterAll` deletes (the household first, so the cascade takes the
 * memberships; then the users, whose sessions cascade) before it asserts that the counts of `users`, `households` and
 * `sessions` are back to what `beforeAll` recorded; `trySendMail` runs under a recording mailer installed with
 * `setMailer` and released with `setMailer(null)`; the migration cases run on fresh temp file databases only.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { type RateLimitRule, checkIn, resetRateLimits } from "../src/core/services/auth/rateLimit.ts";
import { Sessions } from "../src/core/services/auth/sessions.ts";
import { Users } from "../src/core/services/auth/users.ts";
import { type MailMessage, MailerService, setMailer } from "../src/core/services/mail/index.ts";
import { type Database as DrizzleDatabase, client as sharedClient, createDatabase, db as sharedDb } from "../src/db/client.ts";
import { Database } from "../src/db/database.ts";
import { migrateDatabase } from "../src/db/migrate.ts";
import { householdMembers, households, users } from "../src/db/schema.ts";
import {
  ApiFailure,
  type ApiErrorFamily,
  type ApiErrorShape,
  BadRequest,
  Conflict,
  DatabaseError,
  Forbidden,
  Internal,
  InvalidCredentials,
  NotFound,
  PayloadTooLarge,
  Unauthorized,
  UnsupportedMediaType,
  ValidationFailed,
  errorBody,
  isApiError,
} from "../src/lib/errors.ts";
import { ApiError } from "./support/bridges/api-error.ts";
import { trySendMail } from "./support/bridges/mail.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { checkRateLimit } from "./support/bridges/rate-limit.ts";
import { createSession } from "./support/bridges/sessions.ts";
import { claimPlaceholderUser } from "./support/bridges/users.ts";
import { recordingMailer, runTest } from "./support/effect.ts";

/** The Effect form of the `runMigrations` door: `migrateDatabase` over a bare drizzle instance. */
function migrateEffect(database: DrizzleDatabase): Promise<void> {
  return Effect.runPromise(migrateDatabase().pipe(Effect.provide(Database.layerFromExecutor(database))));
}

const COUNTED = ["users", "households", "sessions"] as const;

async function countOf(table: (typeof COUNTED)[number]): Promise<number> {
  const result = await sharedClient.execute(`SELECT count(*) AS n FROM "${table}"`);
  return Number(result.rows[0]?.n ?? 0);
}

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of COUNTED) out[table] = await countOf(table);
  return out;
}

/** The rejection value of `promise` (fails the test when it resolves). */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    (value) => {
      throw new Error(`expected a rejection, got ${JSON.stringify(value)}`);
    },
    (error: unknown) => error,
  );
}

function tagOf(u: unknown): unknown {
  return (u as { _tag?: unknown })._tag;
}

const tempDirs: string[] = [];
const createdUserIds: string[] = [];
const createdHouseholdIds: string[] = [];
let before: Record<string, number> = {};

beforeAll(async () => {
  await runMigrations(sharedDb);
  before = await counts();
});

afterAll(async () => {
  try {
    // households first: the cascade takes the memberships; then the users, whose sessions cascade
    for (const id of createdHouseholdIds) await sharedDb.delete(households).where(eq(households.id, id));
    for (const id of createdUserIds) await sharedDb.delete(users).where(eq(users.id, id));
    expect(await counts()).toEqual(before);
  } finally {
    resetRateLimits();
    setMailer(null);
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  }
});

/** A verified account of this file, recorded for the cleanup. */
async function createAccount(name: string): Promise<string> {
  const id = crypto.randomUUID();
  createdUserIds.push(id);
  await sharedDb.insert(users).values({
    id,
    email: `bridges-core.${id.slice(0, 8)}@toon.test`,
    name,
    emailVerified: true,
    emailVerifiedAt: Date.now(),
  });
  return id;
}

/** A placeholder member (no e-mail, no password) of `householdId`, recorded for the cleanup. */
async function createPlaceholder(householdId: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  createdUserIds.push(id);
  await sharedDb.insert(users).values({ id, email: null, name });
  await sharedDb.insert(householdMembers).values({ id: crypto.randomUUID(), householdId, userId: id, role: "member" });
  return id;
}

async function tableNames(client: { execute(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> }) {
  const result = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return result.rows.map((row) => String(row.name));
}

describe("the core test doors match the Effect forms they wrap", () => {
  test("runMigrations: door and migrateDatabase migrate a fresh temp database to the same tables and resolve undefined", async () => {
    const dir = mkdtempSync(join(tmpdir(), "toon-bridges-core-"));
    tempDirs.push(dir);
    const viaDoor = createDatabase({ url: `file:${join(dir, "door.db")}` });
    const viaEffect = createDatabase({ url: `file:${join(dir, "effect.db")}` });
    try {
      await viaDoor.ready;
      await viaEffect.ready;
      expect(await runMigrations(viaDoor.db)).toBeUndefined();
      expect(await migrateEffect(viaEffect.db)).toBeUndefined();
      const doorTables = await tableNames(viaDoor.client);
      expect(doorTables).toContain("users");
      expect(doorTables).toContain("recipe_recipes");
      expect(doorTables).toEqual(await tableNames(viaEffect.client));
      // a second run applies nothing and resolves the same way
      expect(await runMigrations(viaEffect.db)).toBeUndefined();
      expect(await migrateEffect(viaDoor.db)).toBeUndefined();
    } finally {
      viaDoor.client.close();
      viaEffect.client.close();
    }
  });

  test("ApiError: the same status, code, text, details, message and body as the family member, and the instanceof rule", () => {
    const pairs: Array<[ApiError, ApiErrorFamily]> = [
      [
        new ApiError(418, "teapot", "server.error.badRequest", { a: 1 }),
        new ApiFailure({ status: 418, code: "teapot", text: "server.error.badRequest", details: { a: 1 } }),
      ],
      [ApiError.badRequest(), new BadRequest()],
      [ApiError.badRequest("server.error.validationFailed", [1]), new BadRequest({ text: "server.error.validationFailed", details: [1] })],
      [ApiError.unauthorized(), new Unauthorized()],
      [ApiError.invalidCredentials(), new InvalidCredentials()],
      [ApiError.forbidden(), new Forbidden()],
      [ApiError.notFound(), new NotFound()],
      [ApiError.conflict(), new Conflict()],
      [ApiError.conflict("email_taken", "server.error.conflict"), new Conflict({ code: "email_taken", text: "server.error.conflict" })],
      [ApiError.payloadTooLarge(), new PayloadTooLarge()],
      [ApiError.unsupportedMediaType(), new UnsupportedMediaType()],
      [ApiError.validationFailed([{ path: "x" }]), new ValidationFailed({ details: [{ path: "x" }] })],
      [ApiError.internal(), new Internal()],
    ];
    for (const [door, family] of pairs) {
      const shape: ApiErrorShape = family;
      expect(door._tag).toBe("ApiFailure");
      expect(door.name).toBe("ApiError");
      expect(door.status).toBe(family.status);
      expect(door.code).toBe(family.code);
      expect(door.text).toEqual(shape.text);
      expect(door.details).toEqual(shape.details);
      expect(door.message).toBe(family.message);
      expect(door.toBody()).toEqual(errorBody(family));
      expect(door.toBody("en")).toEqual(errorBody(family, "en"));
      expect(door.toBody()).toEqual(errorBody(door));
      expect(isApiError(door)).toBe(true);
      expect(isApiError(family)).toBe(true);
      // the identity rule: `instanceof ApiError` is `isApiError`, so every family member passes it
      expect(door instanceof ApiFailure).toBe(true);
      expect(family instanceof ApiError).toBe(true);
    }
    const tagged = new NotFound();
    expect(tagged instanceof ApiError).toBe(isApiError(tagged));
    expect(tagged instanceof ApiError).toBe(true);
    const database = new DatabaseError({ cause: new Error("disk") });
    expect(database instanceof ApiError).toBe(isApiError(database));
    expect(database instanceof ApiError).toBe(false);
    expect(new Error("plain") instanceof ApiError).toBe(false);
  });

  test("createSession: door and Sessions.createSession write a session row of the same shape for the same user and fingerprint", async () => {
    const userId = await createAccount("Sitzung");
    const fingerprint = { ipAddress: "203.0.113.7", userAgent: "bridges-core" };
    const fromDoor = await createSession(sharedDb, userId, fingerprint);
    const fromEffect = await runTest(Sessions.use((service) => service.createSession(userId, fingerprint)));
    expect(Object.keys(fromDoor).sort()).toEqual(Object.keys(fromEffect).sort());
    expect(fromDoor.userId).toBe(userId);
    expect(fromEffect.userId).toBe(userId);
    expect(fromDoor.ipAddress).toBe(fromEffect.ipAddress);
    expect(fromDoor.userAgent).toBe(fromEffect.userAgent);
    expect(fromDoor.expiresAt - fromDoor.createdAt).toBe(fromEffect.expiresAt - fromEffect.createdAt);
    expect(fromDoor.id).not.toBe(fromEffect.id);
    // the default fingerprint
    const bare = await createSession(sharedDb, userId);
    const bareEffect = await runTest(Sessions.use((service) => service.createSession(userId)));
    expect([bare.ipAddress, bare.userAgent]).toEqual([bareEffect.ipAddress, bareEffect.userAgent]);
    expect([bare.ipAddress, bare.userAgent]).toEqual([null, null]);
  });

  test("claimPlaceholderUser: door and Users.claimPlaceholderUser claim a fresh placeholder and refuse a second claim with the same Conflict", async () => {
    const ownerId = await createAccount("Besitzer");
    const householdId = crypto.randomUUID();
    createdHouseholdIds.push(householdId);
    await sharedDb.insert(households).values({ id: householdId, name: "Bridges", createdBy: ownerId });
    await sharedDb.insert(householdMembers).values({ id: crypto.randomUUID(), householdId, userId: ownerId, role: "owner" });
    const forDoor = await createPlaceholder(householdId, "Platz Eins");
    const forEffect = await createPlaceholder(householdId, "Platz Zwei");
    const input = (tag: string) => ({
      email: `bridges-core.claim-${tag}-${householdId.slice(0, 8)}@toon.test`,
      name: "Sandy",
      passwordHash: `$argon2id$${tag}`,
    });
    const claimEffect = (userId: string, tag: string) =>
      runTest(Users.use((service) => service.claimPlaceholderUser(userId, input(tag))));

    expect(await claimPlaceholderUser(sharedDb, forDoor, input("door"))).toBeUndefined();
    expect(await claimEffect(forEffect, "effect")).toBeUndefined();

    // a claimed account is no placeholder any more: member_has_account from both
    const doorAgain = await rejection(claimPlaceholderUser(sharedDb, forDoor, input("again-door")));
    const effectAgain = await rejection(claimEffect(forDoor, "again-effect"));
    expect(isApiError(doorAgain)).toBe(true);
    expect(isApiError(effectAgain)).toBe(true);
    expect(doorAgain).toBeInstanceOf(ApiError);
    expect(effectAgain).toBeInstanceOf(Conflict);
    expect(tagOf(doorAgain)).toBe(tagOf(effectAgain));
    expect(tagOf(doorAgain)).toBe("Conflict");
    expect((doorAgain as ApiError).code).toBe((effectAgain as ApiError).code);
    expect((doorAgain as ApiError).code).toBe("member_has_account");
    expect((doorAgain as ApiError).status).toBe((effectAgain as ApiError).status);

    const rows = await sharedDb
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, forDoor));
    expect(rows[0]?.email).toBe(input("door").email);
    const effectRows = await sharedDb.select({ email: users.email }).from(users).where(eq(users.id, forEffect));
    expect(effectRows[0]?.email).toBe(input("effect").email);
  });

  test("checkRateLimit: synchronous, the same results as checkIn, one shared bucket store", () => {
    const rule: RateLimitRule = { limit: 2, windowMs: 60_000 };
    const doorKey = `bridges-core:${crypto.randomUUID()}`;
    const effectKey = `bridges-core:${crypto.randomUUID()}`;
    const fromDoor = [checkRateLimit(doorKey, rule), checkRateLimit(doorKey, rule), checkRateLimit(doorKey, rule)];
    const fromEffect = [
      Effect.runSync(checkIn(effectKey, rule)),
      Effect.runSync(checkIn(effectKey, rule)),
      Effect.runSync(checkIn(effectKey, rule)),
    ];
    expect(fromDoor).toEqual(fromEffect);
    expect(fromDoor.map((result) => [result.allowed, result.remaining])).toEqual([
      [true, 1],
      [true, 0],
      [false, 0],
    ]);
    expect(fromDoor[2]?.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    // the door and the Effect form count into the same live store
    const sharedKey = `bridges-core:${crypto.randomUUID()}`;
    expect(checkRateLimit(sharedKey, rule).remaining).toBe(1);
    expect(Effect.runSync(checkIn(sharedKey, rule)).remaining).toBe(0);
    expect(checkRateLimit(sharedKey, rule).allowed).toBe(false);
    for (const key of [doorKey, effectKey, sharedKey]) resetRateLimits(key);
  });

  test("trySendMail: the same result as MailerService.trySendMail over the installed mailer, delivered or failed, never a rejection", async () => {
    const message: MailMessage = { to: "bridges-core@toon.test", subject: "Betreff", text: "Hallo" };
    const viaService = () => runTest(MailerService.use((mailer) => mailer.trySendMail(message)));
    const recording = recordingMailer();
    setMailer(recording);
    try {
      const fromDoor = await trySendMail(message);
      const fromEffect = await viaService();
      expect(fromDoor).toEqual(fromEffect);
      expect(fromDoor).toEqual({ delivered: true, transport: "recording" });
      expect(recording.messages).toEqual([message, message]);

      const failing = recordingMailer({ name: "relay", fail: "relay down" });
      setMailer(failing);
      const failedDoor = await trySendMail(message);
      const failedEffect = await viaService();
      expect(failedDoor).toEqual(failedEffect);
      expect(failedDoor).toEqual({ delivered: false, transport: "relay", error: "relay down" });
      expect(failing.messages).toHaveLength(2);
    } finally {
      setMailer(null);
    }
  });
});
