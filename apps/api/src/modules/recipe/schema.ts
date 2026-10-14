/**
 * Drizzle (libSQL/SQLite) schema of the recipe module — toon-recipe's
 * `apps/api/src/db/schema.ts` (recipes … cards, plus their relations and row types)
 * with the household renames of SPEC D1/D7 and plan M2 decision 2:
 *
 * - every SQL table carries the module prefix `recipe_` (`recipes` → `recipe_recipes`,
 *   `tags` → `recipe_tags`, `recipe_tags` → `recipe_recipe_tags`, …; 17 tables, SPEC §4),
 *   and so does every index name, with `group` → `household` inside it (SQLite index
 *   names are global, and finance has a `tags` table too);
 * - `group_id` → `household_id`, referencing the core `households.id` (cascade unchanged);
 * - the TS identifiers stay toon-recipe's (`recipes`, `recipeIngredients`, `tags`,
 *   `cards`, …) so the services port with path changes only.
 *
 * `users` and `households` come from `db/schema/core.ts` directly, never from
 * `db/schema.ts` (which re-exports this file — importing it here would be a cycle).
 * The core relations (`usersRelations`, `householdsRelations`) gain no recipe side:
 * nothing queries recipe rows through the relational API from the core.
 *
 * Conventions are the core's (see the header of db/schema/core.ts). "SPEC.md §n"
 * below is toon-recipe's own spec, referenced by path from this repo's docs.
 */
import type { ImportSourceMeta, ParsedRecipe, TagKind } from "@toon/shared";
import { relations } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { households, users } from "../../db/schema/core.ts";

const now = () => Date.now();

/* -------------------------------------------------------------------------- */
/* recipes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * SEARCH STRATEGY: `GET /recipes?q=` LIKEs the PRE-FOLDED columns
 * `title_fold` / `description_fold` plus an EXISTS sub-query on
 * `recipe_recipe_ingredients.name_fold`. FTS5 is still out of scope — see below for why
 * these columns were the answer instead.
 *
 * WHY THE FOLD IS STORED. It used to be computed per row per query: `foldSql()`
 * expands {@link FOLD_PAIRS} into 23 nested `replace(lower(…))` calls, and the
 * `total` half of the list envelope is a `count(*)` that cannot stop early, so
 * EVERY row's title and description were folded on EVERY search. Measured on 2000
 * recipes: 32 ms for a search, of which 31.8 ms was that one `count(*)`, and 91 ms
 * for a term that matches nothing (the page half loses its early exit too). Cost
 * grows linearly with the library — 6 ms at 300 recipes, 34 ms at 2000 — and
 * because libSQL serialises a local file, one such query delays every other
 * request behind it. With the fold stored, the same no-match search is ~9 ms.
 *
 * WHY NOT A GENERATED COLUMN. It would be the obvious fit and it does not work
 * here: libSQL 0.17.4 and 0.18.0 bundle SQLite 3.45.1, which rejects
 * `ALTER TABLE … ADD COLUMN … GENERATED ALWAYS AS (…) STORED` outright ("cannot
 * add a STORED column"). Note that `bun:sqlite` is 3.53 and accepts it, so a
 * migration tested only through bun:sqlite would pass locally and fail on deploy.
 * A VIRTUAL column is no use: it recomputes the fold on read, which is the cost we
 * are removing.
 *
 * SO THE APP WRITES THEM, exactly as it already does for the shopping list's
 * `name_key` / `merge_key`. The columns are `.notNull()` WITHOUT a drizzle default
 * on purpose: that makes them required in `$inferInsert`, so `tsc` fails on any
 * insert site that forgets one rather than silently storing NULL and making the
 * recipe unfindable. toon-recipe's migration 0003 had to ADD them with a SQL-level
 * `DEFAULT ''` (SQLite cannot add a NOT NULL column to a populated table without
 * one); here `0001_recipe.sql` CREATEs the tables fresh, so the generated DDL is a
 * plain `NOT NULL` and schema and migration agree (plan M2 decision 5). Rows that
 * arrive without a real fold (a legacy copy, M5) are filled in by
 * `backfillFoldedColumns` (modules/recipe/migrate.ts), the module's `afterMigrate`.
 *
 * KEEP THEM IN STEP WITH `foldText()`. Adding a pair to {@link FOLD_PAIRS} makes
 * every stored value stale until rewritten — the same rule the shopping-list keys
 * already carry. `test/recipes-search.test.ts` pins the agreement.
 */
export const recipes = sqliteTable(
  "recipe_recipes",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /** `foldText(title)` — the searchable/sortable form. See the table comment. */
    titleFold: text("title_fold").notNull(),
    /** `foldText(description ?? "")`; empty string when there is no description. */
    descriptionFold: text("description_fold").notNull(),
    imageUrl: text("image_url"),
    sourceUrl: text("source_url"),
    sourceName: text("source_name"),
    servingsAmount: real("servings_amount"),
    servingsUnit: text("servings_unit"),
    prepMinutes: integer("prep_minutes"),
    cookMinutes: integer("cook_minutes"),
    totalMinutes: integer("total_minutes"),
    /** "einfach" | "mittel" | "schwer" */
    difficulty: text("difficulty"),
    rating: integer("rating"),
    notes: text("notes"),
    language: text("language").notNull().default("de"),
    /**
     * When this recipe was last cooked, denormalised from `recipe_recipe_cook_log` (the
     * table is the source of truth; this is written by its ONE writer,
     * `recordCooked`/`undoCooked` in modules/recipe/services/recipes/cookLog.ts — the same rule as
     * `updateUser()` never touching `email_verified_at`).
     *
     * Denormalised rather than a correlated `max()` or a grouped-max join, because
     * `?sort=lastCooked` needs an INDEX to sort by, not a per-row subquery over the
     * whole household — the exact failure `recipe_recipes_household_title_fold_idx` exists to avoid
     * (see that column's comment). NULLABLE and NEVER `NOT NULL DEFAULT 0`: 0 is
     * 1970 and would sort a never-cooked recipe as recently cooked. In SQLite,
     * `ORDER BY x DESC` puts NULLs LAST for free, so `recipe_recipes_household_last_cooked_idx`
     * supplies `[desc(lastCookedAt), desc(createdAt)]` with no `is null` leading term.
     *
     * MEASURED (2000 recipes in one household, ~6000 log rows over 400 of them, scratch
     * FILE db through `@libsql/client`, median of 20 runs), list query only:
     * correlated `max()` subquery 0.781 ms · grouped-max LEFT JOIN 1.091 ms ·
     * this stored column 0.049 ms. At that row count the absolute gap is
     * sub-millisecond; the durable signal is the PLAN, not the timing —
     * `explain query plan` shows `USE TEMP B-TREE FOR ORDER BY` for both derived
     * forms and a bare `SEARCH recipe_recipes USING INDEX recipe_recipes_household_last_cooked_idx`
     * for this one, i.e. only this one scales with the library. That plan is what
     * `test/recipes-cooked.test.ts` pins; the numbers are here for context.
     *
     * No backfill on introduction: `recipe_recipe_cook_log` is a brand-new table, so NULL is
     * correct for every pre-existing recipe.
     */
    lastCookedAt: integer("last_cooked_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (table) => [
    index("recipe_recipes_household_id_idx").on(table.householdId),
    index("recipe_recipes_household_created_at_idx").on(table.householdId, table.createdAt),
    /**
     * `?sort=title`. It has to be the FOLDED column: ordering by an expression
     * (`foldSql(title)`) cannot use an index, so the planner fell back to
     * `USE TEMP B-TREE FOR ORDER BY` over every row in the household — 6.7 ms against
     * 2.1 ms for `?sort=newest`, which reads its order straight out of
     * `recipe_recipes_household_created_at_idx`.
     *
     * This REPLACES toon-recipe's old `recipes_group_title_idx` on the raw title, which no
     * query could use once sorting became case/diacritic-insensitive.
     */
    index("recipe_recipes_household_title_fold_idx").on(table.householdId, table.titleFold),
    index("recipe_recipes_created_by_idx").on(table.createdBy),
    /**
     * `?sort=lastCooked`. The third column is the tie-break `orderBy` actually uses
     * (`[desc(lastCookedAt), desc(createdAt)]`), so it belongs in the index too —
     * same shape as `recipe_recipes_household_created_at_idx`'s pairing with `?sort=newest`.
     */
    index("recipe_recipes_household_last_cooked_idx").on(table.householdId, table.lastCookedAt, table.createdAt),
  ],
);

export const recipeIngredients = sqliteTable(
  "recipe_recipe_ingredients",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    section: text("section"),
    quantity: real("quantity"),
    /** Upper bound for ranges ("2-3 Eier"). */
    quantityMax: real("quantity_max"),
    unit: text("unit"),
    name: text("name").notNull(),
    /** `foldText(name)` — searched by the `?q=` EXISTS sub-query. See `recipe_recipes`. */
    nameFold: text("name_fold").notNull(),
    note: text("note"),
    /** Original source line, never rewritten. */
    raw: text("raw").notNull().default(""),
  },
  (table) => [
    index("recipe_recipe_ingredients_recipe_id_idx").on(table.recipeId),
    index("recipe_recipe_ingredients_recipe_position_idx").on(table.recipeId, table.position),
    index("recipe_recipe_ingredients_name_idx").on(table.name),
  ],
);

export const recipeSteps = sqliteTable(
  "recipe_recipe_steps",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    section: text("section"),
    text: text("text").notNull(),
  },
  (table) => [
    index("recipe_recipe_steps_recipe_id_idx").on(table.recipeId),
    index("recipe_recipe_steps_recipe_position_idx").on(table.recipeId, table.position),
  ],
);

export const tags = sqliteTable(
  "recipe_tags",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    /**
     * `'course' | 'free'` (TagKind in @toon/shared).
     *
     * A `course` tag is the recipe's category — the single honey eyebrow above every
     * title (`Hauptspeise`, `Beilage`, `Dessert`, `Suppe`, `Auflauf`). `free` is
     * everything else, which lives in the filter rail's lower half.
     *
     * THE NAMES ARE CONTENT. They are German recipe vocabulary like units.ts, they are
     * rendered verbatim, and they must never go through t() or depend on the viewer's
     * locale. Only the rail's HEADING is interface.
     *
     * KEEPS its drizzle default, unlike `recipe_recipes.title_fold`: 'free' is correct for
     * every existing insert site, so the default is a feature here rather than the
     * silent-NULL hazard it would be there.
     */
    kind: text("kind").notNull().default("free").$type<TagKind>(),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex("recipe_tags_household_name_unique").on(table.householdId, table.name),
    index("recipe_tags_household_id_idx").on(table.householdId),
    // No (household_id, kind) index: recipe_tags_household_id_idx already narrows to the household, a
    // household holds tens of tags, and this table is written on every recipe save — a
    // second index here would be dead weight for a residual scan of a handful of rows.
  ],
);

export const recipeTags = sqliteTable(
  "recipe_recipe_tags",
  {
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.recipeId, table.tagId] }),
    index("recipe_recipe_tags_tag_id_idx").on(table.tagId),
    index("recipe_recipe_tags_recipe_id_idx").on(table.recipeId),
  ],
);

export const collections = sqliteTable(
  "recipe_collections",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    coverImageUrl: text("cover_image_url"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (table) => [
    index("recipe_collections_household_id_idx").on(table.householdId),
    index("recipe_collections_created_by_idx").on(table.createdBy),
  ],
);

export const collectionRecipes = sqliteTable(
  "recipe_collection_recipes",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    addedAt: integer("added_at").notNull().$defaultFn(now),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.recipeId] }),
    index("recipe_collection_recipes_recipe_id_idx").on(table.recipeId),
    index("recipe_collection_recipes_collection_id_idx").on(table.collectionId),
  ],
);

/* -------------------------------------------------------------------------- */
/* meal planner                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One planned meal: a recipe on a CALENDAR DATE in a household's week.
 *
 * `planned_on` IS THE ONE COLUMN IN THIS SCHEMA THAT IS NOT AN INSTANT. It holds
 * `YYYY-MM-DD` text, because a plan entry is a DATE — "Donnerstag" — and an integer
 * unix-ms midnight is an instant that every reader has to re-interpret in some
 * timezone. The server runs UTC in Docker and the users are in Europe/Berlin, so a
 * date derived from an instant is a day out for two hours every night, and `+ 1 day`
 * on a local Date lands on 23:00 the previous day across a spring-forward boundary.
 * A text date carries no zone to be wrong about, sorts lexicographically =
 * chronologically (so `recipe_meal_plan_entries_household_date_idx` supplies both the range and
 * the order), and is legible in the DB. THE CALENDAR DATE IS THE CLIENT'S: it is
 * computed from the device's local calendar by `toPlanDate()` in
 * packages/shared/src/core/calendar.ts and sent; nothing here ever calls `new Date()` to
 * decide what day it is. `cooked_at`/`created_at`/`updated_at` on this very table are
 * instants and stay integer unix ms, as everywhere else.
 *
 * `cooked_at` is stamped by POST /recipes/:recipeId/cooked (services/recipes/
 * cookLog.ts), never by the planner's own PATCH — one writer per fact.
 *
 * No `note` column: nothing draws or reads one (A02 §2.1 sketched one, dropped here —
 * dead schema is how a second, differently-shaped `note` column gets added later). If
 * `/plan` ever grows a note field, that is one migration line away.
 *
 * The UNIQUE index makes POST idempotent: planning the same recipe on the same day
 * twice returns the existing entry instead of a duplicate. Planner writes are
 * online-only (SPEC.md §5), so there is deliberately no `mutationId` ledger here —
 * the index is the whole idempotency story.
 */
export const mealPlanEntries = sqliteTable(
  "recipe_meal_plan_entries",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    /** `YYYY-MM-DD` in the planner's calendar — see the table comment. */
    plannedOn: text("planned_on").notNull(),
    position: integer("position").notNull().default(0),
    /** NULL = use the recipe's own `servings_amount`. */
    servings: real("servings"),
    /** When this planned meal was actually cooked. NULL = not yet. */
    cookedAt: integer("cooked_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex("recipe_meal_plan_entries_household_date_recipe_unique").on(
      table.householdId,
      table.plannedOn,
      table.recipeId,
    ),
    // Three columns on purpose: (household_id, planned_on) is a prefix, so the week range
    // scan is served AND `order by planned_on, position` comes out of the index.
    index("recipe_meal_plan_entries_household_date_idx").on(table.householdId, table.plannedOn, table.position),
    index("recipe_meal_plan_entries_recipe_id_idx").on(table.recipeId),
  ],
);

/**
 * "What did this recipe cook lately": one row per cook event, ordered so
 * `recipe_recipes.last_cooked_at` (below) can be recomputed from `max(cooked_at)`.
 *
 * `household_id` is DENORMALISED (it is derivable through `recipe_id`). It buys "what did
 * this household cook lately" as one index range scan instead of a join, and it is how the
 * household cascade stays a single sweep. Same reasoning as `recipe_shopping_list_items` carrying
 * `list_id` rather than joining up to the household.
 *
 * `meal_plan_entry_id` is `ON DELETE set null`, NOT cascade — the one FK on these new
 * tables that is not a cascade. Deleting a plan entry must not delete the fact that the
 * meal was cooked.
 *
 * This table is, today, WRITE-MOSTLY: its only reads are the cook-undo window and the
 * `last_cooked_at` recompute after an undo (services/recipes/cookLog.ts). It still
 * earns its place — it carries `cooked_by`, which a single column cannot, and D-per-
 * SPEC.md §4.2 mandates a log, not a column. Do not delete it as unused.
 *
 * No `cook_count` column: nothing in the design renders a count, so nothing stores it.
 */
export const recipeCookLog = sqliteTable(
  "recipe_recipe_cook_log",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    cookedBy: text("cooked_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cookedAt: integer("cooked_at").notNull().$defaultFn(now),
    /** NULL when the cook was logged outside the plan, or after the entry it stamped
     * was deleted — see the `ON DELETE set null` note above. */
    mealPlanEntryId: text("meal_plan_entry_id").references(() => mealPlanEntries.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("recipe_recipe_cook_log_recipe_cooked_idx").on(table.recipeId, table.cookedAt),
    index("recipe_recipe_cook_log_household_cooked_idx").on(table.householdId, table.cookedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* imports                                                                    */
/* -------------------------------------------------------------------------- */

export const importDrafts = sqliteTable(
  "recipe_import_drafts",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "pending" | "reviewed" | "discarded" */
    status: text("status").notNull().default("pending"),
    /** "manual" | "url" | "ocr" (PDF + image both use "ocr", see sourceMeta.method) */
    sourceType: text("source_type").notNull(),
    sourceUrl: text("source_url"),
    /** OCR output or PDF text layer, kept for the review screen. */
    rawText: text("raw_text"),
    /** ParsedRecipe as JSON — the editable draft body. */
    parsed: text("parsed", { mode: "json" }).$type<ParsedRecipe>().notNull(),
    confidence: real("confidence"),
    sourceMeta: text("source_meta", { mode: "json" }).$type<ImportSourceMeta>(),
    /** Set once the draft was committed. */
    recipeId: text("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (table) => [
    index("recipe_import_drafts_household_id_idx").on(table.householdId),
    index("recipe_import_drafts_created_by_idx").on(table.createdBy),
    index("recipe_import_drafts_household_status_idx").on(table.householdId, table.status),
    index("recipe_import_drafts_recipe_id_idx").on(table.recipeId),
  ],
);

/* -------------------------------------------------------------------------- */
/* shopping lists                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A named shopping list owned by a HOUSEHOLD — several per household are supported
 * ("Rewe", "Drogerie", "Wochenendeinkauf").
 *
 * The unique index is on the RAW name, which only stops exact duplicates. The service
 * additionally rejects names that merely FOLD to the same key (`eqFolded`), so "rewe"
 * and "Rewe" collide too; the index is the backstop against a race between two
 * concurrent creates.
 */
export const shoppingLists = sqliteTable(
  "recipe_shopping_lists",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * `Clear bought` watermark: the "Bought today" section shows only log rows
     * NEWER than this. NULL = never cleared. The log itself is never deleted by
     * clearing — the history panel and `/shopping/history` read past the watermark.
     */
    boughtClearedAt: integer("bought_cleared_at"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex("recipe_shopping_lists_household_name_unique").on(table.householdId, table.name),
    index("recipe_shopping_lists_household_id_idx").on(table.householdId),
    index("recipe_shopping_lists_created_by_idx").on(table.createdBy),
  ],
);

/**
 * One line on a list. There is NO `checked` column: checking an item off deletes the
 * row and bumps `recipe_shopping_list_catalog` instead, which is the Bring-style behaviour
 * the UI mimics (item leaves the list, reappears under "Häufig gekauft").
 *
 * `merge_key` is `shoppingItemKey(name, unit)` from @toon/shared — a folded name plus
 * the unit's merge bucket. The UNIQUE index on it is what makes "200 g Mehl" twice
 * become "400 g Mehl" instead of two lines, enforced by the DB rather than by a
 * read-modify-write that two members could interleave.
 *
 * `source_recipe_ids` is a JSON array and deliberately NOT a join table: ids are only
 * ever read as a set for display, a merge rewrites the whole set anyway, and a FK
 * would force a decision about what a deleted recipe does to an item that is already
 * in someone's shopping basket. Unknown ids are simply not resolved (see toShoppingItem).
 */
export const shoppingListItems = sqliteTable(
  "recipe_shopping_list_items",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** shoppingItemKey(name, unit) — the merge identity. */
    mergeKey: text("merge_key").notNull(),
    /** NULL means "no amount given"; never store 0 for that. */
    quantity: real("quantity"),
    unit: text("unit"),
    note: text("note"),
    position: integer("position").notNull().default(0),
    /** JSON string array of recipe ids this line was merged from. */
    sourceRecipeIds: text("source_recipe_ids", { mode: "json" }).$type<string[]>(),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex("recipe_shopping_list_items_list_merge_key_unique").on(table.listId, table.mergeKey),
    index("recipe_shopping_list_items_list_id_idx").on(table.listId),
    index("recipe_shopping_list_items_list_position_idx").on(table.listId, table.position),
  ],
);

/**
 * "Häufig gekauft": everything that has been on this list before, so re-adding the
 * weekly milk is one tap instead of typing.
 *
 * `use_count` counts CHECK-OFFS, not adds, so the ranking reflects what actually gets
 * bought rather than what gets typed and deleted again. `name_key` is `nameKey(name)`
 * from @toon/shared — the unit is remembered for convenience but is NOT part of the
 * identity, because "Milch" is one suggestion whether you bought 1 l or 2 Flaschen.
 */
export const shoppingListCatalog = sqliteTable(
  "recipe_shopping_list_catalog",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** nameKey(name) — the suggestion identity. */
    nameKey: text("name_key").notNull(),
    /** Last unit this item was bought in, pre-filled on re-add. */
    unit: text("unit"),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: integer("last_used_at").notNull().$defaultFn(now),
    /**
     * Hidden from the "Häufig gekauft" chips but KEEPS its `use_count`
     * (SPEC § 4.6): the design replaced the per-chip `×` with a long-press hide,
     * and deleting the entry would only make it come back on the next check-off.
     */
    hiddenAt: integer("hidden_at"),
  },
  (table) => [
    uniqueIndex("recipe_shopping_list_catalog_list_name_unique").on(table.listId, table.nameKey),
    index("recipe_shopping_list_catalog_list_rank_idx").on(
      table.listId,
      table.useCount,
      table.lastUsedAt,
    ),
  ],
);

/**
 * "Bought today" and the history panel — the log D4 chose INSTEAD of a `bought_at`
 * column on the item row.
 *
 * Checking an item off still DELETEs it and still bumps `recipe_shopping_list_catalog`
 * (see the item table's comment); it additionally appends one row here. The four
 * things that make offline editing safe are therefore untouched: the
 * `(list_id, merge_key)` unique index stays TOTAL (no partial index whose libSQL
 * 3.45.1 support is unverified), the queued offline mutation stays a DELETE, the
 * `mutationId` ledger still covers the whole check-off, and "Häufig gekauft" still
 * ranks by `use_count`.
 *
 * `bought_by` is NULLABLE on purpose: a household's purchase history must survive a
 * member deleting their account, which `ON DELETE cascade` would not allow.
 *
 * Rows older than `BOUGHT_LOG_TTL_MS` are pruned on write
 * (services/shopping/bought.service.ts), the same shape as the mutation ledger.
 */
export const shoppingBoughtItems = sqliteTable(
  "recipe_shopping_bought_items",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** NULL means "no amount given"; never store 0 for that. */
    quantity: real("quantity"),
    unit: text("unit"),
    note: text("note"),
    /** NULL after the buyer deleted their account — history outlives the account. */
    boughtBy: text("bought_by").references(() => users.id, { onDelete: "set null" }),
    boughtAt: integer("bought_at").notNull().$defaultFn(now),
    /** JSON string array, copied from the item so an undo restores provenance. */
    sourceRecipeIds: text("source_recipe_ids", { mode: "json" }).$type<string[]>(),
  },
  (table) => [
    index("recipe_shopping_bought_items_list_bought_at_idx").on(table.listId, table.boughtAt),
    // For the TTL sweep, which is household-blind — the same role
    // `recipe_shopping_mutations_applied_at_idx` plays for the ledger.
    index("recipe_shopping_bought_items_bought_at_idx").on(table.boughtAt),
  ],
);

/**
 * "Recipes on this list" (artboard 1d right rail): which recipes contributed to a
 * list, and at how many portions.
 *
 * This does NOT replace `recipe_shopping_list_items.source_recipe_ids` and must not be
 * turned into one — that column is per-ITEM provenance, is rewritten by every merge,
 * and is deliberately not a join table (see its comment). This table is per-LIST
 * membership plus the one fact the items cannot carry: the `servings` the household chose
 * when they put the recipe on the list.
 */
export const shoppingListRecipes = sqliteTable(
  "recipe_shopping_list_recipes",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    /** Target portions used for the scaling; NULL = the recipe's own count. */
    servings: real("servings"),
    addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
    addedAt: integer("added_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex("recipe_shopping_list_recipes_list_recipe_unique").on(table.listId, table.recipeId),
    index("recipe_shopping_list_recipes_list_id_idx").on(table.listId),
  ],
);

/**
 * Idempotency ledger for shopping mutations — the thing that makes OFFLINE EDITING
 * safe rather than merely possible.
 *
 * A phone that adds a recipe while offline queues the request and replays it on
 * reconnect. If the original request DID reach the server but its response was lost,
 * the replay would add every ingredient a second time — and because items merge by
 * quantity, the failure mode is a silently doubled amount, not a visible duplicate.
 *
 * So every replayable mutation carries a client-generated `mutationId` and the API
 * records it here before answering. A second request with the same id returns the
 * current state without applying anything. Entries older than
 * `MUTATION_LEDGER_TTL_MS` are pruned on write (services/shopping/idempotency.ts).
 */
export const shoppingMutations = sqliteTable(
  "recipe_shopping_mutations",
  {
    /** The client-generated mutation id (uuid). */
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    appliedAt: integer("applied_at").notNull().$defaultFn(now),
  },
  (table) => [
    index("recipe_shopping_mutations_list_id_idx").on(table.listId),
    index("recipe_shopping_mutations_applied_at_idx").on(table.appliedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* saved cards                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A loyalty/membership barcode the user keeps in the app so the plastic card can
 * stay at home ("Karten"): Payback, DeutschlandCard, the gym, the library.
 *
 * OWNED BY A USER, NOT BY A HOUSEHOLD — the only table here that is, and deliberately
 * so (see the header of packages/shared/src/modules/recipe/schemas/card.ts). A loyalty number is
 * personal property that earns points, it has to follow its owner into every household
 * they are in, and nothing about it is collaborative. `user_id` cascades, so
 * deleting an account takes its wallet with it.
 *
 * `value` is stored NORMALISED (digits only for the numeric symbologies, check
 * digit included) because the schemas normalise on the way in — so the display path
 * can encode a row without cleaning it up first, and a duplicate is detectable by
 * string comparison.
 *
 * `last_used_at` is bumped when a card is SHOWN, and is what the list is ordered
 * by: the card you used yesterday is the one you want at the till today. NULL until
 * it has been shown once, which is why the ordering has to fall back to `created_at`
 * rather than treating NULL as zero in the index.
 */
export const cards = sqliteTable(
  "recipe_cards",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** What the user calls it: "Payback", "Rewe", "Stadtbibliothek". */
    label: text("label").notNull(),
    /** A `BarcodeFormat` from @toon/shared: qr | ean13 | ean8 | upca | code128 | code39 | itf. */
    format: text("format").notNull(),
    /** The normalised payload the symbol encodes. */
    value: text("value").notNull(),
    note: text("note"),
    /** When the card was last shown at a till. NULL = never. */
    lastUsedAt: integer("last_used_at"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (table) => [
    // The same number saved twice is a mistake, not a feature: the second copy
    // would sit next to the first in the wallet with no way to tell them apart.
    uniqueIndex("recipe_cards_user_format_value_unique").on(table.userId, table.format, table.value),
    index("recipe_cards_user_id_idx").on(table.userId),
    index("recipe_cards_user_last_used_idx").on(table.userId, table.lastUsedAt),
  ],
);


/* -------------------------------------------------------------------------- */
/* relations (for drizzle query API)                                          */
/* -------------------------------------------------------------------------- */

export const recipesRelations = relations(recipes, ({ many, one }) => ({
  household: one(households, { fields: [recipes.householdId], references: [households.id] }),
  author: one(users, { fields: [recipes.createdBy], references: [users.id] }),
  ingredients: many(recipeIngredients),
  steps: many(recipeSteps),
  recipeTags: many(recipeTags),
  collectionRecipes: many(collectionRecipes),
  mealPlanEntries: many(mealPlanEntries),
  cookLog: many(recipeCookLog),
}));

export const recipeIngredientsRelations = relations(recipeIngredients, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeIngredients.recipeId], references: [recipes.id] }),
}));

export const recipeStepsRelations = relations(recipeSteps, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeSteps.recipeId], references: [recipes.id] }),
}));

export const recipeTagsRelations = relations(recipeTags, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeTags.recipeId], references: [recipes.id] }),
  tag: one(tags, { fields: [recipeTags.tagId], references: [tags.id] }),
}));

export const collectionsRelations = relations(collections, ({ many, one }) => ({
  household: one(households, { fields: [collections.householdId], references: [households.id] }),
  collectionRecipes: many(collectionRecipes),
}));

export const collectionRecipesRelations = relations(collectionRecipes, ({ one }) => ({
  collection: one(collections, { fields: [collectionRecipes.collectionId], references: [collections.id] }),
  recipe: one(recipes, { fields: [collectionRecipes.recipeId], references: [recipes.id] }),
}));

export const importDraftsRelations = relations(importDrafts, ({ one }) => ({
  household: one(households, { fields: [importDrafts.householdId], references: [households.id] }),
  author: one(users, { fields: [importDrafts.createdBy], references: [users.id] }),
  recipe: one(recipes, { fields: [importDrafts.recipeId], references: [recipes.id] }),
}));

export const mealPlanEntriesRelations = relations(mealPlanEntries, ({ one }) => ({
  household: one(households, { fields: [mealPlanEntries.householdId], references: [households.id] }),
  recipe: one(recipes, { fields: [mealPlanEntries.recipeId], references: [recipes.id] }),
  createdByUser: one(users, { fields: [mealPlanEntries.createdBy], references: [users.id] }),
}));

export const recipeCookLogRelations = relations(recipeCookLog, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeCookLog.recipeId], references: [recipes.id] }),
  household: one(households, { fields: [recipeCookLog.householdId], references: [households.id] }),
  cookedByUser: one(users, { fields: [recipeCookLog.cookedBy], references: [users.id] }),
  mealPlanEntry: one(mealPlanEntries, {
    fields: [recipeCookLog.mealPlanEntryId],
    references: [mealPlanEntries.id],
  }),
}));

export const cardsRelations = relations(cards, ({ one }) => ({
  user: one(users, { fields: [cards.userId], references: [users.id] }),
}));

export const shoppingListsRelations = relations(shoppingLists, ({ many, one }) => ({
  household: one(households, { fields: [shoppingLists.householdId], references: [households.id] }),
  creator: one(users, { fields: [shoppingLists.createdBy], references: [users.id] }),
  items: many(shoppingListItems),
  catalog: many(shoppingListCatalog),
  boughtItems: many(shoppingBoughtItems),
  listRecipes: many(shoppingListRecipes),
}));

export const shoppingListItemsRelations = relations(shoppingListItems, ({ one }) => ({
  list: one(shoppingLists, { fields: [shoppingListItems.listId], references: [shoppingLists.id] }),
}));

export const shoppingListCatalogRelations = relations(shoppingListCatalog, ({ one }) => ({
  list: one(shoppingLists, {
    fields: [shoppingListCatalog.listId],
    references: [shoppingLists.id],
  }),
}));

export const shoppingBoughtItemsRelations = relations(shoppingBoughtItems, ({ one }) => ({
  list: one(shoppingLists, {
    fields: [shoppingBoughtItems.listId],
    references: [shoppingLists.id],
  }),
  boughtByUser: one(users, { fields: [shoppingBoughtItems.boughtBy], references: [users.id] }),
}));

export const shoppingListRecipesRelations = relations(shoppingListRecipes, ({ one }) => ({
  list: one(shoppingLists, {
    fields: [shoppingListRecipes.listId],
    references: [shoppingLists.id],
  }),
  recipe: one(recipes, { fields: [shoppingListRecipes.recipeId], references: [recipes.id] }),
  addedByUser: one(users, { fields: [shoppingListRecipes.addedBy], references: [users.id] }),
}));

/* -------------------------------------------------------------------------- */
/* row types                                                                  */
/* -------------------------------------------------------------------------- */

export type RecipeRow = typeof recipes.$inferSelect;
export type NewRecipeRow = typeof recipes.$inferInsert;
export type RecipeIngredientRow = typeof recipeIngredients.$inferSelect;
export type NewRecipeIngredientRow = typeof recipeIngredients.$inferInsert;
export type RecipeStepRow = typeof recipeSteps.$inferSelect;
export type NewRecipeStepRow = typeof recipeSteps.$inferInsert;
export type TagRow = typeof tags.$inferSelect;
export type NewTagRow = typeof tags.$inferInsert;
export type RecipeTagRow = typeof recipeTags.$inferSelect;
export type CollectionRow = typeof collections.$inferSelect;
export type NewCollectionRow = typeof collections.$inferInsert;
export type CollectionRecipeRow = typeof collectionRecipes.$inferSelect;
export type ImportDraftRow = typeof importDrafts.$inferSelect;
export type NewImportDraftRow = typeof importDrafts.$inferInsert;
export type MealPlanEntryRow = typeof mealPlanEntries.$inferSelect;
export type NewMealPlanEntryRow = typeof mealPlanEntries.$inferInsert;
export type RecipeCookLogRow = typeof recipeCookLog.$inferSelect;
export type NewRecipeCookLogRow = typeof recipeCookLog.$inferInsert;
export type ShoppingListRow = typeof shoppingLists.$inferSelect;
export type NewShoppingListRow = typeof shoppingLists.$inferInsert;
export type ShoppingListItemRow = typeof shoppingListItems.$inferSelect;
export type NewShoppingListItemRow = typeof shoppingListItems.$inferInsert;
export type ShoppingListCatalogRow = typeof shoppingListCatalog.$inferSelect;
export type NewShoppingListCatalogRow = typeof shoppingListCatalog.$inferInsert;
export type ShoppingBoughtItemRow = typeof shoppingBoughtItems.$inferSelect;
export type NewShoppingBoughtItemRow = typeof shoppingBoughtItems.$inferInsert;
export type ShoppingListRecipeRow = typeof shoppingListRecipes.$inferSelect;
export type NewShoppingListRecipeRow = typeof shoppingListRecipes.$inferInsert;
export type ShoppingMutationRow = typeof shoppingMutations.$inferSelect;
export type CardRow = typeof cards.$inferSelect;
export type NewCardRow = typeof cards.$inferInsert;

/**
 * The module's tables, for the manifest's `schema` (SPEC §2). Every one is
 * prefixed `recipe_` (test/recipe-module.test.ts pins the list).
 */
export const recipeTables = {
  recipes,
  recipeIngredients,
  recipeSteps,
  tags,
  recipeTags,
  collections,
  collectionRecipes,
  mealPlanEntries,
  recipeCookLog,
  importDrafts,
  shoppingLists,
  shoppingListItems,
  shoppingListCatalog,
  shoppingBoughtItems,
  shoppingListRecipes,
  shoppingMutations,
  cards,
};
