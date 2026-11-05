/**
 * Shopping lists ("Einkaufslisten"): CRUD plus the one payload the detail screen and
 * every mutation return.
 *
 * A list belongs to a HOUSEHOLD (locked decision 1), so every flatmate sees and edits the
 * same lines. Names are unique per household, case-insensitively and German-folded, the
 * same rule tags use.
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md` P2, P8, P9, P13). `ShoppingLists` reads
 * the current executor of `Database` on every call, takes its timestamps from the `Clock`, refuses with the tagged
 * family and checks ownership with `checkCanModifyOwned`. Every by-id read keeps its `householdId` filter (D8).
 */
import {
  SHOPPING_LIMITS,
  nameKey,
  type CreateShoppingListRequest,
  type ShoppingItemPreview,
  type ShoppingList,
  type ShoppingListDetailResponse,
  type UpdateShoppingListRequest,
} from "@toon/shared";
import { and, asc, count, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import {
  recipeIngredients,
  recipes,
  shoppingBoughtItems,
  shoppingListCatalog,
  shoppingListItems,
  shoppingListRecipes,
  shoppingLists,
  users,
} from "../../../../db/schema.ts";
import type { ShoppingListRow } from "../../../../db/schema.ts";
import { Conflict, NotFound } from "../../../../lib/errors.ts";
import type { DatabaseError, Forbidden } from "../../../../lib/errors.ts";
import type { Membership } from "../../../../lib/types.ts";
import { checkCanModifyOwned } from "../../../../core/services/households/membership.ts";
import { eqFolded, foldText, toCountMap } from "../../../../core/services/households/support.ts";
import {
  toShoppingBoughtItem,
  toShoppingCatalogEntry,
  toShoppingItem,
  toShoppingList,
  toShoppingListRecipe,
} from "./mappers.ts";

/** The household's shopping lists: the overview, the by-id row, CRUD and the detail payload. */
export class ShoppingLists extends Context.Service<
  ShoppingLists,
  {
    /**
     * All lists of a household, each with its open-item count plus the two overview-card
     * extras (SPEC § 6.6 / A03 § 2.2a): `boughtCount` ("4 bought today") and
     * `previewItems` (the item names the card shows before "+N"). THREE bounded
     * queries total, never a per-list N+1 — a local libSQL file is one serialised
     * write lane, and eight parallel queries cost eight times one (CLAUDE.md).
     *
     * `sinceMs` is the already-clamped instant the route computed from `?since`
     * (`[now - 7d, now]`, or `undefined` for "no floor beyond the watermark") — the
     * calendar-day boundary itself is a CLIENT concept (S4); this function only ever
     * compares instants.
     */
    readonly listShoppingLists: (
      householdId: string,
      sinceMs?: number,
    ) => Effect.Effect<ShoppingList[], DatabaseError>;
    /** The raw list row inside the household, or a 404 that never leaks other groups. */
    readonly loadShoppingListRow: (
      householdId: string,
      listId: string,
    ) => Effect.Effect<ShoppingListRow, NotFound | DatabaseError>;
    /** Creates a list; the per-household cap and the folded name are checked first (409). */
    readonly createShoppingList: (
      householdId: string,
      userId: string,
      input: CreateShoppingListRequest,
    ) => Effect.Effect<ShoppingList, Conflict | DatabaseError>;
    /** Renames a list. Any member may rename — the list is shared property. */
    readonly updateShoppingList: (
      householdId: string,
      listId: string,
      input: UpdateShoppingListRequest,
    ) => Effect.Effect<ShoppingList, NotFound | Conflict | DatabaseError>;
    /**
     * Deletes a list; items, catalog and ledger entries cascade.
     * Creator or admin+, matching collections — a shared list is not something one member
     * should be able to throw away on everyone else's behalf.
     */
    readonly deleteShoppingList: (
      membership: Membership,
      listId: string,
    ) => Effect.Effect<void, NotFound | Forbidden | DatabaseError>;
    /** Number of open lines on a list. */
    readonly countListItems: (listId: string) => Effect.Effect<number, DatabaseError>;
    /**
     * The whole screen in one response: list, open items in `position` order, and the
     * "Häufig gekauft" suggestions.
     *
     * EVERY mutating endpoint returns this too. That is deliberate: the web client
     * replaces its cache entry wholesale instead of patching it, so an optimistic offline
     * edit is corrected by the next server answer and cannot drift.
     *
     * Suggestions EXCLUDE anything currently on the list — offering "Milch" while Milch is
     * two rows above is noise, and tapping it would just merge into the existing line.
     */
    readonly getShoppingListDetail: (
      householdId: string,
      listId: string,
    ) => Effect.Effect<ShoppingListDetailResponse, NotFound | DatabaseError>;
  }
>()("toon/api/modules/recipe/services/shopping/lists.service/ShoppingLists") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const listShoppingLists = Effect.fn("ShoppingLists.listShoppingLists")(function* (
        householdId: string,
        sinceMs?: number,
      ) {
        const rows = yield* database.use((db) =>
          db
            .select({ list: shoppingLists, itemCount: count(shoppingListItems.id) })
            .from(shoppingLists)
            .leftJoin(shoppingListItems, eq(shoppingListItems.listId, shoppingLists.id))
            .where(eq(shoppingLists.householdId, householdId))
            .groupBy(shoppingLists.id)
            .orderBy(asc(shoppingLists.name)),
        );
        if (rows.length === 0) return [];

        const boughtCountRows = yield* database.use((db) =>
          db
            .select({ listId: shoppingBoughtItems.listId, value: count() })
            .from(shoppingBoughtItems)
            .innerJoin(shoppingLists, eq(shoppingLists.id, shoppingBoughtItems.listId))
            .where(
              and(
                eq(shoppingLists.householdId, householdId),
                // SQLite's max() with two arguments is the scalar (not aggregate) form.
                // STRICTLY newer: a clear covers the instant it happened, and `since` is
                // "after the moment you last looked". `>=` let a check-off landing in the
                // same millisecond as the watermark (or as a `since` clamped to now) leak
                // back into the count — a real boundary bug, and a flaky test.
                sql`${shoppingBoughtItems.boughtAt} > max(coalesce(${shoppingLists.boughtClearedAt}, 0), ${sinceMs ?? 0})`,
              ),
            )
            .groupBy(shoppingBoughtItems.listId),
        );
        const boughtCounts = toCountMap(
          boughtCountRows.map((row) => ({ key: row.listId, value: Number(row.value) })),
        );

        // Window function: the top listPreviewItems (8) rows per list, `position` order.
        // Verified through @libsql/client (bun test against file::memory: does exactly
        // that) — never through bun:sqlite, which is a newer SQLite than the one this
        // app ships (CLAUDE.md).
        const previewRows = yield* database.use((db) =>
          db.all<{
            listId: string;
            name: string;
            quantity: number | null;
            unit: string | null;
          }>(sql`
    select list_id as "listId", name, quantity, unit from (
      select i.list_id, i.name, i.quantity, i.unit,
             row_number() over (partition by i.list_id
                                order by i.position asc, i.created_at asc) as rn
        from recipe_shopping_list_items i
        join recipe_shopping_lists l on l.id = i.list_id
       where l.household_id = ${householdId}
    ) where rn <= ${SHOPPING_LIMITS.listPreviewItems}
  `),
        );
        const previewByList = new Map<string, ShoppingItemPreview[]>();
        for (const row of previewRows) {
          const bucket = previewByList.get(row.listId);
          const item = { name: row.name, quantity: row.quantity, unit: row.unit };
          if (bucket) bucket.push(item);
          else previewByList.set(row.listId, [item]);
        }

        return rows.map((row) =>
          toShoppingList(row.list, {
            itemCount: Number(row.itemCount),
            boughtCount: boughtCounts.get(row.list.id) ?? 0,
            previewItems: previewByList.get(row.list.id) ?? [],
          }),
        );
      });

      const loadShoppingListRow = Effect.fn("ShoppingLists.loadShoppingListRow")(function* (
        householdId: string,
        listId: string,
      ) {
        const [row] = yield* database.use((db) =>
          db
            .select()
            .from(shoppingLists)
            .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.householdId, householdId)))
            .limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.shopping.listNotFound" });
        return row;
      });

      /** Rejects a name already used in this household (folded), as 409. */
      const checkNameFree = Effect.fn("ShoppingLists.checkNameFree")(function* (
        householdId: string,
        name: string,
        exceptListId?: string,
      ) {
        const conditions = [eq(shoppingLists.householdId, householdId), eqFolded(shoppingLists.name, name)];
        if (exceptListId) conditions.push(ne(shoppingLists.id, exceptListId));
        const clash = yield* database.use((db) =>
          db
            .select({ id: shoppingLists.id })
            .from(shoppingLists)
            .where(and(...conditions))
            .limit(1),
        );
        if (clash.length > 0) {
          return yield* new Conflict({
            code: "shopping_list_name_taken",
            text: "server.shopping.listNameTaken",
          });
        }
      });

      const createShoppingList = Effect.fn("ShoppingLists.createShoppingList")(function* (
        householdId: string,
        userId: string,
        input: CreateShoppingListRequest,
      ) {
        const [existing] = yield* database.use((db) =>
          db.select({ value: count() }).from(shoppingLists).where(eq(shoppingLists.householdId, householdId)),
        );
        if (Number(existing?.value ?? 0) >= SHOPPING_LIMITS.listsPerHousehold) {
          return yield* new Conflict({
            code: "too_many_shopping_lists",
            text: { key: "server.shopping.tooManyLists", values: { max: SHOPPING_LIMITS.listsPerHousehold } },
          });
        }
        yield* checkNameFree(householdId, input.name);

        const now = yield* Clock.currentTimeMillis;
        const row: ShoppingListRow = {
          id: crypto.randomUUID(),
          householdId,
          name: input.name,
          createdBy: userId,
          boughtClearedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        yield* database.use((db) => db.insert(shoppingLists).values(row));
        return toShoppingList(row, { itemCount: 0 });
      });

      const countListItems = Effect.fn("ShoppingLists.countListItems")(function* (listId: string) {
        const [row] = yield* database.use((db) =>
          db.select({ value: count() }).from(shoppingListItems).where(eq(shoppingListItems.listId, listId)),
        );
        return Number(row?.value ?? 0);
      });

      const updateShoppingList = Effect.fn("ShoppingLists.updateShoppingList")(function* (
        householdId: string,
        listId: string,
        input: UpdateShoppingListRequest,
      ) {
        const row = yield* loadShoppingListRow(householdId, listId);
        if (foldText(input.name) !== foldText(row.name)) {
          yield* checkNameFree(householdId, input.name, listId);
        }

        const patch = { name: input.name, updatedAt: yield* Clock.currentTimeMillis };
        yield* database.use((db) => db.update(shoppingLists).set(patch).where(eq(shoppingLists.id, listId)));
        return toShoppingList({ ...row, ...patch }, { itemCount: yield* countListItems(listId) });
      });

      const deleteShoppingList = Effect.fn("ShoppingLists.deleteShoppingList")(function* (
        membership: Membership,
        listId: string,
      ) {
        const row = yield* loadShoppingListRow(membership.householdId, listId);
        yield* checkCanModifyOwned(membership, row);
        yield* database.use((db) => db.delete(shoppingLists).where(eq(shoppingLists.id, listId)));
      });

      const getShoppingListDetail = Effect.fn("ShoppingLists.getShoppingListDetail")(function* (
        householdId: string,
        listId: string,
      ) {
        const row = yield* loadShoppingListRow(householdId, listId);

        const itemRows = yield* database.use((db) =>
          db
            .select()
            .from(shoppingListItems)
            .where(eq(shoppingListItems.listId, listId))
            .orderBy(asc(shoppingListItems.position), asc(shoppingListItems.createdAt)),
        );

        // Resolve provenance titles in ONE query, restricted to the household so an id from
        // somewhere else could never surface a foreign recipe title.
        const sourceIds = [
          ...new Set(itemRows.flatMap((item) => (Array.isArray(item.sourceRecipeIds) ? item.sourceRecipeIds : []))),
        ];
        const titles = new Map<string, string>();
        if (sourceIds.length > 0) {
          const recipeRows = yield* database.use((db) =>
            db
              .select({ id: recipes.id, title: recipes.title })
              .from(recipes)
              .where(and(eq(recipes.householdId, householdId), inArray(recipes.id, sourceIds))),
          );
          for (const recipe of recipeRows) titles.set(recipe.id, recipe.title);
        }

        // Compare on the NAME key, not the merge key: "Milch" already on the list in litres
        // must also hide the suggestion, even though the units differ.
        const onList = new Set(itemRows.map((item) => nameKey(item.name)));
        const catalogRows = yield* database.use((db) =>
          db
            .select()
            .from(shoppingListCatalog)
            .where(and(eq(shoppingListCatalog.listId, listId), isNull(shoppingListCatalog.hiddenAt)))
            .orderBy(desc(shoppingListCatalog.useCount), desc(shoppingListCatalog.lastUsedAt))
            // Over-fetch, because the filter below removes an unknown number of rows.
            .limit(SHOPPING_LIMITS.catalogSuggestions * 3),
        );

        // "Bought today" section: rows past the `Clear bought` watermark, newest first.
        // The watermark and the log itself are two different things (S1) — clearing
        // never deletes a row, it only moves this boundary.
        const boughtRows = yield* database.use((db) =>
          db
            .select({ item: shoppingBoughtItems, boughtByName: users.name })
            .from(shoppingBoughtItems)
            .leftJoin(users, eq(users.id, shoppingBoughtItems.boughtBy))
            .where(
              and(
                eq(shoppingBoughtItems.listId, listId),
                // Strictly newer than the watermark — same rule as `listShoppingLists`'s count.
                gt(shoppingBoughtItems.boughtAt, row.boughtClearedAt ?? 0),
              ),
            )
            .orderBy(desc(shoppingBoughtItems.boughtAt))
            .limit(SHOPPING_LIMITS.boughtSectionMax),
        );

        // "Recipes on this list" rail (SPEC § 4.5). `ingredientTotal` is the recipe's
        // CURRENT ingredient count (R22), never a snapshot; `onListCount`/`sharedCount`
        // are pure JS over `itemRows`, already in memory — no `json_each` needed.
        const listRecipeRows = yield* database.use((db) =>
          db
            .select({ listRecipe: shoppingListRecipes, recipe: recipes })
            .from(shoppingListRecipes)
            .innerJoin(recipes, and(eq(recipes.id, shoppingListRecipes.recipeId), eq(recipes.householdId, householdId)))
            .where(eq(shoppingListRecipes.listId, listId))
            .orderBy(asc(shoppingListRecipes.addedAt)),
        );

        const recipeIds = listRecipeRows.map((r) => r.recipe.id);
        const ingredientCountRows =
          recipeIds.length === 0
            ? []
            : yield* database.use((db) =>
                db
                  .select({ key: recipeIngredients.recipeId, value: count() })
                  .from(recipeIngredients)
                  .where(inArray(recipeIngredients.recipeId, recipeIds))
                  .groupBy(recipeIngredients.recipeId),
              );
        const ingredientCounts = toCountMap(ingredientCountRows);

        const recipesRail = listRecipeRows.map(({ listRecipe, recipe }) => {
          let onListCount = 0;
          let sharedCount = 0;
          for (const item of itemRows) {
            const sources = Array.isArray(item.sourceRecipeIds) ? item.sourceRecipeIds : [];
            if (!sources.includes(recipe.id)) continue;
            onListCount += 1;
            if (sources.length > 1) sharedCount += 1;
          }
          return toShoppingListRecipe(listRecipe, recipe, {
            ingredientTotal: ingredientCounts.get(recipe.id) ?? 0,
            onListCount,
            sharedCount,
          });
        });

        return {
          list: toShoppingList(row, { itemCount: itemRows.length }),
          items: itemRows.map((item) => toShoppingItem(item, titles)),
          catalog: catalogRows
            .filter((entry) => !onList.has(entry.nameKey))
            .slice(0, SHOPPING_LIMITS.catalogSuggestions)
            .map(toShoppingCatalogEntry),
          bought: boughtRows.map(({ item, boughtByName }) => toShoppingBoughtItem(item, boughtByName)),
          recipes: recipesRail,
        } satisfies ShoppingListDetailResponse;
      });

      return ShoppingLists.of({
        listShoppingLists,
        loadShoppingListRow,
        createShoppingList,
        updateShoppingList,
        deleteShoppingList,
        countListItems,
        getShoppingListDetail,
      });
    }),
  );
}
