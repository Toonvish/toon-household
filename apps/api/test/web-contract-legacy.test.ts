/**
 * The web contract over data this app never wrote (docs/plans/e6-web-client.md P7b, P7c, task E6-T02b).
 *
 * `web-contract-core-recipe.test.ts` and `web-contract-finance.test.ts` prove the oracle on data the
 * app produced itself: the web clients decode every JSON response with the shared `...ResponseSchema`
 * and `{ disableChecks: true }`, and that decode must be the IDENTITY on the wire (it succeeds and
 * nothing is stripped, defaulted or transformed). Production, however, also holds rows migrated from
 * the two archived apps (ADR 0005 ledger states, ADR 0006 placeholders, names stored before the
 * `1715207` hardening). This file runs the same oracle over those.
 *
 * Part 1 (always runs unless the snapshot variable is set): the committed legacy fixtures
 * (`test/fixtures/legacy/`, recipe AND finance, with uploads) are applied through `runLegacyMigration`
 * into the SHARED test DB, the way `legacy-placeholders.test.ts` does it (precondition: no fixture
 * e-mail exists; the row counts are recorded and asserted back in `afterAll`, which deletes
 * everything the run wrote, households first). Every migrated account that has a password logs in
 * through `POST /api/auth/login` (an unconfirmed finance-only account can read: the verified-e-mail
 * gate is forced ON for the file), and every READ route of the three web clients is decoded over
 * every household that account belongs to.
 *
 * Part 2 (the snapshot sweep, P7b; `docs/open-work.md` lists the owner action): runs only when
 * `WEB_CONTRACT_SNAPSHOT=1`, against the DB of `TEST_DATABASE_URL` (the owner's local COPY of a
 * production snapshot, outside the repo; it WRITES minted sessions into that copy and removes them
 * again). For every household it mints a session for one real member through the core `Sessions`
 * service, runs the same read sweep and prints COUNTS ONLY: one `<schema>: <n> ok, <m> failed` line
 * per schema and the issue PATHS of each failure, never a value, a name or an e-mail. It fails when
 * any decode failed. Part 1 is skipped when the variable is set (a production copy must not receive
 * the fixtures).
 *
 *   NODE_ENV=test TEST_DATABASE_URL=file:/path/to/copy.db WEB_CONTRACT_SNAPSHOT=1 \
 *     bun test apps/api/test/web-contract-legacy.test.ts
 *
 * A finding (a decode failure or a non-identity) is fixed in the shared schema files, with
 * `packages/shared/test` green, or becomes a one-line `lenient: { schema: "X", reason }` row of
 * `LENIENT` below (P7c: E6-T09 applies it to the three clients).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result, Schema, type SchemaIssue } from "effect";
import {
  AccrualRunListResponseSchema,
  BalanceHistoryResponseSchema,
  BalanceResponseSchema,
  CardListResponseSchema,
  CategoryListResponseSchema,
  CollectionDetailResponseSchema,
  CollectionListResponseSchema,
  FinanceParticipantListResponseSchema,
  FinanceTagListResponseSchema,
  HealthResponseSchema,
  HouseholdDetailResponseSchema,
  HouseholdInviteListResponseSchema,
  HouseholdListResponseSchema,
  HouseholdMemberListResponseSchema,
  ImportDraftListResponseSchema,
  ImportDraftResponseSchema,
  LastPlannedResponseSchema,
  MealPlanRangeResponseSchema,
  MeResponseSchema,
  OAuthProvidersResponseSchema,
  PlanComputationResponseSchema,
  PlanResponseSchema,
  PlanShoppingPreviewResponseSchema,
  RecipeListResponseSchema,
  RecipeResponseSchema,
  ScaledRecipeResponseSchema,
  SessionListResponseSchema,
  ShoppingBoughtListResponseSchema,
  ShoppingCatalogListResponseSchema,
  ShoppingListDetailResponseSchema,
  ShoppingListListResponseSchema,
  TagListResponseSchema,
  TransactionListResponseSchema,
  TransactionResponseSchema,
  TransactionSummaryResponseSchema,
} from "@toon/shared";
import { Sessions } from "../src/core/services/auth/sessions.ts";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { client as sharedClient, db as sharedDb } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { app } from "../src/index.ts";
import { exitCodeFor } from "../scripts/legacy/report.ts";
import { runLegacyMigration } from "../scripts/legacy/run.ts";
import { openLegacy } from "../scripts/legacy/sources.ts";
import type { LegacyDb, Report } from "../scripts/legacy/types.ts";
import { FINANCE_HOUSEHOLDS, FINANCE_USERS, GROUPS, RECIPE_USERS } from "./fixtures/legacy/facts.ts";
import { countRows, FIXTURE_DIR } from "./support/legacy-harness.ts";
import { runTest } from "./support/effect.ts";

const SNAPSHOT = process.env.WEB_CONTRACT_SNAPSHOT === "1";
const DECODE_OPTIONS = { disableChecks: true } as const;
const ORIGIN = "https://toon.example";

/**
 * P7c: schemas the oracle cannot satisfy over legacy data without breaking `packages/shared/test`,
 * ON ONE LINE each (a grep reads them): `lenient: { schema: "X", reason: "..." }`. The sweep still
 * asserts that the body is a JSON object for them. Empty: every schema below met the oracle.
 */
const LENIENT: ReadonlyArray<{ schema: string; reason: string }> = [];

/** The schemas the three web clients decode a READ route with, by the name printed in the summary. */
const SCHEMAS = {
  HealthResponseSchema,
  MeResponseSchema,
  SessionListResponseSchema,
  OAuthProvidersResponseSchema,
  HouseholdListResponseSchema,
  HouseholdDetailResponseSchema,
  HouseholdMemberListResponseSchema,
  HouseholdInviteListResponseSchema,
  RecipeListResponseSchema,
  RecipeResponseSchema,
  ScaledRecipeResponseSchema,
  TagListResponseSchema,
  CollectionListResponseSchema,
  CollectionDetailResponseSchema,
  MealPlanRangeResponseSchema,
  LastPlannedResponseSchema,
  ShoppingListListResponseSchema,
  ShoppingListDetailResponseSchema,
  ShoppingCatalogListResponseSchema,
  ShoppingBoughtListResponseSchema,
  PlanShoppingPreviewResponseSchema,
  ImportDraftListResponseSchema,
  ImportDraftResponseSchema,
  CardListResponseSchema,
  FinanceParticipantListResponseSchema,
  TransactionListResponseSchema,
  TransactionResponseSchema,
  TransactionSummaryResponseSchema,
  CategoryListResponseSchema,
  FinanceTagListResponseSchema,
  PlanResponseSchema,
  PlanComputationResponseSchema,
  AccrualRunListResponseSchema,
  BalanceResponseSchema,
  BalanceHistoryResponseSchema,
} as const;
type SchemaName = keyof typeof SCHEMAS;

/* -------------------------------------------------------------------------- */
/* the oracle, reporting PATHS only                                           */
/* -------------------------------------------------------------------------- */

function segment(key: PropertyKey): string {
  return typeof key === "number" ? "[]" : `.${String(key)}`;
}

/** The paths (and issue kinds) of a failed decode; never a value. */
function issuePaths(issue: SchemaIssue.Issue, prefix: string, out: Set<string>): void {
  switch (issue._tag) {
    case "Pointer":
      issuePaths(issue.issue, prefix + issue.path.map(segment).join(""), out);
      return;
    case "Composite":
    case "AnyOf":
      if (issue.issues.length === 0) out.add(`${prefix || "(root)"} (${issue._tag})`);
      for (const child of issue.issues) issuePaths(child, prefix, out);
      return;
    case "Filter":
    case "Encoding":
      issuePaths(issue.issue, prefix, out);
      return;
    default:
      out.add(`${prefix || "(root)"} (${issue._tag})`);
  }
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Where `actual` (the decoded value) differs from `expected` (the body): stripped, added, changed. */
function diffPaths(expected: unknown, actual: unknown, prefix: string, out: Set<string>): void {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) out.add(`${prefix || "(root)"} (length)`);
    for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) {
      diffPaths(expected[index], actual[index], `${prefix}[]`, out);
    }
    return;
  }
  if (isPlain(expected) && isPlain(actual)) {
    for (const key of Object.keys(expected)) {
      if (!(key in actual)) out.add(`${prefix}.${key} (stripped)`);
      else diffPaths(expected[key], actual[key], `${prefix}.${key}`, out);
    }
    for (const key of Object.keys(actual)) if (!(key in expected)) out.add(`${prefix}.${key} (added)`);
    return;
  }
  if (!Object.is(expected, actual)) out.add(`${prefix || "(root)"} (changed)`);
}

/** Empty when `Schema.decodeUnknownSync(schema, { disableChecks: true })(body)` succeeds and `toEqual`s the body. */
function oracle(schema: Schema.Top, body: unknown): string[] {
  const decoder = schema as unknown as Schema.ConstraintDecoder<unknown>;
  const result = Schema.decodeUnknownResult(decoder, DECODE_OPTIONS)(body);
  const out = new Set<string>();
  if (Result.isFailure(result)) {
    // collect every issue for the report, not just the first
    const all = Schema.decodeUnknownResult(decoder, { ...DECODE_OPTIONS, errors: "all" })(body);
    issuePaths((Result.isFailure(all) ? all.failure : result.failure).issue, "", out);
    return [...out].map((path) => `decode: ${path}`);
  }
  diffPaths(body, result.success, "", out);
  return [...out].map((path) => `identity: ${path}`);
}

describe("the oracle reports paths, never values", () => {
  const Probe = Schema.Struct({
    id: Schema.String,
    count: Schema.Number,
    items: Schema.Array(Schema.Struct({ name: Schema.String })),
    note: Schema.optional(Schema.NullOr(Schema.String)),
  });

  test("an exact body passes", () => {
    expect(oracle(Probe, { id: "secret", count: 1, items: [{ name: "x" }], note: null })).toEqual([]);
  });

  test("a wrong type is a decode path", () => {
    const issues = oracle(Probe, { id: "secret", count: "not-a-number", items: [{ name: 5 }] });
    expect(issues).toContain("decode: .count (InvalidType)");
    expect(issues).toContain("decode: .items[].name (InvalidType)");
    expect(issues.join("\n")).not.toContain("secret");
  });

  test("a key the schema does not declare is stripped, a missing key is a decode failure", () => {
    expect(oracle(Probe, { id: "a", count: 1, items: [], extra: "secret" })).toEqual(["identity: .extra (stripped)"]);
    expect(oracle(Probe, { id: "a", items: [] })).toEqual(["decode: .count (MissingKey)"]);
  });
});

/* -------------------------------------------------------------------------- */
/* the sweep                                                                  */
/* -------------------------------------------------------------------------- */

interface Tally {
  ok: number;
  failed: number;
  paths: Map<string, number>;
}

interface Visited {
  role: string;
  members?: any;
  participants?: any;
  plan?: any;
}

class Sweep {
  readonly tallies = new Map<SchemaName, Tally>();
  readonly visited = new Map<string, Visited>();
  requests = 0;

  constructor(
    readonly detailCap: number,
    readonly maxPages: number,
  ) {}

  tally(name: SchemaName): Tally {
    let tally = this.tallies.get(name);
    if (tally === undefined) {
      tally = { ok: 0, failed: 0, paths: new Map() };
      this.tallies.set(name, tally);
    }
    return tally;
  }

  fail(name: SchemaName, label: string, paths: string[]): void {
    const tally = this.tally(name);
    tally.failed += 1;
    for (const path of paths) {
      const key = `${label}: ${path}`;
      tally.paths.set(key, (tally.paths.get(key) ?? 0) + 1);
    }
  }

  /** `schema: n ok, m failed` lines, then every failing `<route>: <path>` with its count; no values. */
  lines(): string[] {
    const out: string[] = [];
    for (const name of Object.keys(SCHEMAS) as SchemaName[]) {
      const tally = this.tallies.get(name) ?? { ok: 0, failed: 0, paths: new Map() };
      out.push(`${name}: ${tally.ok} ok, ${tally.failed} failed`);
      for (const [path, count] of tally.paths) out.push(`  ${path} (x${count})`);
    }
    return out;
  }

  get failures(): number {
    let total = 0;
    for (const tally of this.tallies.values()) total += tally.failed;
    return total;
  }
}

/** GET `path` as `cookie`, decode with the oracle and tally it under `name`; returns the body, or undefined. */
async function read(
  sweep: Sweep,
  cookie: string,
  label: string,
  name: SchemaName,
  path: string,
  options: { allow?: number[] } = {},
): Promise<any> {
  const response = await app.request(path, { headers: cookie ? { Cookie: cookie } : {} });
  sweep.requests += 1;
  if (response.status !== 200) {
    await response.text();
    if (options.allow?.includes(response.status)) return undefined;
    sweep.fail(name, label, [`status ${response.status}`]);
    return undefined;
  }
  const body = await response.json();
  if (LENIENT.some((row) => row.schema === name)) {
    if (typeof body === "object" && body !== null) sweep.tally(name).ok += 1;
    else sweep.fail(name, label, ["(root) (not an object)"]);
    return body;
  }
  const issues = oracle(SCHEMAS[name], body);
  if (issues.length === 0) sweep.tally(name).ok += 1;
  else sweep.fail(name, label, issues);
  return body;
}

/** Every page of a `{ items, total }` list, decoded page by page; the merged items. */
async function readAll(
  sweep: Sweep,
  cookie: string,
  label: string,
  name: SchemaName,
  path: string,
  limit: number,
): Promise<any[]> {
  const items: any[] = [];
  const joiner = path.includes("?") ? "&" : "?";
  for (let page = 0; page < sweep.maxPages; page += 1) {
    const body = await read(sweep, cookie, label, name, `${path}${joiner}limit=${limit}&offset=${page * limit}`);
    if (body === undefined || !Array.isArray(body.items)) break;
    items.push(...body.items);
    // an envelope without `total` (the shopping lists) is not paged: one read is the whole list
    if (body.items.length === 0 || typeof body.total !== "number" || items.length >= body.total) break;
  }
  return items;
}

/* ------------------------------ dates ----------------------------------- */

function addDays(day: string, days: number): string {
  const at = Date.parse(`${day}T00:00:00Z`) + days * 86_400_000;
  return new Date(at).toISOString().slice(0, 10);
}

/** Ranges (each under the 62-day cap) that cover every planned day of the household; at least one. */
async function planRanges(householdId: string): Promise<{ from: string; to: string }[]> {
  const result = await sharedClient.execute({
    sql: "SELECT min(planned_on) AS a, max(planned_on) AS b FROM recipe_meal_plan_entries WHERE household_id = ?",
    args: [householdId],
  });
  const first = result.rows[0];
  const a = first?.a === null || first?.a === undefined ? "2026-01-05" : String(first.a);
  const b = first?.b === null || first?.b === undefined ? addDays(a, 6) : String(first.b);
  const ranges: { from: string; to: string }[] = [];
  for (let from = a; from <= b && ranges.length < 30; from = addDays(from, 61)) {
    ranges.push({ from, to: addDays(from, 60) });
  }
  return ranges;
}

/* ------------------------------ the routes ------------------------------ */

async function sweepRecipe(sweep: Sweep, cookie: string, householdId: string): Promise<void> {
  const base = `/api/households/${householdId}/recipe`;
  const recipes = await readAll(sweep, cookie, "GET recipes", "RecipeListResponseSchema", `${base}/recipes`, 100);
  for (const recipe of recipes.slice(0, sweep.detailCap)) {
    const detail = await read(sweep, cookie, "GET recipes/:id", "RecipeResponseSchema", `${base}/recipes/${recipe.id}`);
    // a recipe without servings cannot be scaled (422 server.recipes.noServingsToScale): the web never asks
    if (typeof detail?.recipe?.servingsAmount === "number" && detail.recipe.servingsAmount > 0) {
      await read(sweep, cookie, "GET recipes/:id/scale", "ScaledRecipeResponseSchema", `${base}/recipes/${recipe.id}/scale?servings=${detail.recipe.servingsAmount}`);
    }
  }
  await read(sweep, cookie, "GET tags", "TagListResponseSchema", `${base}/tags`);
  const collections = await read(sweep, cookie, "GET collections", "CollectionListResponseSchema", `${base}/collections`);
  for (const collection of (collections?.items ?? []).slice(0, sweep.detailCap)) {
    await read(sweep, cookie, "GET collections/:id", "CollectionDetailResponseSchema", `${base}/collections/${collection.id}`);
  }
  const ranges = await planRanges(householdId);
  for (const range of ranges) {
    await read(sweep, cookie, "GET plan", "MealPlanRangeResponseSchema", `${base}/plan?from=${range.from}&to=${range.to}`);
  }
  await read(sweep, cookie, "GET plan/last-planned", "LastPlannedResponseSchema", `${base}/plan/last-planned?before=2100-01-01`);

  const lists = await readAll(sweep, cookie, "GET shopping-lists", "ShoppingListListResponseSchema", `${base}/shopping-lists`, 100);
  await readAll(sweep, cookie, "GET shopping-lists/bought", "ShoppingBoughtListResponseSchema", `${base}/shopping-lists/bought`, 100);
  for (const list of lists.slice(0, sweep.detailCap)) {
    const listBase = `${base}/shopping-lists/${list.id}`;
    await read(sweep, cookie, "GET shopping-lists/:id", "ShoppingListDetailResponseSchema", listBase);
    await readAll(sweep, cookie, "GET shopping-lists/:id/catalog", "ShoppingCatalogListResponseSchema", `${listBase}/catalog?includeHidden=1`, 100);
    await readAll(sweep, cookie, "GET shopping-lists/bought?listId", "ShoppingBoughtListResponseSchema", `${base}/shopping-lists/bought?listId=${list.id}`, 100);
    const range = ranges[0]!;
    await read(sweep, cookie, "GET shopping-lists/:id/from-plan", "PlanShoppingPreviewResponseSchema", `${listBase}/from-plan?from=${range.from}&to=${addDays(range.from, 6)}`);
  }

  const drafts = await readAll(sweep, cookie, "GET imports", "ImportDraftListResponseSchema", `${base}/imports`, 100);
  for (const draft of drafts.slice(0, sweep.detailCap)) {
    await read(sweep, cookie, "GET imports/:id", "ImportDraftResponseSchema", `${base}/imports/${draft.id}`);
  }
}

async function sweepFinance(sweep: Sweep, cookie: string, householdId: string, userId: string, visited: Visited): Promise<void> {
  const base = `/api/households/${householdId}/finance`;
  visited.participants = await read(sweep, cookie, "GET participants", "FinanceParticipantListResponseSchema", `${base}/participants`);
  // every other finance route is for a seated participant (a member without a seat gets 403 by design, D3)
  if (!(visited.participants?.items ?? []).some((p: { userId: string }) => p.userId === userId)) return;
  const transactions = await readAll(sweep, cookie, "GET transactions", "TransactionListResponseSchema", `${base}/transactions`, 200);
  await readAll(sweep, cookie, "GET transactions?includeAggregates=false", "TransactionListResponseSchema", `${base}/transactions?includeAggregates=false`, 200);
  for (const transaction of transactions.slice(0, sweep.detailCap)) {
    await read(sweep, cookie, "GET transactions/:id", "TransactionResponseSchema", `${base}/transactions/${transaction.id}`);
  }
  await read(sweep, cookie, "GET transactions/summary", "TransactionSummaryResponseSchema", `${base}/transactions/summary`);
  await read(sweep, cookie, "GET transactions/summary?includeAggregates=false", "TransactionSummaryResponseSchema", `${base}/transactions/summary?includeAggregates=false`);
  await read(sweep, cookie, "GET categories", "CategoryListResponseSchema", `${base}/categories`);
  await read(sweep, cookie, "GET categories?includeHidden", "CategoryListResponseSchema", `${base}/categories?includeHidden=true`);
  await read(sweep, cookie, "GET tags", "FinanceTagListResponseSchema", `${base}/tags`);
  visited.plan = await read(sweep, cookie, "GET plan", "PlanResponseSchema", `${base}/plan`);
  const period = visited.plan?.plan?.startPeriod;
  if (typeof period === "string") {
    // an incomplete plan answers 4xx by design: that is not a schema failure
    await read(sweep, cookie, "GET plan/preview", "PlanComputationResponseSchema", `${base}/plan/preview?period=${period}`, { allow: [400, 409, 422] });
  }
  await readAll(sweep, cookie, "GET plan/runs", "AccrualRunListResponseSchema", `${base}/plan/runs`, 200);
  await read(sweep, cookie, "GET balance", "BalanceResponseSchema", `${base}/balance`);
  await read(sweep, cookie, "GET balance?includeAggregates=false", "BalanceResponseSchema", `${base}/balance?includeAggregates=false`);
  await read(sweep, cookie, "GET balance/history", "BalanceHistoryResponseSchema", `${base}/balance/history`);
  await readAll(sweep, cookie, "GET settlements", "TransactionListResponseSchema", `${base}/settlements`, 200);
}

/**
 * One signed-in account: the core reads, then every household in `only` (or all of the account's)
 * with the module sweeps its `modules` list names.
 */
async function sweepAccount(sweep: Sweep, cookie: string, only?: ReadonlySet<string>): Promise<void> {
  const me = await read(sweep, cookie, "GET /api/auth/me", "MeResponseSchema", "/api/auth/me");
  await read(sweep, cookie, "GET /api/auth/sessions", "SessionListResponseSchema", "/api/auth/sessions");
  await read(sweep, cookie, "GET /api/auth/oauth", "OAuthProvidersResponseSchema", "/api/auth/oauth");
  await read(sweep, cookie, "GET /api/households", "HouseholdListResponseSchema", "/api/households");
  await read(sweep, cookie, "GET /api/recipe/cards", "CardListResponseSchema", "/api/recipe/cards");
  for (const household of (me?.households ?? []) as { id: string; role: string; modules: string[] }[]) {
    if (only !== undefined && !only.has(household.id)) continue;
    const visited = sweep.visited.get(household.id) ?? { role: household.role };
    sweep.visited.set(household.id, visited);
    const core = `/api/households/${household.id}`;
    await read(sweep, cookie, "GET /api/households/:id", "HouseholdDetailResponseSchema", core);
    visited.members = await read(sweep, cookie, "GET members", "HouseholdMemberListResponseSchema", `${core}/members`);
    if (household.role === "owner" || household.role === "admin") {
      await readAll(sweep, cookie, "GET invites", "HouseholdInviteListResponseSchema", `${core}/invites`, 100);
    }
    if (household.modules.includes("recipe")) await sweepRecipe(sweep, cookie, household.id);
    if (household.modules.includes("finance")) await sweepFinance(sweep, cookie, household.id, me.user.id, visited);
  }
}

/* -------------------------------------------------------------------------- */
/* Part 1: the fixtures, applied into the shared DB                           */
/* -------------------------------------------------------------------------- */

/** Every address the fixtures write, plus the claim address `legacy-placeholders.test.ts` registers. */
const FIXTURE_EMAILS = [
  ...new Set(
    [...Object.values(RECIPE_USERS), ...Object.values(FINANCE_USERS)].flatMap((user): string[] =>
      user.emailNormalized === null ? [] : [user.emailNormalized],
    ),
  ),
  "pia@example.test",
];
const COUNTED = ["users", "households", "household_invites", "legacy_ids", "recipe_recipes", "recipe_cards", "finance_transactions"] as const;

/** Who is expected to be able to log in, and the password the migration carried for them. */
const PASSWORD_ACCOUNTS = [
  { name: "anna", email: RECIPE_USERS.anna.emailNormalized, password: RECIPE_USERS.anna.password },
  { name: "cleo", email: RECIPE_USERS.cleo.emailNormalized, password: RECIPE_USERS.cleo.password },
  { name: "dana", email: RECIPE_USERS.dana.emailNormalized, password: RECIPE_USERS.dana.password },
  { name: "emil", email: FINANCE_USERS.emil.emailNormalized, password: FINANCE_USERS.emil.password },
  { name: "fritz", email: FINANCE_USERS.fritz.emailNormalized, password: FINANCE_USERS.fritz.password },
  { name: "gina", email: FINANCE_USERS.gina.emailNormalized, password: FINANCE_USERS.gina.password },
] as const;

async function login(email: string, password: string): Promise<string | undefined> {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  await response.text();
  if (response.status !== 200) return undefined;
  const header = response.headers.getSetCookie().find((value) => value.startsWith("toon_session="));
  return (header ?? "").split(";")[0] || undefined;
}

describe.skipIf(SNAPSHOT)("web contract over migrated legacy data (shared DB, recipe and finance fixtures)", () => {
  let dir: string;
  let recipe: LegacyDb;
  let finance: LegacyDb;
  let report: Report;
  let before: Record<string, number>;
  let ledgerBefore: Set<string>;
  const sweep = new Sweep(Number.POSITIVE_INFINITY, 1000);

  const ledgerKey = (row: Record<string, unknown>) => `${row.table}|${row.legacy_source}|${row.legacy_id}`;

  beforeAll(async () => {
    await runMigrations(sharedDb);
    // The gate is ON for this file: an unconfirmed (finance-only) account must still READ.
    setVerifiedEmailRequired(true);
    const present = await sharedClient.execute({
      sql: `SELECT email FROM users WHERE email IN (${FIXTURE_EMAILS.map(() => "?").join(", ")})`,
      args: FIXTURE_EMAILS,
    });
    if (present.rows.length > 0) {
      throw new Error(
        `the shared test DB already holds fixture e-mails (${present.rows.map((row) => row.email).join(", ")}); this test must run on a DB without them`,
      );
    }
    const fk = await sharedClient.execute("PRAGMA foreign_keys");
    if (Number(fk.rows[0]?.foreign_keys) !== 1) throw new Error("the shared test DB runs without foreign keys; the cleanup relies on cascades");
    before = {};
    for (const table of COUNTED) before[table] = await countRows(sharedClient, table);
    ledgerBefore = new Set((await sharedClient.execute('SELECT "table", legacy_source, legacy_id FROM legacy_ids')).rows.map(ledgerKey));

    // the full input: the fixture databases and uploads copied to a temp dir
    dir = mkdtempSync(join(tmpdir(), "toon-web-contract-legacy-"));
    mkdirSync(join(dir, "scratch"));
    copyFileSync(join(FIXTURE_DIR, "recipe.db"), join(dir, "recipe.db"));
    copyFileSync(join(FIXTURE_DIR, "finance.db"), join(dir, "finance.db"));
    cpSync(join(FIXTURE_DIR, "uploads"), join(dir, "uploads-source"), { recursive: true });
    recipe = await openLegacy("recipe", join(dir, "recipe.db"), join(dir, "scratch"));
    finance = await openLegacy("finance", join(dir, "finance.db"), join(dir, "scratch"));
    report = await runLegacyMigration({
      mode: "apply",
      recipe,
      finance,
      target: { db: sharedDb, client: sharedClient, url: "file::memory:" },
      uploads: { sourceDir: join(dir, "uploads-source"), targetDir: join(dir, "uploads"), copy: true },
      webOrigin: ORIGIN,
    });
  }, 120_000);

  afterAll(async () => {
    try {
      const written = (await sharedClient.execute('SELECT "table", legacy_source, legacy_id, new_id FROM legacy_ids')).rows.filter(
        (row) => !ledgerBefore.has(ledgerKey(row)),
      );
      const ids = (table: string) => [...new Set(written.filter((row) => row.table === table).map((row) => String(row.new_id)))];
      // households first: the cascade takes memberships, invites, module rows and every recipe_* and finance_* row
      for (const id of ids("households")) await sharedClient.execute({ sql: "DELETE FROM households WHERE id = ?", args: [id] });
      for (const id of ids("users")) await sharedClient.execute({ sql: "DELETE FROM users WHERE id = ?", args: [id] });
      for (const row of written) {
        await sharedClient.execute({
          sql: 'DELETE FROM legacy_ids WHERE "table" = ? AND legacy_source = ? AND legacy_id = ?',
          args: [String(row.table), String(row.legacy_source), String(row.legacy_id)],
        });
      }
      const after: Record<string, number> = {};
      for (const table of COUNTED) after[table] = await countRows(sharedClient, table);
      expect(after).toEqual(before);
    } finally {
      setVerifiedEmailRequired(null);
      recipe?.client.close();
      finance?.client.close();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the full apply is clean", () => {
    expect(report.errors).toEqual([]);
    expect(exitCodeFor(report)).toBe(0);
    expect(report.balances.length).toBeGreaterThan(0);
    expect(report.balances.every((balance) => balance.ok)).toBe(true);
  });

  test("every read route of the three clients decodes to the body over every household of every password account", async () => {
    const loggedIn: string[] = [];
    for (const account of PASSWORD_ACCOUNTS) {
      const cookie = await login(account.email, account.password);
      expect(cookie, `${account.name} cannot log in`).toBeDefined();
      loggedIn.push(account.name);
      await sweepAccount(sweep, cookie!);
    }
    // ben is OAuth-only in toon-recipe and his finance password is not carried (collisionsWithoutPassword)
    expect(await login(RECIPE_USERS.ben.emailNormalized, FINANCE_USERS.ben.password)).toBeUndefined();
    // health once, anonymously
    await read(sweep, "", "GET /api/health", "HealthResponseSchema", "/api/health");

    console.log(`[web-contract-legacy] ${loggedIn.length} accounts, ${sweep.visited.size} households, ${sweep.requests} requests`);
    expect(sweep.failures, sweep.lines().join("\n")).toBe(0);
    // every schema of the list met at least one body
    for (const name of Object.keys(SCHEMAS) as SchemaName[]) {
      expect(sweep.tallies.get(name)?.ok ?? 0, `${name} decoded no body`).toBeGreaterThan(0);
    }
  }, 180_000);

  test("the ADR 0005 households and the ADR 0006 placeholder were part of it", () => {
    const target = (financeHouseholdId: string) => {
      const decision = report.decisions.find((d) => d.financeHouseholdId === financeHouseholdId);
      return decision?.targetHouseholdId ?? "";
    };
    // FH1, FH2, FH3, FH4 and FH6 land in a household (FH5 has no members and is skipped)
    for (const key of ["FH1", "FH2", "FH3", "FH4", "FH6"] as const) {
      const id = target(FINANCE_HOUSEHOLDS[key].id);
      expect(id, `${key} has no target household`).not.toBe("");
      expect(sweep.visited.has(id), `${key} was not swept`).toBe(true);
      expect(sweep.visited.get(id)?.participants, `${key} participants were not decoded`).toBeDefined();
    }
    expect(target(FINANCE_HOUSEHOLDS.FH5.id)).toBe("");

    // FH4: a one-participant household, its lone slot-2 participant re-seated in slot 1 (ADR 0005)
    const fh4 = sweep.visited.get(target(FINANCE_HOUSEHOLDS.FH4.id))!;
    expect(fh4.participants.items).toHaveLength(1);
    expect(fh4.participants.items[0].memberSlot).toBe(1);
    // its income naming a non-participant (fritz) is kept
    const participantIds = new Set(fh4.participants.items.map((p: { userId: string }) => p.userId));
    const incomePeople = fh4.plan.incomes.map((income: { personId: string }) => income.personId);
    expect(incomePeople.length).toBe(2);
    expect(incomePeople.some((id: string) => !participantIds.has(id))).toBe(true);

    // FH6 merged into G2 (a recipe group) and seats the placeholder pia (ADR 0006) by her facts.ts id
    const g2 = sweep.visited.get(GROUPS.G2.id)!;
    expect(target(FINANCE_HOUSEHOLDS.FH6.id)).toBe(GROUPS.G2.id);
    const pia = g2.participants.items.find((p: { userId: string }) => p.userId === FINANCE_USERS.pia.id);
    expect(pia).toMatchObject({ memberSlot: 2, hasAccount: false, email: null });
    const piaMember = g2.members.items.find((m: { userId: string }) => m.userId === FINANCE_USERS.pia.id);
    expect(piaMember).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Part 2: the snapshot sweep (P7b)                                           */
/* -------------------------------------------------------------------------- */

// P7b: runs only on the owner's request (docs/open-work.md, "Web contract snapshot sweep"). It reads
// the DB of TEST_DATABASE_URL, a local COPY of a production snapshot, and prints counts and issue
// PATHS only. The default run reports it as skipped.
describe.skipIf(!SNAPSHOT)("web contract snapshot sweep (WEB_CONTRACT_SNAPSHOT=1, TEST_DATABASE_URL = a copy)", () => {
  test("every read route decodes to the body for one member of every household", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("WEB_CONTRACT_SNAPSHOT=1 needs TEST_DATABASE_URL=file:<a COPY of the snapshot>; refusing to sweep the temp test DB");
    }
    // The verified-e-mail gate stays ON: an unconfirmed member must still read.
    setVerifiedEmailRequired(true);
    const minted: string[] = [];
    try {
      const households = (await sharedClient.execute("SELECT id FROM households ORDER BY id")).rows.map((row) => String(row.id));
      // one REAL member per household (a placeholder cannot sign in): a finance participant first (the other finance
      // routes answer 403 to a member without a seat), then the highest role
      const byUser = new Map<string, Set<string>>();
      let withoutMember = 0;
      for (const householdId of households) {
        const member = await sharedClient.execute({
          sql: `SELECT hm.user_id AS user_id FROM household_members hm JOIN users u ON u.id = hm.user_id
                WHERE hm.household_id = ? AND u.email IS NOT NULL AND u.password_hash IS NOT NULL
                ORDER BY EXISTS (SELECT 1 FROM finance_participants fp WHERE fp.household_id = hm.household_id AND fp.user_id = hm.user_id) DESC,
                         CASE hm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, hm.user_id LIMIT 1`,
          args: [householdId],
        });
        const userId = member.rows[0]?.user_id;
        if (userId === undefined) {
          withoutMember += 1;
          continue;
        }
        const set = byUser.get(String(userId)) ?? new Set<string>();
        set.add(householdId);
        byUser.set(String(userId), set);
      }

      const sweep = new Sweep(200, 100);
      for (const [userId, owned] of byUser) {
        const session = await runTest(
          Effect.gen(function* () {
            const sessions = yield* Sessions;
            return yield* sessions.createSession(userId);
          }),
        );
        minted.push(session.id);
        await sweepAccount(sweep, `toon_session=${session.id}`, owned);
      }
      await read(sweep, "", "GET /api/health", "HealthResponseSchema", "/api/health");

      const lines = sweep.lines();
      console.log(
        [
          `[web-contract-snapshot] ${households.length} households (${withoutMember} without a password account), ${byUser.size} sessions, ${sweep.requests} requests`,
          ...lines.map((line) => `[web-contract-snapshot] ${line}`),
        ].join("\n"),
      );
      expect(sweep.failures, lines.join("\n")).toBe(0);
    } finally {
      for (const id of minted) {
        await runTest(
          Effect.gen(function* () {
            const sessions = yield* Sessions;
            yield* sessions.deleteSession(id);
          }),
        );
      }
      setVerifiedEmailRequired(null);
    }
  }, 600_000);
});
