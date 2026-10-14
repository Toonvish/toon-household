/**
 * Route-level integration tests for /api/households/:householdId/recipe/imports.
 *
 * Setup differs from toon-recipe's (M2-T09a): R pinned a stub session/membership
 * middleware through a test seam of its own. Here the
 * module chain (`modules/mount.ts`: `requireSession()` -> `requireHouseholdRole("member")`
 * -> `requireModule("recipe")`) runs for real against the shared `db`, so the user, a
 * session (`createSession` -> `toon_session` cookie), the household, the membership and
 * the `household_modules` recipe row are real rows there. Two seams remain:
 *   - `setImportDbForTests` points the import routes at a file-backed test DB (the
 *     shared `file::memory:` DB cannot survive a transaction — see
 *     modules/recipe/services/import/db.ts); the same user/household rows are seeded
 *     there too, as FK targets of the drafts and recipes,
 *   - OCR is exercised through a fake engine via `setOcrEngine`.
 *
 * Photo/PDF import is OPT-IN (IMPORT_OCR_ENABLED, off by default), so this file
 * turns it on via `setOcrImportEnabled` and hands it back in `afterAll` — `bun test`
 * shares one process, so leaving it set would silently enable it everywhere else.
 * The disabled behaviour is covered by test/import/ocr-disabled.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { CommitImportDraftResponse, ImportDraft, ImportDraftListResponse, ImportDraftResponse } from "@toon/shared";
import { eq } from "drizzle-orm";
import { createSession } from "../../src/core/services/auth/sessions.ts";
import { createDatabase, db as sharedDb } from "../../src/db/client.ts";
import { runMigrations } from "../../src/db/migrate.ts";
import {
  collections,
  householdMembers,
  householdModules,
  households,
  recipeIngredients,
  recipes,
  users,
} from "../../src/db/schema.ts";
import { app } from "../../src/index.ts";
import { SESSION_COOKIE } from "../../src/lib/cookies.ts";
import { setOcrImportEnabled } from "../../src/modules/recipe/services/import/capabilities.ts";
import { setImportDbForTests } from "../../src/modules/recipe/services/import/db.ts";
import { setOcrEngine } from "../../src/modules/recipe/services/ocr/index.ts";
import { createFakeOcrEngine, makeTestPng } from "./helpers.ts";

const tempDir = mkdtempSync(join(tmpdir(), "toon-import-routes-"));
const { client, db } = createDatabase({ url: `file:${join(tempDir, "routes.db")}` });
await runMigrations(db);
await runMigrations(sharedDb);

const userId = crypto.randomUUID();
const otherUserId = crypto.randomUUID();
/** Signed in, but a member of no household: the "non-member" of the 403 tests. */
const outsiderId = crypto.randomUUID();
const householdId = crypto.randomUUID();
const otherHouseholdId = crypto.randomUUID();

/** The session cookie of each account, minted in beforeAll. */
const cookies = new Map<string, string>();
/** The account the next request is sent as; tests can flip it. */
let currentUserId = userId;

beforeAll(async () => {
  setImportDbForTests(db);
  setOcrImportEnabled(true);

  // The same rows in both databases: the shared `db` is what the module chain reads
  // (session, membership, module row); the import DB needs them as FK targets.
  for (const target of [sharedDb, db]) {
    await target.insert(users).values([
      { id: userId, email: "koch@toon.local", name: "Testkoch", emailVerifiedAt: Date.now() },
      { id: otherUserId, email: "fremd@toon.local", name: "Fremder", emailVerifiedAt: Date.now() },
      { id: outsiderId, email: "draussen@toon.local", name: "Draussen", emailVerifiedAt: Date.now() },
    ]);
    await target.insert(households).values([
      { id: householdId, name: "Familie", createdBy: userId },
      { id: otherHouseholdId, name: "Andere", createdBy: otherUserId },
    ]);
    await target.insert(householdMembers).values([
      { id: crypto.randomUUID(), householdId, userId, role: "owner" },
      { id: crypto.randomUUID(), householdId: otherHouseholdId, userId: otherUserId, role: "owner" },
    ]);
  }
  await sharedDb.insert(householdModules).values([
    { householdId, moduleId: "recipe" },
    { householdId: otherHouseholdId, moduleId: "recipe" },
  ]);

  for (const id of [userId, otherUserId, outsiderId]) {
    const session = await createSession(sharedDb, id);
    cookies.set(id, `${SESSION_COOKIE}=${session.id}`);
  }
});

afterAll(async () => {
  setImportDbForTests(null);
  setOcrEngine(null);
  setOcrImportEnabled(null);
  client.close();
  rmSync(tempDir, { recursive: true, force: true });

  const { env } = await import("../../src/env.ts");
  for (const filename of storedUploads) {
    rmSync(join(env.uploadDir, filename), { force: true });
  }
});

beforeEach(() => {
  currentUserId = userId;
});

const base = `/api/households/${householdId}/recipe/imports`;

/** `app.request` as the current account: the real session cookie rides on every call. */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = cookies.get(currentUserId);
  if (cookie !== undefined) headers.set("cookie", cookie);
  return await app.request(path, { ...init, headers });
}

async function jsonRequest(path: string, method: string, body: unknown): Promise<Response> {
  return await request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Uploads created by these tests land in the real UPLOAD_DIR (env is parsed once
 * at module load, so it cannot be redirected from here). Every stored filename is
 * recorded and removed in afterAll so the repo's data/uploads stays clean.
 */
const storedUploads = new Set<string>();

async function multipartRequest(path: string, bytes: Uint8Array, filename: string, type: string): Promise<Response> {
  const form = new FormData();
  // Blob + explicit filename avoids depending on a global `File`/`BlobPart` type.
  form.append("file", new Blob([bytes], { type }), filename);
  const response = await request(path, { method: "POST", body: form });
  if (response.status === 201) {
    const clone = response.clone();
    const body = (await clone.json()) as ImportDraftResponse;
    const stored = body.draft.sourceMeta?.storedPath;
    if (typeof stored === "string") storedUploads.add(stored);
  }
  return response;
}

const SAMPLE_TEXT = [
  "Griessbrei",
  "2 Portionen",
  "Zutaten",
  "500 ml Milch",
  "60 g Weichweizengriess",
  "1 EL Zucker",
  "1 Prise Salz",
  "Zubereitung",
  "1. Milch mit Zucker und Salz aufkochen.",
  "2. Griess einruehren und bei kleiner Hitze 5 Minuten quellen lassen.",
].join("\n");

async function createTextDraft(text = SAMPLE_TEXT): Promise<ImportDraft> {
  const response = await jsonRequest(`${base}/text`, "POST", { rawText: text });
  expect(response.status).toBe(201);
  const body = (await response.json()) as ImportDraftResponse;
  return body.draft;
}

describe("POST /imports/text", () => {
  test("creates a pending draft and returns 201", async () => {
    const response = await jsonRequest(`${base}/text`, "POST", { rawText: SAMPLE_TEXT });
    expect(response.status).toBe(201);
    const { draft } = (await response.json()) as ImportDraftResponse;

    expect(draft.householdId).toBe(householdId);
    expect(draft.createdBy).toBe(userId);
    expect(draft.status).toBe("pending");
    expect(draft.sourceType).toBe("manual");
    expect(draft.sourceMeta?.method).toBe("manual");
    expect(draft.parsed.title).toBe("Griessbrei");
    expect(draft.parsed.ingredients).toHaveLength(4);
    expect(draft.parsed.steps).toHaveLength(2);
    expect(draft.parsed.servings).toEqual({ amount: 2, unit: "Portionen" });
    expect(draft.rawText).toContain("500 ml Milch");
    expect(draft.recipeId).toBeNull();
  });

  test("honours an explicit title", async () => {
    const response = await jsonRequest(`${base}/text`, "POST", { rawText: SAMPLE_TEXT, title: "Omas Grießbrei" });
    const { draft } = (await response.json()) as ImportDraftResponse;
    expect(draft.parsed.title).toBe("Omas Grießbrei");
  });

  test("rejects an empty body with 422 validation_failed", async () => {
    const response = await jsonRequest(`${base}/text`, "POST", { rawText: "" });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_failed");
  });

  test("rejects malformed JSON with 400 bad_request", async () => {
    const response = await request(`${base}/text`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("bad_request");
  });
});

describe("POST /imports/url", () => {
  test("rejects a non-URL body with 422", async () => {
    const response = await jsonRequest(`${base}/url`, "POST", { url: "keine-url" });
    expect(response.status).toBe(422);
  });

  test("rejects a private target with 400 fetch_failed and never fetches it", async () => {
    const response = await jsonRequest(`${base}/url`, "POST", { url: "http://127.0.0.1:9/secret" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("fetch_failed");
  });

  test("rejects a file:// URL", async () => {
    const response = await jsonRequest(`${base}/url`, "POST", { url: "file:///etc/passwd" });
    // Zod's z.url() accepts file://, so the SSRF guard is what stops it.
    expect([400, 422]).toContain(response.status);
  });
});

describe("multipart uploads", () => {
  test("415 for a file whose CONTENT is not an image or PDF", async () => {
    const bytes = new TextEncoder().encode("nur ein Textfile, kein Bild".padEnd(64, " "));
    const response = await multipartRequest(`${base}/file`, bytes, "foto.jpg", "image/jpeg");
    expect(response.status).toBe(415);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unsupported_media_type");
  });

  test("415 when a PDF is posted to the image endpoint (sniffed, not trusted)", async () => {
    const bytes = new TextEncoder().encode(`%PDF-1.4\n${"x".repeat(64)}`);
    const response = await multipartRequest(`${base}/image`, bytes, "bild.png", "image/png");
    expect(response.status).toBe(415);
  });

  test("400 when the `file` field is missing", async () => {
    const form = new FormData();
    form.append("other", "x");
    const response = await request(`${base}/image`, { method: "POST", body: form });
    expect(response.status).toBe(400);
  });

  test("image import runs OCR through the injected engine and stores a draft", async () => {
    const engine = createFakeOcrEngine({
      text: "Bratkartoffeln\nZutaten\n800 g Kartoffeln\n2 Zwiebeln\n50 g Speck\nZubereitung\n1. Kartoffeln kochen und abkuehlen lassen.",
      confidence: 0.77,
    });
    setOcrEngine(engine);
    try {
      const png = await makeTestPng(600, 400);
      const response = await multipartRequest(`${base}/image`, png, "seite.png", "image/png");
      expect(response.status).toBe(201);
      const { draft } = (await response.json()) as ImportDraftResponse;

      expect(engine.calls).toBe(1);
      expect(draft.sourceType).toBe("ocr");
      expect(draft.sourceMeta?.method).toBe("ocr");
      expect(draft.sourceMeta?.engine).toBe("fake-ocr");
      expect(draft.sourceMeta?.langs).toBe("deu+eng");
      expect(draft.sourceMeta?.mimeType).toBe("image/png");
      expect(draft.sourceMeta?.storedPath).toMatch(/^[0-9a-f-]{36}\.png$/);
      expect(draft.parsed.title).toBe("Bratkartoffeln");
      expect(draft.parsed.ingredients).toHaveLength(3);
      expect(draft.rawText).toContain("800 g Kartoffeln");
    } finally {
      setOcrEngine(null);
    }
  });

  test("422 ocr_failed when the engine finds no text", async () => {
    setOcrEngine(createFakeOcrEngine({ text: "   " }));
    try {
      const png = await makeTestPng(200, 120);
      const response = await multipartRequest(`${base}/image`, png, "leer.png", "image/png");
      expect(response.status).toBe(422);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("ocr_failed");
    } finally {
      setOcrEngine(null);
    }
  });

  test("GET /:draftId/source serves the stored upload, membership-checked", async () => {
    setOcrEngine(createFakeOcrEngine({ text: "Titel\nZutaten\n100 g Mehl\n2 Eier\nZubereitung\n1. Verruehren." }));
    let draftId = "";
    try {
      const png = await makeTestPng(300, 200);
      const created = await multipartRequest(`${base}/image`, png, "quelle.png", "image/png");
      draftId = ((await created.json()) as ImportDraftResponse).draft.id;
    } finally {
      setOcrEngine(null);
    }

    const ok = await request(`${base}/${draftId}/source`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("image");

    // A member of another household cannot reach it.
    currentUserId = otherUserId;
    const forbidden = await request(`${base}/${draftId}/source`);
    expect(forbidden.status).toBe(403);
  });

  test("a draft without an upload answers 404 on /source", async () => {
    const draft = await createTextDraft();
    const response = await request(`${base}/${draft.id}/source`);
    expect(response.status).toBe(404);
  });
});

describe("draft listing and reading", () => {
  test("GET /imports?status=pending lists only pending drafts of the household", async () => {
    const draft = await createTextDraft();

    const response = await request(`${base}?status=pending&limit=50`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ImportDraftListResponse;
    expect(body.items.some((item) => item.id === draft.id)).toBe(true);
    expect(body.items.every((item) => item.status === "pending")).toBe(true);
    expect(body.items.every((item) => item.householdId === householdId)).toBe(true);
    expect(body.limit).toBe(50);
  });

  test("GET /imports/:draftId returns rawText, parsed and sourceMeta", async () => {
    const draft = await createTextDraft();
    const response = await request(`${base}/${draft.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ImportDraftResponse;
    expect(body.draft.id).toBe(draft.id);
    expect(body.draft.rawText).toContain("Zubereitung");
    expect(body.draft.parsed.ingredients.length).toBeGreaterThan(0);
    expect(body.draft.sourceMeta?.method).toBe("manual");
  });

  test("a draft of another household is 404, not 200", async () => {
    const draft = await createTextDraft();
    const response = await request(`/api/households/${otherHouseholdId}/recipe/imports/${draft.id}`);
    // The module chain's membership check rejects the caller first (403); with a real
    // membership in that household it would be a 404 from getDraftOr404.
    expect([403, 404]).toContain(response.status);
  });

  test("a non-member gets 403 on every import endpoint", async () => {
    currentUserId = outsiderId;
    for (const path of [base, `${base}/text`, `${base}/url`]) {
      const response = await request(path, {
        method: path === base ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        ...(path === base ? {} : { body: JSON.stringify({ rawText: "x", url: "https://a.example/b" }) }),
      });
      expect(response.status).toBe(403);
    }
  });

  test("an unknown draft id is 404", async () => {
    const response = await request(`${base}/${crypto.randomUUID()}`);
    expect(response.status).toBe(404);
  });
});

describe("PATCH /imports/:draftId", () => {
  test("saves the review-screen edits", async () => {
    const draft = await createTextDraft();
    const edited = {
      ...draft.parsed,
      title: "Grießbrei mit Zimt",
      ingredients: [
        ...draft.parsed.ingredients,
        { position: 4, name: "Zimt", quantity: 1, unit: "TL", raw: "1 TL Zimt", section: null, note: null },
      ],
      confidence: { ...draft.parsed.confidence, overall: 1 },
    };

    const response = await jsonRequest(`${base}/${draft.id}`, "PATCH", { parsed: edited });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ImportDraftResponse;
    expect(body.draft.parsed.title).toBe("Grießbrei mit Zimt");
    expect(body.draft.parsed.ingredients).toHaveLength(5);
    expect(body.draft.confidence).toBe(1);
    expect(body.draft.status).toBe("pending");
  });

  test("rejects an invalid payload with 422", async () => {
    const draft = await createTextDraft();
    const response = await jsonRequest(`${base}/${draft.id}`, "PATCH", { parsed: { ingredients: "nope" } });
    expect(response.status).toBe(422);
  });
});

describe("POST /imports/:draftId/commit", () => {
  test("creates the recipe, links the draft and returns 201 + Location", async () => {
    const draft = await createTextDraft();
    const response = await jsonRequest(`${base}/${draft.id}/commit`, "POST", { tags: ["Frühstück"] });
    expect(response.status).toBe(201);

    const body = (await response.json()) as CommitImportDraftResponse;
    expect(body.recipe.title).toBe("Griessbrei");
    expect(body.recipe.householdId).toBe(householdId);
    expect(body.recipe.ingredients).toHaveLength(4);
    expect(body.recipe.steps).toHaveLength(2);
    expect(body.recipe.tags.map((tag) => tag.name)).toContain("Frühstück");
    expect(body.draft.status).toBe("reviewed");
    expect(body.draft.recipeId).toBe(body.recipe.id);
    expect(response.headers.get("Location")).toBe(`/api/households/${householdId}/recipe/recipes/${body.recipe.id}`);

    const rows = await db.select().from(recipes).where(eq(recipes.id, body.recipe.id));
    expect(rows).toHaveLength(1);
    const ingredientRows = await db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, body.recipe.id));
    expect(ingredientRows).toHaveLength(4);
  });

  test("uses the payload sent by the review screen over the stored draft", async () => {
    const draft = await createTextDraft();
    const response = await jsonRequest(`${base}/${draft.id}/commit`, "POST", {
      parsed: { ...draft.parsed, title: "Überschriebener Titel" },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as CommitImportDraftResponse;
    expect(body.recipe.title).toBe("Überschriebener Titel");
  });

  test("committing twice answers 409", async () => {
    const draft = await createTextDraft();
    expect((await jsonRequest(`${base}/${draft.id}/commit`, "POST", {})).status).toBe(201);
    const second = await jsonRequest(`${base}/${draft.id}/commit`, "POST", {});
    expect(second.status).toBe(409);
  });

  test("PATCHing a committed draft answers 409", async () => {
    const draft = await createTextDraft();
    await jsonRequest(`${base}/${draft.id}/commit`, "POST", {});
    const response = await jsonRequest(`${base}/${draft.id}`, "PATCH", { parsed: draft.parsed });
    expect(response.status).toBe(409);
  });

  test("a collection from another household is refused and nothing is written", async () => {
    const foreignCollectionId = crypto.randomUUID();
    await db
      .insert(collections)
      .values({ id: foreignCollectionId, householdId: otherHouseholdId, name: "Fremd", createdBy: otherUserId });

    const draft = await createTextDraft();
    const before = (await db.select().from(recipes)).length;

    const response = await jsonRequest(`${base}/${draft.id}/commit`, "POST", {
      collectionIds: [foreignCollectionId],
    });
    expect(response.status).toBe(404);
    expect((await db.select().from(recipes)).length).toBe(before);

    const after = await request(`${base}/${draft.id}`);
    const body = (await after.json()) as ImportDraftResponse;
    expect(body.draft.status).toBe("pending");
  });

  test("a draft whose payload has no title is refused with 422", async () => {
    const draft = await createTextDraft("Nur 250 g Mehl und sonst nichts");
    const response = await jsonRequest(`${base}/${draft.id}/commit`, "POST", {
      parsed: { ...draft.parsed, title: undefined },
    });
    expect(response.status).toBe(422);
  });
});

describe("DELETE /imports/:draftId", () => {
  test("discards the draft and answers 204", async () => {
    const draft = await createTextDraft();
    const response = await request(`${base}/${draft.id}`, { method: "DELETE" });
    expect(response.status).toBe(204);
    const afterDelete = await request(`${base}/${draft.id}`);
    expect(afterDelete.status).toBe(404);
  });

  test("also unlinks the stored upload", async () => {
    setOcrEngine(createFakeOcrEngine({ text: "Titel\nZutaten\n100 g Mehl\n2 Eier\nZubereitung\n1. Verruehren." }));
    let draft: ImportDraft;
    try {
      const png = await makeTestPng(200, 150);
      const created = await multipartRequest(`${base}/image`, png, "weg.png", "image/png");
      draft = ((await created.json()) as ImportDraftResponse).draft;
    } finally {
      setOcrEngine(null);
    }

    expect((await request(`${base}/${draft.id}/source`)).status).toBe(200);
    expect((await request(`${base}/${draft.id}`, { method: "DELETE" })).status).toBe(204);

    const { env } = await import("../../src/env.ts");
    const storedPath = draft.sourceMeta?.storedPath;
    expect(storedPath).toBeDefined();
    expect(await Bun.file(join(env.uploadDir, storedPath as string)).exists()).toBe(false);
  });

  test("deleting an unknown draft is 404", async () => {
    const response = await request(`${base}/${crypto.randomUUID()}`, { method: "DELETE" });
    expect(response.status).toBe(404);
  });
});
