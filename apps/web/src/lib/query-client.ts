import { QueryClient } from "@tanstack/react-query";
import { STALE_TIME, retryDelay, shouldRetry } from "./queries";

/**
 * Builds a QueryClient. Defaults are tuned for a mobile PWA: no refetch storms on
 * focus, but stale data is refreshed when the phone comes back online or a screen is
 * remounted.
 *
 * Prefer the {@link queryClient} singleton in app code; this factory is for tests that
 * want an isolated cache.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME.list,
        gcTime: 10 * 60_000,
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        refetchOnMount: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * THE client for the running app, at module scope so HMR keeps the cache.
 *
 * It lives here rather than in app.tsx because module outboxes register their mutation
 * defaults on this instance (SPEC D9), and a `useQueryClient()` call cannot do that: the
 * defaults must exist before the persister restores paused mutations, which happens
 * before any component renders.
 */
export const queryClient: QueryClient = createQueryClient();
