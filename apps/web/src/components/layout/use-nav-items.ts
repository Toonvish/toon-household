import { useRouterState } from "@tanstack/react-router";
import { WEB_MODULES } from "@/modules";
import { primaryNavItems, secondaryNavItems, type NavItem } from "./nav-items";

/**
 * The shell's nav items for the current location, computed at RENDER time from
 * `WEB_MODULES` (plan §1 decision 6). `enabledModuleIds` is empty until M1 provides the
 * active household's `modules` through the session.
 */
export function useNavItems(): { primary: readonly NavItem[]; secondary: readonly NavItem[] } {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const context = { pathname, modules: WEB_MODULES, enabledModuleIds: [] };
  return { primary: primaryNavItems(context), secondary: secondaryNavItems(context) };
}
