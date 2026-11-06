/**
 * The core test doors of `apps/api/test/support/bridges/` against the src bridges they were copied from
 * (docs/EFFECT.md E7, E9; plan `docs/plans/e8-harden.md` P1, P4, P8, E8-T01): `migrate`, `api-error`, `sessions`,
 * `users`, `rate-limit`, `mail`. One case per door: the door and its src bridge get the same input and must give the
 * same outcome (the resolved value, or the rejected error's `_tag`, `code` and identity rule). Every src bridge is
 * imported ALIASED (`bridge…`), so the import rewrite of E8-T04 never touches this file; E8-T05 rewrites it to compare
 * each door with its Effect form instead (case count kept).
 *
 * Isolation (ADR 0009: one process, one shared database, one module-level rate-limit store): the rate-limit cases use
 * a key unique to this file and a rule object of their own, and `resetRateLimits()` runs in `afterAll`; the session and
 * claim cases run on rows this file creates, which `afterAll` deletes (the household first, so the cascade takes the
 * memberships; then the users, whose sessions cascade) before it asserts that the counts of `users`, `households` and
 * `sessions` are back to what `beforeAll` recorded; `trySendMail` runs under a recording mailer installed with
 * `setMailer` and released with `setMailer(null)`; `runMigrations` runs on fresh temp file databases only.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  checkRateLimit as bridgeCheckRateLimit,
  type RateLimitRule,
  resetRateLimits,
} from "../src/core/services/auth/rateLimit.ts";
import { createSession as bridgeCreateSession } from "../src/core/services/auth/sessions.ts";
import { claimPlaceholderUser as bridgeClaimPlaceholderUser } from "../src/core/services/auth/users.ts";
import { type MailMessage, setMailer, trySendMail as bridgeTrySendMail } from "../src/core/services/mail/index.ts";
import { client as sharedClient, createDatabase, db as sharedDb } from "../src/db/client.ts";
import { runMigrations as bridgeRunMigrations } from "../src/db/migrate.ts";
import { householdMembers, households, users } from "../src/db/schema.ts";
import { ApiError as BridgeApiError, DatabaseError, NotFound, errorBody, isApiError } from "../src/lib/errors.ts";
import { ApiError } from "./support/bridges/api-error.ts";
import { trySendMail } from "./support/bridges/mail.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { checkRateLimit } from "./support/bridges/rate-limit.ts";
import { createSession } from "./support/bridges/sessions.ts";
import { claimPlaceholderUser } from "./support/bridges/users.ts";
import { recordingMailer } from "./support/effect.ts";

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
  await bridgeRunMigrations(sharedDb);
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

describe("the core test doors match their src bridges", () => {
  test("runMigrations: both migrate a fresh temp database to the same tables and resolve undefined", async () => {
    const dir = mkdtempSync(join(tmpdir(), "toon-bridges-core-"));
    tempDirs.push(dir);
    const viaDoor = createDatabase({ url: `file:${join(dir, "door.db")}` });
    const viaBridge = createDatabase({ url: `file:${join(dir, "bridge.db")}` });
    try {
      await viaDoor.ready;
      await viaBridge.ready;
      expect(await runMigrations(viaDoor.db)).toBeUndefined();
      expect(await bridgeRunMigrations(viaBridge.db)).toBeUndefined();
      const doorTables = await tableNames(viaDoor.client);
      expect(doorTables).toContain("users");
      expect(doorTables).toContain("recipe_recipes");
      expect(doorTables).toEqual(await tableNames(viaBridge.client));
      // a second run applies nothing and resolves the same way
      expect(await runMigrations(viaBridge.db)).toBeUndefined();
      expect(await bridgeRunMigrations(viaDoor.db)).toBeUndefined();
    } finally {
      viaDoor.client.close();
      viaBridge.client.close();
    }
  });

  test("ApiError: the same status, code, text, tag, body and instanceof rule", () => {
    const pairs: Array<[ApiError, BridgeApiError]> = [
      [new ApiError(418, "teapot", "server.error.badRequest", { a: 1 }), new BridgeApiError(418, "teapot", "server.error.badRequest", { a: 1 })],
      [ApiError.badRequest(), BridgeApiError.badRequest()],
      [ApiError.badRequest("server.error.validationFailed", [1]), BridgeApiError.badRequest("server.error.validationFailed", [1])],
      [ApiError.unauthorized(), BridgeApiError.unauthorized()],
      [ApiError.invalidCredentials(), BridgeApiError.invalidCredentials()],
      [ApiError.forbidden(), BridgeApiError.forbidden()],
      [ApiError.notFound(), BridgeApiError.notFound()],
      [ApiError.conflict(), BridgeApiError.conflict()],
      [ApiError.conflict("email_taken", "server.error.conflict"), BridgeApiError.conflict("email_taken", "server.error.conflict")],
      [ApiError.payloadTooLarge(), BridgeApiError.payloadTooLarge()],
      [ApiError.unsupportedMediaType(), BridgeApiError.unsupportedMediaType()],
      [ApiError.validationFailed([{ path: "x" }]), BridgeApiError.validationFailed([{ path: "x" }])],
      [ApiError.internal(), BridgeApiError.internal()],
    ];
    for (const [door, bridge] of pairs) {
      expect(door._tag).toBe(bridge._tag);
      expect(door._tag).toBe("ApiFailure");
      expect(door.name).toBe(bridge.name);
      expect(door.status).toBe(bridge.status);
      expect(door.code).toBe(bridge.code);
      expect(door.text).toEqual(bridge.text);
      expect(door.details).toEqual(bridge.details);
      expect(door.message).toBe(bridge.message);
      expect(door.toBody()).toEqual(bridge.toBody());
      expect(door.toBody("en")).toEqual(bridge.toBody("en"));
      expect(door.toBody()).toEqual(errorBody(door));
      expect(isApiError(door)).toBe(true);
      // the identity rule: `instanceof` is `isApiError`, across both classes
      expect(door instanceof BridgeApiError).toBe(true);
      expect(bridge instanceof ApiError).toBe(true);
    }
    const tagged = new NotFound();
    expect(tagged instanceof ApiError).toBe(tagged instanceof BridgeApiError);
    expect(tagged instanceof ApiError).toBe(true);
    const database = new DatabaseError({ cause: new Error("disk") });
    expect(database instanceof ApiError).toBe(database instanceof BridgeApiError);
    expect(database instanceof ApiError).toBe(false);
    expect(new Error("plain") instanceof ApiError).toBe(false);
  });

  test("createSession: both write a session row of the same shape for the same user and fingerprint", async () => {
    const userId = await createAccount("Sitzung");
    const fingerprint = { ipAddress: "203.0.113.7", userAgent: "bridges-core" };
    const fromDoor = await createSession(sharedDb, userId, fingerprint);
    const fromBridge = await bridgeCreateSession(sharedDb, userId, fingerprint);
    expect(Object.keys(fromDoor).sort()).toEqual(Object.keys(fromBridge).sort());
    expect(fromDoor.userId).toBe(userId);
    expect(fromBridge.userId).toBe(userId);
    expect(fromDoor.ipAddress).toBe(fromBridge.ipAddress);
    expect(fromDoor.userAgent).toBe(fromBridge.userAgent);
    expect(fromDoor.expiresAt - fromDoor.createdAt).toBe(fromBridge.expiresAt - fromBridge.createdAt);
    expect(fromDoor.id).not.toBe(fromBridge.id);
    // the default fingerprint
    const bare = await createSession(sharedDb, userId);
    const bareBridge = await bridgeCreateSession(sharedDb, userId);
    expect([bare.ipAddress, bare.userAgent]).toEqual([bareBridge.ipAddress, bareBridge.userAgent]);
    expect([bare.ipAddress, bare.userAgent]).toEqual([null, null]);
  });

  test("claimPlaceholderUser: both claim a fresh placeholder and refuse a second claim with the same Conflict", async () => {
    const ownerId = await createAccount("Besitzer");
    const householdId = crypto.randomUUID();
    createdHouseholdIds.push(householdId);
    await sharedDb.insert(households).values({ id: householdId, name: "Bridges", createdBy: ownerId });
    await sharedDb.insert(householdMembers).values({ id: crypto.randomUUID(), householdId, userId: ownerId, role: "owner" });
    const forDoor = await createPlaceholder(householdId, "Platz Eins");
    const forBridge = await createPlaceholder(householdId, "Platz Zwei");
    const input = (tag: string) => ({
      email: `bridges-core.claim-${tag}-${householdId.slice(0, 8)}@toon.test`,
      name: "Sandy",
      passwordHash: `$argon2id$${tag}`,
    });

    expect(await claimPlaceholderUser(sharedDb, forDoor, input("door"))).toBeUndefined();
    expect(await bridgeClaimPlaceholderUser(sharedDb, forBridge, input("bridge"))).toBeUndefined();

    // a claimed account is no placeholder any more: member_has_account from both
    const doorAgain = await rejection(claimPlaceholderUser(sharedDb, forDoor, input("again-door")));
    const bridgeAgain = await rejection(bridgeClaimPlaceholderUser(sharedDb, forDoor, input("again-bridge")));
    expect(isApiError(doorAgain)).toBe(true);
    expect(doorAgain).toBeInstanceOf(ApiError);
    expect(bridgeAgain).toBeInstanceOf(BridgeApiError);
    expect(tagOf(doorAgain)).toBe(tagOf(bridgeAgain));
    expect(tagOf(doorAgain)).toBe("Conflict");
    expect((doorAgain as ApiError).code).toBe((bridgeAgain as ApiError).code);
    expect((doorAgain as ApiError).code).toBe("member_has_account");
    expect((doorAgain as ApiError).status).toBe((bridgeAgain as ApiError).status);

    const rows = await sharedDb.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, forDoor));
    expect(rows[0]?.email).toBe(input("door").email);
  });

  test("checkRateLimit: synchronous, the same results, one shared bucket store", () => {
    const rule: RateLimitRule = { limit: 2, windowMs: 60_000 };
    const doorKey = `bridges-core:${crypto.randomUUID()}`;
    const bridgeKey = `bridges-core:${crypto.randomUUID()}`;
    const fromDoor = [checkRateLimit(doorKey, rule), checkRateLimit(doorKey, rule), checkRateLimit(doorKey, rule)];
    const fromBridge = [
      bridgeCheckRateLimit(bridgeKey, rule),
      bridgeCheckRateLimit(bridgeKey, rule),
      bridgeCheckRateLimit(bridgeKey, rule),
    ];
    expect(fromDoor).toEqual(fromBridge);
    expect(fromDoor.map((result) => [result.allowed, result.remaining])).toEqual([
      [true, 1],
      [true, 0],
      [false, 0],
    ]);
    expect(fromDoor[2]?.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    // the door and the bridge count into the same live store
    const sharedKey = `bridges-core:${crypto.randomUUID()}`;
    expect(checkRateLimit(sharedKey, rule).remaining).toBe(1);
    expect(bridgeCheckRateLimit(sharedKey, rule).remaining).toBe(0);
    expect(checkRateLimit(sharedKey, rule).allowed).toBe(false);
    for (const key of [doorKey, bridgeKey, sharedKey]) resetRateLimits(key);
  });

  test("trySendMail: the same result over the installed mailer, delivered or failed, never a rejection", async () => {
    const message: MailMessage = { to: "bridges-core@toon.test", subject: "Betreff", text: "Hallo" };
    const recording = recordingMailer();
    setMailer(recording);
    try {
      const fromDoor = await trySendMail(message);
      const fromBridge = await bridgeTrySendMail(message);
      expect(fromDoor).toEqual(fromBridge);
      expect(fromDoor).toEqual({ delivered: true, transport: "recording" });
      expect(recording.messages).toEqual([message, message]);

      const failing = recordingMailer({ name: "relay", fail: "relay down" });
      setMailer(failing);
      const failedDoor = await trySendMail(message);
      const failedBridge = await bridgeTrySendMail(message);
      expect(failedDoor).toEqual(failedBridge);
      expect(failedDoor).toEqual({ delivered: false, transport: "relay", error: "relay down" });
      expect(failing.messages).toHaveLength(2);
    } finally {
      setMailer(null);
    }
  });
});
