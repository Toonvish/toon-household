/**
 * Free-text tags: case/whitespace-insensitive upsert-by-name, the "replace
 * every link when the field is present" sync a transaction write needs, and
 * the autocomplete reader (docs/spec.md §2.7, §3.10).
 *
 * There is no `POST /tags` (docs/spec.md §3.10): a tag is created only as a
 * side effect of attaching it to a transaction, so every write path here is
 * driven from `transactions.service.ts`.
 */
import type { FinanceTagResponse as TagResponse } from "@toon/shared";
import { normalizeTagName } from "@toon/shared";
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { type FinanceTagRow as TagRow, financeTags as tags, financeTransactionTags as transactionTags } from "../../schema.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { nowMs } from "../../lib/clock.ts";
import type { DbLike } from "../support.ts";

export function toTagResponse(row: TagRow): TagResponse {
  return { id: row.id, name: row.name, usageCount: row.usageCount };
}

/**
 * Resolves each name to a tag id, creating rows that don't exist yet.
 * `tags(household_id, name_key)` is unique, so a concurrent create for the
 * same normalized name is resolved by `onConflictDoUpdate` re-reading the
 * winner's id rather than racing a SELECT-then-INSERT — the `set` clause
 * only refreshes `name` (the household's latest spelling), never `usageCount`
 * (that is adjusted once, by {@link syncTransactionTags}, not on every upsert
 * call — a rename+re-tag must not double count).
 */
export async function upsertTagsByName(db: DbLike, householdId: string, names: readonly string[]): Promise<TagRow[]> {
  const seen = new Map<string, string>(); // nameKey -> display name (first wins)
  for (const raw of names) {
    const key = normalizeTagName(raw);
    if (key.length === 0) continue;
    if (!seen.has(key)) seen.set(key, raw.trim());
  }
  if (seen.size === 0) return [];

  const rows: TagRow[] = [];
  for (const [nameKey, name] of seen) {
    const [row] = await db
      .insert(tags)
      .values({ id: crypto.randomUUID(), householdId, name, nameKey, usageCount: 0, createdAt: nowMs() })
      .onConflictDoUpdate({ target: [tags.householdId, tags.nameKey], set: { name } })
      .returning();
    if (row) rows.push(row);
  }
  return rows;
}

/** The tag ids currently attached to a transaction. */
async function currentTagIds(db: DbLike, transactionId: string): Promise<string[]> {
  const rows = await db
    .select({ tagId: transactionTags.tagId })
    .from(transactionTags)
    .where(eq(transactionTags.transactionId, transactionId));
  return rows.map((row) => row.tagId);
}

async function adjustUsageCount(db: DbLike, tagIds: readonly string[], delta: 1 | -1): Promise<void> {
  if (tagIds.length === 0) return;
  await db
    .update(tags)
    .set({
      usageCount:
        delta === 1
          ? sql`${tags.usageCount} + 1`
          : sql`max(${tags.usageCount} - 1, 0)`,
    })
    .where(inArray(tags.id, [...tagIds]));
}

/**
 * Replace-all: attaches exactly `tagNames` to `transactionId`, creating
 * missing tags, dropping links no longer named, and keeping `usageCount`
 * accurate for both sides of the diff. Called ONLY when the caller's `tags`
 * field is present — "absent means untouched" is the route's job, not this
 * function's (docs/spec.md §3.6 replace-all-when-present).
 */
export async function syncTransactionTags(
  db: DbLike,
  householdId: string,
  transactionId: string,
  tagNames: readonly string[],
): Promise<void> {
  const resolved = await upsertTagsByName(db, householdId, tagNames);
  const nextIds = new Set(resolved.map((row) => row.id));
  const previousIds = new Set(await currentTagIds(db, transactionId));

  const added = [...nextIds].filter((id) => !previousIds.has(id));
  const removed = [...previousIds].filter((id) => !nextIds.has(id));

  if (removed.length > 0) {
    await db
      .delete(transactionTags)
      .where(and(eq(transactionTags.transactionId, transactionId), inArray(transactionTags.tagId, removed)));
    await adjustUsageCount(db, removed, -1);
  }
  if (added.length > 0) {
    await db.insert(transactionTags).values(added.map((tagId) => ({ transactionId, tagId })));
    await adjustUsageCount(db, added, 1);
  }
}

/** Drops every tag link of a transaction (used when a transaction itself is deleted). */
export async function clearTransactionTags(db: DbLike, transactionId: string): Promise<void> {
  const previousIds = await currentTagIds(db, transactionId);
  if (previousIds.length === 0) return;
  await db.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId));
  await adjustUsageCount(db, previousIds, -1);
}

/** `{ id, name }[]` for the transaction response — ordered by name for a stable UI. */
export async function tagRefsOf(db: DbLike, transactionId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: tags.id, name: tags.name })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .where(eq(transactionTags.transactionId, transactionId))
    .orderBy(asc(tags.name));
  return rows;
}

/**
 * {@link tagRefsOf} for a whole page of transactions in ONE query, keyed by
 * transaction id. The single `ORDER BY tags.name` carries over per group, so
 * each list comes out in the same order {@link tagRefsOf} would produce.
 * Transactions without tags are simply absent from the map.
 */
export async function tagRefsByTransactionIds(
  db: DbLike,
  transactionIds: readonly string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  const byTransaction = new Map<string, { id: string; name: string }[]>();
  if (transactionIds.length === 0) return byTransaction; // `inArray` with an empty list is not valid SQL
  const rows = await db
    .select({ transactionId: transactionTags.transactionId, id: tags.id, name: tags.name })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .where(inArray(transactionTags.transactionId, [...transactionIds]))
    .orderBy(asc(tags.name));
  for (const row of rows) {
    const refs = byTransaction.get(row.transactionId);
    if (refs) refs.push({ id: row.id, name: row.name });
    else byTransaction.set(row.transactionId, [{ id: row.id, name: row.name }]);
  }
  return byTransaction;
}

/**
 * `GET …/tags`: without `q`, the most-used tags (the suggestion list in the
 * create flow); with `q`, a prefix match on the normalized key.
 */
export async function listTags(db: DbLike, householdId: string, q: string | undefined, limit: number): Promise<TagResponse[]> {
  const conditions = [eq(tags.householdId, householdId)];
  if (q && q.trim().length > 0) conditions.push(like(tags.nameKey, `${normalizeTagName(q)}%`));

  const rows = await db
    .select()
    .from(tags)
    .where(and(...conditions))
    .orderBy(q ? asc(tags.name) : desc(tags.usageCount))
    .limit(limit);
  return rows.map(toTagResponse);
}

async function loadTagOr404(db: DbLike, householdId: string, tagId: string): Promise<TagRow> {
  const rows = await db.select().from(tags).where(and(eq(tags.id, tagId), eq(tags.householdId, householdId))).limit(1);
  const row = rows[0];
  if (!row) throw ApiError.notFound();
  return row;
}

/** Renames a tag. `409 tag_name_taken` if another tag in the household already normalizes to the same key. */
export async function updateTag(db: DbLike, householdId: string, tagId: string, name: string): Promise<TagResponse> {
  await loadTagOr404(db, householdId, tagId);
  const nameKey = normalizeTagName(name);
  const clash = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.householdId, householdId), eq(tags.nameKey, nameKey)))
    .limit(1);
  if (clash[0] && clash[0].id !== tagId) {
    throw ApiError.conflict("tag_name_taken", "server.tag.nameTaken");
  }
  await db.update(tags).set({ name: name.trim(), nameKey }).where(eq(tags.id, tagId));
  return toTagResponse(await loadTagOr404(db, householdId, tagId));
}

/** Deletes a tag; `transaction_tags` rows cascade, transactions themselves are untouched. */
export async function deleteTag(db: DbLike, householdId: string, tagId: string): Promise<void> {
  await loadTagOr404(db, householdId, tagId);
  await db.delete(tags).where(eq(tags.id, tagId));
}
