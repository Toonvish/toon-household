/**
 * The cross-household sweep (SPEC D8, plan M2 decision 12).
 *
 * User U belongs to household A only. Household B (recipe module enabled) belongs
 * to somebody else and owns one of everything that has an id: a recipe, a tag, a
 * collection, an import draft, a shopping list with an open item, a bought-log
 * row and a "Häufig gekauft" entry, a plan entry. With U's cookie, EVERY by-id
 * route of the five household routers (recipes+tags+collections, imports,
 * shopping-lists, plan) is addressed under `/api/households/A/recipe/…` with B's
 * ids and must answer `404 not_found`, never 200, never 403, never an empty 204:
 * the household comes from `:householdId` only and every lookup filters by it.
 *
 * Two variants where a route has a parent: the PARENT is B's too (a foreign id
 * in the path), and the parent is U's own while only the CHILD id (item, bought
 * row, catalog entry, recipe) is B's. The card router has no household at all,
 * so its guard is the owner: user V's card id with U's cookie answers 404.
 *
 * The routes are the ones of toon-recipe docs/API.md as ported to
 * modules/recipe/routes/*.ts; no route is invented. Left out because R has no
 * by-id route for them: `GET /tags` (list), `GET /plan/last-planned` (list).
 *
 * Users are verified and the verified-email gate is forced ON, so a 403
 * `email_unverified` could never be mistaken for the guard; the seam is handed
 * back in `afterAll` (`bun test` shares one process).
 */
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import {
  cards,
  collections,
  importDrafts,
  mealPlanEntries,
  recipes,
  sessions,
  shoppingLists,
  tags,
  users,
} from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { app } from "../src/index.ts";

/** Smallest valid PNG, so the image route's sniffer accepts it. */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/gEBjT4uAAAAAElFTkSuQmCC"),
  (char) => char.charCodeAt(0),
);

/* -------------------------------------------------------------------------- */
/* harness                                                                    */
/* -------------------------------------------------------------------------- */

interface TestUser {
  id: string;
  cookie: string;
}

async function createUser(name: string): Promise<TestUser> {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    email: `${name.toLowerCase()}.${id.slice(0, 8)}@toon.test`,
    name,
    emailVerified: true,
    emailVerifiedAt: Date.now(),
  });
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

async function json<T>(response: Response, expected: number): Promise<T> {
  expect(response.status).toBe(expected);
  return (await response.json()) as T;
}

async function createHousehold(owner: TestUser, name: string): Promise<string> {
  const created = await call("/api/households", { method: "POST", cookie: owner.cookie, body: { name } });
  return (await json<{ household: { id: string } }>(created, 201)).household.id;
}

interface Side {
  owner: TestUser;
  householdId: string;
  recipeId: string;
  tagId: string;
  collectionId: string;
  draftId: string;
  listId: string;
  itemId: string;
  boughtId: string;
  catalogId: string;
  planEntryId: string;
}

const PLAN_DAY = "2030-01-07";

/** One of everything with an id, created through the API (the draft through the db). */
async function seedHousehold(label: string): Promise<Side> {
  const owner = await createUser(`${label}owner`);
  const householdId = await createHousehold(owner, `${label} ${crypto.randomUUID().slice(0, 8)}`);
  const base = `/api/households/${householdId}/recipe`;
  const as = { cookie: owner.cookie };

  const recipe = await json<{ recipe: { id: string; ingredients: { id: string }[] } }>(
    await call(`${base}/recipes`, {
      method: "POST",
      ...as,
      body: {
        title: `Suppe ${label}`,
        servingsAmount: 2,
        servingsUnit: "Portionen",
        ingredients: [{ name: "Karotten", quantity: 2, unit: "Stück" }],
        steps: [{ text: "Kochen." }],
        tags: ["Schnell"],
      },
    }),
    201,
  );
  const recipeId = recipe.recipe.id;

  const tag = await json<{ items: { id: string }[] }>(await call(`${base}/tags`, as), 200);
  const tagId = tag.items[0]?.id;
  if (tagId === undefined) throw new Error("the seeded recipe produced no tag");

  const collection = await json<{ collection: { id: string } }>(
    await call(`${base}/collections`, { method: "POST", ...as, body: { name: `Sammlung ${label}` } }),
    201,
  );

  const draftId = crypto.randomUUID();
  const now = Date.now();
  await db.insert(importDrafts).values({
    id: draftId,
    householdId,
    createdBy: owner.id,
    status: "pending",
    sourceType: "manual",
    rawText: "Zwiebelkuchen",
    parsed: {
      title: "Zwiebelkuchen",
      ingredients: [],
      steps: [],
      tags: [],
      confidence: { overall: 0.5 },
    } as never,
    confidence: 0.5,
    sourceMeta: { method: "text" } as never,
    createdAt: now,
    updatedAt: now,
  });

  const list = await json<{ list: { id: string } }>(
    await call(`${base}/shopping-lists`, { method: "POST", ...as, body: { name: `Liste ${label}` } }),
    201,
  );
  const listId = list.list.id;
  const listBase = `${base}/shopping-lists/${listId}`;
  const withItems = await json<{ items: { id: string; name: string }[] }>(
    await call(`${listBase}/items`, {
      method: "POST",
      ...as,
      body: { items: [{ name: "Mehl", quantity: 500, unit: "g" }, { name: "Salz" }] },
    }),
    200,
  );
  const mehl = withItems.items.find((item) => item.name === "Mehl");
  const salz = withItems.items.find((item) => item.name === "Salz");
  if (!mehl || !salz) throw new Error("the seeded list lost its items");
  // Checking one off writes the bought-log row AND the "Häufig gekauft" entry.
  await json(await call(`${listBase}/items/${mehl.id}/check`, { method: "POST", ...as, body: {} }), 200);
  const detail = await json<{
    items: { id: string }[];
    bought: { id: string }[];
    catalog: { id: string }[];
  }>(await call(listBase, as), 200);
  const boughtId = detail.bought[0]?.id;
  const catalogId = detail.catalog[0]?.id;
  if (boughtId === undefined || catalogId === undefined) throw new Error("no bought row or catalog entry");

  const plan = await json<{ entry: { id: string } }>(
    await call(`${base}/plan`, { method: "POST", ...as, body: { recipeId, plannedOn: PLAN_DAY } }),
    201,
  );

  return {
    owner,
    householdId,
    recipeId,
    tagId,
    collectionId: collection.collection.id,
    draftId,
    listId,
    itemId: salz.id,
    boughtId,
    catalogId,
    planEntryId: plan.entry.id,
  };
}

/* -------------------------------------------------------------------------- */
/* fixture                                                                    */
/* -------------------------------------------------------------------------- */

let a: Side;
let b: Side;
let userV: TestUser;
let cardId: string;
let uploadsBefore: Set<string>;

beforeAll(async () => {
  await runMigrations(db);
  // The gate decides before the handler runs: with it ON and every user verified,
  // a 404 can only come from the household / owner scoping.
  setVerifiedEmailRequired(true);
  a = await seedHousehold("A");
  b = await seedHousehold("B");
  userV = await createUser("V");
  const saved = await json<{ card: { id: string } }>(
    await call("/api/recipe/cards", {
      method: "POST",
      cookie: userV.cookie,
      body: { label: "Payback", format: "ean13", value: "401234567890" },
    }),
    201,
  );
  cardId = saved.card.id;
  await mkUploadsSnapshot();
});

afterAll(async () => {
  setVerifiedEmailRequired(null);
  // The image route stores the upload BEFORE it looks the recipe up (it parses the
  // form first), so the refused requests leave files behind; remove exactly those.
  const after = await readdir(env.uploadDir).catch(() => [] as string[]);
  for (const name of after) {
    if (!uploadsBefore.has(name)) await unlink(join(env.uploadDir, name)).catch(() => undefined);
  }
});

async function mkUploadsSnapshot(): Promise<void> {
  uploadsBefore = new Set(await readdir(env.uploadDir).catch(() => [] as string[]));
}

/* -------------------------------------------------------------------------- */
/* the route list                                                             */
/* -------------------------------------------------------------------------- */

interface Probe {
  label: string;
  method: string;
  path: string;
  body?: unknown;
  /** Multipart body, for the image route. */
  form?: () => FormData;
  /**
   * Set only on the deliberately idempotent child routes (R: "Idempotent."): with U's OWN
   * list and a foreign child id the row is simply "already gone", so the answer is A's own
   * list detail (or 204) and nothing of B is read or written. The status they answer.
   */
  noOp?: number;
}

/** Every by-id route of the household routers, addressed in household A with B's ids. */
function householdProbes(): Probe[] {
  const base = `/api/households/${a.householdId}/recipe`;
  const ownList = `${base}/shopping-lists/${a.listId}`;
  const foreignList = `${base}/shopping-lists/${b.listId}`;
  const png = (): FormData => {
    const form = new FormData();
    form.append("file", new File([PNG], "foto.png", { type: "image/png" }));
    return form;
  };

  return [
    // recipes
    { label: "recipe GET", method: "GET", path: `${base}/recipes/${b.recipeId}` },
    { label: "recipe PATCH", method: "PATCH", path: `${base}/recipes/${b.recipeId}`, body: { title: "Geklaut" } },
    { label: "recipe DELETE", method: "DELETE", path: `${base}/recipes/${b.recipeId}` },
    { label: "recipe image POST", method: "POST", path: `${base}/recipes/${b.recipeId}/image`, form: png },
    { label: "recipe scale GET", method: "GET", path: `${base}/recipes/${b.recipeId}/scale?servings=4` },
    { label: "recipe cooked POST", method: "POST", path: `${base}/recipes/${b.recipeId}/cooked`, body: {} },
    { label: "recipe cooked DELETE", method: "DELETE", path: `${base}/recipes/${b.recipeId}/cooked` },
    // tags (U owns A, so the admin gate of DELETE passes and only the scoping can answer)
    { label: "tag PATCH", method: "PATCH", path: `${base}/tags/${b.tagId}`, body: { name: "Geklaut" } },
    { label: "tag DELETE", method: "DELETE", path: `${base}/tags/${b.tagId}` },
    // collections
    { label: "collection GET", method: "GET", path: `${base}/collections/${b.collectionId}` },
    { label: "collection PATCH", method: "PATCH", path: `${base}/collections/${b.collectionId}`, body: { name: "Geklaut" } },
    { label: "collection DELETE", method: "DELETE", path: `${base}/collections/${b.collectionId}` },
    { label: "collection create with B's recipe", method: "POST", path: `${base}/collections`, body: { name: "Mix", recipeIds: [b.recipeId] } },
    { label: "collection (B) + recipe (B) PUT", method: "PUT", path: `${base}/collections/${b.collectionId}/recipes/${b.recipeId}` },
    { label: "collection (B) + recipe (B) DELETE", method: "DELETE", path: `${base}/collections/${b.collectionId}/recipes/${b.recipeId}` },
    { label: "collection (A) + recipe (B) PUT", method: "PUT", path: `${base}/collections/${a.collectionId}/recipes/${b.recipeId}` },
    { label: "collection (B) + recipe (A) PUT", method: "PUT", path: `${base}/collections/${b.collectionId}/recipes/${a.recipeId}` },
    { label: "collection (B) + recipe (A) DELETE", method: "DELETE", path: `${base}/collections/${b.collectionId}/recipes/${a.recipeId}` },
    { label: "recipe PATCH with B's collection", method: "PATCH", path: `${base}/recipes/${a.recipeId}`, body: { collectionIds: [b.collectionId] } },
    // import drafts
    { label: "import draft GET", method: "GET", path: `${base}/imports/${b.draftId}` },
    { label: "import draft source GET", method: "GET", path: `${base}/imports/${b.draftId}/source` },
    {
      label: "import draft PATCH",
      method: "PATCH",
      path: `${base}/imports/${b.draftId}`,
      body: { parsed: { title: "Geklaut", ingredients: [], steps: [], tags: [], confidence: { overall: 0.5 } } },
    },
    { label: "import draft commit POST", method: "POST", path: `${base}/imports/${b.draftId}/commit`, body: {} },
    { label: "import draft DELETE", method: "DELETE", path: `${base}/imports/${b.draftId}` },
    // shopping lists, the parent is B's
    { label: "list GET", method: "GET", path: foreignList },
    { label: "list PATCH", method: "PATCH", path: foreignList, body: { name: "Geklaut" } },
    { label: "list DELETE", method: "DELETE", path: foreignList },
    { label: "list items POST", method: "POST", path: `${foreignList}/items`, body: { items: [{ name: "Spam" }] } },
    { label: "list items DELETE (empty)", method: "DELETE", path: `${foreignList}/items` },
    { label: "list item PATCH", method: "PATCH", path: `${foreignList}/items/${b.itemId}`, body: { name: "Spam" } },
    { label: "list item DELETE", method: "DELETE", path: `${foreignList}/items/${b.itemId}` },
    { label: "list item check POST", method: "POST", path: `${foreignList}/items/${b.itemId}/check`, body: {} },
    { label: "list bought clear POST", method: "POST", path: `${foreignList}/bought/clear` },
    { label: "list bought undo POST", method: "POST", path: `${foreignList}/bought/${b.boughtId}/undo`, body: {} },
    { label: "list recipes POST (B recipe)", method: "POST", path: `${foreignList}/recipes`, body: { recipeId: b.recipeId } },
    { label: "list recipes DELETE", method: "DELETE", path: `${foreignList}/recipes/${b.recipeId}` },
    { label: "list from-plan GET", method: "GET", path: `${foreignList}/from-plan?from=${PLAN_DAY}&to=${PLAN_DAY}` },
    { label: "list catalog GET", method: "GET", path: `${foreignList}/catalog` },
    { label: "list catalog PATCH", method: "PATCH", path: `${foreignList}/catalog/${b.catalogId}`, body: { hidden: true } },
    { label: "list catalog POST", method: "POST", path: `${foreignList}/catalog/${b.catalogId}`, body: {} },
    { label: "list catalog DELETE", method: "DELETE", path: `${foreignList}/catalog/${b.catalogId}` },
    // shopping lists, the parent is U's own and only the child id is B's
    { label: "own list + B recipe POST", method: "POST", path: `${ownList}/recipes`, body: { recipeId: b.recipeId } },
    { label: "own list + B item PATCH", method: "PATCH", path: `${ownList}/items/${b.itemId}`, body: { name: "Spam" } },
    { label: "own list + B item DELETE", method: "DELETE", path: `${ownList}/items/${b.itemId}`, noOp: 200 },
    { label: "own list + B item check POST", method: "POST", path: `${ownList}/items/${b.itemId}/check`, body: {}, noOp: 200 },
    { label: "own list + B bought undo POST", method: "POST", path: `${ownList}/bought/${b.boughtId}/undo`, body: {}, noOp: 200 },
    { label: "own list + B recipe DELETE", method: "DELETE", path: `${ownList}/recipes/${b.recipeId}`, noOp: 200 },
    { label: "own list + B catalog PATCH", method: "PATCH", path: `${ownList}/catalog/${b.catalogId}`, body: { hidden: true } },
    { label: "own list + B catalog POST", method: "POST", path: `${ownList}/catalog/${b.catalogId}`, body: {} },
    { label: "own list + B catalog DELETE", method: "DELETE", path: `${ownList}/catalog/${b.catalogId}`, noOp: 204 },
    // plan
    { label: "plan entry PATCH", method: "PATCH", path: `${base}/plan/${b.planEntryId}`, body: { servings: 9 } },
    { label: "plan entry DELETE", method: "DELETE", path: `${base}/plan/${b.planEntryId}` },
    { label: "plan create with B's recipe", method: "POST", path: `${base}/plan`, body: { recipeId: b.recipeId, plannedOn: PLAN_DAY } },
  ];
}

/** U's cookie against V's card, on the user-scoped router. */
function cardProbes(): Probe[] {
  return [
    { label: "card PATCH", method: "PATCH", path: `/api/recipe/cards/${cardId}`, body: { label: "Geklaut" } },
    { label: "card DELETE", method: "DELETE", path: `/api/recipe/cards/${cardId}` },
    { label: "card used POST", method: "POST", path: `/api/recipe/cards/${cardId}/used` },
  ];
}

async function send(probe: Probe, cookie: string): Promise<Response> {
  if (probe.form) {
    return app.request(probe.path, { method: probe.method, headers: { Cookie: cookie }, body: probe.form() });
  }
  return call(probe.path, { method: probe.method, cookie, body: probe.body });
}

async function outcome(probe: Probe, cookie: string): Promise<{ route: string; status: number; code: string }> {
  const response = await send(probe, cookie);
  const payload = response.status === 204 ? null : ((await response.json()) as { error?: { code?: string } });
  return {
    route: `${probe.label}: ${probe.method} ${probe.path}`,
    status: response.status,
    code: payload?.error?.code ?? "",
  };
}

/* -------------------------------------------------------------------------- */
/* tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("the fixture is real", () => {
  test("B's own owner reaches every id the sweep uses (so a 404 means the guard, not a typo)", async () => {
    const base = `/api/households/${b.householdId}/recipe`;
    const as = { cookie: b.owner.cookie };
    for (const path of [
      `${base}/recipes/${b.recipeId}`,
      `${base}/recipes/${b.recipeId}/scale?servings=4`,
      `${base}/collections/${b.collectionId}`,
      `${base}/imports/${b.draftId}`,
      `${base}/shopping-lists/${b.listId}`,
      `${base}/shopping-lists/${b.listId}/catalog`,
    ]) {
      const response = await call(path, as);
      expect({ path, status: response.status }).toEqual({ path, status: 200 });
    }
    const detail = await json<{
      items: { id: string }[];
      bought: { id: string }[];
      catalog: { id: string }[];
    }>(await call(`${base}/shopping-lists/${b.listId}`, as), 200);
    expect(detail.items.map((item) => item.id)).toContain(b.itemId);
    expect(detail.bought.map((row) => row.id)).toContain(b.boughtId);
    expect(detail.catalog.map((row) => row.id)).toContain(b.catalogId);
  });

  test("U is a member of A only, and A's ids work for U", async () => {
    const own = await call(`/api/households/${a.householdId}/recipe/recipes/${a.recipeId}`, {
      cookie: a.owner.cookie,
    });
    expect(own.status).toBe(200);
    const foreign = await call(`/api/households/${b.householdId}/recipe/recipes/${b.recipeId}`, {
      cookie: a.owner.cookie,
    });
    expect(foreign.status).toBe(403);
  });
});

describe("every by-id recipe route refuses another household's id", () => {
  test("404 not_found for all of them", async () => {
    const probes = householdProbes().filter((probe) => probe.noOp === undefined);
    expect(probes.length).toBeGreaterThanOrEqual(45);
    const results = [];
    for (const probe of probes) results.push(await outcome(probe, a.owner.cookie));
    expect(results).toEqual(
      results.map(({ route }) => ({ route, status: 404, code: "not_found" })),
    );
  });

  test("the idempotent child routes are no-ops for a foreign child id and leak nothing", async () => {
    const probes = householdProbes().filter((probe) => probe.noOp !== undefined);
    expect(probes).toHaveLength(5);
    const foreignIds = [b.itemId, b.boughtId, b.catalogId, b.recipeId, b.listId];
    for (const probe of probes) {
      const response = await send(probe, a.owner.cookie);
      const text = await response.text();
      expect({ route: probe.label, status: response.status }).toEqual({
        route: probe.label,
        status: probe.noOp as number,
      });
      for (const id of foreignIds) expect(text).not.toContain(id);
    }
  });

  test("covers every by-id route of the five household routers", async () => {
    // Guards the list above against a router growing a route nobody sweeps: every
    // by-id (`:param`) route of the ported routers is named by at least one probe.
    const source = await Promise.all(
      ["recipes", "imports", "shopping", "plan"].map((name) =>
        Bun.file(join(import.meta.dir, "..", "src", "modules", "recipe", "routes", `${name}.ts`)).text(),
      ),
    );
    const declared = source
      .flatMap((text) =>
        [...text.matchAll(/Routes\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)].map(
          (match) => `${(match[1] ?? "").toUpperCase()} ${match[2] ?? ""}`,
        ),
      )
      .filter((route) => route.includes(":"));

    const probes = householdProbes();
    const swept = (route: string): boolean => {
      const [method, pattern] = route.split(" ") as [string, string];
      const shape = new RegExp(
        `^${pattern.replace(/:[A-Za-z]+/g, "[^/?]+").replace(/\//g, "\\/")}$`,
      );
      return probes.some((probe) => {
        if (probe.method !== method) return false;
        // Strip the household prefix and the router mount (recipes/tags/collections
        // are mounted at "/", the others under their own segment) and the query.
        const tail = probe.path.split("?")[0]!.replace(/^\/api\/households\/[^/]+\/recipe/, "");
        const segments = tail.split("/").filter(Boolean);
        const candidates = [tail, `/${segments.slice(1).join("/")}`];
        return candidates.some((candidate) => shape.test(candidate));
      });
    };
    const missing = declared.filter((route) => !swept(route));
    expect(missing).toEqual([]);
    expect(declared.length).toBeGreaterThanOrEqual(36);
  });

  test("none of the refused requests changed anything of B", async () => {
    const base = `/api/households/${b.householdId}/recipe`;
    const as = { cookie: b.owner.cookie };

    const recipe = await json<{ recipe: { title: string; imageUrl: string | null } }>(
      await call(`${base}/recipes/${b.recipeId}`, as),
      200,
    );
    expect(recipe.recipe.title).toBe("Suppe B");
    expect(recipe.recipe.imageUrl).toBeNull();

    expect((await db.select().from(tags).where(eq(tags.id, b.tagId)))[0]?.name).toBe("Schnell");
    const collection = (await db.select().from(collections).where(eq(collections.id, b.collectionId)))[0];
    expect(collection?.name).toBe("Sammlung B");
    expect(await db.select().from(importDrafts).where(eq(importDrafts.id, b.draftId))).toHaveLength(1);
    expect((await db.select().from(shoppingLists).where(eq(shoppingLists.id, b.listId)))[0]?.name).toBe("Liste B");
    const entry = (await db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, b.planEntryId)))[0];
    expect(entry).toBeDefined();
    expect(entry?.servings).not.toBe(9);

    const detail = await json<{
      items: { id: string; name: string }[];
      bought: { id: string }[];
      catalog: { id: string; hiddenAt: string | null }[];
    }>(await call(`${base}/shopping-lists/${b.listId}`, as), 200);
    expect(detail.items.map((item) => item.name)).toEqual(["Salz"]);
    expect(detail.bought.map((row) => row.id)).toEqual([b.boughtId]);
    expect(detail.catalog.find((row) => row.id === b.catalogId)?.hiddenAt).toBeNull();
    expect(await db.select().from(recipes).where(eq(recipes.id, b.recipeId))).toHaveLength(1);
  });

  test("a recipe of B cannot be planned, shelved or listed in A either", async () => {
    // The "create with a foreign id" variants wrote nothing on A's side.
    const base = `/api/households/${a.householdId}/recipe`;
    const as = { cookie: a.owner.cookie };
    const plan = await json<{ items: { recipeId: string }[] }>(
      await call(`${base}/plan?from=${PLAN_DAY}&to=${PLAN_DAY}`, as),
      200,
    );
    expect(plan.items.map((item) => item.recipeId)).toEqual([a.recipeId]);
    const shelves = await json<{ items: { name: string }[] }>(await call(`${base}/collections`, as), 200);
    expect(shelves.items.map((item) => item.name)).toEqual(["Sammlung A"]);
    const detail = await json<{ recipes: unknown[] }>(
      await call(`${base}/shopping-lists/${a.listId}`, as),
      200,
    );
    expect(detail.recipes).toEqual([]);
  });
});

describe("every card route refuses another user's card", () => {
  test("404 not_found with U's cookie on V's card", async () => {
    const results = [];
    for (const probe of cardProbes()) results.push(await outcome(probe, a.owner.cookie));
    expect(results).toEqual(results.map(({ route }) => ({ route, status: 404, code: "not_found" })));
  });

  test("V's card is untouched, and V still reaches it", async () => {
    const rows = await db.select().from(cards).where(eq(cards.id, cardId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(userV.id);
    expect(rows[0]?.label).toBe("Payback");
    expect(rows[0]?.lastUsedAt ?? null).toBeNull();

    const used = await call(`/api/recipe/cards/${cardId}/used`, { method: "POST", cookie: userV.cookie });
    expect(used.status).toBe(200);
  });
});
