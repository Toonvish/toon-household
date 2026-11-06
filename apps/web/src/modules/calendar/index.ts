/**
 * The calendar module's web manifest (SPEC §2, D6, D9; docs/modules/calendar.md §4; ADR 0016; plan m8 P24). Listed
 * in `modules/index.ts`; nothing outside this directory knows the module's routes, screens, query keys or catalogs
 * except through this object.
 *
 * LITERAL-TYPED ON PURPOSE: no type annotation, only `satisfies WebModule<"calendar">`, so `WEB_MODULES` keeps the
 * concrete route tree type (the registered router tree stays strict) and the catalogs keep their literal keys.
 *
 * STATIC IMPORT GRAPH (CLAUDE.md "A module owns its layout route and its static import graph stays shell-free"):
 * this file, `routes.tsx`, `HomeCard.tsx` and the catalogs never import the module registry, the shell (the layout
 * components, `use-nav-items`) or a screen. `persist.test.ts` imports this manifest FIRST on purpose.
 *
 * Navigation (design §4.1, D6): tabs Übersicht · Monat · Aufgaben (the shell appends Profil); sidebar-only Autos and
 * Müllabfuhr (the shell appends Gruppen). Their phone routes: the car card on Übersicht links to Autos, the
 * Müllabfuhr card on Aufgaben to Müllabfuhr. Creating is the one header action of every tab screen, not a tab.
 *
 * Offline (P24): the reads persist; writes are online only, so there is no outbox (`persistMutationNamespaces`,
 * `mutationDefaults`) and no `enableDialog` (the module needs no settings) or `settingsSections`.
 */
import { CalendarDays, Car, CheckSquare, LayoutList, Trash2 } from "lucide-react";
import type { WebModule } from "@/modules/types";
import { calendarDe, calendarEn } from "./catalogs/index.ts";
import { CalendarHomeCard } from "./HomeCard";
import { calendarRouteTree } from "./routes";

export const calendarModule = {
  id: "calendar",
  nameKey: "calendar.module.name",
  icon: CalendarDays,
  basePath: "/calendar",
  route: calendarRouteTree,
  navItems: [
    { to: "/calendar", labelKey: "calendar.nav.overview", icon: LayoutList, exact: true },
    { to: "/calendar/month", labelKey: "calendar.nav.month", icon: CalendarDays, exact: false },
    { to: "/calendar/tasks", labelKey: "calendar.nav.tasks", icon: CheckSquare, exact: false },
  ],
  secondaryNavItems: [
    { to: "/calendar/cars", labelKey: "calendar.nav.cars", icon: Car, exact: false },
    { to: "/calendar/waste", labelKey: "calendar.nav.waste", icon: Trash2, exact: false },
  ],
  homeCard: CalendarHomeCard,
  /**
   * What is persisted for offline reading (SPEC D9, P24). Keys are `["toon","household",<id>,"calendar",<segment>,…]`
   * (`lib/queries.ts` `calendarKeys`): the occurrence lists (with their `members`, so names and colours render
   * offline), the series, one series, the cars and the waste overview.
   */
  persistQueryAllowList: [
    { scope: "household", path: ["calendar", "occurrences"] },
    { scope: "household", path: ["calendar", "entries"] },
    { scope: "household", path: ["calendar", "entry"] },
    { scope: "household", path: ["calendar", "resources"] },
    { scope: "household", path: ["calendar", "waste"] },
  ],
  catalogs: { de: calendarDe, en: calendarEn },
} satisfies WebModule<"calendar">;
