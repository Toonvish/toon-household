/**
 * Hooks for the finance participants (M3 decision 4): the read, the admin PUT, the own-name
 * PATCH and the enable flow. Static manifest graph (the settings section and the enable
 * dialog import this file): it must not reach the module registry or the layout components.
 *
 * Errors surface as a toast through the core's `errorMessage`; the verified-e-mail and
 * offline gates are the callers' (`useCanMutate`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HouseholdResponse, UpdateFinanceDisplayNameRequest, UpdateFinanceParticipantsRequest } from "@toon/shared";
import { useToast } from "@/components/ui/Toast";
import { enableModule, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { updateFinanceParticipants, updateMyFinanceDisplayName } from "@/modules/finance/lib/api";
import {
  financeParticipantsQuery,
  invalidate,
  invalidateAfterLedgerMutation,
  queryKeys,
} from "@/modules/finance/lib/queries";

/** `GET …/finance/participants`; disabled until a household is known. */
export function useFinanceParticipants(householdId: string | null) {
  return useQuery({ ...financeParticipantsQuery(householdId ?? ""), enabled: householdId !== null });
}

/** `PUT …/finance/participants` (admin). Slots move, so every projection refetches. */
export function useUpdateFinanceParticipants(householdId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useT();
  return useMutation({
    mutationFn: (body: UpdateFinanceParticipantsRequest) => updateFinanceParticipants(householdId, body),
    onSuccess: async () => {
      await Promise.all([
        invalidate.financeParticipants(queryClient, householdId),
        invalidateAfterLedgerMutation(queryClient, householdId),
      ]);
      toast.success(t("finance.participants.saved"));
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

/** `PATCH …/finance/participants/me` (a participant renames themself). */
export function useUpdateMyFinanceDisplayName(householdId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useT();
  return useMutation({
    mutationFn: (body: UpdateFinanceDisplayNameRequest) => updateMyFinanceDisplayName(householdId, body),
    onSuccess: async () => {
      await invalidate.financeParticipants(queryClient, householdId);
      toast.success(t("finance.participants.saved"));
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

/**
 * `POST …/modules/finance` with the two participants as the module settings (SPEC D2, §2
 * `onEnable`). On success the core's module invalidations (`me` drives the shell, the
 * households list, the household's whole prefix) and the core's enabled toast.
 */
export function useEnableFinance(householdId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useT();
  return useMutation<HouseholdResponse, Error, UpdateFinanceParticipantsRequest>({
    mutationFn: (settings) => enableModule(householdId, "finance", { ...settings }),
    onSuccess: async () => {
      await Promise.all([
        invalidate.me(queryClient),
        invalidate.households(queryClient),
        queryClient.invalidateQueries({ queryKey: queryKeys.household(householdId) }),
      ]);
      toast.success(t("home.modules.enabledToast"));
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}
