import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { ErrorBoundary } from "@/components/layout/ErrorBoundary";
import { ToastProvider } from "@/components/ui/Toast";
import { I18nProvider } from "@/lib/i18n";
import { PERSIST_BUSTER, PERSIST_MAX_AGE_MS, createIndexedDbPersister } from "@/lib/persist";
import { queryClient } from "@/lib/query-client";
import { WEB_MODULES } from "@/modules";
import { buildPersistPolicy } from "@/modules/persist";
import { router } from "@/router";

/**
 * Each module's offline outbox (SPEC D9: recipe's shopping list, finance's transaction
 * capture) registers its mutation defaults HERE, at module scope, before anything
 * renders. A restored mutation carries its variables but not its function, so those
 * defaults must exist before the persister restores and `resumePausedMutations()` runs.
 * (toon-recipe did this with a side-effect import of its shopping offline module.)
 */
for (const module of WEB_MODULES) module.mutationDefaults?.(queryClient);

/**
 * What the persister may write: the union of every manifest's
 * `persistQueryAllowList` and `persistMutationNamespaces` (SPEC D9, plan §1 decision 8).
 * Computed once — the build's module list does not change at runtime.
 */
const dehydrateOptions = buildPersistPolicy(WEB_MODULES);

/**
 * ONE stable persister for the whole app lifetime. It resolves the account it writes
 * for on every call (see lib/persist.ts), which is what keeps a login as a different
 * user from saving into the previous user's blob.
 */
const persister = createIndexedDbPersister();

/**
 * Provider stack:
 *   ErrorBoundary -> PersistQueryClient -> Toasts -> Router (-> SessionProvider, M1)
 * The session provider deliberately lives inside the router so it can navigate.
 *
 * `PersistQueryClientProvider` rather than a `persistQueryClient()` call in an
 * effect, because it HOLDS BACK the first fetches until the restore has finished.
 * Without that gate an offline start would fire `/api/auth/me`, fail, and paint
 * "Server nicht erreichbar" a tick before the cached session arrived.
 *
 * `onSuccess` fires once the restore has finished, and is where edits queued offline
 * are flushed. It has to be here rather than in a screen: the mutations come out of
 * the same blob the restore just read, and the phone may well be reopened on a
 * completely different route.
 */
export function App() {
  return (
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: PERSIST_MAX_AGE_MS,
          buster: PERSIST_BUSTER,
          dehydrateOptions,
        }}
        onSuccess={() => {
          // A failed replay must not become an unhandled rejection: the mutation stays
          // paused and the next reconnect tries again.
          void queryClient.resumePausedMutations().catch(() => undefined);
        }}
      >
        <I18nProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </I18nProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
