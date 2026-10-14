/**
 * Integration tests for the bought log, `Clear bought`, undo, the list-index
 * extras (`boughtCount`/`previewItems`/`?since`), catalog hiding and
 * "recipes on this list" removal — A03 §§ 1-4.
 *
 * `shopping.test.ts` keeps every CRUD/merge/idempotency case that already
 * existed; this file is additive, same harness (real Hono app, real session +
 * household middleware, in-memory libSQL, migrations applied).
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import {
  householdMembers,
  sessions,
  shoppingBoughtItems,
  shoppingListCatalog,
  shoppingListRecipes,
  users,
} from "../src/db/schema.ts";
import { app } from "../src/index.ts";

await runMigrations(db);

/* -------------------------------------------------------------------------- */
/* harness — duplicated per file rather than shared, per repo convention      */
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
}

interface BoughtPayload {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  boughtBy: string | null;
  boughtByName: string | null;
  boughtAt: string;
  sourceRecipeIds: string[];
}

interface RecipeRailPayload {
  recipeId: string;
  title: string;
  ingredientTotal: number;
  onListCount: number;
  sharedCount: number;
}

interface CatalogPayload {
  id: string;
  name: string;
  unit: string | null;
  useCount: number;
  hiddenAt: string | null;
}

interface DetailPayload {
  list: {
    id: string;
    name: string;
    itemCount: number;
    boughtCount?: number;
    boughtClearedAt: string | null;
    previewItems?: Array<{ name: string; quantity: number | null; unit: string | null }>;
  };
  items: ItemPayload[];
  catalog: CatalogPayload[];
  bought: BoughtPayload[];
  recipes: RecipeRailPayload[];
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

function base(fixture: Fixture): string {
  return `/api/households/${fixture.householdId}/recipe/shopping-lists/${fixture.listId}`;
}

async function addItems(
  fixture: Fixture,
  items: Array<{ name: string; quantity?: number | null; unit?: string | null; note?: string | null }>,
): Promise<DetailPayload> {
  const response = await call(`${base(fixture)}/items`, {
    method: "POST",
    cookie: fixture.owner.cookie,
    body: { items },
  });
  expect(response.status).toBe(200);
  return body<DetailPayload>(response);
}

function findItem(detail: DetailPayload, name: string): ItemPayload | undefined {
  return detail.items.find((item) => item.name.toLowerCase() === name.toLowerCase());
}

/** Checks off the named item as `user` and returns the resulting detail. */
async function checkOff(
  fixture: Fixture,
  name: string,
  user: TestUser = fixture.owner,
  mutationId?: string,
): Promise<DetailPayload> {
  const detail = await addItems(fixture, [{ name }]);
  const item = findItem(detail, name)!;
  const response = await call(`${base(fixture)}/items/${item.id}/check`, {
    method: "POST",
    cookie: user.cookie,
    body: mutationId === undefined ? {} : { mutationId },
  });
  expect(response.status).toBe(200);
  return body<DetailPayload>(response);
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
/* 1-3: the log append is bound to the DELETE actually removing a row          */
/* -------------------------------------------------------------------------- */

describe("the bought log", () => {
  test("check-off appends exactly one row, with the buyer, the amount and provenance", async () => {
    const fixture = await setup();
    const recipeId = await createRecipe(fixture, "Auflauf", 4, [
      { name: "Mehl", quantity: 250, unit: "g" },
    ]);
    await call(`${base(fixture)}/recipes`, {
      method: "POST",
      cookie: fixture.owner.cookie,
      body: { recipeId, servings: 4 },
    });
    const detail = await body<DetailPayload>(
      await call(`${base(fixture)}`, { cookie: fixture.owner.cookie }),
    );
    const item = findItem(detail, "Mehl")!;

    const checked = await body<DetailPayload>(
      await call(`${base(fixture)}/items/${item.id}/check`, {
        method: "POST",
        cookie: fixture.member.cookie,
        body: {},
      }),
    );
    expect(findItem(checked, "Mehl")).toBeUndefined();

    const rows = await db
      .select()
      .from(shoppingBoughtItems)
      .where(eq(shoppingBoughtItems.listId, fixture.listId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Mehl",
      quantity: 250,
      unit: "g",
      boughtBy: fixture.member.id,
      sourceRecipeIds: [recipeId],
    });

    const catalogEntry = await db
      .select()
      .from(shoppingListCatalog)
      .where(eq(shoppingListCatalog.listId, fixture.listId));
    expect(catalogEntry.find((entry) => entry.name === "Mehl")?.useCount).toBe(1);
  });

  test("a replayed mutationId appends no second row", async () => {
    const fixture = await setup();
    const detail = await addItems(fixture, [{ name: "Milch", quantity: 1, unit: "l" }]);
    const item = findItem(detail, "Milch")!;
    const mutationId = crypto.randomUUID();
    const url = `${base(fixture)}/items/${item.id}/check`;

    const first = await call(url, { method: "POST", cookie: fixture.owner.cookie, body: { mutationId } });
    expect(first.status).toBe(200);
    const replay = await call(url, { method: "POST", cookie: fixture.owner.cookie, body: { mutationId } });
    expect(replay.status).toBe(200);

    const rows = await db
      .select()
      .from(shoppingBoughtItems)
      .where(eq(shoppingBoughtItems.listId, fixture.listId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quantity).toBe(1);
  });

  test("a replay with no mutationId likewise appends no second row", async () => {
    const fixture = await setup();
    const detail = await addItems(fixture, [{ name: "Milch" }]);
    const item = findItem(detail, "Milch")!;
    const url = `${base(fixture)}/items/${item.id}/check`;

    await call(url, { method: "POST", cookie: fixture.owner.cookie, body: {} });
    const replay = await call(url, { method: "POST", cookie: fixture.owner.cookie, body: {} });
    expect(replay.status).toBe(200);

    const rows = await db
      .select()
      .from(shoppingBoughtItems)
      .where(eq(shoppingBoughtItems.listId, fixture.listId));
    expect(rows).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 4: Clear bought keeps the log                                              */
/* -------------------------------------------------------------------------- */

describe("Clear bought", () => {
  test("empties the section, keeps the log row, and the household archive still has it", async () => {
    const fixture = await setup();
    await checkOff(fixture, "Milch");

    const cleared = await body<DetailPayload>(
      await call(`${base(fixture)}/bought/clear`, { method: "POST", cookie: fixture.owner.cookie }),
    );
    expect(cleared.bought).toHaveLength(0);

    const rows = await db
      .select()
      .from(shoppingBoughtItems)
      .where(eq(shoppingBoughtItems.listId, fixture.listId));
    expect(rows).toHaveLength(1);

    const archive = await body<{ items: BoughtPayload[]; total: number }>(
      await call(`/api/households/${fixture.householdId}/recipe/shopping-lists/bought`, { cookie: fixture.owner.cookie }),
    );
    expect(archive.items.map((row) => row.name)).toContain("Milch");
  });
});

/* -------------------------------------------------------------------------- */
/* 5-6: undo                                                                  */
/* -------------------------------------------------------------------------- */

describe("undo", () => {
  test("re-adds with the logged amount, deletes the log row, decrements use_count, and is idempotent", async () => {
    const fixture = await setup();
    const withAmount = await addItems(fixture, [{ name: "Käse", quantity: 200, unit: "g" }]);
    const cheeseItem = findItem(withAmount, "Käse")!;
    const checkedCheese = await body<DetailPayload>(
      await call(`${base(fixture)}/items/${cheeseItem.id}/check`, {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: {},
      }),
    );
    const boughtRow = checkedCheese.bought.find((row) => row.name === "Käse")!;

    const undone = await body<DetailPayload>(
      await call(`${base(fixture)}/bought/${boughtRow.id}/undo`, {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: {},
      }),
    );
    expect(findItem(undone, "Käse")).toMatchObject({ quantity: 200, unit: "g" });
    expect(undone.bought.find((row) => row.name === "Käse")).toBeUndefined();

    const rows = await db
      .select()
      .from(shoppingBoughtItems)
      .where(eq(shoppingBoughtItems.id, boughtRow.id));
    expect(rows).toHaveLength(0);

    const catalogEntry = (
      await db.select().from(shoppingListCatalog).where(eq(shoppingListCatalog.listId, fixture.listId))
    ).find((entry) => entry.name === "Käse");
    expect(catalogEntry?.useCount).toBe(0);

    // Replaying the undo finds no row and is a no-op, not an error.
    const replay = await call(`${base(fixture)}/bought/${boughtRow.id}/undo`, {
      method: "POST",
      cookie: fixture.owner.cookie,
      body: {},
    });
    expect(replay.status).toBe(200);
  });

  test("undo MERGES onto whatever the list has gained since", async () => {
    const fixture = await setup();
    const withAmount = await addItems(fixture, [{ name: "Mehl", quantity: 500, unit: "g" }]);
    const item = findItem(withAmount, "Mehl")!;
    const checkedAgain = await body<DetailPayload>(
      await call(`${base(fixture)}/items/${item.id}/check`, {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: {},
      }),
    );
    const boughtRow = checkedAgain.bought.find((row) => row.name === "Mehl" && row.quantity === 500)!;

    // Someone adds 200 g Mehl while the 500 g purchase is only in the log.
    const withNewAddition = await addItems(fixture, [{ name: "Mehl", quantity: 200, unit: "g" }]);
    expect(findItem(withNewAddition, "Mehl")).toMatchObject({ quantity: 200, unit: "g" });

    const undone = await body<DetailPayload>(
      await call(`${base(fixture)}/bought/${boughtRow.id}/undo`, {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: {},
      }),
    );
    expect(findItem(undone, "Mehl")).toMatchObject({ quantity: 700, unit: "g" });
  });
});

/* -------------------------------------------------------------------------- */
/* 7-9: the household archive route + list-index extras                          */
/* -------------------------------------------------------------------------- */

describe("the household-wide bought archive and list-index extras", () => {
  test("GET /bought is registered before GET /:listId — both still resolve", async () => {
    const fixture = await setup();
    await checkOff(fixture, "Milch");

    const archive = await call(`/api/households/${fixture.householdId}/recipe/shopping-lists/bought`, {
      cookie: fixture.owner.cookie,
    });
    expect(archive.status).toBe(200);
    const archivePayload = await body<{ items: BoughtPayload[]; total: number; limit: number; offset: number }>(
      archive,
    );
    expect(Array.isArray(archivePayload.items)).toBe(true);
    expect(archivePayload.items.map((row) => row.name)).toContain("Milch");

    const detail = await call(`${base(fixture)}`, { cookie: fixture.owner.cookie });
    expect(detail.status).toBe(200);
    expect((await body<DetailPayload>(detail)).list.id).toBe(fixture.listId);
  });

  test("?since= on the index: a future since clamps boughtCount to 0; garbage is ignored, not 422", async () => {
    const fixture = await setup();
    await checkOff(fixture, "Milch");

    const listsUrl = `/api/households/${fixture.householdId}/recipe/shopping-lists`;
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const withFuture = await call(`${listsUrl}?since=${encodeURIComponent(future)}`, {
      cookie: fixture.owner.cookie,
    });
    expect(withFuture.status).toBe(200);
    const futurePayload = await body<{ items: Array<{ id: string; boughtCount?: number }> }>(withFuture);
    expect(futurePayload.items.find((l) => l.id === fixture.listId)?.boughtCount).toBe(0);

    const garbage = await call(`${listsUrl}?since=not-a-date`, { cookie: fixture.owner.cookie });
    expect(garbage.status).toBe(200);
    const garbagePayload = await body<{ items: Array<{ id: string; boughtCount?: number }> }>(garbage);
    // Ignored, so the count is the normal (unclamped) one, i.e. at least 1.
    expect(garbagePayload.items.find((l) => l.id === fixture.listId)?.boughtCount).toBeGreaterThanOrEqual(1);
  });

  test("previewItems is capped at 8 and position-ordered; itemCount still counts all", async () => {
    const fixture = await setup();
    const names = Array.from({ length: 10 }, (_, i) => `Zutat ${i}`);
    await addItems(
      fixture,
      names.map((name) => ({ name })),
    );

    const listed = await body<{
      items: Array<{
        id: string;
        itemCount: number;
        previewItems?: Array<{ name: string }>;
      }>;
    }>(await call(`/api/households/${fixture.householdId}/recipe/shopping-lists`, { cookie: fixture.owner.cookie }));
    const list = listed.items.find((l) => l.id === fixture.listId)!;
    expect(list.itemCount).toBe(10);
    expect(list.previewItems).toHaveLength(8);
    expect(list.previewItems?.map((item) => item.name)).toEqual(names.slice(0, 8));
  });
});

/* -------------------------------------------------------------------------- */
/* 10: catalog hiding                                                         */
/* -------------------------------------------------------------------------- */

describe("catalog hiding", () => {
  test("PATCH { hidden: true } removes it from the detail's catalog but keeps its useCount", async () => {
    const fixture = await setup();
    const checked = await checkOff(fixture, "Kapern");
    const entry = checked.catalog.find((e) => e.name === "Kapern")!;

    const hidden = await body<DetailPayload>(
      await call(`${base(fixture)}/catalog/${entry.id}`, {
        method: "PATCH",
        cookie: fixture.owner.cookie,
        body: { hidden: true },
      }),
    );
    expect(hidden.catalog.map((e) => e.name)).not.toContain("Kapern");

    const [row] = await db
      .select()
      .from(shoppingListCatalog)
      .where(eq(shoppingListCatalog.id, entry.id));
    expect(row?.useCount).toBe(1);
    expect(row?.hiddenAt).not.toBeNull();

    const unhidden = await body<DetailPayload>(
      await call(`${base(fixture)}/catalog/${entry.id}`, {
        method: "PATCH",
        cookie: fixture.owner.cookie,
        body: { hidden: false },
      }),
    );
    expect(unhidden.catalog.map((e) => e.name)).toContain("Kapern");
  });

  test("GET /catalog?includeHidden=1 lists a hidden entry with a non-null hiddenAt", async () => {
    const fixture = await setup();
    const checked = await checkOff(fixture, "Kapern");
    const entry = checked.catalog.find((e) => e.name === "Kapern")!;
    await call(`${base(fixture)}/catalog/${entry.id}`, {
      method: "PATCH",
      cookie: fixture.owner.cookie,
      body: { hidden: true },
    });

    const withoutHidden = await body<{ items: CatalogPayload[] }>(
      await call(`${base(fixture)}/catalog`, { cookie: fixture.owner.cookie }),
    );
    expect(withoutHidden.items.map((e) => e.name)).not.toContain("Kapern");

    const withHidden = await body<{ items: CatalogPayload[] }>(
      await call(`${base(fixture)}/catalog?includeHidden=1`, { cookie: fixture.owner.cookie }),
    );
    const hiddenEntry = withHidden.items.find((e) => e.name === "Kapern");
    expect(hiddenEntry?.hiddenAt).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 11: removing a recipe from the rail                                       */
/* -------------------------------------------------------------------------- */

describe("removing a recipe from the list", () => {
  test("exclusive lines go, shared lines stay with quantities unchanged, and the rail row disappears", async () => {
    const fixture = await setup();
    const suppe = await createRecipe(fixture, "Suppe", 4, [
      { name: "Möhren", quantity: 300, unit: "g" },
      { name: "Zwiebeln", quantity: 100, unit: "g" },
    ]);
    const eintopf = await createRecipe(fixture, "Eintopf", 4, [
      { name: "Möhren", quantity: 200, unit: "g" },
    ]);

    await call(`${base(fixture)}/recipes`, {
      method: "POST",
      cookie: fixture.owner.cookie,
      body: { recipeId: suppe, servings: 4 },
    });
    const afterBoth = await body<DetailPayload>(
      await call(`${base(fixture)}/recipes`, {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: { recipeId: eintopf, servings: 4 },
      }),
    );
    expect(findItem(afterBoth, "Möhren")).toMatchObject({ quantity: 500, unit: "g" });
    expect(afterBoth.recipes.map((r) => r.recipeId).sort()).toEqual([eintopf, suppe].sort());

    const afterRemove = await body<DetailPayload>(
      await call(`${base(fixture)}/recipes/${eintopf}`, {
        method: "DELETE",
        cookie: fixture.owner.cookie,
      }),
    );
    // Möhren is shared (Suppe + Eintopf): stays, quantity UNCHANGED.
    expect(findItem(afterRemove, "Möhren")).toMatchObject({ quantity: 500, unit: "g" });
    expect(findItem(afterRemove, "Möhren")?.sourceRecipeIds).toEqual([suppe]);
    // Zwiebeln came only from Suppe, untouched by removing Eintopf.
    expect(findItem(afterRemove, "Zwiebeln")).toMatchObject({ quantity: 100, unit: "g" });
    expect(afterRemove.recipes.map((r) => r.recipeId)).toEqual([suppe]);

    const joinRows = await db
      .select()
      .from(shoppingListRecipes)
      .where(eq(shoppingListRecipes.listId, fixture.listId));
    expect(joinRows.map((r) => r.recipeId)).toEqual([suppe]);

    // Idempotent: removing again is a 200 no-op, not a 404.
    const again = await call(`${base(fixture)}/recipes/${eintopf}`, {
      method: "DELETE",
      cookie: fixture.owner.cookie,
    });
    expect(again.status).toBe(200);
  });

  test("the rail reports live ingredientTotal and onListCount/sharedCount", async () => {
    const fixture = await setup();
    const recipeId = await createRecipe(fixture, "Salat", 2, [
      { name: "Gurke", quantity: 1 },
      { name: "Tomate", quantity: 2 },
    ]);
    const added = await body<DetailPayload>(
      await call(`${base(fixture)}/recipes`, {
        method: "POST",
        cookie: fixture.owner.cookie,
        body: { recipeId, servings: 2 },
      }),
    );
    const rail = added.recipes.find((r) => r.recipeId === recipeId)!;
    expect(rail).toMatchObject({ ingredientTotal: 2, onListCount: 2, sharedCount: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* 13: access control                                                        */
/* -------------------------------------------------------------------------- */

describe("access control on the new routes", () => {
  test("an outsider gets 403 on a new GET and a new write", async () => {
    const fixture = await setup();
    const checked = await checkOff(fixture, "Milch");
    const boughtId = checked.bought[0]!.id;

    const getResponse = await call(`${base(fixture)}/catalog`, { cookie: fixture.outsider.cookie });
    expect(getResponse.status).toBe(403);

    const writeResponse = await call(`${base(fixture)}/bought/${boughtId}/undo`, {
      method: "POST",
      cookie: fixture.outsider.cookie,
      body: {},
    });
    expect(writeResponse.status).toBe(403);
  });
});
