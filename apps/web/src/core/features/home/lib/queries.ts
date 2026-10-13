/**
 * Module enabling from Home (SPEC D2, §5; plan §1 decision 3). Owners/admins with a
 * verified e-mail; the API answers 403 otherwise, which lands in the error toast.
 *
 * Both mutations invalidate `me` (its persisted `households[].modules` drives the shell:
 * tabs, switcher, `RequireModule`), the households list and the household's whole
 * prefix `["toon","household",id]` (its detail and, after a disable, any module data).
 */
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { HouseholdWithRole, ModuleId } from "@toon/shared";
import { useToast } from "@/components/ui/Toast";
import { disableModule, enableModule, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { invalidate, queryKeys } from "@/lib/queries";

export interface ModuleMutationInput {
  householdId: string;
  moduleId: ModuleId;
}

async function invalidateAfterModuleChange(client: QueryClient, householdId: string): Promise<void> {
  await Promise.all([
    invalidate.me(client),
    invalidate.households(client),
    client.invalidateQueries({ queryKey: queryKeys.household(householdId) }),
  ]);
}

/** `POST /api/households/:id/modules/:moduleId` — the refreshed household on success. */
export function useEnableModule() {
  const client = useQueryClient();
  const toast = useToast();
  const t = useT();
  return useMutation<HouseholdWithRole, Error, ModuleMutationInput>({
    mutationFn: async ({ householdId, moduleId }) => {
      const response = await enableModule(householdId, moduleId);
      return response.household;
    },
    onSuccess: async (_household, { householdId }) => {
      await invalidateAfterModuleChange(client, householdId);
      toast.success(t("home.modules.enabledToast"));
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

/** `DELETE /api/households/:id/modules/:moduleId` — idempotent; module data stays. */
export function useDisableModule() {
  const client = useQueryClient();
  const toast = useToast();
  const t = useT();
  return useMutation<void, Error, ModuleMutationInput>({
    mutationFn: ({ householdId, moduleId }) => disableModule(householdId, moduleId),
    onSuccess: async (_result, { householdId }) => {
      await invalidateAfterModuleChange(client, householdId);
      toast.success(t("home.modules.disabledToast"));
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}
