/**
 * Hooks for the finance participants (M3 decision 4): the read, the admin PUT, the own-name
 * PATCH and the enable flow. Static manifest graph (the settings section and the enable
 * dialog import this file): it must not reach the module registry or the layout components.
 *
 * Errors surface as a toast through the core's `errorMessage`; the verified-e-mail and
 * offline gates are the callers' (`useCanMutate`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatePlaceholderMemberRequest,
  HouseholdInviteResponse,
  HouseholdMember,
  HouseholdResponse,
  UpdateFinanceDisplayNameRequest,
  UpdateFinanceParticipantsRequest,
} from "@toon/shared";
import { useToast } from "@/components/ui/Toast";
import { createHouseholdInvite, createPlaceholderMember, enableModule, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { renameParticipant, updateFinanceParticipants, updateMyFinanceDisplayName } from "@/modules/finance/lib/api";
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
 * `PATCH …/finance/participants/:userId` (a participant renames the OTHER seat when it is a
 * placeholder, plan m3b decision 6). The name is copied from `users.name` into the seat only on
 * creation, so the participants refetch is all that shows it; the household subtree covers the
 * balance sentence and the transaction rows that carry the name.
 */
export function useRenameFinanceParticipant(householdId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useT();
  return useMutation({
    mutationFn: ({ userId, displayName }: { userId: string; displayName: string }) =>
      renameParticipant(householdId, userId, { displayName }),
    onSuccess: async () => {
      await invalidate.household(queryClient, householdId);
      toast.success(t("finance.participants.saved"));
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

/**
 * `POST …/members` (core, admin+): adds a person WITHOUT an account (ADR 0006, F's "Ohne Konto
 * hinzufügen"). Resolves with the new member once the household's members are refetched, so the
 * caller can preselect it for slot 2. The error text is the caller's to show (inline).
 */
export function useAddPlaceholderMember(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation<HouseholdMember, Error, CreatePlaceholderMemberRequest>({
    mutationFn: async (body) => (await createPlaceholderMember(householdId, body)).member,
    onSuccess: async () => {
      await Promise.all([
        invalidate.members(queryClient, householdId),
        invalidate.households(queryClient),
        invalidate.me(queryClient),
      ]);
    },
  });
}

/**
 * `POST …/invites { claimsUserId }` (core, admin+): the claim link of a placeholder seat. One open
 * claim link per placeholder: the server revokes older ones.
 */
export function useCreateClaimLink(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation<HouseholdInviteResponse, Error, { claimsUserId: string }>({
    mutationFn: ({ claimsUserId }) => createHouseholdInvite(householdId, { role: "member", claimsUserId }),
    onSuccess: async () => {
      await invalidate.invites(queryClient, householdId);
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
