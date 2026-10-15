/**
 * The legacy migration fixtures (M5-T01): the committed databases equal a fresh build, carry the
 * expected counts and the traps the migration has to survive. See
 * `apps/api/test/fixtures/legacy/README.md` and `facts.ts`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildLegacyFixtures,
  compareWithCommitted,
  dumpDatabase,
  firstDumpDifference,
  LEGACY_DIR,
} from "./fixtures/legacy/build.ts";
import {
  COLLISION_USERS,
  EXPECTED,
  FH4_INCOMES,
  FINANCE_HOUSEHOLDS,
  FINANCE_ONLY_USERS,
  FINANCE_USERS,
  GROUPS,
  MISSING_UPLOAD,
  RECIPE_USERS,
  UPLOADS,
} from "./fixtures/legacy/facts.ts";

const recipeDb = join(LEGACY_DIR, "recipe.db");
const financeDb = join(LEGACY_DIR, "finance.db");

let recipe: Client;
let finance: Client;
let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "legacy-fixtures-test-"));
  recipe = createClient({ url: `file:${recipeDb}` });
  finance = createClient({ url: `file:${financeDb}` });
  // Read-only: opening the committed files must never write to them.
  await recipe.execute("PRAGMA query_only = 1");
  await finance.execute("PRAGMA query_only = 1");
});

afterAll(async () => {
  recipe.close();
  finance.close();
  await rm(tmp, { recursive: true, force: true });
});

async function rows(client: Client, sql: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const result = await client.execute({ sql, args });
  return result.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const column of result.columns) out[column] = row[column];
    return out;
  });
}

async function scalar(client: Client, sql: string, args: Array<string | number> = []): Promise<unknown> {
  const result = await client.execute({ sql, args });
  return result.rows[0]?.[0];
}

describe("(a) the committed files equal a fresh build", () => {
  test("databases and uploads match", async () => {
    await buildLegacyFixtures(tmp);
    expect(await compareWithCommitted(tmp, LEGACY_DIR)).toBeNull();
  });

  test("an edited row is reported as the first difference", async () => {
    const fresh = await dumpDatabase(join(tmp, "recipe.db"));
    const edited = fresh.replace("Apfelkuchen", "Apfelstrudel");
    expect(firstDumpDifference(fresh, edited)).toContain("table recipes");
    expect(firstDumpDifference(fresh, fresh)).toBeNull();
  });
});

describe("(b) the migration journals", () => {
  test("toon-recipe: nine migrations, last created_at is the journal's last when", async () => {
    expect(await scalar(recipe, "SELECT count(*) FROM __drizzle_migrations")).toBe(EXPECTED.migrations.recipe.count);
    expect(await scalar(recipe, "SELECT max(created_at) FROM __drizzle_migrations")).toBe(EXPECTED.migrations.recipe.lastWhen);
  });

  test("toon-finance: two migrations, last created_at is the journal's last when", async () => {
    expect(await scalar(finance, "SELECT count(*) FROM __drizzle_migrations")).toBe(EXPECTED.migrations.finance.count);
    expect(await scalar(finance, "SELECT max(created_at) FROM __drizzle_migrations")).toBe(EXPECTED.migrations.finance.lastWhen);
  });
});

describe("(c) row counts", () => {
  test("recipe.db holds EXPECTED.legacyRows.recipe, every table non-empty", async () => {
    const actual: Record<string, number> = {};
    for (const table of Object.keys(EXPECTED.legacyRows.recipe)) {
      actual[table] = Number(await scalar(recipe, `SELECT count(*) FROM \`${table}\``));
    }
    expect(actual).toEqual(EXPECTED.legacyRows.recipe);
    const tables = (await rows(recipe, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'")).map((r) => String(r.name)).sort();
    expect(tables).toEqual(Object.keys(EXPECTED.legacyRows.recipe).sort());
    for (const [table, count] of Object.entries(actual)) expect(count, table).toBeGreaterThan(0);
  });

  test("finance.db holds EXPECTED.legacyRows.finance", async () => {
    const actual: Record<string, number> = {};
    for (const table of Object.keys(EXPECTED.legacyRows.finance)) {
      actual[table] = Number(await scalar(finance, `SELECT count(*) FROM \`${table}\``));
    }
    expect(actual).toEqual(EXPECTED.legacyRows.finance);
    const tables = (await rows(finance, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'")).map((r) => String(r.name)).sort();
    expect(tables).toEqual(Object.keys(EXPECTED.legacyRows.finance).sort());
  });

  test("the user, household, participant and income counts agree with the expected migration result", async () => {
    expect(EXPECTED.legacyRows.recipe.users).toBe(EXPECTED.usersFromRecipe);
    expect(EXPECTED.legacyRows.finance.users).toBe(EXPECTED.collisions + EXPECTED.usersFinanceOnly);
    expect(EXPECTED.users).toBe(EXPECTED.usersFromRecipe + EXPECTED.usersFinanceOnly);
    expect<number>(EXPECTED.collisions).toBe(COLLISION_USERS.length);
    expect<number>(FINANCE_ONLY_USERS.length).toBe(EXPECTED.usersFinanceOnly);
    expect<number>(EXPECTED.financeParticipants).toBe(EXPECTED.legacyRows.finance.household_members!);
    expect<number>(EXPECTED.financeIncomes).toBe(EXPECTED.legacyRows.finance.incomes!);
    expect(EXPECTED.households).toBe(EXPECTED.legacyRows.recipe.groups! + 2);
    expect(EXPECTED.householdModules).toBe(EXPECTED.householdModulesRecipe + EXPECTED.householdModulesFinance);
  });

  test("per finance household: transactions, sum of cents and categories", async () => {
    for (const [key, expected] of Object.entries(EXPECTED.financeLedgers)) {
      const id = FINANCE_HOUSEHOLDS[key as keyof typeof FINANCE_HOUSEHOLDS].id;
      expect(Number(await scalar(finance, "SELECT count(*) FROM transactions WHERE household_id = ?", [id])), `${key} transactions`).toBe(expected.transactions);
      expect(Number(await scalar(finance, "SELECT coalesce(sum(amount_cents), 0) FROM transactions WHERE household_id = ?", [id])), `${key} sum`).toBe(expected.sumCents);
      expect(Number(await scalar(finance, "SELECT count(*) FROM categories WHERE household_id = ?", [id])), `${key} categories`).toBe(expected.categories);
    }
  });

  test("every foreign key holds in both databases", async () => {
    expect(await rows(recipe, "PRAGMA foreign_key_check")).toEqual([]);
    expect(await rows(finance, "PRAGMA foreign_key_check")).toEqual([]);
  });
});

describe("the cases of Table F", () => {
  test("recipe users: password, OAuth-only, unverified, null locale, signed avatar", async () => {
    const byEmail = new Map((await rows(recipe, "SELECT * FROM users")).map((r) => [String(r.email), r]));
    const anna = byEmail.get(RECIPE_USERS.anna.email)!;
    expect(anna.password_hash).toBe(RECIPE_USERS.anna.hash);
    expect(anna.email_verified).toBe(1);
    expect(anna.locale).toBe("de");
    expect(anna.active_group_id).toBe(GROUPS.G1.id);
    expect(String(anna.avatar_url)).toStartWith(`/uploads/${UPLOADS.avatar.name}?exp=`);
    expect(String(anna.avatar_url)).toContain("&sig=");

    const ben = byEmail.get(RECIPE_USERS.ben.email)!;
    expect(ben.password_hash).toBeNull();
    expect(Number(await scalar(recipe, "SELECT count(*) FROM oauth_accounts WHERE user_id = ? AND provider = 'google'", [RECIPE_USERS.ben.id]))).toBe(1);

    const cleo = byEmail.get(RECIPE_USERS.cleo.email)!;
    expect(cleo.email_verified).toBe(0);
    expect(cleo.email_verified_at).toBeNull();

    expect(byEmail.get(RECIPE_USERS.dana.email)!.locale).toBeNull();
  });

  test("recipe groups: members, recipe counts, images", async () => {
    const members = async (groupId: string): Promise<string[]> =>
      (await rows(recipe, "SELECT u.email AS email, m.role AS role FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.email", [groupId])).map((r) => `${r.email}:${r.role}`);
    expect(await members(GROUPS.G1.id)).toEqual(["anna@example.test:owner", "ben@example.test:admin", "cleo@example.test:member"]);
    expect(await members(GROUPS.G2.id)).toEqual(["anna@example.test:owner", "ben@example.test:member", "dana@example.test:member"]);
    expect(await members(GROUPS.G3.id)).toEqual(["cleo@example.test:owner", "dana@example.test:member"]);
    for (const group of Object.values(GROUPS)) {
      expect(Number(await scalar(recipe, "SELECT count(*) FROM recipes WHERE group_id = ?", [group.id])), group.name).toBe(group.recipes);
    }
    expect(await scalar(recipe, "SELECT image_url FROM groups WHERE id = ?", [GROUPS.G1.id])).toBe(`/uploads/${UPLOADS.group.name}`);
  });

  test("recipe images, folds, tag kinds, import draft and cook log", async () => {
    const urls = (await rows(recipe, "SELECT image_url FROM recipes WHERE image_url IS NOT NULL ORDER BY title")).map((r) => String(r.image_url));
    expect(urls).toContain(`/uploads/${UPLOADS.hero.name}`);
    expect(urls).toContain("https://example.test/bild.jpg");
    expect(urls).toContain(`/uploads/${MISSING_UPLOAD}`);
    expect((await readdir(join(LEGACY_DIR, "uploads"))).includes(MISSING_UPLOAD)).toBe(false);
    expect(await scalar(recipe, "SELECT name_fold FROM recipe_ingredients WHERE name = 'Äpfel'")).toBe("apfel");
    expect(Number(await scalar(recipe, "SELECT count(DISTINCT kind) FROM tags"))).toBe(2);
    const draft = (await rows(recipe, "SELECT parsed, source_meta FROM import_drafts"))[0]!;
    expect(JSON.parse(String(draft.source_meta)).storedPath).toBe(UPLOADS.scan.name);
    expect(JSON.parse(String(draft.parsed)).imageUrl).toBe(`/uploads/${UPLOADS.hero.name}`);
    expect(Number(await scalar(recipe, "SELECT count(*) FROM recipe_cook_log WHERE meal_plan_entry_id IS NOT NULL"))).toBe(1);
    expect(Number(await scalar(recipe, "SELECT count(*) FROM shopping_bought_items WHERE bought_by IS NULL"))).toBe(1);
  });

  test("the argon2id hashes verify against the plain passwords in facts.ts", async () => {
    const users = [...Object.values(RECIPE_USERS), ...Object.values(FINANCE_USERS)];
    for (const user of users) {
      if (user.password === null) {
        expect(user.hash).toBeNull();
        continue;
      }
      expect(user.hash).toStartWith("$argon2id$");
      expect(await Bun.password.verify(user.password, user.hash!), user.email).toBe(true);
    }
    const stored = await rows(finance, "SELECT email_normalized, password_hash FROM users");
    for (const row of stored) {
      const user = Object.values(FINANCE_USERS).find((u) => u.emailNormalized === row.email_normalized)!;
      expect(row.password_hash).toBe(user.hash);
    }
    // finance's anna differs from recipe's anna: proves which hash the merged account keeps.
    expect(FINANCE_USERS.anna.hash).not.toBe(RECIPE_USERS.anna.hash);
  });

  test("finance users: Anna@Example.test is stored typed and normalised", async () => {
    const anna = (await rows(finance, "SELECT email, email_normalized FROM users WHERE email_normalized = 'anna@example.test'"))[0]!;
    expect(anna.email).toBe("Anna@Example.test");
    expect(anna.email_normalized).toBe("anna@example.test");
  });

  test("FH1 ledger: refund, odd amounts, every split mode and origin, tags, claims", async () => {
    const id = FINANCE_HOUSEHOLDS.FH1.id;
    const amounts = (await rows(finance, "SELECT amount_cents FROM transactions WHERE household_id = ?", [id])).map((r) => Number(r.amount_cents));
    expect(amounts).toContain(-101);
    expect(amounts.some((a) => Math.abs(a) % 2 === 1 && a !== -101)).toBe(true);
    expect(amounts.length).toBeGreaterThanOrEqual(12);
    const modes = new Set((await rows(finance, "SELECT DISTINCT split_mode FROM transactions WHERE household_id = ?", [id])).map((r) => r.split_mode));
    expect([...modes].sort()).toEqual(["OTHER_ONLY", "SETTLEMENT", "SPLIT_EQUAL"]);
    expect(Number(await scalar(finance, "SELECT count(*) FROM transactions WHERE household_id = ? AND origin = 'fixed_plan' AND plan_period IS NOT NULL", [id]))).toBe(2);
    expect(Number(await scalar(finance, "SELECT count(*) FROM transactions WHERE household_id = ? AND origin = 'import' AND import_seq IS NOT NULL AND external_key IS NOT NULL", [id]))).toBe(2);
    expect(Number(await scalar(finance, "SELECT count(*) FROM transaction_tags tt JOIN tags t ON t.id = tt.tag_id WHERE t.name_key = 'sammelbuchung'"))).toBe(1);
    expect(Number(await scalar(finance, "SELECT count(*) FROM categories WHERE household_id = ? AND is_system = 1", [id]))).toBe(1);
    expect(Number(await scalar(finance, "SELECT count(*) FROM categories WHERE household_id = ? AND custom_label IS NOT NULL", [id]))).toBe(2);
    expect(Number(await scalar(finance, "SELECT count(*) FROM categories WHERE household_id = ? AND is_hidden = 1", [id]))).toBe(1);
    expect(Number(await scalar(finance, "SELECT count(*) FROM mutation_claims WHERE household_id = ? AND transaction_id IS NOT NULL", [id]))).toBe(1);
    const plan = (await rows(finance, "SELECT enabled, last_booked_period FROM fixed_cost_plans WHERE household_id = ?", [id]))[0]!;
    expect(plan.enabled).toBe(1);
    expect(plan.last_booked_period).toBe("2026-08");
  });

  test("FH3 has an OTHER_ONLY booking by fritz; FH2 has at least five and FH3 four bookings", async () => {
    expect(Number(await scalar(finance, "SELECT count(*) FROM transactions WHERE household_id = ? AND payer_id = ? AND split_mode = 'OTHER_ONLY'", [FINANCE_HOUSEHOLDS.FH3.id, FINANCE_USERS.fritz.id]))).toBe(1);
    expect(EXPECTED.financeLedgers.FH2!.transactions).toBeGreaterThanOrEqual(5);
    expect(EXPECTED.financeLedgers.FH3!.transactions).toBeGreaterThanOrEqual(4);
  });

  test("the not-migrated rows exist: one session, one invite, one reset token", async () => {
    expect(Number(await scalar(finance, "SELECT count(*) FROM sessions"))).toBe(1);
    expect(Number(await scalar(finance, "SELECT count(*) FROM invites"))).toBe(1);
    expect(Number(await scalar(finance, "SELECT count(*) FROM password_reset_tokens"))).toBe(1);
  });
});

describe("(d) the traps", () => {
  test("gina's finance id equals cleo's recipe id", async () => {
    expect(FINANCE_USERS.gina.id).toBe(RECIPE_USERS.cleo.id);
    expect(await scalar(finance, "SELECT id FROM users WHERE email_normalized = 'gina@example.test'")).toBe(
      await scalar(recipe, "SELECT id FROM users WHERE email = 'cleo@example.test'"),
    );
    // ... and cleo's finance id is a different one (collision by e-mail, not by id).
    expect(FINANCE_USERS.cleo.id).not.toBe(RECIPE_USERS.cleo.id);
  });

  test("FH3's id equals G2's id", async () => {
    expect(FINANCE_HOUSEHOLDS.FH3.id).toBe(GROUPS.G2.id);
    expect(await scalar(finance, "SELECT id FROM households WHERE name = 'Emil & Fritz'")).toBe(
      await scalar(recipe, "SELECT id FROM groups WHERE name = 'Freundeskreis'"),
    );
  });

  test("FH4: one member in slot 2; creator and plan payer are fritz, who is not a member", async () => {
    const id = FINANCE_HOUSEHOLDS.FH4.id;
    const members = await rows(finance, "SELECT user_id, member_slot FROM household_members WHERE household_id = ?", [id]);
    expect(members).toEqual([{ user_id: FINANCE_USERS.gina.id, member_slot: 2 }]);
    expect(await scalar(finance, "SELECT created_by FROM households WHERE id = ?", [id])).toBe(FINANCE_USERS.fritz.id);
    expect(Number(await scalar(finance, "SELECT count(*) FROM household_members WHERE household_id = ? AND user_id = ?", [id, FINANCE_USERS.fritz.id]))).toBe(0);
    expect(await scalar(finance, "SELECT payer_id FROM fixed_cost_plans WHERE household_id = ?", [id])).toBe(FINANCE_USERS.fritz.id);
    expect(Number(await scalar(finance, "SELECT enabled FROM fixed_cost_plans WHERE household_id = ?", [id]))).toBe(0);
    // fritz never paid anything in FH4 (F's removeMember lets a member who never paid leave).
    expect(Number(await scalar(finance, "SELECT count(*) FROM transactions WHERE household_id = ? AND payer_id = ?", [id, FINANCE_USERS.fritz.id]))).toBe(0);
    expect(Number(await scalar(finance, "SELECT count(*) FROM transactions WHERE household_id = ? AND payer_id = ?", [id, FINANCE_USERS.gina.id]))).toBe(2);
  });

  test("FH4 has exactly one income naming fritz and one naming gina", async () => {
    const id = FINANCE_HOUSEHOLDS.FH4.id;
    expect(Number(await scalar(finance, "SELECT count(*) FROM incomes WHERE household_id = ?", [id]))).toBe(FH4_INCOMES.length);
    expect(Number(await scalar(finance, "SELECT count(*) FROM incomes WHERE household_id = ? AND person_id = ?", [id, FINANCE_USERS.fritz.id]))).toBe(1);
    expect(Number(await scalar(finance, "SELECT count(*) FROM incomes WHERE household_id = ? AND person_id = ?", [id, FINANCE_USERS.gina.id]))).toBe(1);
  });

  test("FH5 has no members, no transactions and a plan row", async () => {
    const id = FINANCE_HOUSEHOLDS.FH5.id;
    expect(Number(await scalar(finance, "SELECT count(*) FROM household_members WHERE household_id = ?", [id]))).toBe(0);
    expect(Number(await scalar(finance, "SELECT count(*) FROM transactions WHERE household_id = ?", [id]))).toBe(0);
    expect(Number(await scalar(finance, "SELECT count(*) FROM fixed_cost_plans WHERE household_id = ?", [id]))).toBe(1);
  });

  test("candidate groups per finance household match the expected decisions", async () => {
    const groupsOf = async (userIds: string[]): Promise<string[]> => {
      const out: string[] = [];
      for (const group of Object.values(GROUPS)) {
        const present = await Promise.all(
          userIds.map(async (financeId) => {
            const email = String(await scalar(finance, "SELECT email_normalized FROM users WHERE id = ?", [financeId]));
            return Number(await scalar(recipe, "SELECT count(*) FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? AND u.email = ?", [group.id, email])) === 1;
          }),
        );
        if (present.every(Boolean)) out.push(group.name);
      }
      return out;
    };
    expect(await groupsOf([FINANCE_USERS.anna.id, FINANCE_USERS.ben.id])).toEqual([GROUPS.G1.name, GROUPS.G2.name]);
    expect(await groupsOf([FINANCE_USERS.cleo.id, FINANCE_USERS.dana.id])).toEqual([GROUPS.G3.name]);
    expect(await groupsOf([FINANCE_USERS.emil.id, FINANCE_USERS.fritz.id])).toEqual([]);
    expect(await groupsOf([FINANCE_USERS.gina.id])).toEqual([]);
    expect(FINANCE_HOUSEHOLDS.FH1.decision).toEqual({ action: "merge", reason: "most-recipes", group: "G1" });
    expect(FINANCE_HOUSEHOLDS.FH2.decision).toEqual({ action: "merge", reason: "only-group", group: "G3" });
    expect(FINANCE_HOUSEHOLDS.FH5.decision).toEqual({ action: "skip", reason: "no-members" });
  });
});

describe("(e) journal mode and size", () => {
  test("both databases are in rollback-journal mode and no -wal / -shm / -journal file sits beside them", async () => {
    expect(String(await scalar(recipe, "PRAGMA journal_mode")).toLowerCase()).toBe("delete");
    expect(String(await scalar(finance, "PRAGMA journal_mode")).toLowerCase()).toBe("delete");
    const names = await readdir(LEGACY_DIR);
    expect(names.filter((n) => /-(wal|shm|journal)$/.test(n))).toEqual([]);
  });

  test("the uploads directory holds exactly the files of facts.ts, with the declared sizes", async () => {
    const expected = Object.values(UPLOADS).map((u) => u.name).sort();
    expect((await readdir(join(LEGACY_DIR, "uploads"))).sort()).toEqual(expected);
    for (const upload of Object.values(UPLOADS)) {
      expect((await stat(join(LEGACY_DIR, "uploads", upload.name))).size, upload.name).toBe(upload.size);
    }
    expect(new Set(Object.values(UPLOADS).map((u) => u.size)).size).toBe(Object.values(UPLOADS).length);
  });

  test("the fixture directory stays under 1 MB", async () => {
    let total = 0;
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else total += (await stat(path)).size;
      }
    };
    await walk(LEGACY_DIR);
    expect(total).toBeLessThan(1024 * 1024);
  });
});
