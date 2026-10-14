/**
 * The recipe module's demo data (plan M2-T05, the manifest's `seedDemo`): three tags,
 * the course vocabulary, three German recipes (two with ingredient/step sections, each
 * linked to a course tag), a few meal plan entries across the current week, a cook log
 * over the last two weeks (with `last_cooked_at` recomputed to match), and a demo
 * shopping list with bought history, one hidden catalog entry and one linked recipe.
 *
 * Called by `scripts/seed.ts` after the core demo rows (user, household, module row),
 * with the shared `db` client: this module never closes it and never runs migrations.
 * Idempotent: recipes are skipped by title, and each block skips itself once its table
 * already has a row for this household/list. Content language is German on purpose
 * (demo data, not interface copy), so nothing here goes through `t()`.
 */
import {
  foldText,
  nameKey,
  parseIngredientBlock,
  parseStepBlock,
  planWeek,
  todayPlanDate,
  type RecipeStep,
} from "@toon/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.ts";
import {
  mealPlanEntries,
  recipeCookLog,
  recipeIngredients,
  recipeSteps,
  recipeTags,
  recipes,
  shoppingBoughtItems,
  shoppingListCatalog,
  shoppingListRecipes,
  shoppingLists,
  tags,
} from "../../db/schema.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const HEADING_LINE = /^([^:]{2,80}):\s*$/u;

/**
 * Splits a step block on standalone "Für den Teig:" heading lines and runs the shared
 * `parseStepBlock` per section.
 *
 * `parseStepBlock` on its own only splits BEFORE a numbered step, so a heading between
 * "3. …" and "4. …" ends up glued to the end of step 3 instead of becoming a section
 * (see "Known gaps" in README.md). Splitting first keeps the shared parser untouched.
 */
function parseSectionedSteps(text: string): RecipeStep[] {
  const out: RecipeStep[] = [];
  let section: string | undefined;
  let buffer: string[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    for (const step of parseStepBlock(buffer.join("\n"))) {
      out.push({ ...step, position: out.length, ...(section ? { section } : {}) });
    }
    buffer = [];
  };

  for (const line of text.split("\n")) {
    const heading = HEADING_LINE.exec(line.trim());
    if (heading) {
      flush();
      section = heading[1]!.trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out;
}

export async function seedRecipeDemo(
  db: Database,
  { householdId, userId }: { householdId: string; userId: string },
): Promise<void> {
  const now = Date.now();
  const tagNames = ["Hauptgericht", "Backen", "Vegetarisch"] as const;
  const tagIds = new Map<string, string>();
  for (const name of tagNames) {
    const existing = await db.select().from(tags).where(eq(tags.name, name)).limit(1);
    const row = existing.find((tag) => tag.householdId === householdId);
    if (row) {
      tagIds.set(name, row.id);
      continue;
    }
    const id = crypto.randomUUID();
    // Explicit even though 'free' is the column default (schema.ts) — these three are
    // the pre-course-eyebrow tags and this is the line that says so on a read-through.
    await db.insert(tags).values({ id, householdId, name, kind: "free", createdAt: now });
    tagIds.set(name, id);
  }

  // The single honey eyebrow above a recipe title (SPEC §4.4) — CONTENT, German recipe
  // vocabulary, never through t(). R41 ships no name-matching backfill for an existing
  // install, so this vocabulary only ever appears here and via the /tags kind toggle.
  const courseNames = ["Hauptspeise", "Beilage", "Dessert", "Suppe", "Auflauf"] as const;
  const courseTagIds = new Map<string, string>();
  for (const name of courseNames) {
    const existing = await db.select().from(tags).where(eq(tags.name, name)).limit(1);
    const row = existing.find((tag) => tag.householdId === householdId);
    if (row) {
      courseTagIds.set(name, row.id);
      continue;
    }
    const id = crypto.randomUUID();
    await db.insert(tags).values({ id, householdId, name, kind: "course", createdAt: now });
    courseTagIds.set(name, id);
  }

  interface DemoRecipe {
    title: string;
    description: string;
    servingsAmount: number;
    servingsUnit: string;
    prepMinutes: number;
    cookMinutes: number;
    difficulty: "einfach" | "mittel" | "schwer";
    ingredients: string;
    steps: string;
    tags: string[];
    /** One name out of `courseNames` — the eyebrow (recipeEyebrow in @toon/shared). */
    course: string;
  }

  const demoRecipes: DemoRecipe[] = [
    {
      title: "Klassische Pfannkuchen",
      description: "Dünne Pfannkuchen wie bei Oma — süß oder herzhaft.",
      servingsAmount: 4,
      servingsUnit: "Portionen",
      prepMinutes: 10,
      cookMinutes: 20,
      difficulty: "einfach",
      ingredients: [
        "250 g Mehl",
        "500 ml Milch",
        "3 Eier",
        "1 Prise Salz",
        "2 EL Zucker",
        "etwas Butter zum Braten",
      ].join("\n"),
      steps: [
        "1. Mehl, Milch, Eier, Salz und Zucker zu einem glatten Teig verrühren.",
        "2. Den Teig 15 Minuten ruhen lassen.",
        "3. Butter in einer Pfanne erhitzen und den Teig portionsweise goldbraun ausbacken.",
      ].join("\n"),
      tags: ["Hauptgericht", "Vegetarisch"],
      course: "Hauptspeise",
    },
    {
      title: "Schneller Schokokuchen",
      description: "Saftiger Rührkuchen mit Schokoguss, in 15 Minuten im Ofen.",
      servingsAmount: 12,
      servingsUnit: "Stück",
      prepMinutes: 15,
      cookMinutes: 40,
      difficulty: "einfach",
      // Section headings ("Für den Teig:") are recognised by parseIngredientBlock /
      // parseStepBlock and end up in recipe_ingredients.section / recipe_steps.section.
      ingredients: [
        "Für den Teig:",
        "200 g Mehl",
        "200 g Zucker",
        "1 Pck. Backpulver",
        "4 EL Kakao",
        "200 ml Öl",
        "200 ml Wasser",
        "1 Prise Salz",
        "Für den Guss:",
        "100 g Zartbitterschokolade",
        "1 EL Butter",
        "2 EL Milch",
      ].join("\n"),
      steps: [
        "Für den Teig:",
        "1. Backofen auf 180 °C Ober-/Unterhitze vorheizen und eine Springform fetten.",
        "2. Alle trockenen Zutaten mischen, dann Öl und Wasser unterrühren, bis ein glatter Teig entsteht.",
        "3. Den Teig in die Form geben und 40 Minuten backen. Stäbchenprobe machen.",
        "Für den Guss:",
        "4. Schokolade mit Butter und Milch über dem Wasserbad schmelzen.",
        "5. Den abgekühlten Kuchen mit dem Guss überziehen und 30 Minuten fest werden lassen.",
      ].join("\n"),
      tags: ["Backen", "Vegetarisch"],
      course: "Dessert",
    },
    {
      title: "Zwiebelkuchen vom Blech",
      description: "Herzhafter Blechkuchen mit Hefeteig und Speck — klassisch zum Federweißer.",
      servingsAmount: 12,
      servingsUnit: "Stück",
      prepMinutes: 30,
      cookMinutes: 45,
      difficulty: "mittel",
      ingredients: [
        "Für den Hefeteig:",
        "500 g Mehl (Type 405)",
        "1 Pck. Trockenhefe",
        "250 ml lauwarme Milch",
        "60 g weiche Butter",
        "1 TL Salz",
        "1 TL Zucker",
        "Für den Belag:",
        "1,5 kg Zwiebeln",
        "200 g durchwachsener Speck",
        "3 Eier",
        "200 g Schmand",
        "1 EL Mehl",
        "1 TL Kümmel, ganz",
        "Salz und Pfeffer",
      ].join("\n"),
      steps: [
        "Für den Hefeteig:",
        "1. Mehl, Trockenhefe, Zucker und Salz mischen, lauwarme Milch und Butter zugeben und 5 Minuten glatt kneten.",
        "2. Den Teig zugedeckt an einem warmen Ort 45 Minuten gehen lassen, bis er sich verdoppelt hat.",
        "Für den Belag:",
        "3. Zwiebeln halbieren und in feine Streifen schneiden. Speck würfeln und in einer großen Pfanne auslassen.",
        "4. Zwiebeln im Speckfett bei mittlerer Hitze 15 Minuten glasig dünsten, nicht braun werden lassen. Abkühlen lassen.",
        "5. Eier mit Schmand und Mehl verquirlen, unter die Zwiebeln rühren und mit Salz, Pfeffer und Kümmel abschmecken.",
        "6. Den Teig auf ein gefettetes Backblech ausrollen, den Belag gleichmäßig verteilen.",
        "7. Bei 200 °C Ober-/Unterhitze 40-45 Minuten backen, bis der Belag goldgelb gestockt ist. Lauwarm servieren.",
      ].join("\n"),
      tags: ["Hauptgericht", "Backen"],
      course: "Hauptspeise",
    },
  ];

  // Recorded for every recipe, present-before-this-run or freshly inserted, so the
  // meal-plan/cook-log seeding below (which needs real recipe ids) works the same
  // whether this is a fresh DB or a rerun against an existing one.
  const recipeIdByTitle = new Map<string, string>();

  for (const demo of demoRecipes) {
    const existing = await db.select({ id: recipes.id, title: recipes.title }).from(recipes).where(eq(recipes.householdId, householdId));
    const existingRow = existing.find((recipe) => recipe.title === demo.title);
    if (existingRow) {
      recipeIdByTitle.set(demo.title, existingRow.id);
      console.log(`[seed] recipe "${demo.title}" already present`);
      continue;
    }

    const recipeId = crypto.randomUUID();
    recipeIdByTitle.set(demo.title, recipeId);
    const parsedIngredients = parseIngredientBlock(demo.ingredients);
    const parsedSteps = parseSectionedSteps(demo.steps);

    await db.insert(recipes).values({
      id: recipeId,
      householdId,
      title: demo.title,
      titleFold: foldText(demo.title),
      description: demo.description,
      descriptionFold: foldText(demo.description),
      servingsAmount: demo.servingsAmount,
      servingsUnit: demo.servingsUnit,
      prepMinutes: demo.prepMinutes,
      cookMinutes: demo.cookMinutes,
      totalMinutes: demo.prepMinutes + demo.cookMinutes,
      difficulty: demo.difficulty,
      language: "de",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    if (parsedIngredients.length > 0) {
      await db.insert(recipeIngredients).values(
        parsedIngredients.map((ingredient) => ({
          id: crypto.randomUUID(),
          recipeId,
          position: ingredient.position,
          section: ingredient.section ?? null,
          quantity: ingredient.quantity ?? null,
          quantityMax: ingredient.quantityMax ?? null,
          unit: ingredient.unit ?? null,
          name: ingredient.name,
          nameFold: foldText(ingredient.name),
          note: ingredient.note ?? null,
          raw: ingredient.raw,
        })),
      );
    }

    if (parsedSteps.length > 0) {
      await db.insert(recipeSteps).values(
        parsedSteps.map((step) => ({
          id: crypto.randomUUID(),
          recipeId,
          position: step.position,
          section: step.section ?? null,
          text: step.text,
        })),
      );
    }

    const links = [...demo.tags.map((name) => tagIds.get(name)), courseTagIds.get(demo.course)]
      .filter((id): id is string => typeof id === "string")
      .map((tagId) => ({ recipeId, tagId }));
    if (links.length > 0) await db.insert(recipeTags).values(links);

    console.log(`[seed] recipe "${demo.title}" (${parsedIngredients.length} Zutaten, ${parsedSteps.length} Schritte)`);
  }

  const recipeIdList = demoRecipes.map((demo) => recipeIdByTitle.get(demo.title)!);

  /* -------------------------------------------------------------------------- */
  /* meal plan + cook log — the two headline features, so a fresh dev DB shows   */
  /* a populated week strip, "Kürzlich gekocht" and the "Aus dem Wochenplan"     */
  /* panel instead of three empty states (see PLAN.md T3.2).                    */
  /* -------------------------------------------------------------------------- */

  const existingPlanEntries = await db
    .select({ id: mealPlanEntries.id })
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.householdId, householdId))
    .limit(1);

  if (existingPlanEntries.length === 0) {
    // The seed is a CLI on a developer's own machine, so for the purposes of the
    // calendar-date boundary it IS a client (see calendar.ts's header) — the plan
    // dates are read off the LOCAL calendar, never `new Date().toISOString().slice(0,10)`.
    const today = todayPlanDate();
    const week = planWeek(today);

    const planEntries: Array<{ plannedOn: string; recipeId: string; cookedAt: number | null }> = [
      // The cooked one is week[0] (Monday), which is never LATER than today, so the
      // stamp is never in the future relative to the day it was planned for — a state
      // recordCooked() cannot produce and a nonsense week strip to screenshot.
      { plannedOn: week[0]!, recipeId: recipeIdList[0]!, cookedAt: now },
      { plannedOn: week[2]!, recipeId: recipeIdList[1]!, cookedAt: null },
      { plannedOn: today, recipeId: recipeIdList[2]!, cookedAt: null },
      { plannedOn: week[5]!, recipeId: recipeIdList[0]!, cookedAt: null },
    ];

    await db.insert(mealPlanEntries).values(
      planEntries.map((entry) => ({
        id: crypto.randomUUID(),
        householdId,
        recipeId: entry.recipeId,
        plannedOn: entry.plannedOn,
        servings: null,
        cookedAt: entry.cookedAt,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })),
    );
    console.log(`[seed] ${planEntries.length} meal plan entries across the current week`);
  }

  const existingCookLog = await db
    .select({ id: recipeCookLog.id })
    .from(recipeCookLog)
    .where(eq(recipeCookLog.householdId, householdId))
    .limit(1);

  if (existingCookLog.length === 0) {
    const cookLogEntries = [
      { recipeId: recipeIdList[0]!, cookedAt: now - 13 * DAY_MS },
      { recipeId: recipeIdList[1]!, cookedAt: now - 9 * DAY_MS },
      { recipeId: recipeIdList[2]!, cookedAt: now - 4 * DAY_MS },
      { recipeId: recipeIdList[0]!, cookedAt: now - 1 * DAY_MS },
    ];

    await db.insert(recipeCookLog).values(
      cookLogEntries.map((entry) => ({
        id: crypto.randomUUID(),
        recipeId: entry.recipeId,
        householdId,
        cookedBy: userId,
        cookedAt: entry.cookedAt,
        mealPlanEntryId: null,
      })),
    );

    // `recipes.last_cooked_at` has exactly one writer at runtime
    // (services/recipes/cookLog.ts's max(cooked_at) recompute, see the schema.ts
    // comment) — the seed reproduces that BY HAND here, in the same script, so a
    // freshly seeded DB satisfies T4.2's agreement test instead of looking like a
    // real bug the first time anyone runs it.
    const lastCookedByRecipe = new Map<string, number>();
    for (const entry of cookLogEntries) {
      const current = lastCookedByRecipe.get(entry.recipeId);
      if (current === undefined || entry.cookedAt > current) lastCookedByRecipe.set(entry.recipeId, entry.cookedAt);
    }
    for (const [recipeId, lastCookedAt] of lastCookedByRecipe) {
      await db.update(recipes).set({ lastCookedAt, updatedAt: now }).where(eq(recipes.id, recipeId));
    }

    console.log(`[seed] ${cookLogEntries.length} cook log rows`);
  }

  /* -------------------------------------------------------------------------- */
  /* shopping list — bought history + the catalog + the "on this list" rail     */
  /* -------------------------------------------------------------------------- */

  const LIST_NAME = "Rewe";
  const existingLists = await db.select().from(shoppingLists).where(eq(shoppingLists.householdId, householdId));
  let listId = existingLists.find((list) => list.name === LIST_NAME)?.id;

  if (!listId) {
    listId = crypto.randomUUID();
    await db.insert(shoppingLists).values({
      id: listId,
      householdId,
      name: LIST_NAME,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`[seed] shopping list "${LIST_NAME}" (${listId})`);
  }

  const existingBought = await db
    .select({ id: shoppingBoughtItems.id })
    .from(shoppingBoughtItems)
    .where(eq(shoppingBoughtItems.listId, listId))
    .limit(1);

  if (existingBought.length === 0) {
    // Spread across two days so the "Bought today" section and the history panel
    // (both reading this table, see schema.ts) each have something to show.
    const boughtItems = [
      { name: "Milch", quantity: 1, unit: "l", boughtAt: now - 1 * DAY_MS },
      { name: "Eier", quantity: 10, unit: "Stück", boughtAt: now - 1 * DAY_MS },
      { name: "Mehl", quantity: 1, unit: "kg", boughtAt: now - 1 * DAY_MS },
      { name: "Butter", quantity: 250, unit: "g", boughtAt: now },
      { name: "Zucker", quantity: 500, unit: "g", boughtAt: now },
    ];

    await db.insert(shoppingBoughtItems).values(
      boughtItems.map((item) => ({
        id: crypto.randomUUID(),
        listId,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        note: null,
        boughtBy: userId,
        boughtAt: item.boughtAt,
        sourceRecipeIds: null,
      })),
    );
    console.log(`[seed] ${boughtItems.length} shopping_bought_items rows`);
  }

  const existingCatalogEntry = await db
    .select({ id: shoppingListCatalog.id })
    .from(shoppingListCatalog)
    .where(eq(shoppingListCatalog.listId, listId))
    .limit(1);

  if (existingCatalogEntry.length === 0) {
    // Hidden on purpose (SPEC §4.6): keeps its use_count, just isn't offered as a
    // "Häufig gekauft" chip — this is the one row the fresh DB needs so a hidden
    // entry exists to look at at all.
    await db.insert(shoppingListCatalog).values({
      id: crypto.randomUUID(),
      listId,
      name: "Katzenstreu",
      nameKey: nameKey("Katzenstreu"),
      unit: "Pck.",
      useCount: 3,
      lastUsedAt: now - 20 * DAY_MS,
      hiddenAt: now - 5 * DAY_MS,
    });
    console.log("[seed] 1 hidden shopping_list_catalog entry");
  }

  const existingListRecipe = await db
    .select({ id: shoppingListRecipes.id })
    .from(shoppingListRecipes)
    .where(eq(shoppingListRecipes.listId, listId))
    .limit(1);

  if (existingListRecipe.length === 0) {
    const linkedRecipe = demoRecipes[0]!;
    await db.insert(shoppingListRecipes).values({
      id: crypto.randomUUID(),
      listId,
      recipeId: recipeIdByTitle.get(linkedRecipe.title)!,
      servings: linkedRecipe.servingsAmount,
      addedBy: userId,
      addedAt: now,
      updatedAt: now,
    });
    console.log(`[seed] "${linkedRecipe.title}" linked to shopping list "${LIST_NAME}"`);
  }
}
