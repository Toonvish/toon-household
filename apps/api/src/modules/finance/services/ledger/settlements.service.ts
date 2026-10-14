/**
 * "Jetzt ausgleichen" (docs/spec.md §3.9, ledger-spec.md §5.4). A settlement
 * is a transaction like any other (`splitMode: "SETTLEMENT"`) — there is no
 * separate `settlements` table. This service is the convenience shell that
 * derives the payer from the balance's sign and enforces
 * `expectedBalanceCents` (the one race in this app that costs real money).
 */
import type { CreateSettlementRequest, SettlementResponse } from "@toon/shared";
import { computeBreakdown, formatCents } from "@toon/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../../../../db/client.ts";
import { financeTransactions as transactions } from "../../schema.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { nowMs } from "../../lib/clock.ts";
import { serverText } from "@toon/shared";
import { loadHouseholdRow } from "../settings/settings.service.ts";
import { otherMemberId, slot1UserId } from "../participants/participants.service.ts";
import { withTransaction } from "../support.ts";
import { categoryIdBySlug } from "../categories/categories.service.ts";
import { toTransactionResponse } from "./transactions.service.ts";
import { claimMutation, linkMutationClaim } from "./idempotency.ts";
import { getBalance } from "./balance.service.ts";

/** The `ausgleich` default category's stable slug — see `@toon/shared`'s `DEFAULT_CATEGORY_SLUGS`. */
const SETTLEMENT_CATEGORY_SLUG = "ausgleich";

export interface MutationOutcome {
  response: SettlementResponse;
  applied: boolean;
}

/**
 * `POST …/settlements`. Reads the current balance, compares it against
 * `expectedBalanceCents`, and — if it still matches — books exactly one
 * `SETTLEMENT` row whose payer is derived from the balance's sign.
 * `409 balance_stale` (with `details.currentBalanceCents`) otherwise.
 */
export async function createSettlement(
  db: Database,
  householdId: string,
  viewerId: string,
  viewerSlot: 1 | 2,
  input: CreateSettlementRequest,
): Promise<MutationOutcome> {
  return withTransaction(db, async (tx) => {
    const person1Id = await slot1UserId(tx, householdId);

    if (input.mutationId) {
      const claim = await claimMutation(tx, input.mutationId, householdId, null);
      if (!claim.claimed) {
        if (!claim.transactionId) throw ApiError.internal();
        const rows = await tx.select().from(transactions).where(eq(transactions.id, claim.transactionId)).limit(1);
        const row = rows[0];
        if (!row) throw ApiError.internal();
        const [transactionResponse, balance] = await Promise.all([
          toTransactionResponse(tx, row, person1Id),
          getBalance(tx, householdId, viewerId, viewerSlot, true),
        ]);
        return { response: { transaction: transactionResponse, balance }, applied: false };
      }
    }

    const ledgerRows = await tx
      .select({ payerId: transactions.payerId, splitMode: transactions.splitMode, amountCents: transactions.amountCents })
      .from(transactions)
      .where(eq(transactions.householdId, householdId));
    const currentBalanceCents = computeBreakdown(ledgerRows, person1Id).balanceCents;

    if (currentBalanceCents !== input.expectedBalanceCents) {
      throw new ApiError(
        409,
        "balance_stale",
        { key: "server.balance.stale", values: { amount: formatCents(currentBalanceCents) } },
        { currentBalanceCents },
      );
    }

    const amountCents = input.amountCents ?? Math.abs(currentBalanceCents);
    if (amountCents <= 0) throw new ApiError(422, "settlement_amount_invalid", "server.settlement.amountInvalid");

    // balance > 0 => slot 2 owes slot 1 => slot 2 pays. balance <= 0 => slot 1 pays.
    const payerId =
      currentBalanceCents > 0 ? await otherMemberId(tx, householdId, person1Id) ?? person1Id : person1Id;
    if (currentBalanceCents > 0 && payerId === person1Id) {
      // No second member yet — there is no one who could owe slot 1.
      throw ApiError.conflict("conflict", "server.household.needsSecondMember");
    }

    const household = await loadHouseholdRow(tx, householdId);
    const description = input.note?.trim() || serverText(household.defaultLocale, "server.content.settlementDescription");
    const categoryId = await categoryIdBySlug(tx, householdId, SETTLEMENT_CATEGORY_SLUG);

    const id = crypto.randomUUID();
    const timestamp = nowMs();
    await tx.insert(transactions).values({
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
    });
    if (input.mutationId) await linkMutationClaim(tx, input.mutationId, id);

    const rows = await tx.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    const row = rows[0]!;
    const [transactionResponse, balance] = await Promise.all([
      toTransactionResponse(tx, row, person1Id),
      getBalance(tx as unknown as Database, householdId, viewerId, viewerSlot, true),
    ]);
    return { response: { transaction: transactionResponse, balance }, applied: true };
  });
}
