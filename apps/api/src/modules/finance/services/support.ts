/**
 * Shared types and helpers of the finance services (toon-finance `apps/api/src/services/support.ts`, plan M3 decision 15).
 *
 * `DbLike` / `Tx` are the core's (one definition for every service). The module's own `withTransaction` is gone (E5,
 * plan `docs/plans/e5-scripts.md` P11): a transaction is `Database.transaction` (`src/db/database.ts`), which opens a REAL
 * one on every file database (ADR 0009; toon-finance gotcha 2) and runs the effect inline where it is already inside one;
 * `apps/api/test/finance-file-db.test.ts` (a) and (d) prove the rollback on a database of its own and on the shared client.
 */
export type { DbLike, Tx } from "../../../core/services/households/support.ts";

/**
 * Escapes the LIKE metacharacters in a user-typed search term so `%` and `_` match themselves
 * (toon-finance 1715207). Use together with `ESCAPE '\\'` in the query: a bare
 * `like ${'%' + q + '%'}` lets `q = "%"` match every row.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
