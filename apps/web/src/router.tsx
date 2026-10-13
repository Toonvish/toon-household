/**
 * Code-based TanStack Router tree (toon-recipe's `router.tsx`, re-rooted for the
 * household shell — SPEC D6, §2, §5).
 *
 * Route map:
 *   root            notFound -> NotFoundPage
 *   app (pathless)  AppShell + Outlet
 *     /             Home (module-less)
 *     /<module>     one layout route per WEB_MODULES entry; the module's `routes` are
 *                   its children (M2 recipe, M3 finance)
 * No auth guards yet: M1 adds the public auth routes, `SessionProvider` and the
 * `RequireAuth` / active-household layouts.
 *
 * SCREENS ARE CODE-SPLIT WITH `lazyRouteComponent`, not a bare `React.lazy`, and the
 * difference is not cosmetic. The router preloads a route's component by calling
 * `route.options.component.preload()` (router-core `preloadComponent`), which is the
 * property `lazyRouteComponent` attaches and a plain wrapper component does not have —
 * so a hand-rolled lazy wrapper silently turns `defaultPreload: "intent"` below into a
 * no-op. It also gives us the one-shot reload on a missing module chunk, which is the
 * exact failure a service-worker deploy produces when an old document asks for an
 * `assets/Page-<hash>.js` the new precache no longer has.
 *
 * Export every screen as its module's DEFAULT export.
 */
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { LoadingBlock } from "@/components/ui/Spinner";
import { WEB_MODULES } from "@/modules";

/* -------------------------------------------------------------------------- */
/* root                                                                       */
/* -------------------------------------------------------------------------- */

function RootLayout() {
  // M1: SessionProvider wraps this Outlet (inside the router so a 401 can navigate).
  return <Outlet />;
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

/* -------------------------------------------------------------------------- */
/* app shell                                                                  */
/* -------------------------------------------------------------------------- */

function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

/** Pathless layout route: everything below it renders inside the app frame. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: lazyRouteComponent(() => import("@/core/features/home/HomePage")),
});

/**
 * One layout route per module at its `basePath` (SPEC §2): the module's `routes` are
 * its children, the first one being the module home. M0 has no modules, so this maps
 * an empty list. Open for M2: router-core calls each child's `getParentRoute()` at
 * init and requires it to return THIS layout instance, so the first module must give
 * its routes a way to reach it without importing this file (a cycle through
 * `modules/index.ts`) — e.g. the layout moves into a module-owned file the manifest
 * exports, or `routes` becomes a factory taking the parent.
 *
 * M1 puts the module-enabled guard here (a disabled module redirects to Home with a
 * toast, SPEC §5) — on the layout, never as a wrapper around a lazy screen, which would
 * hide `.preload` from the router.
 *
 * TYPE NOTE (measured in M0): because `WEB_MODULES` is `readonly WebModule[]` and
 * `routes` is `AnyRoute[]`, these children make the registered tree loose — `<Link to>`
 * is then unchecked app-wide (`to="/nonexistent"` compiles). M2 should restore the
 * strict tree by keeping the registry literal-typed (`[recipeModule] as const` with
 * concrete route tuples), the same trick `modules/catalogs.ts` uses for `MessageKey`.
 * Nav items do not depend on either state — see `NavPath` in nav-items.ts.
 */
const moduleRoutes = WEB_MODULES.map((module) =>
  createRoute({
    getParentRoute: () => appRoute,
    path: module.basePath,
    component: Outlet,
  }).addChildren(module.routes),
);

/* -------------------------------------------------------------------------- */
/* tree + router                                                              */
/* -------------------------------------------------------------------------- */

const routeTree = rootRoute.addChildren([appRoute.addChildren([homeRoute, ...moduleRoutes])]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadDelay: 80,
  defaultNotFoundComponent: NotFoundPage,
  // Also what puts the Suspense boundary around a match (react-router's `Match`
  // only wraps when a pending element exists), so a lazy chunk has something to
  // fall back to on a cold load, not just during an intent-preloaded navigation.
  defaultPendingComponent: LoadingBlock,
  scrollRestoration: true,
});

export const routes = {
  root: rootRoute,
  app: appRoute,
  home: homeRoute,
} as const;

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
