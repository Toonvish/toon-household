import { House, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/i18n";
// `enabled.ts` and `types.ts` are pure; the registry (`@/modules`) is never imported here —
// the caller passes `WEB_MODULES` in at render time (no module-level read, plan §1 decision 6).
import { enabledWebModules } from "@/modules/enabled";
import type { WebModule } from "@/modules/types";
import type { NavPath } from "./nav-items";

/** One entry of the module switcher (SPEC D6, §5): Home or an enabled build module. */
export interface ModuleSwitcherItem {
  to: NavPath;
  /** A catalog key, resolved at RENDER time (never a frozen label). */
  labelKey: MessageKey;
  icon: LucideIcon;
}

/**
 * The module switcher's entries: Home first, then every build module the active
 * household has enabled, in registry order. EMPTY while no build module is enabled —
 * a switcher whose only entry is Home switches nothing, so it renders nothing (all of
 * M1, whose build ships no module). Unknown ids in `enabledIds` are ignored.
 */
export function moduleSwitcherItems(
  modules: readonly WebModule[],
  enabledIds: readonly string[],
): ModuleSwitcherItem[] {
  const enabled = enabledWebModules(modules, enabledIds);
  if (enabled.length === 0) return [];
  return [
    { to: "/", labelKey: "home.nav.label", icon: House },
    ...enabled.map(
      (module): ModuleSwitcherItem => ({ to: module.basePath, labelKey: module.nameKey, icon: module.icon }),
    ),
  ];
}

/**
 * The entry the current location belongs to: the module whose base path prefixes
 * `pathname` (the active module IS the URL prefix, SPEC §5), else Home — Home and
 * Settings are module-less. `undefined` only for an empty list.
 */
export function activeSwitcherItem(
  items: readonly ModuleSwitcherItem[],
  pathname: string,
): ModuleSwitcherItem | undefined {
  const moduleItem = items.find(
    (item) => item.to !== "/" && (pathname === item.to || pathname.startsWith(`${item.to}/`)),
  );
  return moduleItem ?? items.find((item) => item.to === "/");
}
