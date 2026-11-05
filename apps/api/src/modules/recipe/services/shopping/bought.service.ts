/**
 * The check-off log ("Bought today" + the history panel + `/shopping/history`) —
 * D4's chosen alternative to a `bought_at` column on the item row.
 *
 * Checking an item off still DELETEs the row and still bumps
 * `recipe_shopping_list_catalog` (items.service.ts#checkShoppingItem); this file is what
 * that deletion additionally appends to, plus the two reads and the one write
 * (`Clear bought`) that watermark relies on. See the `recipe_shopping_bought_items` table
 * comment in db/schema.ts for the full "why a log, not a flag" reasoning, and
 * items.service.ts's header for why the item table itself is unchanged.
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md` P2, P9, P13). `ShoppingBought` reads
 * the current executor of `Database` on every call and takes time from the `Clock`. `undoBoughtItem` claims its
 * `mutationId` INSIDE the same `database.transaction` as the write it guards (a replay applies once); the ledger
 * prune runs after it, where it ran before. `appendBoughtItem` and `pruneBoughtLog` are exported `Effect.fnUntraced`
 * helpers over `Database` that `items.service.ts` provides inside `checkShoppingItem`: no service depends on a
 * service of its own cycle (P2). The Promise bridges at the end keep `routes/shopping.ts` working until E3-T10.
 */
import {
  nameKey,
  type ShoppingBoughtListResponse,
  type ShoppingListDetailResponse,
} from "@toon/shared";
import { and, count, desc, eq, lt, sql } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { shoppingBoughtItems, shoppingListCatalog, shoppingLists, users } from "../../../../db/schema.ts";
import type { ShoppingListItemRow } from "../../../../db/schema.ts";
import type { Conflict, DatabaseError, NotFound } from "../../../../lib/errors.ts";
import type { DbLike } from "../../../../core/services/households/support.ts";
import { runtime } from "../../../../runtime.ts";
import { applyAdditions } from "./items.service.ts";
import { ShoppingMutations } from "./idempotency.ts";
import { ShoppingLists } from "./lists.service.ts";
import { toShoppingBoughtItem } from "./mappers.ts";

/**
 * How long a purchase stays in the log. 90 days, NOT the mutation ledger's 14: a
 * mutation id is a replay token that is worthless once the persisted client cache
 * has expired (`PERSIST_MAX_AGE_MS`, 7 days), while a bought row is a RECORD — the
 * history panel and `/shopping/history` are the whole reason D4 chose a log. A
 * season is the shortest window in which "what did we buy in August" is still a
 * real question.
 */
export const BOUGHT_LOG_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Drops log rows past the TTL. Opportunistic, so a self-hosted box needs no cron
 * for it. Called from `checkShoppingItem` only — the one path that appends, so
 * the one path that has to pay. `recipe_shopping_bought_items_bought_at_idx` (household-blind,
 * the same role `recipe_shopping_mutations_applied_at_idx` plays for the ledger) is what
 * makes the sweep cheap.
 *
 * No per-list row cap: `SHOPPING_LIMITS.itemsPerList` bounds how much one trip can
 * append, and the TTL bounds the rest.
 */
export const pruneBoughtLog = Effect.fnUntraced(function* () {
  const database = yield* Database;
  const now = yield* Clock.currentTimeMillis;
  yield* database.use((db) =>
    db.delete(shoppingBoughtItems).where(lt(shoppingBoughtItems.boughtAt, now - BOUGHT_LOG_TTL_MS)),
  );
});

/**
 * Appends one log row for a just-deleted item. Called from inside the SAME
 * transaction as the `DELETE … RETURNING` that removed `row` — see
 * `checkShoppingItem`'s comment for why the append is bound to that delete
 * actually matching a row, not to the request merely arriving.
 */
export const appendBoughtItem = Effect.fnUntraced(function* (row: ShoppingListItemRow, boughtBy: string) {
  const database = yield* Database;
  const boughtAt = yield* Clock.currentTimeMillis;
  yield* database.use((db) =>
    db.insert(shoppingBoughtItems).values({
      id: crypto.randomUUID(),
      listId: row.listId,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      note: row.note,
      boughtBy,
      boughtAt,
      sourceRecipeIds: Array.isArray(row.sourceRecipeIds) ? row.sourceRecipeIds : [],
    }),
  );
});

/** The check-off log: the watermark, the undo and the archive reads. */
export class ShoppingBought extends Context.Service<
  ShoppingBought,
  {
    /**
     * `Clear bought`: moves the per-list watermark to now. The log itself is never
     * touched — the history panel and `/shopping/history` read PAST the watermark, so
     * nothing a member bought is ever lost by clearing the section (SPEC § 4.3).
     * Idempotent (clearing an already-clear section just re-stamps "now"), so it takes
     * no `mutationId` — the same reasoning `clearShoppingList` uses for "alles löschen".
     */
    readonly clearBoughtSection: (
      householdId: string,
      listId: string,
    ) => Effect.Effect<ShoppingListDetailResponse, NotFound | DatabaseError>;
    /**
     * Undoes one check-off (A03 § 1.5): deletes the log row and re-adds its amount to
     * the list through the SAME `applyAdditions` every other add goes through, so
     * undoing 500 g onto a list that has since gained 200 g folds into one 700 g line
     * — nothing is lost, nothing is invented. `use_count` is decremented and floored
     * at 0 (an undone check-off is not a purchase; floored because `applyAdditions`
     * itself calls `touchCatalog(..., { bought: false })`, which must never be able to
     * drive the count negative under any interleaving).
     *
     * Idempotent by construction: an unknown/already-undone `boughtId` finds no row to
     * delete and is a 200 no-op, the same shape `checkShoppingItem` already has.
     */
    readonly undoBoughtItem: (
      householdId: string,
      listId: string,
      boughtId: string,
      mutationId?: string,
    ) => Effect.Effect<ShoppingListDetailResponse, NotFound | Conflict | DatabaseError>;
    /**
     * `GET …/shopping-lists/bought` — the household-wide "Bought today" feed / history
     * panel / `/shopping/history` screen. The watermark is IGNORED here on purpose:
     * `Clear bought` only moves what the DETAIL screen's section shows, never what
     * this archive answers. `listId` narrows to one list; omitted, it is the whole
     * household (what the overview panel's "Lena is shopping now" derivation wants).
     */
    readonly listBoughtItems: (
      householdId: string,
      options: { listId?: string; limit: number; offset: number },
    ) => Effect.Effect<ShoppingBoughtListResponse, DatabaseError>;
  }
>()("toon/api/modules/recipe/services/shopping/bought.service/ShoppingBought") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const lists = yield* ShoppingLists;
      const mutations = yield* ShoppingMutations;

      const clearBoughtSection = Effect.fn("ShoppingBought.clearBoughtSection")(function* (
        householdId: string,
        listId: string,
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);
        const timestamp = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db
            .update(shoppingLists)
            .set({ boughtClearedAt: timestamp, updatedAt: timestamp })
            .where(eq(shoppingLists.id, listId)),
        );
        return yield* lists.getShoppingListDetail(householdId, listId);
      });

      const undoBoughtItem = Effect.fn("ShoppingBought.undoBoughtItem")(function* (
        householdId: string,
        listId: string,
        boughtId: string,
        mutationId?: string,
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);

        yield* database.transaction(
          Effect.gen(function* () {
            if (!(yield* mutations.claimMutation(listId, mutationId))) return;

            const [row] = yield* database.use((db) =>
              db
                .delete(shoppingBoughtItems)
                .where(and(eq(shoppingBoughtItems.id, boughtId), eq(shoppingBoughtItems.listId, listId)))
                .returning(),
            );
            if (!row) return;

            yield* applyAdditions(listId, [
              {
                name: row.name,
                quantity: row.quantity,
                unit: row.unit,
                note: row.note,
                sourceRecipeIds: Array.isArray(row.sourceRecipeIds) ? row.sourceRecipeIds : [],
              },
            ]).pipe(Effect.provideService(Database, database));

            yield* database.use((db) =>
              db
                .update(shoppingListCatalog)
                .set({ useCount: sql`max(${shoppingListCatalog.useCount} - 1, 0)` })
                .where(
                  and(
                    eq(shoppingListCatalog.listId, listId),
                    eq(shoppingListCatalog.nameKey, nameKey(row.name)),
                  ),
                ),
            );
            const now = yield* Clock.currentTimeMillis;
            yield* database.use((db) =>
              db.update(shoppingLists).set({ updatedAt: now }).where(eq(shoppingLists.id, listId)),
            );
          }),
        );
        yield* mutations.pruneMutationLedger;

        return yield* lists.getShoppingListDetail(householdId, listId);
      });

      const listBoughtItems = Effect.fn("ShoppingBought.listBoughtItems")(function* (
        householdId: string,
        options: { listId?: string; limit: number; offset: number },
      ) {
        const conditions = options.listId
          ? and(eq(shoppingLists.householdId, householdId), eq(shoppingBoughtItems.listId, options.listId))
          : eq(shoppingLists.householdId, householdId);

        const totalRow = yield* database.use((db) =>
          db
            .select({ value: count() })
            .from(shoppingBoughtItems)
            .innerJoin(shoppingLists, eq(shoppingLists.id, shoppingBoughtItems.listId))
            .where(conditions),
        );
        const rows = yield* database.use((db) =>
          db
            .select({ item: shoppingBoughtItems, boughtByName: users.name })
            .from(shoppingBoughtItems)
            .innerJoin(shoppingLists, eq(shoppingLists.id, shoppingBoughtItems.listId))
            .leftJoin(users, eq(users.id, shoppingBoughtItems.boughtBy))
            .where(conditions)
            .orderBy(desc(shoppingBoughtItems.boughtAt))
            .limit(options.limit)
            .offset(options.offset),
        );

        return {
          items: rows.map(({ item, boughtByName }) => toShoppingBoughtItem(item, boughtByName)),
          total: Number(totalRow[0]?.value ?? 0),
          limit: options.limit,
          offset: options.offset,
        };
      });

      return ShoppingBought.of({ clearBoughtSection, undoBoughtItem, listBoughtItems });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

// Every bridge honours its `db` argument with `Database.withExecutor(db)` (plan e3 P1). A failure rejects with the
// tagged error itself. All callers are `routes/shopping.ts` (E3-T10 deletes them). Promise.

export function clearBoughtSection(db: DbLike, householdId: string, listId: string): Promise<ShoppingListDetailResponse> {
  return runtime.runPromise(
    ShoppingBought.use((s) => s.clearBoughtSection(householdId, listId)).pipe(Database.withExecutor(db)),
  );
}

export function undoBoughtItem(
  db: DbLike,
  householdId: string,
  listId: string,
  boughtId: string,
  mutationId?: string,
): Promise<ShoppingListDetailResponse> {
  return runtime.runPromise(
    ShoppingBought.use((s) => s.undoBoughtItem(householdId, listId, boughtId, mutationId)).pipe(
      Database.withExecutor(db),
    ),
  );
}

export function listBoughtItems(
  db: DbLike,
  householdId: string,
  options: { listId?: string; limit: number; offset: number },
): Promise<ShoppingBoughtListResponse> {
  return runtime.runPromise(
    ShoppingBought.use((s) => s.listBoughtItems(householdId, options)).pipe(Database.withExecutor(db)),
  );
}
