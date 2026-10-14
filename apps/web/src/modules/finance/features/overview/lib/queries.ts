/**
 * Feature hooks for `/` (Übersicht). Thin wrappers around the base
 * `queryOptions`/`api.ts` from `lib/queries.ts` (`WEB-KERN`) — this file adds
 * nothing to the wire contract, only React Query glue specific to the
 * overview cards.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateSettlementRequest, FinanceParticipantResponse as MemberResponse, RunPlanRequest } from "@toon/shared";
import { createSettlement, runPlan } from "@/modules/finance/lib/api";
import {
  balanceQuery,
  financeParticipantsQuery,
  invalidateAfterLedgerMutation,
  invalidateAfterPlanMutation,
  planQuery,
  transactionSummaryQuery,
  transactionsQuery,
} from "@/modules/finance/lib/queries";
import { useFinanceHousehold } from "@/modules/finance/lib/participants";

export function useBalance(householdId: string) {
  return useQuery(balanceQuery(householdId));
}

export function useOverviewPlan(householdId: string) {
  return useQuery(planQuery(householdId));
}

export function useTransactionSummary(householdId: string, range: { from?: string; to?: string }) {
  return useQuery(transactionSummaryQuery(householdId, range));
}

/** `total` from a cheap `limit: 1` list call — the summary endpoint has no per-range count. */
export function useTransactionCount(householdId: string, range: { from?: string; to?: string }) {
  return useQuery(transactionsQuery(householdId, { ...range, limit: 1 }));
}

export function useRecentTransactions(householdId: string, limit = 5) {
  return useQuery(transactionsQuery(householdId, { limit, sort: "-bookedAt" }));
}

export interface HouseholdMembers {
  own: MemberResponse | null;
  other: MemberResponse | null;
  isLoading: boolean;
}

/** Both members, split by the viewer's own slot — for `{name}` placeholders and settlement direction. */
export function useHouseholdMembers(householdId: string): HouseholdMembers {
  const { memberSlot } = useFinanceHousehold();
  const query = useQuery(financeParticipantsQuery(householdId));
  return useMemo(() => {
    const items = query.data?.items ?? [];
    return {
      own: items.find((member) => member.memberSlot === memberSlot) ?? null,
      other: items.find((member) => member.memberSlot !== memberSlot) ?? null,
      isLoading: query.isPending,
    };
  }, [query.data, query.isPending, memberSlot]);
}

export function useCreateSettlement(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSettlementRequest) => createSettlement(householdId, body),
    onSuccess: () => invalidateAfterLedgerMutation(queryClient, householdId),
  });
}

export function useRunPlan(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RunPlanRequest = {}) => runPlan(householdId, body),
    onSuccess: () => invalidateAfterPlanMutation(queryClient, householdId),
  });
}
