import { useState } from "react";
import { LayoutGrid, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";
import { useActiveHousehold } from "@/lib/session";
// The registry, read at RENDER time only (CLAUDE.md "No module-level constants over
// WEB_MODULES"); the children take it as a prop and import only the pure helpers.
import { WEB_MODULES } from "@/modules";
import { enabledWebModules } from "@/modules/enabled";
import { ManageModulesDialog } from "./ManageModulesDialog";
import { ModuleCards } from "./ModuleCards";

/**
 * Home (`/`), the module-less household screen (SPEC D6, §5): the household switcher
 * and module chip (phones; the sidebar carries both from `lg`), the household's name,
 * one `homeCard` per enabled build module — or the "no modules yet" state —, the
 * enable-module cards, and "Module verwalten" for owners/admins once the build ships a
 * module at all.
 *
 * The household's name is CONTENT, never `t()`. Home sits under
 * `RequireActiveHousehold`, so `household` is set; the `home.title` fallback only covers
 * the instant before the session resolves.
 *
 * The page root is a plain `flex flex-col gap-4`: `AppShell`'s `<main>` already owns
 * `mx-auto max-w-content px-gutter pt-4 pb-tabbar` (R gotcha — never re-apply them).
 *
 * Default export: the router loads it with `lazyRouteComponent`.
 */
export function HomePage() {
  const t = useT();
  const { household, hasRole } = useActiveHousehold();
  const [manageOpen, setManageOpen] = useState(false);

  const modules = WEB_MODULES;
  const enabled = enabledWebModules(modules, household?.modules ?? []);
  const canManage = hasRole("admin") && modules.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <PhoneHeaderRow />
      <PageHeader
        above={<span className="eyebrow text-fg-faint">{t("home.eyebrow")}</span>}
        title={household?.name ?? t("home.title")}
        actions={
          canManage ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<SlidersHorizontal className="size-4" />}
              onClick={() => setManageOpen(true)}
            >
              {t("home.modules.manage")}
            </Button>
          ) : undefined
        }
      />

      {enabled.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {enabled.map((module) => (
            <module.homeCard key={module.id} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<LayoutGrid />}
          title={t("home.empty.title")}
          description={t("home.empty.body")}
        />
      )}

      <ModuleCards modules={modules} />

      {canManage ? (
        <ManageModulesDialog open={manageOpen} onClose={() => setManageOpen(false)} modules={modules} />
      ) : null}
    </div>
  );
}

export default HomePage;
