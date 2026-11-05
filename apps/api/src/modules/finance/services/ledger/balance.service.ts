/**
 * The balance and its sub-totals, from ONE query (docs/spec.md §3.8). All of
 * the arithmetic is `@toon/shared`'s `computeBreakdown`/`deltaForTransaction`
 * — this file only fetches rows and maps the shape onto the wire contract.
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e4-finance-services.md` P1, P2, P6). `FinanceBalance` keeps the
 * old function names with the leading `db` parameter dropped, reads the current executor of `Database` on every call
 * (so a settlement's open transaction is honoured) and stamps `asOf` from the module clock. `computeBalanceDelta` stays a
 * pure export. `getBalance` survives as a Promise bridge (`scripts/legacy/balance.ts`, `legacy-finance.test.ts`).
 */
import type { BalanceResponse, SplitModeValue } from "@toon/shared";
import { computeBreakdown, deltaForTransaction, periodOf } from "@toon/shared";
import { and, eq, notInArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import type { DatabaseError, Internal } from "../../../../lib/errors.ts";
import { toIso } from "../../../../lib/http.ts";
import { runFinanceBridge } from "../../bridge.ts";
import { financeTimeMillis } from "../../lib/clock.ts";
import { financeTransactions as transactions } from "../../schema.ts";
import { FinanceParticipants } from "../participants/participants.service.ts";
import type { DbLike } from "../support.ts";
import { sammelbuchungTransactionIds } from "./aggregateExclusion.ts";

/** `deltaForTransaction`, narrowed to the fields a DB row actually has. */
export function computeBalanceDelta(
  tx: { payerId: string; splitMode: SplitModeValue; amountCents: number },
  person1Id: string,
): number {
  return deltaForTransaction(tx, person1Id);
}

interface LedgerRow {
  payerId: string;
  splitMode: SplitModeValue;
  amountCents: number;
  bookedAt: number;
}

export interface BalanceHistoryPoint {
  period: string;
  deltaCents: number;
  balanceCents: number;
}

/** The balance, the running balance per period. */
export class FinanceBalance extends Context.Service<
  FinanceBalance,
  {
    /**
     * `GET …/balance`. `viewerUserId` is whoever is asking; `viewerBalanceCents`
     * negates `balanceCents` for a slot-2 viewer — the UI never renders a raw
     * sign either way (docs/spec.md §3.8).
     */
    readonly getBalance: (
      householdId: string,
      viewerUserId: string,
      viewerSlot: 1 | 2,
      includeAggregates: boolean,
    ) => Effect.Effect<BalanceResponse, Internal | DatabaseError>;
    /**
     * A running balance per period (docs/spec.md §3.8). The cumulative sum
     * always starts from the household's very first transaction — bounding
     * `from`/`to` only limits which points are RETURNED, never what the running
     * total is computed over, so the first returned point still reflects the
     * true historical balance rather than resetting to zero at the window edge.
     */
    readonly getBalanceHistory: (
      householdId: string,
      from: string | undefined,
      to: string | undefined,
      includeAggregates: boolean,
    ) => Effect.Effect<BalanceHistoryPoint[], Internal | DatabaseError>;
  }
>()("toon/api/modules/finance/services/ledger/balance.service/FinanceBalance") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const participants = yield* FinanceParticipants;

      const loadLedgerRows = Effect.fnUntraced(function* (householdId: string, includeAggregates: boolean) {
        const conditions = [eq(transactions.householdId, householdId)];
        if (!includeAggregates) {
          const excluded = yield* sammelbuchungTransactionIds(householdId).pipe(Effect.provideService(Database, database));
          if (excluded.length > 0) conditions.push(notInArray(transactions.id, excluded));
        }
        const rows: LedgerRow[] = yield* database.use((db) =>
          db
            .select({
              payerId: transactions.payerId,
              splitMode: transactions.splitMode,
              amountCents: transactions.amountCents,
              bookedAt: transactions.bookedAt,
            })
            .from(transactions)
            .where(and(...conditions)),
        );
        return rows;
      });

      const getBalance = Effect.fn("FinanceBalance.getBalance")(function* (
        householdId: string,
        viewerUserId: string,
        viewerSlot: 1 | 2,
        includeAggregates: boolean,
      ) {
        const person1Id = yield* participants.slot1UserId(householdId);
        const rows = yield* loadLedgerRows(householdId, includeAggregates);
        const breakdown = computeBreakdown(rows, person1Id);
        const now = yield* financeTimeMillis;

        return {
          balanceCents: breakdown.balanceCents,
          perspectiveUserId: person1Id,
          viewerUserId,
          viewerBalanceCents: viewerSlot === 1 ? breakdown.balanceCents : -breakdown.balanceCents,
          asOf: toIso(now),
          breakdown: {
            splitOtherCents: breakdown.splitOtherCents,
            forOtherCents: breakdown.forOtherCents,
            settledCents: breakdown.settledCents,
            transactionCount: breakdown.transactionCount,
          },
        } satisfies BalanceResponse;
      });

      const getBalanceHistory = Effect.fn("FinanceBalance.getBalanceHistory")(function* (
        householdId: string,
        from: string | undefined,
        to: string | undefined,
        includeAggregates: boolean,
      ) {
        const person1Id = yield* participants.slot1UserId(householdId);
        const rows = yield* loadLedgerRows(householdId, includeAggregates);

        const deltaByPeriod = new Map<string, number>();
        for (const row of rows) {
          const period = periodOf(row.bookedAt);
          const delta = computeBalanceDelta(row, person1Id);
          deltaByPeriod.set(period, (deltaByPeriod.get(period) ?? 0) + delta);
        }

        const periods = [...deltaByPeriod.keys()].sort();
        const points: BalanceHistoryPoint[] = [];
        let running = 0;
        for (const period of periods) {
          running += deltaByPeriod.get(period)!;
          points.push({ period, deltaCents: deltaByPeriod.get(period)!, balanceCents: running });
        }

        return points.filter((point) => (!from || point.period >= from) && (!to || point.period <= to));
      });

      return FinanceBalance.of({ getBalance, getBalanceHistory });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/**
 * SURVIVOR (plan e4 P1). Callers: `apps/api/scripts/legacy/balance.ts` (E5), `apps/api/test/legacy-finance.test.ts`
 * (pinned), `seed.ts` (E4-T07). A `DatabaseError` rejects with its `cause`, a refusal with the family member itself.
 */
export function getBalance(
  db: DbLike,
  householdId: string,
  viewerUserId: string,
  viewerSlot: 1 | 2,
  includeAggregates: boolean,
): Promise<BalanceResponse> {
  return runFinanceBridge(
    FinanceBalance.use((service) => service.getBalance(householdId, viewerUserId, viewerSlot, includeAggregates)),
    db,
  );
}

/** Callers: `routes/balance.ts` (E4-T08 deletes it). */
export function getBalanceHistory(
  db: DbLike,
  householdId: string,
  from: string | undefined,
  to: string | undefined,
  includeAggregates: boolean,
): Promise<BalanceHistoryPoint[]> {
  return runFinanceBridge(
    FinanceBalance.use((service) => service.getBalanceHistory(householdId, from, to, includeAggregates)),
    db,
  );
}
