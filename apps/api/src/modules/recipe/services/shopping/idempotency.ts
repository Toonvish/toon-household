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
 * that won the insert proceeds. On a memory DB (an explicit `TEST_DATABASE_URL=file::memory:`;
 * `bun test` itself runs on a temp file DB since ADR 0009) `withTransaction` degrades to
 * sequential statements, so a failure AFTER a successful claim leaves the id claimed
 * and the mutation unapplied. That is the deliberate trade: a lost mutation the user
 * can repeat by hand beats a silently doubled amount.
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md` P2, P9, P13). `ShoppingMutations` runs on
 * the CURRENT executor of `Database` and takes `appliedAt` from the `Clock`: called inside a `database.transaction`
 * (the write it guards), the claim is an INSERT on that transaction, so a replayed `mutationId` applies once. The
 * bridges at the end keep `items.service.ts` and `bought.service.ts` working until E3-T09; they honour their `db`
 * argument with `Database.withExecutor(db)`, so a claim made inside an unconverted `withTransaction` writes on that `tx`.
 */
import { and, eq, lt } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { shoppingMutations } from "../../../../db/schema.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import type { DbLike } from "../../../../core/services/households/support.ts";
import { runtime } from "../../../../runtime.ts";

/**
 * How long a mutation id is remembered. A queued offline mutation older than this is
 * long past being replayable (the persisted cache itself expires after 7 days — see
 * PERSIST_MAX_AGE_MS in apps/web/src/lib/persist.ts), so the ledger can forget it.
 */
export const MUTATION_LEDGER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** The `mutationId` ledger of the shopping lists. */
export class ShoppingMutations extends Context.Service<
  ShoppingMutations,
  {
    /**
     * Tries to claim `mutationId` for `listId`.
     *
     * @returns true when this call owns the mutation and must apply it, false when it was
     *          already applied and the caller must return current state untouched.
     */
    readonly claimMutation: (listId: string, mutationId: string | undefined) => Effect.Effect<boolean, DatabaseError>;
    /** True when `mutationId` has already been applied to this list. Tests only. */
    readonly hasAppliedMutation: (listId: string, mutationId: string) => Effect.Effect<boolean, DatabaseError>;
    /**
     * Drops ledger entries past the TTL. Called opportunistically from mutating paths, so
     * a self-hosted deployment needs no cron for it. Cheap: the index is on `applied_at`.
     */
    readonly pruneMutationLedger: Effect.Effect<void, DatabaseError>;
  }
>()("toon/api/modules/recipe/services/shopping/idempotency/ShoppingMutations") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const claimMutation = Effect.fn("ShoppingMutations.claimMutation")(function* (
        listId: string,
        mutationId: string | undefined,
      ) {
        // No id: the client is not asking for replay protection (a plain online request).
        if (!mutationId) return true;

        const appliedAt = yield* Clock.currentTimeMillis;
        const inserted = yield* database.use((db) =>
          db
            .insert(shoppingMutations)
            .values({ id: mutationId, listId, appliedAt })
            .onConflictDoNothing()
            .returning({ id: shoppingMutations.id }),
        );

        return inserted.length > 0;
      });

      const hasAppliedMutation = Effect.fn("ShoppingMutations.hasAppliedMutation")(function* (
        listId: string,
        mutationId: string,
      ) {
        const rows = yield* database.use((db) =>
          db
            .select({ id: shoppingMutations.id })
            .from(shoppingMutations)
            .where(and(eq(shoppingMutations.id, mutationId), eq(shoppingMutations.listId, listId)))
            .limit(1),
        );
        return rows.length > 0;
      });

      const pruneMutationLedger = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* database.use((db) =>
          db.delete(shoppingMutations).where(lt(shoppingMutations.appliedAt, now - MUTATION_LEDGER_TTL_MS)),
        );
      }).pipe(Effect.withSpan("ShoppingMutations.pruneMutationLedger"));

      return ShoppingMutations.of({ claimMutation, hasAppliedMutation, pruneMutationLedger });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

// Both honour their `db` argument with `Database.withExecutor(db)` (plan e3 P1): inside the callers' open
// `withTransaction(db, async (tx) => …)` the claim is written on that `tx`. Promise.

/** Callers: `shopping/items.service.ts`, `shopping/bought.service.ts` (E3-T09), on their transaction. Promise. */
export function claimMutation(db: DbLike, listId: string, mutationId: string | undefined): Promise<boolean> {
  return runtime.runPromise(
    ShoppingMutations.use((s) => s.claimMutation(listId, mutationId)).pipe(Database.withExecutor(db)),
  );
}

/** Callers: `shopping/items.service.ts`, `shopping/bought.service.ts` (E3-T09). Promise. */
export function pruneMutationLedger(db: DbLike): Promise<void> {
  return runtime.runPromise(ShoppingMutations.use((s) => s.pruneMutationLedger).pipe(Database.withExecutor(db)));
}
