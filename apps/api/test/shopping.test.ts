/**
 * Integration tests for /api/households/:householdId/recipe/shopping-lists.
 *
 * Same harness as test/recipes.test.ts: real Hono app, real session + household
 * middleware, in-memory libSQL database with the generated migrations applied.
 * `withTransaction` degrades to sequential statements on a memory DB (see
 * core/services/households/support.ts), so the write ORDER is still covered here.
 */
import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import {
  householdMembers,
  sessions,
  shoppingListCatalog,
  shoppingListItems,
  shoppingMutations,
  users,
} from "../src/db/schema.ts";
import { app } from "../src/index.ts";

await runMigrations(db);

/* -------------------------------------------------------------------------- */
/* harness                                                                    */
/* -------------------------------------------------------------------------- */

interface TestUser {
  id: string;
  name: string;
  cookie: string;
}

async function createUser(name: string): Promise<TestUser> {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    email: `${name.toLowerCase()}.${id.slice(0, 8)}@toon.test`,
    name,
    emailVerified: true,
  });
  const sessionId = crypto.randomUUID().replaceAll("-", "");
  await db
    .insert(sessions)
    .values({ id: sessionId, userId: id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
  return { id, name, cookie: `toon_session=${sessionId}` };
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

interface ItemPayload {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  position: number;
  sourceRecipeIds: string[];
  sources: Array<{ id: string; title: string }>;
}

interface DetailPayload {
  list: { id: string; name: string; itemCount: number; boughtClearedAt: string | null };
  items: ItemPayload[];
  catalog: Array<{
    id: string;
    name: string;
    unit: string | null;
    useCount: number;
    hiddenAt: string | null;
  }>;
  // Full shapes are pinned by test/shopping-bought.test.ts; this file's own
  // assertions never index into either array, so `unknown[]` is enough here.
  bought: unknown[];
  recipes: unknown[];
}

interface ErrorPayload {
  error: { code: string; message: string };
}

interface Fixture {
  owner: TestUser;
  member: TestUser;
  outsider: TestUser;
  householdId: string;
  listId: string;
}

/** owner + member sharing a household with one empty list, plus an unrelated user. */
async function setup(): Promise<Fixture> {
  const owner = await createUser("Owner");
  const member = await createUser("Member");
  const outsider = await createUser("Outsider");

  const created = await call("/api/households", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: `WG ${crypto.randomUUID().slice(0, 8)}` },
  });
  expect(created.status).toBe(201);
  const householdId = (await body<{ household: { id: string } }>(created)).household.id;
  await db
    .insert(householdMembers)
    .values({ id: crypto.randomUUID(), householdId, userId: member.id, role: "member" });

  const list = await call(`/api/households/${householdId}/recipe/shopping-lists`, {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Rewe" },
  });
  expect(list.status).toBe(201);
  const listId = (await body<{ list: { id: string } }>(list)).list.id;

  return { owner, member, outsider, householdId, listId };
}

function itemsUrl(fixture: Fixture): string {
  return `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/items`;
}

/** Adds lines as the owner and returns the resulting detail payload. */
async function addItems(
  fixture: Fixture,
  items: Array<{ name: string; quantity?: number | null; unit?: string | null; note?: string | null }>,
  mutationId?: string,
): Promise<DetailPayload> {
  const response = await call(itemsUrl(fixture), {
    method: "POST",
    cookie: fixture.owner.cookie,
    body: mutationId === undefined ? { items } : { items, mutationId },
  });
  expect(response.status).toBe(200);
  return body<DetailPayload>(response);
}

function findItem(detail: DetailPayload, name: string): ItemPayload | undefined {
  return detail.items.find((item) => item.name.toLowerCase() === name.toLowerCase());
}

/** A recipe in the fixture's household with the given ingredient lines. */
async function createRecipe(
  fixture: Fixture,
  title: string,
  servingsAmount: number | null,
  ingredients: Array<{ name: string; quantity?: number | null; unit?: string | null }>,
): Promise<string> {
  const response = await call(`/api/households/${fixture.householdId}/recipe/recipes`, {
    method: "POST",
    cookie: fixture.owner.cookie,
    body: { title, servingsAmount, servingsUnit: "Portionen", ingredients },
  });
  expect(response.status).toBe(201);
  return (await body<{ recipe: { id: string } }>(response)).recipe.id;
}

/* -------------------------------------------------------------------------- */
/* lists                                                                      */
/* -------------------------------------------------------------------------- */

describe("shopping lists CRUD", () => {
  test("creates, lists and renames; several named lists per household", async () => {
    const fixture = await setup();
    const base = `/api/households/${fixture.householdId}/recipe/shopping-lists`;

    const second = await call(base, {
      method: "POST",
      cookie: fixture.member.cookie,
      body: { name: "Drogerie" },
    });
    expect(second.status).toBe(201);

    const listed = await call(base, { cookie: fixture.member.cookie });
    const payload = await body<{ items: Array<{ name: string; itemCount: number }> }>(listed);
    expect(payload.items.map((list) => list.name)).toEqual(["Drogerie", "Rewe"]);
    expect(payload.items.every((list) => list.itemCount === 0)).toBe(true);

    const renamed = await call(`${base}/${fixture.listId}`, {
      method: "PATCH",
      cookie: fixture.member.cookie,
      body: { name: "Supermarkt" },
    });
    expect(renamed.status).toBe(200);
    expect((await body<{ list: { name: string } }>(renamed)).list.name).toBe("Supermarkt");
  });

  test("rejects a duplicate name, case-insensitively and folded", async () => {
    const fixture = await setup();
    const base = `/api/households/${fixture.householdId}/recipe/shopping-lists`;

    const clash = await call(base, {
      method: "POST",
      cookie: fixture.owner.cookie,
      body: { name: "rewe" },
    });
    expect(clash.status).toBe(409);
    expect((await body<ErrorPayload>(clash)).error.code).toBe("shopping_list_name_taken");

    await call(base, { method: "POST", cookie: fixture.owner.cookie, body: { name: "Käse" } });
    const folded = await call(base, {
      method: "POST",
      cookie: fixture.owner.cookie,
      body: { name: "kase" },
    });
    expect(folded.status).toBe(409);
  });

  test("renaming to its own name is allowed", async () => {
    const fixture = await setup();
    const response = await call(
      `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}`,
      { method: "PATCH", cookie: fixture.owner.cookie, body: { name: "Rewe" } },
    );
    expect(response.status).toBe(200);
  });

  test("a member may not delete a list someone else created; an admin may", async () => {
    const fixture = await setup();
    const url = `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}`;

    const forbidden = await call(url, { method: "DELETE", cookie: fixture.member.cookie });
    expect(forbidden.status).toBe(403);

    const allowed = await call(url, { method: "DELETE", cookie: fixture.owner.cookie });
    expect(allowed.status).toBe(204);
    expect((await call(url, { cookie: fixture.owner.cookie })).status).toBe(404);
  });

  test("deleting a list cascades its items, catalog and ledger", async () => {
    const fixture = await setup();
    await addItems(fixture, [{ name: "Milch", quantity: 1, unit: "l" }], crypto.randomUUID());
    const detail = await addItems(fixture, [{ name: "Butter" }]);
    const itemId = findItem(detail, "Butter")!.id;
    await call(`${itemsUrl(fixture)}/${itemId}/check`, {
      method: "POST",
      cookie: fixture.owner.cookie,
      body: {},
    });

    await call(`/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}`, {
      method: "DELETE",
      cookie: fixture.owner.cookie,
    });

    expect(
      await db.select().from(shoppingListItems).where(eq(shoppingListItems.listId, fixture.listId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(shoppingListCatalog)
        .where(eq(shoppingListCatalog.listId, fixture.listId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(shoppingMutations).where(eq(shoppingMutations.listId, fixture.listId)),
    ).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* access control                                                             */
/* -------------------------------------------------------------------------- */

describe("shopping list access control", () => {
  test("no session is 401", async () => {
    const fixture = await setup();
    expect((await call(`/api/households/${fixture.householdId}/recipe/shopping-lists`)).status).toBe(401);
  });

  test("a non-member gets 403, never the contents", async () => {
    const fixture = await setup();
    const response = await call(
      `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}`,
      { cookie: fixture.outsider.cookie },
    );
    expect(response.status).toBe(403);
  });

  test("a list of another household is 404, not readable through its id", async () => {
    const first = await setup();
    const second = await setup();
    const response = await call(
      `/api/households/${second.householdId}/recipe/shopping-lists/${first.listId}`,
      { cookie: second.owner.cookie },
    );
    expect(response.status).toBe(404);
  });

  test("an unknown household is 404", async () => {
    const fixture = await setup();
    const response = await call(`/api/households/${crypto.randomUUID()}/recipe/shopping-lists`, {
      cookie: fixture.owner.cookie,
    });
    expect(response.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* items + merging                                                            */
/* -------------------------------------------------------------------------- */

describe("adding and merging items", () => {
  test("adds lines in order and reports an item count", async () => {
    const fixture = await setup();
    const detail = await addItems(fixture, [
      { name: "Milch", quantity: 1, unit: "l" },
      { name: "Klopapier" },
    ]);
    expect(detail.items.map((item) => item.name)).toEqual(["Milch", "Klopapier"]);
    expect(detail.items.map((item) => item.position)).toEqual([0, 1]);
    expect(detail.list.itemCount).toBe(2);
    expect(findItem(detail, "Klopapier")!.quantity).toBeNull();
  });

  test("merges the same ingredient into one line and keeps its position", async () => {
    const fixture = await setup();
    await addItems(fixture, [
      { name: "Mehl", quantity: 200, unit: "g" },
      { name: "Zucker", quantity: 100, unit: "g" },
    ]);
    const detail = await addItems(fixture, [{ name: "mehl", quantity: 200, unit: "g" }]);

    expect(detail.items).toHaveLength(2);
    expect(detail.items[0]).toMatchObject({ name: "Mehl", quantity: 400, unit: "g", position: 0 });
  });

  test("converts across a unit kind (1 kg + 200 g = 1.2 kg)", async () => {
    const fixture = await setup();
    await addItems(fixture, [{ name: "Mehl", quantity: 1, unit: "kg" }]);
    const detail = await addItems(fixture, [{ name: "Mehl", quantity: 200, unit: "g" }]);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]).toMatchObject({ quantity: 1.2, unit: "kg" });
  });

  test("keeps incompatible units apart instead of guessing", async () => {
    const fixture = await setup();
    await addItems(fixture, [{ name: "Öl", quantity: 200, unit: "ml" }]);
    const detail = await addItems(fixture, [{ name: "Öl", quantity: 2, unit: "EL" }]);
    expect(detail.items).toHaveLength(2);
    expect(detail.items.map((item) => item.unit)).toEqual(["ml", "EL"]);
  });

  test("an amount-less line never swallows a measured one", async () => {
    const fixture = await setup();
    await addItems(fixture, [{ name: "Mehl", quantity: 200, unit: "g" }]);
    const detail = await addItems(fixture, [{ name: "Mehl" }]);
    expect(detail.items).toHaveLength(2);
    expect(detail.items.map((item) => item.quantity)).toEqual([200, null]);
  });

  test("normalises unit aliases before storing", async () => {
    const fixture = await setup();
    const detail = await addItems(fixture, [{ name: "Mehl", quantity: 500, unit: "Gramm" }]);
    expect(detail.items[0]!.unit).toBe("g");
  });

  test("rejects an empty items array", async () => {
    const fixture = await setup();
    const response = await call(itemsUrl(fixture), {
      method: "POST",
      cookie: fixture.owner.cookie,
      body: { items: [] },
    });
    expect(response.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* editing + removing                                                         */
/* -------------------------------------------------------------------------- */

describe("editing items", () => {
  test("changes the amount", async () => {
    const fixture = await setup();
    const added = await addItems(fixture, [{ name: "Milch", quantity: 1, unit: "l" }]);
    const response = await call(`${itemsUrl(fixture)}/${added.items[0]!.id}`, {
      method: "PATCH",
      cookie: fixture.member.cookie,
      body: { quantity: 2 },
    });
    expect(response.status).toBe(200);
    expect((await body<DetailPayload>(response)).items[0]).toMatchObject({ quantity: 2, unit: "l" });
  });

  test("clears the amount with an explicit null", async () => {
    const fixture = await setup();
    const added = await addItems(fixture, [{ name: "Milch", quantity: 1, unit: "l" }]);
    const response = await call(`${itemsUrl(fixture)}/${added.items[0]!.id}`, {
      method: "PATCH",
      cookie: fixture.owner.cookie,
      body: { quantity: null, unit: null },
    });
    expect((await body<DetailPayload>(response)).items[0]).toMatchObject({
      quantity: null,
      unit: null,
    });
  });

  test("a rename into an existing line folds the two together", async () => {
    const fixture = await setup();
    const added = await addItems(fixture, [
      { name: "Mehl", quantity: 200, unit: "g" },
      { name: "Zuker", quantity: 100, unit: "g" },
    ]);
    const typo = findItem(added, "Zuker")!;

    // Fix the typo to a name that already exists in the same unit bucket.
    const response = await call(`${itemsUrl(fixture)}/${typo.id}`, {
      method: "PATCH",
      cookie: fixture.owner.cookie,
      body: { name: "Mehl" },
    });
    expect(response.status).toBe(200);
    const detail = await body<DetailPayload>(response);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]).toMatchObject({ name: "Mehl", quantity: 300, unit: "g" });
  });

  test("an unknown item id is 404", async () => {
    const fixture = await setup();
    const response = await call(`${itemsUrl(fixture)}/${crypto.randomUUID()}`, {
      method: "PATCH",
      cookie: fixture.owner.cookie,
      body: { quantity: 1 },
    });
    expect(response.status).toBe(404);
  });

  test("deleting is idempotent, so an offline replay is harmless", async () => {
    const fixture = await setup();
    const added = await addItems(fixture, [{ name: "Milch" }, { name: "Butter" }]);
    const url = `${itemsUrl(fixture)}/${added.items[0]!.id}`;

    const first = await call(url, { method: "DELETE", cookie: fixture.owner.cookie });
    expect(first.status).toBe(200);
    expect((await body<DetailPayload>(first)).items.map((item) => item.name)).toEqual(["Butter"]);

    const replay = await call(url, { method: "DELETE", cookie: fixture.owner.cookie });
    expect(replay.status).toBe(200);
    expect((await body<DetailPayload>(replay)).items).toHaveLength(1);
  });

  test("a plain delete does NOT count as bought", async () => {
    const fixture = await setup();
    const added = await addItems(fixture, [{ name: "Milch" }]);
    await call(`${itemsUrl(fixture)}/${added.items[0]!.id}`, {
      method: "DELETE",
      cookie: fixture.owner.cookie,
    });
    const [entry] = await db
      .select()
      .from(shoppingListCatalog)
      .where(
        and(
          eq(shoppingListCatalog.listId, fixture.listId),
          eq(shoppingListCatalog.nameKey, "milch"),
        ),
      );
    expect(entry?.useCount).toBe(0);
  });

  test("clearing empties the items but keeps the suggestions", async () => {
    const fixture = await setup();
    const added = await addItems(fixture, [{ name: "Milch" }, { name: "Brot" }]);
    await call(`${itemsUrl(fixture)}/${added.items[0]!.id}/check`, {
      method: "POST",
      cookie: fixture.owner.cookie,
      body: {},
    });

    const response = await call(itemsUrl(fixture), {
      method: "DELETE",
      cookie: fixture.owner.cookie,
    });
    expect(response.status).toBe(200);
    const detail = await body<DetailPayload>(response);
    expect(detail.items).toHaveLength(0);
    expect(detail.catalog.map((entry) => entry.name).sort()).toEqual(["Brot", "Milch"]);
  });
});

/* -------------------------------------------------------------------------- */
/* check off -> "Häufig gekauft"                                              */
/* -------------------------------------------------------------------------- */

describe("checking off items", () => {
  test("removes the item from the list and offers it as a suggestion", async () => {
    const fixture = await setup();
    const added = await addItems(fixture, [
      { name: "Milch", quantity: 1, unit: "l" },
      { name: "Brot" },
    ]);
    const milch = findItem(added, "Milch")!;
    // While Milch is ON the list it must not be suggested.
    expect(added.catalog.map((entry) => entry.name)).not.toContain("Milch");

    const response = await call(`${itemsUrl(fixture)}/${milch.id}/check`, {
      method: "POST",
      cookie: fixture.member.cookie,
      body: {},
    });
    expect(response.status).toBe(200);
    const detail = await body<DetailPayload>(response);

    expect(detail.items.map((item) => item.name)).toEqual(["Brot"]);
    const suggestion = detail.catalog.find((entry) => entry.name === "Milch");
    expect(suggestion).toMatchObject({ useCount: 1, unit: "l" });
  });

  test("repeated purchases rank higher", async () => {
    const fixture = await setup();
    for (let round = 0; round < 3; round += 1) {
      const added = await addItems(fixture, [{ name: "Milch" }]);
      await call(`${itemsUrl(fixture)}/${added.items[0]!.id}/check`, {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: {},
      });
    }
    const added = await addItems(fixture, [{ name: "Kapern" }]);
    await call(`${itemsUrl(fixture)}/${added.items[0]!.id}/check`, {
      method: "POST",
      cookie: fixture.owner.cookie,
      body: {},
    });

    const detail = await body<DetailPayload>(
      await call(`/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}`, {
        cookie: fixture.owner.cookie,
      }),
    );
    expect(detail.catalog[0]).toMatchObject({ name: "Milch", useCount: 3 });
  });

  test("re-adding a suggestion puts it back with no amount", async () => {
    const fixture = await setup();
    const added = await addItems(fixture, [{ name: "Milch", quantity: 2, unit: "l" }]);
    const checked = await body<DetailPayload>(
      await call(`${itemsUrl(fixture)}/${added.items[0]!.id}/check`, {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: {},
      }),
    );
    const entryId = checked.catalog.find((entry) => entry.name === "Milch")!.id;

    const response = await call(
      `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/catalog/${entryId}`,
      { method: "POST", cookie: fixture.owner.cookie, body: {} },
    );
    expect(response.status).toBe(200);
    const detail = await body<DetailPayload>(response);
    expect(detail.items).toHaveLength(1);
    // Deliberately amount-less: the last trip's 2 l would be a guess.
    expect(detail.items[0]).toMatchObject({ name: "Milch", quantity: null, unit: null });
    // Back on the list, so no longer suggested.
    expect(detail.catalog.map((entry) => entry.name)).not.toContain("Milch");
  });

  test("a suggestion can be dismissed", async () => {
    const fixture = await setup();
    const added = await addItems(fixture, [{ name: "Kapern" }]);
    const checked = await body<DetailPayload>(
      await call(`${itemsUrl(fixture)}/${added.items[0]!.id}/check`, {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: {},
      }),
    );
    const entryId = checked.catalog.find((entry) => entry.name === "Kapern")!.id;
    const base = `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/catalog/${entryId}`;

    expect((await call(base, { method: "DELETE", cookie: fixture.owner.cookie })).status).toBe(204);
    // Idempotent: a replay must not 404.
    expect((await call(base, { method: "DELETE", cookie: fixture.owner.cookie })).status).toBe(204);

    const detail = await body<DetailPayload>(
      await call(`/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}`, {
        cookie: fixture.owner.cookie,
      }),
    );
    expect(detail.catalog.map((entry) => entry.name)).not.toContain("Kapern");
  });

  test("checking an already-checked item is a no-op, not a 404", async () => {
    const fixture = await setup();
    const added = await addItems(fixture, [{ name: "Milch" }]);
    const url = `${itemsUrl(fixture)}/${added.items[0]!.id}/check`;

    expect((await call(url, { method: "POST", cookie: fixture.owner.cookie, body: {} })).status).toBe(
      200,
    );
    const replay = await call(url, { method: "POST", cookie: fixture.owner.cookie, body: {} });
    expect(replay.status).toBe(200);
    const detail = await body<DetailPayload>(replay);
    expect(detail.items).toHaveLength(0);
    // The count must NOT have been incremented twice by the replay.
    expect(detail.catalog.find((entry) => entry.name === "Milch")?.useCount).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* recipes -> list                                                            */
/* -------------------------------------------------------------------------- */

describe("adding a recipe to a list", () => {
  test("scales the ingredients to the requested portions", async () => {
    const fixture = await setup();
    const recipeId = await createRecipe(fixture, "Pfannkuchen", 2, [
      { name: "Mehl", quantity: 250, unit: "g" },
      { name: "Milch", quantity: 500, unit: "ml" },
      { name: "Eier", quantity: 2 },
      { name: "Salz", quantity: 1, unit: "Prise" },
    ]);

    const response = await call(
      `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/recipes`,
      { method: "POST", cookie: fixture.owner.cookie, body: { recipeId, servings: 6 } },
    );
    expect(response.status).toBe(200);
    const detail = await body<DetailPayload>(response);

    expect(findItem(detail, "Mehl")).toMatchObject({ quantity: 750, unit: "g" });
    // 1500 ml is nicer as 1.5 l.
    expect(findItem(detail, "Milch")).toMatchObject({ quantity: 1.5, unit: "l" });
    expect(findItem(detail, "Eier")).toMatchObject({ quantity: 6, unit: null });
    // A pinch stays a pinch, whatever the factor.
    expect(findItem(detail, "Salz")).toMatchObject({ quantity: 1, unit: "Prise" });
  });

  test("without `servings` the recipe's own amounts land unchanged", async () => {
    const fixture = await setup();
    const recipeId = await createRecipe(fixture, "Suppe", 4, [
      { name: "Möhren", quantity: 300, unit: "g" },
    ]);
    const detail = await body<DetailPayload>(
      await call(`/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/recipes`, {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: { recipeId },
      }),
    );
    expect(findItem(detail, "Möhren")).toMatchObject({ quantity: 300, unit: "g" });
  });

  test("a recipe without a portion count is added unscaled rather than refused", async () => {
    const fixture = await setup();
    const recipeId = await createRecipe(fixture, "Ohne Portionen", null, [
      { name: "Reis", quantity: 100, unit: "g" },
    ]);
    const response = await call(
      `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/recipes`,
      { method: "POST", cookie: fixture.owner.cookie, body: { recipeId, servings: 8 } },
    );
    expect(response.status).toBe(200);
    expect(findItem(await body<DetailPayload>(response), "Reis")).toMatchObject({ quantity: 100 });
  });

  test("`ingredientIds` adds only the ticked lines, still scaled", async () => {
    const fixture = await setup();
    const recipeId = await createRecipe(fixture, "Pfannkuchen", 2, [
      { name: "Mehl", quantity: 250, unit: "g" },
      { name: "Milch", quantity: 500, unit: "ml" },
      { name: "Salz", quantity: 1, unit: "Prise" },
    ]);
    const recipe = await body<{ recipe: { ingredients: Array<{ id: string; name: string }> } }>(
      await call(`/api/households/${fixture.householdId}/recipe/recipes/${recipeId}`, {
        cookie: fixture.owner.cookie,
      }),
    );
    const keep = recipe.recipe.ingredients
      .filter((ingredient) => ingredient.name !== "Salz")
      .map((ingredient) => ingredient.id);

    const detail = await body<DetailPayload>(
      await call(`/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/recipes`, {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: { recipeId, servings: 4, ingredientIds: keep },
      }),
    );

    // The factor comes from `servings`, NOT from how many lines were ticked.
    expect(findItem(detail, "Mehl")).toMatchObject({ quantity: 500, unit: "g" });
    expect(findItem(detail, "Milch")).toMatchObject({ quantity: 1, unit: "l" });
    expect(findItem(detail, "Salz")).toBeUndefined();
    expect(detail.items).toHaveLength(2);
  });

  test("an id that is not part of the recipe is ignored, not an error", async () => {
    const fixture = await setup();
    const recipeId = await createRecipe(fixture, "Reisgericht", 2, [
      { name: "Reis", quantity: 100, unit: "g" },
    ]);
    const response = await call(
      `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/recipes`,
      {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: { recipeId, ingredientIds: [crypto.randomUUID()] },
      },
    );
    // A queued offline request must not fail because the recipe changed meanwhile.
    expect(response.status).toBe(200);
    expect((await body<DetailPayload>(response)).items).toHaveLength(0);
  });

  test("omitting `ingredientIds` still adds the whole recipe", async () => {
    const fixture = await setup();
    const recipeId = await createRecipe(fixture, "Alles", 1, [
      { name: "Mehl", quantity: 100, unit: "g" },
      { name: "Zucker", quantity: 50, unit: "g" },
    ]);
    const detail = await body<DetailPayload>(
      await call(`/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/recipes`, {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: { recipeId },
      }),
    );
    expect(detail.items).toHaveLength(2);
  });

  test("two recipes merge their shared ingredients and keep both sources", async () => {
    const fixture = await setup();
    const first = await createRecipe(fixture, "Kuchen", 1, [
      { name: "Mehl", quantity: 200, unit: "g" },
      { name: "Zucker", quantity: 100, unit: "g" },
    ]);
    const second = await createRecipe(fixture, "Waffeln", 1, [
      { name: "Mehl", quantity: 200, unit: "g" },
      { name: "Butter", quantity: 100, unit: "g" },
    ]);
    const url = `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/recipes`;

    await call(url, { method: "POST", cookie: fixture.owner.cookie, body: { recipeId: first } });
    const detail = await body<DetailPayload>(
      await call(url, { method: "POST", cookie: fixture.owner.cookie, body: { recipeId: second } }),
    );

    const mehl = findItem(detail, "Mehl")!;
    expect(mehl).toMatchObject({ quantity: 400, unit: "g" });
    expect(mehl.sourceRecipeIds.sort()).toEqual([first, second].sort());
    expect(mehl.sources.map((source) => source.title).sort()).toEqual(["Kuchen", "Waffeln"]);
    expect(detail.items).toHaveLength(3);
  });

  test("a deleted recipe keeps its provenance id but resolves to no source", async () => {
    const fixture = await setup();
    const recipeId = await createRecipe(fixture, "Wegwerf", 1, [
      { name: "Linsen", quantity: 200, unit: "g" },
    ]);
    await call(`/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/recipes`, {
      method: "POST",
      cookie: fixture.owner.cookie,
      body: { recipeId },
    });
    await call(`/api/households/${fixture.householdId}/recipe/recipes/${recipeId}`, {
      method: "DELETE",
      cookie: fixture.owner.cookie,
    });

    const detail = await body<DetailPayload>(
      await call(`/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}`, {
        cookie: fixture.owner.cookie,
      }),
    );
    const linsen = findItem(detail, "Linsen")!;
    // The item survives the recipe — it is already in someone's basket.
    expect(linsen.quantity).toBe(200);
    expect(linsen.sourceRecipeIds).toEqual([recipeId]);
    expect(linsen.sources).toHaveLength(0);
  });

  test("a recipe from another household is 404", async () => {
    const fixture = await setup();
    const other = await setup();
    const foreign = await createRecipe(other, "Fremd", 1, [{ name: "Salz" }]);
    const response = await call(
      `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/recipes`,
      { method: "POST", cookie: fixture.owner.cookie, body: { recipeId: foreign } },
    );
    expect(response.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* offline replay safety                                                      */
/* -------------------------------------------------------------------------- */

describe("mutationId (offline replay safety)", () => {
  test("replaying an add applies it exactly once", async () => {
    const fixture = await setup();
    const mutationId = crypto.randomUUID();
    const items = [{ name: "Mehl", quantity: 500, unit: "g" }];

    const first = await addItems(fixture, items, mutationId);
    expect(first.items[0]).toMatchObject({ quantity: 500, unit: "g" });

    // Same id again: the amount must NOT double to 1 kg.
    const replay = await addItems(fixture, items, mutationId);
    expect(replay.items).toHaveLength(1);
    expect(replay.items[0]).toMatchObject({ quantity: 500, unit: "g" });
  });

  test("replaying a recipe add applies it exactly once", async () => {
    const fixture = await setup();
    const recipeId = await createRecipe(fixture, "Brot", 1, [
      { name: "Mehl", quantity: 500, unit: "g" },
    ]);
    const mutationId = crypto.randomUUID();
    const url = `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}/recipes`;
    const payload = { recipeId, mutationId };

    await call(url, { method: "POST", cookie: fixture.owner.cookie, body: payload });
    const replay = await body<DetailPayload>(
      await call(url, { method: "POST", cookie: fixture.owner.cookie, body: payload }),
    );
    expect(findItem(replay, "Mehl")).toMatchObject({ quantity: 500, unit: "g" });
  });

  test("a different mutationId does add again", async () => {
    const fixture = await setup();
    const items = [{ name: "Mehl", quantity: 500, unit: "g" }];
    await addItems(fixture, items, crypto.randomUUID());
    const second = await addItems(fixture, items, crypto.randomUUID());
    expect(second.items[0]).toMatchObject({ quantity: 1, unit: "kg" });
  });

  test("omitting mutationId keeps the plain online behaviour", async () => {
    const fixture = await setup();
    const items = [{ name: "Mehl", quantity: 500, unit: "g" }];
    await addItems(fixture, items);
    const second = await addItems(fixture, items);
    expect(second.items[0]).toMatchObject({ quantity: 1, unit: "kg" });
  });

  test("the ledger is scoped per list", async () => {
    const fixture = await setup();
    const other = await call(`/api/households/${fixture.householdId}/recipe/shopping-lists`, {
      method: "POST",
      cookie: fixture.owner.cookie,
      body: { name: "Zweite Liste" },
    });
    const otherListId = (await body<{ list: { id: string } }>(other)).list.id;
    const mutationId = crypto.randomUUID();
    const items = [{ name: "Mehl", quantity: 500, unit: "g" }];

    await addItems(fixture, items, mutationId);

    // A DIFFERENT list must still accept work, even under the same id: the ids are
    // per-device-per-mutation, and the primary key is global, so this documents that
    // a collision across lists is treated as already-applied.
    const response = await call(
      `/api/households/${fixture.householdId}/recipe/shopping-lists/${otherListId}/items`,
      { method: "POST", cookie: fixture.owner.cookie, body: { items, mutationId } },
    );
    expect(response.status).toBe(200);
    expect((await body<DetailPayload>(response)).items).toHaveLength(0);
  });
});
