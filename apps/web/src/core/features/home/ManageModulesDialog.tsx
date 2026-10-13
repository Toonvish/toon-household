import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Switch } from "@/components/ui/Switch";
import { useT } from "@/lib/i18n";
import { useActiveHousehold, useCanMutate } from "@/lib/session";
import { isModuleEnabled } from "@/modules/enabled";
import type { WebModule } from "@/modules/types";
import { useDisableModule, useEnableModule } from "./lib/queries";

export interface ManageModulesDialogProps {
  open: boolean;
  onClose: () => void;
  /** The build's modules (`WEB_MODULES`), passed in by `HomePage` at render time. */
  modules: readonly WebModule[];
}

/**
 * "Module verwalten" (SPEC §5, owners/admins): one `Switch` per build module, on =
 * enabled for the active household. Switching ON enables at once; switching OFF asks
 * first, because the module disappears for every member (its data stays, D2).
 */
export function ManageModulesDialog({ open, onClose, modules }: ManageModulesDialogProps) {
  const t = useT();
  const { household, householdId } = useActiveHousehold();
  const { canMutate, reason } = useCanMutate();
  const enable = useEnableModule();
  const disable = useDisableModule();
  const [pendingDisable, setPendingDisable] = useState<WebModule | null>(null);

  const enabledIds = household?.modules ?? [];
  const busy = enable.isPending || disable.isPending;

  return (
    <>
      <Dialog
        open={open && pendingDisable === null}
        onClose={onClose}
        title={t("home.modules.manage")}
        description={t("home.modules.manageDescription")}
        size="sm"
      >
        <ul className="flex flex-col gap-1 pb-2">
          {modules.map((module) => {
            const enabled = isModuleEnabled(enabledIds, module.id);
            return (
              <li key={module.id} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand-soft-fg"
                >
                  <module.icon className="size-5" />
                </span>
                <Switch
                  className="min-w-0 flex-1"
                  label={t(module.nameKey)}
                  checked={enabled}
                  disabled={!canMutate || busy || householdId === null}
                  onChange={(checked) => {
                    if (householdId === null) return;
                    if (checked) enable.mutate({ householdId, moduleId: module.id });
                    else setPendingDisable(module);
                  }}
                />
              </li>
            );
          })}
        </ul>
        {reason ? <p className="pb-2 text-xs text-fg-muted">{reason}</p> : null}
      </Dialog>

      <ConfirmDialog
        open={pendingDisable !== null}
        onClose={() => setPendingDisable(null)}
        title={t("home.modules.disableConfirmTitle")}
        description={
          pendingDisable
            ? t("home.modules.disableConfirmDescription", { name: t(pendingDisable.nameKey) })
            : undefined
        }
        confirmLabel={t("home.modules.disable")}
        destructive
        onConfirm={async () => {
          if (!pendingDisable || householdId === null) return;
          await disable.mutateAsync({ householdId, moduleId: pendingDisable.id });
        }}
      />
    </>
  );
}
