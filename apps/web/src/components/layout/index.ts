/** App frame + shared chrome. Feature screens mostly need `PageHeader`. */
export { AppShell, PageHeader, type PageHeaderProps } from "./AppShell";
export { BottomTabBar } from "./BottomTabBar";
export { ErrorBoundary } from "./ErrorBoundary";
export { InstallPrompt } from "./InstallPrompt";
export { Logo, type LogoProps } from "./Logo";
export { ModuleSwitcher, type ModuleSwitcherProps } from "./ModuleSwitcher";
export { activeSwitcherItem, moduleSwitcherItems, type ModuleSwitcherItem } from "./module-switcher-items";
export { NotFoundPage } from "./NotFoundPage";
export { OfflineBanner } from "./OfflineBanner";
export { PhoneHeaderRow } from "./PhoneHeaderRow";
export { SideNav } from "./SideNav";
export {
  HOME_NAV_ITEM,
  activeModule,
  linkTo,
  primaryNavItems,
  secondaryNavItems,
  type NavContext,
  type NavItem,
  type NavPath,
} from "./nav-items";
export { useNavItems } from "./use-nav-items";
