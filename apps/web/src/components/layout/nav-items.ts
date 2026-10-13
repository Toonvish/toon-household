import { House, type LucideIcon } from "lucide-react";
import type { ModuleId } from "@toon/shared";
import type { MessageKey } from "@/lib/i18n";
import type { WebModule } from "@/modules/types";

/**
 * Every path a nav item may point at: Home, the shared Profil (`/settings`, M1), a
 * module's base path or any path below it.
 *
 * HOW `to` STAYS TYPED WITH MODULE-CONTRIBUTED PATHS. Module routes reach the router at
 * runtime as `AnyRoute[]` (SPEC §2), so the registered route tree cannot name a module's
 * child paths, and TanStack's `LinkProps["to"]` is either too narrow (a tree with core
 * routes only rejects `/recipe/plan`; measured: `Type '"/finance"' is not assignable to
 * type '"." | ".." | "/"'`) or `any` (once `AnyRoute` children are in the tree). So:
 *
 *  1. `NavItem.to` is this hand-written union — a typo in a module prefix fails `tsc`
 *     where the item is DECLARED (in the module manifest);
 *  2. the two renderers pass it through {@link linkTo}, which widens it to `string`.
 *     TanStack accepts a non-literal `string` for `to` whatever the route tree's
 *     strictness (it only checks literals), so `<Link to={linkTo(item.to)}>` compiles
 *     today and still compiles once M2 makes the tree strict again. No cast is involved.
 *
 * A path that has no route still renders `NotFoundPage` — the router's job.
 */
export type NavPath = "/" | "/settings" | `/${ModuleId}` | `/${ModuleId}/${string}`;

export interface NavItem {
  to: NavPath;
  /**
   * A catalog key, not a translated string (§10 rule 8): resolving it at
   * IMPORT time would freeze the label at whatever locale was active on
   * first load, in both the tab bar and the sidebar.
   */
  labelKey: MessageKey;
  icon: LucideIcon;
  /** Home and a module's home match exactly; the rest match their subtree. */
  exact: boolean;
}

/** The one widening from {@link NavPath} to `<Link to>` — see the note on `NavPath`. */
export function linkTo(path: NavPath): string {
  return path;
}

/** Home (`/`), module-less (SPEC §5): the first tab outside a module. */
export const HOME_NAV_ITEM: NavItem = {
  to: "/",
  labelKey: "home.nav.label",
  icon: House,
  exact: true,
};

/** At most this many modules get a tab outside a module (SPEC §5: Home · max two · Profil). */
const MAX_MODULE_TABS = 2;

export interface NavContext {
  /** The current location's pathname. */
  pathname: string;
  /** The build's modules — `WEB_MODULES`, passed in, never read at import time. */
  modules: readonly WebModule[];
  /**
   * The ACTIVE HOUSEHOLD's enabled modules (`household.modules`, SPEC §2). Unknown ids
   * are ignored. Empty until M1 wires the session; M0 has none.
   */
  enabledModuleIds: readonly string[];
}

/** The module whose `basePath` prefixes `pathname`, if any — the active module (SPEC §5). */
export function activeModule(
  pathname: string,
  modules: readonly WebModule[],
): WebModule | undefined {
  return modules.find(
    (module) => pathname === module.basePath || pathname.startsWith(`${module.basePath}/`),
  );
}

/**
 * The primary destinations — bottom tab bar on phones, top of the sidebar from `lg`
 * (SPEC D6, §5). A FUNCTION, not a module-level constant over `WEB_MODULES`: a manifest
 * imports the layout, and a constant here would read the registry mid-cycle (plan §1
 * decision 6).
 *
 *  - Inside a module: that module's own `navItems` (+ Profil from M1).
 *  - Outside (Home, Settings): Home · the enabled modules, at most two (+ Profil from M1).
 *
 * M0 has no modules and no session, so the result is `[HOME_NAV_ITEM]`.
 */
export function primaryNavItems({ pathname, modules, enabledModuleIds }: NavContext): readonly NavItem[] {
  const current = activeModule(pathname, modules);
  if (current) return current.navItems;
  const moduleTabs = modules
    .filter((module) => enabledModuleIds.includes(module.id))
    .slice(0, MAX_MODULE_TABS)
    .map(
      (module): NavItem => ({
        to: module.basePath,
        labelKey: module.nameKey,
        icon: module.icon,
        exact: false,
      }),
    );
  return [HOME_NAV_ITEM, ...moduleTabs];
}

/**
 * Sidebar-only destinations of the active module (D6). Every one of them must also be
 * reachable from a tab screen, because there is no sidebar below `lg`. Outside a
 * module there are none.
 */
export function secondaryNavItems({ pathname, modules }: NavContext): readonly NavItem[] {
  return activeModule(pathname, modules)?.secondaryNavItems ?? [];
}
