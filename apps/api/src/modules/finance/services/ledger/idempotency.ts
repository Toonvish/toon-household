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
 *
 * AS A SERVICE (docs/EFFECT.md E5, E6, E7, E12; plan `docs/plans/e4-finance-services.md` P2, P6, P7, P10). `FinanceMutationClaims`
 * runs on the CURRENT executor of `Database`: called inside the `database.transaction` a write opened, the claim is an INSERT
 * on that transaction, so a replayed `mutationId` applies once and a failing write leaves no claim behind. `pruneMutationClaims`
 * reads the module clock `financeTimeMillis` on every call. `checkOwnClaim` is the service-free refusal of a foreign claim.
 */
import { and, eq, lt } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { Conflict } from "../../../../lib/errors.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { runFinanceBridge } from "../../bridge.ts";
import { financeTimeMillis } from "../../lib/clock.ts";
import { financeMutationClaims as mutationClaims } from "../../schema.ts";
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
   * DELETE paths must not treat it as one (a silent no-op), see `checkOwnClaim`.
   */
  foreign: boolean;
}

/**
 * A lost claim whose owner is another household is a refusal, never a replay (toon-finance
 * 1715207, gotcha 73, carried to the PATCH and DELETE paths): without this, a PATCH or DELETE
 * carrying a foreign `mutationId` answered as if it had been applied and changed nothing.
 * Service-free: `409 conflict` (`server.error.conflict`).
 */
export const checkOwnClaim = Effect.fnUntraced(function* (claim: ClaimResult): Effect.fn.Return<void, Conflict> {
  if (claim.foreign) return yield* new Conflict({ code: "conflict", text: "server.error.conflict" });
});

/** The replay-protection ledger of the offline mutation queue. */
export class FinanceMutationClaims extends Context.Service<
  FinanceMutationClaims,
  {
    /**
     * Claims `mutationId` for `householdId`. `transactionId` is the row this
     * mutation is already known to target (PATCH/DELETE); pass `null` for POST,
     * where the id is only known once the insert below has run, and link it
     * with `linkMutationClaim` inside the same transaction.
     */
    readonly claimMutation: (
      mutationId: string,
      householdId: string,
      transactionId?: string | null,
    ) => Effect.Effect<ClaimResult, DatabaseError>;
    /** Links a claim (made with `transactionId: null`, i.e. from a POST) to the row it created. */
    readonly linkMutationClaim: (mutationId: string, transactionId: string) => Effect.Effect<void, DatabaseError>;
    /**
     * True when `mutationId` was already claimed — a plain `SELECT`, never the
     * thing two concurrent FIRST deliveries race on (`claimMutation` is).
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
    readonly peekMutationClaim: (mutationId: string, householdId: string) => Effect.Effect<boolean, DatabaseError>;
    /** Drops claims past the TTL. Called opportunistically (services/plan/scheduler.ts's tick) — no cron needed. */
    readonly pruneMutationClaims: (ttlMs?: number) => Effect.Effect<number, DatabaseError>;
  }
>()("toon/api/modules/finance/services/ledger/idempotency/FinanceMutationClaims") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const claimMutation = Effect.fn("FinanceMutationClaims.claimMutation")(function* (
        mutationId: string,
        householdId: string,
        transactionId: string | null = null,
      ) {
        const inserted = yield* database.use((db) =>
          db
            .insert(mutationClaims)
            .values({ id: mutationId, householdId, transactionId })
            .onConflictDoNothing()
            .returning({ transactionId: mutationClaims.transactionId }),
        );

        if (inserted.length > 0) {
          return { claimed: true, transactionId: inserted[0]!.transactionId, foreign: false } satisfies ClaimResult;
        }

        const existing = yield* database.use((db) =>
          db
            .select({ transactionId: mutationClaims.transactionId, householdId: mutationClaims.householdId })
            .from(mutationClaims)
            .where(eq(mutationClaims.id, mutationId))
            .limit(1),
        );
        const row = existing[0];
        return {
          claimed: false,
          transactionId: row?.transactionId ?? null,
          foreign: row !== undefined && row.householdId !== householdId,
        } satisfies ClaimResult;
      });

      const linkMutationClaim = Effect.fn("FinanceMutationClaims.linkMutationClaim")(function* (
        mutationId: string,
        transactionId: string,
      ) {
        yield* database.use((db) => db.update(mutationClaims).set({ transactionId }).where(eq(mutationClaims.id, mutationId)));
      });

      const peekMutationClaim = Effect.fn("FinanceMutationClaims.peekMutationClaim")(function* (
        mutationId: string,
        householdId: string,
      ) {
        // Scoped to the household: a client-minted id from ANOTHER household must never turn this delete
        // into a silent "already done" (toon-finance 1715207, gotcha 73).
        const existing = yield* database.use((db) =>
          db
            .select({ id: mutationClaims.id })
            .from(mutationClaims)
            .where(and(eq(mutationClaims.id, mutationId), eq(mutationClaims.householdId, householdId)))
            .limit(1),
        );
        return existing.length > 0;
      });

      const pruneMutationClaims = Effect.fn("FinanceMutationClaims.pruneMutationClaims")(function* (
        ttlMs: number = MUTATION_CLAIM_TTL_MS,
      ) {
        const now = yield* financeTimeMillis;
        const deleted = yield* database.use((db) =>
          db
            .delete(mutationClaims)
            .where(lt(mutationClaims.appliedAt, now - ttlMs))
            .returning({ id: mutationClaims.id }),
        );
        return deleted.length;
      });

      return FinanceMutationClaims.of({ claimMutation, linkMutationClaim, peekMutationClaim, pruneMutationClaims });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/** Callers: `transactions.service.ts` (E4-T04), `settlements.service.ts` (E4-T04). */
export function claimMutation(
  db: DbLike,
  mutationId: string,
  householdId: string,
  transactionId: string | null = null,
): Promise<ClaimResult> {
  return runFinanceBridge(
    FinanceMutationClaims.use((service) => service.claimMutation(mutationId, householdId, transactionId)),
    db,
  );
}

/** Callers: `transactions.service.ts` (E4-T04), `settlements.service.ts` (E4-T04). */
export function linkMutationClaim(db: DbLike, mutationId: string, transactionId: string): Promise<void> {
  return runFinanceBridge(FinanceMutationClaims.use((service) => service.linkMutationClaim(mutationId, transactionId)), db);
}

/** Callers: `transactions.service.ts` (E4-T04). */
export function peekMutationClaim(db: DbLike, mutationId: string, householdId: string): Promise<boolean> {
  return runFinanceBridge(FinanceMutationClaims.use((service) => service.peekMutationClaim(mutationId, householdId)), db);
}

/**
 * Callers: `transactions.service.ts` (E4-T04). SYNCHRONOUS, as the old function was: `Effect.runSync` over the
 * service-free {@link checkOwnClaim}; a foreign claim throws the `Conflict` (409 `conflict`) itself.
 */
export function assertOwnClaim(claim: ClaimResult): void {
  Effect.runSync(checkOwnClaim(claim));
}
