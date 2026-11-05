/**
 * Free-text tags: case/whitespace-insensitive upsert-by-name, the "replace
 * every link when the field is present" sync a transaction write needs, and
 * the autocomplete reader (docs/spec.md §2.7, §3.10).
 *
 * There is no `POST /tags` (docs/spec.md §3.10): a tag is created only as a
 * side effect of attaching it to a transaction, so every write path here is
 * driven from `transactions.service.ts`.
 *
 * AS A SERVICE (docs/EFFECT.md E5, E6, E7, E12; plan `docs/plans/e4-finance-services.md` P2, P6, P7, P10). `FinanceTags` runs on
 * the CURRENT executor of `Database` (inside a transaction a caller opened, every write here is part of it) and stamps new
 * tags with the module clock `financeTimeMillis`. The legacy bridges at the end keep the Promise functions the routes, the
 * transactions service, the accrual and the xlsx script still call; the xlsx script calls `syncTransactionTags` INSIDE its own
 * transaction, which the bridge honours (it runs on the executor it is handed).
 */
import type { FinanceTagResponse as TagResponse } from "@toon/shared";
import { normalizeTagName } from "@toon/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { Conflict, NotFound } from "../../../../lib/errors.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { runFinanceBridge } from "../../bridge.ts";
import { financeTimeMillis } from "../../lib/clock.ts";
import { type FinanceTagRow as TagRow, financeTags as tags, financeTransactionTags as transactionTags } from "../../schema.ts";
import { type DbLike, escapeLikePattern } from "../support.ts";

export function toTagResponse(row: TagRow): TagResponse {
  return { id: row.id, name: row.name, usageCount: row.usageCount };
}

/** A tag as the transaction response lists it. */
export interface TagRef {
  id: string;
  name: string;
}

/** The household's tags and their links to transactions. */
export class FinanceTags extends Context.Service<
  FinanceTags,
  {
    /**
     * Resolves each name to a tag id, creating rows that don't exist yet.
     * `tags(household_id, name_key)` is unique, so a concurrent create for the
     * same normalized name is resolved by `onConflictDoUpdate` re-reading the
     * winner's id rather than racing a SELECT-then-INSERT — the `set` clause
     * only refreshes `name` (the household's latest spelling), never `usageCount`
     * (that is adjusted once, by `syncTransactionTags`, not on every upsert
     * call — a rename+re-tag must not double count).
     */
    readonly upsertTagsByName: (householdId: string, names: readonly string[]) => Effect.Effect<TagRow[], DatabaseError>;
    /**
     * Replace-all: attaches exactly `tagNames` to `transactionId`, creating
     * missing tags, dropping links no longer named, and keeping `usageCount`
     * accurate for both sides of the diff. Called ONLY when the caller's `tags`
     * field is present — "absent means untouched" is the route's job, not this
     * function's (docs/spec.md §3.6 replace-all-when-present).
     */
    readonly syncTransactionTags: (
      householdId: string,
      transactionId: string,
      tagNames: readonly string[],
    ) => Effect.Effect<void, DatabaseError>;
    /** Drops every tag link of a transaction (used when a transaction itself is deleted). */
    readonly clearTransactionTags: (transactionId: string) => Effect.Effect<void, DatabaseError>;
    /** `{ id, name }[]` for the transaction response — ordered by name for a stable UI. */
    readonly tagRefsOf: (transactionId: string) => Effect.Effect<TagRef[], DatabaseError>;
    /**
     * `tagRefsOf` for a whole page of transactions in ONE query, keyed by
     * transaction id. The single `ORDER BY tags.name` carries over per group, so
     * each list comes out in the same order `tagRefsOf` would produce.
     * Transactions without tags are simply absent from the map.
     */
    readonly tagRefsByTransactionIds: (
      transactionIds: readonly string[],
    ) => Effect.Effect<Map<string, TagRef[]>, DatabaseError>;
    /**
     * `GET …/tags`: without `q`, the most-used tags (the suggestion list in the
     * create flow); with `q`, a prefix match on the normalized key.
     */
    readonly listTags: (
      householdId: string,
      q: string | undefined,
      limit: number,
    ) => Effect.Effect<TagResponse[], DatabaseError>;
    /** Renames a tag. `409 tag_name_taken` if another tag in the household already normalizes to the same key. */
    readonly updateTag: (
      householdId: string,
      tagId: string,
      name: string,
    ) => Effect.Effect<TagResponse, Conflict | NotFound | DatabaseError>;
    /** Deletes a tag; `transaction_tags` rows cascade, transactions themselves are untouched. */
    readonly deleteTag: (householdId: string, tagId: string) => Effect.Effect<void, NotFound | DatabaseError>;
  }
>()("toon/api/modules/finance/services/tags/tags.service/FinanceTags") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      /** The tag ids currently attached to a transaction. */
      const currentTagIds = Effect.fnUntraced(function* (transactionId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ tagId: transactionTags.tagId })
            .from(transactionTags)
            .where(eq(transactionTags.transactionId, transactionId)),
        );
        return rows.map((row) => row.tagId);
      });

      const adjustUsageCount = Effect.fnUntraced(function* (tagIds: readonly string[], delta: 1 | -1) {
        if (tagIds.length === 0) return;
        yield* database.use((db) =>
          db
            .update(tags)
            .set({
              usageCount: delta === 1 ? sql`${tags.usageCount} + 1` : sql`max(${tags.usageCount} - 1, 0)`,
            })
            .where(inArray(tags.id, [...tagIds])),
        );
      });

      const loadTagOr404 = Effect.fnUntraced(function* (householdId: string, tagId: string) {
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(tags)
            .where(and(eq(tags.id, tagId), eq(tags.householdId, householdId)))
            .limit(1),
        );
        const row = rows[0];
        if (!row) return yield* new NotFound();
        return row;
      });

      const upsertTagsByName = Effect.fn("FinanceTags.upsertTagsByName")(function* (
        householdId: string,
        names: readonly string[],
      ) {
        const seen = new Map<string, string>(); // nameKey -> display name (first wins)
        for (const raw of names) {
          const key = normalizeTagName(raw);
          if (key.length === 0) continue;
          if (!seen.has(key)) seen.set(key, raw.trim());
        }
        if (seen.size === 0) return [];

        const rows: TagRow[] = [];
        for (const [nameKey, name] of seen) {
          const createdAt = yield* financeTimeMillis;
          const [row] = yield* database.use((db) =>
            db
              .insert(tags)
              .values({ id: crypto.randomUUID(), householdId, name, nameKey, usageCount: 0, createdAt })
              .onConflictDoUpdate({ target: [tags.householdId, tags.nameKey], set: { name } })
              .returning(),
          );
          if (row) rows.push(row);
        }
        return rows;
      });

      const syncTransactionTags = Effect.fn("FinanceTags.syncTransactionTags")(function* (
        householdId: string,
        transactionId: string,
        tagNames: readonly string[],
      ) {
        const resolved = yield* upsertTagsByName(householdId, tagNames);
        const nextIds = new Set(resolved.map((row) => row.id));
        const previousIds = new Set(yield* currentTagIds(transactionId));

        const added = [...nextIds].filter((id) => !previousIds.has(id));
        const removed = [...previousIds].filter((id) => !nextIds.has(id));

        if (removed.length > 0) {
          yield* database.use((db) =>
            db
              .delete(transactionTags)
              .where(and(eq(transactionTags.transactionId, transactionId), inArray(transactionTags.tagId, removed))),
          );
          yield* adjustUsageCount(removed, -1);
        }
        if (added.length > 0) {
          yield* database.use((db) =>
            db.insert(transactionTags).values(added.map((tagId) => ({ transactionId, tagId }))),
          );
          yield* adjustUsageCount(added, 1);
        }
      });

      const clearTransactionTags = Effect.fn("FinanceTags.clearTransactionTags")(function* (transactionId: string) {
        const previousIds = yield* currentTagIds(transactionId);
        if (previousIds.length === 0) return;
        yield* database.use((db) => db.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId)));
        yield* adjustUsageCount(previousIds, -1);
      });

      const tagRefsOf = Effect.fn("FinanceTags.tagRefsOf")(function* (transactionId: string) {
        return yield* database.use((db) =>
          db
            .select({ id: tags.id, name: tags.name })
            .from(transactionTags)
            .innerJoin(tags, eq(tags.id, transactionTags.tagId))
            .where(eq(transactionTags.transactionId, transactionId))
            .orderBy(asc(tags.name)),
        );
      });

      const tagRefsByTransactionIds = Effect.fn("FinanceTags.tagRefsByTransactionIds")(function* (
        transactionIds: readonly string[],
      ) {
        const byTransaction = new Map<string, TagRef[]>();
        if (transactionIds.length === 0) return byTransaction; // `inArray` with an empty list is not valid SQL
        const rows = yield* database.use((db) =>
          db
            .select({ transactionId: transactionTags.transactionId, id: tags.id, name: tags.name })
            .from(transactionTags)
            .innerJoin(tags, eq(tags.id, transactionTags.tagId))
            .where(inArray(transactionTags.transactionId, [...transactionIds]))
            .orderBy(asc(tags.name)),
        );
        for (const row of rows) {
          const refs = byTransaction.get(row.transactionId);
          if (refs) refs.push({ id: row.id, name: row.name });
          else byTransaction.set(row.transactionId, [{ id: row.id, name: row.name }]);
        }
        return byTransaction;
      });

      const listTags = Effect.fn("FinanceTags.listTags")(function* (
        householdId: string,
        q: string | undefined,
        limit: number,
      ) {
        const conditions = [eq(tags.householdId, householdId)];
        if (q && q.trim().length > 0) {
          conditions.push(sql`${tags.nameKey} like ${`${escapeLikePattern(normalizeTagName(q))}%`} escape '\\'`);
        }

        const rows = yield* database.use((db) =>
          db
            .select()
            .from(tags)
            .where(and(...conditions))
            .orderBy(q ? asc(tags.name) : desc(tags.usageCount))
            .limit(limit),
        );
        return rows.map(toTagResponse);
      });

      const updateTag = Effect.fn("FinanceTags.updateTag")(function* (householdId: string, tagId: string, name: string) {
        yield* loadTagOr404(householdId, tagId);
        const nameKey = normalizeTagName(name);
        const clash = yield* database.use((db) =>
          db
            .select({ id: tags.id })
            .from(tags)
            .where(and(eq(tags.householdId, householdId), eq(tags.nameKey, nameKey)))
            .limit(1),
        );
        if (clash[0] && clash[0].id !== tagId) {
          return yield* new Conflict({ code: "tag_name_taken", text: "server.tag.nameTaken" });
        }
        yield* database.use((db) => db.update(tags).set({ name: name.trim(), nameKey }).where(eq(tags.id, tagId)));
        return toTagResponse(yield* loadTagOr404(householdId, tagId));
      });

      const deleteTag = Effect.fn("FinanceTags.deleteTag")(function* (householdId: string, tagId: string) {
        yield* loadTagOr404(householdId, tagId);
        yield* database.use((db) => db.delete(tags).where(eq(tags.id, tagId)));
      });

      return FinanceTags.of({
        upsertTagsByName,
        syncTransactionTags,
        clearTransactionTags,
        tagRefsOf,
        tagRefsByTransactionIds,
        listTags,
        updateTag,
        deleteTag,
      });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/**
 * Callers: `transactions.service.ts` (E4-T04), `accrual.service.ts` (E4-T06), `apps/api/scripts/finance-import-xlsx.ts` (E5,
 * survivor: it calls this INSIDE its own `withTransaction`, so the handed executor is the open transaction).
 */
export function syncTransactionTags(
  db: DbLike,
  householdId: string,
  transactionId: string,
  tagNames: readonly string[],
): Promise<void> {
  return runFinanceBridge(FinanceTags.use((service) => service.syncTransactionTags(householdId, transactionId, tagNames)), db);
}

/** Callers: `transactions.service.ts` (E4-T04). */
export function clearTransactionTags(db: DbLike, transactionId: string): Promise<void> {
  return runFinanceBridge(FinanceTags.use((service) => service.clearTransactionTags(transactionId)), db);
}

/** Callers: `transactions.service.ts` (E4-T04). */
export function tagRefsOf(db: DbLike, transactionId: string): Promise<{ id: string; name: string }[]> {
  return runFinanceBridge(FinanceTags.use((service) => service.tagRefsOf(transactionId)), db);
}

/** Callers: `transactions.service.ts` (E4-T04). */
export function tagRefsByTransactionIds(
  db: DbLike,
  transactionIds: readonly string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  return runFinanceBridge(FinanceTags.use((service) => service.tagRefsByTransactionIds(transactionIds)), db);
}

/** Callers: `routes/tags.ts` (E4-T08 deletes it). */
export function listTags(db: DbLike, householdId: string, q: string | undefined, limit: number): Promise<TagResponse[]> {
  return runFinanceBridge(FinanceTags.use((service) => service.listTags(householdId, q, limit)), db);
}

/** Callers: `routes/tags.ts` (E4-T08 deletes it). */
export function updateTag(db: DbLike, householdId: string, tagId: string, name: string): Promise<TagResponse> {
  return runFinanceBridge(FinanceTags.use((service) => service.updateTag(householdId, tagId, name)), db);
}

/** Callers: `routes/tags.ts` (E4-T08 deletes it). */
export function deleteTag(db: DbLike, householdId: string, tagId: string): Promise<void> {
  return runFinanceBridge(FinanceTags.use((service) => service.deleteTag(householdId, tagId)), db);
}
