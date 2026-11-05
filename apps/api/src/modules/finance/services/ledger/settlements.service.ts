/**
 * "Jetzt ausgleichen" (docs/spec.md §3.9, ledger-spec.md §5.4). A settlement
 * is a transaction like any other (`splitMode: "SETTLEMENT"`) — there is no
 * separate `settlements` table. This service is the convenience shell that
 * derives the payer from the balance's sign and enforces
 * `expectedBalanceCents` (the one race in this app that costs real money).
 *
 * AS A SERVICE (docs/EFFECT.md E5, E6, E7, E12; plan `docs/plans/e4-finance-services.md` P1, P2, P6, P7, P10).
 * `FinanceSettlements.createSettlement` is the old function with the leading `db` dropped; the claim, the balance
 * read and the row run in ONE `database.transaction` (the claim is never left behind by a refusal). The stale
 * balance is an `ApiFailure` that carries `details.currentBalanceCents` (a `Conflict` has no `details`).
 */
import type { CreateSettlementRequest, SettlementResponse } from "@toon/shared";
import { computeBreakdown, formatCents, serverText } from "@toon/shared";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import type { Database as DrizzleDatabase } from "../../../../db/client.ts";
import { Database } from "../../../../db/database.ts";
import { ApiFailure, Conflict, Internal, NotFound } from "../../../../lib/errors.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { runFinanceBridge } from "../../bridge.ts";
import { financeTimeMillis } from "../../lib/clock.ts";
import { financeTransactions as transactions } from "../../schema.ts";
import { FinanceCategories } from "../categories/categories.service.ts";
import { FinanceParticipants } from "../participants/participants.service.ts";
import { FinanceSettings } from "../settings/settings.service.ts";
import { FinanceBalance } from "./balance.service.ts";
import { FinanceMutationClaims } from "./idempotency.ts";
import { FinanceTransactions } from "./transactions.service.ts";

/** The `ausgleich` default category's stable slug — see `@toon/shared`'s `DEFAULT_CATEGORY_SLUGS`. */
const SETTLEMENT_CATEGORY_SLUG = "ausgleich";

export interface MutationOutcome {
  response: SettlementResponse;
  applied: boolean;
}

/** The "Jetzt ausgleichen" shell over the ledger. */
export class FinanceSettlements extends Context.Service<
  FinanceSettlements,
  {
    /**
     * `POST …/settlements`. Reads the current balance, compares it against
     * `expectedBalanceCents`, and — if it still matches — books exactly one
     * `SETTLEMENT` row whose payer is derived from the balance's sign.
     * `409 balance_stale` (with `details.currentBalanceCents`) otherwise.
     */
    readonly createSettlement: (
      householdId: string,
      viewerId: string,
      viewerSlot: 1 | 2,
      input: CreateSettlementRequest,
    ) => Effect.Effect<MutationOutcome, ApiFailure | Conflict | Internal | NotFound | DatabaseError>;
  }
>()("toon/api/modules/finance/services/ledger/settlements.service/FinanceSettlements") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const settings = yield* FinanceSettings;
      const participants = yield* FinanceParticipants;
      const categoriesService = yield* FinanceCategories;
      const ledger = yield* FinanceTransactions;
      const claims = yield* FinanceMutationClaims;
      const balance = yield* FinanceBalance;

      const createSettlement = Effect.fn("FinanceSettlements.createSettlement")(function* (
        householdId: string,
        viewerId: string,
        viewerSlot: 1 | 2,
        input: CreateSettlementRequest,
      ) {
        return yield* database.transaction(
          Effect.gen(function* () {
            const person1Id = yield* participants.slot1UserId(householdId);

            if (input.mutationId) {
              const claim = yield* claims.claimMutation(input.mutationId, householdId, null);
              if (!claim.claimed) {
                if (!claim.transactionId) return yield* new Internal();
                // The claim was found by its client-minted id alone; the row it points at must belong to THIS
                // household before it is echoed back (toon-finance 1715207, gotcha 73).
                const claimedId = claim.transactionId;
                const rows = yield* database.use((db) =>
                  db
                    .select()
                    .from(transactions)
                    .where(and(eq(transactions.id, claimedId), eq(transactions.householdId, householdId)))
                    .limit(1),
                );
                const row = rows[0];
                if (!row) return yield* new NotFound();
                const [transactionResponse, current] = yield* Effect.all([
                  ledger.toTransactionResponse(row, person1Id),
                  balance.getBalance(householdId, viewerId, viewerSlot, true),
                ]);
                return { response: { transaction: transactionResponse, balance: current }, applied: false } satisfies MutationOutcome;
              }
            }

            const ledgerRows = yield* database.use((db) =>
              db
                .select({ payerId: transactions.payerId, splitMode: transactions.splitMode, amountCents: transactions.amountCents })
                .from(transactions)
                .where(eq(transactions.householdId, householdId)),
            );
            const currentBalanceCents = computeBreakdown(ledgerRows, person1Id).balanceCents;

            if (currentBalanceCents !== input.expectedBalanceCents) {
              return yield* new ApiFailure({
                status: 409,
                code: "balance_stale",
                text: { key: "server.balance.stale", values: { amount: formatCents(currentBalanceCents) } },
                details: { currentBalanceCents },
              });
            }

            const amountCents = input.amountCents ?? Math.abs(currentBalanceCents);
            if (amountCents <= 0) {
              return yield* new ApiFailure({ status: 422, code: "settlement_amount_invalid", text: "server.settlement.amountInvalid" });
            }

            // balance > 0 => slot 2 owes slot 1 => slot 2 pays. balance <= 0 => slot 1 pays.
            const payerId =
              currentBalanceCents > 0 ? ((yield* participants.otherMemberId(householdId, person1Id)) ?? person1Id) : person1Id;
            if (currentBalanceCents > 0 && payerId === person1Id) {
              // No second member yet — there is no one who could owe slot 1.
              return yield* new Conflict({ code: "conflict", text: "server.household.needsSecondMember" });
            }

            const household = yield* settings.loadHouseholdRow(householdId);
            const description = input.note?.trim() || serverText(household.defaultLocale, "server.content.settlementDescription");
            const categoryId = yield* categoriesService.categoryIdBySlug(householdId, SETTLEMENT_CATEGORY_SLUG);

            const id = crypto.randomUUID();
            const timestamp = yield* financeTimeMillis;
            yield* database.use((db) =>
              db.insert(transactions).values({
                id,
                householdId,
                payerId,
                splitMode: "SETTLEMENT",
                amountCents,
                description,
                categoryId,
                bookedAt: input.bookedAt ? Date.parse(input.bookedAt) : timestamp,
                dateSource: "exact",
                origin: "manual",
                planPeriod: null,
                categorySource: "system",
                importSeq: null,
                externalKey: null,
                createdBy: viewerId,
                createdAt: timestamp,
                updatedAt: timestamp,
              }),
            );
            if (input.mutationId) yield* claims.linkMutationClaim(input.mutationId, id);

            const rows = yield* database.use((db) => db.select().from(transactions).where(eq(transactions.id, id)).limit(1));
            const row = rows[0]!;
            const [transactionResponse, current] = yield* Effect.all([
              ledger.toTransactionResponse(row, person1Id),
              balance.getBalance(householdId, viewerId, viewerSlot, true),
            ]);
            return { response: { transaction: transactionResponse, balance: current }, applied: true } satisfies MutationOutcome;
          }),
        );
      });

      return FinanceSettlements.of({ createSettlement });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/** Callers: `seed.ts` (E4-T07), `routes/settlements.ts` (E4-T08 deletes it). */
export function createSettlement(
  db: DrizzleDatabase,
  householdId: string,
  viewerId: string,
  viewerSlot: 1 | 2,
  input: CreateSettlementRequest,
): Promise<MutationOutcome> {
  return runFinanceBridge(
    FinanceSettlements.use((service) => service.createSettlement(householdId, viewerId, viewerSlot, input)),
    db,
  );
}
