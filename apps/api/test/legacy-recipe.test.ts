/**
 * `migrateRecipe` and `migrateUploads` (plan m5 M5-T06, decisions 7, 8, 12 and 13, Table M rows
 * 15-31) against the committed fixtures (`test/fixtures/legacy/`, facts in `facts.ts`), on temp
 * file databases and temp upload directories. `env.uploadDir` (the developer's real
 * `data/uploads` under `bun test`) is never written: the last test compares its file list.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { foldText } from "@toon/shared";
import {
  EXPECTED,
  EXTERNAL_IMAGE_URL,
  GROUPS,
  MISSING_UPLOAD,
  RECIPE_USERS,
  RECIPES,
  UPLOADS,
} from "./fixtures/legacy/facts.ts";
import { env } from "../src/env.ts";
import { backfillFoldedColumns } from "../src/modules/recipe/migrate.ts";
import { migrateHouseholds } from "../scripts/legacy/households.ts";
import { migrateRecipe } from "../scripts/legacy/recipe.ts";
import { readAll } from "../scripts/legacy/sources.ts";
import { migrateUploads } from "../scripts/legacy/uploads.ts";
import { migrateUsers } from "../scripts/legacy/users.ts";
import { countRows, createLegacyRun, type LegacyRun } from "./support/legacy-harness.ts";

const runs: LegacyRun[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
});

async function migrated(options: Parameters<typeof createLegacyRun>[0] = {}): Promise<LegacyRun> {
  const created = await createLegacyRun(options);
  runs.push(created);
  await migrateUsers(created.ctx);
  await migrateHouseholds(created.ctx);
  return created;
}

type Plain = Record<string, unknown>;

async function rows(run: LegacyRun, sql: string, args: (string | number)[] = []): Promise<Plain[]> {
  const result = await run.target.client.execute({ sql, args });
  return result.rows.map((row) => {
    const out: Plain = {};
    result.columns.forEach((column, index) => {
      out[column] = row[index];
    });
    return out;
  });
}

/** Legacy table -> target table, Table M rows 15-31 in order. */
const TABLES: [legacy: string, target: string][] = [
  ["tags", "recipe_tags"],
  ["recipes", "recipe_recipes"],
  ["recipe_ingredients", "recipe_recipe_ingredients"],
  ["recipe_steps", "recipe_recipe_steps"],
  ["recipe_tags", "recipe_recipe_tags"],
  ["collections", "recipe_collections"],
  ["collection_recipes", "recipe_collection_recipes"],
  ["meal_plan_entries", "recipe_meal_plan_entries"],
  ["recipe_cook_log", "recipe_recipe_cook_log"],
  ["import_drafts", "recipe_import_drafts"],
  ["shopping_lists", "recipe_shopping_lists"],
  ["shopping_list_items", "recipe_shopping_list_items"],
  ["shopping_list_catalog", "recipe_shopping_list_catalog"],
  ["shopping_bought_items", "recipe_shopping_bought_items"],
  ["shopping_list_recipes", "recipe_shopping_list_recipes"],
  ["shopping_mutations", "recipe_shopping_mutations"],
  ["cards", "recipe_cards"],
];

function userTarget(run: LegacyRun, who: keyof typeof RECIPE_USERS): string {
  const id = run.ctx.ids.users.recipe.get(RECIPE_USERS[who].id);
  if (id === undefined) throw new Error(`${who} was not migrated`);
  return id;
}

describe("migrateRecipe", () => {
  test("copies every table: counts equal the facts, ids and households are kept", async () => {
    const run = await migrated();
    const { backfilled } = await migrateRecipe(run.ctx);
    expect(backfilled).toBe(0);
    expect(run.ctx.report.errors).toEqual([]);
    expect(run.ctx.report.skipped.filter((s) => s.source === "recipe")).toEqual([]);

    for (const [legacy, target] of TABLES) {
      const expected = EXPECTED.legacyRows.recipe[legacy] ?? 0;
      expect(await countRows(run.target.client, target)).toBe(expected);
      const count = run.ctx.report.counts.find((c) => c.table === target && c.source === "recipe");
      expect(count).toMatchObject({ read: expected, written: expected, alreadyMigrated: 0, skipped: 0 });
      // one ledger entry per written row, in the SAME table namespace
      const ledger = await rows(run, `SELECT count(*) AS n FROM legacy_ids WHERE "table" = ? AND legacy_source = 'recipe'`, [target]);
      expect(Number(ledger[0]?.n)).toBe(expected);
    }

    // recipe ids and household ids are the legacy ones (no id of H taken them)
    const recipeRows = await rows(run, "SELECT id, household_id, created_by, title FROM recipe_recipes ORDER BY id");
    expect(recipeRows.map((r) => r.id)).toEqual(Object.values(RECIPES).map((r) => r.id).sort());
    const apfel = recipeRows.find((r) => r.id === RECIPES.apfelkuchen.id);
    expect(apfel?.household_id).toBe(GROUPS.G1.id);
    expect(apfel?.household_id).toBe(run.ctx.ids.households.recipe.get(GROUPS.G1.id));
    expect(apfel?.created_by).toBe(userTarget(run, "anna"));
    const perHousehold = Object.fromEntries(
      (await rows(run, "SELECT household_id, count(*) AS n FROM recipe_recipes GROUP BY household_id")).map((r) => [r.household_id, Number(r.n)]),
    );
    expect(perHousehold).toEqual({
      [GROUPS.G1.id]: GROUPS.G1.recipes,
      [GROUPS.G2.id]: GROUPS.G2.recipes,
      [GROUPS.G3.id]: GROUPS.G3.recipes,
    });
  });

  test("fold columns are recomputed with foldText at copy time and the backfill finds nothing", async () => {
    const run = await migrated();
    await migrateRecipe(run.ctx);
    const ingredients = await rows(run, "SELECT name, name_fold FROM recipe_recipe_ingredients");
    expect(ingredients.some((r) => r.name === "Äpfel" || String(r.name).includes("Äpfel"))).toBe(true);
    for (const row of ingredients) expect(row.name_fold).toBe(foldText(String(row.name)));
    const apfel = ingredients.find((r) => String(r.name).includes("Äpfel"));
    expect(String(apfel?.name_fold)).not.toContain("Ä");
    const recipeRows = await rows(run, "SELECT title, title_fold, description, description_fold FROM recipe_recipes");
    for (const row of recipeRows) {
      expect(row.title_fold).toBe(foldText(String(row.title)));
      expect(row.description_fold).toBe(foldText(row.description === null ? "" : String(row.description)));
    }
    expect(await backfillFoldedColumns(run.target.db)).toBe(0);
  });

  test("upload URLs are normalised (avatar, group image), external ones are untouched", async () => {
    const run = await migrated();
    await migrateRecipe(run.ctx);
    const anna = await rows(run, "SELECT avatar_url FROM users WHERE id = ?", [userTarget(run, "anna")]);
    expect(anna[0]?.avatar_url).toBe(`/uploads/${UPLOADS.avatar.name}`);
    const group = await rows(run, "SELECT image_url FROM households WHERE id = ?", [GROUPS.G1.id]);
    expect(group[0]?.image_url).toBe(`/uploads/${UPLOADS.group.name}`);
    const images = Object.fromEntries(
      (await rows(run, "SELECT id, image_url FROM recipe_recipes")).map((r) => [r.id, r.image_url]),
    );
    expect(images[RECIPES.apfelkuchen.id]).toBe(`/uploads/${UPLOADS.hero.name}`);
    expect(images[RECIPES.gemuesepfanne.id]).toBe(EXTERNAL_IMAGE_URL);
    expect(images[RECIPES.kaesespaetzle.id]).toBe(`/uploads/${MISSING_UPLOAD}`);
    const cover = await rows(run, "SELECT cover_image_url FROM recipe_collections");
    expect(cover[0]?.cover_image_url).toBe(`/uploads/${UPLOADS.cover.name}`);
    const signed = await rows(run, "SELECT count(*) AS n FROM recipe_recipes WHERE image_url LIKE '%sig=%' OR image_url LIKE '%exp=%'");
    expect(Number(signed[0]?.n)).toBe(0);
  });

  test("cards belong to the mapped users and the import draft's JSON is byte-equal", async () => {
    const run = await migrated();
    await migrateRecipe(run.ctx);
    const owners = (await rows(run, "SELECT user_id FROM recipe_cards")).map((r) => r.user_id).sort();
    expect(owners).toEqual([userTarget(run, "anna"), userTarget(run, "ben")].sort());
    const legacyCards = await readAll(run.ctx.recipe!, "SELECT id, user_id FROM cards");
    for (const card of legacyCards) {
      const migratedCard = await rows(run, "SELECT user_id FROM recipe_cards WHERE id = ?", [String(card.id)]);
      expect(migratedCard[0]?.user_id).toBe(run.ctx.ids.users.recipe.get(String(card.user_id)));
    }
    const legacyDraft = (await readAll(run.ctx.recipe!, "SELECT * FROM import_drafts"))[0]!;
    const draft = (await rows(run, "SELECT * FROM recipe_import_drafts WHERE id = ?", [String(legacyDraft.id)]))[0]!;
    expect(draft.parsed).toBe(legacyDraft.parsed as string);
    expect(draft.source_meta).toBe(legacyDraft.source_meta as string);
    expect(draft.household_id).toBe(run.ctx.ids.households.recipe.get(String(legacyDraft.group_id)));
    // shopping lists keep their JSON and mutation ids too
    const legacyLists = await readAll(run.ctx.recipe!, "SELECT id, group_id FROM shopping_lists");
    const list = (await rows(run, "SELECT household_id FROM recipe_shopping_lists WHERE id = ?", [String(legacyLists[0]!.id)]))[0];
    expect(list?.household_id).toBe(run.ctx.ids.households.recipe.get(String(legacyLists[0]!.group_id)));
  });

  test("a second run writes 0 rows, every row is already migrated, the backfill still finds 0", async () => {
    const run = await migrated();
    await migrateRecipe(run.ctx);
    const before = await countRows(run.target.client, "legacy_ids");
    run.ctx.report.counts.length = 0;
    const second = await migrateRecipe(run.ctx);
    expect(second.backfilled).toBe(0);
    for (const [legacy, target] of TABLES) {
      const expected = EXPECTED.legacyRows.recipe[legacy] ?? 0;
      const count = run.ctx.report.counts.find((c) => c.table === target && c.source === "recipe");
      expect(count).toMatchObject({ read: expected, written: 0, alreadyMigrated: expected, skipped: 0 });
      expect(await countRows(run.target.client, target)).toBe(expected);
    }
    expect(await countRows(run.target.client, "legacy_ids")).toBe(before);
    expect(run.ctx.report.errors).toEqual([]);
  });

  test("a row whose user was not migrated is a skipped error and its children are skipped with it", async () => {
    const run = await migrated();
    run.ctx.ids.users.recipe.delete(RECIPE_USERS.anna.id);
    await migrateRecipe(run.ctx);
    const skipped = run.ctx.report.skipped;
    expect(skipped.some((s) => s.table === "recipe_recipes" && s.legacyId === RECIPES.apfelkuchen.id && s.error && s.reason === `user ${RECIPE_USERS.anna.id} not migrated`)).toBe(true);
    expect(skipped.some((s) => s.table === "recipe_recipe_ingredients" && s.reason === `recipe ${RECIPES.apfelkuchen.id} not migrated`)).toBe(true);
    expect(run.ctx.report.errors.length).toBe(skipped.filter((s) => s.error).length);
    expect(await countRows(run.target.client, "recipe_recipes")).toBeLessThan(EXPECTED.legacyRows.recipe.recipes!);
  });
});

describe("migrateUploads", () => {
  function listing(dir: string): string[] {
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  }

  test("copy: true copies the 7 files with equal sizes and warns about the missing referenced one", async () => {
    const run = await migrated({ mode: "apply", withUploads: true });
    const summary = await migrateUploads(run.ctx);
    expect(summary).toBeDefined();
    expect(summary).toMatchObject({
      sourceFiles: EXPECTED.uploads.sourceFiles,
      copied: EXPECTED.uploads.copied,
      wouldCopy: 0,
      alreadyPresent: 0,
      conflicts: [],
      missingReferenced: [MISSING_UPLOAD],
      ignoredEntries: [],
    });
    expect(run.ctx.report.uploads).toBe(summary!);
    expect(listing(run.uploadsTarget)).toEqual(Object.values(UPLOADS).map((u) => u.name).sort());
    for (const file of Object.values(UPLOADS)) {
      expect(statSync(join(run.uploadsTarget, file.name)).size).toBe(file.size);
      expect(readFileSync(join(run.uploadsTarget, file.name))).toEqual(readFileSync(join(run.uploadsSource!, file.name)));
    }
    expect(existsSync(join(run.uploadsTarget, UPLOADS.heroThumb.name))).toBe(true);
    expect(summary!.bytesCopied).toBe(Object.values(UPLOADS).reduce((sum, u) => sum + u.size, 0));
    expect(run.ctx.report.warnings.some((w) => w.includes(MISSING_UPLOAD))).toBe(true);
    expect(run.ctx.report.errors).toEqual([]);
  });

  test("a pre-existing target file with another size is a conflict error and keeps its bytes", async () => {
    const run = await migrated({ mode: "apply", withUploads: true });
    const path = join(run.uploadsTarget, UPLOADS.hero.name);
    writeFileSync(path, "keep me");
    const summary = await migrateUploads(run.ctx);
    expect(summary!.conflicts).toEqual([UPLOADS.hero.name]);
    expect(summary!.copied).toBe(EXPECTED.uploads.copied - 1);
    expect(readFileSync(path, "utf8")).toBe("keep me");
    expect(run.ctx.report.errors.length).toBe(1);
    expect(run.ctx.report.errors[0]).toContain(UPLOADS.hero.name);
  });

  test("copy: false only plans: wouldCopy 7 and the target directory is not touched", async () => {
    const run = await migrated({ mode: "dry-run", withUploads: true });
    expect(run.ctx.uploads.copy).toBe(false);
    const summary = await migrateUploads(run.ctx);
    expect(summary).toMatchObject({ copied: 0, wouldCopy: 7, alreadyPresent: 0, bytesCopied: 0, missingReferenced: [MISSING_UPLOAD] });
    expect(listing(run.uploadsTarget)).toEqual([]);
    // plan only never even creates a missing target directory
    const missingTarget = join(run.dir, "never-created");
    run.ctx.uploads.targetDir = missingTarget;
    const again = await migrateUploads(run.ctx);
    expect(again?.wouldCopy).toBe(7);
    expect(existsSync(missingTarget)).toBe(false);
    expect(run.ctx.report.errors).toEqual([]);
  });

  test("a second run copies 0 files and finds all 7 already present", async () => {
    const run = await migrated({ mode: "apply", withUploads: true });
    await migrateUploads(run.ctx);
    const second = await migrateUploads(run.ctx);
    expect(second).toMatchObject({ copied: 0, wouldCopy: 0, alreadyPresent: 7, bytesCopied: 0, conflicts: [] });
    expect(run.ctx.report.errors).toEqual([]);
  });

  test("sub-directories and symlinks are ignored with a warning, never copied", async () => {
    const run = await migrated({ mode: "apply", withUploads: true });
    const { mkdirSync, symlinkSync } = await import("node:fs");
    mkdirSync(join(run.uploadsSource!, "nested"));
    writeFileSync(join(run.uploadsSource!, "nested", "inner.png"), "x");
    symlinkSync(join(run.uploadsSource!, "orphan.png"), join(run.uploadsSource!, "link.png"));
    const summary = await migrateUploads(run.ctx);
    expect(summary!.sourceFiles).toBe(7);
    expect(summary!.ignoredEntries.sort()).toEqual(["link.png", "nested"]);
    expect(listing(run.uploadsTarget)).not.toContain("link.png");
    expect(listing(run.uploadsTarget)).not.toContain("nested");
    expect(run.ctx.report.warnings.filter((w) => w.startsWith("uploads: ignored")).length).toBe(2);
  });

  test("without a source directory the step is a warning and writes nothing", async () => {
    const run = await migrated({ mode: "apply" });
    expect(await migrateUploads(run.ctx)).toBeUndefined();
    expect(run.ctx.report.uploads).toBeUndefined();
    expect(run.ctx.report.warnings.some((w) => w.includes("uploads"))).toBe(true);
    expect(listing(run.uploadsTarget)).toEqual([]);
  });

  test("env.uploadDir is never written by the whole recipe step", async () => {
    const before = existsSync(env.uploadDir) ? readdirSync(env.uploadDir).sort() : null;
    const run = await migrated({ mode: "apply", withUploads: true });
    await migrateRecipe(run.ctx);
    await migrateUploads(run.ctx);
    await migrateUploads(run.ctx);
    const after = existsSync(env.uploadDir) ? readdirSync(env.uploadDir).sort() : null;
    expect(after).toEqual(before);
    expect(run.uploadsTarget).not.toBe(env.uploadDir);
  });
});
