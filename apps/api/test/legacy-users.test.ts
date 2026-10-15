/**
 * `migrateUsers` (plan m5 M5-T03, decision 9, Table M rows 1-5) against the committed fixtures
 * (`test/fixtures/legacy/`, facts in `facts.ts`), on temp file databases only.
 *
 * THE TRAPS: gina's finance id equals cleo's recipe id (a fresh id via the in-run claimed set,
 * never via a caught PRIMARY KEY error); ben is OAuth-only (finance's hash is not carried); an
 * unconfirmed target account is never matched ("the boolean alone is NOT evidence").
 */
import { afterEach, describe, expect, test } from "bun:test";
import { EXPECTED, FINANCE_USERS, RECIPE_USERS, UPLOADS } from "./fixtures/legacy/facts.ts";
import { exitCodeFor, createReport } from "../scripts/legacy/report.ts";
import { migrateUsers, OAUTH_ONLY_NOTE } from "../scripts/legacy/users.ts";
import { countRows, createLegacyRun, type LegacyRun } from "./support/legacy-harness.ts";

const runs: LegacyRun[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
});

async function run(options: Parameters<typeof createLegacyRun>[0] = {}): Promise<LegacyRun> {
  const created = await createLegacyRun(options);
  runs.push(created);
  return created;
}

async function userByEmail(run: LegacyRun, email: string): Promise<Record<string, unknown> | undefined> {
  const result = await run.target.client.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [email] });
  const row = result.rows[0];
  if (!row) return undefined;
  const out: Record<string, unknown> = {};
  result.columns.forEach((column, index) => {
    out[column] = row[index];
  });
  return out;
}

async function ledgerRows(run: LegacyRun, source: string): Promise<number> {
  const result = await run.target.client.execute({
    sql: `SELECT count(*) AS n FROM legacy_ids WHERE "table" = 'users' AND legacy_source = ?`,
    args: [source],
  });
  return Number(result.rows[0]?.n ?? 0);
}

describe("migrateUsers on the fixtures", () => {
  test("writes 7 users with the counts and collisions of facts.ts", async () => {
    const r = await run();
    await migrateUsers(r.ctx);
    expect(await countRows(r.target.client, "users")).toBe(EXPECTED.users);
    expect(r.ctx.report.users.recipe).toBe(EXPECTED.usersFromRecipe);
    expect(r.ctx.report.users.finance).toBe(EXPECTED.legacyRows.finance.users as number);
    expect(r.ctx.report.users.target).toBe(EXPECTED.users);
    expect(r.ctx.report.users.collisions).toHaveLength(EXPECTED.collisions);
    expect(r.ctx.report.users.collisions.filter((c) => c.passwordFrom === "none").map((c) => c.email)).toEqual([
      RECIPE_USERS.ben.emailNormalized,
    ]);
    // 4 recipe users + 7 finance users = 11 legacy users mapped by 11 ledger rows.
    expect(await ledgerRows(r, "recipe")).toBe(4);
    expect(await ledgerRows(r, "finance")).toBe(7);
    expect(r.ctx.report.errors).toEqual([]);
    expect(r.ctx.report.skipped.filter((s) => s.table === "users")).toEqual([]);
    expect(exitCodeFor(r.ctx.report)).toBe(0);
  });

  test("anna keeps her recipe id and hash; the finance hash is not used; the avatar is the bare path", async () => {
    const r = await run();
    await migrateUsers(r.ctx);
    const anna = await userByEmail(r, "anna@example.test");
    expect(anna?.id).toBe(RECIPE_USERS.anna.id);
    expect(r.ctx.ids.users.recipe.get(RECIPE_USERS.anna.id)).toBe(RECIPE_USERS.anna.id);
    expect(r.ctx.ids.users.finance.get(FINANCE_USERS.anna.id)).toBe(RECIPE_USERS.anna.id);
    expect(await Bun.password.verify("recipe-pass-anna", String(anna?.password_hash))).toBe(true);
    expect(await Bun.password.verify("finance-pass-anna", String(anna?.password_hash))).toBe(false);
    expect(anna?.avatar_url).toBe(`/uploads/${UPLOADS.avatar.name}`);
    expect(Number(anna?.email_verified)).toBe(1);
    expect(anna?.email_verified_at).toBe(1785585600000);
    expect(anna?.locale).toBe("de");
    expect(anna?.active_household_id).toBe("00000002-0000-4000-8000-000000000001");
  });

  test("ben (OAuth-only) keeps password_hash NULL, with the collision note", async () => {
    const r = await run();
    await migrateUsers(r.ctx);
    const ben = await userByEmail(r, "ben@example.test");
    expect(ben?.password_hash).toBeNull();
    const collision = r.ctx.report.users.collisions.find((c) => c.email === "ben@example.test");
    expect(collision).toEqual({
      email: "ben@example.test",
      recipeUserId: RECIPE_USERS.ben.id,
      financeUserId: FINANCE_USERS.ben.id,
      targetUserId: RECIPE_USERS.ben.id,
      passwordFrom: "none",
      note: OAUTH_ONLY_NOTE,
    });
    expect(OAUTH_ONLY_NOTE).toBe("finance password not carried (recipe account is OAuth-only; use password reset)");
  });

  test("a finance-only user is unconfirmed with the finance hash and locale (emil)", async () => {
    const r = await run();
    await migrateUsers(r.ctx);
    const emil = await userByEmail(r, "emil@example.test");
    expect(emil?.id).toBe(FINANCE_USERS.emil.id);
    expect(await Bun.password.verify("finance-pass-emil", String(emil?.password_hash))).toBe(true);
    expect(Number(emil?.email_verified)).toBe(0);
    expect(emil?.email_verified_at).toBeNull();
    expect(emil?.avatar_url).toBeNull();
    expect(emil?.active_household_id).toBeNull();
    expect(emil?.locale).toBe("de");
    expect(emil?.email).toBe("emil@example.test");
    // finance's mixed-case address is lower-cased for the union and the row
    expect(await userByEmail(r, "Anna@Example.test")).toBeUndefined();
  });

  test("cleo stays unverified and keeps her recipe id; gina gets a fresh id with a warning", async () => {
    const r = await run();
    await migrateUsers(r.ctx);
    const cleo = await userByEmail(r, "cleo@example.test");
    expect(cleo?.id).toBe(RECIPE_USERS.cleo.id);
    expect(Number(cleo?.email_verified)).toBe(0);
    expect(cleo?.email_verified_at).toBeNull();
    const gina = await userByEmail(r, "gina@example.test");
    expect(gina?.id).not.toBe(RECIPE_USERS.cleo.id);
    expect(String(gina?.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(r.ctx.ids.users.finance.get(FINANCE_USERS.gina.id)).toBe(String(gina?.id));
    expect(r.ctx.ids.users.recipe.get(RECIPE_USERS.cleo.id)).toBe(RECIPE_USERS.cleo.id);
    expect(r.ctx.report.warnings.some((w) => w.includes("gina@example.test") && w.includes(String(gina?.id)))).toBe(true);
    expect(await Bun.password.verify("finance-pass-gina", String(gina?.password_hash))).toBe(true);
  });

  test("gina is written with a fresh id in the same batch as cleo (default chunk size); no users skip rows", async () => {
    const r = await run();
    await migrateUsers(r.ctx);
    expect(r.ctx.report.skipped.filter((s) => s.table === "users")).toHaveLength(0);
    expect(r.ctx.report.errors).toEqual([]);
    expect(await userByEmail(r, "gina@example.test")).toBeDefined();
    expect(await userByEmail(r, "cleo@example.test")).toBeDefined();
  });

  test("no code path catches a PRIMARY KEY error to pick a new id", async () => {
    const raw = await Bun.file(new URL("../scripts/legacy/users.ts", import.meta.url)).text();
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/PRIMARY KEY/);
    expect(source).not.toMatch(/isUniqueViolation|UNIQUE constraint/);
    expect(source).not.toMatch(/\bcatch\b/);
  });

  test("oauth and token rows are copied with mapped user ids", async () => {
    const r = await run();
    await migrateUsers(r.ctx);
    expect(await countRows(r.target.client, "oauth_accounts")).toBe(EXPECTED.legacyRows.recipe.oauth_accounts as number);
    expect(await countRows(r.target.client, "password_reset_tokens")).toBe(
      EXPECTED.legacyRows.recipe.password_reset_tokens as number,
    );
    expect(await countRows(r.target.client, "email_verification_tokens")).toBe(
      EXPECTED.legacyRows.recipe.email_verification_tokens as number,
    );
    const oauth = await r.target.client.execute("SELECT user_id FROM oauth_accounts");
    expect(oauth.rows[0]?.user_id).toBe(RECIPE_USERS.ben.id);
    const orphans = await r.target.client.execute(
      "SELECT count(*) AS n FROM password_reset_tokens WHERE user_id NOT IN (SELECT id FROM users)",
    );
    expect(Number(orphans.rows[0]?.n)).toBe(0);
  });

  test("notMigrated lists the sessions of both sources and finance's reset tokens", async () => {
    const r = await run();
    await migrateUsers(r.ctx);
    const items = r.ctx.report.notMigrated.map((n) => `${n.table}/${n.source}/${n.rows}`).sort();
    expect(items).toEqual(["password_reset_tokens/finance/1", "sessions/finance/1", "sessions/recipe/1"]);
    expect(await countRows(r.target.client, "sessions")).toBe(0);
  });

  test("the per-source counts add up and the ids maps cover every legacy user", async () => {
    const r = await run();
    await migrateUsers(r.ctx);
    for (const source of ["recipe", "finance"] as const) {
      const count = r.ctx.report.counts.find((c) => c.table === "users" && c.source === source);
      expect(count?.read).toBe(count ? count.written + count.alreadyMigrated + count.skipped : -1);
      expect(r.ctx.ids.users[source].size).toBe(count?.read ?? -1);
    }
  });

  test("a second run writes 0 rows and fills the same maps", async () => {
    const r = await run();
    await migrateUsers(r.ctx);
    const first = {
      recipe: new Map(r.ctx.ids.users.recipe),
      finance: new Map(r.ctx.ids.users.finance),
    };
    const before = {
      users: await countRows(r.target.client, "users"),
      ledger: await countRows(r.target.client, "legacy_ids"),
    };
    r.ctx.ids.users.recipe.clear();
    r.ctx.ids.users.finance.clear();
    r.ctx.report = createReport("dry-run", r.target.url);
    await migrateUsers(r.ctx);
    expect(await countRows(r.target.client, "users")).toBe(before.users);
    expect(await countRows(r.target.client, "legacy_ids")).toBe(before.ledger);
    expect(r.ctx.ids.users.recipe).toEqual(first.recipe);
    expect(r.ctx.ids.users.finance).toEqual(first.finance);
    expect(r.ctx.report.counts.reduce((sum, c) => sum + c.written, 0)).toBe(0);
    expect(r.ctx.report.users.collisions).toHaveLength(EXPECTED.collisions);
    expect(r.ctx.report.errors).toEqual([]);
  });

  test("a small chunk size gives the same result", async () => {
    const r = await run({ chunkSize: 2 });
    await migrateUsers(r.ctx);
    expect(await countRows(r.target.client, "users")).toBe(EXPECTED.users);
    expect(r.ctx.report.errors).toEqual([]);
    expect(await userByEmail(r, "cleo@example.test").then((u) => u?.id)).toBe(RECIPE_USERS.cleo.id);
  });
});

async function preInsert(run: LegacyRun, id: string, email: string, verified: number, verifiedAt: number | null) {
  await run.target.client.execute({
    sql: `INSERT INTO users (id, email, name, email_verified, email_verified_at, password_hash, created_at, updated_at)
          VALUES (?, ?, 'Pre', ?, ?, 'pre-hash', 1, 1)`,
    args: [id, email, verified, verifiedAt],
  });
}

describe("migrateUsers against a target that already has accounts", () => {
  test("a verified pre-inserted anna is matched: both legacy ids map onto it, no anna row is written", async () => {
    const r = await run();
    await preInsert(r, "target-anna", "anna@example.test", 1, 1790000000000);
    await migrateUsers(r.ctx);
    expect(r.ctx.ids.users.recipe.get(RECIPE_USERS.anna.id)).toBe("target-anna");
    expect(r.ctx.ids.users.finance.get(FINANCE_USERS.anna.id)).toBe("target-anna");
    const rows = await r.target.client.execute("SELECT id, password_hash FROM users WHERE email = 'anna@example.test'");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.id).toBe("target-anna");
    expect(rows.rows[0]?.password_hash).toBe("pre-hash");
    expect(await countRows(r.target.client, "users")).toBe(EXPECTED.users);
    expect(r.ctx.report.warnings.some((w) => w.includes("anna@example.test") && w.includes("matched an existing account in the target"))).toBe(true);
    expect(await ledgerRows(r, "recipe")).toBe(4);
    expect(r.ctx.report.errors).toEqual([]);
    // the recipe-side rows that follow anna's id are not blocked
    const anna = r.ctx.report.users.collisions.find((c) => c.email === "anna@example.test");
    expect(anna?.targetUserId).toBe("target-anna");
  });

  test("an unverified pre-inserted dana (boolean 1, timestamp NULL) is NOT matched: error, no row, exit 1", async () => {
    const r = await run();
    await preInsert(r, "target-dana", "dana@example.test", 1, null);
    await migrateUsers(r.ctx);
    const reason = "unverified target account dana@example.test blocks the merge";
    expect(r.ctx.report.errors).toContain(reason);
    expect(exitCodeFor(r.ctx.report)).toBe(1);
    const skipped = r.ctx.report.skipped.filter((s) => s.table === "users");
    expect(skipped.map((s) => `${s.source}/${s.legacyId}`).sort()).toEqual(
      [`finance/${FINANCE_USERS.dana.id}`, `recipe/${RECIPE_USERS.dana.id}`].sort(),
    );
    for (const row of skipped) {
      expect(row.error).toBe(true);
      expect(row.reason).toBe(reason);
    }
    // no dana row besides the pre-inserted one, unchanged, and no ledger entry for her legacy ids
    const rows = await r.target.client.execute("SELECT * FROM users WHERE email = 'dana@example.test'");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.id).toBe("target-dana");
    expect(rows.rows[0]?.email_verified_at).toBeNull();
    expect(rows.rows[0]?.password_hash).toBe("pre-hash");
    const ledger = await r.target.client.execute({
      sql: `SELECT count(*) AS n FROM legacy_ids WHERE legacy_id IN (?, ?)`,
      args: [RECIPE_USERS.dana.id, FINANCE_USERS.dana.id],
    });
    expect(Number(ledger.rows[0]?.n)).toBe(0);
    expect(r.ctx.ids.users.recipe.has(RECIPE_USERS.dana.id)).toBe(false);
    expect(r.ctx.ids.users.finance.has(FINANCE_USERS.dana.id)).toBe(false);
    // everyone else is migrated: 7 users minus dana plus the pre-inserted row
    expect(await countRows(r.target.client, "users")).toBe(EXPECTED.users);
  });

  test("a target user that holds a legacy id with another e-mail forces a fresh id (DB lookup)", async () => {
    const r = await run();
    await preInsert(r, RECIPE_USERS.ben.id, "someone-else@example.test", 1, 1);
    await migrateUsers(r.ctx);
    const ben = await userByEmail(r, "ben@example.test");
    expect(ben?.id).not.toBe(RECIPE_USERS.ben.id);
    expect(r.ctx.ids.users.recipe.get(RECIPE_USERS.ben.id)).toBe(String(ben?.id));
    expect(r.ctx.report.errors).toEqual([]);
    // ben's oauth account follows the map
    const oauth = await r.target.client.execute("SELECT user_id FROM oauth_accounts");
    expect(oauth.rows[0]?.user_id).toBe(String(ben?.id));
  });
});

/** The context of a run that was given `--finance-db` alone (or `--recipe-db` alone). */
function onlyOne(r: LegacyRun, keep: "recipe" | "finance"): LegacyRun["ctx"] {
  const ctx = {
    ...r.ctx,
    ids: { users: { recipe: new Map<string, string>(), finance: new Map<string, string>() }, households: r.ctx.ids.households },
    report: createReport(r.ctx.mode, r.target.url),
  };
  if (keep === "finance") delete ctx.recipe;
  else delete ctx.finance;
  return ctx;
}

function both(r: LegacyRun): LegacyRun["ctx"] {
  return {
    ...r.ctx,
    ids: { users: { recipe: new Map(), finance: new Map() }, households: r.ctx.ids.households },
    report: createReport(r.ctx.mode, r.target.url),
  };
}

describe("migrateUsers on a resumed run that adds the other source", () => {
  test("finance alone, then both: recipe users are NOT attached to the unconfirmed finance accounts", async () => {
    const r = await run();
    const first = onlyOne(r, "finance");
    await migrateUsers(first);
    expect(first.report.errors).toEqual([]);
    const annaBefore = await userByEmail(r, "anna@example.test");
    expect(annaBefore?.id).toBe(FINANCE_USERS.anna.id);
    expect(annaBefore?.email_verified_at).toBeNull();
    const usersBefore = await countRows(r.target.client, "users");

    const second = both(r);
    await migrateUsers(second);

    // anna, ben, dana are in both apps: each is refused with the same reason as a fresh run
    for (const email of ["anna@example.test", "ben@example.test", "dana@example.test"]) {
      expect(second.report.errors).toContain(`unverified target account ${email} blocks the merge`);
    }
    expect(exitCodeFor(second.report)).toBe(1);
    const skipped = second.report.skipped.filter((s) => s.table === "users");
    expect(skipped.every((s) => s.source === "recipe" && s.error === true)).toBe(true);
    expect(skipped.map((s) => s.legacyId)).toContain(RECIPE_USERS.anna.id);
    expect(skipped.map((s) => s.legacyId)).toContain(RECIPE_USERS.ben.id);
    // no recipe ledger entry and no map entry for them; the finance side stays mapped
    expect(second.ids.users.recipe.has(RECIPE_USERS.anna.id)).toBe(false);
    expect(second.ids.users.recipe.has(RECIPE_USERS.ben.id)).toBe(false);
    expect(second.ids.users.finance.get(FINANCE_USERS.anna.id)).toBe(FINANCE_USERS.anna.id);
    // anna's row is untouched: still the finance account, still unconfirmed
    const annaAfter = await userByEmail(r, "anna@example.test");
    expect(annaAfter).toEqual(annaBefore);
    expect(Number(annaAfter?.email_verified)).toBe(0);
    expect(annaAfter?.email_verified_at).toBeNull();
    // ben's Google account is NOT hung off the finance account (its user is unmapped: skipped)
    expect(await countRows(r.target.client, "oauth_accounts")).toBe(
      (EXPECTED.legacyRows.recipe.oauth_accounts as number) - 1,
    );
    expect(second.report.skipped.some((s) => s.table === "oauth_accounts" && s.error === true)).toBe(true);
    const ledger = await r.target.client.execute(
      `SELECT count(*) AS n FROM legacy_ids WHERE "table" = 'users' AND legacy_id IN ('${RECIPE_USERS.anna.id}', '${RECIPE_USERS.ben.id}') AND legacy_source = 'recipe' AND new_id IN ('${FINANCE_USERS.anna.id}', '${FINANCE_USERS.ben.id}')`,
    );
    expect(Number(ledger.rows[0]?.n)).toBe(0);
    // the recipe users with no finance counterpart are still written; nothing else changed
    expect(await countRows(r.target.client, "users")).toBeGreaterThanOrEqual(usersBefore);
  });

  test("finance alone, the operator confirms the account, then both: matched with a warning", async () => {
    const r = await run();
    await migrateUsers(onlyOne(r, "finance"));
    await r.target.client.execute(
      "UPDATE users SET email_verified = 1, email_verified_at = 1790000000000 WHERE email = 'anna@example.test'",
    );
    const second = both(r);
    await migrateUsers(second);
    expect(second.report.errors).not.toContain("unverified target account anna@example.test blocks the merge");
    expect(second.ids.users.recipe.get(RECIPE_USERS.anna.id)).toBe(FINANCE_USERS.anna.id);
    expect(second.report.warnings.some((w) => w.includes("anna@example.test") && w.includes("matched an existing account"))).toBe(true);
  });

  test("recipe alone, then both: the finance users map onto the recipe accounts (the safe order)", async () => {
    const r = await run();
    await migrateUsers(onlyOne(r, "recipe"));
    const annaBefore = await userByEmail(r, "anna@example.test");
    const second = both(r);
    await migrateUsers(second);
    expect(second.report.errors).toEqual([]);
    expect(second.ids.users.finance.get(FINANCE_USERS.anna.id)).toBe(RECIPE_USERS.anna.id);
    expect(second.ids.users.finance.get(FINANCE_USERS.ben.id)).toBe(RECIPE_USERS.ben.id);
    expect(await userByEmail(r, "anna@example.test")).toEqual(annaBefore);
    expect(Number(annaBefore?.email_verified)).toBe(1);
  });
});
