/**
 * Rows tagged `sammelbuchung` — the one imported 44 588,91 € lump-sum
 * settlement (docs/ledger-spec.md §6.6) — are optionally excluded from a read
 * via `includeAggregates` (docs/spec.md §3.6/§3.8: it would otherwise flatten
 * every other bar in a chart). One query, shared by every reader that offers
 * the flag, so the tag name is spelled in exactly one place.
 */
import { SAMMELBUCHUNG_TAG, normalizeTagName } from "@toon/shared";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../../../db/database.ts";
import { financeTags as tags, financeTransactionTags as transactionTags } from "../../schema.ts";

/**
 * Ids of every transaction tagged `sammelbuchung` in this household. Empty when the tag was never used.
 *
 * AS AN EFFECT (docs/EFFECT.md E7; plan `docs/plans/e4-finance-services.md` P2): the one requirement is `Database`,
 * read on every run (the current executor, so an open transaction is honoured); a calling service method provides it
 * with `Effect.provideService(Database, database)`. Not a service: a pure query helper shared by three readers.
 */
export const sammelbuchungTransactionIds = Effect.fnUntraced(function* (householdId: string) {
  const database = yield* Database;
  const rows = yield* database.use((db) =>
    db
      .select({ transactionId: transactionTags.transactionId })
      .from(transactionTags)
      .innerJoin(tags, eq(tags.id, transactionTags.tagId))
      .where(and(eq(tags.householdId, householdId), eq(tags.nameKey, normalizeTagName(SAMMELBUCHUNG_TAG)))),
  );
  return rows.map((row) => row.transactionId);
});
