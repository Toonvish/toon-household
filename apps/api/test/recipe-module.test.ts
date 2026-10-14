/**
 * The recipe module's API foundation (plan M2-T03): the prefixed schema and its
 * generated migration, the `afterMigrate` fold backfill, the household cascade, the
 * upload-reference collection behind `uploads:gc`, and the health capability flags.
 *
 * DDL is read through `@libsql/client` (`sqlite_master`), never `bun:sqlite` — a newer
 * SQLite than the one the app runs on (toon-recipe CLAUDE.md).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { collectUploadReferences, filenameOf } from "../src/core/services/media/references.ts";
import { createDatabase } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import {
  collections,
  households,
  importDrafts,
  recipeIngredients,
  recipes,
  users,
} from "../src/db/schema.ts";
import { signUploadUrl } from "../src/lib/uploadUrls.ts";
import { API_MODULES } from "../src/modules/index.ts";
import { recipeModule } from "../src/modules/recipe/index.ts";
import { backfillFoldedColumns } from "../src/modules/recipe/migrate.ts";
import { recipeTables } from "../src/modules/recipe/schema.ts";
import {
  setOcrImportEnabled,
  setPdfImportEnabled,
} from "../src/modules/recipe/services/import/capabilities.ts";

const { client, db } = createDatabase({ url: "file::memory:" });
await runMigrations(db);

afterAll(() => {
  setOcrImportEnabled(null);
  setPdfImportEnabled(null);
  client.close();
});

const RECIPE_TABLES = [
  "recipe_cards",
  "recipe_collection_recipes",
  "recipe_collections",
  "recipe_import_drafts",
  "recipe_meal_plan_entries",
  "recipe_recipe_cook_log",
  "recipe_recipe_ingredients",
  "recipe_recipe_steps",
  "recipe_recipe_tags",
  "recipe_recipes",
  "recipe_shopping_bought_items",
  "recipe_shopping_list_catalog",
  "recipe_shopping_list_items",
  "recipe_shopping_list_recipes",
  "recipe_shopping_lists",
  "recipe_shopping_mutations",
  "recipe_tags",
];

async function names(type: "table" | "index"): Promise<string[]> {
  const result = await client.execute({
    sql: "select name from sqlite_master where type = ? and name not like 'sqlite_%' order by name",
    args: [type],
  });
  return result.rows.map((row) => String(row.name));
}

async function createHousehold(label: string): Promise<{ userId: string; householdId: string }> {
  const userId = crypto.randomUUID();
  const householdId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${label}@toon.local`, name: label });
  await db.insert(households).values({ id: householdId, name: label, createdBy: userId });
  return { userId, householdId };
}

describe("manifest", () => {
  test("is registered and declares its 17 prefixed tables", () => {
    // The registry holds both modules since M3; finance-module.test.ts checks its manifest.
    expect(API_MODULES.map((module) => module.id)).toEqual(["recipe", "finance"]);
    expect(recipeModule.id).toBe("recipe");
    expect(recipeModule.householdRouter).toBeDefined();
    expect(recipeModule.userRouter).toBeDefined();
    expect(Object.keys(recipeTables)).toHaveLength(17);
    expect(Object.keys(recipeModule.schema)).toEqual(Object.keys(recipeTables));
  });
});

describe("(a) migration", () => {
  test("creates the 17 recipe_ tables and no unprefixed recipe table", async () => {
    const tables = await names("table");
    expect(tables.filter((name) => name.startsWith("recipe_"))).toEqual(RECIPE_TABLES);
    for (const unprefixed of [
      "recipes",
      "tags",
      "cards",
      "collections",
      "shopping_lists",
      "import_drafts",
      "meal_plan_entries",
    ]) {
      expect(tables).not.toContain(unprefixed);
    }
  });

  test("every recipe index carries the prefix and no `group` survives", async () => {
    const indexes = await names("index");
    const onRecipeTables = await client.execute(
      "select name, tbl_name from sqlite_master where type = 'index' and tbl_name like 'recipe_%' and name not like 'sqlite_%'",
    );
    expect(onRecipeTables.rows.length).toBeGreaterThan(0);
    for (const row of onRecipeTables.rows) {
      expect(String(row.name).startsWith("recipe_")).toBe(true);
    }
    expect(indexes.filter((name) => name.includes("group"))).toEqual([]);
  });

  test("the fold columns are NOT NULL without a SQL default (decision 5)", async () => {
    const recipeColumns = await client.execute("PRAGMA table_info(recipe_recipes)");
    const ingredientColumns = await client.execute("PRAGMA table_info(recipe_recipe_ingredients)");
    const byName = new Map(
      [...recipeColumns.rows, ...ingredientColumns.rows].map((row) => [String(row.name), row]),
    );
    for (const column of ["title_fold", "description_fold", "name_fold"]) {
      expect(byName.get(column)?.notnull).toBe(1);
      expect(byName.get(column)?.dflt_value).toBeNull();
    }
    expect(byName.get("last_cooked_at")?.notnull).toBe(0);
    expect(byName.has("household_id")).toBe(true);
    expect(byName.has("group_id")).toBe(false);
  });
});

describe("(b) search indexes", () => {
  test("the title-fold and last-cooked indexes exist on recipe_recipes", async () => {
    const result = await client.execute(
      "select name from sqlite_master where type = 'index' and tbl_name = 'recipe_recipes'",
    );
    const indexes = result.rows.map((row) => String(row.name));
    expect(indexes).toContain("recipe_recipes_household_title_fold_idx");
    expect(indexes).toContain("recipe_recipes_household_last_cooked_idx");
  });
});

describe("(c) afterMigrate fold backfill", () => {
  test("a second runMigrations folds an empty fold, a third changes nothing", async () => {
    const { userId, householdId } = await createHousehold("fold");
    const recipeId = crypto.randomUUID();
    await db.insert(recipes).values({
      id: recipeId,
      householdId,
      title: "Käsespätzle",
      description: "Mit Röstzwiebeln",
      titleFold: "",
      descriptionFold: "",
      createdBy: userId,
    });
    const ingredientId = crypto.randomUUID();
    await db.insert(recipeIngredients).values({
      id: ingredientId,
      recipeId,
      name: "Bergkäse",
      nameFold: "",
    });

    await runMigrations(db);

    const [folded] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
    expect(folded?.titleFold).toBe("kasespatzle");
    expect(folded?.descriptionFold).toBe("mit rostzwiebeln");
    const [ingredient] = await db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.id, ingredientId));
    expect(ingredient?.nameFold).toBe("bergkase");

    await runMigrations(db);
    const [again] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
    expect(again).toEqual(folded);
    expect(await backfillFoldedColumns(db)).toBe(0);
  });

  test("an empty title keeps its correctly empty fold", async () => {
    const { userId, householdId } = await createHousehold("empty");
    const recipeId = crypto.randomUUID();
    await db.insert(recipes).values({
      id: recipeId,
      householdId,
      title: "",
      titleFold: "",
      descriptionFold: "",
      createdBy: userId,
    });
    expect(await backfillFoldedColumns(db)).toBe(0);
    const [row] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
    expect(row?.titleFold).toBe("");
  });
});

describe("(d) household cascade", () => {
  test("deleting a household removes its recipe_recipes rows", async () => {
    const { userId, householdId } = await createHousehold("cascade");
    const other = await createHousehold("cascade-other");
    for (const [owner, author] of [
      [householdId, userId],
      [other.householdId, other.userId],
    ] as const) {
      await db.insert(recipes).values({
        id: crypto.randomUUID(),
        householdId: owner,
        title: "Suppe",
        titleFold: "suppe",
        descriptionFold: "",
        createdBy: author,
      });
    }

    await client.execute({ sql: "delete from households where id = ?", args: [householdId] });

    expect(await db.select().from(recipes).where(eq(recipes.householdId, householdId))).toHaveLength(0);
    expect(
      await db.select().from(recipes).where(eq(recipes.householdId, other.householdId)),
    ).toHaveLength(1);
  });
});

describe("(e) collectUploadReferences", () => {
  test("reduces every core and recipe reference to its bare filename", async () => {
    const { userId, householdId } = await createHousehold("uploads");
    await db
      .update(users)
      .set({ avatarUrl: "/uploads/avatar.webp" })
      .where(eq(users.id, userId));
    await db
      .update(households)
      .set({ imageUrl: "https://api.example.test/uploads/household.jpg" })
      .where(eq(households.id, householdId));
    const recipeId = crypto.randomUUID();
    await db.insert(recipes).values({
      id: recipeId,
      householdId,
      title: "Brot",
      titleFold: "brot",
      descriptionFold: "",
      // Persisted signed by an older client: still reduces to the filename.
      imageUrl: signUploadUrl("/uploads/recipe.jpg"),
      createdBy: userId,
    });
    await db.insert(collections).values({
      id: crypto.randomUUID(),
      householdId,
      name: "Sonntag",
      coverImageUrl: signUploadUrl("https://api.example.test/uploads/cover.png"),
      createdBy: userId,
    });
    await db.insert(importDrafts).values({
      id: crypto.randomUUID(),
      householdId,
      createdBy: userId,
      sourceType: "ocr",
      parsed: {
        imageUrl: "/uploads/parsed.jpg",
        ingredients: [],
        steps: [],
        tags: [],
        confidence: { overall: 0.5 },
      },
      // storedPath is a plain filename, relative to UPLOAD_DIR.
      sourceMeta: { method: "ocr", storedPath: "scan.pdf" },
    });
    // An external hero image is not ours and never counts.
    await db.insert(recipes).values({
      id: crypto.randomUUID(),
      householdId,
      title: "Extern",
      titleFold: "extern",
      descriptionFold: "",
      imageUrl: "https://www.chefkoch.de/bild.jpg",
      createdBy: userId,
    });

    const referenced = await collectUploadReferences(db);
    for (const filename of [
      "avatar.webp",
      "household.jpg",
      "recipe.jpg",
      "cover.png",
      "parsed.jpg",
      "scan.pdf",
    ]) {
      expect(referenced.has(filename)).toBe(true);
    }
    expect([...referenced].some((name) => name.includes("chefkoch") || name.includes("/"))).toBe(
      false,
    );

    // Without the module, only the core's two columns are collected.
    const coreOnly = await collectUploadReferences(db, []);
    expect([...coreOnly].sort()).toEqual(["avatar.webp", "household.jpg"]);
  });

  test("filenameOf refuses paths, external URLs and data URIs", () => {
    expect(filenameOf("/uploads/x.jpg")).toBe("x.jpg");
    expect(filenameOf("x.jpg")).toBe("x.jpg");
    expect(filenameOf("/uploads/../etc/passwd")).toBeUndefined();
    expect(filenameOf("../x.jpg")).toBeUndefined();
    expect(filenameOf(".hidden")).toBeUndefined();
    expect(filenameOf("https://example.test/x.jpg")).toBeUndefined();
    expect(filenameOf("data:image/png;base64,AAAA")).toBeUndefined();
    expect(filenameOf("")).toBeUndefined();
    expect(filenameOf(null)).toBeUndefined();
  });
});

describe("(f) healthFeatures", () => {
  test("follows the two capability flags", () => {
    setOcrImportEnabled(true);
    setPdfImportEnabled(false);
    expect(recipeModule.healthFeatures?.()).toEqual({ ocrImport: true, pdfImport: false });
    setOcrImportEnabled(false);
    setPdfImportEnabled(true);
    expect(recipeModule.healthFeatures?.()).toEqual({ ocrImport: false, pdfImport: true });
    setOcrImportEnabled(null);
    setPdfImportEnabled(null);
  });
});
