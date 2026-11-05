/**
 * `GET …/transactions/summary` — the overview screen's aggregates in ONE
 * call (docs/spec.md §3.6): total spend, spend by category, spend + balance
 * delta by month. Settlements are excluded from `totalExpenseCents` and
 * `byCategory` via the single exported `isExpense` predicate — never an
 * ad-hoc filter per call site.
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e4-finance-services.md` P1, P2). `FinanceSummary.getTransactionSummary`
 * is the old function with the leading `db` dropped; a bad `from`/`to` fails `ValidationFailed` (the service-free
 * `parseRangeBound`) before any query runs, as before.
 */
import type { TransactionSummaryResponse } from "@toon/shared";
import { isExpense, periodOf } from "@toon/shared";
import { and, eq, gte, lte, notInArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import type { DatabaseError, Internal, ValidationFailed } from "../../../../lib/errors.ts";
import { financeCategories as categories, financeTransactions as transactions } from "../../schema.ts";
import { FinanceParticipants } from "../participants/participants.service.ts";
import { sammelbuchungTransactionIds } from "./aggregateExclusion.ts";
import { computeBalanceDelta } from "./balance.service.ts";
import { parseRangeBound } from "./dateRange.ts";

export interface TransactionSummaryFilters {
  from?: string;
  to?: string;
  includeAggregates: boolean;
}

interface CategoryBucket {
  categoryId: string | null;
  categorySlug: string | null;
  totalCents: number;
  count: number;
}

interface MonthBucket {
  totalCents: number;
  balanceDeltaCents: number;
}

/** The overview screen's aggregates. */
export class FinanceSummary extends Context.Service<
  FinanceSummary,
  {
    readonly getTransactionSummary: (
      householdId: string,
      filters: TransactionSummaryFilters,
    ) => Effect.Effect<TransactionSummaryResponse, ValidationFailed | Internal | DatabaseError>;
  }
>()("toon/api/modules/finance/services/ledger/summary.service/FinanceSummary") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const participants = yield* FinanceParticipants;

      const getTransactionSummary = Effect.fn("FinanceSummary.getTransactionSummary")(function* (
        householdId: string,
        filters: TransactionSummaryFilters,
      ) {
        const conditions = [eq(transactions.householdId, householdId)];
        if (filters.from) conditions.push(gte(transactions.bookedAt, yield* parseRangeBound(filters.from, "from")));
        if (filters.to) conditions.push(lte(transactions.bookedAt, yield* parseRangeBound(filters.to, "to")));
        if (!filters.includeAggregates) {
          const excluded = yield* sammelbuchungTransactionIds(householdId).pipe(Effect.provideService(Database, database));
          if (excluded.length > 0) conditions.push(notInArray(transactions.id, excluded));
        }

        const [person1Id, rows] = yield* Effect.all([
          participants.slot1UserId(householdId),
          database.use((db) =>
            db
              .select({
                payerId: transactions.payerId,
                splitMode: transactions.splitMode,
                amountCents: transactions.amountCents,
                bookedAt: transactions.bookedAt,
                categoryId: transactions.categoryId,
                categorySlug: categories.slug,
              })
              .from(transactions)
              .leftJoin(categories, eq(categories.id, transactions.categoryId))
              .where(and(...conditions)),
          ),
        ]);

        let totalExpenseCents = 0;
        let settlementTotalCents = 0;
        const byCategory = new Map<string, CategoryBucket>();
        const byMonth = new Map<string, MonthBucket>();

        for (const row of rows) {
          const period = periodOf(row.bookedAt);
          const month = byMonth.get(period) ?? { totalCents: 0, balanceDeltaCents: 0 };
          month.balanceDeltaCents += computeBalanceDelta(row, person1Id);

          if (isExpense(row)) {
            totalExpenseCents += row.amountCents;
            month.totalCents += row.amountCents;

            const key = row.categoryId ?? "none";
            const bucket = byCategory.get(key) ?? {
              categoryId: row.categoryId,
              categorySlug: row.categorySlug,
              totalCents: 0,
              count: 0,
            };
            bucket.totalCents += row.amountCents;
            bucket.count += 1;
            byCategory.set(key, bucket);
          } else {
            settlementTotalCents += row.amountCents;
          }

          byMonth.set(period, month);
        }

        const response: TransactionSummaryResponse = {
          from: filters.from ?? "",
          to: filters.to ?? "",
          totalExpenseCents,
          byCategory: [...byCategory.values()],
          byMonth: [...byMonth.entries()]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([period, value]) => ({ period, ...value })),
          settlementTotalCents,
        };
        return response;
      });

      return FinanceSummary.of({ getTransactionSummary });
    }),
  );
}
