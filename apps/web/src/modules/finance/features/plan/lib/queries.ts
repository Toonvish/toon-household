/**
 * Feature hooks for `/plan` — the fixed-cost plan (docs/spec.md §4.6).
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateFixedCostItemRequest,
  CreateIncomeRequest,
  FinanceParticipantResponse as MemberResponse,
  FinancePaginationQuery as PaginationQuery,
  RecalculatePlanRequest,
  RunPlanRequest,
  UpdateFixedCostItemRequest,
  UpdateIncomeRequest,
} from "@toon/shared";
import {
  createFixedCostItem,
  createIncome,
  deleteFixedCostItem,
  deleteIncome,
  recalculatePlan,
  runPlan,
  updateFixedCostItem,
  updateIncome,
  updatePlan,
} from "@/modules/finance/lib/api";
import {
  financeParticipantsQuery,
  invalidate,
  invalidateAfterLedgerMutation,
  invalidateAfterPlanMutation,
  planQuery,
  planRunsQuery,
  transactionsQuery,
} from "@/modules/finance/lib/queries";
import { useFinanceHousehold } from "@/modules/finance/lib/participants";

export function usePlan(householdId: string) {
  return useQuery(planQuery(householdId));
}

export function usePlanRuns(householdId: string, query: Partial<PaginationQuery> = {}) {
  return useQuery(planRunsQuery(householdId, query));
}

/** Already-booked plan periods, newest first — `origin=fixed_plan` only (not adjustments, docs/spec.md §4.6). */
export function useBookedPeriods(householdId: string, limit = 12) {
  return useQuery(transactionsQuery(householdId, { origin: "fixed_plan", limit, sort: "-bookedAt" }));
}

export interface HouseholdMembers {
  own: MemberResponse | null;
  other: MemberResponse | null;
  items: readonly MemberResponse[];
  isLoading: boolean;
}

export function useHouseholdMembers(householdId: string): HouseholdMembers {
  const { memberSlot } = useFinanceHousehold();
  const query = useQuery(financeParticipantsQuery(householdId));
  return useMemo(() => {
    const items = query.data?.items ?? [];
    return {
      own: items.find((member) => member.memberSlot === memberSlot) ?? null,
      other: items.find((member) => member.memberSlot !== memberSlot) ?? null,
      items,
      isLoading: query.isPending,
    };
  }, [query.data, query.isPending, memberSlot]);
}

export function useUpdatePlan(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { enabled?: boolean; payerId?: string; startPeriod?: string }) =>
      updatePlan(householdId, body),
    onSuccess: () => invalidate.plan(queryClient, householdId),
  });
}

export function useRunPlan(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RunPlanRequest = {}) => runPlan(householdId, body),
    onSuccess: () => invalidateAfterPlanMutation(queryClient, householdId),
  });
}

/** `dryRun` runs never invalidate — only an applied recalculation writes anything. */
export function useRecalculatePlan(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecalculatePlanRequest) => recalculatePlan(householdId, body),
    onSuccess: (data) => {
      if (data.applied) void invalidateAfterPlanMutation(queryClient, householdId);
    },
  });
}

export function useCreateFixedCostItem(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFixedCostItemRequest) => createFixedCostItem(householdId, body),
    onSuccess: () => invalidate.plan(queryClient, householdId),
  });
}

export function useUpdateFixedCostItem(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: UpdateFixedCostItemRequest }) =>
      updateFixedCostItem(householdId, itemId, body),
    onSuccess: () => invalidate.plan(queryClient, householdId),
  });
}

export function useDeleteFixedCostItem(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => deleteFixedCostItem(householdId, itemId),
    onSuccess: () => invalidate.plan(queryClient, householdId),
  });
}

export function useCreateIncome(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateIncomeRequest) => createIncome(householdId, body),
    onSuccess: () => invalidate.plan(queryClient, householdId),
  });
}

export function useUpdateIncome(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ incomeId, body }: { incomeId: string; body: UpdateIncomeRequest }) =>
      updateIncome(householdId, incomeId, body),
    onSuccess: () => invalidate.plan(queryClient, householdId),
  });
}

export function useDeleteIncome(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (incomeId: string) => deleteIncome(householdId, incomeId),
    onSuccess: () => invalidate.plan(queryClient, householdId),
  });
}

// Re-exported so `RecalculateDialog` can invalidate the ledger views a
// confirmed recalculation also touches, without importing `WEB-TX`.
export { invalidateAfterLedgerMutation };
