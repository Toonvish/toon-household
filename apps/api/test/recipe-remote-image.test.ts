/**
 * Remote recipe images become local copies — `services/recipes/remoteImage.ts` on
 * every write path: recipe create and PATCH, the import commit, collection covers.
 *
 * The downloader is the real `downloadHeroImage` over a scripted `fetch` and a stub
 * DNS resolver (fully offline); a failing download keeps the remote URL. Stored
 * images are cleaned up.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { collections, importDrafts, recipes, sessions, users } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { app } from "../src/index.ts";
import { downloadHeroImage } from "../src/modules/recipe/services/import/url/image.ts";
import {
  localizeImageUrl,
  setRemoteImageDownloaderForTests,
} from "../src/modules/recipe/services/recipes/remoteImage.ts";
import { createResolver, makeTestPng } from "./import/helpers.ts";

await runMigrations(db);

const REMOTE = "https://img.example-cdn.test/rezepte/linsen.jpg";
const GONE = "https://img.example-cdn.test/rezepte/weg.jpg";
const PNG = await makeTestPng(64, 48);

/** Filenames written into UPLOAD_DIR by these tests. */
const stored = new Set<string>();
/** Every URL the downloader was asked for. */
let requested: string[] = [];

function installDownloader(): void {
  requested = [];
  const resolve = createResolver();
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === REMOTE) return new Response(PNG, { headers: { "Content-Type": "image/png" } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  setRemoteImageDownloaderForTests(async (url) => {
    requested.push(url);
    const image = await downloadHeroImage(url, { fetchImpl, resolve });
    if (image) stored.add(image.filename);
    return image;
  });
}

afterEach(() => setRemoteImageDownloaderForTests(null));
afterAll(() => {
  for (const filename of stored) {
    rmSync(join(env.uploadDir, filename), { force: true });
    rmSync(join(env.uploadDir, filename.replace(/\.[^.]+$/, ".thumb.webp")), { force: true });
  }
});

/* harness — duplicated per file rather than shared, per repo convention */

interface TestUser {
  id: string;
  cookie: string;
}

async function createUser(): Promise<TestUser> {
  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({ id, email: `bild.${id.slice(0, 8)}@toon.test`, name: "Bild", emailVerified: true });
  const sessionId = crypto.randomUUID().replaceAll("-", "");
  await db
    .insert(sessions)
    .values({ id: sessionId, userId: id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
  return { id, cookie: `toon_session=${sessionId}` };
}

async function call(path: string, cookie: string, method: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Cookie: cookie };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function createHousehold(user: TestUser): Promise<string> {
  const response = await call("/api/households", user.cookie, "POST", { name: "WG Bilder" });
  expect(response.status).toBe(201);
  return ((await response.json()) as { household: { id: string } }).household.id;
}

async function createRecipe(user: TestUser, householdId: string, imageUrl: string): Promise<string> {
  const response = await call(`/api/households/${householdId}/recipe/recipes`, user.cookie, "POST", {
    title: "Linsensuppe",
    imageUrl,
    ingredients: [],
    steps: [],
    tags: [],
    collectionIds: [],
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { recipe: { id: string } }).recipe.id;
}

async function storedImage(recipeId: string): Promise<string | null> {
  const [row] = await db.select({ url: recipes.imageUrl }).from(recipes).where(eq(recipes.id, recipeId));
  return row?.url ?? null;
}

function expectLocalCopy(value: string | null): void {
  expect(value).toMatch(/^\/uploads\/[0-9a-f-]+\.png$/);
  expect(existsSync(join(env.uploadDir, value!.slice("/uploads/".length)))).toBe(true);
}

describe("localizeImageUrl", () => {
  test("leaves our own uploads and empty values alone, reducing a signed upload to the bare path", async () => {
    installDownloader();
    expect(await localizeImageUrl(null)).toBeNull();
    expect(await localizeImageUrl(undefined)).toBeUndefined();
    expect(await localizeImageUrl("/uploads/abc.jpg?exp=1&sig=2")).toBe("/uploads/abc.jpg");
    expect(requested).toEqual([]);
  });

  test("keeps the remote URL when the download fails, and does not retry an unchanged one", async () => {
    installDownloader();
    expect(await localizeImageUrl(GONE)).toBe(GONE);
    expect(await localizeImageUrl(GONE, GONE)).toBe(GONE);
    expect(requested).toEqual([GONE]);
  });

  test("never touches the network under bun test without an installed downloader", async () => {
    expect(await localizeImageUrl(REMOTE)).toBe(REMOTE);
  });
});

describe("recipe writes", () => {
  test("a recipe created with a remote image URL stores a local copy", async () => {
    installDownloader();
    const user = await createUser();
    const householdId = await createHousehold(user);
    const recipeId = await createRecipe(user, householdId, REMOTE);

    expectLocalCopy(await storedImage(recipeId));
    expect(requested).toEqual([REMOTE]);
  });

  test("a PATCH to a remote image URL stores a local copy; an unreachable one is kept as is", async () => {
    installDownloader();
    const user = await createUser();
    const householdId = await createHousehold(user);
    const recipeId = await createRecipe(user, householdId, GONE);
    expect(await storedImage(recipeId)).toBe(GONE);

    // An unrelated save sends the unchanged remote URL back: no second download.
    const path = `/api/households/${householdId}/recipe/recipes/${recipeId}`;
    expect((await call(path, user.cookie, "PATCH", { imageUrl: GONE, title: "Linsen" })).status).toBe(200);
    expect(requested).toEqual([GONE]);

    expect((await call(path, user.cookie, "PATCH", { imageUrl: REMOTE })).status).toBe(200);
    expectLocalCopy(await storedImage(recipeId));
  });

  test("committing an import draft whose hero image is still remote stores a local copy", async () => {
    installDownloader();
    const user = await createUser();
    const householdId = await createHousehold(user);
    const draftId = crypto.randomUUID();
    const now = Date.now();
    await db.insert(importDrafts).values({
      id: draftId,
      householdId,
      createdBy: user.id,
      status: "pending",
      sourceType: "manual",
      rawText: "Linsensuppe",
      parsed: {
        title: "Linsensuppe",
        imageUrl: REMOTE,
        ingredients: [],
        steps: [{ position: 0, text: "Kochen." }],
        tags: [],
        confidence: { overall: 0.5 },
      } as never,
      confidence: 0.5,
      sourceMeta: { method: "text" } as never,
      createdAt: now,
      updatedAt: now,
    });

    const response = await call(
      `/api/households/${householdId}/recipe/imports/${draftId}/commit`,
      user.cookie,
      "POST",
      {},
    );
    expect(response.status).toBe(201);
    const { recipe } = (await response.json()) as { recipe: { id: string; imageUrl: string } };
    expectLocalCopy(await storedImage(recipe.id));
    expect(recipe.imageUrl).toContain("/uploads/");
  });

  test("a collection cover given as a remote URL stores a local copy", async () => {
    installDownloader();
    const user = await createUser();
    const householdId = await createHousehold(user);
    const response = await call(`/api/households/${householdId}/recipe/collections`, user.cookie, "POST", {
      name: "Suppen",
      coverImageUrl: REMOTE,
    });
    expect(response.status).toBe(201);
    const { collection } = (await response.json()) as { collection: { id: string } };
    const [row] = await db
      .select({ url: collections.coverImageUrl })
      .from(collections)
      .where(eq(collections.id, collection.id));
    expectLocalCopy(row?.url ?? null);
  });
});
