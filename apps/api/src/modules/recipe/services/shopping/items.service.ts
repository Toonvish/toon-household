/**
 * Shopping-list items: add (with merging), edit, remove, check off, clear — plus
 * "put this recipe on the list, scaled to N portions".
 *
 * ## Merging is the whole story
 *
 * Adding never blindly inserts. Every incoming line is folded against what is already
 * on the list by `shoppingItemKey` from @toon/shared, so "200 g Mehl" twice becomes
 * one "400 g Mehl" line. The read-modify-write runs inside `withTransaction`, and the
 * UNIQUE index on `(list_id, merge_key)` is the backstop if two members ever race.
 *
 * ## Checking off is a DELETE, not a flag
 *
 * `checkShoppingItem` removes the row and bumps a `recipe_shopping_list_catalog` entry. The
 * item leaves the list and reappears under "Häufig gekauft", which is the Bring
 * behaviour the UI mimics. There is deliberately no `checked` column: a flag would
 * need a second "clear done" action, and the completed line would keep taking space in
 * a list you are reading one-handed in a supermarket.
 *
 * ## Everything returns the whole list
 *
 * Every function here answers with `getShoppingListDetail`. The web client replaces
 * its cache entry with that payload instead of patching it, which is what stops an
 * optimistic offline edit from drifting away from the server's version.
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md` P2, P8, P9, P13). `ShoppingItems` reads
 * the current executor of `Database` on every call, takes its timestamps from the `Clock` and refuses with the tagged
 * family. `ShoppingMutations.claimMutation` runs INSIDE the same `database.transaction` as the write it guards, so a
 * replayed `mutationId` applies once (P13); the ledger prune and the bought-log prune run after the transaction, where
 * they ran before. Every by-id read keeps its `householdId` filter (D8). `applyAdditions` and the catalog helpers are
 * exported `Effect.fnUntraced` helpers over `Database` (not a service): `bought.service.ts` re-adds an undone
 * check-off through the same `applyAdditions`, and no service depends on a service of its own cycle (P2). The
 * Promise bridges at the end keep `routes/shopping.ts` working until E3-T10.
 */
import {
  SHOPPING_LIMITS,
  addAmounts,
  ingredientToShoppingItem,
  mergeNotes,
  mergeSourceIds,
  nameKey,
  normalizeUnit,
  recipeToShoppingItems,
  scaleIngredients,
  shoppingItemKey,
  type AddRecipeToShoppingListRequest,
  type AddShoppingItemsRequest,
  type ShoppingCatalogListResponse,
  type ShoppingDraftItem,
  type ShoppingListDetailResponse,
  type UpdateShoppingItemRequest,
} from "@toon/shared";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import {
  recipeIngredients,
  shoppingListCatalog,
  shoppingListItems,
  shoppingListRecipes,
  shoppingLists,
} from "../../../../db/schema.ts";
import type { ShoppingListItemRow } from "../../../../db/schema.ts";
import { Conflict, NotFound } from "../../../../lib/errors.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import type { DbLike } from "../../../../core/services/households/support.ts";
import { runtime } from "../../../../runtime.ts";
import { toIngredientRecord } from "../recipes/mappers.ts";
import { Recipes } from "../recipes/recipes.service.ts";
import { appendBoughtItem, pruneBoughtLog } from "./bought.service.ts";
import { ShoppingMutations } from "./idempotency.ts";
import { ShoppingLists } from "./lists.service.ts";
import { toShoppingCatalogEntry } from "./mappers.ts";

/* -------------------------------------------------------------------------- */
/* the merge engine                                                           */
/* -------------------------------------------------------------------------- */

/** Normalises an incoming line into the shape the merge works on. */
function toDraft(input: {
  name: string;
  quantity?: number | null | undefined;
  unit?: string | null | undefined;
  note?: string | null | undefined;
  sourceRecipeIds?: string[];
}): ShoppingDraftItem {
  const unit = input.unit?.trim();
  return {
    name: input.name.trim().slice(0, 300),
    quantity: typeof input.quantity === "number" ? input.quantity : null,
    unit: unit && unit.length > 0 ? normalizeUnit(unit) : null,
    note: input.note?.trim() ? input.note.trim().slice(0, 300) : null,
    sourceRecipeIds: input.sourceRecipeIds ?? [],
  };
}

/** Existing rows keyed by their merge key. */
const loadItemsByKey = Effect.fnUntraced(function* (listId: string) {
  const database = yield* Database;
  const rows = yield* database.use((db) =>
    db
      .select()
      .from(shoppingListItems)
      .where(eq(shoppingListItems.listId, listId))
      .orderBy(asc(shoppingListItems.position)),
  );
  return new Map(rows.map((row) => [row.mergeKey, row]));
});

/** Highest position currently in use, or -1 for an empty list. */
const maxPosition = Effect.fnUntraced(function* (listId: string) {
  const database = yield* Database;
  const [row] = yield* database.use((db) =>
    db
      .select({ value: sql<number | null>`max(${shoppingListItems.position})` })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.listId, listId)),
  );
  return Number(row?.value ?? -1);
});

/**
 * Folds `additions` into the list: merged into an existing row where the key matches,
 * appended at the end otherwise. Must run inside a transaction.
 *
 * Also records every added NAME in the catalog with `useCount` untouched, so a
 * hand-typed item becomes a suggestion for next time without pretending it was ever
 * bought — only {@link ShoppingItems} `checkShoppingItem` increments the count.
 *
 * Exported: `undoBoughtItem` in `bought.service.ts` re-adds a check-off through
 * this SAME function, which is what makes 500 g undone onto 200 g fold into one
 * 700 g line rather than a separate function re-deriving the merge rule. It requires
 * `Database` (the current executor, the open transaction when called inside one), not a service.
 */
export const applyAdditions = Effect.fnUntraced(function* (
  listId: string,
  additions: readonly ShoppingDraftItem[],
): Effect.fn.Return<void, Conflict | DatabaseError, Database> {
  if (additions.length === 0) return;
  const database = yield* Database;

  const existing = yield* loadItemsByKey(listId);
  let position = yield* maxPosition(listId);
  const timestamp = yield* Clock.currentTimeMillis;

  for (const addition of additions) {
    if (addition.name.length === 0) continue;
    const key = shoppingItemKey(addition.name, addition.unit);
    const current = existing.get(key);

    if (current) {
      const summed = addAmounts(
        { quantity: current.quantity, unit: current.unit },
        { quantity: addition.quantity, unit: addition.unit },
      );
      const merged: ShoppingListItemRow = {
        ...current,
        // A same-key pair is always addable (the key contains the unit bucket); if it
        // somehow is not, keep the amount already on the list rather than lose it.
        quantity: summed ? summed.quantity : current.quantity,
        unit: summed ? summed.unit : current.unit,
        note: mergeNotes(current.note, addition.note),
        sourceRecipeIds: mergeSourceIds(
          Array.isArray(current.sourceRecipeIds) ? current.sourceRecipeIds : [],
          addition.sourceRecipeIds,
        ),
        updatedAt: timestamp,
      };
      yield* database.use((db) =>
        db
          .update(shoppingListItems)
          .set({
            quantity: merged.quantity,
            unit: merged.unit,
            note: merged.note,
            sourceRecipeIds: merged.sourceRecipeIds,
            updatedAt: timestamp,
          })
          .where(eq(shoppingListItems.id, current.id)),
      );
      existing.set(key, merged);
    } else {
      if (existing.size >= SHOPPING_LIMITS.itemsPerList) {
        return yield* new Conflict({
          code: "shopping_list_full",
          text: { key: "server.shopping.listFull", values: { max: SHOPPING_LIMITS.itemsPerList } },
        });
      }
      position += 1;
      const row: ShoppingListItemRow = {
        id: crypto.randomUUID(),
        listId,
        name: addition.name,
        mergeKey: key,
        quantity: addition.quantity,
        unit: addition.unit,
        note: addition.note,
        position,
        sourceRecipeIds: addition.sourceRecipeIds,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      yield* database.use((db) => db.insert(shoppingListItems).values(row));
      existing.set(key, row);
    }

    yield* touchCatalog(listId, addition.name, addition.unit, { bought: false });
  }

  yield* database.use((db) =>
    db.update(shoppingLists).set({ updatedAt: timestamp }).where(eq(shoppingLists.id, listId)),
  );
});

/* -------------------------------------------------------------------------- */
/* "Häufig gekauft"                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Upserts a catalog entry.
 *
 * `bought: true` (a check-off) increments `useCount`, which is what ranks the
 * suggestions. `bought: false` (a plain add) only refreshes `lastUsedAt` and the
 * remembered unit, so typing something and deleting it again never inflates the
 * ranking.
 */
const touchCatalog = Effect.fnUntraced(function* (
  listId: string,
  name: string,
  unit: string | null,
  options: { bought: boolean },
) {
  const trimmed = name.trim().slice(0, 300);
  if (trimmed.length === 0) return;
  const key = nameKey(trimmed);
  if (key.length === 0) return;
  const database = yield* Database;
  const timestamp = yield* Clock.currentTimeMillis;

  yield* database.use((db) =>
    db
      .insert(shoppingListCatalog)
      .values({
        id: crypto.randomUUID(),
        listId,
        name: trimmed,
        nameKey: key,
        unit,
        useCount: options.bought ? 1 : 0,
        lastUsedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: [shoppingListCatalog.listId, shoppingListCatalog.nameKey],
        set: {
          // Keep the spelling the household last used, so "Möhren" does not turn into "mohren".
          name: trimmed,
          unit,
          lastUsedAt: timestamp,
          useCount: options.bought
            ? sql`${shoppingListCatalog.useCount} + 1`
            : sql`${shoppingListCatalog.useCount}`,
        },
      }),
  );

  yield* pruneCatalog(listId);
});

/**
 * Caps the catalog per list, dropping the least useful entries (lowest use count,
 * then oldest). Without this, a household that types a lot would grow an unbounded table
 * whose only consumer shows 24 rows.
 */
const pruneCatalog = Effect.fnUntraced(function* (listId: string) {
  const database = yield* Database;
  const rows = yield* database.use((db) =>
    db
      .select({ id: shoppingListCatalog.id })
      .from(shoppingListCatalog)
      .where(eq(shoppingListCatalog.listId, listId))
      .orderBy(asc(shoppingListCatalog.useCount), asc(shoppingListCatalog.lastUsedAt)),
  );
  const excess = rows.length - SHOPPING_LIMITS.catalogPerList;
  if (excess <= 0) return;
  for (const row of rows.slice(0, excess)) {
    yield* database.use((db) => db.delete(shoppingListCatalog).where(eq(shoppingListCatalog.id, row.id)));
  }
});

/* -------------------------------------------------------------------------- */
/* the service                                                                */
/* -------------------------------------------------------------------------- */

/** The items of a shopping list: add (with merging), edit, remove, check off, clear, the catalog. */
export class ShoppingItems extends Context.Service<
  ShoppingItems,
  {
    /** Removes one suggestion ("nicht mehr vorschlagen"). Idempotent. */
    readonly deleteCatalogEntry: (
      householdId: string,
      listId: string,
      entryId: string,
    ) => Effect.Effect<void, NotFound | DatabaseError>;
    /**
     * Hides or unhides a "Häufig gekauft" entry WITHOUT touching its `useCount`
     * (SPEC § 4.6) — the design replaced the per-chip `×` with a long-press hide, and
     * deleting the entry would only make it come back on the next check-off having
     * lost its rank. `hidden: true` stamps `hidden_at`; `false` clears it.
     */
    readonly setCatalogEntryHidden: (
      householdId: string,
      listId: string,
      entryId: string,
      hidden: boolean,
    ) => Effect.Effect<ShoppingListDetailResponse, NotFound | DatabaseError>;
    /**
     * The "Show all" sheet's unhide surface (R20): the full catalog, hidden entries
     * included when `includeHidden` is set, ranked the same as the detail payload's
     * suggestions (`use_count desc, last_used_at desc`). Online-only, never persisted
     * (see `apps/web/src/lib/persist.ts`'s allow-list) — the detail payload's own
     * `catalog` already covers the common, offline-capable path.
     *
     * No index on `hidden_at`: the table is capped at `SHOPPING_LIMITS.catalogPerList`
     * (200) rows per list, and scanning 200 rows needs no index.
     */
    readonly listShoppingCatalog: (
      householdId: string,
      listId: string,
      options: { includeHidden: boolean; limit: number; offset: number },
    ) => Effect.Effect<ShoppingCatalogListResponse, NotFound | DatabaseError>;
    /** Adds one or more hand-entered lines, merging into what is already there. */
    readonly addShoppingItems: (
      householdId: string,
      listId: string,
      input: AddShoppingItemsRequest,
    ) => Effect.Effect<ShoppingListDetailResponse, NotFound | Conflict | DatabaseError>;
    /**
     * Puts a recipe's ingredients on the list, scaled to `servings`.
     *
     * Scaling uses the SAME `scaleIngredients` as `GET /recipes/:id/scale` and the detail
     * screen, with `keepNonScalingUnits` so a Prise stays a Prise. The recipe id is
     * recorded on every resulting line, so the list can show where "400 g Mehl" came from
     * even after the lines merged.
     *
     * A recipe with no `servingsAmount` cannot be scaled — there is nothing to scale FROM.
     * `servings` is then ignored rather than guessed at, and the amounts land as written.
     *
     * `input.ingredientIds` selects a subset. Filtering happens BEFORE scaling, so the
     * factor is unaffected by what was deselected. An id that no longer belongs to this
     * recipe is ignored, and a selection that matches nothing is a no-op rather than an
     * error — a queued offline request must not fail because the recipe changed meanwhile.
     */
    readonly addRecipeToShoppingList: (
      householdId: string,
      listId: string,
      userId: string,
      input: AddRecipeToShoppingListRequest,
    ) => Effect.Effect<ShoppingListDetailResponse, NotFound | Conflict | DatabaseError>;
    /**
     * Removes a recipe from the "Recipes on this list" rail (SPEC § 4.5 / A03 § 4.3).
     *
     * Deletes only the lines whose ENTIRE provenance was this recipe; a shared line
     * (also sourced from another recipe) is kept with its quantity UNCHANGED and the
     * id dropped from `sourceRecipeIds` — the merge that produced a combined amount is
     * not reversible (see the file header's "recipes -> list" section and A03 § 4.3
     * for why recompute-and-subtract was rejected). Idempotent: an unknown recipe id
     * is a no-op, matching `deleteShoppingItem`.
     */
    readonly removeRecipeFromList: (
      householdId: string,
      listId: string,
      recipeId: string,
    ) => Effect.Effect<ShoppingListDetailResponse, NotFound | DatabaseError>;
    /**
     * Edits one line. Changing `name` or `unit` can move it into another line's bucket;
     * the row is then deleted and its amount folded into that line, so the response can
     * legitimately contain one item fewer than the request implied.
     */
    readonly updateShoppingItem: (
      householdId: string,
      listId: string,
      itemId: string,
      input: UpdateShoppingItemRequest,
    ) => Effect.Effect<ShoppingListDetailResponse, NotFound | Conflict | DatabaseError>;
    /**
     * Removes a line WITHOUT counting it as bought — the "war doch nichts" case.
     * Idempotent: an unknown id is a no-op, because an offline queue may replay it.
     */
    readonly deleteShoppingItem: (
      householdId: string,
      listId: string,
      itemId: string,
    ) => Effect.Effect<ShoppingListDetailResponse, NotFound | DatabaseError>;
    /**
     * Checks a line off: it LEAVES the list, its catalog entry is bumped, and one row
     * is appended to `recipe_shopping_bought_items` — the "Bought today" section and the
     * history panel read that log, never a flag on this table (see the header).
     *
     * `boughtBy` is the checking user (the route passes `requireUser(c).id`) — recorded
     * on the log row, never on the item, which has no such column.
     *
     * ## Exactly-once, with and without a `mutationId`
     *
     * The DELETE and its guard are ONE statement (`… RETURNING`), and the append sits
     * strictly behind `if (!row) return`. That is what makes the whole operation
     * idempotent three ways at once, any one of which would suffice on its own:
     *  1. the ledger — a replayed `mutationId` never reaches the DELETE at all;
     *  2. the row's existence — a plain retry (no `mutationId`) finds nothing to
     *     delete, so `row` is `undefined` and the append never runs;
     *  3. the race — two members checking the same item at the same instant used to
     *     both see a row and both bump `use_count` (a pre-existing bug); `DELETE …
     *     RETURNING` makes exactly one of them see a row, so exactly one log row is
     *     written. `RETURNING` on DELETE needs SQLite >= 3.35 — libSQL ships 3.45.1,
     *     verified through `@libsql/client` (never `bun:sqlite`, which is newer).
     *
     * Needs no `mutationId` to be safe (gate 2 above covers a plain retry), though one
     * is accepted so the client can queue every mutation the same way.
     */
    readonly checkShoppingItem: (
      householdId: string,
      listId: string,
      itemId: string,
      boughtBy: string,
      mutationId?: string,
    ) => Effect.Effect<ShoppingListDetailResponse, NotFound | DatabaseError>;
    /**
     * Empties the list.
     *
     * Nothing is counted as bought: "alles löschen" is a correction, not a shopping trip.
     * The catalog is untouched, so the suggestions survive — which is exactly what makes
     * clearing safe to offer.
     */
    readonly clearShoppingList: (
      householdId: string,
      listId: string,
    ) => Effect.Effect<ShoppingListDetailResponse, NotFound | DatabaseError>;
    /**
     * Re-adds a suggestion to the list with no amount.
     *
     * No quantity on purpose: "Milch" from the suggestions means "we need milk again", and
     * inventing the amount from the last trip would be a guess the shopper then has to
     * check. The remembered unit is not applied either, for the same reason.
     */
    readonly addCatalogEntryToList: (
      householdId: string,
      listId: string,
      entryId: string,
      mutationId?: string,
    ) => Effect.Effect<ShoppingListDetailResponse, NotFound | Conflict | DatabaseError>;
  }
>()("toon/api/modules/recipe/services/shopping/items.service/ShoppingItems") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const lists = yield* ShoppingLists;
      const mutations = yield* ShoppingMutations;
      const recipes = yield* Recipes;

      /** Runs a `Database` helper of this file on this service's database (the current executor still applies). */
      const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
        Effect.provideService(effect, Database, database);

      const deleteCatalogEntry = Effect.fn("ShoppingItems.deleteCatalogEntry")(function* (
        householdId: string,
        listId: string,
        entryId: string,
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);
        yield* database.use((db) =>
          db
            .delete(shoppingListCatalog)
            .where(and(eq(shoppingListCatalog.id, entryId), eq(shoppingListCatalog.listId, listId))),
        );
      });

      const setCatalogEntryHidden = Effect.fn("ShoppingItems.setCatalogEntryHidden")(function* (
        householdId: string,
        listId: string,
        entryId: string,
        hidden: boolean,
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);
        const [row] = yield* database.use((db) =>
          db
            .select({ id: shoppingListCatalog.id })
            .from(shoppingListCatalog)
            .where(and(eq(shoppingListCatalog.id, entryId), eq(shoppingListCatalog.listId, listId)))
            .limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.shopping.suggestionNotFound" });

        const now = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db
            .update(shoppingListCatalog)
            .set({ hiddenAt: hidden ? now : null })
            .where(eq(shoppingListCatalog.id, entryId)),
        );

        return yield* lists.getShoppingListDetail(householdId, listId);
      });

      const listShoppingCatalog = Effect.fn("ShoppingItems.listShoppingCatalog")(function* (
        householdId: string,
        listId: string,
        options: { includeHidden: boolean; limit: number; offset: number },
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);
        const conditions = options.includeHidden
          ? eq(shoppingListCatalog.listId, listId)
          : and(eq(shoppingListCatalog.listId, listId), isNull(shoppingListCatalog.hiddenAt));

        const totalRow = yield* database.use((db) =>
          db.select({ value: count() }).from(shoppingListCatalog).where(conditions),
        );
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(shoppingListCatalog)
            .where(conditions)
            .orderBy(desc(shoppingListCatalog.useCount), desc(shoppingListCatalog.lastUsedAt))
            .limit(options.limit)
            .offset(options.offset),
        );

        return {
          items: rows.map(toShoppingCatalogEntry),
          total: Number(totalRow[0]?.value ?? 0),
          limit: options.limit,
          offset: options.offset,
        };
      });

      const addShoppingItems = Effect.fn("ShoppingItems.addShoppingItems")(function* (
        householdId: string,
        listId: string,
        input: AddShoppingItemsRequest,
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);

        yield* database.transaction(
          Effect.gen(function* () {
            if (!(yield* mutations.claimMutation(listId, input.mutationId))) return;
            yield* withDatabase(applyAdditions(listId, input.items.map((item) => toDraft(item))));
          }),
        );
        yield* mutations.pruneMutationLedger;

        return yield* lists.getShoppingListDetail(householdId, listId);
      });

      const addRecipeToShoppingList = Effect.fn("ShoppingItems.addRecipeToShoppingList")(function* (
        householdId: string,
        listId: string,
        userId: string,
        input: AddRecipeToShoppingListRequest,
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);
        const recipe = yield* recipes.loadRecipeRow(householdId, input.recipeId);
        const ingredientRows = yield* database.use((db) =>
          db
            .select()
            .from(recipeIngredients)
            .where(eq(recipeIngredients.recipeId, recipe.id))
            .orderBy(asc(recipeIngredients.position)),
        );
        const selected = input.ingredientIds === undefined ? undefined : new Set(input.ingredientIds);
        const ingredients = ingredientRows
          .filter((row) => selected === undefined || selected.has(row.id))
          .map(toIngredientRecord);

        const base = recipe.servingsAmount;
        const target = input.servings;
        const factor =
          typeof base === "number" && base > 0 && typeof target === "number" && target > 0
            ? target / base
            : 1;

        const scaled =
          factor === 1
            ? ingredients
            : scaleIngredients(ingredients, factor, { keepNonScalingUnits: true });
        const additions = recipeToShoppingItems(scaled, recipe.id);

        yield* database.transaction(
          Effect.gen(function* () {
            if (!(yield* mutations.claimMutation(listId, input.mutationId))) return;
            yield* withDatabase(applyAdditions(listId, additions));

            // "Recipes on this list" rail (SPEC § 4.5): re-adding at a DIFFERENT portion
            // count is the newest intent, so this upserts rather than ignoring a repeat.
            const timestamp = yield* Clock.currentTimeMillis;
            yield* database.use((db) =>
              db
                .insert(shoppingListRecipes)
                .values({
                  id: crypto.randomUUID(),
                  listId,
                  recipeId: recipe.id,
                  servings: input.servings ?? null,
                  addedBy: userId,
                  addedAt: timestamp,
                  updatedAt: timestamp,
                })
                .onConflictDoUpdate({
                  target: [shoppingListRecipes.listId, shoppingListRecipes.recipeId],
                  set: { servings: input.servings ?? null, updatedAt: timestamp },
                }),
            );
          }),
        );
        yield* mutations.pruneMutationLedger;

        return yield* lists.getShoppingListDetail(householdId, listId);
      });

      const removeRecipeFromList = Effect.fn("ShoppingItems.removeRecipeFromList")(function* (
        householdId: string,
        listId: string,
        recipeId: string,
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);

        yield* database.transaction(
          Effect.gen(function* () {
            const itemRows = yield* database.use((db) =>
              db.select().from(shoppingListItems).where(eq(shoppingListItems.listId, listId)),
            );
            const timestamp = yield* Clock.currentTimeMillis;

            for (const item of itemRows) {
              const sources = Array.isArray(item.sourceRecipeIds) ? item.sourceRecipeIds : [];
              if (!sources.includes(recipeId)) continue;
              if (sources.length === 1) {
                yield* database.use((db) => db.delete(shoppingListItems).where(eq(shoppingListItems.id, item.id)));
              } else {
                yield* database.use((db) =>
                  db
                    .update(shoppingListItems)
                    .set({
                      sourceRecipeIds: sources.filter((id) => id !== recipeId),
                      updatedAt: timestamp,
                    })
                    .where(eq(shoppingListItems.id, item.id)),
                );
              }
            }

            yield* database.use((db) =>
              db
                .delete(shoppingListRecipes)
                .where(and(eq(shoppingListRecipes.listId, listId), eq(shoppingListRecipes.recipeId, recipeId))),
            );
            yield* database.use((db) =>
              db.update(shoppingLists).set({ updatedAt: timestamp }).where(eq(shoppingLists.id, listId)),
            );
          }),
        );

        return yield* lists.getShoppingListDetail(householdId, listId);
      });

      /** The raw item row on this list, or a 404. */
      const loadItemRow = Effect.fn("ShoppingItems.loadItemRow")(function* (listId: string, itemId: string) {
        const [row] = yield* database.use((db) =>
          db
            .select()
            .from(shoppingListItems)
            .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)))
            .limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.shopping.itemNotFound" });
        return row;
      });

      const updateShoppingItem = Effect.fn("ShoppingItems.updateShoppingItem")(function* (
        householdId: string,
        listId: string,
        itemId: string,
        input: UpdateShoppingItemRequest,
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);
        const row = yield* loadItemRow(listId, itemId);

        const name = input.name ?? row.name;
        const unit =
          input.unit === undefined
            ? row.unit
            : input.unit === null || input.unit.trim().length === 0
              ? null
              : normalizeUnit(input.unit);
        const quantity = input.quantity === undefined ? row.quantity : (input.quantity ?? null);
        const note =
          input.note === undefined ? row.note : input.note && input.note.length > 0 ? input.note : null;

        const nextKey = shoppingItemKey(name, unit);
        const timestamp = yield* Clock.currentTimeMillis;

        yield* database.transaction(
          Effect.gen(function* () {
            if (nextKey !== row.mergeKey) {
              const collision = (yield* withDatabase(loadItemsByKey(listId))).get(nextKey);
              if (collision && collision.id !== row.id) {
                // The edit turned this line into one that already exists: drop this row and
                // add its amount to the other, rather than failing on the UNIQUE index.
                yield* database.use((db) => db.delete(shoppingListItems).where(eq(shoppingListItems.id, row.id)));
                yield* withDatabase(
                  applyAdditions(listId, [
                    {
                      name,
                      quantity,
                      unit,
                      note,
                      sourceRecipeIds: Array.isArray(row.sourceRecipeIds) ? row.sourceRecipeIds : [],
                    },
                  ]),
                );
                return;
              }
            }

            yield* database.use((db) =>
              db
                .update(shoppingListItems)
                .set({ name, mergeKey: nextKey, quantity, unit, note, updatedAt: timestamp })
                .where(eq(shoppingListItems.id, row.id)),
            );
            yield* withDatabase(touchCatalog(listId, name, unit, { bought: false }));
            yield* database.use((db) =>
              db.update(shoppingLists).set({ updatedAt: timestamp }).where(eq(shoppingLists.id, listId)),
            );
          }),
        );

        return yield* lists.getShoppingListDetail(householdId, listId);
      });

      const deleteShoppingItem = Effect.fn("ShoppingItems.deleteShoppingItem")(function* (
        householdId: string,
        listId: string,
        itemId: string,
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);
        yield* database.use((db) =>
          db
            .delete(shoppingListItems)
            .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId))),
        );
        const now = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db.update(shoppingLists).set({ updatedAt: now }).where(eq(shoppingLists.id, listId)),
        );
        return yield* lists.getShoppingListDetail(householdId, listId);
      });

      const checkShoppingItem = Effect.fn("ShoppingItems.checkShoppingItem")(function* (
        householdId: string,
        listId: string,
        itemId: string,
        boughtBy: string,
        mutationId?: string,
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);

        yield* database.transaction(
          Effect.gen(function* () {
            if (!(yield* mutations.claimMutation(listId, mutationId))) return;

            // ONE statement is both the removal and the guard — see the method comment.
            const [row] = yield* database.use((db) =>
              db
                .delete(shoppingListItems)
                .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)))
                .returning(),
            );
            if (!row) return;

            yield* withDatabase(appendBoughtItem(row, boughtBy));
            yield* withDatabase(touchCatalog(listId, row.name, row.unit, { bought: true }));
            const now = yield* Clock.currentTimeMillis;
            yield* database.use((db) =>
              db.update(shoppingLists).set({ updatedAt: now }).where(eq(shoppingLists.id, listId)),
            );
          }),
        );
        yield* mutations.pruneMutationLedger;
        yield* withDatabase(pruneBoughtLog());

        return yield* lists.getShoppingListDetail(householdId, listId);
      });

      const clearShoppingList = Effect.fn("ShoppingItems.clearShoppingList")(function* (
        householdId: string,
        listId: string,
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);
        yield* database.use((db) => db.delete(shoppingListItems).where(eq(shoppingListItems.listId, listId)));
        // An emptied list has no recipes ON it any more — the rail would otherwise show
        // stale "0 of N" rows for recipes whose lines just vanished.
        yield* database.use((db) => db.delete(shoppingListRecipes).where(eq(shoppingListRecipes.listId, listId)));
        const now = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db.update(shoppingLists).set({ updatedAt: now }).where(eq(shoppingLists.id, listId)),
        );
        return yield* lists.getShoppingListDetail(householdId, listId);
      });

      const addCatalogEntryToList = Effect.fn("ShoppingItems.addCatalogEntryToList")(function* (
        householdId: string,
        listId: string,
        entryId: string,
        mutationId?: string,
      ) {
        yield* lists.loadShoppingListRow(householdId, listId);
        const [entry] = yield* database.use((db) =>
          db
            .select()
            .from(shoppingListCatalog)
            .where(and(eq(shoppingListCatalog.id, entryId), eq(shoppingListCatalog.listId, listId)))
            .limit(1),
        );
        if (!entry) return yield* new NotFound({ text: "server.shopping.suggestionNotFound" });

        yield* database.transaction(
          Effect.gen(function* () {
            if (!(yield* mutations.claimMutation(listId, mutationId))) return;
            yield* withDatabase(applyAdditions(listId, [toDraft({ name: entry.name })]));
          }),
        );
        yield* mutations.pruneMutationLedger;

        return yield* lists.getShoppingListDetail(householdId, listId);
      });

      return ShoppingItems.of({
        deleteCatalogEntry,
        setCatalogEntryHidden,
        listShoppingCatalog,
        addShoppingItems,
        addRecipeToShoppingList,
        removeRecipeFromList,
        updateShoppingItem,
        deleteShoppingItem,
        checkShoppingItem,
        clearShoppingList,
        addCatalogEntryToList,
      });
    }),
  );
}

export { ingredientToShoppingItem };

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

// Every bridge honours its `db` argument with `Database.withExecutor(db)` (plan e3 P1). A failure rejects with the
// tagged error itself. All callers are `routes/shopping.ts` (E3-T10 deletes them). Promise.

export function deleteCatalogEntry(db: DbLike, householdId: string, listId: string, entryId: string): Promise<void> {
  return runtime.runPromise(
    ShoppingItems.use((s) => s.deleteCatalogEntry(householdId, listId, entryId)).pipe(Database.withExecutor(db)),
  );
}

export function setCatalogEntryHidden(
  db: DbLike,
  householdId: string,
  listId: string,
  entryId: string,
  hidden: boolean,
): Promise<ShoppingListDetailResponse> {
  return runtime.runPromise(
    ShoppingItems.use((s) => s.setCatalogEntryHidden(householdId, listId, entryId, hidden)).pipe(
      Database.withExecutor(db),
    ),
  );
}

export function listShoppingCatalog(
  db: DbLike,
  householdId: string,
  listId: string,
  options: { includeHidden: boolean; limit: number; offset: number },
): Promise<ShoppingCatalogListResponse> {
  return runtime.runPromise(
    ShoppingItems.use((s) => s.listShoppingCatalog(householdId, listId, options)).pipe(Database.withExecutor(db)),
  );
}

export function addShoppingItems(
  db: DbLike,
  householdId: string,
  listId: string,
  input: AddShoppingItemsRequest,
): Promise<ShoppingListDetailResponse> {
  return runtime.runPromise(
    ShoppingItems.use((s) => s.addShoppingItems(householdId, listId, input)).pipe(Database.withExecutor(db)),
  );
}

export function addRecipeToShoppingList(
  db: DbLike,
  householdId: string,
  listId: string,
  userId: string,
  input: AddRecipeToShoppingListRequest,
): Promise<ShoppingListDetailResponse> {
  return runtime.runPromise(
    ShoppingItems.use((s) => s.addRecipeToShoppingList(householdId, listId, userId, input)).pipe(
      Database.withExecutor(db),
    ),
  );
}

export function removeRecipeFromList(
  db: DbLike,
  householdId: string,
  listId: string,
  recipeId: string,
): Promise<ShoppingListDetailResponse> {
  return runtime.runPromise(
    ShoppingItems.use((s) => s.removeRecipeFromList(householdId, listId, recipeId)).pipe(Database.withExecutor(db)),
  );
}

export function updateShoppingItem(
  db: DbLike,
  householdId: string,
  listId: string,
  itemId: string,
  input: UpdateShoppingItemRequest,
): Promise<ShoppingListDetailResponse> {
  return runtime.runPromise(
    ShoppingItems.use((s) => s.updateShoppingItem(householdId, listId, itemId, input)).pipe(
      Database.withExecutor(db),
    ),
  );
}

export function deleteShoppingItem(
  db: DbLike,
  householdId: string,
  listId: string,
  itemId: string,
): Promise<ShoppingListDetailResponse> {
  return runtime.runPromise(
    ShoppingItems.use((s) => s.deleteShoppingItem(householdId, listId, itemId)).pipe(Database.withExecutor(db)),
  );
}

export function checkShoppingItem(
  db: DbLike,
  householdId: string,
  listId: string,
  itemId: string,
  boughtBy: string,
  mutationId?: string,
): Promise<ShoppingListDetailResponse> {
  return runtime.runPromise(
    ShoppingItems.use((s) => s.checkShoppingItem(householdId, listId, itemId, boughtBy, mutationId)).pipe(
      Database.withExecutor(db),
    ),
  );
}

export function clearShoppingList(db: DbLike, householdId: string, listId: string): Promise<ShoppingListDetailResponse> {
  return runtime.runPromise(
    ShoppingItems.use((s) => s.clearShoppingList(householdId, listId)).pipe(Database.withExecutor(db)),
  );
}

export function addCatalogEntryToList(
  db: DbLike,
  householdId: string,
  listId: string,
  entryId: string,
  mutationId?: string,
): Promise<ShoppingListDetailResponse> {
  return runtime.runPromise(
    ShoppingItems.use((s) => s.addCatalogEntryToList(householdId, listId, entryId, mutationId)).pipe(
      Database.withExecutor(db),
    ),
  );
}
