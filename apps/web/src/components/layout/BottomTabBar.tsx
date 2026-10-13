import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { linkTo } from "./nav-items";
import { useNavItems } from "./use-nav-items";

/**
 * Fixed bottom tab bar for phones (hidden from `lg` up, where the sidebar takes over).
 * Every tab is a >=56px tall touch target and respects the home-indicator inset.
 *
 * Tabs share the width via `flex-1` and their labels truncate rather than wrap — a
 * wrapped label would make one tab taller than its neighbours. The items are computed per
 * location by `primaryNavItems` (nav-items.ts): a module's own tabs inside it, Home and the
 * enabled modules outside (SPEC D6, §5); M0 renders the single Home tab.
 *
 * Ground and border follow the sidebar (`bg-bg-sunken` / `border-surface-2`), the same
 * two values, so the two chrome pieces read as one system. `backdrop-blur-md` is
 * dropped: it only ever mattered because the old ground was translucent, and an opaque
 * `--bg-sunken` bar needs none. `data-app-shell` makes `print.css`'s
 * `nav[data-app-shell]` rule actually match this element (it never matched anything
 * before the redesign).
 */
export function BottomTabBar() {
  const t = useT();
  const { primary } = useNavItems();
  return (
    <nav
      data-app-shell
      aria-label={t("common.nav.mainNavLabel")}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-2 bg-bg-sunken pb-safe lg:hidden"
    >
      <ul className="flex items-stretch justify-around px-safe">
        {primary.map((item) => (
          <li key={item.to} className="min-w-0 flex-1">
            <Link
              to={linkTo(item.to)}
              activeOptions={{ exact: item.exact }}
              className="group flex h-tabbar flex-col items-center justify-center gap-1 px-0.5 text-fg-subtle transition-colors duration-150"
              activeProps={{ className: "text-brand-soft-fg", "aria-current": "page" }}
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "flex h-7 w-11 items-center justify-center rounded-full transition-colors duration-150",
                      isActive && "bg-brand-soft",
                    )}
                  >
                    <item.icon
                      className="size-5"
                      strokeWidth={isActive ? 2.4 : 1.9}
                      aria-hidden="true"
                    />
                  </span>
                  <span
                    className={cn(
                      "max-w-full truncate text-[0.68rem] leading-none",
                      isActive && "font-semibold",
                    )}
                  >
                    {t(item.labelKey)}
                  </span>
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
