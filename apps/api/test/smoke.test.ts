/**
 * Foundation smoke test + the TEMPLATE for every API integration test:
 * spin up an in-memory libSQL DB, run the generated migrations, hit `app`.
 *
 * Copy the `createDatabase` + `runMigrations` pattern below into your own test file.
 * DDL is checked through `@libsql/client`, never `bun:sqlite` (a newer SQLite than
 * the one the app runs on — toon-recipe CLAUDE.md).
 */
import { HealthResponseSchema } from "@toon/shared";
import { afterAll, describe, expect, test } from "bun:test";
import { createDatabase } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import {
  householdInvites,
  householdMembers,
  householdModules,
  households,
  legacyIds,
  users,
} from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { app } from "../src/index.ts";
import { ApiError } from "../src/lib/errors.ts";

const { client, db } = createDatabase({ url: "file::memory:" });
await runMigrations(db);

afterAll(() => {
  client.close();
});

const CORE_TABLES = [
  "email_verification_tokens",
  "household_invites",
  "household_members",
  "household_modules",
  "households",
  "legacy_ids",
  "oauth_accounts",
  "password_reset_tokens",
  "sessions",
  "users",
];

describe("env", () => {
  test("defaults to an in-memory DB under bun test", () => {
    expect(env.DATABASE_URL).toBe("file::memory:");
    expect(env.databaseKind).toBe("file");
    expect(env.webOrigins.length).toBeGreaterThan(0);
  });
});

describe("GET /api/health", () => {
  test("answers 200 with the health payload", async () => {
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      status: string;
      database: string;
      modules: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");
    expect(body.database).toBe("file");
    // The build's modules (SPEC §2): none until M2/M3 register theirs.
    expect(body.modules).toEqual([]);
    expect(() => HealthResponseSchema.parse(body)).not.toThrow();
  });
});

describe("error envelope", () => {
  test("unknown routes use the standard shape", async () => {
    const response = await app.request("/api/does-not-exist");
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("not_found");
    expect(typeof body.error.message).toBe("string");
  });

  test("ApiError.toBody() matches the contract", () => {
    const body = ApiError.conflict("email_taken", "server.auth.emailTaken").toBody();
    expect(body).toEqual({
      error: { code: "email_taken", message: "Diese E-Mail-Adresse ist bereits registriert" },
    });
  });
});

describe("schema + migrations", () => {
  test("migrations create all ten core tables", async () => {
    const result = await client.execute(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
    );
    expect(result.rows.map((row) => row.name)).toEqual(CORE_TABLES);
  });

  test("deleting a household cascades members, invites and module rows, not users", async () => {
    const userId = crypto.randomUUID();
    const householdId = crypto.randomUUID();

    await db.insert(users).values({ id: userId, email: "a@b.de", name: "Tester" });
    await db.insert(households).values({ id: householdId, name: "Familie", createdBy: userId });
    await db
      .insert(householdMembers)
      .values({ id: crypto.randomUUID(), householdId, userId, role: "owner" });
    await db.insert(householdInvites).values({
      id: crypto.randomUUID(),
      householdId,
      email: "c@d.de",
      token: crypto.randomUUID(),
      invitedBy: userId,
      expiresAt: Date.now() + 60_000,
    });
    await db.insert(householdModules).values({ householdId, moduleId: "recipe" });

    expect(await db.select().from(householdMembers)).toHaveLength(1);
    expect(await db.select().from(householdInvites)).toHaveLength(1);
    expect(await db.select().from(householdModules)).toHaveLength(1);

    await client.execute({ sql: "delete from households where id = ?", args: [householdId] });
    expect(await db.select().from(householdMembers)).toHaveLength(0);
    expect(await db.select().from(householdInvites)).toHaveLength(0);
    expect(await db.select().from(householdModules)).toHaveLength(0);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  test("users.email is unique", async () => {
    const first = crypto.randomUUID();
    await db.insert(users).values({ id: first, email: "dup@toon.local", name: "A" });
    const duplicate = async () => {
      await db.insert(users).values({ id: crypto.randomUUID(), email: "dup@toon.local", name: "B" });
    };
    await expect(duplicate()).rejects.toThrow();
  });

  test("household_modules rejects a duplicate (household_id, module_id)", async () => {
    const userId = crypto.randomUUID();
    const householdId = crypto.randomUUID();
    await db.insert(users).values({ id: userId, email: "mod@toon.local", name: "M" });
    await db.insert(households).values({ id: householdId, name: "Haushalt", createdBy: userId });
    await db.insert(householdModules).values({ householdId, moduleId: "finance" });
    const duplicate = async () => {
      await db.insert(householdModules).values({ householdId, moduleId: "finance" });
    };
    await expect(duplicate()).rejects.toThrow();
  });

  test("legacy_ids rejects a duplicate (table, legacy_source, legacy_id)", async () => {
    const key = { tableName: "households", legacySource: "recipe", legacyId: "g-1" };
    await db.insert(legacyIds).values({ ...key, newId: crypto.randomUUID() });
    const duplicate = async () => {
      await db.insert(legacyIds).values({ ...key, newId: crypto.randomUUID() });
    };
    await expect(duplicate()).rejects.toThrow();
    // Same legacy id from the other source is a different row.
    await db.insert(legacyIds).values({ ...key, legacySource: "finance", newId: "x" });
    expect(await db.select().from(legacyIds)).toHaveLength(2);
  });

  test("legacy_ids keeps D12's column names, `table` included", async () => {
    const result = await client.execute("PRAGMA table_info(legacy_ids)");
    expect(result.rows.map((row) => row.name)).toEqual([
      "table",
      "legacy_source",
      "legacy_id",
      "new_id",
      "created_at",
    ]);
  });
});
