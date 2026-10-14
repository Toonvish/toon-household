import { MutationCache, QueryCache, QueryClient, onlineManager } from "@tanstack/react-query";
import { isApiError } from "./api";
import { STALE_TIME, queryKeys, retryDelay, shouldRetry } from "./queries";

/**
 * Builds a QueryClient. Defaults are tuned for a mobile PWA: no refetch storms on
 * focus, but stale data is refreshed when the phone comes back online or a screen is
 * remounted.
 *
 * Prefer the {@link queryClient} singleton in app code; this factory is for tests that
 * want an isolated cache.
 *
 * MODULE DISABLED (SPEC §5, plan m1-core §1 decision 9). A module route answers
 * `404 module_disabled` once the household's module is off. Both caches' `onError`
 * invalidate `["toon","me"]` on that code: the refetched `households[].modules` drops the
 * module and `RequireModule` (the module layout route) redirects Home with the toast. One
 * code path for "disabled while the PWA was open" and "stale bundle"; no screen handles it.
 */
export function createQueryClient(): QueryClient {
  let client: QueryClient;
  const onError = (error: unknown): void => {
    if (isApiError(error) && error.code === "module_disabled") {
      void client.invalidateQueries({ queryKey: queryKeys.me() });
    }
  };
  client = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
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
  return client;
}

/**
 * TanStack's `onlineManager` starts as "online" and only changes on a browser `online` /
 * `offline` EVENT, so an app cold-started or reloaded while offline believes it is online: a
 * restored paused write is run again, fails, and then waits in an unpaused retry that
 * `shouldPersistMutation` (paused mutations only) drops from the persisted cache, so a second
 * reload while still offline loses the queued booking. Seeding the manager from
 * `navigator.onLine` once at boot keeps the restored mutation paused (and so persisted).
 * The browser's events keep driving it afterwards.
 */
export function seedOnlineManager(
  navigatorOnLine: boolean | undefined = typeof navigator === "undefined" ? undefined : navigator.onLine,
  manager: Pick<typeof onlineManager, "setOnline"> = onlineManager,
): void {
  if (navigatorOnLine === false) manager.setOnline(false);
}

seedOnlineManager();

/**
 * THE client for the running app, at module scope so HMR keeps the cache.
 *
 * It lives here rather than in app.tsx because module outboxes register their mutation
 * defaults on this instance (SPEC D9), and a `useQueryClient()` call cannot do that: the
 * defaults must exist before the persister restores paused mutations, which happens
 * before any component renders.
 */
export const queryClient: QueryClient = createQueryClient();
