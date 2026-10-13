# 03 — Backend: shopping (bought log, frequently-bought, provenance, plan → list)

Area spec for the redesign. Reads `docs/redesign/SPEC.md` (§ 4.3, § 4.5, § 4.6, § 5, § 6) and
`CLAUDE.md` as its input; contradicts neither except where flagged under **D3** below.

Scope: `apps/api/src/db/schema.ts`, `apps/api/src/drizzle/…` (migration `0006`),
`apps/api/src/routes/shopping.ts`, `apps/api/src/services/shopping/**`,
`packages/shared/src/schemas/shopping.ts`, `packages/shared/src/shopping.ts`,
`packages/shared/src/calendar.ts` (new, shared with area 02), plus the wire-shape consequences
in `apps/web/src/lib/api.ts`, `apps/web/src/lib/queries.ts`,
`apps/web/src/features/shopping/lib/offline.ts` and `apps/web/src/lib/persist.ts`.

Out of scope: every pixel. The shopping SCREENS are the frontend area's job; this spec defines
the data they consume and names the exact fields.

---

## 0 — The five decisions this spec settles

| # | Question SPEC.md left open | Settled answer | One-line reason |
| --- | --- | --- | --- |
| S1 | `Clear bought`: watermark or per-row stamp? | **Per-list watermark** `shopping_lists.bought_cleared_at` | One integer, one O(1) write, cannot disagree with itself; log rows stay untouched for history. |
| S2 | Bought-log pruning TTL | **90 days**, `BOUGHT_LOG_TTL_MS`, pruned on write from the check-off path only | It is a purchase record, not a replay token; a season is the shortest window in which "what did we buy in August" is still a real question. |
| S3 | Progress-bar denominator | **`toBuy + boughtInSection`** (the current trip), not a lifetime total | `4/(10+4) = 28.6% → 29%`, exactly the mock; and `Clear bought` then honestly resets the bar to 0 %. |
| S4 | Where the calendar-day boundary lives | **In the client, always.** The server stores and compares INSTANTS only; the client supplies `?since=<ISO>` and does all day GROUPING itself | The server has no timezone for a user and must not guess one; a family in Berlin and a member on holiday in Denver must each see their own "today". |
| S5 | Which list is the target of "From this week's plan" | **The list in the URL.** `GET …/shopping-lists/:listId/from-plan` — the client picks the target (last-opened, persisted per group, falling back to the alphabetically first list) and the panel names it | Puts the choice in one place the server never has to guess, and keeps the diff trivially scoped to one list's `merge_key`s. |

Two more, from SPEC.md § 6, that fall inside this area:

- **§ 6.5 progress semantics** — settled as S3 above.
- **§ 6.6 `+2 more`** — **confirmed: the preview is 8 items and it comes from the LIST INDEX
  endpoint** (`previewItems` below), never from a full item fetch per list.
  `+N` is `itemCount - previewItems.length`.
- **§ 6.3 "Lena is shopping now" / "synced 2 min ago"** — derived, no socket: the newest row of
  `GET …/shopping-lists/bought` (its `boughtByName` + `boughtAt`), rendered only while that row
  is younger than 30 minutes. No new endpoint, no presence table.
- **§ 6.4 `Bought history → All`** — the destination is `/shopping/history`, fed by the same
  group-wide endpoint with `?limit&offset`. The screen itself is the frontend area's; the data is
  specified here.

---

## 1 — The bought log (D4, SPEC § 4.3)

### 1.1 DDL

Migration file: **`apps/api/drizzle/0006_bought_log.sql`** (next free index; append the matching
entry to `apps/api/drizzle/meta/_journal.json` — `bun run db:generate` writes both, do not
hand-roll the journal). Verify the DDL through `@libsql/client` (SQLite **3.45.1**), never
through `bun:sqlite` (3.53) — see the CLAUDE.md gotcha. Nothing here uses a generated column, a
partial index or `RETURNING` in DDL, so 3.45.1 is sufficient.

```sql
CREATE TABLE `shopping_bought_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` real,
	`unit` text,
	`note` text,
	`bought_by` text,
	`bought_at` integer NOT NULL,
	`source_recipe_ids` text,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bought_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `shopping_bought_items_list_bought_at_idx` ON `shopping_bought_items` (`list_id`,`bought_at`);--> statement-breakpoint
CREATE INDEX `shopping_bought_items_bought_at_idx` ON `shopping_bought_items` (`bought_at`);--> statement-breakpoint
ALTER TABLE `shopping_lists` ADD `bought_cleared_at` integer;--> statement-breakpoint
ALTER TABLE `shopping_list_catalog` ADD `hidden_at` integer;--> statement-breakpoint
CREATE TABLE `shopping_list_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`servings` real,
	`added_by` text,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_list_recipes_list_recipe_unique` ON `shopping_list_recipes` (`list_id`,`recipe_id`);--> statement-breakpoint
CREATE INDEX `shopping_list_recipes_list_id_idx` ON `shopping_list_recipes` (`list_id`);
```

Three notes on the columns:

- **`bought_by` is NULLABLE, `ON DELETE set null`** — a deliberate deviation from SPEC § 4.3's
  sketch, which writes `bought_by text not null -> users`. Reason: this is a group's shopping
  HISTORY. `ON DELETE cascade` from `users` (the shape `cards` uses) would erase a departed
  member's purchases from everyone else's history the day an account-deletion endpoint exists;
  `NOT NULL` leaves no third option. The DTO's `boughtByName` then falls back to the catalog key
  `shopping.bought.unknownBuyer` ("Unbekannt" / "Unknown"). This is an implementation detail
  SPEC.md asked this spec to settle, not one of D1–D7.
- **`quantity` is `real` and NULL means "no amount"**, never 0 — the same rule as
  `shopping_list_items.quantity`, so a check-off round-trips losslessly.
- **`source_recipe_ids`** is the same JSON-array-in-a-text-column shape as on the item, copied
  verbatim at check-off so an undo restores provenance too.

New migration is additive only. No NOT NULL column is added to a populated table, so the
"add with a SQL-level `DEFAULT` and back-fill in JS" dance (migration `0003`) is not needed —
and **`backfillFoldedColumns()` in `apps/api/src/db/migrate.ts` must not be touched**.

### 1.2 drizzle definitions

In `apps/api/src/db/schema.ts`, immediately after `shoppingListCatalog` and before
`shoppingMutations` (so the file still reads top-down: lists → items → catalog → log → recipes →
ledger):

```ts
/**
 * "Bought today" and the history panel — the log D4 chose INSTEAD of a `bought_at`
 * column on the item row.
 *
 * Checking an item off still DELETEs it and still bumps `shopping_list_catalog`
 * (see the item table's comment); it additionally appends one row here. The four
 * things that make offline editing safe are therefore untouched: the
 * `(list_id, merge_key)` unique index stays TOTAL (no partial index whose libSQL
 * 3.45.1 support is unverified), the queued offline mutation stays a DELETE, the
 * `mutationId` ledger still covers the whole check-off, and "Häufig gekauft" still
 * ranks by `use_count`.
 *
 * `bought_by` is NULLABLE on purpose: a group's purchase history must survive a
 * member deleting their account, which `ON DELETE cascade` would not allow.
 *
 * Rows older than `BOUGHT_LOG_TTL_MS` are pruned on write
 * (services/shopping/bought.service.ts), the same shape as the mutation ledger.
 */
export const shoppingBoughtItems = sqliteTable(
  "shopping_bought_items",
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
    index("shopping_bought_items_list_bought_at_idx").on(table.listId, table.boughtAt),
    // For the TTL sweep, which is group-blind — the same role
    // `shopping_mutations_applied_at_idx` plays for the ledger.
    index("shopping_bought_items_bought_at_idx").on(table.boughtAt),
  ],
);

/**
 * "Recipes on this list" (artboard 1d right rail): which recipes contributed to a
 * list, and at how many portions.
 *
 * This does NOT replace `shopping_list_items.source_recipe_ids` and must not be
 * turned into one — that column is per-ITEM provenance, is rewritten by every merge,
 * and is deliberately not a join table (see its comment). This table is per-LIST
 * membership plus the one fact the items cannot carry: the `servings` the group chose
 * when they put the recipe on the list.
 */
export const shoppingListRecipes = sqliteTable(
  "shopping_list_recipes",
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
    uniqueIndex("shopping_list_recipes_list_recipe_unique").on(table.listId, table.recipeId),
    index("shopping_list_recipes_list_id_idx").on(table.listId),
  ],
);
```

Additions to the existing tables (same file, in place):

```ts
// shoppingLists — new column, at the end of the object literal
    /**
     * `Clear bought` watermark: the "Bought today" section shows only log rows
     * NEWER than this. NULL = never cleared. The log itself is never deleted by
     * clearing — the history panel reads past the watermark.
     */
    boughtClearedAt: integer("bought_cleared_at"),

// shoppingListCatalog — new column, after `lastUsedAt`
    /**
     * Hidden from the "Häufig gekauft" chips but KEEPS its `use_count`
     * (SPEC § 4.6): the design replaced the per-chip `×` with a long-press hide,
     * and deleting the entry would only make it come back on the next check-off.
     */
    hiddenAt: integer("hidden_at"),
```

Row types, appended next to the existing ones:

```ts
export type ShoppingBoughtItemRow = typeof shoppingBoughtItems.$inferSelect;
export type NewShoppingBoughtItemRow = typeof shoppingBoughtItems.$inferInsert;
export type ShoppingListRecipeRow = typeof shoppingListRecipes.$inferSelect;
export type NewShoppingListRecipeRow = typeof shoppingListRecipes.$inferInsert;
```

Relations (the file's `*Relations` block, for symmetry only — nothing queries through them):
`shoppingListsRelations` gains `boughtItems: many(shoppingBoughtItems)` and
`listRecipes: many(shoppingListRecipes)`; add `shoppingBoughtItemsRelations` and
`shoppingListRecipesRelations` with their `one(shoppingLists…)` / `one(users…)` /
`one(recipes…)` back-references.

### 1.3 S1 — `Clear bought` keeps the log (the chosen query)

**Chosen: the per-list watermark.**

```ts
// the "Bought today" section, in getShoppingListDetail
const boughtRows = await db
  .select()
  .from(shoppingBoughtItems)
  .where(
    and(
      eq(shoppingBoughtItems.listId, listId),
      gte(shoppingBoughtItems.boughtAt, row.boughtClearedAt ?? 0),
    ),
  )
  .orderBy(desc(shoppingBoughtItems.boughtAt))
  .limit(SHOPPING_LIMITS.boughtSectionMax);   // 100
```

```ts
// the history panel / the All screen — the watermark is IGNORED here, which is the point
const historyRows = await db
  .select(/* … + users.name */)
  .from(shoppingBoughtItems)
  .innerJoin(shoppingLists, eq(shoppingLists.id, shoppingBoughtItems.listId))
  .leftJoin(users, eq(users.id, shoppingBoughtItems.boughtBy))
  .where(and(eq(shoppingLists.groupId, groupId), listId ? eq(shoppingBoughtItems.listId, listId) : undefined))
  .orderBy(desc(shoppingBoughtItems.boughtAt))
  .limit(limit).offset(offset);
```

`Clear bought` is then one statement:
`UPDATE shopping_lists SET bought_cleared_at = ?, updated_at = ? WHERE id = ?`.

**The rejected alternative,** for the record: `cleared_at integer` on each log row, cleared by
`UPDATE shopping_bought_items SET cleared_at = ? WHERE list_id = ? AND cleared_at IS NULL`, with
the section reading `WHERE cleared_at IS NULL AND bought_at >= ?`. It works, and it would allow
dismissing ONE bought row, which the design does not offer. It costs an O(n) write per clear, a
second column plus its index, and a second definition of "is this row in the section" that can
drift from the first. The watermark cannot drift: there is exactly one number, and the section
predicate is `bought_at >= (bought_cleared_at ?? 0)`.

### 1.4 S2 — pruning

`apps/api/src/services/shopping/bought.service.ts` (new file), modelled line-for-line on
`idempotency.ts`:

```ts
/**
 * How long a purchase stays in the log. 90 days, NOT the ledger's 14: a mutation id
 * is a replay token that is worthless once the persisted client cache has expired
 * (PERSIST_MAX_AGE_MS, 7 days), while a bought row is a RECORD — the history panel
 * and the /shopping/history screen are the whole reason D4 chose a log. A season is
 * the shortest window in which "what did we buy in August" is still a real question,
 * and 90 days of a family's shopping is a few thousand rows.
 */
export const BOUGHT_LOG_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Drops log rows past the TTL. Opportunistic, so a self-hosted box needs no cron. */
export async function pruneBoughtLog(db: DbLike): Promise<void> {
  await db
    .delete(shoppingBoughtItems)
    .where(lt(shoppingBoughtItems.boughtAt, nowMs() - BOUGHT_LOG_TTL_MS));
}
```

Called **from `checkShoppingItem` only**, after the transaction, exactly where
`pruneMutationLedger(db)` is called today — that is the only path that appends, so it is the only
path that has to pay. `shopping_bought_items_bought_at_idx` is what makes it cheap; that index
exists for this sweep and for nothing else.

No per-list row cap. `SHOPPING_LIMITS.itemsPerList` is 500, so one shopping trip can append at
most 500 rows, and the TTL bounds the rest. If a deployment ever needs a cap, it belongs in this
same function as one `DELETE … WHERE id IN (SELECT id … ORDER BY bought_at ASC LIMIT n)` — do not
add a per-row loop like `pruneCatalog`'s.

### 1.5 UNDO — what happens to the quantity and to the log row

`POST /api/groups/:groupId/shopping-lists/:listId/bought/:boughtId/undo`, body
`CheckShoppingItemRequestSchema.optional()` (i.e. `{ mutationId? }` — reused, not a new schema).

Service: `undoBoughtItem(db, groupId, listId, boughtId, mutationId?)` in
`services/shopping/bought.service.ts`.

```
withTransaction:
  claimMutation(tx, listId, mutationId)                      -> false ? return
  DELETE FROM shopping_bought_items
    WHERE id = :boughtId AND list_id = :listId RETURNING *   -> no row ? return  (no-op)
  applyAdditions(tx, listId, [{ name, quantity, unit, note, sourceRecipeIds } of the row])
  UPDATE shopping_list_catalog
    SET use_count = max(use_count - 1, 0)
    WHERE list_id = :listId AND name_key = nameKey(row.name)
  UPDATE shopping_lists SET updated_at = now WHERE id = :listId
after:
  pruneMutationLedger(db);  return getShoppingListDetail(db, groupId, listId)
```

Exactly what this means, item by item:

- **The quantity may MERGE.** `applyAdditions` is the same function every add goes through, so the
  restored line folds by `shoppingItemKey(name, unit)` into whatever is on the list now. Undoing a
  bought "500 g Mehl" onto a list that has since gained "200 g Mehl" produces **one 700 g line**,
  not two lines and not 500 g. Nothing is lost, and nothing is invented.
- **The log row is DELETED, not stamped.** After the undo, nothing was bought, so the honest
  history is one with no row. It also makes undo idempotent by construction — a replay finds no
  row and returns current state — mirroring "checking an already-checked item is a no-op, not a
  404" (`shopping.test.ts`).
- **`use_count` is decremented, floored at 0.** `use_count` counts CHECK-OFFS
  (`shopping_list_catalog`'s comment) and an undone check-off is not one; leaving it inflated
  would let a mis-tap promote an item into the chips forever. Floored because `applyAdditions`
  itself calls `touchCatalog(..., { bought: false })`, which must not be able to drive the count
  negative under any interleaving.
- **What the UI must therefore be able to say.** The action is not "Undo" in the
  edit-history sense. Copy (new keys, `shopping` namespace, one key per whole sentence):
  - `shopping.bought.undo` — de `"Zurück auf die Liste"` / en `"Back on the list"` (the button).
  - `shopping.bought.undoMergeHint` — de `"Wenn „{name}“ schon wieder auf der Liste steht, werden die Mengen zusammengerechnet."` / en `"If “{name}” is on the list again, the amounts are added together."` — shown in the bought row's detail/long-press sheet, not as a toast, so it is readable before the tap.
  - `shopping.bought.undoSuccess` — de `"„{name}“ steht wieder auf der Liste"` / en `"“{name}” is back on the list"`.
  - `shopping.bought.unknownBuyer` — de `"Unbekannt"` / en `"Unknown"`.

### 1.6 IDEMPOTENCY — a replayed check-off cannot append a second log row

`checkShoppingItem` is restructured so that **the append is bound to the DELETE actually removing
a row**, not to the request arriving. Current body (`items.service.ts`) selects, then deletes;
change it to delete-and-return:

```ts
export async function checkShoppingItem(
  db: Database,
  groupId: string,
  listId: string,
  itemId: string,
  boughtBy: string,                 // NEW — the session user; the route passes requireUser(c).id
  mutationId?: string,
): Promise<ShoppingListDetailResponse> {
  await loadShoppingListRow(db, groupId, listId);

  await withTransaction(db, async (tx) => {
    if (!(await claimMutation(tx, listId, mutationId))) return;

    // ONE statement is both the removal and the guard. Only the transaction that
    // actually removed the row appends a log row, so no replay and no concurrent
    // second checker can append a duplicate.
    const [row] = await tx
      .delete(shoppingListItems)
      .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)))
      .returning();
    if (!row) return;

    await appendBoughtItem(tx, row, boughtBy);            // bought.service.ts
    await touchCatalog(tx, listId, row.name, row.unit, { bought: true });
    await tx.update(shoppingLists).set({ updatedAt: nowMs() }).where(eq(shoppingLists.id, listId));
  });
  await pruneMutationLedger(db);
  await pruneBoughtLog(db);

  return getShoppingListDetail(db, groupId, listId);
}
```

**The mechanism, stated for the reviewer — three independent gates, any one of which suffices:**

1. **The ledger.** The offline outbox always sends a `mutationId`
   (`SHOPPING_MUTATION_KEYS.check` in `features/shopping/lib/offline.ts` passes
   `mutationId: variables.mutationId`, minted at CALL time, never inside `mutationFn`).
   `claimMutation` is an INSERT on a primary key, not a SELECT-then-write, so a replay of the same
   id loses the insert and returns before any work happens. The append is INSIDE that guarded
   block, so a replayed check-off does no append at all.
2. **The row's existence.** With no `mutationId` (a plain online request retried by a proxy or a
   double tap), the second attempt's `DELETE … RETURNING` matches nothing, `row` is `undefined`,
   and the function returns before the append. This is the same "idempotent by construction"
   property the endpoint has today — the log inherits it because the append sits behind the same
   `if (!row) return`.
3. **The race.** Two members checking the same item at the same moment both used to reach
   `tx.delete` and both bumped `use_count` (a pre-existing, minor bug). `DELETE … RETURNING`
   makes exactly one of them see a row, so exactly one log row is written and `use_count` moves
   once. A local libSQL file is one serialised write lane anyway (CLAUDE.md), which narrows the
   window to nothing on a self-hosted box; the gate is what makes the invariant structural rather
   than incidental.

`RETURNING` on DELETE needs SQLite ≥ 3.35; libSQL bundles 3.45.1. **Verify it through
`@libsql/client`** (a `bun test` against `file::memory:` does exactly that — `bun:sqlite` is never
in the path here), and keep the test that pins it.

Residual, and unchanged from today: on a `file::memory:` DB `withTransaction` degrades to
sequential statements (`services/groups/support.ts`), so a failure between the claim and the
append leaves the id claimed and the work undone — "a lost mutation the user can repeat by hand
beats a silently doubled amount", the trade `idempotency.ts` already documents. Also unchanged:
the ledger's primary key is GLOBAL, so the same `mutationId` on a DIFFERENT list reads as
already-applied (pinned by `shopping.test.ts` → "the ledger is scoped per list"). Do not
"fix" that in this work.

`appendBoughtItem`:

```ts
export async function appendBoughtItem(
  tx: DbLike,
  row: ShoppingListItemRow,
  boughtBy: string,
): Promise<void> {
  await tx.insert(shoppingBoughtItems).values({
    id: crypto.randomUUID(),
    listId: row.listId,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    note: row.note,
    boughtBy,
    boughtAt: nowMs(),
    sourceRecipeIds: Array.isArray(row.sourceRecipeIds) ? row.sourceRecipeIds : [],
  });
}
```

### 1.7 The invariance proof D4 rests on

| Invariant | Why it still holds | Where to look |
| --- | --- | --- |
| `shopping_list_items` is unchanged | Migration `0006` adds no column to it and drops none. Its `$inferInsert` is byte-identical, so no insert site changes. | `0006_bought_log.sql` touches `shopping_lists` and `shopping_list_catalog` only, both with `ADD COLUMN` of a nullable integer. |
| `shopping_list_items_list_merge_key_unique` stays TOTAL | No partial index is introduced anywhere. Re-adding a bought item (undo, or a "Häufig gekauft" chip) merges normally, because the bought row is in a DIFFERENT table and the unique index has nothing extra to be partial over. This is the whole reason D4 rejected `bought_at` on the item row: that shape needs `WHERE bought_at IS NULL`, whose support on libSQL's SQLite 3.45.1 is unverified. | `schema.ts`, `shoppingListItems` index list — unmodified. |
| The queued offline mutation stays a DELETE | `SHOPPING_MUTATION_KEYS.check`'s `mutationFn` still calls `checkShoppingItem(groupId, listId, itemId, { mutationId })` → still `POST …/items/:itemId/check`, whose server-side meaning is still "remove the row". No persisted outbox entry changes meaning, so a mutation dehydrated by the OLD build and replayed by the NEW one does exactly what it said. | `apps/web/src/features/shopping/lib/offline.ts`, `apps/web/src/lib/api.ts#checkShoppingItem`. |
| `shopping_list_catalog` is still bumped on check-off | `touchCatalog(tx, listId, row.name, row.unit, { bought: true })` is still called, in the same transaction, before the list's `updated_at`. The ranking keeps counting purchases, so "Häufig gekauft" is unaffected by the log. | `items.service.ts#checkShoppingItem`, § 1.6 above. |
| A new mutation key is still persisted | `undoBought`'s key is `["toon","shopping","undo-bought"]`; `shouldPersistMutation` allow-lists on `key[1] === "shopping"`, so **no change to `lib/persist.ts`'s `PERSISTED_MUTATION_KEYS` is needed** — only a `setMutationDefaults` registration in `offline.ts`, or the replay would find no `mutationFn`. | `apps/web/src/lib/persist.ts`, `features/shopping/lib/offline.ts`. |

---

## 2 — History + progress

### 2.1 S4 — where the calendar conversion happens

**The server never converts an instant into a calendar day.** It has no timezone for the user
(there is no `users.timezone` column and this spec does not add one), and `Accept-Language` is a
language, not a zone. Two consequences:

- **Grouping by day is client-side**, in ONE pure module shared with the planner:
  **`packages/shared/src/calendar.ts`** (new, exported from `packages/shared/src/index.ts`), with
  unit tests in `packages/shared/test/calendar.test.ts`.

  ```ts
  /** "2026-09-08" for the DEVICE's calendar day containing `at`. */
  export function localDayKey(at: Date | number): string;
  /** Midnight (device local) of the day containing `at`, as unix ms. */
  export function startOfLocalDay(at: Date | number): number;
  /** Monday-based week bounds as day keys — German weeks start on Monday. */
  export function localWeekRange(at: Date | number): { from: string; to: string };
  /** Groups newest-first log rows into day buckets, preserving order. */
  export function groupByLocalDay<T>(rows: readonly T[], at: (row: T) => string):
    Array<{ dayKey: string; rows: T[] }>;
  ```

  **COORDINATION WITH AREA 02 (planner).** This module is the same boundary the planner needs for
  `planned_on`, and it must exist exactly once. Whichever area lands first creates it; the other
  imports it. Do not add a second date helper in `apps/web/src/lib/`, and do not reimplement
  `localDayKey` in a component. The planner's `planned_on` should be a `YYYY-MM-DD` TEXT column
  produced by `localDayKey()` on the client, for the same reason — a calendar date is not an
  instant. **If area 02 chooses integer-midnight-ms instead, § 5's `from`/`to` params change type
  with it; that is a genuine cross-area conflict and is listed as such.**

- **"Today" reaches the server as an instant, not as a date.** The list index takes an optional
  `?since=<ISO>`; the client always sends `new Date(startOfLocalDay(Date.now())).toISOString()`.
  The server parses it with `IsoDateSchema.safeParse`, **ignores it on failure rather than
  answering 422** (a bad query param must not blank a screen), and clamps the result to
  `[now - 7d, now]` so a wrong device clock cannot produce a nonsense count.

### 2.2 The three reads

All three live in `routes/shopping.ts`. **`GET /bought` MUST be registered BEFORE `GET /:listId`**
— Hono matches in registration order, so `/bought` would otherwise be swallowed as a list id.
This is the same trap as `/invites/:token` before `/:groupId` in `routes/groups.ts`; add it to the
file's header comment, next to the "mounted before the catch-all recipes router" note.

**(a) `GET /api/groups/:groupId/shopping-lists?since=<ISO>`** — `listShoppingLists` grows two
fields per list plus one:

| Field on `ShoppingList` | Meaning | Source |
| --- | --- | --- |
| `itemCount` | unchanged: open lines | existing grouped `count()` |
| `boughtCount` | rows with `bought_at >= max(bought_cleared_at ?? 0, since ?? 0)` — the "4 bought today" half of `10 to buy · 4 bought today` | new grouped count query |
| `boughtClearedAt` | ISO or null; lets the client recompute the section boundary offline | the row |
| `previewItems` | ≤ `SHOPPING_LIMITS.listPreviewItems` (**8**) `{ name, quantity, unit }`, in `position` order — the overview card's item names, and `+N` is `itemCount - previewItems.length` | new window-function query |

Three bounded queries per fetch, never a per-list N+1: a local libSQL file is ONE serialised write
lane and eight parallel queries take eight times as long (CLAUDE.md), so the lever is fewer,
cheaper queries.

```sql
-- boughtCount. SQLite's max() is the scalar max with two arguments.
select b.list_id as listId, count(*) as n
  from shopping_bought_items b
  join shopping_lists l on l.id = b.list_id
 where l.group_id = ?1
   and b.bought_at >= max(coalesce(l.bought_cleared_at, 0), ?2)
 group by b.list_id;

-- previewItems. Window function; SQLite has had them since 3.25, 3.45.1 is fine.
-- Verify through @libsql/client (a bun test does), never through bun:sqlite.
select id, list_id as listId, name, quantity, unit from (
  select i.id, i.list_id, i.name, i.quantity, i.unit,
         row_number() over (partition by i.list_id
                            order by i.position asc, i.created_at asc) as rn
    from shopping_list_items i
    join shopping_lists l on l.id = i.list_id
   where l.group_id = ?1
) where rn <= ?2;
```

Both as `sql` template literals in `lists.service.ts`; the second is served by the existing
`shopping_list_items_list_position_idx`.

**(b) `GET /api/groups/:groupId/shopping-lists/:listId`** (and therefore EVERY mutation response,
since they all return `getShoppingListDetail`) grows:

| Field on `ShoppingListDetailResponse` | Meaning |
| --- | --- |
| `bought: ShoppingBoughtItem[]` | the section: rows since the watermark, newest first, ≤ `SHOPPING_LIMITS.boughtSectionMax` (**100**), each with `boughtBy` + `boughtByName` resolved |
| `recipes: ShoppingListRecipe[]` | the "Recipes on this list" rail — see § 4 |

Putting both in the detail payload rather than behind their own query keys is deliberate: every
mutation already returns the whole detail, so the section and the rail stay consistent with the
items **by construction** (no second invalidation, no second offline allow-list entry, no window
where the bar and the list disagree). It is the same reason the payload already carries `catalog`.

The header's `10 to buy · 4 bought today` on the DETAIL screen is `items.length` and
`bought.filter(r => r.boughtAt >= startOfLocalDay(now)).length` — the client filters the
watermark-bounded array down to the local day. 100 rows is far more than one trip, so this count
is exact in practice; the bound is named in `SHOPPING_LIMITS` so it is one constant to raise.

**(c) `GET /api/groups/:groupId/shopping-lists/bought?listId=&limit=&offset=`** — the history
panel and the `/shopping/history` screen. Standard list envelope
`{ items, total, limit, offset }`, **limit default 24 / max 100** (repo convention), newest first,
watermark IGNORED, `listId` optional (absent = the whole group, which is what the overview panel
wants). `total` is a `count(*)` over a TTL-bounded table.

The panel's `Today / 4 items · Eric` rows are `groupByLocalDay(items, r => r.boughtAt)` plus, per
bucket, `rows.length` and the distinct `boughtByName`s (one name → `"Eric"`; two or more →
`shopping.bought.buyers` = de `"{first} +{count}"`). Day LABELS are interface: `Today`/`Heute`
from the catalog for the current day key, otherwise `formatDate()`'s existing `Intl` output.

### 2.3 S3 — the progress bar

Pure, in `packages/shared/src/shopping.ts`, with a test in `packages/shared/test/shopping.test.ts`:

```ts
/**
 * The shopping-trip progress bar (artboards 1c/1g): share of THIS TRIP that is done.
 *
 * Denominator is `toBuy + bought`, not a lifetime total — `4` bought against `10`
 * still to buy is 29 %, which is what the design draws, and `Clear bought` therefore
 * honestly resets the bar to 0 % rather than freezing it at a historical number.
 * Returns an integer 0–100; 0 when there is nothing on the list at all, and the UI
 * hides the bar in that case rather than drawing an empty one.
 */
export function shoppingProgressPercent(toBuy: number, bought: number): number {
  const total = toBuy + bought;
  if (total <= 0) return 0;
  return Math.round((bought / total) * 100);
}
```

Never inline this arithmetic in a component or a route handler: pure logic belongs in
`packages/shared` with unit tests. Test cases to pin: `(10, 4) === 29` (the mock),
`(0, 0) === 0`, `(0, 7) === 100`, `(7, 0) === 0`.

### 2.4 Writes on the bought section

| Method + path | Body | Returns | Service |
| --- | --- | --- | --- |
| `POST …/shopping-lists/:listId/bought/clear` | – | `ShoppingListDetailResponse` | `clearBoughtSection(db, groupId, listId)` |
| `POST …/shopping-lists/:listId/bought/:boughtId/undo` | `{ mutationId? }` | `ShoppingListDetailResponse` | `undoBoughtItem(...)` (§ 1.5) |

`POST …/bought/clear`, not `DELETE …/bought`: `DELETE` would read as "delete the log", which is
precisely what it must not do. Idempotent (clearing an already-clear section just re-stamps the
watermark); no `mutationId` needed, for the same reason `clear` (empty the list) sends none —
"set the watermark to now" is already idempotent and spending a ledger entry would only shorten
its useful window. Both are gated automatically: `shoppingRoutes.use("*", requireVerifiedEmail())`
covers every non-GET in the file.

---

## 3 — Frequently bought (SPEC § 4.6)

### 3.1 Hiding

`shopping_list_catalog.hidden_at` (§ 1.1/1.2). One endpoint, both directions:

| Method + path | Body | Returns |
| --- | --- | --- |
| `PATCH …/shopping-lists/:listId/catalog/:entryId` | `UpdateShoppingCatalogEntryRequestSchema` = `{ hidden: boolean }` | `ShoppingListDetailResponse` |

`hidden: true` → `hidden_at = nowMs()`; `hidden: false` → `hidden_at = null`. Unknown entry →
404 `server.shopping.suggestionNotFound` (the existing key). Service:
`setCatalogEntryHidden(db, groupId, listId, entryId, hidden)` in `items.service.ts`, next to
`deleteCatalogEntry`.

`getShoppingListDetail`'s `catalog` query gains `isNull(shoppingListCatalog.hiddenAt)` — a hidden
entry is never suggested. `ShoppingCatalogEntrySchema` gains `hiddenAt: IsoDateSchema.nullable()`
so the "Show all" sheet can draw the unhide affordance.

`Show all 24` needs the entries the chips do not show, hidden ones included:

| Method + path | Query | Returns |
| --- | --- | --- |
| `GET …/shopping-lists/:listId/catalog` | `includeHidden=1`, `limit`, `offset` | `{ items: ShoppingCatalogEntry[], total, limit, offset }` |

Ranked `use_count desc, last_used_at desc` (the existing `shopping_list_catalog_list_rank_idx`
order); limit default 24 / max 100, so `Show all 24` is one page. **Do NOT add an index for
`hidden_at`** — the table is capped at `SHOPPING_LIMITS.catalogPerList` (200) rows per list and a
scan of 200 rows is not a problem worth an index.

**The existing `DELETE …/catalog/:entryId` stays exactly as it is** (a wire contract is never
renamed or removed), but the redesigned UI stops calling it: the design replaced the per-chip `×`
with a long-press hide, and deleting the entry throws away the `use_count` that the next check-off
would only rebuild. Keep the route, keep its test, and point the long-press at the PATCH.

Known, accepted consequence: `pruneCatalog` orders by `use_count asc, last_used_at asc`, so a
HIDDEN entry with a low count can still be pruned, and buying that item again re-creates it as
visible. That is acceptable — the entry only comes back by being bought again, which is exactly
the signal that it belongs in the list. Do not add a "hidden survives pruning" rule; it would need
a second ordering rule for a 200-row table.

### 3.2 The two-step ordering — named separately so it cannot be collapsed

The server already returns `catalog` ranked by `use_count desc, last_used_at desc`. Both steps
then run **in the client, on that already-ranked array**, as two separately named pure functions in
`packages/shared/src/shopping.ts` (tests in `packages/shared/test/shopping.test.ts`):

```ts
/** How many chips the rail and the phone chip row show (artboards 1d/1h). */
export const FREQUENT_CHIP_COUNT = 8;

/**
 * STEP 1 — SELECTION. Which entries make the chip row: the most-bought ones.
 * Ranks by use_count desc, then last_used_at desc (the same order the API returns,
 * re-applied here so the function is correct on any input), and takes `limit`.
 * Says nothing about display order.
 */
export function selectMostBoughtEntries<T extends { useCount: number; lastUsedAt: string }>(
  entries: readonly T[],
  limit: number = FREQUENT_CHIP_COUNT,
): T[];

/**
 * STEP 2 — DISPLAY ORDER. Alphabetical by German folded name, so "Äpfel" sits under
 * A and not after Z: foldText() first (the app's single definition of "same word",
 * @toon/shared/src/text.ts), then localeCompare on the FOLDED strings, then the raw
 * name as a stable tiebreak. Never localeCompare alone, and never a SQL fold — see
 * the FOLD_PAIRS gotcha: foldSql() overflows SQLite's parser past 30 nested
 * replace() calls and is deliberately half-finished, and nothing new may fold in SQL.
 */
export function sortEntriesByFoldedName<T extends { name: string }>(entries: readonly T[]): T[];
```

The chip row is `sortEntriesByFoldedName(selectMostBoughtEntries(catalog))`. **Two calls, two
names, in that order.** An implementer who writes one `sortBy` has broken the design's stated fix
for "Frequently bought" clutter: selection is by frequency, display is alphabetical, and the two
are not the same operation. `Show all` uses `sortEntriesByFoldedName` over the full page for the
same scanability reason.

**Where the sort runs: in the web app, at render time, over ≤ 24 (chips) or ≤ 100 (sheet) rows.**
Not in SQL, not in the API. No `foldSql()` call is added anywhere by this area, and
`FOLD_PAIRS` is not touched.

---

## 4 — Provenance and "Recipes on this list" (SPEC § 4.5, artboard 1d rail)

### 4.1 The per-item `from` label needs NO backend change

`ShoppingItem.sources: Array<{ id, title }>` already exists and is already resolved in ONE query
restricted to the group (`getShoppingListDetail` → `toShoppingItem`). The artboard's right-aligned
`{{ it.from }}` is `sources[0].title`, with `+N` when `sources.length > 1`
(`shopping.item.sourcesMore` = de `"{name} +{count}"`). `sourceRecipeIds` keeps ids whose recipe
was deleted while `sources` omits them — that asymmetry is intentional and stays.

**`shopping_list_items.source_recipe_ids` remains a JSON array and must NOT be turned into a join
table.** Its comment in `schema.ts` says why (ids are read as a set, a merge rewrites the whole
set, and a FK would force a decision about what a deleted recipe does to an item already in
someone's basket). The new `shopping_list_recipes` table is a DIFFERENT relation — list ↔ recipe,
carrying `servings` — and does not replace it.

### 4.2 The smallest addition that supports "5 of 5 ingredients · 4 Portionen"

Servings-per-recipe is the one fact no existing column can carry, hence
`shopping_list_recipes(list_id, recipe_id, servings, added_by, added_at, updated_at)` (§ 1.1).
Written in `addRecipeToShoppingList`, inside the same transaction, after `claimMutation` and
`applyAdditions`:

```ts
await tx.insert(shoppingListRecipes)
  .values({ id: crypto.randomUUID(), listId, recipeId: recipe.id,
            servings: input.servings ?? null, addedBy: userId,
            addedAt: nowMs(), updatedAt: nowMs() })
  .onConflictDoUpdate({
    target: [shoppingListRecipes.listId, shoppingListRecipes.recipeId],
    // Re-adding at a different portion count is the newest intent.
    set: { servings: input.servings ?? null, updatedAt: nowMs() },
  });
```

`addRecipeToShoppingList` therefore also needs the session `userId` — add it as a parameter and
pass `requireUser(c).id` from the route, exactly as § 1.6 does for `checkShoppingItem`.

The rail's rows come from `getShoppingListDetail` as `recipes: ShoppingListRecipe[]`:

| Field | How it is computed |
| --- | --- |
| `recipeId`, `title`, `thumbnailUrl` | join `recipes` (restricted to `groupId`); `thumbnailUrl` is `signUploadUrl(thumbnailUrlFor(row.imageUrl))` exactly as `toRecipe` mints it — a 44 px rail thumb is a LIST image, never `imageUrl` |
| `servings`, `servingsUnit` | the join row's `servings` (null = the recipe's own count) and the recipe's `servingsUnit`, so the label reads `"4 Portionen"` |
| `ingredientTotal` | `count(*)` of `recipe_ingredients` for that recipe TODAY — the denominator of "5 of 5" |
| `onListCount` | items on this list whose `sourceRecipeIds` contains this recipe id — computed in JS from the item rows already loaded, NOT with a SQL `json_each` |
| `sharedCount` | of those, how many also carry ANOTHER recipe id — what the Remove dialog needs (§ 4.3) |
| `addedAt` | the join row |

Two bounded extra queries in `getShoppingListDetail`: the `shopping_list_recipes` rows joined to
`recipes` (≤ 30-ish per list in practice), and one grouped ingredient count over those recipe ids.
`onListCount` / `sharedCount` are pure JS over `itemRows`, which are in memory already.

Rows with `onListCount === 0` are still returned; the CLIENT hides them. Two cleanup rules:
`clearShoppingList` deletes this list's `shopping_list_recipes` rows (an emptied list has no
recipes on it), and `removeRecipeFromList` deletes the one row it is about. Nothing else prunes
them — the table is bounded by lists × recipes.

### 4.3 Remove — and what it means for merged quantities

| Method + path | Body | Returns |
| --- | --- | --- |
| `DELETE …/shopping-lists/:listId/recipes/:recipeId` | – | `ShoppingListDetailResponse` |

`removeRecipeFromList(db, groupId, listId, recipeId)`, in a transaction:

```
for each item on the list whose sourceRecipeIds contains recipeId:
    if sourceRecipeIds === [recipeId]        -> DELETE the item row
    else                                     -> keep the row, keep quantity/unit/note UNCHANGED,
                                                and write sourceRecipeIds without recipeId
DELETE the shopping_list_recipes row
UPDATE shopping_lists.updated_at
```

**Quantities of shared lines are NOT reduced, and that is the honest answer, not a shortcut.** The
merge is destructive by design: `applyAdditions` stores one `quantity` per `(name, unit-bucket)`
line, so once "500 g Tomaten" from *Schmorgurken* and "500 g Tomaten" from *Hackauflauf* have
become one 1 kg line, the two contributions are not recoverable from the data. Two alternatives
were considered and rejected:

- *Recompute-and-subtract* — re-scale the recipe at the stored `servings` and subtract that amount.
  It looks exact and is not: the recipe may have been edited since it was added, the line may also
  contain a hand-typed amount (a hand-typed add contributes NO recipe id, so the line's set can be
  `[R]` while part of its quantity came from a person), and unit re-expression makes the
  subtraction lossy. It can silently remove food the group still needs.
- *Drop-the-source-only* — never delete anything, just forget the provenance. Cheap, but "Remove"
  would then not remove, which is worse than an honest partial.

So Remove deletes what came ONLY from that recipe, keeps what is shared, and **says so before the
tap** — the confirmation dialog has both counts in hand from `onListCount` / `sharedCount`, no
response-shape change required:

- `shopping.listRecipe.remove.title` — de `"„{title}“ von der Liste nehmen?"`
- `shopping.listRecipe.remove.description` — de `"{removed} werden entfernt. {shared} bleiben, weil sie auch aus einem anderen Rezept kommen — ihre Mengen ändern sich nicht."` (plural forms on both counts; the `shared: 0` case gets its own key `…remove.descriptionExclusive` = de `"Alle {removed} von „{title}“ werden entfernt."` — one key per whole sentence, never a fragment per clause).
- `shopping.listRecipe.ingredientsOf` — de `"{onList} von {total} Zutaten"` (the rail's `5 of 5`).

Remove is **online-only**: not registered with `setMutationDefaults`, so it never enters the
outbox — a bulk delete replayed hours later against a list the user can no longer see is exactly
the class `persist.ts` excludes. It is naturally idempotent anyway (an unknown recipe id is a
200 no-op, never a 404, matching `deleteShoppingItem`). Gate its button on
`useEmailVerificationBlock()` + `isOnline`, the way list create/rename are gated — **never
`useCanMutate()`**, which is false offline and would grey out the whole screen.

---

## 5 — From this week's plan (SPEC § 4.5)

Depends on area 02's `meal_plan_entries`; implement after that migration lands. The endpoint lives
in `routes/shopping.ts` (the diff is against a LIST) and imports `mealPlanEntries` from
`db/schema.ts`.

| Method + path | Query | Returns |
| --- | --- | --- |
| `GET …/shopping-lists/:listId/from-plan` | `from`, `to` — **both required**, `YYYY-MM-DD` | `PlanShoppingPreviewResponse` |

Both params required, never defaulted: the server must not guess where a week starts (S4). The
client sends `localWeekRange(new Date())` from `packages/shared/src/calendar.ts`. Invalid or
inverted range → 422 `validation_failed` via the schema (this is a screen's own request, unlike
the optional `since`, so failing loudly is right).

```ts
export const PlanShoppingPreviewRecipeSchema = z.object({
  recipeId: IdSchema,
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  /** Earliest planned day in the window, YYYY-MM-DD — the row's "Tue" label. */
  plannedOn: z.string(),
  /** Portions from the plan entry; null = the recipe's own count. */
  servings: z.number().nullable(),
  ingredientTotal: z.number().int().nonnegative(),
  /** Distinct merge keys not yet on the target list — the row's "9 ingredients". */
  missingCount: z.number().int().nonnegative(),
  /** recipe_ingredients ids to pass straight back as `ingredientIds`. */
  missingIngredientIds: z.array(IdSchema),
});
export const PlanShoppingPreviewResponseSchema = z.object({
  listId: IdSchema,
  listName: z.string(),
  from: z.string(),
  to: z.string(),
  /** Sum of the per-recipe missingCounts — the panel's "22 ingredients". */
  totalMissingCount: z.number().int().nonnegative(),
  recipes: z.array(PlanShoppingPreviewRecipeSchema),
});
```

`planShoppingPreview(db, groupId, listId, { from, to })` in a new
`apps/api/src/services/shopping/fromPlan.service.ts`:

1. Load the target list (`loadShoppingListRow` — 404s without leaking other groups) and build
   `onList = new Set(items.map(i => i.mergeKey))` from its item rows. **The comparison is on the
   stored `merge_key`, not on the name**, so "200 g Mehl" counts as missing while "2 EL Mehl" is on
   the list — they are in different unit buckets and cannot merge, so both are genuinely needed.
2. Load the window's plan entries for the group, ordered by `planned_on`; **de-duplicate by
   `recipe_id`, keeping the EARLIEST `planned_on` and that entry's `servings`** (a recipe planned
   twice in a week is one row in the panel; the design shows one row per recipe).
3. Per recipe: load its `recipe_ingredients` in `position` order, compute the factor exactly as
   `addRecipeToShoppingList` does (`servings / servingsAmount` when both are positive, else 1),
   scale with `scaleIngredients(..., { keepNonScalingUnits: true })`, then for EACH ingredient row
   compute `shoppingItemKey(ingredientToShoppingItem(row, recipeId))`'s name/unit.
   A row is missing when its key is not in `onList`.
   - `missingIngredientIds` = every missing row's id (several rows can share one key —
     `recipeToShoppingItems` merges within a recipe — and all of them must be added).
   - `missingCount` = the number of **distinct missing keys** (that is the number of LINES the add
     would produce, which is what "9 ingredients" means to a reader).
   - A recipe with `missingCount === 0` is omitted from `recipes` entirely.
4. `thumbnailUrl` is minted with `signUploadUrl(thumbnailUrlFor(row.imageUrl))` — panel thumbs are
   list images.

### 5.1 The bulk add reuses the existing endpoint, unchanged

`Add` on one row and `Add all to Einkaufsliste` are both
**`POST …/shopping-lists/:listId/recipes`**, whose contract is untouched:

- one request per recipe, each with its OWN client-minted `mutationId` (minted at call time,
  never inside `mutationFn`);
- `servings` = the row's `servings` when non-null, omitted otherwise;
- `ingredientIds` = `missingIngredientIds` — **except when `missingIngredientIds.length ===
  ingredientTotal`, where the field is OMITTED entirely**. Omitted means "the whole recipe", which
  is what keeps an older client and a queued offline replay working; sending an exhaustive array
  would be a behavioural change for no gain. Never send `[]` (it means "add nothing").

**Do not add a bulk endpoint.** "Add all" is a `for` loop over ≤ 7 recipes on a screen the user is
sitting at; a new endpoint would need its own idempotency story and would duplicate
`addRecipeToShoppingList`'s scaling. `AddRecipeToShoppingListRequestSchema` is unchanged by this
spec.

### 5.2 S5 — which list

The target is in the URL, so the server never chooses. The client chooses, in this order:

1. `storageKeys.lastShoppingListId` — a new key in `apps/web/src/lib/storage.ts`, written whenever
   a list detail screen mounts, stored as `"<groupId>:<listId>"` so switching groups cannot carry
   a foreign list id across (same shape discipline as `activeGroupId`);
2. the first list from `GET …/shopping-lists`, which is already ordered `name asc`;
3. no lists → the panel renders its empty state with a "Liste anlegen" action instead of a target.

The panel **names the target in its button** (`shopping.fromPlan.addAll` = de
`"Alles auf „{list}“"`), and when the group has more than one list it offers a picker that rewrites
the stored key. No `shopping_lists.is_default` column: a persisted server-side default is state
two members can fight over, and "the one I last opened" is both what the mock implies and free.

---

## 6 — Offline

| Read | Query key | Must work in airplane mode? | Action |
| --- | --- | --- | --- |
| lists index (`itemCount`, `boughtCount`, `previewItems`) | `["toon","group",g,"shopping-lists"]` | **Yes** — the overview is a supermarket screen | already allow-listed (`PERSISTED_GROUP_SEGMENTS` has `"shopping-lists"`); no change |
| list detail incl. `bought`, `recipes`, `catalog` | `["toon","group",g,"shopping-list",id]` | **Yes** | already allow-listed (`"shopping-list"`); no change |
| bought history (panel + `/shopping/history`) | `["toon","group",g,"shopping-bought", …]` | **Yes** for the overview panel — it sits on an offline screen and would otherwise render as a permanently empty card | **add `"shopping-bought"` to `PERSISTED_GROUP_SEGMENTS`** in `apps/web/src/lib/persist.ts` |
| full catalog (`Show all 24`) | `["toon","group",g,"shopping-catalog",id]` | No — a sheet opened deliberately, and the chips themselves come from the detail payload | leave OFF the allow-list |
| `from-plan` preview | `["toon","group",g,"shopping-from-plan",id,from,to]` | No — planning happens at home, and planner writes are online-only anyway | leave OFF the allow-list |

The allow-list is an ALLOW-list: anything not named above is excluded by default, which is the
correct outcome for the two "No" rows.

**`PERSIST_BUSTER` must be bumped `"v2"` → `"v3"`.** Two shapes change at once:
`ShoppingListDetailResponse` gains required `bought` and `recipes` arrays (a restored v2 blob would
hydrate `undefined` into components that index them, and even with defensive `?? []` it would draw
an empty "Bought today" section over a list where things were bought), and the persisted mutation
set gains `undo-bought`. Cost is one cold reload per device, which is the documented trade in
`persist.ts`'s own comment. Update that comment with a `v3:` line.

**Service worker: no change to `apps/web/vite.config.ts`.** The existing rule
`urlPattern: /\/api\/groups\/[^/]+\/shopping-lists/` → `NetworkOnly` already matches every new
path in this spec (`/bought`, `/bought/clear`, `/catalog`, `/recipes/:recipeId`, `/from-plan`),
because they are all under `shopping-lists`. That must STAY `NetworkOnly`: the offline copy is the
persisted TanStack cache — the same store the queued mutations live in — and a `NetworkFirst` hit
would hand TanStack a stale body that looks like a fresh success, silently un-ticking items the
user just checked off. Do not add a rule for the planner's `/plan` paths in this area.

**Offline mutations.** One new registration in
`apps/web/src/features/shopping/lib/offline.ts`, with a mutation key whose second segment is
`"shopping"` so `shouldPersistMutation` picks it up unchanged:

```ts
undoBought: ["toon", "shopping", "undo-bought"] as const,
```

- `mutationFn` calls the new `undoBoughtItem(groupId, listId, boughtId, { mutationId })` in
  `lib/api.ts`; `networkMode: "offlineFirst"` and `retry: 1` come from the shared block.
- `onMutate` moves the row optimistically: remove it from `current.bought` and merge its
  `{ name, quantity, unit, note }` into `current.items` with the existing `mergeIntoCache` — the
  SAME algebra the server runs, so the 700 g of § 1.5 shows immediately and does not jump.
- `onError` → `rollbackCache`, `onSuccess` → `commit` (which already invalidates the lists index).
- The `check` mutation's `onMutate` must additionally PREPEND an optimistic bought row inside
  `removeFromCache(..., { asBought: true })`: id `pending:<mergeKey>`, `boughtAt` now,
  `boughtBy`/`boughtByName` from the session. Pass the buyer in the variables
  (`CheckVariables extends ItemVariables { boughtBy: { id: string; name: string } }`), resolved at
  CALL time in `features/shopping/lib/queries.ts` — never read inside `mutationFn`, which re-runs
  on replay.
- `clearBought` and `removeRecipe` are **online-only** and stay out of `offline.ts`
  (`useMutation` inline is correct for them), for the same reason list create/rename/delete are.

Everything else in the four-piece offline contract is unchanged; § 1.7 is the proof.

---

## 7 — Wire contract summary (`packages/shared/src/schemas/shopping.ts`)

New limits:

```ts
export const SHOPPING_LIMITS = {
  … existing …,
  /** Rows the "Bought today" section carries in the detail payload. */
  boughtSectionMax: 100,
  /** Item names the overview card previews per list; "+N" is itemCount - this. */
  listPreviewItems: 8,
} as const;
```

New / changed schemas (all in the same file, with the file header's "there is no `checked` field
anywhere" paragraph updated — the check-off still deletes the row, and now ALSO appends to
`shopping_bought_items`, which is what draws "Bought today"):

| Schema | Change |
| --- | --- |
| `ShoppingListSchema` | `+ boughtCount: z.number().int().nonnegative().optional()`, `+ boughtClearedAt: IsoDateSchema.nullable().optional()`, `+ previewItems: z.array(ShoppingItemPreviewSchema).optional()` (index-only, same convention as `itemCount`) |
| `ShoppingItemPreviewSchema` | **new**: `{ name, quantity: z.number().nullable(), unit: z.string().nullable() }` |
| `ShoppingBoughtItemSchema` | **new**: `{ id, listId, name, quantity nullable, unit nullable, note nullable, boughtBy: IdSchema.nullable(), boughtByName: z.string().nullable(), boughtAt: IsoDateSchema, sourceRecipeIds: z.array(IdSchema) }` |
| `ShoppingListRecipeSchema` | **new**: `{ recipeId, title, thumbnailUrl nullable, servings nullable, servingsUnit nullable, ingredientTotal, onListCount, sharedCount, addedAt }` |
| `ShoppingCatalogEntrySchema` | `+ hiddenAt: IsoDateSchema.nullable()` |
| `ShoppingListDetailResponseSchema` | `+ bought: z.array(ShoppingBoughtItemSchema)`, `+ recipes: z.array(ShoppingListRecipeSchema)` (both required — one origin, one deploy; the persisted-blob case is handled by the `PERSIST_BUSTER` bump) |
| `ShoppingBoughtListResponseSchema` | **new**: `{ items: z.array(ShoppingBoughtItemSchema), total, limit, offset }` |
| `ShoppingCatalogListResponseSchema` | **new**: `{ items: z.array(ShoppingCatalogEntrySchema), total, limit, offset }` |
| `UpdateShoppingCatalogEntryRequestSchema` | **new**: `{ hidden: z.boolean() }` |
| `PlanShoppingPreviewRecipeSchema` / `PlanShoppingPreviewResponseSchema` | **new**, § 5 |
| `AddRecipeToShoppingListRequestSchema`, `CheckShoppingItemRequestSchema`, `AddShoppingItemsRequestSchema`, `UpdateShoppingItemRequestSchema` | **UNCHANGED** |

**No new entries in `ERROR_CODES`** (`packages/shared/src/schemas/common.ts`) — a code is a wire
contract and none of these failures is new: 404 uses `not_found` with the existing
`server.shopping.{listNotFound,itemNotFound,suggestionNotFound}` keys, a full list on undo raises
the existing 409 `shopping_list_full`, and a bad `from`/`to` is 422 `validation_failed`. One new
SERVER catalog key pair is needed only if a message has no counterpart:
`server.shopping.boughtNotFound` is **not** added — an unknown `boughtId` is a 200 no-op, like an
already-checked item.

New routes, in the order they must be registered in `routes/shopping.ts`:

```
GET    /bought                                  <-- BEFORE /:listId, or it is read as a list id
GET    /:listId
…
POST   /:listId/bought/clear
POST   /:listId/bought/:boughtId/undo
GET    /:listId/catalog
PATCH  /:listId/catalog/:entryId
DELETE /:listId/catalog/:entryId                (existing, kept, no longer used by the UI)
DELETE /:listId/recipes/:recipeId
GET    /:listId/from-plan
```

`docs/API.md` "Shopping lists" table gains one row per endpoint above, and its notes section gains
three paragraphs: the bought log + watermark (D4), the `since` param and why day grouping is
client-side, and the two-step frequently-bought ordering. The DDL appendix's table list gains
`shopping_bought_items` and `shopping_list_recipes`, and its unique-index list gains
`shopping_list_recipes(list_id, recipe_id)`.

---

## 8 — Tests

New file **`apps/api/test/shopping-bought.test.ts`** (in `test/`, never `tests/` — `tsconfig.json`
only includes `test/**`), same harness as `shopping.test.ts` (real Hono app, real middleware,
`file::memory:` DB, `await runMigrations(db)` at the top). It installs no seam, so there is nothing
to hand back in `afterAll`. Cases:

1. Check-off appends exactly one log row, with the checking user's id, the item's quantity/unit/
   note and its `sourceRecipeIds`; the item is gone; `use_count` is 1.
2. **Replay with the same `mutationId` appends NO second row** (the § 1.6 property) — assert the
   row count in `shopping_bought_items` is 1 and the quantity of the re-added line is unchanged.
3. **Replay with NO `mutationId`** likewise appends no second row (the `DELETE … RETURNING` gate).
4. `POST …/bought/clear` empties the detail's `bought` array, leaves the row count in the table
   untouched, and `GET …/shopping-lists/bought` still returns it.
5. Undo re-adds with the logged amount, deletes the log row, decrements `use_count`, and is a
   200 no-op when replayed.
6. Undo MERGES: check off 500 g Mehl, add 200 g Mehl, undo → one 700 g line.
7. `GET …/shopping-lists/bought` is registered before `/:listId` (a list id that happens to be
   the literal `bought` cannot exist, but assert the endpoint answers the envelope and not a 404).
8. `?since=` on the index: a `since` in the future yields `boughtCount` 0 after clamping; garbage
   is ignored, not 422.
9. `previewItems` is capped at 8 and ordered by `position`; `itemCount` still counts all.
10. Catalog `PATCH { hidden: true }` removes the entry from the detail's `catalog` and keeps its
    `use_count`; `{ hidden: false }` brings it back; `GET …/catalog?includeHidden=1` lists it with
    a non-null `hiddenAt`.
11. `DELETE …/recipes/:recipeId`: exclusive lines go, shared lines stay with the id dropped and
    the quantity unchanged, and the join row is gone.
12. `from-plan`: a planned recipe whose ingredients are half on the list reports the right
    `missingCount` and `missingIngredientIds`; posting those ids adds exactly the missing lines;
    a fully-covered recipe is omitted.
13. Access control: an outsider gets 403 on every new route (the router-level middleware already
    covers it, but the file should pin one GET and one write, as `shopping.test.ts` does).

Extend **`packages/shared/test/shopping.test.ts`** with `shoppingProgressPercent`,
`selectMostBoughtEntries` and `sortEntriesByFoldedName` (umlaut case: `["Zwiebel","Äpfel","Brot"]`
→ `Äpfel, Brot, Zwiebel`). New **`packages/shared/test/calendar.test.ts`** for
`localDayKey`/`startOfLocalDay`/`localWeekRange`/`groupByLocalDay` — coordinate with area 02, one
file, not two.

**Gates.** All five must be clean: `bun install`, `bun run typecheck`, `bun test`,
`bun run build`, `bun run i18n:check` (read its output, not just its exit code — every new German
string in § 1.5/§ 4.3/§ 5.2 has no base-tree counterpart and WILL be flagged as a parity
false positive, class 1). Because this touches persistence: `bun run db:migrate` and `bun run seed`
against a fresh `file:` DB, then the curl walkthrough in `README.md`.

**Seed.** `apps/api/scripts/seed.ts` should seed a handful of bought rows across two days, one
hidden catalog entry and one `shopping_list_recipes` row, or the history panel and the rail are
empty on a fresh dev DB and cannot be styled. The names are CONTENT — German, never through `t()`,
same rule as the rest of `seed.ts`. The script's own console output stays English literals.

---

## 9 — `CLAUDE.md` edits this area forces (D3) — for the later agent, not written here

1. **Locked decision 7**, the sentence "Shopping lists … have no `checked` column" and "Checking an
   item off DELETES the row and bumps a `shopping_list_catalog` entry …". Behaviour is RETAINED and
   gains a second half: the check-off ALSO appends a `shopping_bought_items` row, which is what
   draws "Bought today" and the history panel, and the reason there is still no flag on the item
   row is the total `(list_id, merge_key)` unique index plus the offline outbox (a partial index
   `WHERE bought_at IS NULL` is unverified on libSQL's SQLite 3.45.1, and a flag would silently
   change what a replayed offline delete means). It should also record `bought_cleared_at` as the
   `Clear bought` watermark and the 90-day log TTL.
2. **Locked decision 7's "Häufig gekauft" clause.** Add: a catalog entry can be HIDDEN
   (`hidden_at`) without losing its `use_count`, the chips are the top 8 by `use_count` **displayed
   alphabetically by folded name**, and the per-chip `×` is gone.
3. **The gotcha "THE SHOPPING LIST IS THE ONE THING EDITABLE OFFLINE, and four pieces make that
   safe".** The four pieces are unchanged; the entry needs one added sentence naming the fifth
   invariant this redesign introduces — the bought-log append is bound to the check-off's
   `DELETE … RETURNING` actually removing a row, not to the request arriving, which is what makes
   it exactly-once with AND without a `mutationId` and under a two-member race.
4. **The `useCanMutate()` gotcha.** Extend its list of shopping writes that are online-only and
   therefore gated on `isOnline` + `useEmailVerificationBlock()` rather than queued: list
   create/rename/delete (existing) **plus** `Clear bought`, catalog hide/unhide and
   "Remove recipe from list". `Undo` (back on the list) IS queued.

Not CLAUDE.md, but the same obligation: the header comment of
`packages/shared/src/schemas/shopping.ts` and the notes in `docs/API.md` both currently state
"there is no `checked` field anywhere" as a complete description of bought state. Both need the log
sentence, or the next reader will re-derive the wrong model.

---

## 10 — Gaps, and where this spec is guessing

Named explicitly, per the brief, rather than papered over:

1. **`Sort: newest` (SPEC § 6.2)** is drawn on `1d` and is NOT settled here because it needs no
   backend: the whole item array is in the detail payload. Recommendation for the frontend area:
   sort client-side with a `useState` over three options — `position` (as added, today's order),
   `newest` (`createdAt desc`) and `name` (`sortEntriesByFoldedName`'s comparator) — and do not add
   a `?sort=` query param to the list detail, because that would defeat the "every mutation returns
   the whole list" contract by making the response order request-dependent.
2. **The bought row's per-row dismiss.** The design offers only `Clear bought`, so the watermark
   (S1) is sufficient. If a per-row dismiss is ever wanted, it needs the rejected `cleared_at`
   column, not a hack on the watermark.
3. **`/shopping/history` (SPEC § 6.4) was never drawn.** The data is specified (§ 2.2c); the screen
   is extrapolated. Say so in the PR, as SPEC.md § 3 D6 requires.
4. **`boughtByName` is a full display name.** The artboards show `Eric` / `Lena`, i.e. first names.
   That is a client display concern (a `firstName()` helper next to `initials()` in
   `apps/web/src/lib/format.ts`), not a wire change — the API must keep sending the name it has.
5. **`ingredientTotal` counts the recipe as it is TODAY**, not as it was when it was added. So a
   recipe that gained an ingredient after being put on the list reads "5 of 6", which is
   informative rather than wrong — it is exactly the "add the missing one" prompt. Recorded here
   because it looks like a bug to anyone who assumes the count was frozen.
6. **`from-plan` scales with the plan entry's `servings`.** If area 02 makes `servings` nullable
   with "falls back to the recipe's" semantics (SPEC § 4.1 says it does), then a null there means
   factor 1 — identical to `addRecipeToShoppingList`'s own rule, so the preview and the add agree.
   If area 02 instead resolves the fallback server-side into a number, this endpoint must NOT
   double-resolve it.
