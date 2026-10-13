/**
 * TanStack Query wiring for the core: the key factory, the cache policy and the health
 * query. Module screens import their own keys from their module's `queries.ts`, built on
 * the roots below, so a prefix invalidates a whole subtree (SPEC D9).
 *
 * Key layout:
 *   ["toon","health"]
 *   ["toon","me"]                                       <- the only persisted core key
 *   ["toon","sessions"] · ["toon","oauth-providers"] · ["toon","households"]
 *   ["toon","invite",token]
 *   ["toon","household",householdId]                    <- everything household-scoped
 *   ["toon","household",householdId,"detail" | "members" | "invites",…]  <- core, never a module id
 *   ["toon","household",householdId,"<module>",…]       <- one module's household data
 *   ["toon","<module>",…]                               <- one module's user-owned data
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { ModuleId, PaginationQuery } from "@toon/shared";
import {
  fetchHealth,
  fetchHousehold,
  fetchHouseholdInvites,
  fetchHouseholdMembers,
  fetchHouseholds,
  fetchInvitePreview,
  fetchMe,
  fetchOAuthProviders,
  fetchSessions,
  isApiError,
} from "./api";

/* -------------------------------------------------------------------------- */
/* cache policy                                                               */
/* -------------------------------------------------------------------------- */

export const STALE_TIME = {
  /** Session/bootstrap: cheap, but should feel instant after navigation. */
  session: 60_000,
  /** Lists that change when someone in the group edits something. */
  list: 30_000,
  /** Single entities. */
  detail: 60_000,
  /** Rarely changing metadata (module catalogs). */
  meta: 5 * 60_000,
} as const;

/**
 * Retry policy: never retry a 4xx (the user must change something), retry
 * network/5xx twice with backoff.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.isClientError) return false;
  return failureCount < 2;
}

export const retryDelay = (attempt: number): number => Math.min(1000 * 2 ** attempt, 8000);

/* -------------------------------------------------------------------------- */
/* keys                                                                       */
/* -------------------------------------------------------------------------- */

/** Stable, order-independent serialisation of a list filter object. */
export function filterKey(filters: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!filters) return {};
  const entries = Object.entries(filters)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

const ROOT = "toon" as const;

export const queryKeys = {
  all: [ROOT] as const,
  health: () => [ROOT, "health"] as const,
  me: () => [ROOT, "me"] as const,
  sessions: () => [ROOT, "sessions"] as const,
  oauthProviders: () => [ROOT, "oauth-providers"] as const,
  households: () => [ROOT, "households"] as const,
  invitePreview: (token: string) => [ROOT, "invite", token] as const,

  /** Prefix for EVERY piece of data belonging to one household. */
  household: (householdId: string) => [ROOT, "household", householdId] as const,
  householdDetail: (householdId: string) => [ROOT, "household", householdId, "detail"] as const,
  householdMembers: (householdId: string) => [ROOT, "household", householdId, "members"] as const,
  householdInvites: (householdId: string, query?: Partial<PaginationQuery>) =>
    [ROOT, "household", householdId, "invites", filterKey(query)] as const,
  /** Prefix for one module's data inside one household. */
  householdModule: (householdId: string, moduleId: ModuleId) =>
    [ROOT, "household", householdId, moduleId] as const,
  /** Prefix for one module's user-owned data (not household-scoped). */
  userModule: (moduleId: ModuleId) => [ROOT, moduleId] as const,
};

/* -------------------------------------------------------------------------- */
/* query options                                                              */
/* -------------------------------------------------------------------------- */

export const healthQuery = () =>
  queryOptions({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => fetchHealth({ signal }),
    staleTime: STALE_TIME.list,
  });

/** Bootstrap query. Returns `null` when nobody is logged in (401 is not an error). */
export const meQuery = () =>
  queryOptions({
    queryKey: queryKeys.me(),
    queryFn: async ({ signal }) => {
      try {
        return await fetchMe({ signal });
      } catch (error) {
        if (isApiError(error) && error.isUnauthorized) return null;
        throw error;
      }
    },
    staleTime: STALE_TIME.session,
    retry: shouldRetry,
    retryDelay,
  });

export const sessionsQuery = () =>
  queryOptions({
    queryKey: queryKeys.sessions(),
    queryFn: ({ signal }) => fetchSessions({ signal }),
    staleTime: STALE_TIME.list,
  });

/**
 * Which OAuth providers this deployment configured, and which the current user
 * linked. Works without a session (the login screen needs it to hide dead
 * buttons), so 401 must not bubble up as an error.
 */
export const oauthProvidersQuery = () =>
  queryOptions({
    queryKey: queryKeys.oauthProviders(),
    queryFn: ({ signal }) => fetchOAuthProviders({ signal }),
    staleTime: STALE_TIME.list,
  });

export const householdsQuery = () =>
  queryOptions({
    queryKey: queryKeys.households(),
    queryFn: ({ signal }) => fetchHouseholds({ signal }),
    staleTime: STALE_TIME.list,
  });

export const invitePreviewQuery = (token: string) =>
  queryOptions({
    queryKey: queryKeys.invitePreview(token),
    queryFn: ({ signal }) => fetchInvitePreview(token, { signal }),
    staleTime: STALE_TIME.detail,
    retry: false,
  });

export const householdQuery = (householdId: string) =>
  queryOptions({
    queryKey: queryKeys.householdDetail(householdId),
    queryFn: ({ signal }) => fetchHousehold(householdId, { signal }),
    staleTime: STALE_TIME.detail,
  });

export const householdMembersQuery = (householdId: string) =>
  queryOptions({
    queryKey: queryKeys.householdMembers(householdId),
    queryFn: ({ signal }) => fetchHouseholdMembers(householdId, { signal }),
    staleTime: STALE_TIME.list,
  });

export const householdInvitesQuery = (householdId: string, query: Partial<PaginationQuery> = {}) =>
  queryOptions({
    queryKey: queryKeys.householdInvites(householdId, query),
    queryFn: ({ signal }) => fetchHouseholdInvites(householdId, query, { signal }),
    staleTime: STALE_TIME.list,
  });

/* -------------------------------------------------------------------------- */
/* invalidation                                                               */
/* -------------------------------------------------------------------------- */

export const invalidate = {
  everything: (qc: QueryClient) => qc.invalidateQueries({ queryKey: queryKeys.all }),
  me: (qc: QueryClient) => qc.invalidateQueries({ queryKey: queryKeys.me() }),
  sessions: (qc: QueryClient) => qc.invalidateQueries({ queryKey: queryKeys.sessions() }),
  oauthProviders: (qc: QueryClient) =>
    qc.invalidateQueries({ queryKey: queryKeys.oauthProviders() }),
  households: (qc: QueryClient) => qc.invalidateQueries({ queryKey: queryKeys.households() }),
  /** One household's detail (name, role, member count). Module data has its own prefix. */
  household: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.householdDetail(householdId) }),
  members: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.householdMembers(householdId) }),
  invites: (qc: QueryClient, householdId: string) =>
    qc.invalidateQueries({ queryKey: [ROOT, "household", householdId, "invites"] }),
  health: (qc: QueryClient) => qc.invalidateQueries({ queryKey: queryKeys.health() }),
};
