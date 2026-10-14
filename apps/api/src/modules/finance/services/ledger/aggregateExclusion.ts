/**
 * Rows tagged `sammelbuchung` — the one imported 44 588,91 € lump-sum
 * settlement (docs/ledger-spec.md §6.6) — are optionally excluded from a read
 * via `includeAggregates` (docs/spec.md §3.6/§3.8: it would otherwise flatten
 * every other bar in a chart). One query, shared by every reader that offers
 * the flag, so the tag name is spelled in exactly one place.
 */
import { SAMMELBUCHUNG_TAG, normalizeTagName } from "@toon/shared";
import { and, eq } from "drizzle-orm";
import { financeTags as tags, financeTransactionTags as transactionTags } from "../../schema.ts";
import type { DbLike } from "../support.ts";

/** Ids of every transaction tagged `sammelbuchung` in this household. Empty when the tag was never used. */
export async function sammelbuchungTransactionIds(db: DbLike, householdId: string): Promise<string[]> {
  const rows = await db
    .select({ transactionId: transactionTags.transactionId })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .where(and(eq(tags.householdId, householdId), eq(tags.nameKey, normalizeTagName(SAMMELBUCHUNG_TAG))));
  return rows.map((row) => row.transactionId);
}
