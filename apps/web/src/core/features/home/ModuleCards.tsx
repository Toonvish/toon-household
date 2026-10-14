import { useId, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useT } from "@/lib/i18n";
import { useActiveHousehold, useCanMutate } from "@/lib/session";
import { availableWebModules } from "@/modules/enabled";
import type { WebModule } from "@/modules/types";
import { useEnableModule } from "./lib/queries";

export interface ModuleCardsProps {
  /** The build's modules (`WEB_MODULES`), passed in by `HomePage` at render time. */
  modules: readonly WebModule[];
}

/**
 * "Verfügbare Module" on Home (SPEC §5): one card per build module the active household
 * has not enabled yet. Owners/admins get "Aktivieren"; members get the hint instead.
 * Renders nothing when every build module is enabled.
 * Writes are gated by `useCanMutate()` (offline / unconfirmed e-mail).
 *
 * A module that declares `enableDialog` (finance: the two participants, SPEC D3) is not
 * enabled by one POST: "Aktivieren" opens the module's dialog, which enables it with its
 * settings itself (docs/plans/m3-finance-module.md §1 decisions 4 and 7).
 */
export function ModuleCards({ modules }: ModuleCardsProps) {
  const t = useT();
  const headingId = useId();
  const { household, householdId, hasRole } = useActiveHousehold();
  const { canMutate, reason } = useCanMutate();
  const enable = useEnableModule();
  const [dialogModule, setDialogModule] = useState<WebModule | null>(null);

  const available = availableWebModules(modules, household?.modules ?? []);
  if (available.length === 0 || householdId === null) return null;

  const isAdmin = hasRole("admin");

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionHeader id={headingId} title={t("home.modules.availableTitle")} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {available.map((module) => (
          <Card as="li" key={module.id} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-fg"
            >
              <module.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-display-sm font-medium text-fg">
                {t(module.nameKey)}
              </span>
              {isAdmin ? null : (
                <span className="mt-0.5 block text-xs text-fg-muted">{t("home.modules.memberHint")}</span>
              )}
            </span>
            {isAdmin ? (
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                disabled={!canMutate}
                title={reason}
                loading={enable.isPending && enable.variables?.moduleId === module.id}
                onClick={() => {
                  if (module.enableDialog) setDialogModule(module);
                  else enable.mutate({ householdId, moduleId: module.id });
                }}
              >
                {t("home.modules.enable")}
              </Button>
            ) : null}
          </Card>
        ))}
      </ul>
      {dialogModule?.enableDialog ? (
        <dialogModule.enableDialog open onClose={() => setDialogModule(null)} />
      ) : null}
    </section>
  );
}
