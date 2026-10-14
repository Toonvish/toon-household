/**
 * The balance and its sub-totals, from ONE query (docs/spec.md §3.8). All of
 * the arithmetic is `@toon/shared`'s `computeBreakdown`/`deltaForTransaction`
 * — this file only fetches rows and maps the shape onto the wire contract.
 */
import type { BalanceResponse, SplitModeValue } from "@toon/shared";
import { computeBreakdown, deltaForTransaction, periodOf } from "@toon/shared";
import { and, eq, notInArray } from "drizzle-orm";
import { financeTransactions as transactions } from "../../schema.ts";
import { nowMs } from "../../lib/clock.ts";
import { toIso } from "../../../../lib/http.ts";
import { slot1UserId } from "../participants/participants.service.ts";
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

async function loadLedgerRows(db: DbLike, householdId: string, includeAggregates: boolean): Promise<LedgerRow[]> {
  const conditions = [eq(transactions.householdId, householdId)];
  if (!includeAggregates) {
    const excluded = await sammelbuchungTransactionIds(db, householdId);
    if (excluded.length > 0) conditions.push(notInArray(transactions.id, excluded));
  }
  return db
    .select({
      payerId: transactions.payerId,
      splitMode: transactions.splitMode,
      amountCents: transactions.amountCents,
      bookedAt: transactions.bookedAt,
    })
    .from(transactions)
    .where(and(...conditions));
}

/**
 * `GET …/balance`. `viewerUserId` is whoever is asking; `viewerBalanceCents`
 * negates `balanceCents` for a slot-2 viewer — the UI never renders a raw
 * sign either way (docs/spec.md §3.8).
 */
export async function getBalance(
  db: DbLike,
  householdId: string,
  viewerUserId: string,
  viewerSlot: 1 | 2,
  includeAggregates: boolean,
): Promise<BalanceResponse> {
  const person1Id = await slot1UserId(db, householdId);
  const rows = await loadLedgerRows(db, householdId, includeAggregates);
  const breakdown = computeBreakdown(rows, person1Id);

  return {
    balanceCents: breakdown.balanceCents,
    perspectiveUserId: person1Id,
    viewerUserId,
    viewerBalanceCents: viewerSlot === 1 ? breakdown.balanceCents : -breakdown.balanceCents,
    asOf: toIso(nowMs()),
    breakdown: {
      splitOtherCents: breakdown.splitOtherCents,
      forOtherCents: breakdown.forOtherCents,
      settledCents: breakdown.settledCents,
      transactionCount: breakdown.transactionCount,
    },
  };
}

export interface BalanceHistoryPoint {
  period: string;
  deltaCents: number;
  balanceCents: number;
}

/**
 * A running balance per period (docs/spec.md §3.8). The cumulative sum
 * always starts from the household's very first transaction — bounding
 * `from`/`to` only limits which points are RETURNED, never what the running
 * total is computed over, so the first returned point still reflects the
 * true historical balance rather than resetting to zero at the window edge.
 */
export async function getBalanceHistory(
  db: DbLike,
  householdId: string,
  from: string | undefined,
  to: string | undefined,
  includeAggregates: boolean,
): Promise<BalanceHistoryPoint[]> {
  const person1Id = await slot1UserId(db, householdId);
  const rows = await loadLedgerRows(db, householdId, includeAggregates);

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
}
