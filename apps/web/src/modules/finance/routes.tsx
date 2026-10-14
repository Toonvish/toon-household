/**
 * The finance module's route tree (SPEC D6, §2; docs/plans/m3-finance-module.md §1 decisions 3
 * and 13), ported from toon-finance's `apps/web/src/router.tsx` (helpers lines 50–60, routes
 * lines 150–260) with every path under the module's base path `/finance`.
 *
 * Route map (all below `householdScopedRoute`, so an active household is guaranteed):
 *   /finance                     layout: moduleLayoutComponent("finance") (RequireModule)
 *     (participant-gate)         pathless: FinanceGate — a member without a slot sees
 *                                `NonParticipantState` on EVERY finance screen (decision 3)
 *       /                        Übersicht (F `/`)
 *       /transactions            Buchungen (F `/transactions`; TX_FILTER_PARAMS)
 *       /transactions/$transactionId        (F `/transactions/$transactionId`)
 *       /transactions/$transactionId/edit   (F `/transactions/$transactionId/edit`)
 *       /new                     Erfassen (F `/new`)
 *       /plan                    Fixkosten (F `/plan`)
 *       /categories              Kategorien (F `/categories`)
 * F's `/household` is the core's `/households` (Gruppen) plus the participants section on
 * `/settings`; F's `/settings` is the core's Profil.
 *
 * SCREENS ARE CODE-SPLIT WITH `lazyRouteComponent` (R gotcha: a hand-rolled lazy wrapper —
 * F's `lazyPage` — hides `.preload` from the router and kills intent preloading). It is also
 * what keeps this file's static import graph clear of the shell (H/CLAUDE.md "A module owns
 * its layout route and its static import graph stays shell-free"): the screens import the
 * module `PageHeader`, which imports `PhoneHeaderRow` from the layout components, which reach
 * the registry (`@/modules`). So: never a static screen import, never an import from the
 * layout components, never the module registry in this file. The gate is lazy too.
 *
 * F's screens are NAMED exports (F's `lazyPage({ exportNames })`); each route names its export.
 */
import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { moduleLayoutComponent } from "@/modules/layout";
import { householdScopedRoute, pick } from "@/route-roots";
import type { TransactionUrlFilters } from "./features/transactions/components/TransactionFilters";

/* -------------------------------------------------------------------------- */
/* search params                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The transaction list's filter/search state. A single constant because
 * `pick()` drops anything not listed here — a new filter needs a line in
 * this array (and in `TransactionFilters.tsx`, `WEB-TX`).
 */
export const TX_FILTER_PARAMS = [
  "from",
  "to",
  "kind",
  "categoryId",
  "tagIds",
  "origin",
  "q",
  "sort",
] as const satisfies readonly (keyof TransactionUrlFilters | "q")[];

/* -------------------------------------------------------------------------- */
/* module layout + participant gate                                           */
/* -------------------------------------------------------------------------- */

/**
 * The module's layout route at its base path (SPEC §2 `WebModule.route`). Its component is
 * the module-enabled guard: a household without finance is sent Home with a toast before any
 * finance chunk loads (SPEC §5).
 */
export const financeLayoutRoute = createRoute({
  getParentRoute: () => householdScopedRoute,
  path: "/finance",
  component: moduleLayoutComponent("finance"),
});

/**
 * Pathless: every finance screen sits behind the participant gate (decision 3). A layout route,
 * not a wrapper around each screen, so the screens keep their `.preload`.
 */
const financeGateRoute = createRoute({
  getParentRoute: () => financeLayoutRoute,
  id: "participant-gate",
  component: lazyRouteComponent(() => import("./features/participants/FinanceGate")),
});

/* -------------------------------------------------------------------------- */
/* screens                                                                    */
/* -------------------------------------------------------------------------- */

const overviewRoute = createRoute({
  getParentRoute: () => financeGateRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./features/overview/OverviewPage"), "OverviewPage"),
});

const transactionsRoute = createRoute({
  getParentRoute: () => financeGateRoute,
  path: "transactions",
  validateSearch: (search: Record<string, unknown>) => pick(search, TX_FILTER_PARAMS),
  component: lazyRouteComponent(() => import("./features/transactions/TransactionsPage"), "TransactionsPage"),
});

const transactionDetailRoute = createRoute({
  getParentRoute: () => financeGateRoute,
  path: "transactions/$transactionId",
  component: lazyRouteComponent(
    () => import("./features/transactions/TransactionDetailPage"),
    "TransactionDetailPage",
  ),
});

const transactionEditRoute = createRoute({
  getParentRoute: () => financeGateRoute,
  path: "transactions/$transactionId/edit",
  component: lazyRouteComponent(
    () => import("./features/transactions/EditTransactionPage"),
    "EditTransactionPage",
  ),
});

const newTransactionRoute = createRoute({
  getParentRoute: () => financeGateRoute,
  path: "new",
  component: lazyRouteComponent(
    () => import("./features/transactions/NewTransactionPage"),
    "NewTransactionPage",
  ),
});

const planRoute = createRoute({
  getParentRoute: () => financeGateRoute,
  path: "plan",
  component: lazyRouteComponent(() => import("./features/plan/PlanPage"), "PlanPage"),
});

const categoriesRoute = createRoute({
  getParentRoute: () => financeGateRoute,
  path: "categories",
  component: lazyRouteComponent(() => import("./features/categories/CategoriesPage"), "CategoriesPage"),
});

/* -------------------------------------------------------------------------- */
/* tree                                                                       */
/* -------------------------------------------------------------------------- */

/** The module's layout route with the gate and its children: the manifest's `route` (SPEC §2). */
export const financeRouteTree = financeLayoutRoute.addChildren([
  financeGateRoute.addChildren([
    overviewRoute,
    transactionsRoute,
    transactionDetailRoute,
    transactionEditRoute,
    newTransactionRoute,
    planRoute,
    categoriesRoute,
  ]),
]);
