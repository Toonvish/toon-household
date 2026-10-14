/**
 * The finance module's TanStack Query keys, query options and invalidation helpers: F
 * `lib/queries.ts` §keys, §finance query options and §invalidation (F lines 83–123, 197–287,
 * 293–369), built on the core key factory in `@/lib/queries` (M3 decision 10). Core keys
 * (`me`, `households`, `household`, `householdMembers`, …) come from the spread, never redefined.
 *
 * Key layout (the core layout is in `@/lib/queries`):
 *   ["toon","household",householdId,"finance",<segment>,…]  <- one household's ledger
 *   ["toon", "finance", "tx", <op>]                          <- transaction mutation keys (offline.ts)
 *
 * Fetchers come from `./api`; a prefix invalidates a whole subtree.
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type {
  BalanceHistoryQuery,
  BalanceQuery,
  FinancePaginationQuery as PaginationQuery,
  TransactionListQuery,
  TransactionSummaryQuery,
} from "@toon/shared";
import {
  filterKey,
  invalidate as coreInvalidate,
  queryKeys as coreQueryKeys,
  STALE_TIME,
} from "@/lib/queries";
import {
  fetchBalance,
  fetchBalanceHistory,
  fetchCategories,
  fetchFinanceParticipants,
  fetchPlan,
  fetchPlanPreview,
  fetchPlanRuns,
  fetchSettlements,
  fetchTags,
  fetchTransaction,
  fetchTransactionSummary,
  fetchTransactions,
} from "./api";

export * from "@/lib/queries";

const ROOT = "toon" as const;

/* -------------------------------------------------------------------------- */
/* keys                                                                       */
/* -------------------------------------------------------------------------- */

export const queryKeys = {
  ...coreQueryKeys,

  financeParticipants: (householdId: string) =>
    [ROOT, "household", householdId, "finance", "participants"] as const,

  transactions: (householdId: string, query?: Partial<TransactionListQuery>) =>
    [ROOT, "household", householdId, "finance", "transactions", filterKey(query)] as const,
  transactionsRoot: (householdId: string) => [ROOT, "household", householdId, "finance", "transactions"] as const,
  transaction: (householdId: string, transactionId: string) =>
    [ROOT, "household", householdId, "finance", "transaction", transactionId] as const,
  transactionSummary: (householdId: string, query?: Partial<TransactionSummaryQuery>) =>
    [ROOT, "household", householdId, "finance", "transaction-summary", filterKey(query)] as const,

  categories: (householdId: string, includeHidden?: boolean) =>
    [ROOT, "household", householdId, "finance", "categories", { includeHidden: includeHidden ?? false }] as const,
  tags: (householdId: string, query?: { q?: string; limit?: number }) =>
    [ROOT, "household", householdId, "finance", "tags", filterKey(query)] as const,

  plan: (householdId: string) => [ROOT, "household", householdId, "finance", "plan"] as const,
  planPreview: (householdId: string, period: string) =>
    [ROOT, "household", householdId, "finance", "plan-preview", period] as const,
  planRuns: (householdId: string, query?: Partial<PaginationQuery>) =>
    [ROOT, "household", householdId, "finance", "plan-runs", filterKey(query)] as const,

  balance: (householdId: string, query?: Partial<BalanceQuery>) =>
    [ROOT, "household", householdId, "finance", "balance", filterKey(query)] as const,
  balanceHistory: (householdId: string, query?: Partial<BalanceHistoryQuery>) =>
    [ROOT, "household", householdId, "finance", "balance-history", filterKey(query)] as const,

  settlements: (householdId: string, query?: Partial<PaginationQuery>) =>
    [ROOT, "household", householdId, "finance", "settlements", filterKey(query)] as const,
} as const;

/* -------------------------------------------------------------------------- */
/* query options                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The household's participants (M3 decision 4). `offlineFirst` + persisted (`persist.ts`
 * allow-list): a cold offline start must still know the viewer's slot.
 */
export const financeParticipantsQuery = (householdId: string) =>
  queryOptions({
    queryKey: queryKeys.financeParticipants(householdId),
    queryFn: ({ signal }) => fetchFinanceParticipants(householdId, { signal }),
    staleTime: STALE_TIME.detail,
    networkMode: "offlineFirst",
  });

/**
 * The transaction list. `networkMode: "offlineFirst"` + persisted (see
 * `lib/persist.ts`) so a cold, offline start still renders the last-seen
 * ledger instead of hanging in `pending`.
 */
export const transactionsQuery = (householdId: string, query: Partial<TransactionListQuery> = {}) =>
  queryOptions({
    queryKey: queryKeys.transactions(householdId, query),
    queryFn: ({ signal }) => fetchTransactions(householdId, query, { signal }),
    staleTime: STALE_TIME.list,
    networkMode: "offlineFirst",
  });

export const transactionQuery = (householdId: string, transactionId: string) =>
  queryOptions({
    queryKey: queryKeys.transaction(householdId, transactionId),
    queryFn: ({ signal }) => fetchTransaction(householdId, transactionId, { signal }),
    staleTime: STALE_TIME.detail,
    networkMode: "offlineFirst",
  });

export const transactionSummaryQuery = (
  householdId: string,
  query: Partial<TransactionSummaryQuery> = {},
) =>
  queryOptions({
    queryKey: queryKeys.transactionSummary(householdId, query),
    queryFn: ({ signal }) => fetchTransactionSummary(householdId, query, { signal }),
    staleTime: STALE_TIME.list,
    networkMode: "offlineFirst",
  });

export const categoriesQuery = (householdId: string, includeHidden?: boolean) =>
  queryOptions({
    queryKey: queryKeys.categories(householdId, includeHidden),
    queryFn: ({ signal }) => fetchCategories(householdId, includeHidden, { signal }),
    staleTime: STALE_TIME.meta,
    networkMode: "offlineFirst",
  });

export const tagsQuery = (householdId: string, query: { q?: string; limit?: number } = {}) =>
  queryOptions({
    queryKey: queryKeys.tags(householdId, query),
    queryFn: ({ signal }) => fetchTags(householdId, query, { signal }),
    staleTime: STALE_TIME.meta,
  });

export const planQuery = (householdId: string) =>
  queryOptions({
    queryKey: queryKeys.plan(householdId),
    queryFn: ({ signal }) => fetchPlan(householdId, { signal }),
    staleTime: STALE_TIME.detail,
    networkMode: "offlineFirst",
  });

export const planPreviewQuery = (householdId: string, period: string) =>
  queryOptions({
    queryKey: queryKeys.planPreview(householdId, period),
    queryFn: ({ signal }) => fetchPlanPreview(householdId, period, { signal }),
    staleTime: STALE_TIME.detail,
  });

export const planRunsQuery = (householdId: string, query: Partial<PaginationQuery> = {}) =>
  queryOptions({
    queryKey: queryKeys.planRuns(householdId, query),
    queryFn: ({ signal }) => fetchPlanRuns(householdId, query, { signal }),
    staleTime: STALE_TIME.list,
  });

/** The balance. `networkMode: "offlineFirst"` — the header of `/`, must render offline. */
export const balanceQuery = (householdId: string, query: Partial<BalanceQuery> = {}) =>
  queryOptions({
    queryKey: queryKeys.balance(householdId, query),
    queryFn: ({ signal }) => fetchBalance(householdId, query, { signal }),
    staleTime: STALE_TIME.list,
    networkMode: "offlineFirst",
  });

export const balanceHistoryQuery = (householdId: string, query: Partial<BalanceHistoryQuery> = {}) =>
  queryOptions({
    queryKey: queryKeys.balanceHistory(householdId, query),
    queryFn: ({ signal }) => fetchBalanceHistory(householdId, query, { signal }),
    staleTime: STALE_TIME.list,
  });

export const settlementsQuery = (householdId: string, query: Partial<PaginationQuery> = {}) =>
  queryOptions({
    queryKey: queryKeys.settlements(householdId, query),
    queryFn: ({ signal }) => fetchSettlements(householdId, query, { signal }),
    staleTime: STALE_TIME.list,
  });

/* -------------------------------------------------------------------------- */
/* invalidation helpers                                                       */
/* -------------------------------------------------------------------------- */

export const invalidate = {
  ...coreInvalidate,
  /** Everything inside one household (transactions, categories, tags, plan, balance, participants). */
  household: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.household(householdId) }),
  householdDetail: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.householdDetail(householdId) }),
  financeParticipants: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.financeParticipants(householdId) }),
  transactions: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.transactionsRoot(householdId) }),
  transaction: (qc: QueryClient, householdId: string, transactionId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.transaction(householdId, transactionId) }),
  /**
   * The dashboard's per-category/period totals. A SEPARATE key segment from
   * `"transactions"` (`"transaction-summary"`), so `invalidate.transactions`
   * does NOT reach it — prefix matching is per array element, and
   * `"transaction-summary"` is not `"transactions"`.
   */
  transactionSummary: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: [ROOT, "household", householdId, "finance", "transaction-summary"] }),
  categories: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: [ROOT, "household", householdId, "finance", "categories"] }),
  tags: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: [ROOT, "household", householdId, "finance", "tags"] }),
  plan: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: [ROOT, "household", householdId, "finance", "plan"] }),
  planRuns: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: [ROOT, "household", householdId, "finance", "plan-runs"] }),
  balance: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: [ROOT, "household", householdId, "finance", "balance"] }),
  balanceHistory: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: [ROOT, "household", householdId, "finance", "balance-history"] }),
  settlements: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: [ROOT, "household", householdId, "finance", "settlements"] }),
} as const;

/**
 * After a create/update/delete on a transaction: the balance, the summary
 * (dashboard cards) and the affected categories/tags counts all depend on it,
 * so a single ledger write invalidates all of them together. This is the ONE
 * place that lists the fan-out, so `WEB-TX` and `WEB-SALDO` mutations agree
 * on what a booking touches without importing each other's feature code.
 *
 * Every derived read is listed EXPLICITLY, because none of them is a key
 * prefix of another: `"transaction-summary"`, `"balance-history"` and
 * `"settlements"` each sit on their own key segment, so invalidating
 * `"transactions"` and `"balance"` leaves all three serving pre-mutation data
 * until their staleTime runs out. `useCreateSettlement` funnels through here
 * too — a settlement IS a transaction — which is why the settlements list
 * belongs in the fan-out rather than only at the call site.
 */
export async function invalidateAfterLedgerMutation(qc: QueryClient, householdId: string): Promise<void> {
  await Promise.all([
    invalidate.transactions(qc, householdId),
    invalidate.transactionSummary(qc, householdId),
    invalidate.balance(qc, householdId),
    invalidate.balanceHistory(qc, householdId),
    invalidate.settlements(qc, householdId),
    invalidate.categories(qc, householdId),
    invalidate.tags(qc, householdId),
  ]);
}

/** After a fixed-cost plan run/recalculation: the plan itself, its runs and the ledger. */
export async function invalidateAfterPlanMutation(qc: QueryClient, householdId: string): Promise<void> {
  await Promise.all([
    invalidate.plan(qc, householdId),
    invalidate.planRuns(qc, householdId),
    invalidateAfterLedgerMutation(qc, householdId),
  ]);
}
