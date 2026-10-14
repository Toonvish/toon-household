/**
 * At-most-once execution for shopping mutations — the piece that makes offline
 * editing safe rather than merely possible.
 *
 * ## The failure this exists for
 *
 * A phone in airplane mode queues "Lasagne auf die Liste" and replays it on
 * reconnect (apps/web/src/features/shopping/lib/offline.ts). If the ORIGINAL request
 * reached the server and only its response was lost, the replay applies it again.
 * Because shopping items merge by quantity, the result is not a visible duplicate row
 * you would notice — it is "500 g Mehl" quietly becoming "1 kg Mehl". You find out at
 * the till.
 *
 * So every replayable mutation carries a client-generated `mutationId` (a uuid) and
 * the API records it in `recipe_shopping_mutations` as part of the same write. A second
 * request with that id applies nothing and returns the CURRENT state, which is what
 * the client would have got the first time.
 *
 * ## Why the check is not a SELECT
 *
 * `hasApplied()` + "then write" is a race: two replays of the same id can both read
 * "not applied". The claim is therefore an INSERT on a primary key —
 * {@link claimMutation} returns false when the insert conflicts, and only the request
 * that won the insert proceeds. On a memory DB (tests) `withTransaction` degrades to
 * sequential statements, so a failure AFTER a successful claim leaves the id claimed
 * and the mutation unapplied. That is the deliberate trade: a lost mutation the user
 * can repeat by hand beats a silently doubled amount.
 */
import { and, eq, lt } from "drizzle-orm";
import { shoppingMutations } from "../../../../db/schema.ts";
import type { DbLike } from "../../../../core/services/households/support.ts";
import { nowMs } from "../../../../core/services/households/support.ts";

/**
 * How long a mutation id is remembered. A queued offline mutation older than this is
 * long past being replayable (the persisted cache itself expires after 7 days — see
 * PERSIST_MAX_AGE_MS in apps/web/src/lib/persist.ts), so the ledger can forget it.
 */
export const MUTATION_LEDGER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Tries to claim `mutationId` for `listId`.
 *
 * @returns true when this call owns the mutation and must apply it, false when it was
 *          already applied and the caller must return current state untouched.
 */
export async function claimMutation(
  db: DbLike,
  listId: string,
  mutationId: string | undefined,
): Promise<boolean> {
  // No id: the client is not asking for replay protection (a plain online request).
  if (!mutationId) return true;

  const inserted = await db
    .insert(shoppingMutations)
    .values({ id: mutationId, listId, appliedAt: nowMs() })
    .onConflictDoNothing()
    .returning({ id: shoppingMutations.id });

  return inserted.length > 0;
}

/** True when `mutationId` has already been applied to this list. Tests only. */
export async function hasAppliedMutation(
  db: DbLike,
  listId: string,
  mutationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: shoppingMutations.id })
    .from(shoppingMutations)
    .where(and(eq(shoppingMutations.id, mutationId), eq(shoppingMutations.listId, listId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Drops ledger entries past the TTL. Called opportunistically from mutating paths, so
 * a self-hosted deployment needs no cron for it. Cheap: the index is on `applied_at`.
 */
export async function pruneMutationLedger(db: DbLike): Promise<void> {
  await db
    .delete(shoppingMutations)
    .where(lt(shoppingMutations.appliedAt, nowMs() - MUTATION_LEDGER_TTL_MS));
}
