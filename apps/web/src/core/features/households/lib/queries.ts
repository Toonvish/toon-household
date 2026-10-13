/** TanStack Query hooks for households, members and invites. Keys come from `@/lib/queries`. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AcceptInviteResponse,
  CreateHouseholdRequest,
  CreateInviteRequest,
  HouseholdInviteResponse,
  HouseholdMember,
  HouseholdRole,
  HouseholdWithRole,
  UpdateHouseholdRequest,
} from "@toon/shared";
import type { MessageKey } from "@/lib/i18n";
import {
  acceptInvite,
  createHousehold,
  createHouseholdInvite,
  deleteHousehold,
  removeHouseholdMember,
  revokeHouseholdInvite,
  updateHousehold,
  updateMemberRole,
} from "@/lib/api";
import {
  householdInvitesQuery,
  householdMembersQuery,
  householdQuery,
  householdsQuery,
  invalidate,
  queryKeys,
} from "@/lib/queries";

/** Households of the current user with role/memberCount/modules. */
export function useHouseholds() {
  const options = householdsQuery();
  return useQuery({ ...options, select: (response) => response.items });
}

/** Household detail incl. members. */
export function useHouseholdDetail(householdId: string | undefined) {
  const options = householdQuery(householdId ?? "");
  return useQuery({
    ...options,
    enabled: householdId !== undefined && householdId.length > 0,
  });
}

export function useHouseholdMembers(householdId: string | undefined) {
  const options = householdMembersQuery(householdId ?? "");
  return useQuery({
    ...options,
    enabled: householdId !== undefined && householdId.length > 0,
    select: (response) => response.items,
  });
}

/**
 * Invite list. The endpoint is admin-only, so pass `enabled: false` for plain members;
 * a 403 is never retried.
 */
export function useHouseholdInvites(householdId: string | undefined, enabled = true) {
  const options = householdInvitesQuery(householdId ?? "", { limit: 100 });
  return useQuery({
    ...options,
    enabled: enabled && householdId !== undefined && householdId.length > 0,
    retry: false,
    select: (response) => response.items,
  });
}

export function useCreateHousehold() {
  const client = useQueryClient();
  return useMutation<HouseholdWithRole, Error, CreateHouseholdRequest>({
    mutationFn: async (input) => {
      const response = await createHousehold(input);
      return response.household;
    },
    // Creating a household also sets users.active_household_id server-side, so `me` must refetch.
    onSuccess: async () => {
      await Promise.all([invalidate.households(client), invalidate.me(client)]);
    },
  });
}

export interface UpdateHouseholdInput extends UpdateHouseholdRequest {
  householdId: string;
}

export function useUpdateHousehold() {
  const client = useQueryClient();
  return useMutation<HouseholdWithRole, Error, UpdateHouseholdInput>({
    mutationFn: async ({ householdId, ...patch }) => {
      const response = await updateHousehold(householdId, patch);
      return response.household;
    },
    onSuccess: async (household) => {
      await Promise.all([
        invalidate.households(client),
        client.invalidateQueries({ queryKey: queryKeys.householdDetail(household.id) }),
        invalidate.me(client),
      ]);
    },
  });
}

export function useDeleteHousehold() {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (householdId) => deleteHousehold(householdId),
    onSuccess: async (_result, householdId) => {
      // Everything under this household is gone — drop the whole subtree.
      client.removeQueries({ queryKey: queryKeys.household(householdId) });
      await Promise.all([invalidate.households(client), invalidate.me(client)]);
    },
  });
}

export interface ChangeRoleInput {
  householdId: string;
  userId: string;
  role: HouseholdRole;
}

export function useChangeMemberRole() {
  const client = useQueryClient();
  return useMutation<HouseholdMember, Error, ChangeRoleInput>({
    mutationFn: async ({ householdId, userId, role }) => {
      const response = await updateMemberRole(householdId, userId, { role });
      return response.member;
    },
    onSuccess: async (member) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.householdDetail(member.householdId) }),
        invalidate.members(client, member.householdId),
        invalidate.households(client),
        invalidate.me(client),
      ]);
    },
  });
}

export interface RemoveMemberInput {
  householdId: string;
  userId: string;
}

/** Also used for "Gruppe verlassen" (a member removing themself). */
export function useRemoveMember() {
  const client = useQueryClient();
  return useMutation<void, Error, RemoveMemberInput>({
    mutationFn: ({ householdId, userId }) => removeHouseholdMember(householdId, userId),
    onSuccess: async (_result, { householdId }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.householdDetail(householdId) }),
        invalidate.members(client, householdId),
        invalidate.households(client),
        invalidate.me(client),
      ]);
    },
  });
}

export interface CreateInviteInput extends CreateInviteRequest {
  householdId: string;
}

export function useCreateInvite() {
  const client = useQueryClient();
  return useMutation<HouseholdInviteResponse, Error, CreateInviteInput>({
    mutationFn: ({ householdId, ...body }) => createHouseholdInvite(householdId, body),
    onSuccess: async (_result, { householdId }) => {
      await invalidate.invites(client, householdId);
    },
  });
}

export interface RevokeInviteInput {
  householdId: string;
  inviteId: string;
}

export function useRevokeInvite() {
  const client = useQueryClient();
  return useMutation<void, Error, RevokeInviteInput>({
    mutationFn: ({ householdId, inviteId }) => revokeHouseholdInvite(householdId, inviteId),
    onSuccess: async (_result, { householdId }) => {
      await invalidate.invites(client, householdId);
    },
  });
}

export function useAcceptInvite() {
  const client = useQueryClient();
  return useMutation<AcceptInviteResponse, Error, string>({
    mutationFn: (token) => acceptInvite({ token }),
    onSuccess: async () => {
      await Promise.all([invalidate.households(client), invalidate.me(client)]);
    },
  });
}

/**
 * Invite status labels as translator keys, resolved at render time (docs/i18n.md
 * §10 rule 8) — the map's keys are the wire `status` values and stay locked.
 */
export const INVITE_STATUS_LABELS: Record<string, MessageKey> = {
  pending: "household.inviteStatus.pending",
  accepted: "household.inviteStatus.accepted",
  revoked: "household.inviteStatus.revoked",
  expired: "household.inviteStatus.expired",
};
