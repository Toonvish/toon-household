import { CircleUser, House, Users, type LucideIcon } from "lucide-react";
import type { ModuleId } from "@toon/shared";
import type { ComponentType } from "react";
import type { MessageKey } from "@/lib/i18n";
import type { WebModule } from "@/modules/types";

/**
 * Every path a nav item may point at: Home, the shared Profil (`/settings`), the core
 * household screens (`/households`, `/households/$householdId`), a module's base path or
 * any path below it.
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
export type NavPath =
  | "/"
  | "/settings"
  | "/households"
  | `/households/${string}`
  | `/${ModuleId}`
  | `/${ModuleId}/${string}`;

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
  /**
   * SIDEBAR ONLY (plan m4-design-pass §1 decision 6): drawn after the label in `SideNav`'s
   * primary list — toon-recipe's per-item count or "Neu" pill. The tab bar ignores it (R
   * draws counts in the sidebar only). A COMPONENT, not a value, so the module's own query
   * hooks run inside it at render time; it positions itself (`ml-auto`) and renders
   * nothing while its value is unknown. Declared by the module manifest, so it lives in
   * the manifest's static import graph and must stay shell-free (SPEC §2).
   */
  trailing?: ComponentType<{ isActive: boolean }>;
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

/**
 * Profil (`/settings`) — the shared LAST tab, inside a module and outside (SPEC D6, §5).
 * `CircleUser`, not a gear: the tab is a person, not a preferences screen (R design spec
 * 05-frontend-shell §7).
 */
export const PROFILE_NAV_ITEM: NavItem = {
  to: "/settings",
  labelKey: "common.nav.profile",
  icon: CircleUser,
  exact: false,
};

/**
 * Gruppen (`/households`) — the core's sidebar-only item, always the last secondary entry.
 * Below `lg` there is no sidebar, so its phone route is the households card on `/settings`
 * (R's reachability rule for Gruppen: deleting that card orphans household management on a
 * phone). Copy stays R's "Gruppen" (plan m1-core §1 decision 5, D10).
 */
export const HOUSEHOLDS_NAV_ITEM: NavItem = {
  to: "/households",
  labelKey: "common.nav.groups",
  icon: Users,
  exact: false,
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
   * are ignored. From the session (`useNavItems`); empty without an active household.
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
 *  - Inside a module: that module's own three `navItems` (passed through untouched, so a
 *    `trailing` slot survives) · Profil.
 *  - Outside (Home, Settings, Gruppen): Home · the enabled modules, at most two · Profil.
 *
 * With no module enabled (all of M1) the result is `[HOME_NAV_ITEM, PROFILE_NAV_ITEM]`.
 */
export function primaryNavItems({ pathname, modules, enabledModuleIds }: NavContext): readonly NavItem[] {
  const current = activeModule(pathname, modules);
  if (current) return [...current.navItems, PROFILE_NAV_ITEM];
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
  return [HOME_NAV_ITEM, ...moduleTabs, PROFILE_NAV_ITEM];
}

/**
 * Sidebar-only destinations (D6): the active module's `secondaryNavItems`, then the core
 * Gruppen item — so outside a module the list is Gruppen alone. Every one of them must
 * also be reachable from a tab screen, because there is no sidebar below `lg` (Gruppen:
 * the households card on `/settings`).
 */
export function secondaryNavItems({ pathname, modules }: NavContext): readonly NavItem[] {
  return [...(activeModule(pathname, modules)?.secondaryNavItems ?? []), HOUSEHOLDS_NAV_ITEM];
}
