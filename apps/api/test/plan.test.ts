/**
 * Integration tests for the meal planner — `apps/api/src/routes/plan.ts` +
 * `services/plan/plan.service.ts`.
 *
 * WHAT THIS FILE PINS, beyond the usual CRUD:
 *   - `plannedOn` never touches `toIso()` — a calendar date on the wire stays a
 *     calendar date, verbatim, both ways (see the `meal_plan_entries` comment in
 *     `db/schema.ts`).
 *   - POST is idempotent through the `(household_id, planned_on, recipe_id)` unique
 *     index, not a `mutationId` ledger — planner writes are online-only.
 *   - the day cap and the "move onto an already-planned day" collision are both
 *     409s that never silently merge or drop data.
 *   - the range read comes off `recipe_meal_plan_entries_household_date_idx` with no temp
 *     b-tree — the same shape as `test/recipes-search.test.ts`'s title-sort test.
 */
import { PLAN_LIMITS } from "@toon/shared";
import { afterAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { households, mealPlanEntries, recipes, sessions, users } from "../src/db/schema.ts";
import { app } from "../src/index.ts";
import { explain } from "./support/explain.ts";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";

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
    .values({ id, email: `plan.${id.slice(0, 8)}@toon.test`, name: "Planer", emailVerified: true });
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
  locale?: string;
}

async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.locale) headers["Accept-Language"] = options.locale;
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
  const payload = await body<{ household: { id: string } }>(response);
  return payload.household.id;
}

async function createRecipe(user: TestUser, householdId: string, title: string): Promise<string> {
  const response = await call(`/api/households/${householdId}/recipe/recipes`, {
    method: "POST",
    cookie: user.cookie,
    body: {
      title,
      ingredients: [],
      steps: [{ text: "Alles verrühren und backen." }],
      tags: [],
      collectionIds: [],
    },
  });
  expect(response.status).toBe(201);
  const payload = await body<{ recipe: { id: string } }>(response);
  return payload.recipe.id;
}

interface PlanEntryPayload {
  id: string;
  householdId: string;
  recipeId: string;
  plannedOn: string;
  position: number;
  servings: number | null;
  cookedAt: string | null;
  recipe: { id: string; title: string; thumbnailUrl: string | null };
}

async function planEntry(
  user: TestUser,
  householdId: string,
  input: { recipeId: string; plannedOn: string; servings?: number },
): Promise<Response> {
  return call(`/api/households/${householdId}/recipe/plan`, { method: "POST", cookie: user.cookie, body: input });
}

async function planRange(
  user: TestUser,
  householdId: string,
  from: string,
  to: string,
): Promise<Response> {
  return call(`/api/households/${householdId}/recipe/plan?from=${from}&to=${to}`, { cookie: user.cookie });
}

/* -------------------------------------------------------------------------- */
/* POST /plan                                                                 */
/* -------------------------------------------------------------------------- */

describe("POST /plan", () => {
  test("creates an entry, plannedOn verbatim, with the slim recipe card", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Süd");
    const recipeId = await createRecipe(user, householdId, "Linsensuppe");

    const response = await planEntry(user, householdId, { recipeId, plannedOn: "2026-09-10" });
    expect(response.status).toBe(201);
    const { entry } = await body<{ entry: PlanEntryPayload }>(response);

    // Verbatim: not an ISO instant ("2026-09-10T00:00:00.000Z" would be the bug).
    expect(entry.plannedOn).toBe("2026-09-10");
    expect(entry.householdId).toBe(householdId);
    expect(entry.recipeId).toBe(recipeId);
    expect(entry.position).toBe(0);
    expect(entry.cookedAt).toBeNull();
    expect(entry.recipe.id).toBe(recipeId);
    expect(entry.recipe.title).toBe("Linsensuppe");
    // No image was uploaded, so the derived thumbnail is null — the shape (not
    // `imageUrl`) is the point.
    expect(entry.recipe.thumbnailUrl).toBeNull();

    const response2 = await call(`/api/households/${householdId}/recipe/plan`, { method: "POST" });
    expect(response2.status).toBe(401); // sanity: the router really is gated.
  });

  test("an EXTERNAL hero image reaches the slim recipe card as its thumbnail", async () => {
    // A URL import keeps the site's picture; there is no local derivative, and this
    // DTO has no `imageUrl` to fall back to — a null here is a blank square on /plan
    // and in "Aus dem Wochenplan".
    const user = await createUser();
    const householdId = await createGroup(user, "WG Bild");
    const imageUrl = "https://img.chefkoch-cdn.de/rezepte/1234/bilder/linsen.jpg";
    const created = await call(`/api/households/${householdId}/recipe/recipes`, {
      method: "POST",
      cookie: user.cookie,
      body: { title: "Linsensuppe", imageUrl, ingredients: [], steps: [], tags: [], collectionIds: [] },
    });
    expect(created.status).toBe(201);
    const { recipe } = await body<{ recipe: { id: string } }>(created);

    const response = await planEntry(user, householdId, { recipeId: recipe.id, plannedOn: "2026-09-10" });
    expect(response.status).toBe(201);
    const { entry } = await body<{ entry: PlanEntryPayload }>(response);
    expect(entry.recipe.thumbnailUrl).toBe(imageUrl);
  });

  test("is idempotent: a second POST for the same day+recipe returns 200, one row, new servings applied", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Idempotent");
    const recipeId = await createRecipe(user, householdId, "Chili sin Carne");

    const first = await planEntry(user, householdId, { recipeId, plannedOn: "2026-09-11", servings: 2 });
    expect(first.status).toBe(201);
    const { entry: firstEntry } = await body<{ entry: PlanEntryPayload }>(first);

    const second = await planEntry(user, householdId, { recipeId, plannedOn: "2026-09-11", servings: 4 });
    expect(second.status).toBe(200);
    const { entry: secondEntry } = await body<{ entry: PlanEntryPayload }>(second);

    expect(secondEntry.id).toBe(firstEntry.id);
    expect(secondEntry.servings).toBe(4);

    const rows = await db
      .select()
      .from(mealPlanEntries)
      .where(
        and(
          eq(mealPlanEntries.householdId, householdId),
          eq(mealPlanEntries.plannedOn, "2026-09-11"),
          eq(mealPlanEntries.recipeId, recipeId),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]?.servings).toBe(4);
  });

  test(`409 meal_plan_day_full once a day already holds ${PLAN_LIMITS.entriesPerDay} entries, in both locales`, async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Voll");
    const day = "2026-09-12";

    for (let index = 0; index < PLAN_LIMITS.entriesPerDay; index += 1) {
      const recipeId = await createRecipe(user, householdId, `Rezept ${index}`);
      const response = await planEntry(user, householdId, { recipeId, plannedOn: day });
      expect(response.status).toBe(201);
    }

    const overflowRecipeId = await createRecipe(user, householdId, "Der Tropfen zu viel");

    const german = await call(`/api/households/${householdId}/recipe/plan`, {
      method: "POST",
      cookie: user.cookie,
      locale: "de-DE",
      body: { recipeId: overflowRecipeId, plannedOn: day },
    });
    expect(german.status).toBe(409);
    const germanPayload = await body<{ error: { code: string; message: string } }>(german);
    expect(germanPayload.error.code).toBe("meal_plan_day_full");
    expect(germanPayload.error.message).toContain("Rezepte möglich");

    const english = await call(`/api/households/${householdId}/recipe/plan`, {
      method: "POST",
      cookie: user.cookie,
      locale: "en-GB",
      body: { recipeId: overflowRecipeId, plannedOn: day },
    });
    expect(english.status).toBe(409);
    const englishPayload = await body<{ error: { code: string; message: string } }>(english);
    expect(englishPayload.error.code).toBe("meal_plan_day_full");
    expect(englishPayload.error.message).toContain("planned for one day");
  });

  test("404 for a recipe outside the household, and the body never names the other household", async () => {
    const user = await createUser();
    const ownGroupId = await createGroup(user, "WG Eigen");
    const otherGroupId = await createGroup(user, "WG Fremd");
    const foreignRecipeId = await createRecipe(user, otherGroupId, "Fremdes Rezept");

    const response = await planEntry(user, ownGroupId, {
      recipeId: foreignRecipeId,
      plannedOn: "2026-09-13",
    });
    expect(response.status).toBe(404);
    const payload = await body<{ error: { code: string; message: string; details?: unknown } }>(
      response,
    );
    expect(payload.error.code).toBe("not_found");
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain(otherGroupId);
  });
});

/* -------------------------------------------------------------------------- */
/* GET /plan                                                                  */
/* -------------------------------------------------------------------------- */

describe("GET /plan", () => {
  test("is flat, ordered by (plannedOn, position); a day with nothing planned is simply absent", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Woche");
    const monday = await createRecipe(user, householdId, "Montagsgericht");
    const wednesdayA = await createRecipe(user, householdId, "Mittwoch A");
    const wednesdayB = await createRecipe(user, householdId, "Mittwoch B");

    await planEntry(user, householdId, { recipeId: monday, plannedOn: "2026-09-14" });
    // Tuesday (2026-09-15) is deliberately left empty.
    await planEntry(user, householdId, { recipeId: wednesdayA, plannedOn: "2026-09-16" });
    await planEntry(user, householdId, { recipeId: wednesdayB, plannedOn: "2026-09-16" });

    const response = await planRange(user, householdId, "2026-09-14", "2026-09-16");
    expect(response.status).toBe(200);
    const payload = await body<{ from: string; to: string; items: PlanEntryPayload[] }>(response);
    expect(payload.from).toBe("2026-09-14");
    expect(payload.to).toBe("2026-09-16");
    expect(payload.items.map((item) => [item.plannedOn, item.recipe.title])).toEqual([
      ["2026-09-14", "Montagsgericht"],
      ["2026-09-16", "Mittwoch A"],
      ["2026-09-16", "Mittwoch B"],
    ]);
  });

  test("422 when to < from", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Verkehrt");
    const response = await planRange(user, householdId, "2026-09-20", "2026-09-10");
    expect(response.status).toBe(422);
  });

  test(`422 when the range is >= ${PLAN_LIMITS.rangeDays} days`, async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Lang");
    const response = await planRange(user, householdId, "2026-01-01", "2026-12-31");
    expect(response.status).toBe(422);
  });

  test("422 for a date that does not exist", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Unmöglich");
    const response = await planRange(user, householdId, "2026-02-31", "2026-03-01");
    expect(response.status).toBe(422);
  });
});

describe("GET /plan/last-planned", () => {
  test("latest day per recipe strictly before `before`; never-planned recipes are absent", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Gedächtnis");
    const often = await createRecipe(user, householdId, "Oft geplant");
    const future = await createRecipe(user, householdId, "Nur später");
    await createRecipe(user, householdId, "Nie geplant");

    await planEntry(user, householdId, { recipeId: often, plannedOn: "2025-12-30" });
    await planEntry(user, householdId, { recipeId: often, plannedOn: "2026-09-02" });
    // ON the day being planned and after it: neither counts as "last planned".
    await planEntry(user, householdId, { recipeId: often, plannedOn: "2026-09-16" });
    await planEntry(user, householdId, { recipeId: future, plannedOn: "2026-09-20" });

    const response = await call(`/api/households/${householdId}/recipe/plan/last-planned?before=2026-09-16`, {
      cookie: user.cookie,
    });
    expect(response.status).toBe(200);
    const payload = await body<{ before: string; items: Array<{ recipeId: string; plannedOn: string }> }>(
      response,
    );
    expect(payload.before).toBe("2026-09-16");
    expect(payload.items).toEqual([{ recipeId: often, plannedOn: "2026-09-02" }]);
  });

  test("never reads another household's plan", async () => {
    const user = await createUser();
    const mine = await createGroup(user, "WG Meins");
    const theirs = await createGroup(user, "WG Deins");
    const recipe = await createRecipe(user, theirs, "Fremdes Rezept");
    await planEntry(user, theirs, { recipeId: recipe, plannedOn: "2026-09-01" });

    const response = await call(`/api/households/${mine}/recipe/plan/last-planned?before=2026-09-16`, {
      cookie: user.cookie,
    });
    expect((await body<{ items: unknown[] }>(response)).items).toEqual([]);
  });

  test("422 for a malformed or missing date", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Kaputt");
    for (const query of ["?before=2026-02-31", ""]) {
      const response = await call(`/api/households/${householdId}/recipe/plan/last-planned${query}`, { cookie: user.cookie });
      expect(response.status).toBe(422);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* PATCH /plan/:entryId                                                       */
/* -------------------------------------------------------------------------- */

describe("PATCH /plan/:entryId", () => {
  test("moving plannedOn re-tails position on the target day", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Umzug");
    const recipeX = await createRecipe(user, householdId, "Rezept X");
    const recipeY = await createRecipe(user, householdId, "Rezept Y");
    const recipeZ = await createRecipe(user, householdId, "Rezept Z");

    const dayA = "2026-09-21";
    const dayB = "2026-09-22";

    await planEntry(user, householdId, { recipeId: recipeX, plannedOn: dayA }); // position 0
    const entryYResponse = await planEntry(user, householdId, { recipeId: recipeY, plannedOn: dayA }); // position 1
    const { entry: entryY } = await body<{ entry: PlanEntryPayload }>(entryYResponse);
    await planEntry(user, householdId, { recipeId: recipeZ, plannedOn: dayB }); // position 0 on day B

    const moved = await call(`/api/households/${householdId}/recipe/plan/${entryY.id}`, {
      method: "PATCH",
      cookie: user.cookie,
      body: { plannedOn: dayB },
    });
    expect(moved.status).toBe(200);
    const { entry: movedEntry } = await body<{ entry: PlanEntryPayload }>(moved);
    expect(movedEntry.plannedOn).toBe(dayB);
    // Tails after recipeZ's position 0 — it must not keep day A's position 1 by
    // coincidence, nor collide with it.
    expect(movedEntry.position).toBe(1);

    // Day A now holds only recipeX.
    const range = await planRange(user, householdId, dayA, dayB);
    const payload = await body<{ items: PlanEntryPayload[] }>(range);
    expect(payload.items.map((item) => item.recipe.title)).toEqual(["Rezept X", "Rezept Z", "Rezept Y"]);
  });

  test("409 conflict when moving onto a day that already holds the same recipe", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Kollision");
    const recipeId = await createRecipe(user, householdId, "Doppelt geplant");

    const dayA = "2026-09-23";
    const dayB = "2026-09-24";
    const onDayAResponse = await planEntry(user, householdId, { recipeId, plannedOn: dayA });
    const { entry: onDayA } = await body<{ entry: PlanEntryPayload }>(onDayAResponse);
    await planEntry(user, householdId, { recipeId, plannedOn: dayB });

    const response = await call(`/api/households/${householdId}/recipe/plan/${onDayA.id}`, {
      method: "PATCH",
      cookie: user.cookie,
      body: { plannedOn: dayB },
    });
    expect(response.status).toBe(409);
    const payload = await body<{ error: { code: string } }>(response);
    expect(payload.error.code).toBe("conflict");

    // The collision must not have silently merged the two entries.
    const rows = await db
      .select()
      .from(mealPlanEntries)
      .where(and(eq(mealPlanEntries.householdId, householdId), eq(mealPlanEntries.recipeId, recipeId)));
    expect(rows.length).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* DELETE /plan/:entryId                                                      */
/* -------------------------------------------------------------------------- */

describe("DELETE /plan/:entryId", () => {
  test("204s and removes the row", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Löschen");
    const recipeId = await createRecipe(user, householdId, "Entfernt mich");
    const created = await planEntry(user, householdId, { recipeId, plannedOn: "2026-09-25" });
    const { entry } = await body<{ entry: PlanEntryPayload }>(created);

    const response = await call(`/api/households/${householdId}/recipe/plan/${entry.id}`, {
      method: "DELETE",
      cookie: user.cookie,
    });
    expect(response.status).toBe(204);

    const rows = await db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, entry.id));
    expect(rows.length).toBe(0);
  });

  test("404 for an entry id from another household", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG A");
    const otherGroupId = await createGroup(user, "WG B");
    const recipeId = await createRecipe(user, otherGroupId, "Woanders geplant");
    const created = await planEntry(user, otherGroupId, { recipeId, plannedOn: "2026-09-26" });
    const { entry } = await body<{ entry: PlanEntryPayload }>(created);

    const response = await call(`/api/households/${householdId}/recipe/plan/${entry.id}`, {
      method: "DELETE",
      cookie: user.cookie,
    });
    expect(response.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* the verified-email gate                                                    */
/* -------------------------------------------------------------------------- */

describe("the verified-email gate", () => {
  afterAll(() => {
    // Process-wide override — bun test runs every file in one process, so a
    // leaked seam would 403 (or silently NOT 403) every write in every later
    // file. Same rule as setMailer/setOcrImportEnabled (CLAUDE.md).
    setVerifiedEmailRequired(null);
  });

  test("blocks POST/PATCH/DELETE for an unconfirmed account and lets GET through", async () => {
    const user = await createUser(); // emailVerifiedAt stays NULL — unconfirmed.
    const householdId = await createGroup(user, "WG Unbestätigt");
    const recipeId = await createRecipe(user, householdId, "Gesperrt");

    setVerifiedEmailRequired(true);

    const post = await planEntry(user, householdId, { recipeId, plannedOn: "2026-09-27" });
    expect(post.status).toBe(403);
    expect((await body<{ error: { code: string } }>(post)).error.code).toBe("email_unverified");

    const get = await planRange(user, householdId, "2026-09-01", "2026-09-30");
    expect(get.status).toBe(200);

    setVerifiedEmailRequired(false);
    const createdWhileOff = await planEntry(user, householdId, { recipeId, plannedOn: "2026-09-27" });
    expect(createdWhileOff.status).toBe(201);
    const { entry } = await body<{ entry: PlanEntryPayload }>(createdWhileOff);

    setVerifiedEmailRequired(true);
    const patch = await call(`/api/households/${householdId}/recipe/plan/${entry.id}`, {
      method: "PATCH",
      cookie: user.cookie,
      body: { servings: 3 },
    });
    expect(patch.status).toBe(403);

    const del = await call(`/api/households/${householdId}/recipe/plan/${entry.id}`, {
      method: "DELETE",
      cookie: user.cookie,
    });
    expect(del.status).toBe(403);
  });
});

/* -------------------------------------------------------------------------- */
/* cascades                                                                   */
/* -------------------------------------------------------------------------- */

describe("cascades", () => {
  test("deleting the recipe removes its plan entries", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Rezept löschen");
    const recipeId = await createRecipe(user, householdId, "Wird gelöscht");
    await planEntry(user, householdId, { recipeId, plannedOn: "2026-09-28" });

    const response = await call(`/api/households/${householdId}/recipe/recipes/${recipeId}`, {
      method: "DELETE",
      cookie: user.cookie,
    });
    expect(response.status).toBe(204);

    const rows = await db.select().from(mealPlanEntries).where(eq(mealPlanEntries.recipeId, recipeId));
    expect(rows.length).toBe(0);
  });

  test("deleting the household removes all its plan entries", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Gruppe löschen");
    const recipeId = await createRecipe(user, householdId, "Verschwindet mit");
    await planEntry(user, householdId, { recipeId, plannedOn: "2026-09-29" });

    const response = await call(`/api/households/${householdId}`, { method: "DELETE", cookie: user.cookie });
    expect(response.status).toBe(204);

    const rows = await db.select().from(mealPlanEntries).where(eq(mealPlanEntries.householdId, householdId));
    expect(rows.length).toBe(0);
    const groupRows = await db.select().from(households).where(eq(households.id, householdId));
    expect(groupRows.length).toBe(0);
    const recipeRows = await db.select().from(recipes).where(eq(recipes.id, recipeId));
    expect(recipeRows.length).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* index usage                                                                */
/* -------------------------------------------------------------------------- */

describe("the range read", () => {
  test("uses recipe_meal_plan_entries_household_date_idx, not a temp b-tree", async () => {
    const plan = await explain(
      "explain query plan select * from recipe_meal_plan_entries where household_id = 'x' " +
        "and planned_on >= '2026-01-01' and planned_on <= '2026-01-31' " +
        "order by planned_on asc, position asc",
    );
    const detail = plan.rows.map((row) => String(row.detail)).join(" | ");
    expect(detail).toContain("recipe_meal_plan_entries_household_date_idx");
    expect(detail).not.toContain("TEMP B-TREE");
  });
});
