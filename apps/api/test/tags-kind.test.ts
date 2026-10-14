/**
 * Tags gain a `kind: 'course' | 'free'` dimension (D5) — `services/recipes/
 * tags.service.ts` (`createTag`/`updateTag`/`getOrCreateTagIds`),
 * `services/recipes/recipes.service.ts` (`replaceTags`/`replaceCourse`) and
 * `routes/recipes.ts`'s `course` field.
 *
 * WHAT THIS FILE PINS:
 *   - a tag created with no `kind` defaults to `free`.
 *   - `tags` (the free-form field) never touches the recipe's course link, so
 *     `PATCH { tags: [...] }` from the recipe form cannot silently drop the
 *     category.
 *   - `getOrCreateTagIds` never flips the kind of a tag it merely FOUND — an old
 *     client sending the course name inside `tags` (no `course` field at all)
 *     must not demote or promote an existing tag.
 */
import { describe, expect, test } from "bun:test";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { sessions, users } from "../src/db/schema.ts";
import { app } from "../src/index.ts";

await runMigrations(db);

interface TestUser {
  id: string;
  cookie: string;
}

async function createUser(): Promise<TestUser> {
  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({ id, email: `tagskind.${id.slice(0, 8)}@toon.test`, name: "Taggerin", emailVerified: true });
  const sessionId = crypto.randomUUID().replaceAll("-", "");
  await db
    .insert(sessions)
    .values({ id: sessionId, userId: id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
  return { id, cookie: `toon_session=${sessionId}` };
}

async function call(path: string, options: { method?: string; cookie?: string; body?: unknown } = {}): Promise<Response> {
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
  const payload = await body<{ household: { id: string } }>(response);
  return payload.household.id;
}

interface TagPayload {
  id: string;
  name: string;
  kind: "course" | "free";
  recipeCount?: number;
}

async function createTag(
  user: TestUser,
  householdId: string,
  input: { name: string; kind?: "course" | "free" },
): Promise<TagPayload> {
  const response = await call(`/api/households/${householdId}/recipe/tags`, { method: "POST", cookie: user.cookie, body: input });
  expect(response.status).toBe(201);
  const payload = await body<{ tag: TagPayload }>(response);
  return payload.tag;
}

async function listTags(user: TestUser, householdId: string): Promise<TagPayload[]> {
  const response = await call(`/api/households/${householdId}/recipe/tags`, { cookie: user.cookie });
  const payload = await body<{ items: TagPayload[] }>(response);
  return payload.items;
}

interface RecipePayload {
  id: string;
  tags: TagPayload[];
}

async function createRecipe(
  user: TestUser,
  householdId: string,
  input: { title: string; course?: string | null; tags?: string[] },
): Promise<RecipePayload> {
  const response = await call(`/api/households/${householdId}/recipe/recipes`, {
    method: "POST",
    cookie: user.cookie,
    body: {
      title: input.title,
      course: input.course,
      ingredients: [],
      steps: [{ text: "Alles verrühren und backen." }],
      tags: input.tags ?? [],
      collectionIds: [],
    },
  });
  expect(response.status).toBe(201);
  const payload = await body<{ recipe: RecipePayload }>(response);
  return payload.recipe;
}

async function patchRecipe(
  user: TestUser,
  householdId: string,
  recipeId: string,
  input: { course?: string | null; tags?: string[] },
): Promise<RecipePayload> {
  const response = await call(`/api/households/${householdId}/recipe/recipes/${recipeId}`, {
    method: "PATCH",
    cookie: user.cookie,
    body: input,
  });
  expect(response.status).toBe(200);
  const payload = await body<{ recipe: RecipePayload }>(response);
  return payload.recipe;
}

describe("tag kind defaults and creation", () => {
  test("a tag created with no kind is free", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Frei");
    const tag = await createTag(user, householdId, { name: "Sommer" });
    expect(tag.kind).toBe("free");
  });

  test("POST /tags {kind:'course'} creates a course tag", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Kurs");
    const tag = await createTag(user, householdId, { name: "Hauptspeise", kind: "course" });
    expect(tag.kind).toBe("course");
  });

  test("PATCH /tags/:id promotes an existing free tag to course", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Beförderung");
    const tag = await createTag(user, householdId, { name: "Beilage" });
    expect(tag.kind).toBe("free");

    const response = await call(`/api/households/${householdId}/recipe/tags/${tag.id}`, {
      method: "PATCH",
      cookie: user.cookie,
      body: { kind: "course" },
    });
    expect(response.status).toBe(200);
    const payload = await body<{ tag: TagPayload }>(response);
    expect(payload.tag.kind).toBe("course");
  });
});

describe("a recipe's course and free tags", () => {
  test("POST /recipes {course, tags} creates one tag of each kind and links both", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Anlegen");
    const recipe = await createRecipe(user, householdId, { title: "Schokokuchen", course: "Dessert", tags: ["Backen"] });

    const dessert = recipe.tags.find((tag) => tag.name === "Dessert");
    const backen = recipe.tags.find((tag) => tag.name === "Backen");
    expect(dessert?.kind).toBe("course");
    expect(backen?.kind).toBe("free");

    const groupTags = await listTags(user, householdId);
    expect(groupTags.find((tag) => tag.name === "Dessert")?.kind).toBe("course");
    expect(groupTags.find((tag) => tag.name === "Backen")?.kind).toBe("free");
  });

  test("PATCH {tags:[...]} keeps the course link", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Behalten");
    const recipe = await createRecipe(user, householdId, { title: "Auflauf", course: "Auflauf", tags: ["Herzhaft"] });

    const patched = await patchRecipe(user, householdId, recipe.id, { tags: ["Sommer"] });
    expect(patched.tags.map((tag) => tag.name).sort()).toEqual(["Auflauf", "Sommer"]);
    expect(patched.tags.find((tag) => tag.name === "Auflauf")?.kind).toBe("course");
    expect(patched.tags.find((tag) => tag.name === "Sommer")?.kind).toBe("free");
  });

  test("PATCH {course:null} unlinks the course and leaves the tag row", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Entfernen");
    const recipe = await createRecipe(user, householdId, { title: "Suppe", course: "Suppe" });

    const patched = await patchRecipe(user, householdId, recipe.id, { course: null });
    expect(patched.tags.find((tag) => tag.name === "Suppe")).toBeUndefined();

    const groupTags = await listTags(user, householdId);
    expect(groupTags.find((tag) => tag.name === "Suppe")).toBeDefined();
  });

  test("GET /tags returns kind and recipeCount in one response", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Zählen");
    await createRecipe(user, householdId, { title: "Erstes", course: "Hauptspeise" });
    await createRecipe(user, householdId, { title: "Zweites", course: "Hauptspeise" });

    const groupTags = await listTags(user, householdId);
    const course = groupTags.find((tag) => tag.name === "Hauptspeise");
    expect(course?.kind).toBe("course");
    expect(course?.recipeCount).toBe(2);
  });

  test("an old-client shape (course name inside tags, no course field) links the existing course tag without flipping its kind", async () => {
    const user = await createUser();
    const householdId = await createGroup(user, "WG Alter Client");
    // First, a modern client establishes the course tag properly.
    await createRecipe(user, householdId, { title: "Modernes Rezept", course: "Beilage" });

    // Then an OLD client sends the course name inside `tags`, with no `course`
    // field at all — the recipe form before this feature shipped.
    const oldClientRecipe = await createRecipe(user, householdId, { title: "Altes Rezept", tags: ["Beilage"] });
    const beilage = oldClientRecipe.tags.find((tag) => tag.name === "Beilage");
    expect(beilage?.kind).toBe("course"); // linked, and NOT demoted to free.

    const groupTags = await listTags(user, householdId);
    expect(groupTags.filter((tag) => tag.name === "Beilage").length).toBe(1);
    expect(groupTags.find((tag) => tag.name === "Beilage")?.kind).toBe("course");
  });
});
