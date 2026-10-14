/**
 * Feature-level data hooks for the transactions screens. Reads wrap the
 * ready-made `queryOptions` from `@/lib/queries` ([WEB-KERN]); writes supply
 * ONLY a `mutationKey` — the matching `mutationFn` is registered once by
 * `./offline` (`registerTransactionMutationDefaults`, imported for its side
 * effect from `app.tsx`), so a mutation started online and one resumed from
 * the offline queue run the identical function (CLAUDE.md gotcha #7).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import type { TransactionListQuery, TransactionResponse, TransactionSummaryQuery } from "@toon/shared";
import {
  categoriesQuery,
  tagsQuery,
  transactionQuery,
  transactionsQuery,
  transactionSummaryQuery,
} from "@/modules/finance/lib/queries";
import {
  TX_MUTATION_KEYS,
  type CreateTransactionVariables,
  type DeleteTransactionVariables,
  type UpdateTransactionVariables,
} from "./offline";

export function useTransactions(householdId: string, query: Partial<TransactionListQuery> = {}) {
  return useQuery(transactionsQuery(householdId, query));
}

/** `transactionId === null` while the detail route has not resolved one yet — the query simply stays disabled. */
export function useTransaction(householdId: string, transactionId: string | null) {
  return useQuery({
    ...transactionQuery(householdId, transactionId ?? ""),
    enabled: transactionId !== null,
  });
}

export function useTransactionSummary(householdId: string, query: Partial<TransactionSummaryQuery> = {}) {
  return useQuery(transactionSummaryQuery(householdId, query));
}

/** The category picker (`CategorySheet`) and the filter panel share this. */
export function useCategoriesForPicker(householdId: string) {
  return useQuery(categoriesQuery(householdId, false));
}

/** Top-N tags by usage for the chip suggestions (`TagInput`); pass `q` for prefix search. */
export function useTagSuggestions(householdId: string, query: { q?: string; limit?: number } = {}) {
  return useQuery(tagsQuery(householdId, query));
}

/**
 * `mutationFn` intentionally absent — see the file doc. The generic
 * parameters keep `mutate()` and `onSuccess`/`onError` fully typed at every
 * call site even though the function itself lives in `./offline`.
 */
export function useCreateTransactionMutation() {
  return useMutation<TransactionResponse, unknown, CreateTransactionVariables>({
    mutationKey: [...TX_MUTATION_KEYS.create],
  });
}

export function useUpdateTransactionMutation() {
  return useMutation<TransactionResponse, unknown, UpdateTransactionVariables>({
    mutationKey: [...TX_MUTATION_KEYS.update],
  });
}

export function useDeleteTransactionMutation() {
  return useMutation<void, unknown, DeleteTransactionVariables>({
    mutationKey: [...TX_MUTATION_KEYS.remove],
  });
}
