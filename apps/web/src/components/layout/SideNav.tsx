import { Link } from "@tanstack/react-router";
import { useT } from "@/lib/i18n";
import { Logo } from "./Logo";
import { linkTo } from "./nav-items";
import { useNavItems } from "./use-nav-items";

/**
 * Desktop sidebar (>= lg). toon-recipe's `SideNav`, reduced for M0: the brand row
 * (Logo + the household app name), the same primary items as the tab bar and the
 * active module's sidebar-only items. The household switcher, the module switcher, the
 * per-item counts and the footer account row arrive with the session (M1) and the
 * design pass (M4) — none of them has data to show before then.
 *
 * `bg-bg-sunken` — one step *below* `--bg` — not `bg-bg-elevated`, which in dark mode
 * is lighter than the page and would invert the intended depth. Every internal divider
 * is `border-surface-2`, the artboard's quieter line, not `border-line`.
 *
 * `data-app-shell` makes the print stylesheets' `aside[data-app-shell]` rule match.
 */
export function SideNav() {
  const t = useT();
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
    </aside>
  );
}
