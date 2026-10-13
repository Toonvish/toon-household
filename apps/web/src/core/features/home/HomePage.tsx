import { LayoutGrid } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";

/**
 * Home (`/`), the module-less household screen (SPEC D6, §5). M0's placeholder: the
 * header and the "no modules yet" state. M1 adds the household name and switcher, M4
 * one `homeCard` per enabled module and the enable-module cards.
 *
 * The page root is a plain `flex flex-col gap-4`: `AppShell`'s `<main>` already owns
 * `mx-auto max-w-content px-gutter pt-4 pb-tabbar` (R gotcha — never re-apply them).
 *
 * Default export: the router loads it with `lazyRouteComponent`.
 */
export function HomePage() {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("home.title")} />
      <EmptyState
        icon={<LayoutGrid />}
        title={t("home.empty.title")}
        description={t("home.empty.body")}
      />
    </div>
  );
}

export default HomePage;
