/**
 * Replay protection for the offline mutation queue (docs/spec.md §2.9,
 * CLAUDE.md gotcha #9/#10). `mutation_claims.id` IS the client-minted
 * `mutationId`; claiming it is an INSERT on that primary key with
 * `onConflictDoNothing().returning()`, never a SELECT-then-write — two
 * concurrent replays of the same id must not both read "not yet applied".
 *
 * `mutationId` is not a column on `transactions`: the claim also covers
 * PATCH/DELETE, which do not create a new row. For those the caller already
 * knows the target `transactionId`, so it is written into the claim at insert
 * time; for POST it starts `null` and is linked after the row exists (both
 * inside the same `withTransaction`, so a claim is never left dangling).
 */
import { and, eq, lt } from "drizzle-orm";
import { financeMutationClaims as mutationClaims } from "../../schema.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { nowMs } from "../../lib/clock.ts";
import type { DbLike } from "../support.ts";

/** How long a claim is remembered — matches the persisted offline cache's own TTL. */
export const MUTATION_CLAIM_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface ClaimResult {
  /** True when THIS call won the insert and must perform the mutation. */
  claimed: boolean;
  /** The transaction this mutationId is linked to, if any (null on a fresh claim with no id yet). */
  transactionId: string | null;
  /**
   * True when the id was already claimed by ANOTHER household (the claim's primary key is the
   * client-minted id alone). Such a claim is no replay of this household's call: the PATCH and
   * DELETE paths must not treat it as one (a silent no-op), see `assertOwnClaim`.
   */
  foreign: boolean;
}

/**
 * Claims `mutationId` for `householdId`. `transactionId` is the row this
 * mutation is already known to target (PATCH/DELETE); pass `null` for POST,
 * where the id is only known once the insert below has run, and link it
 * with {@link linkMutationClaim} inside the same transaction.
 */
export async function claimMutation(
  db: DbLike,
  mutationId: string,
  householdId: string,
  transactionId: string | null = null,
): Promise<ClaimResult> {
  const inserted = await db
    .insert(mutationClaims)
    .values({ id: mutationId, householdId, transactionId })
    .onConflictDoNothing()
    .returning({ transactionId: mutationClaims.transactionId });

  if (inserted.length > 0) return { claimed: true, transactionId: inserted[0]!.transactionId, foreign: false };

  const existing = await db
    .select({ transactionId: mutationClaims.transactionId, householdId: mutationClaims.householdId })
    .from(mutationClaims)
    .where(eq(mutationClaims.id, mutationId))
    .limit(1);
  const row = existing[0];
  return { claimed: false, transactionId: row?.transactionId ?? null, foreign: row !== undefined && row.householdId !== householdId };
}

/**
 * A lost claim whose owner is another household is a refusal, never a replay (toon-finance
 * 1715207, gotcha 71, carried to the PATCH and DELETE paths): without this, a PATCH or DELETE
 * carrying a foreign `mutationId` answered as if it had been applied and changed nothing.
 */
export function assertOwnClaim(claim: ClaimResult): void {
  if (claim.foreign) throw ApiError.conflict("conflict", "server.error.conflict");
}

/** Links a claim (made with `transactionId: null`, i.e. from a POST) to the row it created. */
export async function linkMutationClaim(db: DbLike, mutationId: string, transactionId: string): Promise<void> {
  await db.update(mutationClaims).set({ transactionId }).where(eq(mutationClaims.id, mutationId));
}

/**
 * True when `mutationId` was already claimed — a plain `SELECT`, never the
 * thing two concurrent FIRST deliveries race on ({@link claimMutation} is).
 *
 * This exists for exactly one caller, `deleteTransaction`: DELETE is the one
 * mutation whose successful effect (the row disappearing) destroys the very
 * evidence (`transactions.id`) a replay would otherwise need to look up
 * before it could even ask "was this already applied?" — `transaction_id`'s
 * `onDelete: "set null"` means the claim survives the row, but
 * `claimMutation`'s own `INSERT` carries a `transactionId` argument that
 * would trip `transactions.id`'s foreign key on a row that is legitimately
 * gone by the second delivery. Peeking by `mutationId` alone, before ever
 * touching `transactions`, is what lets a replayed delete answer "already
 * gone, done" instead of a spurious 404 — see docs/spec.md §3.1: a replay is
 * never an error.
 */
export async function peekMutationClaim(db: DbLike, mutationId: string, householdId: string): Promise<boolean> {
  // Scoped to the household: a client-minted id from ANOTHER household must never turn this delete
  // into a silent "already done" (toon-finance 1715207, gotcha 71).
  const existing = await db
    .select({ id: mutationClaims.id })
    .from(mutationClaims)
    .where(and(eq(mutationClaims.id, mutationId), eq(mutationClaims.householdId, householdId)))
    .limit(1);
  return existing.length > 0;
}

/** Drops claims past the TTL. Called opportunistically (services/plan/scheduler.ts's tick) — no cron needed. */
export async function pruneMutationClaims(db: DbLike, ttlMs: number = MUTATION_CLAIM_TTL_MS): Promise<number> {
  const deleted = await db
    .delete(mutationClaims)
    .where(lt(mutationClaims.appliedAt, nowMs() - ttlMs))
    .returning({ id: mutationClaims.id });
  return deleted.length;
}
