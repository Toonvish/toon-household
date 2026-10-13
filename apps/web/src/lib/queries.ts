/**
 * TanStack Query wiring for the core: the key factory, the cache policy and the health
 * query. Module screens import their own keys from their module's `queries.ts`, built on
 * the roots below, so a prefix invalidates a whole subtree (SPEC D9).
 *
 * Key layout:
 *   ["toon","health"]
 *   ["toon","me"]
 *   ["toon","household",householdId]                    <- everything household-scoped
 *   ["toon","household",householdId,"<module>",…]       <- one module's household data
 *   ["toon","<module>",…]                               <- one module's user-owned data
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { ModuleId } from "@toon/shared";
import { fetchHealth, isApiError } from "./api";

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

  /** Prefix for EVERY piece of data belonging to one household. */
  household: (householdId: string) => [ROOT, "household", householdId] as const,
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

/* -------------------------------------------------------------------------- */
/* invalidation                                                               */
/* -------------------------------------------------------------------------- */

export const invalidate = {
  health: (qc: QueryClient) => qc.invalidateQueries({ queryKey: queryKeys.health() }),
};
