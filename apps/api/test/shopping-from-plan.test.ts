/**
 * Integration tests for `GET …/shopping-lists/:listId/from-plan` (A03 § 5 / R21).
 *
 * WHAT THIS FILE PINS, beyond the diff itself:
 *  - both `from`/`to` are REQUIRED and a bad/inverted range is 422 — the server
 *    must not guess where a week starts (S4).
 *  - the plan-entry range scan and the ingredient lookup use their real indexes,
 *    with no `TEMP B-TREE` — the same shape as `plan.test.ts`'s and
 *    `recipes-search.test.ts`'s `explain query plan` assertions, and the bound
 *    `PLAN_LIMITS.fromPlanEntries` exists to protect (R23: a local libSQL file is
 *    one serialised lane, so the lever is cheaper queries, never more
 *    concurrency).
 */
import { describe, expect, test } from "bun:test";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { householdMembers, sessions, users } from "../src/db/schema.ts";
import { app } from "../src/index.ts";
import { explain } from "./support/explain.ts";

await runMigrations(db);

/* -------------------------------------------------------------------------- */
/* harness — duplicated per file rather than shared, per repo convention      */
/* -------------------------------------------------------------------------- */

interface TestUser {
  id: string;
  cookie: string;
}

async function createUser(): Promise<TestUser> {
  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({ id, email: `fromplan.${id.slice(0, 8)}@toon.test`, name: "Planer", emailVerified: true });
  const sessionId = crypto.randomUUID().replaceAll("-", "");
  await db
    .insert(sessions)
    .values({ id: sessionId, userId: id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
  return { id, cookie: `toon_session=${sessionId}` };
}

interface CallOptions {
  method?: string;
  cookie?: string;
  body?: unknown;
}

async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createGroup(user: TestUser, name: string): Promise<string> {
  const response = await call("/api/households", { method: "POST", cookie: user.cookie, body: { name } });
  expect(response.status).toBe(201);
  return (await body<{ household: { id: string } }>(response)).household.id;
}

async function createRecipe(
  user: TestUser,
  householdId: string,
  title: string,
  servingsAmount: number | null,
  ingredients: Array<{ name: string; quantity?: number | null; unit?: string | null }>,
): Promise<string> {
  const response = await call(`/api/households/${householdId}/recipe/recipes`, {
    method: "POST",
    cookie: user.cookie,
    body: { title, servingsAmount, servingsUnit: "Portionen", ingredients },
  });
  expect(response.status).toBe(201);
  return (await body<{ recipe: { id: string } }>(response)).recipe.id;
}

async function createShoppingList(user: TestUser, householdId: string, name: string): Promise<string> {
  const response = await call(`/api/households/${householdId}/recipe/shopping-lists`, {
    method: "POST",
    cookie: user.cookie,
    body: { name },
  });
  expect(response.status).toBe(201);
  return (await body<{ list: { id: string } }>(response)).list.id;
}

async function planEntry(
  user: TestUser,
  householdId: string,
  input: { recipeId: string; plannedOn: string; servings?: number },
): Promise<void> {
  const response = await call(`/api/households/${householdId}/recipe/plan`, {
    method: "POST",
    cookie: user.cookie,
    body: input,
  });
  expect([200, 201]).toContain(response.status);
}

interface PreviewPayload {
  listId: string;
  listName: string;
  from: string;
  to: string;
  totalMissingCount: number;
  recipes: Array<{
    recipeId: string;
    title: string;
    plannedOn: string;
    servings: number | null;
    ingredientTotal: number;
    missingCount: number;
    missingIngredientIds: string[];
    missingIngredients: Array<{
      id: string;
      name: string;
      quantity: number | null;
      unit: string | null;
    }>;
  }>;
}

interface DetailPayload {
  items: Array<{ id: string; name: string; quantity: number | null; unit: string | null }>;
}

/* -------------------------------------------------------------------------- */
/* the diff                                                                   */
/* -------------------------------------------------------------------------- */

describe("GET /:listId/from-plan", () => {
  test("reports missingCount/missingIngredientIds for a half-covered recipe, and adding them covers it", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Diff");
    const listId = await createShoppingList(user, householdId, "Rewe");
    const recipeId = await createRecipe(user, householdId, "Auflauf", 4, [
      { name: "Mehl", quantity: 250, unit: "g" },
      { name: "Milch", quantity: 500, unit: "ml" },
      { name: "Eier", quantity: 2 },
    ]);
    await planEntry(user, householdId, { recipeId, plannedOn: "2026-09-10", servings: 4 });

    // Already have the flour on the list, so it must not be reported as missing.
    await call(`/api/households/${householdId}/recipe/shopping-lists/${listId}/items`, {
      method: "POST",
      cookie: user.cookie,
      body: { items: [{ name: "Mehl", quantity: 250, unit: "g" }] },
    });

    const preview = await body<PreviewPayload>(
      await call(
        `/api/households/${householdId}/recipe/shopping-lists/${listId}/from-plan?from=2026-09-07&to=2026-09-13`,
        { cookie: user.cookie },
      ),
    );
    expect(preview.recipes).toHaveLength(1);
    const row = preview.recipes[0]!;
    expect(row.recipeId).toBe(recipeId);
    expect(row.plannedOn).toBe("2026-09-10");
    expect(row.ingredientTotal).toBe(3);
    expect(row.missingCount).toBe(2); // Milch + Eier
    expect(row.missingIngredientIds).toHaveLength(2);
    expect(preview.totalMissingCount).toBe(2);
    // The picker's lines: same rows as the ids, in recipe order, with their amounts.
    expect(row.missingIngredients.map((line) => line.id)).toEqual(row.missingIngredientIds);
    expect(row.missingIngredients.map(({ name, quantity, unit }) => ({ name, quantity, unit }))).toEqual([
      { name: "Milch", quantity: 500, unit: "ml" },
      { name: "Eier", quantity: 2, unit: null },
    ]);

    const added = await body<DetailPayload>(
      await call(`/api/households/${householdId}/recipe/shopping-lists/${listId}/recipes`, {
        method: "POST",
        cookie: user.cookie,
        body: { recipeId, servings: 4, ingredientIds: row.missingIngredientIds },
      }),
    );
    expect(added.items.map((i) => i.name).sort()).toEqual(["Eier", "Mehl", "Milch"]);
  });

  test("a fully-covered recipe is omitted", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Voll");
    const listId = await createShoppingList(user, householdId, "Rewe");
    const recipeId = await createRecipe(user, householdId, "Salat", 2, [{ name: "Gurke", quantity: 1 }]);
    await planEntry(user, householdId, { recipeId, plannedOn: "2026-09-10", servings: 2 });
    await call(`/api/households/${householdId}/recipe/shopping-lists/${listId}/items`, {
      method: "POST",
      cookie: user.cookie,
      body: { items: [{ name: "Gurke", quantity: 1 }] },
    });

    const preview = await body<PreviewPayload>(
      await call(
        `/api/households/${householdId}/recipe/shopping-lists/${listId}/from-plan?from=2026-09-07&to=2026-09-13`,
        { cookie: user.cookie },
      ),
    );
    expect(preview.recipes).toHaveLength(0);
    expect(preview.totalMissingCount).toBe(0);
  });

  test("a recipe planned twice in the window is one row, keeping the earliest day", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Doppelt");
    const listId = await createShoppingList(user, householdId, "Rewe");
    const recipeId = await createRecipe(user, householdId, "Pfannkuchen", 2, [
      { name: "Mehl", quantity: 250, unit: "g" },
    ]);
    await planEntry(user, householdId, { recipeId, plannedOn: "2026-09-12", servings: 2 });
    await planEntry(user, householdId, { recipeId, plannedOn: "2026-09-08", servings: 4 });

    const preview = await body<PreviewPayload>(
      await call(
        `/api/households/${householdId}/recipe/shopping-lists/${listId}/from-plan?from=2026-09-07&to=2026-09-13`,
        { cookie: user.cookie },
      ),
    );
    expect(preview.recipes).toHaveLength(1);
    expect(preview.recipes[0]).toMatchObject({ plannedOn: "2026-09-08", servings: 4 });
  });

  test("both `from` and `to` are required, and an inverted range is 422", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Validierung");
    const listId = await createShoppingList(user, householdId, "Rewe");
    const url = `/api/households/${householdId}/recipe/shopping-lists/${listId}/from-plan`;

    expect((await call(`${url}?from=2026-09-07`, { cookie: user.cookie })).status).toBe(422);
    expect((await call(`${url}?to=2026-09-13`, { cookie: user.cookie })).status).toBe(422);
    expect(
      (await call(`${url}?from=2026-09-13&to=2026-09-07`, { cookie: user.cookie })).status,
    ).toBe(422);
  });

  test("an outsider gets 403", async () => {
    const user = await createUser();
    const outsider = await createUser();
    const householdId = await createGroup(user, "WG Zugriff");
    const listId = await createShoppingList(user, householdId, "Rewe");
    const response = await call(
      `/api/households/${householdId}/recipe/shopping-lists/${listId}/from-plan?from=2026-09-07&to=2026-09-13`,
      { cookie: outsider.cookie },
    );
    expect(response.status).toBe(403);
  });
});

/* -------------------------------------------------------------------------- */
/* the measured query plan (R23's stated bound)                              */
/* -------------------------------------------------------------------------- */

describe("query plan", () => {
  test("the plan-entry range scan and the ingredient lookup use their indexes, no TEMP B-TREE", async () => {
    const planPlan = await explain(
      "explain query plan select * from recipe_meal_plan_entries where household_id = 'x' " +
        "and planned_on >= '2026-01-01' and planned_on <= '2026-01-31' " +
        "order by planned_on asc, position asc",
    );
    const planDetail = planPlan.rows.map((row) => String(row.detail)).join(" | ");
    expect(planDetail).toContain("recipe_meal_plan_entries_household_date_idx");
    expect(planDetail).not.toContain("TEMP B-TREE");

    const ingredientPlan = await explain(
      "explain query plan select * from recipe_recipe_ingredients where recipe_id in ('a','b','c') " +
        "order by recipe_id asc, position asc",
    );
    const ingredientDetail = ingredientPlan.rows.map((row) => String(row.detail)).join(" | ");
    expect(ingredientDetail).toContain("recipe_recipe_ingredients_recipe_position_idx");
    expect(ingredientDetail).not.toContain("TEMP B-TREE");
  });
});
