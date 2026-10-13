/**
 * The offline-cache policy assembled from the module manifests (SPEC D9): the union of
 * every module's `persistQueryAllowList` decides which queries are written to
 * IndexedDB, the union of every `persistMutationNamespaces` which PAUSED mutations
 * are. `app.tsx` passes `WEB_MODULES`; nothing hard-codes a list (plan §1 decision 8).
 *
 * Takes only the two manifest fields it reads, so a test can feed fake slices without
 * building a whole `WebModule`.
 */
import { createShouldPersistMutation, createShouldPersistQuery } from "@/lib/persist";
import type { WebModule } from "./types";

export type PersistPolicySource = Pick<WebModule, "persistQueryAllowList" | "persistMutationNamespaces">;

export function buildPersistPolicy(modules: readonly PersistPolicySource[]): {
  shouldDehydrateQuery: ReturnType<typeof createShouldPersistQuery>;
  shouldDehydrateMutation: ReturnType<typeof createShouldPersistMutation>;
} {
  return {
    shouldDehydrateQuery: createShouldPersistQuery(modules.flatMap((m) => m.persistQueryAllowList)),
    shouldDehydrateMutation: createShouldPersistMutation(
      modules.flatMap((m) => m.persistMutationNamespaces ?? []),
    ),
  };
}
