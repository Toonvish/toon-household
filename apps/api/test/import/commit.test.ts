/**
 * Draft -> recipe commit, against an in-memory libSQL database.
 *
 * The important assertion is TRANSACTIONALITY: when the collection check (which
 * deliberately runs last, inside the transaction) fails, the recipe and all of
 * its children must be gone again.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../src/db/client.ts";
import { runMigrations } from "../../src/db/migrate.ts";
import {
  collectionRecipes,
  collections,
  householdMembers,
  households,
  importDrafts,
  recipeIngredients,
  recipeSteps,
  recipeTags,
  recipes,
  tags,
  users,
} from "../../src/db/schema.ts";
import { ApiError } from "../../src/lib/errors.ts";
import { commitDraft, countRecipes } from "../../src/modules/recipe/services/import/commit.ts";
import { createDraft, getDraftOr404, listDrafts, toDraftWire, updateDraft } from "../../src/modules/recipe/services/import/drafts.ts";
import { parseRecipeText } from "../../src/modules/recipe/services/import/ocr/index.ts";
import { extractRecipeFromHtml } from "../../src/modules/recipe/services/import/url/index.ts";
import { expectApiError, fixture } from "./helpers.ts";

/**
 * A FILE-backed database on purpose: @libsql/client 0.17.4 discarded a
 * `file::memory:` database as soon as a transaction committed (0.18.0 no longer
 * does; kept as a regression guard), and `commitDraft`
 * is transactional. See src/modules/recipe/services/import/db.ts for the full note.
 */
const tempDir = mkdtempSync(join(tmpdir(), "toon-import-commit-"));
const { client, db } = createDatabase({ url: `file:${join(tempDir, "test.db")}` });
await runMigrations(db);

afterAll(() => {
  client.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const userId = crypto.randomUUID();
let householdId = "";
let otherHouseholdId = "";

beforeEach(async () => {
  // Fresh household per test so counts are unambiguous; users are reused.
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId, email: `${crypto.randomUUID()}@toon.local`, name: "Testkoch" });

  householdId = crypto.randomUUID();
  otherHouseholdId = crypto.randomUUID();
  await db.insert(households).values([
    { id: householdId, name: "Familie", createdBy: userId },
    { id: otherHouseholdId, name: "Fremde Gruppe", createdBy: userId },
  ]);
  await db.insert(householdMembers).values({ id: crypto.randomUUID(), householdId, userId, role: "owner" });
});

/** The parsed payload of the chefkoch fixture — a realistic commit input. */
function chefkochParsed() {
  return extractRecipeFromHtml(fixture("chefkoch-jsonld.html"), {
    url: "https://www.chefkoch.de/rezepte/1/x.html",
  }).parsed;
}

async function seedDraft(parsed = chefkochParsed()) {
  return await createDraft(db, {
    householdId,
    createdBy: userId,
    sourceType: "url",
    parsed,
    rawText: "roher Text",
    sourceUrl: "https://www.chefkoch.de/rezepte/1/x.html",
    sourceMeta: { method: "json-ld", host: "chefkoch.de" },
  });
}

describe("draft repository", () => {
  test("createDraft stores a pending draft and mirrors the confidence", async () => {
    const draft = await seedDraft();
    expect(draft.status).toBe("pending");
    expect(draft.sourceType).toBe("url");
    expect(draft.confidence).toBe(draft.parsed.confidence.overall);
    expect(draft.rawText).toBe("roher Text");
    expect(draft.recipeId).toBeNull();
    expect(draft.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("getDraftOr404 refuses a draft from another household", async () => {
    const draft = await seedDraft();
    await expect(getDraftOr404(db, otherHouseholdId, draft.id)).rejects.toThrow(ApiError);
    await expect(getDraftOr404(db, householdId, crypto.randomUUID())).rejects.toThrow(ApiError);
  });

  test("listDrafts filters by status and paginates", async () => {
    const first = await seedDraft();
    await seedDraft();
    await updateDraft(db, first.id, { status: "reviewed" });

    const pending = await listDrafts(db, householdId, { status: "pending", limit: 10, offset: 0 });
    expect(pending.total).toBe(1);
    expect(pending.items).toHaveLength(1);

    const all = await listDrafts(db, householdId, { limit: 1, offset: 0 });
    expect(all.total).toBe(2);
    expect(all.items).toHaveLength(1);
    expect(all.limit).toBe(1);
  });

  test("toDraftWire survives a corrupt parsed column instead of throwing", async () => {
    const draft = await seedDraft();
    await db
      .update(importDrafts)
      .set({ parsed: { nonsense: true } as never })
      .where(eq(importDrafts.id, draft.id));
    const row = await getDraftOr404(db, householdId, draft.id);
    const wire = toDraftWire(row);
    expect(wire.parsed.ingredients).toEqual([]);
    expect(wire.parsed.confidence.overall).toBe(0);
  });

  test("updateDraft keeps confidence in sync with the edited payload", async () => {
    const draft = await seedDraft();
    const edited = { ...draft.parsed, title: "Neuer Titel", confidence: { overall: 0.42 } };
    await updateDraft(db, draft.id, { parsed: edited });
    const row = await getDraftOr404(db, householdId, draft.id);
    expect(row.confidence).toBe(0.42);
    expect(toDraftWire(row).parsed.title).toBe("Neuer Titel");
  });
});

describe("commitDraft — happy path", () => {
  test("writes the recipe with all children and marks the draft reviewed", async () => {
    const draft = await seedDraft();
    const result = await commitDraft(db, {
      householdId,
      draftId: draft.id,
      userId,
      parsed: draft.parsed,
    });

    const recipeRows = await db.select().from(recipes).where(eq(recipes.id, result.recipeId));
    expect(recipeRows).toHaveLength(1);
    expect(recipeRows[0]).toMatchObject({
      householdId,
      title: "Klassische Pfannkuchen",
      servingsAmount: 4,
      servingsUnit: "Portionen",
      prepMinutes: 20,
      cookMinutes: 45,
      totalMinutes: 65,
      difficulty: "einfach",
      createdBy: userId,
      language: "de",
    });

    const ingredientRows = await db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, result.recipeId));
    expect(ingredientRows).toHaveLength(8);
    expect(ingredientRows.map((row) => row.position).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ingredientRows.find((row) => row.name === "Mehl")).toMatchObject({
      quantity: 250,
      unit: "g",
      section: "Für den Teig",
      raw: "250 g Mehl",
    });

    const stepRows = await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, result.recipeId));
    expect(stepRows).toHaveLength(4);

    const tagLinks = await db.select().from(recipeTags).where(eq(recipeTags.recipeId, result.recipeId));
    expect(tagLinks.length).toBeGreaterThan(0);

    const draftRow = await getDraftOr404(db, householdId, draft.id);
    expect(draftRow.status).toBe("reviewed");
    expect(draftRow.recipeId).toBe(result.recipeId);
  });

  test("the returned RecipeDetail matches the contract shape", async () => {
    const draft = await seedDraft();
    const { recipe } = await commitDraft(db, { householdId, draftId: draft.id, userId, parsed: draft.parsed });

    expect(recipe.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(recipe.ingredients).toHaveLength(8);
    expect(recipe.steps).toHaveLength(4);
    expect(recipe.author).toMatchObject({ id: userId, name: "Testkoch" });
    expect(recipe.collectionIds).toEqual([]);
    expect(recipe.createdAt).toBe(recipe.updatedAt);
    for (const ingredient of recipe.ingredients) {
      expect(ingredient.recipeId).toBe(recipe.id);
      expect(typeof ingredient.id).toBe("string");
    }
  });

  test("reuses an existing household tag case-insensitively instead of duplicating it", async () => {
    const existingTagId = crypto.randomUUID();
    await db.insert(tags).values({ id: existingTagId, householdId, name: "Vegetarisch", color: "#22c55e" });

    const draft = await seedDraft();
    const result = await commitDraft(db, {
      householdId,
      draftId: draft.id,
      userId,
      parsed: { ...draft.parsed, tags: ["vegetarisch"] },
      tagNames: ["VEGETARISCH", "Neuer Tag"],
    });

    const householdTags = await db.select().from(tags).where(eq(tags.householdId, householdId));
    const vegetarian = householdTags.filter((tag) => tag.name.toLowerCase() === "vegetarisch");
    expect(vegetarian).toHaveLength(1);
    expect(vegetarian[0]?.id).toBe(existingTagId);
    expect(householdTags.map((tag) => tag.name)).toContain("Neuer Tag");

    const links = await db.select().from(recipeTags).where(eq(recipeTags.recipeId, result.recipeId));
    expect(links).toHaveLength(2);
  });

  test("links the recipe into collections of the same household", async () => {
    const collectionId = crypto.randomUUID();
    await db.insert(collections).values({ id: collectionId, householdId, name: "Lieblingsrezepte", createdBy: userId });

    const draft = await seedDraft();
    const result = await commitDraft(db, {
      householdId,
      draftId: draft.id,
      userId,
      parsed: draft.parsed,
      collectionIds: [collectionId],
    });

    const links = await db.select().from(collectionRecipes).where(eq(collectionRecipes.recipeId, result.recipeId));
    expect(links).toHaveLength(1);
    expect(links[0]?.collectionId).toBe(collectionId);
    expect(result.recipe.collectionIds).toEqual([collectionId]);
  });

  test("commits an OCR draft too (no title from the URL layer)", async () => {
    const parsed = parseRecipeText(fixture("ocr-zwiebelkuchen.txt"), { source: "ocr", ocrConfidence: 0.8 });
    const draft = await createDraft(db, { householdId, createdBy: userId, sourceType: "ocr", parsed });
    const result = await commitDraft(db, { householdId, draftId: draft.id, userId, parsed });

    const rows = await db.select().from(recipes).where(eq(recipes.id, result.recipeId));
    expect(rows[0]?.title).toBe("Schwäbischer Zwiebelkuchen");
    const ingredientRows = await db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, result.recipeId));
    expect(ingredientRows).toHaveLength(12);
  });
});

describe("commitDraft — validation", () => {
  test("refuses a draft without a title", async () => {
    const draft = await seedDraft();
    const error = await expectApiError(
      commitDraft(db, { householdId, draftId: draft.id, userId, parsed: { ...draft.parsed, title: undefined } }),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe("validation_failed");
    expect(await countRecipes(db, householdId)).toBe(0);
  });

  test("refuses a draft with neither ingredients nor steps", async () => {
    const draft = await seedDraft();
    const promise = commitDraft(db, {
      householdId,
      draftId: draft.id,
      userId,
      parsed: { ...draft.parsed, ingredients: [], steps: [] },
    });
    await expect(promise).rejects.toThrow(ApiError);
    expect(await countRecipes(db, householdId)).toBe(0);
  });
});

describe("commitDraft — TRANSACTIONALITY", () => {
  test("a collection from ANOTHER household rolls the whole recipe back", async () => {
    const foreignCollectionId = crypto.randomUUID();
    await db
      .insert(collections)
      .values({ id: foreignCollectionId, householdId: otherHouseholdId, name: "Fremd", createdBy: userId });

    const draft = await seedDraft();
    const before = await countRecipes(db, householdId);
    expect(before).toBe(0);

    const error = await expectApiError(
      commitDraft(db, {
        householdId,
        draftId: draft.id,
        userId,
        parsed: draft.parsed,
        collectionIds: [foreignCollectionId],
      }),
    );
    expect(error.status).toBe(404);

    // Nothing may survive: not the recipe, not its children, not the tag links.
    expect(await countRecipes(db, householdId)).toBe(0);
    expect(await db.select().from(recipeIngredients)).toHaveLength(0);
    expect(await db.select().from(recipeSteps)).toHaveLength(0);
    expect(await db.select().from(recipeTags)).toHaveLength(0);
    expect(await db.select().from(collectionRecipes)).toHaveLength(0);

    // The draft must still be committable after the failure.
    const draftRow = await getDraftOr404(db, householdId, draft.id);
    expect(draftRow.status).toBe("pending");
    expect(draftRow.recipeId).toBeNull();
  });

  test("tags created inside the failed transaction are rolled back too", async () => {
    const foreignCollectionId = crypto.randomUUID();
    await db
      .insert(collections)
      .values({ id: foreignCollectionId, householdId: otherHouseholdId, name: "Fremd", createdBy: userId });

    const draft = await seedDraft();
    await commitDraft(db, {
      householdId,
      draftId: draft.id,
      userId,
      parsed: draft.parsed,
      tagNames: ["Rollback-Tag"],
      collectionIds: [foreignCollectionId],
    }).catch(() => undefined);

    const householdTags = await db.select().from(tags).where(eq(tags.householdId, householdId));
    expect(householdTags.map((tag) => tag.name)).not.toContain("Rollback-Tag");
  });

  test("a retry after the rollback succeeds cleanly", async () => {
    const foreignCollectionId = crypto.randomUUID();
    await db
      .insert(collections)
      .values({ id: foreignCollectionId, householdId: otherHouseholdId, name: "Fremd", createdBy: userId });

    const draft = await seedDraft();
    await commitDraft(db, {
      householdId,
      draftId: draft.id,
      userId,
      parsed: draft.parsed,
      collectionIds: [foreignCollectionId],
    }).catch(() => undefined);

    const result = await commitDraft(db, { householdId, draftId: draft.id, userId, parsed: draft.parsed });
    expect(await countRecipes(db, householdId)).toBe(1);
    const draftRow = await getDraftOr404(db, householdId, draft.id);
    expect(draftRow.recipeId).toBe(result.recipeId);
  });

  test("deleting the household cascades the committed recipe away", async () => {
    const draft = await seedDraft();
    await commitDraft(db, { householdId, draftId: draft.id, userId, parsed: draft.parsed });
    expect(await countRecipes(db, householdId)).toBe(1);

    await client.execute({ sql: "delete from households where id = ?", args: [householdId] });
    expect(await countRecipes(db, householdId)).toBe(0);
    expect(await db.select().from(importDrafts).where(eq(importDrafts.householdId, householdId))).toHaveLength(0);
  });
});
