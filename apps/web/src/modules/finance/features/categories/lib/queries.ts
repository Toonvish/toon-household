/**
 * Feature hooks for `/categories` (docs/spec.md §4.7).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateCategoryRequest, UpdateCategoryRequest } from "@toon/shared";
import { createCategory, deleteCategory, updateCategory } from "@/modules/finance/lib/api";
import { categoriesQuery, invalidate } from "@/modules/finance/lib/queries";

/** `includeHidden: true` — the row itself is the visibility toggle, so hidden categories must still be listed. */
export function useCategories(householdId: string) {
  return useQuery(categoriesQuery(householdId, true));
}

export function useCreateCategory(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCategoryRequest) => createCategory(householdId, body),
    onSuccess: () => invalidate.categories(queryClient, householdId),
  });
}

export function useUpdateCategory(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, body }: { categoryId: string; body: UpdateCategoryRequest }) =>
      updateCategory(householdId, categoryId, body),
    onSuccess: () => invalidate.categories(queryClient, householdId),
  });
}

export function useDeleteCategory(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, reassignTo }: { categoryId: string; reassignTo?: string }) =>
      deleteCategory(householdId, categoryId, reassignTo),
    onSuccess: () => {
      void invalidate.categories(queryClient, householdId);
      // A reassign moves transactions to another category — its counts change too.
      void invalidate.transactions(queryClient, householdId);
      // …and so does the dashboard's per-category breakdown. It sits on its own
      // key segment (`"transaction-summary"`), so `invalidate.transactions` does
      // NOT reach it — prefix matching is per array element (see `invalidate`
      // in lib/queries.ts). Without this the SpendByCategoryCard keeps serving
      // the pre-reassignment split until its staleTime runs out.
      void invalidate.transactionSummary(queryClient, householdId);
    },
  });
}
