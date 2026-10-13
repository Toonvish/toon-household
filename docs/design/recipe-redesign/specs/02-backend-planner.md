# 02 — Backend: meal planner, cook tracking, course dimension, sidebar counts

Area spec for the `redesign` branch. Contract: `docs/redesign/SPEC.md` (D1–D7 are settled and are
not reopened here). Repo rules: `CLAUDE.md` — its gotchas section is load-bearing and every decision
below is written to survive it.

**Scope.** SPEC.md §4.1 (meal planner, D7), §4.2 (cook tracking), §4.4 (course dimension, D5) and the
server half of §4.7 (sidebar counts). Everything is `apps/api` + `packages/shared`. No file under
`apps/web` is changed by this spec except the four lines named in §6.4 (`RECIPE_FILTER_PARAMS`, the
persist allow-list, one invalidation call) — those are listed because they are the *contract* ends of
this area and would otherwise be dropped between two agents.

**Out of scope, and owned elsewhere:** §4.3 bought state, §4.5 "from this week's plan" diff endpoint,
§4.6 frequently-bought `hidden_at` — all shopping-backend. §4.5 depends on a read this spec exports
(`listPlanEntries`); see §8 Conflicts.

---

## 0 — Two things to read before writing any code

1. **The course vocabulary is CONTENT, not interface.** `Hauptspeise`, `Beilage`, `Dessert`,
   `Suppe`, `Auflauf`, `Eintopf` are German recipe vocabulary, exactly like `units.ts` and
   `ingredients.ts`. They are stored in `tags.name`, they go on screen verbatim, and they must
   **never** be routed through `t()`, never keyed in a catalog, and never made to depend on
   `users.locale` or the negotiated `Accept-Language`. An English-UI user looking at a German recipe
   box sees `Hauptspeise` on the eyebrow, and that is correct. Only the *rail's heading* ("Gang" /
   "Course") and the *empty/error copy* are interface and get catalog keys. Getting this backwards is
   the single most damaging edit in this area (`CLAUDE.md`, first gotcha).
2. **`planned_on` is a CALENDAR DATE, not a timestamp**, and it is the only column in this repo that
   is not an integer unix-ms instant. §1 settles the representation and the timezone boundary. Read
   it before touching the planner.

---

## 1 — The date primitive: `packages/shared/src/calendar.ts` (NEW)

### 1.1 Decision: `planned_on` is `text` holding `YYYY-MM-DD`

Rejected: integer unix-ms UTC midnight.

| | `YYYY-MM-DD` text (**chosen**) | integer unix-ms UTC midnight |
| --- | --- | --- |
| What it means | a date, with no instant and no offset | an instant, which every reader must re-interpret in *some* zone |
| "Thursday" drift | impossible: the value carries no zone to be wrong about | one wrong `getDay()` (server TZ = UTC in Docker, Berlin is +1/+2) moves the card a day |
| DST | irrelevant | `+ 86_400_000` lands on 23:00 the previous day across a spring-forward boundary |
| Index order | lexicographic == chronological, so `(group_id, planned_on)` serves range scans **and** `ORDER BY` with no conversion | same |
| Range query | `planned_on >= '2026-09-07' and planned_on <= '2026-09-13'` — plain string compare | needs both bounds computed in the caller's zone first |
| Operator reading the DB | `2026-09-10` | `1789...` |

**This does not break the house rule.** `CLAUDE.md`: "**Timestamps** integer unix ms in SQLite, ISO
strings on the wire". A timestamp is an instant; `planned_on` is not one. Every *instant* on the new
tables (`cooked_at`, `created_at`, `updated_at`) stays integer unix ms and is serialised with
`toIso()` / `toIsoOrNull()` exactly like everything else. Put that sentence in the schema comment so
a later reviewer does not "fix" the column.

### 1.2 The timezone boundary, stated once

> **The calendar date belongs to the CLIENT. The server never derives one.**

- The web app computes the date string from the **device's local calendar** and sends it
  (`plannedOn` in a request body, `from`/`to` in a query string).
- The API stores and compares the string verbatim. It has no notion of "today".
- There is **exactly one** place that could be tempted to guess: stamping "the plan entry for today"
  when a recipe is marked cooked (§3.4). It does **not** guess — the client passes `plannedOn` (or
  `mealPlanEntryId`), and when neither is present the server stamps **no** entry and only appends the
  log row. A server-side `new Date()` there would, between 00:00 and 02:00 Berlin time, stamp
  *yesterday's* dinner.
- The server likewise never renders a weekday. `MON 1` and the `· today` suffix in the day-card
  `meta` are computed in the client from the same local calendar, and are interface.

### 1.3 The file

`packages/shared/src/calendar.ts` — pure, no I/O, exported from `packages/shared/src/index.ts`
(add `export * from "./calendar.ts";` next to `./duration.ts`).

```ts
/**
 * Calendar dates (YYYY-MM-DD), for the meal planner. Pure, no I/O.
 *
 * A PlanDate is a DATE, not an instant: it has no time and no timezone, which is
 * exactly why the planner stores one (see meal_plan_entries in apps/api/src/db/schema.ts).
 *
 * TWO RULES, and they are the whole file:
 *  1. `todayPlanDate()` / `toPlanDate(date)` read the LOCAL calendar of whoever calls
 *     them — that is the user's Thursday. Only a client may call them. Never
 *     `date.toISOString().slice(0,10)`: that is the UTC calendar, and it is off by a
 *     day every evening east of Greenwich.
 *  2. All arithmetic is done in UTC on the parsed Y/M/D (`Date.UTC`), because a
 *     local-time `+ 86_400_000` lands on 23:00 the day before across a spring-forward
 *     boundary (Europe/Berlin, 2026-03-29). A PlanDate has no time, so UTC math on it
 *     cannot be wrong.
 */
export type PlanDate = string;                       // "YYYY-MM-DD"

const PLAN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a syntactically valid AND real date ("2026-02-31" is neither). */
export function isPlanDate(value: string): boolean;

/** The LOCAL calendar date of `date` (default: now). Clients only — see rule 1. */
export function toPlanDate(date?: Date): PlanDate;

/** `toPlanDate()` with no argument, named for the call sites that read better. */
export function todayPlanDate(): PlanDate;

/** UTC-noon `Date` for the value — for `Intl.DateTimeFormat` weekday rendering only. */
export function planDateToDate(value: PlanDate): Date;

/** Calendar arithmetic, DST-proof (see rule 2). */
export function addPlanDays(value: PlanDate, delta: number): PlanDate;

/** Whole days from `a` to `b` (b - a). Negative when b is earlier. */
export function planDaysBetween(a: PlanDate, b: PlanDate): number;

/** The MONDAY of the week containing `value`. Monday is fixed, see below. */
export function startOfPlanWeek(value: PlanDate): PlanDate;

/** The 7 PlanDates Mon..Sun of the week containing `value`. */
export function planWeek(value: PlanDate): PlanDate[];
```

- **Monday is hardcoded.** The artboard's strip runs `MON 1 … SUN 7`; the app is German-first and
  ISO-8601's week starts on Monday. This is *not* wired to the viewer's locale — an `en` user of a
  German recipe box gets the same week as their flatmate, which is the point of a shared planner. One
  comment saying so is enough; do not add a `weekStartsOn` parameter nothing sets.
- `planWeek` is what draws the **empty** day cards. The API returns only the entries that exist
  (§2.5); the seven-slot shape is the client's, computed here. That is why the server never needs to
  know what a week is.
- Unit tests: `packages/shared/src/calendar.test.ts` (§7.3).

---

## 2 — Meal planner (SPEC.md §4.1, D7)

### 2.1 DDL

```sql
CREATE TABLE `meal_plan_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`planned_on` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`servings` real,
	`note` text,
	`cooked_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_plan_entries_group_date_recipe_unique` ON `meal_plan_entries` (`group_id`,`planned_on`,`recipe_id`);--> statement-breakpoint
CREATE INDEX `meal_plan_entries_group_date_idx` ON `meal_plan_entries` (`group_id`,`planned_on`,`position`);--> statement-breakpoint
CREATE INDEX `meal_plan_entries_recipe_id_idx` ON `meal_plan_entries` (`recipe_id`);
```

Decisions inside that DDL, each with its reason:

- **`group_id` cascade** — group-owned per locked decision 1, like every other content table.
- **`recipe_id` cascade** — a deleted recipe cannot stay on the plan; there is nothing to cook. (This
  is the opposite of `shopping_list_items.source_recipe_ids`, which is deliberately *not* a FK because
  an item already in a basket must survive. A plan entry is not in a basket.)
- **`created_by` cascade** — matches `recipes.created_by` / `collections.created_by`.
- **`position`** — a day can hold several entries (lunch + dinner). The strip renders the first by
  `position`; the `/plan` day column renders all of them.
- **`servings` real, nullable** — NULL falls back to `recipes.servings_amount`. `real`, not `integer`,
  matching `recipes.servings_amount`.
- **`note` text, nullable** — not drawn in any artboard. Included because the `/plan` screen is the
  one screen with no artboard at all (SPEC.md §4.1 Watch) and "Reste vom Vortag" is the first thing a
  flatshare wants; it costs one nullable column now versus a migration later. If the `/plan` screen
  ships without a note field, the column stays unused and unreferenced — say so in the PR rather than
  removing it mid-phase.
- **`cooked_at` integer, nullable** — what draws `cooked ✓` on the day card. Written by the cook
  endpoint (§3.4), never by the planner's own PATCH.
- **`meal_plan_entries_group_date_recipe_unique`** — the same recipe twice on one day is a mistake
  (a double-tap, or two flatmates planning the same thing), not a feature. The unique index makes
  `POST` idempotent for free (§2.4) without the `shopping_mutations` machinery, which planner writes
  deliberately do not have (they are online-only).
- **`meal_plan_entries_group_date_idx` is three columns, not the two SPEC.md names.** `(group_id,
  planned_on)` is a prefix of it, so every range scan SPEC.md asks for is served, *and* the
  `ORDER BY planned_on, position` of the range read comes out of the index with no temp b-tree. Do
  not additionally create the two-column index — a prefix index is dead weight.
- **`meal_plan_entries_recipe_id_idx`** — serves "is this recipe planned" (the cook endpoint's
  lookup, §3.4) and the `ON DELETE cascade` sweep when a recipe is deleted.
- **No `checked`-style status column and no `meal` / `slot` enum.** Nothing in the design draws
  breakfast/lunch/dinner; `position` covers ordering within a day.

### 2.2 Drizzle table

In `apps/api/src/db/schema.ts`, a new section after `collection_recipes` and before `/* imports */`:

```ts
/* -------------------------------------------------------------------------- */
/* meal planner                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One planned meal: a recipe on a CALENDAR DATE in a group's week.
 *
 * `planned_on` IS THE ONE COLUMN IN THIS SCHEMA THAT IS NOT AN INSTANT. It holds
 * `YYYY-MM-DD` text, because a plan entry is a DATE — "Donnerstag" — and an integer
 * unix-ms midnight is an instant that every reader has to re-interpret in some
 * timezone. The server runs UTC in Docker and the users are in Europe/Berlin, so a
 * date derived from an instant is a day out for two hours every night, and `+ 1 day`
 * on a local Date lands on 23:00 the previous day across a spring-forward boundary.
 * A text date carries no zone to be wrong about, sorts lexicographically =
 * chronologically (so `meal_plan_entries_group_date_idx` supplies both the range and
 * the order), and is legible in the DB. THE CALENDAR DATE IS THE CLIENT'S: it is
 * computed from the device's local calendar by `toPlanDate()` in
 * packages/shared/src/calendar.ts and sent; nothing here ever calls `new Date()` to
 * decide what day it is. `cooked_at`/`created_at`/`updated_at` on this very table are
 * instants and stay integer unix ms, as everywhere else.
 *
 * `cooked_at` is stamped by POST /recipes/:recipeId/cooked (services/recipes/
 * cookLog.ts), never by the planner's own PATCH — one writer per fact.
 *
 * The UNIQUE index makes POST idempotent: planning the same recipe on the same day
 * twice returns the existing entry instead of a duplicate. Planner writes are
 * online-only (SPEC.md §5), so there is deliberately no `mutationId` ledger here —
 * the index is the whole idempotency story.
 */
export const mealPlanEntries = sqliteTable(
  "meal_plan_entries",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    /** `YYYY-MM-DD` in the planner's calendar — see the table comment. */
    plannedOn: text("planned_on").notNull(),
    position: integer("position").notNull().default(0),
    /** NULL = use the recipe's own `servings_amount`. */
    servings: real("servings"),
    note: text("note"),
    /** When this planned meal was actually cooked. NULL = not yet. */
    cookedAt: integer("cooked_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (table) => [
    uniqueIndex("meal_plan_entries_group_date_recipe_unique").on(
      table.groupId,
      table.plannedOn,
      table.recipeId,
    ),
    // Three columns on purpose: (group_id, planned_on) is a prefix, so the week range
    // scan is served AND `order by planned_on, position` comes out of the index.
    index("meal_plan_entries_group_date_idx").on(table.groupId, table.plannedOn, table.position),
    index("meal_plan_entries_recipe_id_idx").on(table.recipeId),
  ],
);
```

Row types at the bottom of the file, in the existing block:

```ts
export type MealPlanEntryRow = typeof mealPlanEntries.$inferSelect;
export type NewMealPlanEntryRow = typeof mealPlanEntries.$inferInsert;
```

Relations (next to `recipesRelations`):

```ts
export const mealPlanEntriesRelations = relations(mealPlanEntries, ({ one }) => ({
  group: one(groups, { fields: [mealPlanEntries.groupId], references: [groups.id] }),
  recipe: one(recipes, { fields: [mealPlanEntries.recipeId], references: [recipes.id] }),
  createdByUser: one(users, { fields: [mealPlanEntries.createdBy], references: [users.id] }),
}));
```

…and add `mealPlanEntries: many(mealPlanEntries)` to `groupsRelations` and `recipesRelations`.

### 2.3 Migration

Generate with `bun run db:generate` (it picks the next free index and writes
`drizzle/meta/<n>_snapshot.json` + the `_journal.json` entry), then rename **both** the file and its
`tag` in `meta/_journal.json` to a speaking name, as `0003_folded_search_columns.sql` already does.
Never hand-write the snapshot.

This spec owns **three** migrations, and the order is forced: `recipe_cook_log.meal_plan_entry_id`
references `meal_plan_entries`, so the planner table must exist first.

| File | Contents |
| --- | --- |
| `0006_meal_planner.sql` | `meal_plan_entries` + its three indexes |
| `0007_cook_log.sql` | `recipe_cook_log` + its indexes + `ALTER TABLE recipes ADD last_cooked_at` + `recipes_group_last_cooked_idx` |
| `0008_tag_kind.sql` | `ALTER TABLE tags ADD kind ...` (§4.1) |

The numbers are a **shared ordered resource** — see §8 Conflicts. If the shopping-backend area lands
first, renumber; the sequence, not the number, is what matters.

Header comment for `0006`, in house style (the migrations here carry the *why*, see `0003`):

```sql
-- The meal planner (SPEC.md §4.1 / D7). `planned_on` is `text` holding YYYY-MM-DD and
-- NOT an integer unix-ms midnight: a plan entry is a calendar date, an instant is not,
-- and a date derived from an instant is a day out whenever the server's zone (UTC in
-- Docker) and the user's (Europe/Berlin) disagree — i.e. every night from 00:00 to
-- 02:00. See the `meal_plan_entries` comment in src/db/schema.ts.
--
-- The UNIQUE index is the idempotency story: planner writes are ONLINE-ONLY, so there
-- is no mutationId ledger, and a double-tapped POST must not create two entries.
--
-- No backfill: the table is new and starts empty.
```

`apps/api/src/db/migrate.ts` needs **no change** for `0006`. Add one sentence to
`backfillFoldedColumns`'s sibling area only if §3.3's optional repair is adopted; the base case is
"new table, nothing to backfill", and that is worth one line in the migration header (above) so the
absence is visibly deliberate rather than forgotten.

### 2.4 Shared schemas — `packages/shared/src/schemas/plan.ts` (NEW)

Add `export * from "./schemas/plan.ts";` to `packages/shared/src/index.ts` after `./schemas/recipe.ts`.

```ts
/**
 * Meal planner ("Wochenplan") — wire contract.
 *
 * `plannedOn` is a CALENDAR DATE (`YYYY-MM-DD`), not a timestamp: see
 * packages/shared/src/calendar.ts and the `meal_plan_entries` comment in
 * apps/api/src/db/schema.ts. The client computes it from the DEVICE's local calendar;
 * the server never derives a date from `Date.now()`.
 *
 * Every other timestamp here is the usual ISO string.
 */
import { z } from "zod";
import { refineKey } from "../i18n/zod.ts";
import { IdSchema, IsoDateSchema } from "./common.ts";
import { isPlanDate, planDaysBetween } from "../calendar.ts";

export const PLAN_LIMITS = {
  /** Recipes on ONE day. A cap because rows are unbounded otherwise. */
  entriesPerDay: 12,
  /** Longest range a single GET may ask for (two months + a fortnight). */
  rangeDays: 62,
} as const;

/** `YYYY-MM-DD`, and a date that really exists ("2026-02-31" does not). */
export const PlanDateSchema = z
  .string()
  .refine(isPlanDate, refineKey("server.plan.invalidDate"));

/** The slim recipe a planner card renders: thumb, serif title, `meta`. */
export const PlanRecipeSchema = z.object({
  id: IdSchema,
  title: z.string(),
  /** List image — `thumbnailUrl()`, never `imageUrl` (CLAUDE.md thumbnail gotcha). */
  thumbnailUrl: z.string().nullish(),
  totalMinutes: z.number().int().nonnegative().nullish(),
  servingsAmount: z.number().positive().nullish(),
  servingsUnit: z.string().nullish(),
});
export type PlanRecipe = z.infer<typeof PlanRecipeSchema>;

export const MealPlanEntrySchema = z.object({
  id: IdSchema,
  groupId: IdSchema,
  recipeId: IdSchema,
  plannedOn: PlanDateSchema,
  position: z.number().int().nonnegative(),
  /** null = the recipe's own servings. */
  servings: z.number().positive().nullish(),
  note: z.string().nullish(),
  /** Non-null draws `cooked ✓` on the day card. */
  cookedAt: IsoDateSchema.nullish(),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  recipe: PlanRecipeSchema,
});
export type MealPlanEntry = z.infer<typeof MealPlanEntrySchema>;

/* ------------------------------- requests -------------------------------- */

export const MealPlanRangeQuerySchema = z
  .object({ from: PlanDateSchema, to: PlanDateSchema })
  .refine((v) => v.from <= v.to, refineKey("server.plan.rangeInvalid"))
  // String compare is chronological for ISO dates, so the guard needs no parsing.
  .refine(
    (v) => planDaysBetween(v.from, v.to) < PLAN_LIMITS.rangeDays,
    refineKey("server.plan.rangeTooLong"),
  );
export type MealPlanRangeQuery = z.infer<typeof MealPlanRangeQuerySchema>;

export const CreateMealPlanEntryRequestSchema = z.object({
  recipeId: IdSchema,
  plannedOn: PlanDateSchema,
  servings: z.number().positive().max(1000).nullish(),
  note: z.string().trim().max(300).nullish(),
});
export type CreateMealPlanEntryRequest = z.infer<typeof CreateMealPlanEntryRequestSchema>;

/** Moving an entry to another day is a PATCH of `plannedOn` — that is the drag-and-drop. */
export const UpdateMealPlanEntryRequestSchema = z
  .object({
    plannedOn: PlanDateSchema.optional(),
    position: z.number().int().min(0).max(1000).optional(),
    servings: z.number().positive().max(1000).nullish(),
    note: z.string().trim().max(300).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, refineKey("server.validation.noChanges"));
export type UpdateMealPlanEntryRequest = z.infer<typeof UpdateMealPlanEntryRequestSchema>;

/* ------------------------------- responses ------------------------------- */

/**
 * FLAT and sorted by `(plannedOn, position)`, deliberately not grouped by day: a day
 * with nothing planned has no entry, and the seven-slot week (including the `+ Plan`
 * empty cards) is built client-side by `planWeek()`. That is what keeps the server
 * from having to know what a week is, or whose week it is.
 */
export const MealPlanRangeResponseSchema = z.object({
  from: PlanDateSchema,
  to: PlanDateSchema,
  items: z.array(MealPlanEntrySchema),
});
export type MealPlanRangeResponse = z.infer<typeof MealPlanRangeResponseSchema>;

export const MealPlanEntryResponseSchema = z.object({ entry: MealPlanEntrySchema });
export type MealPlanEntryResponse = z.infer<typeof MealPlanEntryResponseSchema>;
```

Note the range response is **not** the `{ items, total, limit, offset }` envelope. That envelope is
for paginated lists; a week is bounded by its own `from`/`to` and has no page. `PLAN_LIMITS.rangeDays`
is the bound. Say so in the doc table (§6.1) so nobody "fixes" it into a paginated list.

### 2.5 Endpoints

New router `apps/api/src/routes/plan.ts`, mounted in `apps/api/src/index.ts` **before** the
catch-all recipes router, next to imports and shopping:

```ts
app.route("/api/groups/:groupId/plan", planRoutes);   // ← above the recipes catch-all
```

Router-level middleware, `use("*")` for all three — every write in this file is uniformly gated, so
this is the `recipeRoutes` pattern, not the per-route `groupRoutes` pattern:

```ts
planRoutes.use("*", requireSession());
planRoutes.use("*", requireGroupRole("member"));
planRoutes.use("*", requireVerifiedEmail());
```

`requireGroupRole` resolves the group from `:groupId`, which every path carries. **Do not add
`entryId` to `RESOURCE_PARAMS` in `apps/api/src/middleware/group.ts`** — it would add a lookup for
nothing, and the entry is scoped by the service (`and(eq(id), eq(groupId))`) so a cross-group id
answers 404 rather than leaking.

| Method | Path | Auth | Request | Response | Statuses |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/groups/:groupId/plan?from&to` | group:member | `MealPlanRangeQuery` (query) | `MealPlanRangeResponse` | 200, 401, 403, 404, 422 |
| POST | `/api/groups/:groupId/plan` | group:member + verified | `CreateMealPlanEntryRequest` | `MealPlanEntryResponse` | **201** (new) / **200** (already planned), 401, 403 `email_unverified`, 404 `not_found` (recipe), 409 `meal_plan_day_full`, 422 |
| PATCH | `/api/groups/:groupId/plan/:entryId` | group:member + verified | `UpdateMealPlanEntryRequest` | `MealPlanEntryResponse` | 200, 403, 404, 409 `meal_plan_day_full`, 422 |
| DELETE | `/api/groups/:groupId/plan/:entryId` | group:member + verified | – | – | 204, 403, 404 |

- **Any member may plan and unplan**, including someone else's entry. A shared week is shared
  property, the same rule `updateShoppingList` already applies to renaming a list ("any member may
  rename — the list is shared property"). Do **not** call `assertCanModifyOwned` here.
- **POST is idempotent.** On a unique-index hit, return the existing row with **200** and apply
  `servings`/`note` if they were sent. Written as a pre-check inside the transaction plus a caught
  constraint error, in that order — the pre-check is what makes the normal path readable, the catch is
  what makes a race correct.
- **PATCH `plannedOn`** is the "move to another day" action. Moving onto a day that already holds
  that recipe collides with the unique index → **409 `conflict`** with `server.plan.alreadyPlanned`.
  Not a silent collapse of the two entries into one: that is a data loss the user did not ask for.
  Reuses the existing `conflict` code — no new wire code.
- **`meal_plan_day_full`** is the one new `ERROR_CODES` entry (§6.3): a day already holding
  `PLAN_LIMITS.entriesPerDay` entries answers 409. Precedent: `shopping_list_full`,
  `too_many_shopping_lists`.
- **No `POST /plan/:entryId/cooked`.** Marking something cooked is one fact with one writer:
  `POST /api/groups/:groupId/recipes/:recipeId/cooked` (§3.4), which accepts an optional
  `mealPlanEntryId` and returns the stamped entry. The `/plan` screen calls that. Two endpoints
  writing `cooked_at` is how the two halves drift.

### 2.6 Service — `apps/api/src/services/plan/plan.service.ts` (NEW)

Directory `apps/api/src/services/plan/` with `plan.service.ts` and `mappers.ts`, matching the
`services/<feature>/{x.service.ts,mappers.ts}` shape of `recipes` and `shopping`.

```ts
/** Entries in a date range, flat, `(plannedOn, position)` order — ONE query + ONE join. */
export async function listPlanEntries(
  db: DbLike,
  groupId: string,
  from: PlanDate,
  to: PlanDate,
): Promise<MealPlanEntry[]>;

/** The raw entry inside the group, or a 404 that never leaks another group's row. */
export async function loadPlanEntryRow(
  db: DbLike, groupId: string, entryId: string,
): Promise<MealPlanEntryRow>;

export async function createPlanEntry(
  db: Database, groupId: string, userId: string, input: CreateMealPlanEntryRequest,
): Promise<{ entry: MealPlanEntry; created: boolean }>;

export async function updatePlanEntry(
  db: Database, groupId: string, entryId: string, input: UpdateMealPlanEntryRequest,
): Promise<MealPlanEntry>;

export async function deletePlanEntry(db: DbLike, groupId: string, entryId: string): Promise<void>;

/** Today's (or a given day's) entry for one recipe — used by the cook endpoint. */
export async function findPlanEntryForRecipeOnDay(
  db: DbLike, groupId: string, recipeId: string, plannedOn: PlanDate,
): Promise<MealPlanEntryRow | null>;
```

`listPlanEntries` — the one query that matters:

```ts
const rows = await db
  .select({ entry: mealPlanEntries, recipe: recipes })
  .from(mealPlanEntries)
  .innerJoin(recipes, eq(recipes.id, mealPlanEntries.recipeId))
  .where(
    and(
      eq(mealPlanEntries.groupId, groupId),
      gte(mealPlanEntries.plannedOn, from),
      lte(mealPlanEntries.plannedOn, to),
    ),
  )
  .orderBy(asc(mealPlanEntries.plannedOn), asc(mealPlanEntries.position));
```

`meal_plan_entries_group_date_idx` supplies both the range and the order — assert that with
`explain query plan` (§7.2). `innerJoin` on `recipes`, not a second `inArray` round trip: a week is at
most `7 × entriesPerDay` rows, the join is by primary key, and a local libSQL file is one serialised
lane (`CLAUDE.md`), so one query beats two.

`mappers.ts`:

```ts
export function toPlanRecipe(row: RecipeRow): PlanRecipe {
  return {
    id: row.id,
    title: row.title,
    // Signed, and the DERIVED thumbnail — a planner card is a list image.
    thumbnailUrl: signUploadUrl(thumbnailUrlFor(row.imageUrl)),
    totalMinutes: row.totalMinutes,
    servingsAmount: row.servingsAmount,
    servingsUnit: row.servingsUnit,
  };
}

export function toMealPlanEntry(row: MealPlanEntryRow, recipe: RecipeRow): MealPlanEntry;
```

`toMealPlanEntry` uses `toIso(row.createdAt)` / `toIsoOrNull(row.cookedAt)` and passes `plannedOn`
through **verbatim** — it is already the wire format. Do not put it through `toIso()`; that would turn
a date into an instant and hand the client a `T00:00:00.000Z` it would then mis-render west of
Greenwich.

`createPlanEntry` body, in order:

1. `await loadRecipeRow(db, groupId, input.recipeId)` — 404 `server.recipes.recipeNotFound` for a
   recipe outside the group. Reuse the existing function from `services/recipes/recipes.service.ts`;
   do not re-query.
2. Inside `withTransaction`: count the day's entries → 409 `meal_plan_day_full` at the cap; look for
   an existing `(groupId, plannedOn, recipeId)` row → patch + `created: false`; else insert with
   `position = (max(position) of that day) + 1`.
3. Return `toMealPlanEntry` of the row.

`updatePlanEntry` — when `plannedOn` moves, `position` is re-assigned to the tail of the **target**
day unless `position` was sent explicitly. Otherwise a moved entry inherits a position from another
day and lands in the middle of the target column.

### 2.7 Offline / cache contract (web-side ends this spec owns)

- Query key: `queryKeys.plan(groupId, { from, to })` → `[ "toon", "group", groupId, "plan",
  filterKey({from,to}) ]`, added to `apps/web/src/lib/queries.ts` alongside `shoppingLists`.
- `apps/web/src/lib/persist.ts`: add `"plan"` to `PERSISTED_GROUP_SEGMENTS`. The library's week strip
  is on a screen that works offline, so the week has to survive a cold start. **No `PERSIST_BUSTER`
  bump** — adding a key does not change the shape of any existing entry, and busting would throw away
  a working offline shopping cache for nothing.
- `vite.config.ts`: `/api` stays out of `runtimeCaching` and in `navigateFallbackDenylist`. The
  planner needs **no** `NetworkOnly` entry of its own — that list exists to *override* a caching rule,
  and there is none for `/api`.
- Planner writes are **online-only**: no `setMutationDefaults`, no `mutationId`, not in
  `shouldPersistMutation`. Treat them exactly like shopping-list create/rename (`CLAUDE.md`: those are
  "genuinely online-only"). Gate the planner UI on `useCanMutate()` — planner screens are *not*
  shopping screens, so the `useCanMutate()` prohibition does not apply to them.

---

## 3 — Cook tracking (SPEC.md §4.2)

### 3.1 DDL

```sql
CREATE TABLE `recipe_cook_log` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`group_id` text NOT NULL,
	`cooked_by` text NOT NULL,
	`cooked_at` integer NOT NULL,
	`meal_plan_entry_id` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cooked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_plan_entry_id`) REFERENCES `meal_plan_entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recipe_cook_log_recipe_cooked_idx` ON `recipe_cook_log` (`recipe_id`,`cooked_at`);--> statement-breakpoint
CREATE INDEX `recipe_cook_log_group_cooked_idx` ON `recipe_cook_log` (`group_id`,`cooked_at`);--> statement-breakpoint
ALTER TABLE `recipes` ADD `last_cooked_at` integer;--> statement-breakpoint
CREATE INDEX `recipes_group_last_cooked_idx` ON `recipes` (`group_id`,`last_cooked_at`,`created_at`);
```

- **`group_id` is denormalised** (it is derivable through `recipe_id`). It buys "what did this group
  cook lately" as one index range scan instead of a join, and it is how the group cascade stays a
  single sweep. Same reasoning as `shopping_list_items` carrying `list_id` rather than joining up to
  the group.
- **`meal_plan_entry_id` is `ON DELETE set null`, not cascade.** Deleting a plan entry must not delete
  the fact that the meal was cooked. This is the one FK on the new tables that is not a cascade, and
  the reason belongs in the comment.
- **`ALTER TABLE recipes ADD last_cooked_at integer;` needs no SQL-level `DEFAULT`** — it is
  *nullable*. That is the difference from `0003`'s fold columns, which are `NOT NULL` and therefore
  needed `DEFAULT ''` to be addable to a populated table. NULL is the correct, meaningful value here:
  "never cooked". Do not give it a default and do not make it `NOT NULL`.
- **No `cook_count` column.** Nothing in the design renders a count; do not store what nothing reads.

### 3.2 Decision: denormalise `recipes.last_cooked_at`; the log stays the truth

SPEC.md §4.2 Watch offers grouped-max-join or denormalisation. **Denormalise**, for four reasons:

1. **`?sort=lastCooked` is required.** Sorting by a correlated `max()` subquery or by a joined derived
   table cannot use an index, so the planner falls back to `USE TEMP B-TREE FOR ORDER BY` over every
   row in the group — the *exact* failure `recipes_group_title_fold_idx` was created to remove (6.7 ms
   → 1.1 ms, `CLAUDE.md`). A real column plus `recipes_group_last_cooked_idx` supplies the order by
   reverse index scan.
2. **The list envelope's `total` is a `count(*)` that cannot stop early.** Keeping the derivation out
   of the query means the count is untouched, whatever the filters are. A join or subquery in the
   `SELECT` list is cheap; one in the `WHERE`/`ORDER BY` is per-row-of-the-whole-group, and
   `?hasCooked=1` (§3.5) puts it in the `WHERE`.
3. **NULLs sort right for free.** In SQLite, `ORDER BY x DESC` puts NULLs **last**, so
   `[desc(lastCookedAt), desc(createdAt)]` needs no `x is null` leading term — unlike `?sort=rating`,
   which carries one and pays a temp b-tree for it. That is what makes the index usable.
4. **It is the pattern this repo already has three of**: `recipes.title_fold`,
   `shopping_list_items.merge_key`, `shopping_list_catalog.name_key` — derived, stored, written by the
   app, one writer.

Cost of the denormalisation: **one extra `UPDATE` per cook event**, inside the same transaction as the
log insert. Cook events are a handful per group per day. Compare with an index-less sort on every
library render.

Divergence control:
- **Exactly one writer**: `apps/api/src/services/recipes/cookLog.ts` (`recordCooked`, and
  `undoCooked` if adopted). Nothing else may write `recipes.last_cooked_at` — in particular
  `recipePatch()` in `recipes.service.ts` must **not** gain a branch for it, the same way
  `updateUser()` deliberately cannot patch `email_verified_at`.
- **No backfill in `0007`.** The log table is brand new, so `last_cooked_at IS NULL` is correct for
  every pre-existing recipe. State that in the migration header — an *absent* backfill has to look
  deliberate, because `0003`'s presence sets the opposite expectation.
- **A test pins the agreement** (§7.2): after a series of cooks (and an undo), for every recipe
  `recipes.last_cooked_at` equals `max(cooked_at)` of its log rows, or is NULL when it has none.

### 3.3 Measurement (the standard this repo holds itself to)

The comment on `recipes.last_cooked_at` must carry real numbers, the way the `recipes` table comment
carries 32 ms / 91 ms / 9 ms. Measure it, do not guess it. Procedure:

1. Seed a scratch **file** DB (not `:memory:` — the PRAGMAs and the storage engine are part of what is
   being measured): 2000 recipes in one group, ~6000 `recipe_cook_log` rows spread over 400 of them,
   the same population the search numbers were taken on.
2. Time the median of 20 runs of each of the three shapes, through `@libsql/client` (`client.execute`)
   so the driver in the measurement is the driver in production:
   - **(a) correlated subquery**: `select *, (select max(cooked_at) from recipe_cook_log l where
     l.recipe_id = r.id) as last from recipes r where r.group_id = ? order by last desc limit 24`
     plus its `count(*)` half.
   - **(b) grouped-max left join**: `... left join (select recipe_id, max(cooked_at) m from
     recipe_cook_log group by recipe_id) g on g.recipe_id = r.id ... order by g.m desc`.
   - **(c) the stored column**: `select * from recipes where group_id = ? order by last_cooked_at
     desc, created_at desc limit 24`.
3. Record all three medians in the schema comment, plus the `explain query plan` line for (c) showing
   `recipes_group_last_cooked_idx` and no `TEMP B-TREE`.
4. The committed regression guard is the **plan**, not the time — copy
   `test/recipes-search.test.ts`'s "the title sort reads its order from an index, not a temp B-tree"
   test verbatim in shape. Timings in a test are flaky; a plan assertion is not.

Expected direction (state it as an expectation until measured, then replace with the figure): (a) and
(b) both sort the whole group and cost tens of milliseconds at 2000 recipes and grow linearly; (c) is
an index scan of 24 rows and is flat.

### 3.4 `POST …/recipes/:recipeId/cooked`

In `apps/api/src/routes/recipes.ts`, after the `/image` route:

```ts
/**
 * POST /recipes/:recipeId/cooked — "Gekocht": append a log row, bump
 * `recipes.last_cooked_at`, and stamp the plan entry the client names (or the one
 * for `plannedOn`, if it sent a date). NEVER guesses the date — see calendar.ts.
 */
recipeRoutes.post(
  "/recipes/:recipeId/cooked",
  zValidator("json", MarkCookedRequestSchema, onValidationError),
  async (c) => {
    const membership = requireMembership(c);
    const user = requireUser(c);
    return json(c, await recordCooked(db, membership.groupId, user.id, c.req.param("recipeId"), c.req.valid("json")));
  },
);
```

The request body is optional-everything, so a bare `POST` with `{}` works (the phone's 52 px check
button):

```ts
export const MarkCookedRequestSchema = z.object({
  /** The calendar date the cook happened, in the USER's calendar. Optional. */
  plannedOn: PlanDateSchema.optional(),
  /** The plan entry to stamp, when the client knows it (the /plan screen does). */
  mealPlanEntryId: IdSchema.optional(),
  /** Overrides `Date.now()` for the log row — NOT offered; see below. */
});
export type MarkCookedRequest = z.infer<typeof MarkCookedRequestSchema>;

export const RecipeCookedResponseSchema = z.object({
  recipeId: IdSchema,
  cookedAt: IsoDateSchema,
  lastCookedAt: IsoDateSchema,
  /** The stamped plan entry, or null when the recipe was not on the plan that day. */
  mealPlanEntry: MealPlanEntrySchema.nullable(),
});
```

(Both in `packages/shared/src/schemas/plan.ts` — they straddle recipes and the planner and the planner
file is the one that already imports `PlanDateSchema`. Re-export nothing; `index.ts` flattens.)

`cooked_at` is `nowMs()` on the server: it is an **instant**, and the server's clock is the one
authority for "when". Only the *date* is the client's. There is no client-supplied `cookedAt` — that
would let a phone with a wrong clock reorder "Recently cooked".

`recordCooked` in `apps/api/src/services/recipes/cookLog.ts` (NEW), inside one `withTransaction`:

1. `loadRecipeRow(db, groupId, recipeId)` → 404.
2. Insert the log row (`id: crypto.randomUUID()`, `cookedAt: nowMs()`, `cookedBy: userId`,
   `groupId`, `mealPlanEntryId`: resolved below or null).
3. Resolve the entry to stamp: `mealPlanEntryId` if sent (verified in-group via
   `loadPlanEntryRow`, and that it points at this recipe → else 404); otherwise
   `findPlanEntryForRecipeOnDay(tx, groupId, recipeId, plannedOn)` **if and only if** `plannedOn` was
   sent; otherwise null. Stamp `cooked_at = <the log row's cookedAt>` and `updated_at`.
4. `update(recipes).set({ lastCookedAt: <cookedAt> }).where(eq(recipes.id, recipeId))` — a plain set,
   not a `max()`: step 2's timestamp is `nowMs()` and is therefore the newest by construction.
   (`undoCooked` is the one path that must recompute; see below.)
5. `updatedAt` on `recipes` is **not** touched. "Cooked" is not an edit of the recipe, and bumping it
   would reorder `?sort=newest` and make every cook look like a content change to the offline cache.
   Worth a comment — it is the kind of thing that reads like an omission.

**Undo.** Not in the design and not in SPEC.md, but "Cooked" is a one-tap irreversible write next to
"Cook mode" on a phone, and a mis-tap is likely. Recommended (flagged in §9 as a decision to
confirm): `DELETE /api/groups/:groupId/recipes/:recipeId/cooked`, which deletes **the caller's own**
most recent log row for that recipe if it is younger than `COOK_UNDO_WINDOW_MS` (10 min), clears the
plan entry's `cooked_at` when that row was the one that stamped it, and then **recomputes**
`recipes.last_cooked_at` from `select max(cooked_at) from recipe_cook_log where recipe_id = ?`
(NULL when none remain). 404 `not_found` + `server.recipes.nothingToUndo` when there is nothing in the
window. No new wire code.

### 3.5 `lastCookedAt` on the wire, `?sort=lastCooked`, `?hasCooked=1`

- `packages/shared/src/schemas/recipe.ts`, `RecipeSchema`: add
  ```ts
  /**
   * When this recipe was last cooked, from `recipe_cook_log` — read-only, derived,
   * never sent back on a write. Stored on the row (`recipes.last_cooked_at`) rather
   * than computed per query, because `?sort=lastCooked` would otherwise sort the whole
   * group in a temp b-tree; see the column comment in apps/api/src/db/schema.ts.
   */
  lastCookedAt: IsoDateSchema.nullish(),
  ```
  It therefore appears on `RecipeListItem` and `RecipeDetail` for free (both extend `RecipeSchema`),
  which is what the detail stat row (`Last cooked · 3 days ago`) and the phone 4-up grid
  (`Cooked · 3 d ago`) need. `nullish()`, so an older client parsing a newer server is unaffected and
  a never-cooked recipe is `null`.
- `RecipeSortSchema`: `z.enum(["newest","oldest","title","rating","time","lastCooked"])`.
- `RecipeListQuerySchema`: add a `hasCooked` flag. **Not `z.coerce.boolean()`** — it turns the
  string `"0"` into `true`, which is a live trap for a query param. Use an explicit enum:
  ```ts
  /** `1` restricts the list to recipes that have been cooked at least once. */
  hasCooked: z
    .enum(["0", "1"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "1")),
  ```
- `apps/api/src/services/recipes/mappers.ts`, `toRecipe`: add
  `lastCookedAt: toIsoOrNull(row.lastCookedAt),` (import `toIsoOrNull` from `../../lib/http.ts` —
  `toIso` is already imported).
- `apps/api/src/services/recipes/recipes.service.ts`, `orderFor`:
  ```ts
  case "lastCooked":
    // NULLs sort LAST under DESC in SQLite, so this needs no `is null` leading term —
    // which is exactly what lets `recipes_group_last_cooked_idx` supply the order by a
    // reverse scan. `?sort=rating` pays a temp b-tree for its `is null`; this must not.
    return [desc(recipes.lastCookedAt), desc(recipes.createdAt)];
  ```
- `listRecipes`, next to the `difficulty` filter:
  ```ts
  if (query.hasCooked === true) conditions.push(isNotNull(recipes.lastCookedAt));
  ```
  A column predicate, not a subquery — the `count(*)` half stays a plain index-narrowed count.
- `apps/web/src/router.tsx`, `RECIPE_FILTER_PARAMS`: **no new entry.** `sort` is already listed, so
  `?sort=lastCooked` survives `pick()`. `hasCooked` is deliberately **not** a URL filter — it exists
  only for the "Recently cooked" carousel's own query, which is component state, and adding it to
  `RECIPE_FILTER_PARAMS` would put a mode in the URL that no UI can clear. If a later phase adds a
  "nur schon gekochte" toggle to "Erweiterte Suche", *that* is when it gets its line — and it needs
  one, or `pick()` drops it.

### 3.6 "Recently cooked" carousel: no new endpoint

SPEC.md §4.2 shows a 5-entry carousel (`renderVals.recent`: `title` + `when`). That is exactly
`GET /api/groups/:groupId/recipes?sort=lastCooked&hasCooked=1&limit=5` — index-served, already
paginated, already persisted offline (`"recipes"` is in `PERSISTED_GROUP_SEGMENTS`), already returns
`thumbnailUrl`, and `when` is `lastCookedAt` formatted client-side. **Do not add a cook-log read
endpoint**, and do not group by recipe in SQL: the stored column has already collapsed the log to one
row per recipe, which is the dedupe the carousel needs.

Consequence worth writing down: `recipe_cook_log` is, today, **write-mostly**. Its reads are the undo
window (§3.4) and the recompute after an undo. It still earns its place — it carries `cooked_by`
(which a single column cannot), it is what makes `last_cooked_at` recomputable, and D-per-SPEC §4.2
mandates "a log, not a column". Say that plainly in the table comment so a later reader does not
delete it as unused.

---

## 4 — Course dimension (D5, SPEC.md §4.4)

### 4.1 `tags.kind`

Migration `0008_tag_kind.sql`:

```sql
-- Category becomes a DIMENSION of a tag (D5). SQLite cannot add a NOT NULL column to a
-- populated table without a SQL-level default, hence DEFAULT 'free' — and unlike
-- 0003's fold columns, here the drizzle schema KEEPS the default too: 'free' is the
-- right value for every existing insert site, so the default is what lets those three
-- sites compile unchanged instead of forcing a decision they do not have.
--
-- The VOCABULARY ('Hauptspeise', 'Beilage', ...) is CONTENT: German, viewer-independent,
-- never routed through t(). Only the filter rail's heading is interface.
ALTER TABLE `tags` ADD `kind` text DEFAULT 'free' NOT NULL;
```

Drizzle:

```ts
export const tags = sqliteTable(
  "tags",
  {
    // ...
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
     * KEEPS its drizzle default, unlike `recipes.title_fold`: 'free' is correct for
     * every existing insert site, so the default is a feature here rather than the
     * silent-NULL hazard it would be there.
     */
    kind: text("kind").notNull().default("free").$type<TagKind>(),
  },
  // indexes unchanged
);
```

**No new index.** Courses are read as `where group_id = ? and kind = 'course'`;
`tags_group_id_idx` already narrows to the group and a group holds tens of tags, so the `kind` test is
a residual scan of a handful of rows. A `(group_id, kind)` index would be dead weight on a table that
is written on every recipe save. Record the judgement so it is not re-litigated.

`$type<TagKind>()` needs `import type { TagKind } from "@toon/shared"` in `schema.ts` (which already
imports types from there).

**Sites `tsc` will now fail, and must be updated** (this is the point of `TagRow` being
`$inferSelect`):
- `apps/api/src/services/recipes/tags.service.ts` — `createTag`'s `const row: TagRow = {…}` (add
  `kind: input.kind ?? "free"`), `getOrCreateTagIds`'s `const row: TagRow = {…}` (add `kind`, see
  below), `updateTag`'s `patch` (allow `kind`).
- `apps/api/src/services/recipes/mappers.ts` — `toTag` must pass `kind: row.kind` through.
- `apps/api/scripts/seed.ts` — the `db.insert(tags).values({…})` call (§4.4).

### 4.2 Shared schema changes

`packages/shared/src/schemas/recipe.ts`:

```ts
/**
 * What a tag IS, not what it is called.
 *
 * `course` = the recipe's single category, drawn as the honey eyebrow above the title.
 * `free`   = an ordinary tag, drawn in the filter rail's second half.
 *
 * The VALUES are the wire contract; the tag NAMES they classify are German CONTENT and
 * are never translated (see docs/i18n.md and CLAUDE.md's interface-vs-content gotcha).
 */
export const TagKindSchema = z.enum(["course", "free"]);
export type TagKind = z.infer<typeof TagKindSchema>;

export const TagSchema = z.object({
  // ...
  kind: TagKindSchema,          // required: every row has one after migration 0008
  // ...
});

export const CreateTagRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  kind: TagKindSchema.optional(),      // default 'free' server-side
});
```

`UpdateTagRequestSchema` is `CreateTagRequestSchema.partial()` and therefore accepts `kind` with no
further change — promoting an existing free tag to a course is how an operator adopts the feature on
an existing library.

**The recipe's course, and how PATCH keeps working.** `CreateRecipeRequest.tags` is a list of *names*
that `getOrCreateTagIds` creates as `free`. If the recipe form's course picker went through that list,
a brand-new "Dessert" would be created as `free` and the eyebrow would silently not appear. So the
recipe request gains one field:

```ts
// CreateRecipeRequestSchema
/**
 * The recipe's category — a tag NAME, created inside the group as `kind:'course'` if
 * it does not exist. German content; never a catalog key.
 *
 * Separate from `tags` because `tags` creates FREE tags: routing the course through it
 * would create "Dessert" with kind 'free' and lose the eyebrow.
 */
course: z.string().trim().min(1).max(60).nullish(),
```

Semantics, and they need a line in `docs/API.md` next to the existing replace-all note:

- `course` **absent** → the course link is untouched. (`UpdateRecipeRequestSchema` is
  `.partial()` and `course` has **no** `.default()`, so absent really is `undefined` — it must **not**
  be added to `keepOnlySentKeys`'s list in `routes/recipes.ts`, which exists only for the child arrays
  that carry `.default([])`.)
- `course: null` → the course link is removed. The tag row survives; only `recipe_tags` changes.
- `course: "Dessert"` → get-or-create with `kind:"course"`, then that is the recipe's only course
  link.
- **`tags` replace-all must stop deleting the course link.** `replaceTags` in
  `recipes.service.ts` currently does `delete from recipe_tags where recipe_id = ?`. Change it to
  delete only the **free** links:
  ```ts
  await tx.delete(recipeTags).where(
    and(
      eq(recipeTags.recipeId, recipeId),
      inArray(
        recipeTags.tagId,
        tx.select({ id: tags.id }).from(tags).where(and(eq(tags.groupId, groupId), eq(tags.kind, "free"))),
      ),
    ),
  );
  ```
  …and a sibling `replaceCourse(tx, groupId, recipeId, courseName)` that replaces the single
  `kind:'course'` link. Without this split, `PATCH { tags: [...] }` from the recipe form would drop
  the category on every save.
- **An older client keeps working.** A client that sends every tag name in `tags`, course included,
  hits `getOrCreateTagIds(..., "free")`; that function matches by folded name, finds the existing
  course tag and links it *without changing its kind*. The link exists, the eyebrow renders. Only a
  brand-new course name from an old client would land as `free` — acceptable, and self-correcting the
  moment anyone edits it in the tag screen. Note this in `docs/API.md`.

`getOrCreateTagIds` gains a fourth parameter:
```ts
export async function getOrCreateTagIds(
  db: DbLike,
  groupId: string,
  names: readonly string[],
  kind: TagKind = "free",   // only applied to tags this call CREATES
): Promise<string[]>
```
The default keeps the two existing call sites (`replaceTags`, `import/commit.ts`) compiling and
behaving identically. It must **never** update the kind of a tag it found — renaming a dimension out
from under the group is not what "create this recipe" asked for.

### 4.3 The eyebrow's derivation — `packages/shared/src/tags.ts` (NEW)

Pure, unit-tested, used by the list rows, the detail header and the mobile hero. Export from
`index.ts`.

```ts
/**
 * The single uppercase eyebrow above a recipe title: `Hauptspeise · Eintopf`.
 *
 * The first segment is the recipe's `kind:'course'` tag; the second is its first FREE
 * tag, which is what the artboards draw (`Vegan · Pasta`, and a bare `Beilage` where
 * there is no second). BOTH SEGMENTS ARE CONTENT — raw German tag names, rendered
 * verbatim, never keyed. The only interface decision here is the separator, and it is
 * the same "·" in both languages.
 *
 * A recipe with NO course tag returns `{ course: null }` and MUST render no eyebrow at
 * all — not an empty one, not a placeholder (SPEC.md §4.4).
 */
export function recipeEyebrow(
  tags: ReadonlyArray<{ name: string; kind: TagKind }>,
): { course: string | null; detail: string | null };
```

Input order matters and is already right: `tagsByRecipe` in `tags.service.ts` orders by
`asc(tags.name)`, so "the first free tag" is deterministic (alphabetical) rather than
insertion-ordered. Say so in the doc comment — it is the reason the function needs no sort of its own.

**No DB constraint enforces one course per recipe.** A trigger or an app-level check on every tag
write would cost more than the failure mode is worth; two course tags simply means the eyebrow shows
the alphabetically first. The recipe form offers a single-select, which is where the invariant
actually lives.

### 4.4 Seed (`apps/api/scripts/seed.ts`)

The three existing tags stay exactly as they are (installs already have them, and the seed is
idempotent by name), with `kind: 'free'`. Add the course vocabulary and link one to each demo recipe:

```ts
const freeTagNames = ["Hauptgericht", "Backen", "Vegetarisch"] as const;
// COURSE vocabulary — German content, matching the design's eyebrow (SPEC.md §4.4).
const courseTagNames = ["Hauptspeise", "Beilage", "Dessert", "Suppe", "Auflauf"] as const;
```

The existing get-or-create loop gains the `kind` on insert:
```ts
await db.insert(tags).values({ id, groupId, name, kind, createdAt: now });
```
and `DemoRecipe` gains `course: string` — `"Hauptspeise"` for *Klassische Pfannkuchen*, `"Dessert"`
for *Schneller Schokokuchen*, `"Auflauf"` for the third. The link is one more row appended to the
existing `links` array. Console output stays English literals (`CLAUDE.md`: ops output is one
language) — the tag NAMES inside it are data, not copy.

### 4.5 The rail's per-course counts: no new query at all

`GET /api/groups/:groupId/tags` already answers with `recipeCount` per tag from **one** grouped
query (`listTags`: `tags LEFT JOIN recipe_tags GROUP BY tags.id ORDER BY name`). With `kind` on the
row — and `listTags` already does `.select({ tag: tags, … })`, i.e. the whole row — the rail's
`courseFilters` (`Hauptspeise 21`, `Beilage 6`, …) and `tagFilters` are a **client-side partition of
the response it already fetches**. Cost: unchanged, zero new round trips, and it is already in
`PERSISTED_GROUP_SEGMENTS` (`"tags"`), so the rail works offline.

Two consequences to write into the code and the PR:

- **The counts are group-wide, not filtered by the active search.** That matches the artboard
  (`Hauptspeise 21` next to `37` total). Do **not** recompute them per filter state — that is a
  `count(*)` per course per keystroke against a serialised lane.
- Selecting a course in the rail uses the **existing** `?tags=<tagId>` URL param (a recipe must carry
  all requested tag ids). No new query param, no `RECIPE_FILTER_PARAMS` line, no server change.

---

## 5 — Sidebar counts (SPEC.md §4.7)

The design shows three numbers. Two of them already exist and the third needs no new endpoint.

| Number in the design | Where it comes from | Server work |
| --- | --- | --- |
| Group switcher `2 members · 37 recipes` | `GroupWithRole.memberCount` / `.recipeCount`, already on every group in the bootstrap payload (`loadUserGroups` in `apps/api/src/services/auth/bootstrap.ts`, two correlated `count(*)` subselects in ONE query) and on `GET /api/groups` | **none** |
| Sidebar `Recipes 37` | the same `activeGroup.recipeCount` — `useActiveGroup()` in `apps/web/src/lib/session.tsx`; `RecipeListPage` already renders it via `recipes.list.groupSummary` | **none** |
| Sidebar `Shopping 10` | sum of `ShoppingList.itemCount` from `GET /api/groups/:groupId/shopping-lists` (`listShoppingLists`: ONE grouped `count()` over `shopping_lists LEFT JOIN shopping_list_items`, no item bodies) | **none** |

So §4.7 needs **no new endpoint, no new table, no new column**. That is the answer to "specify a cheap
group summary": the cheap summary already exists, twice, and a third endpoint would be a fourth query
on a single serialised lane for numbers the client already holds.

**How often each is fetched, and how it is cached.**

- `me` (`["toon","me"]`) is fetched once per app start plus on reconnect and on window focus per the
  existing query defaults, and is **persisted** — so the sidebar renders `37` in airplane mode.
- `shoppingLists` (`["toon","group",<id>,"shopping-lists"]`) is one query key **shared with the
  `/shopping` screen**. The sidebar mounting it on the library screen therefore costs one request per
  app session, not one per screen: TanStack serves the second consumer from cache, `staleTime`
  suppresses the refetch, and the key is in `PERSISTED_GROUP_SEGMENTS` so it survives a cold start.
  It is `NetworkOnly` in the service worker and must stay so (`CLAUDE.md`) — the sidebar changes
  nothing about that.

**The one real bug this exposes, and its fix.** `invalidateAfterRecipeMutation`
(`apps/web/src/lib/queries.ts:359`) invalidates `recipes`, `tags`, `collections`, `groups` and the
recipe — but **not** `me`. The sidebar and the group switcher read the count from `me`, so today the
count sticks at 37 after the 38th recipe is saved. Add `invalidate.me(qc)` to that function's
`Promise.all`. It costs one bootstrap query (one row per group, two correlated counts) per recipe
create/delete/import-commit, which is the cheapest correct option — cheaper than a dedicated summary
endpoint, and it also fixes the same staleness on `/groups` and `GroupDetailPage`.

**Rejected: `GET /api/groups/:groupId/summary`.** It would duplicate two counts that already ride the
bootstrap, add a third query per screen to a single-lane database, and need its own invalidation
plumbing — for one number (`Shopping 10`) that an existing, already-cached, already-persisted query
answers. Rejected also: adding `openShoppingItems` to `loadUserGroups`'s subselects, which would make
the *bootstrap* pay a join for every group the user is in, on every app start and every reconnect,
to render a number that is only visible while the sidebar is on screen.

**`Plan [New]`** carries a honey pill, not a count — no data. Drop the pill once the feature is no
longer new; it is a static flag in `nav-items.ts`, not a server field.

---

## 6 — Cross-cutting

### 6.1 `docs/API.md`

- New section **"Meal plan — `apps/api/src/routes/plan.ts`"** after "Recipes", with the §2.5 table,
  plus notes: `plannedOn` is a calendar date and whose calendar it is; the range response is not the
  paginated envelope and why; POST is idempotent (200 vs 201); any member may edit any entry.
- "Recipes" table: add `POST …/recipes/:recipeId/cooked` (and the undo, if adopted).
- "Recipes" notes: `lastCookedAt` is derived and read-only; `?sort=lastCooked`; `?hasCooked=1`;
  `course` PATCH semantics and the "`tags` replaces only free links" rule; the older-client note from
  §4.2.
- "Tables" section: add `meal_plan_entries` and `recipe_cook_log` to the table list; add
  `meal_plan_entries(group_id, planned_on, recipe_id)` to the unique-index list; add one paragraph
  saying `meal_plan_entries.planned_on` is the single non-instant date column and why.

### 6.2 Server catalog keys (both files, or it does not compile)

`packages/shared/src/i18n/catalogs/server.de.ts` and `server.en.ts`. `en` is typed
`LocaleCatalog<ServerCatalog>`, so a key in one and not the other is a **compile** error — add both in
the same commit. New German copy has no base-tree counterpart, so `bun run i18n:check` parity will
flag every one of these; that is expected (class 1 false positive in `CLAUDE.md`'s list) and the
output must be read, not just the exit code.

```ts
/* ------------------------------- meal plan ------------------------------ */
"server.plan.entryNotFound": "Eintrag im Wochenplan nicht gefunden",
"server.plan.invalidDate": "Bitte ein Datum im Format JJJJ-MM-TT angeben",
"server.plan.rangeInvalid": "Das Startdatum muss vor dem Enddatum liegen",
"server.plan.rangeTooLong": "Der Zeitraum darf höchstens {max} Tage umfassen",
"server.plan.dayFull": "Für einen Tag sind nicht mehr als {max} Rezepte möglich",
"server.plan.alreadyPlanned": "Dieses Rezept steht an diesem Tag schon auf dem Plan",
```

```ts
/* ------------------------------- meal plan ------------------------------ */
"server.plan.entryNotFound": "Meal plan entry not found",
"server.plan.invalidDate": "Please provide a date in the format YYYY-MM-DD",
"server.plan.rangeInvalid": "The start date must be before the end date",
"server.plan.rangeTooLong": "The range may cover at most {max} days",
"server.plan.dayFull": "No more than {max} recipes can be planned for one day",
"server.plan.alreadyPlanned": "This recipe is already planned for that day",
```

Plus, in the existing `server.recipes.*` block, only if the undo is adopted:
`"server.recipes.nothingToUndo": "Es gibt keinen Kochvorgang, der zurückgenommen werden kann"` /
`"There is no cook entry that can be undone"`.

`{max}` is filled at the call site (`ApiError.conflict("meal_plan_day_full", { key:
"server.plan.dayFull", values: { max: PLAN_LIMITS.entriesPerDay } })`), exactly like
`server.shopping.tooManyLists`. `refineKey()` takes a bare key with no values, so the two range
refinements render `{max}` unsubstituted — hand them a key **without** a placeholder instead:
make `server.plan.rangeTooLong` read `"Der Zeitraum darf höchstens 62 Tage umfassen"` / `"The range
may cover at most 62 days"` with the number inline, and put `PLAN_LIMITS.rangeDays` in a comment above
the key noting the two must move together. (The alternative — plumbing values through `refineKey` —
changes the i18n runtime for one string.)

### 6.3 `ERROR_CODES`

`packages/shared/src/schemas/common.ts` — **one** addition. A code is a wire contract and is never
renamed, so mint as few as possible:

```ts
/** A single day already holds `PLAN_LIMITS.entriesPerDay` planned recipes. */
"meal_plan_day_full",
```

Everything else reuses an existing code:
- entry / recipe not found → `not_found` (with the right catalog key)
- the same recipe moved onto a day that already has it → `conflict` + `server.plan.alreadyPlanned`
- bad date, reversed range, over-long range, `noChanges` → `validation_failed` (422) through Zod
- unconfirmed address on a planner write → `email_unverified`, from the existing middleware

### 6.4 Web-side contract ends this spec owns (four lines, no more)

1. `apps/web/src/lib/queries.ts` — `queryKeys.plan(groupId, range)` + `planQuery` + `invalidate.plan`.
2. `apps/web/src/lib/persist.ts` — `"plan"` in `PERSISTED_GROUP_SEGMENTS`. No `PERSIST_BUSTER` bump.
3. `apps/web/src/lib/queries.ts` — `invalidate.me(qc)` inside `invalidateAfterRecipeMutation` (§5).
4. `apps/web/src/router.tsx` — **no** `RECIPE_FILTER_PARAMS` change (§3.5 explains why, and when a
   later phase would need one).

Everything else on the web side — the strip, the `/plan` screen, the rail, the eyebrow component, the
`Cooked` buttons, `nav-items.ts` — belongs to the frontend areas.

---

## 7 — Verification

### 7.1 DDL must be verified through `@libsql/client`, never `bun:sqlite`

`bun:sqlite` is SQLite **3.53**; libSQL bundles **3.45.1**. A statement that 3.53 accepts and 3.45.1
rejects passes locally and fails on deploy — `ADD COLUMN … GENERATED ALWAYS AS (…) STORED` is exactly
that trap. **There is no generated column anywhere in this spec** and none may be added.

Run this before committing a migration (scratch file DB, not `:memory:`, and not through a pipe):

```bash
cd apps/api
bun -e '
  const { createClient } = await import("@libsql/client");
  const c = createClient({ url: "file:/tmp/ddl-probe.db" });
  const sql = await Bun.file("drizzle/0006_meal_planner.sql").text();
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const s = stmt.replace(/^\s*--.*$/gm, "").trim();
    if (s) await c.execute(s);
  }
  console.log((await c.execute("select sqlite_version()")).rows);
  console.log((await c.execute("pragma index_list(meal_plan_entries)")).rows);
' ; echo "exit=$?"
```

Expect `3.45.1` and the three index names. Repeat for `0007` and `0008` against the same file, in
order. Then the real gate: `bun run db:migrate` and `bun run seed` against a fresh `file:` DB, plus
the curl walkthrough in `README.md`.

### 7.2 API tests — `apps/api/test/`, never `tests/`

`apps/api/tsconfig.json` includes `test/**` only, so a file under `tests/` is invisible to
`bun run typecheck`. Copy the harness helpers from `test/recipes-search.test.ts` (`createUser`,
`call`, `createGroup`, `createRecipe`) — this repo duplicates them per file rather than sharing a
factory; follow that. `await runMigrations(db)` at the top of each file.

**`test/plan.test.ts`** (new)
- POST creates an entry; the response carries `plannedOn` **verbatim** (`"2026-09-10"`, not an ISO
  instant) and the slim `recipe` with a `thumbnailUrl`.
- POST twice with the same `(plannedOn, recipeId)` → 200 the second time, one row in the table,
  `servings` from the second call applied.
- POST with `PLAN_LIMITS.entriesPerDay` already on the day → 409 `meal_plan_day_full`; the message is
  asserted in **both** negotiated locales (`Accept-Language: de` and `en`), like `test/cards.test.ts`
  pins its keys.
- POST with a recipe id from another group → 404, and the body never names the other group.
- PATCH `plannedOn` moves the entry and re-tails its `position` on the target day; moving onto a day
  that already has that recipe → 409 `conflict`.
- GET range: flat, ordered by `(plannedOn, position)`; a day with nothing planned is simply absent
  (the seven-slot week is the client's job).
- GET with `to < from` → 422; with `to - from >= PLAN_LIMITS.rangeDays` → 422; with
  `from=2026-02-31` → 422 (the `isPlanDate` refinement, keyed `server.plan.invalidDate`).
- Verified-email gate: with `setVerifiedEmailRequired(true)` an unconfirmed account gets **403
  `email_unverified`** on POST/PATCH/DELETE and **200** on GET. `afterAll(() =>
  setVerifiedEmailRequired(null))` — `bun test` runs every file in one process and a leaked seam
  changes every later file (`CLAUDE.md`).
- Cascades: deleting the recipe removes its entries; deleting the group removes them all.
- `explain query plan` for the range query contains `meal_plan_entries_group_date_idx` and **not**
  `TEMP B-TREE` — the same shape as the existing title-sort plan test.

**`test/recipes-cooked.test.ts`** (new)
- POST `…/cooked` appends exactly one `recipe_cook_log` row with `cooked_by` = the caller, and sets
  `recipes.last_cooked_at` to that row's `cooked_at`.
- `lastCookedAt` appears on **both** the list item and the detail payload, as an ISO string, `null`
  before the first cook.
- With `plannedOn` naming a day the recipe is planned on → that entry's `cooked_at` is stamped and
  returned in `mealPlanEntry`. **Without** `plannedOn` and without `mealPlanEntryId` → no entry is
  stamped and `mealPlanEntry` is `null`. This is the test that pins "the server never guesses today".
- `mealPlanEntryId` pointing at another recipe's entry → 404.
- `?sort=lastCooked`: cooked recipes newest-first, never-cooked **last**; `?hasCooked=1` returns only
  the cooked ones and `total` equals `items.length`.
- `recipes.updated_at` is unchanged by a cook (so `?sort=newest` does not reorder).
- Deleting a plan entry leaves the log row with `meal_plan_entry_id IS NULL` (set null, not cascade).
- **The agreement test**: after several cooks across several recipes (and an undo, if adopted), for
  every recipe `last_cooked_at` equals `max(cooked_at)` of its log rows, or is NULL with no rows.
- `explain query plan` for `where group_id = ? order by last_cooked_at desc, created_at desc limit
  24` contains `recipes_group_last_cooked_idx` and **not** `TEMP B-TREE`.

**`test/tags-kind.test.ts`** (new, or a `describe` appended to `test/recipes.test.ts`)
- A tag created with no `kind` is `free`; `POST /tags {kind:"course"}` is a course;
  `PATCH /tags/:id {kind:"course"}` promotes an existing free tag.
- `POST /recipes {course:"Dessert", tags:["Backen"]}` creates "Dessert" with `kind:'course'` and
  "Backen" with `kind:'free'`, and links both.
- `PATCH /recipes/:id {tags:["Sommer"]}` **keeps** the course link (the §4.2 free-only delete).
- `PATCH /recipes/:id {course:null}` removes the course link and leaves the tag row.
- `GET /tags` returns `kind` and per-tag `recipeCount` in one response (the rail's data).
- An old-client shape — `tags` containing the course name, no `course` field — still links the
  existing course tag and does **not** flip its kind.

### 7.3 Shared unit tests

- **`packages/shared/src/calendar.test.ts`** (new) — the file that stops "Thursday" drifting:
  - `toPlanDate(new Date(2026, 8, 8, 23, 30))` is `"2026-09-08"`. This is the `toISOString()` trap: in
    Europe/Berlin that instant is `2026-09-08T21:30Z`, but at 01:30 local it would be the *previous*
    UTC day. Add a second case at `new Date(2026, 8, 8, 0, 30)`.
  - `addPlanDays("2026-03-28", 1) === "2026-03-29"` and `addPlanDays("2026-03-29", 1) ===
    "2026-03-30"` — the spring-forward boundary a `+ 86_400_000` on a local `Date` gets wrong.
    Likewise `2026-10-24` → `2026-10-25` → `2026-10-26`.
  - Month, year and leap boundaries: `2026-01-31 +1`, `2026-12-31 +1`, `2028-02-28 +1`.
  - `startOfPlanWeek` returns the Monday for each of the seven days of one week; `planWeek` returns
    seven ascending dates starting Monday.
  - `isPlanDate` rejects `"2026-02-31"`, `"2026-2-3"`, `"26-02-03"`, `"2026-02-03T00:00:00Z"`, `""`.
  - `planDaysBetween` is symmetric-with-sign and 0 for the same date.
  - A run under a non-Berlin `TZ` (`TZ=Pacific/Kiritimati bun test packages/shared/src/calendar.test.ts`,
    UTC+14) is worth doing by hand once; do **not** commit a TZ-dependent test, since `bun test` reads
    `TZ` at process start and one file cannot set it for itself.
- **`packages/shared/src/tags.test.ts`** (new) — `recipeEyebrow`: course + first free tag; course
  only; **no course → `{ course: null }`** (the case that must render nothing at all); two course tags
  → alphabetically first; empty array.

### 7.4 Gates

All five, and `i18n:check` is read rather than exit-coded:

```bash
bun install
bun run typecheck      # packages/shared, apps/api, apps/web (three projects)
bun test               # 1058 today; this area adds ~45
bun run build
bun run i18n:check     # expect parity hits for the six new server.plan.* keys — class 1
```

Plus, because this touches persistence: `bun run db:migrate` and `bun run seed` against a fresh
`file:` DB, then the README curl walkthrough. Nothing here touches the Dockerfile, compose or
`staticWeb.ts`, so no image build is required.

---

## 8 — Conflicts with other areas

| With | What | Recommendation |
| --- | --- | --- |
| shopping-backend (§4.3/§4.5/§4.6) | **Migration numbers are one ordered resource.** Two agents generating against the same `drizzle/meta` chain produce two `0006_*` files and a broken `_journal.json`. | Serialise: whoever runs `bun run db:generate` second re-generates on top of the first's snapshot. Do not hand-edit snapshots. Reserve `0006`–`0008` for this area only if this area lands first; otherwise renumber. |
| shopping-backend (§4.5) | "From this week's plan" needs the week's planned recipes **and** the target list's `merge_key`s. | The endpoint lives in the **shopping** router (`GET …/shopping-lists/:listId/plan-suggestions?from&to`); it imports `listPlanEntries(db, groupId, from, to)` from `services/plan/plan.service.ts`. The planner exports the read; it does not own the diff. `from`/`to` come from the client, same calendar rule as everywhere. |
| shopping-backend (§4.5) | Which list is "the list" for "not yet on a list". | Take `:listId` in the path — no implicit default list. The client passes the last-opened list (localStorage), falling back to the alphabetically first. Do not invent a `shopping_lists.is_default` column. |
| frontend (shell, §4.7) | `nav-items.ts` gains `/plan` and the `NavItem["to"]` union; `Plan` takes Import's tab and Import moves to the library `+` sheet. | Frontend's call; the server is unaffected. The `New` pill is a static flag in `nav-items.ts`, **not** a server field. |
| frontend (recipes) | The eyebrow and the rail. | Consume `recipeEyebrow()` and `Tag.kind`; do **not** build a second course lookup, and do **not** send course names through `t()`. |
| frontend (recipes) | `lastCookedAt` rendering (`3 days ago` / `3 d ago`). | Relative-time formatting is **interface** and takes a locale, like `formatDuration(minutes, locale)`. It belongs in `apps/web/src/lib/format.ts` with catalog keys, not in this area. |

---

## 9 — Open questions (each with a recommendation)

1. **Undo for "Cooked".** Not drawn, not in SPEC.md. One tap, irreversible, next to "Cook mode" on a
   phone. *Recommendation: ship the 10-minute, own-row-only `DELETE …/recipes/:recipeId/cooked` from
   §3.4* — it is ~30 lines, needs no new wire code, and the alternative is a write the user cannot take
   back.
2. **`meal_plan_entries.note`.** Included as a nullable column but drawn nowhere. *Recommendation:
   keep the column, ship the `/plan` screen without the field, and say so in the PR* — a nullable
   column costs nothing and the alternative is a migration for "Reste vom Vortag".
3. **The `/plan` screen has no artboard at all** (SPEC.md §4.1 Watch). Its day-card states, tokens and
   type come from the library strip; its layout does not exist. *Recommendation: a week column view on
   desktop and a scrollable day list on phone, assembled from the three drawn card states, and called
   out explicitly in the PR as extrapolated.* Frontend's call, recorded here because the endpoint shape
   (flat range, client-side week) was chosen to leave it free.
4. **Several entries per day.** The design draws one recipe per day card. The schema allows many
   (`position`), the strip shows the first. *Recommendation: keep the capacity, render the first plus
   a `+N` affordance on the strip* — a flatshare plans lunch and dinner, and a unique
   `(day, recipe)` index already stops the accidental duplicate.
5. **Promoting existing libraries to courses.** After `0008` every existing tag is `free`, so no
   recipe has an eyebrow until someone marks their category tags. *Recommendation: no auto-migration
   by name* (guessing that "Hauptgericht" is a course is a content decision about somebody else's
   data); instead the tag screen gets a kind toggle and the release notes name the one-time step. The
   eyebrow's absence is designed for (§4.3), so nothing looks broken meanwhile.
6. **`?hasCooked` as a URL filter.** Left out of `RECIPE_FILTER_PARAMS` on purpose (§3.5).
   *Recommendation: keep it out until a UI can clear it; add the line in the same commit as the
   toggle, or `pick()` will drop it and the bug will look like the router's.*

---

## 10 — `CLAUDE.md` edits this area requires (D3) — for the later agent, not written here

1. **Conventions → "IDs / Timestamps".** Currently: "**Timestamps** integer unix ms in SQLite, ISO
   strings on the wire (`toIso()`)." It needs the exception with its reason: `meal_plan_entries.
   planned_on` is `text` `YYYY-MM-DD`, because a plan entry is a **calendar date** and not an instant;
   the calendar is the **user's** and the server never derives one (`Date.now()` in a UTC container is
   a day out for two hours every night, and local-time day arithmetic breaks across DST). Every
   *instant* — `cooked_at` included — stays integer unix ms. Name `packages/shared/src/calendar.ts` as
   the only place the conversion lives.
2. **Locked decision 8 (German-first CONTENT).** The list of content vocabulary
   ("`units.ts`, `ingredients.ts`, …") gains the **course vocabulary in `tags` where
   `kind='course'`**, and the first gotcha's content list gains `tags.kind`'s vocabulary and
   `packages/shared/src/tags.ts`'s `recipeEyebrow`. Rationale to record: a course name is stored
   German content rendered verbatim; only the filter rail's heading is interface.
3. **Architecture → the router mount list.** Add
   `/api/groups/:groupId/plan -> routes/plan.ts` and extend the existing "Order matters in two places"
   note: `plan` must be mounted **before** the catch-all `recipes` router, alongside `imports` and
   `shopping`.
4. **File layout.** Add `services/plan/`, `services/recipes/cookLog.ts`, `routes/plan.ts`,
   `packages/shared/src/calendar.ts`, `packages/shared/src/tags.ts`,
   `packages/shared/src/schemas/plan.ts`.
5. **The pre-folded-columns gotcha** gains a sibling paragraph: `recipes.last_cooked_at` is the second
   derived-but-stored column, written by **one** writer (`services/recipes/cookLog.ts`), nullable
   *because* "never cooked" is a real value — and therefore, unlike the fold columns, it does **not**
   use the "NOT NULL with no drizzle default so `tsc` catches a forgotten insert" trick. The reason it
   is stored is `?sort=lastCooked`: a grouped max or correlated subquery in the `ORDER BY` cannot use
   an index and sorts the whole group in a temp b-tree, which is the same mistake in a new place.
   Include the measured figures from §3.3.
6. **Verification gates** — the test count moves off 1058.

No `CLAUDE.md` entry is *contradicted* by this area: the timestamp convention is extended with a
stated exception rather than overturned, and locked decision 1 (groups own the content) is followed
exactly — `meal_plan_entries` and `recipe_cook_log` are both group-owned, and the `cards` exception is
not touched.
