/**
 * Offline mutation defaults for the ledger writes made from `/new` and
 * `/transactions/$id/edit` — the WRITE half of "Erfassen funktioniert
 * offline" (docs/spec.md §1.2 point 6 and §4.5, CLAUDE.md gotchas #7-#10).
 *
 * Registered once by the finance manifest (`mutationDefaults`, M3 decision 12), BEFORE the persister
 * restores any paused mutation: a dehydrated mutation keeps its `variables`
 * but not its `mutationFn` (a function cannot be serialised), so
 * `resumePausedMutations()` needs these defaults registered on the exact
 * `mutationKey` a restored mutation carries, or it has nothing to run.
 *
 * `features/transactions/lib/queries.ts` (also `WEB-TX`) supplies ONLY the
 * `mutationKey` to `useMutation` — never a `mutationFn` — so a fresh
 * in-session booking and a replayed offline one run the exact same function.
 *
 * `mutationId` is minted by the CALLER (`NewTransactionPage`/
 * `EditTransactionPage`) at the moment the user taps "Buchen"/"Speichern",
 * never inside a `mutationFn` here — this file's functions rerun verbatim on
 * every replay, so anything coined inside them would mint a new id on every
 * retry and defeat `mutation_claims` (docs/spec.md §2.9, CLAUDE.md gotcha #10).
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  deltaForTransaction,
  halfForOther,
  kindToStorage,
  type CreateTransactionRequest,
  type TransactionResponse,
  type UpdateTransactionRequest,
} from "@toon/shared";
import { createTransaction, deleteTransaction, updateTransaction } from "@/modules/finance/lib/api";
import { invalidate, invalidateAfterLedgerMutation, queryKeys, shouldRetry } from "@/modules/finance/lib/queries";

/**
 * Mutation-key namespace. `["finance", "tx"]` (`key[1]`, `key[2]`) is what the finance manifest
 * `persistMutationNamespaces` matches on — the namespace itself must stay exactly
 * `"finance", "tx"`, the fourth segment is free.
 */
export const TX_MUTATION_KEYS = {
  create: ["toon", "finance", "tx", "create"] as const,
  update: ["toon", "finance", "tx", "update"] as const,
  remove: ["toon", "finance", "tx", "remove"] as const,
} as const;

/**
 * The household id travels IN THE VARIABLES, not baked into the mutation
 * key: `setMutationDefaults` runs once at module load, long before a session
 * (and therefore a household) exists, and a household-scoped key would leave
 * a restored mutation from a previous login with no matching default.
 */
export interface CreateTransactionVariables extends CreateTransactionRequest {
  householdId: string;
  /** Minted at the call site — see the file doc. Required here (unlike the wire type) so a queued booking always has one. */
  mutationId: string;
  /** Needed only for the optimistic cache patch below; never sent to the server. */
  optimistic: OptimisticContext;
}

export interface UpdateTransactionVariables extends UpdateTransactionRequest {
  householdId: string;
  transactionId: string;
  mutationId: string;
}

export interface DeleteTransactionVariables {
  householdId: string;
  transactionId: string;
  mutationId: string;
}

/**
 * What the optimistic patch needs to render a plausible row before the
 * server has seen it: the viewer/other ids (to run the same `kindToStorage`
 * projection the server runs) and the other person's display name (for
 * `categorySlug`-free, tag-free display — the row backfills those on the
 * next successful fetch).
 */
export interface OptimisticContext {
  viewerId: string;
  otherId: string;
}

function buildOptimisticTransaction(
  variables: CreateTransactionVariables,
  nowIso: string,
): TransactionResponse {
  const { payerId, splitMode } = kindToStorage(
    variables.kind,
    variables.optimistic.viewerId,
    variables.optimistic.otherId,
  );
  const amountCents = variables.amountCents;
  const otherShareCents = splitMode === "SPLIT_EQUAL" ? halfForOther(amountCents) : amountCents;
  const payerShareCents = amountCents - otherShareCents;
  // Optimistic-only approximation: the real `balanceDeltaCents` is relative
  // to member_slot 1, which this file cannot resolve without a household
  // fetch. Rendered for at most a few hundred ms, until the server response
  // (or the next `invalidateAfterLedgerMutation`) replaces this row outright.
  const balanceDeltaCents = deltaForTransaction({ payerId, splitMode, amountCents }, variables.optimistic.viewerId);

  return {
    id: `optimistic:${variables.mutationId}`,
    householdId: variables.householdId,
    payerId,
    splitMode,
    amountCents,
    description: variables.description,
    categoryId: variables.categoryId ?? null,
    categorySlug: null,
    tags: (variables.tags ?? []).map((name) => ({ id: `optimistic-tag:${name}`, name })),
    bookedAt: variables.bookedAt ?? nowIso,
    dateSource: "exact",
    origin: "manual",
    planPeriod: null,
    createdBy: variables.optimistic.viewerId,
    createdAt: nowIso,
    updatedAt: nowIso,
    otherShareCents,
    payerShareCents,
    balanceDeltaCents,
    isExpense: splitMode !== "SETTLEMENT",
  };
}

type TransactionListPage = { items: TransactionResponse[]; total: number; limit: number; offset: number };

/**
 * Filter keys that do NOT restrict WHICH transactions a list contains. A new
 * row belongs on every list keyed by these alone; every other key (`from`,
 * `to`, `categoryId`, `payerId`, `kind`, `tagIds`, `q`, `origin`,
 * `includeAggregates`) narrows the set to rows matching a predicate this file
 * cannot evaluate without re-implementing the server's filtering.
 */
const NON_NARROWING_FILTER_KEYS: ReadonlySet<string> = new Set(["limit", "offset", "sort"]);

/**
 * Whether a cached list may receive the optimistic row: only the FIRST page of
 * an UNFILTERED list. `setQueriesData` with the `transactionsRoot` prefix
 * otherwise matches every filtered variant still in cache — a category view, a
 * date range, page 3 — and prepends the row to all of them. Offline the
 * mutation is paused, so a row sits in a list it does not belong to until the
 * next reconnect and refetch; guessing wrong in a ledger is worse than
 * showing the row one screen later.
 */
function acceptsOptimisticRow(queryKey: QueryKey): boolean {
  const filters = queryKey[5];
  if (filters === undefined) return true;
  if (typeof filters !== "object" || filters === null) return false;
  const entries = Object.entries(filters as Record<string, unknown>);
  if (!entries.every(([key]) => NON_NARROWING_FILTER_KEYS.has(key))) return false;
  const offset = (filters as { offset?: unknown }).offset;
  return offset === undefined || offset === 0;
}

/** Prepends `tx` to every cached UNFILTERED transaction LIST page of this household (not the detail cache — there is no detail id yet). */
function patchListsWithOptimisticRow(client: QueryClient, householdId: string, tx: TransactionResponse): void {
  client.setQueriesData<TransactionListPage | undefined>(
    { queryKey: queryKeys.transactionsRoot(householdId), predicate: (query) => acceptsOptimisticRow(query.queryKey) },
    (current) => {
      if (!current) return current;
      return { ...current, items: [tx, ...current.items], total: current.total + 1 };
    },
  );
}

/** Removal is deliberately NOT scoped the way insertion is — a row that is going away must go away everywhere. */
function removeOptimisticRow(client: QueryClient, householdId: string, optimisticId: string): void {
  client.setQueriesData<TransactionListPage | undefined>(
    { queryKey: queryKeys.transactionsRoot(householdId) },
    (current) => {
      if (!current) return current;
      if (!current.items.some((item) => item.id === optimisticId)) return current;
      return {
        ...current,
        items: current.items.filter((item) => item.id !== optimisticId),
        total: Math.max(0, current.total - 1),
      };
    },
  );
}

/**
 * Registers the three mutation defaults on `client`. Idempotent to call twice — `setMutationDefaults`
 * simply overwrites — which matters because Vite's dev server can re-run
 * this module on a hot reload.
 */
export function registerTransactionMutationDefaults(client: QueryClient): void {
  client.setMutationDefaults(TX_MUTATION_KEYS.create, {
    mutationFn: (variables: CreateTransactionVariables) => {
      const { householdId, optimistic: _optimistic, ...body } = variables;
      return createTransaction(householdId, body);
    },
    networkMode: "offlineFirst",
    // NOT `false` (the QueryClient's global mutation default): `retry:
    // false` skips the retryer's pause-while-offline branch entirely (see
    // `@tanstack/query-core`'s `createRetryer` — it only ever pauses INSIDE
    // a retry attempt), so an offline write would fail immediately instead
    // of queueing. `shouldRetry` (the same policy `lib/queries.ts` uses for
    // reads) never retries a real 4xx, which is what keeps a genuine
    // validation error from being retried forever.
    retry: shouldRetry,
    onMutate: async (variables) => {
      await client.cancelQueries({ queryKey: queryKeys.transactionsRoot(variables.householdId) });
      const optimisticTx = buildOptimisticTransaction(variables, new Date().toISOString());
      patchListsWithOptimisticRow(client, variables.householdId, optimisticTx);
      return { optimisticId: optimisticTx.id };
    },
    onError: (_error, variables, context) => {
      const optimisticId = (context as { optimisticId?: string } | undefined)?.optimisticId;
      if (optimisticId) removeOptimisticRow(client, variables.householdId, optimisticId);
    },
    onSuccess: async (_data, variables, context) => {
      const optimisticId = (context as { optimisticId?: string } | undefined)?.optimisticId;
      if (optimisticId) removeOptimisticRow(client, variables.householdId, optimisticId);
      await invalidateAfterLedgerMutation(client, variables.householdId);
    },
  });

  client.setMutationDefaults(TX_MUTATION_KEYS.update, {
    mutationFn: (variables: UpdateTransactionVariables) => {
      const { householdId, transactionId, ...body } = variables;
      return updateTransaction(householdId, transactionId, body);
    },
    networkMode: "offlineFirst",
    retry: shouldRetry, // see the CREATE default above for why not `false`
    onSuccess: async (_data, variables) => {
      await Promise.all([
        invalidate.transaction(client, variables.householdId, variables.transactionId),
        invalidateAfterLedgerMutation(client, variables.householdId),
      ]);
    },
  });

  client.setMutationDefaults(TX_MUTATION_KEYS.remove, {
    mutationFn: (variables: DeleteTransactionVariables) =>
      deleteTransaction(variables.householdId, variables.transactionId, variables.mutationId),
    networkMode: "offlineFirst",
    retry: shouldRetry, // see the CREATE default above for why not `false`
    onMutate: async (variables) => {
      await client.cancelQueries({ queryKey: queryKeys.transactionsRoot(variables.householdId) });
      // Snapshot exactly the pages that hold this row, so a REJECTED delete can
      // put it back at its old position with the old `total`. The CREATE
      // default rolls back the same way; without one here the row stays gone
      // from the UI while it still exists on the server — and the everyday
      // case is not exotic: a plan-generated row answers `409
      // transaction_generated`, and `shouldRetry` never retries a 4xx.
      const snapshot = client
        .getQueriesData<TransactionListPage | undefined>({ queryKey: queryKeys.transactionsRoot(variables.householdId) })
        .filter(([, data]) => data?.items.some((item) => item.id === variables.transactionId));
      removeOptimisticRow(client, variables.householdId, variables.transactionId);
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      const snapshot = (context as { snapshot?: [QueryKey, TransactionListPage | undefined][] } | undefined)?.snapshot;
      for (const [key, data] of snapshot ?? []) client.setQueryData(key, data);
    },
    onSuccess: async (_data, variables) => {
      // `removeQueries`, not `invalidate`: the entity is gone, so a refetch
      // would only fetch a 404. Left in cache, `/transactions/$id` renders the
      // deleted row from `STALE_TIME.detail` as if it still existed.
      client.removeQueries({ queryKey: queryKeys.transaction(variables.householdId, variables.transactionId) });
      await invalidateAfterLedgerMutation(client, variables.householdId);
    },
  });
}

