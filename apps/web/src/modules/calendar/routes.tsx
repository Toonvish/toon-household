/**
 * The calendar module's route tree (docs/modules/calendar.md §4.1, plan m8 section 5.5, ADR 0016).
 *
 * Route map (all below `householdScopedRoute`, so an active household is guaranteed):
 *   /calendar                            layout: moduleLayoutComponent("calendar") (RequireModule)
 *     /                                  Übersicht            features/agenda/AgendaPage
 *     /month?month=YYYY-MM&day=YYYY-MM-DD  Monat              features/month/MonthPage
 *     /tasks                             Aufgaben             features/tasks/TasksPage
 *     /new?kind=&date=                   Neu                  features/entries/NewEntryPage
 *     /entries/$entryId?date=            occurrence detail    features/entries/OccurrenceDetailPage
 *     /entries/$entryId/edit             Bearbeiten           features/entries/EditEntryPage
 *     /cars                              Autos (sidebar)      features/cars/CarsPage
 *     /waste                             Müllabfuhr (sidebar) features/waste/WastePage
 *
 * SCREENS ARE CODE-SPLIT WITH `lazyRouteComponent` (a hand-rolled lazy wrapper hides `.preload` from the router):
 * it is also what keeps this file's static import graph clear of the shell (CLAUDE.md "A module owns its layout
 * route and its static import graph stays shell-free"). Never a static screen import, never the layout
 * components, never the module registry here. Each screen is the NAMED export equal to its file name.
 *
 * This file is the foundation's (plan m8 section 3.4): the lane web may only swap a placeholder import for the real
 * screen at the same path and export name.
 */
import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { moduleLayoutComponent } from "@/modules/layout";
import { householdScopedRoute, pick } from "@/route-roots";

/* -------------------------------------------------------------------------- */
/* search params                                                              */
/* -------------------------------------------------------------------------- */

/** Monat: the shown month (`YYYY-MM`) and the selected day (`YYYY-MM-DD`). `pick()` drops anything else. */
export const CALENDAR_MONTH_PARAMS = ["month", "day"] as const;
/** Neu: the preselected kind (`event`, `task`, `car`) and day. */
export const CALENDAR_NEW_PARAMS = ["kind", "date"] as const;
/** The occurrence detail: which occurrence of the series (its start date). */
export const CALENDAR_OCCURRENCE_PARAMS = ["date"] as const;

/* -------------------------------------------------------------------------- */
/* module layout                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The module's layout route at its base path (SPEC §2 `WebModule.route`). Its component is the module-enabled
 * guard: a household without the calendar is sent Home with a toast before any calendar chunk loads (SPEC §5).
 */
export const calendarLayoutRoute = createRoute({
  getParentRoute: () => householdScopedRoute,
  path: "/calendar",
  component: moduleLayoutComponent("calendar"),
});

/* -------------------------------------------------------------------------- */
/* screens                                                                    */
/* -------------------------------------------------------------------------- */

const agendaRoute = createRoute({
  getParentRoute: () => calendarLayoutRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./features/agenda/AgendaPage"), "AgendaPage"),
});

const monthRoute = createRoute({
  getParentRoute: () => calendarLayoutRoute,
  path: "month",
  validateSearch: (search: Record<string, unknown>) => pick(search, CALENDAR_MONTH_PARAMS),
  component: lazyRouteComponent(() => import("./features/month/MonthPage"), "MonthPage"),
});

const tasksRoute = createRoute({
  getParentRoute: () => calendarLayoutRoute,
  path: "tasks",
  component: lazyRouteComponent(() => import("./features/tasks/TasksPage"), "TasksPage"),
});

const newEntryRoute = createRoute({
  getParentRoute: () => calendarLayoutRoute,
  path: "new",
  validateSearch: (search: Record<string, unknown>) => pick(search, CALENDAR_NEW_PARAMS),
  component: lazyRouteComponent(() => import("./features/entries/NewEntryPage"), "NewEntryPage"),
});

const occurrenceDetailRoute = createRoute({
  getParentRoute: () => calendarLayoutRoute,
  path: "entries/$entryId",
  validateSearch: (search: Record<string, unknown>) => pick(search, CALENDAR_OCCURRENCE_PARAMS),
  component: lazyRouteComponent(() => import("./features/entries/OccurrenceDetailPage"), "OccurrenceDetailPage"),
});

const editEntryRoute = createRoute({
  getParentRoute: () => calendarLayoutRoute,
  path: "entries/$entryId/edit",
  component: lazyRouteComponent(() => import("./features/entries/EditEntryPage"), "EditEntryPage"),
});

const carsRoute = createRoute({
  getParentRoute: () => calendarLayoutRoute,
  path: "cars",
  component: lazyRouteComponent(() => import("./features/cars/CarsPage"), "CarsPage"),
});

const wasteRoute = createRoute({
  getParentRoute: () => calendarLayoutRoute,
  path: "waste",
  component: lazyRouteComponent(() => import("./features/waste/WastePage"), "WastePage"),
});

/* -------------------------------------------------------------------------- */
/* tree                                                                       */
/* -------------------------------------------------------------------------- */

/** The module's layout route with its children: the manifest's `route` (SPEC §2). */
export const calendarRouteTree = calendarLayoutRoute.addChildren([
  agendaRoute,
  monthRoute,
  tasksRoute,
  newEntryRoute,
  occurrenceDetailRoute,
  editEntryRoute,
  carsRoute,
  wasteRoute,
]);
