/**
 * The idempotency ledger `legacy_ids` (SPEC D12, plan m5 decision 7).
 *
 * Every row the migration writes records `(table, legacy_source, legacy_id) -> new_id` in the
 * SAME `client.batch(…, "write")` as the row itself (`copy.ts`), so a row and its ledger entry
 * exist together or not at all. A legacy row whose entry exists is "already migrated" and never
 * touched again: a re-run resumes from the first unmapped row and a second `--apply` writes 0
 * rows. `table` is the TARGET table's SQL name; composite legacy keys are spelled `<a>:<b>`.
 *
 * Raw SQL on the client, never the shared drizzle `db` (decision 5). No module-scope code
 * beyond imports and constants.
 */
import type { Client, InStatement } from "@libsql/client";
import type { LegacySource } from "./types.ts";

/** SQL name of the ledger table (`legacyIds` in `src/db/schema/core.ts`; its column `table` is quoted). */
export const LEDGER_TABLE = "legacy_ids";

/** At most this many ids per `IN (…)` list. */
const LOOKUP_CHUNK = 500;

/** The ledger entries of `legacyIds` for one target table and source: legacy id -> new id. */
export async function lookupMany(
  client: Client,
  table: string,
  source: LegacySource,
  legacyIds: readonly string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const unique = [...new Set(legacyIds)];
  for (let start = 0; start < unique.length; start += LOOKUP_CHUNK) {
    const ids = unique.slice(start, start + LOOKUP_CHUNK);
    const placeholders = ids.map(() => "?").join(", ");
    const result = await client.execute({
      sql: `SELECT legacy_id, new_id FROM ${LEDGER_TABLE} WHERE "table" = ? AND legacy_source = ? AND legacy_id IN (${placeholders})`,
      args: [table, source, ...ids],
    });
    for (const row of result.rows) found.set(String(row.legacy_id), String(row.new_id));
  }
  return found;
}

/** Every ledger entry of one target table and source: legacy id -> new id. */
export async function loadAll(client: Client, table: string, source: LegacySource): Promise<Map<string, string>> {
  const result = await client.execute({
    sql: `SELECT legacy_id, new_id FROM ${LEDGER_TABLE} WHERE "table" = ? AND legacy_source = ?`,
    args: [table, source],
  });
  const found = new Map<string, string>();
  for (const row of result.rows) found.set(String(row.legacy_id), String(row.new_id));
  return found;
}

/**
 * The INSERT of one ledger entry, to be sent in the same batch as the row it records. A plain
 * INSERT on purpose: an existing entry means the caller wrote a row it should have counted as
 * already migrated, and the PRIMARY KEY failure surfaces that instead of hiding it.
 */
export function ledgerStatement(table: string, source: LegacySource, legacyId: string, newId: string): InStatement {
  return {
    sql: `INSERT INTO ${LEDGER_TABLE} ("table", legacy_source, legacy_id, new_id, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [table, source, legacyId, newId, Date.now()],
  };
}
