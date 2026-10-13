import { Link } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { HouseholdSwitcher } from "@/core/features/households/HouseholdSwitcher";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Logo } from "./Logo";
import { ModuleSwitcher } from "./ModuleSwitcher";
import { linkTo } from "./nav-items";
import { useNavItems } from "./use-nav-items";

/**
 * Desktop sidebar (>= lg). toon-recipe's `SideNav` (artboards 1a/1c/1d) with the
 * household's rows:
 *
 *  1. Logo + the app name (`home.appName`).
 *  2. `HouseholdSwitcher variant="block"`.
 *  2b. `ModuleSwitcher variant="segmented"` — Home + the enabled build modules (SPEC D6,
 *     §5); renders nothing while no build module is enabled.
 *  3. The primary items, the same set as the tab bar. R's per-item counts and the "Neu"
 *     pill are dropped: the core cannot count a module's rows (SPEC §2), and both
 *     belong to the recipe module's design pass (M2/M4).
 *  4. The "Organisieren" group: the active module's sidebar-only items + the core items.
 *  5. The footer account row, one link to `/settings`.
 *
 * `bg-bg-sunken` — one step *below* `--bg` — not `bg-bg-elevated`, which in dark mode
 * is lighter than the page and would invert the intended depth. Every internal divider
 * is `border-surface-2`, the artboard's quieter line, not `border-line`.
 *
 * `data-app-shell` makes the print stylesheets' `aside[data-app-shell]` rule match.
 */
export function SideNav() {
  const t = useT();
  const { user } = useSession();
  const { primary, secondary } = useNavItems();

  return (
    <aside
      data-app-shell
      className="fixed inset-y-0 left-0 z-30 hidden w-sidebar flex-col gap-[22px] border-r border-surface-2 bg-bg-sunken px-3.5 py-5 lg:flex"
    >
      <Link to="/" className="flex items-center gap-2.5 px-1.5">
        <Logo className="size-8" title={t("home.appName")} />
        <span className="font-display text-display-md font-medium text-fg">{t("home.appName")}</span>
      </Link>

      <HouseholdSwitcher variant="block" />

      <ModuleSwitcher variant="segmented" />

      <nav aria-label={t("common.nav.mainNavLabel")}>
        <ul className="flex flex-col gap-0.5">
          {primary.map((item) => (
            <li key={item.to}>
              <Link
                to={linkTo(item.to)}
                activeOptions={{ exact: item.exact }}
                className="flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
                activeProps={{
                  className: "bg-brand-soft text-brand-soft-fg hover:bg-brand-soft",
                  "aria-current": "page",
                }}
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      className="size-[18px] shrink-0"
                      strokeWidth={isActive ? 2.3 : 2}
                      aria-hidden="true"
                    />
                    {t(item.labelKey)}
                  </>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {secondary.length > 0 ? (
        <div className="flex flex-col gap-0.5 border-t border-surface-2 pt-3.5">
          <span className="eyebrow px-3 pb-1.5 text-fg-faint">{t("common.nav.organiseLabel")}</span>
          <nav aria-label={t("common.nav.organiseLabel")}>
            <ul className="flex flex-col gap-0.5">
              {secondary.map((item) => (
                <li key={item.to}>
                  <Link
                    to={linkTo(item.to)}
                    activeOptions={{ exact: item.exact }}
                    className="flex items-center gap-3 rounded-control px-3 py-2 text-control font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
                    activeProps={{
                      className: "bg-brand-soft text-brand-soft-fg hover:bg-brand-soft",
                      "aria-current": "page",
                    }}
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon
                          className="size-4 shrink-0"
                          strokeWidth={isActive ? 2.3 : 2}
                          aria-hidden="true"
                        />
                        {t(item.labelKey)}
                      </>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ) : null}

      {/*
        The footer row is ONE link, not a row-plus-button (R34): the artboard's sidebar
        has no logout icon. Logout lives on `/settings` only. The gear is inside the
        link, so the link's accessible name has to carry the destination — the visible
        name is the user's own name, which doesn't say where it goes.
        Type from the scale (`text-control` / `text-xs`), not R's arbitrary rem sizes.
      */}
      <div className="mt-auto flex items-center gap-2.5 border-t border-surface-2 px-2 py-2.5">
        <Link
          to="/settings"
          aria-label={t("common.sidenav.accountAction")}
          className="flex min-w-0 flex-1 items-center gap-2.5"
        >
          <Avatar name={user?.name} src={user?.avatarUrl} size="sm" tone="accent" />
          <span className="min-w-0">
            <span className="block truncate text-control font-semibold text-fg">
              {user?.name ?? t("common.nav.profile")}
            </span>
            <span className="block truncate text-xs text-fg-subtle">{user?.email}</span>
          </span>
          <Settings className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}
