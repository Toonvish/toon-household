/**
 * Migration 0003_placeholder_members (ADR 0006, plan m3b T01 step 2).
 *
 * `users.email` and `household_invites.email` lose their NOT NULL, `household_invites` gains
 * `claims_user_id REFERENCES users(id) ON DELETE cascade` plus its index. libSQL's ALTER COLUMN
 * only rewrites the column definition: no table is rebuilt (a `users` rebuild under the
 * migrator's transaction would cascade-delete every row that references a user).
 *
 * Proven on temp `file:` databases through `@libsql/client` (never `bun:sqlite`, which is a
 * newer SQLite): (a) a fresh database migrated to the head, (b) a database migrated to
 * `0002_finance` first, filled with an account, a household, a membership and a plain invite,
 * then migrated to the head, keeping every row. (c) pins the corrected SQL body (the generator
 * output dropped every index, created the new one before its column and lost the cascade).
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { MIGRATIONS_FOLDER } from "../src/db/migrate.ts";

const dir = mkdtempSync(join(tmpdir(), "toon-placeholder-migration-"));
const clients: Client[] = [];

afterAll(() => {
  for (const client of clients) client.close();
  rmSync(dir, { recursive: true, force: true });
});

interface JournalEntry {
  idx: number;
  tag: string;
}

/** A copy of the migrations folder holding only the first `count` journal entries. */
function truncatedMigrations(count: number): string {
  const folder = join(dir, `migrations-${count}`);
  mkdirSync(join(folder, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
  const entries = journal.entries.slice(0, count);
  for (const entry of entries) copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  return folder;
}

async function openDb(name: string): Promise<Client> {
  const client = createClient({ url: `file:${join(dir, name)}` });
  clients.push(client);
  await client.execute("PRAGMA foreign_keys = ON");
  return client;
}

async function migrateTo(client: Client, folder: string): Promise<void> {
  await migrate(drizzle(client), { migrationsFolder: folder });
}

async function scalar(client: Client, sql: string, args: (string | number | null)[] = []): Promise<unknown> {
  const result = await client.execute({ sql, args });
  return result.rows[0]?.[0];
}

async function notNullOf(client: Client, table: string, column: string): Promise<number> {
  const result = await client.execute(`PRAGMA table_info(${table})`);
  const row = result.rows.find((candidate) => candidate.name === column);
  if (!row) throw new Error(`${table}.${column} missing`);
  return Number(row.notnull);
}

async function insertUser(client: Client, id: string, email: string | null, name: string): Promise<void> {
  await client.execute({
    sql: "INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)",
    args: [id, email, name, email === null ? null : "hash"],
  });
}

/** The checks every head-migrated database must pass, whatever its history. */
async function expectHeadShape(client: Client): Promise<void> {
  expect(await notNullOf(client, "users", "email")).toBe(0);
  expect(await notNullOf(client, "household_invites", "email")).toBe(0);
  expect(await notNullOf(client, "household_invites", "claims_user_id")).toBe(0);

  const fks = (await client.execute("PRAGMA foreign_key_list(household_invites)")).rows;
  const claim = fks.find((row) => row.from === "claims_user_id");
  expect(claim?.table).toBe("users");
  expect(claim?.to).toBe("id");
  expect(claim?.on_delete).toBe("CASCADE");

  const indexes = (await client.execute("PRAGMA index_list(household_invites)")).rows.map((row) => String(row.name));
  expect(indexes).toContain("household_invites_claims_user_id_idx");
  expect(indexes).toContain("household_invites_email_idx");
  const userIndexes = (await client.execute("PRAGMA index_list(users)")).rows;
  expect(userIndexes.find((row) => row.name === "users_email_unique")?.unique).toBe(1);

  // No leftover of a table rebuild.
  expect(await scalar(client, "SELECT count(*) FROM sqlite_master WHERE name LIKE '__new_%'")).toBe(0);
  expect(await scalar(client, "PRAGMA foreign_key_check")).toBeUndefined();
}

/** Two placeholders coexist under the unique index; a claim invite cascades with its placeholder. */
async function expectPlaceholdersAndClaims(client: Client, householdId: string, ownerId: string): Promise<void> {
  await insertUser(client, "placeholder-1", null, "Pia");
  await insertUser(client, "placeholder-2", null, "Paul");
  expect(await scalar(client, "SELECT count(*) FROM users WHERE email IS NULL AND password_hash IS NULL")).toBe(2);

  await client.execute({
    sql: `INSERT INTO household_invites (id, household_id, email, role, token, status, invited_by, expires_at, created_at, claims_user_id)
          VALUES ('claim-1', ?, NULL, 'member', 'claim-token-1', 'pending', ?, 9999999999999, 1, 'placeholder-1')`,
    args: [householdId, ownerId],
  });
  expect(await scalar(client, "SELECT claims_user_id FROM household_invites WHERE id = 'claim-1'")).toBe("placeholder-1");
  expect(await scalar(client, "SELECT email FROM household_invites WHERE id = 'claim-1'")).toBeNull();

  await client.execute("DELETE FROM users WHERE id = 'placeholder-1'");
  expect(await scalar(client, "SELECT count(*) FROM household_invites WHERE id = 'claim-1'")).toBe(0);

  // A second account with an existing address is still refused by the kept unique index.
  await expect(insertUser(client, "dup", "owner@toon.test", "Dup")).rejects.toThrow();
}

describe("migration 0003_placeholder_members", () => {
  test("(a) a fresh database migrated to the head has nullable e-mails and the cascading claim column", async () => {
    const client = await openDb("fresh.db");
    await migrateTo(client, MIGRATIONS_FOLDER);
    await expectHeadShape(client);

    await insertUser(client, "owner", "owner@toon.test", "Owner");
    await client.execute("INSERT INTO households (id, name, created_by, created_at, updated_at) VALUES ('h1', 'Familie', 'owner', 1, 1)");
    await expectPlaceholdersAndClaims(client, "h1", "owner");
  });

  test("(b) a database at 0002_finance keeps every row through 0003 and then accepts placeholders", async () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8")) as {
      entries: JournalEntry[];
    };
    const at0002 = journal.entries.findIndex((entry) => entry.tag === "0002_finance") + 1;
    expect(at0002).toBe(3);

    const client = await openDb("at-0002.db");
    await migrateTo(client, truncatedMigrations(at0002));
    expect(await notNullOf(client, "users", "email")).toBe(1);
    expect(await scalar(client, "SELECT count(*) FROM __drizzle_migrations")).toBe(3);

    await insertUser(client, "owner", "owner@toon.test", "Owner");
    await insertUser(client, "member", "member@toon.test", "Member");
    await client.execute("INSERT INTO households (id, name, created_by, created_at, updated_at) VALUES ('h1', 'Familie', 'owner', 1, 1)");
    await client.execute(
      "INSERT INTO household_members (id, household_id, user_id, role, created_at) VALUES ('m1', 'h1', 'owner', 'owner', 1), ('m2', 'h1', 'member', 'member', 1)",
    );
    await client.execute(
      `INSERT INTO household_invites (id, household_id, email, role, token, status, invited_by, expires_at, created_at)
       VALUES ('inv-1', 'h1', 'guest@toon.test', 'member', 'plain-token-1', 'pending', 'owner', 9999999999999, 1)`,
    );
    await client.execute(
      "INSERT INTO finance_participants (household_id, user_id, member_slot, display_name, joined_at) VALUES ('h1', 'owner', 1, 'Owner', 1), ('h1', 'member', 2, 'Member', 1)",
    );

    await migrateTo(client, MIGRATIONS_FOLDER);
    expect(await scalar(client, "SELECT count(*) FROM __drizzle_migrations")).toBe(journal.entries.length);
    await expectHeadShape(client);

    // Every row survived: no rebuild, no cascade.
    expect(await scalar(client, "SELECT count(*) FROM users")).toBe(2);
    expect(await scalar(client, "SELECT count(*) FROM household_members")).toBe(2);
    expect(await scalar(client, "SELECT count(*) FROM finance_participants")).toBe(2);
    expect(await scalar(client, "SELECT email FROM household_invites WHERE id = 'inv-1'")).toBe("guest@toon.test");
    expect(await scalar(client, "SELECT claims_user_id FROM household_invites WHERE id = 'inv-1'")).toBeNull();

    await expectPlaceholdersAndClaims(client, "h1", "owner");
  });

  test("(c) the SQL body is the corrected generator output: no rebuild, no index churn, the cascade kept", () => {
    const files = readdirSync(MIGRATIONS_FOLDER).filter((name) => name.endsWith(".sql"));
    expect(files).toContain("0003_placeholder_members.sql");
    const sql = readFileSync(join(MIGRATIONS_FOLDER, "0003_placeholder_members.sql"), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((chunk) =>
        chunk
          .split("\n")
          .filter((line) => !line.startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((chunk) => chunk.length > 0);
    expect(statements).toEqual([
      'ALTER TABLE `users` ALTER COLUMN "email" TO "email" text;',
      'ALTER TABLE `household_invites` ALTER COLUMN "email" TO "email" text;',
      "ALTER TABLE `household_invites` ADD `claims_user_id` text REFERENCES users(id) ON DELETE cascade;",
      "CREATE INDEX `household_invites_claims_user_id_idx` ON `household_invites` (`claims_user_id`);",
    ]);
    expect(sql).not.toMatch(/CREATE TABLE|DROP TABLE|__new_|DROP INDEX/);
  });
});
