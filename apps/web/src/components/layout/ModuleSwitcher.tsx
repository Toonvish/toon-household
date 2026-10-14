import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useActiveHousehold } from "@/lib/session";
// The registry, read at RENDER time only (CLAUDE.md "No module-level constants over
// WEB_MODULES"). `module-switcher-items.ts` stays pure and takes it as a parameter.
import { WEB_MODULES } from "@/modules";
import { activeSwitcherItem, moduleSwitcherItems, type ModuleSwitcherItem } from "./module-switcher-items";
import { linkTo } from "./nav-items";

export interface ModuleSwitcherProps {
  /**
   * `chip` = phones: a quiet inline chip (the active entry's icon + label + chevron, 44px
   * hit target) that is the trigger of an `ActionMenu` sheet. `segmented` = the sidebar head
   * from `lg`: one row of links, the active one in the SideNav active treatment.
   */
  variant: "chip" | "segmented";
  className?: string;
}

/**
 * The module switcher (SPEC D6, §5): Home + the active household's enabled build
 * modules. The active module IS the URL prefix; Home and Settings are module-less.
 * Renders nothing while no build module is enabled — a switcher with Home as its only
 * entry switches nothing.
 */
export function ModuleSwitcher({ variant, className }: ModuleSwitcherProps) {
  const t = useT();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { household } = useActiveHousehold();
  const items = moduleSwitcherItems(WEB_MODULES, household?.modules ?? []);
  const active = activeSwitcherItem(items, pathname);

  if (items.length === 0 || !active) return null;

  return variant === "chip" ? (
    <ModuleSwitcherChip items={items} active={active} className={className} />
  ) : (
    <div
      role="group"
      aria-label={t("home.moduleSwitcher.label")}
      className={cn("flex gap-0.5 rounded-control bg-surface-2 p-0.5", className)}
    >
      {items.map((item) => {
        const isActive = item.to === active.to;
        return (
          <Link
            key={item.to}
            to={linkTo(item.to)}
            // `exact`: TanStack's own active state would otherwise mark Home ("/") active
            // on every path. The module-level "current" is computed here instead.
            activeOptions={{ exact: true }}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-control px-1.5 py-1.5 text-xs font-medium transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              isActive ? "bg-brand-soft text-brand-soft-fg" : "text-fg-muted hover:bg-surface hover:text-fg",
            )}
          >
            <item.icon className="size-4 shrink-0" strokeWidth={isActive ? 2.3 : 2} aria-hidden="true" />
            <span className="max-w-full truncate">{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * The phone chip: an `ActionMenu` (plan m4-design-pass §1 decision 5) whose trigger is a
 * labelled chip instead of the icon-only `IconButton` — the chip has to say which module
 * you are in. The sheet, Escape, focus trap, scroll lock and the close-then-act rule all
 * come from `ActionMenu`; the active entry is its `current` row.
 */
function ModuleSwitcherChip({
  items,
  active,
  className,
}: {
  items: readonly ModuleSwitcherItem[];
  active: ModuleSwitcherItem;
  className?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const title = t("home.moduleSwitcher.title");

  return (
    <ActionMenu
      title={title}
      items={items.map(
        (item): ActionMenuItem => ({
          label: t(item.labelKey),
          icon: <item.icon className="size-5" />,
          current: item.to === active.to,
          onSelect: () => {
            void navigate({ to: linkTo(item.to) });
          },
        }),
      )}
      renderTrigger={(trigger) => (
        <button
          type="button"
          {...trigger}
          aria-label={`${title}: ${t(active.labelKey)}`}
          className={cn(
            "flex min-h-11 min-w-0 items-center gap-1.5 rounded-xl px-2.5 text-left transition-colors duration-150 hover:bg-surface-2",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            className,
          )}
        >
          <active.icon className="size-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 truncate text-sm font-semibold text-fg">{t(active.labelKey)}</span>
          <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
        </button>
      )}
    />
  );
}
