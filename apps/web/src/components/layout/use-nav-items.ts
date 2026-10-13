import { useRouterState } from "@tanstack/react-router";
import { useSession } from "@/lib/session";
import { WEB_MODULES } from "@/modules";
import { primaryNavItems, secondaryNavItems, type NavItem } from "./nav-items";

/**
 * The shell's nav items for the current location, computed at RENDER time from
 * `WEB_MODULES` (no module-level constant over the registry) and the active household's
 * enabled modules (`households[].modules` of `/api/auth/me`, SPEC §2, §5). Without an
 * active household no module counts as enabled.
 */
export function useNavItems(): { primary: readonly NavItem[]; secondary: readonly NavItem[] } {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const enabledModuleIds = useSession().activeHousehold?.modules ?? [];
  const context = { pathname, modules: WEB_MODULES, enabledModuleIds };
  return { primary: primaryNavItems(context), secondary: secondaryNavItems(context) };
}
