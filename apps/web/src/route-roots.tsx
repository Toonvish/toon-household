/**
 * The shell-free roots of the route tree (plan m2-recipe-module §1 decisions 10 and 15):
 * `rootRoute`, the pathless `appRoute` (WITHOUT its component) and the pathless
 * `householdScopedRoute`, plus the `pick` / `optionalString` search-param helpers.
 *
 * WHY A SEPARATE FILE. A module owns its layout route (SPEC §2: `WebModule.route`), so
 * its `routes.tsx` needs `householdScopedRoute` as the parent — router-core calls
 * `getParentRoute()` at init and requires that exact instance. If that instance lived in
 * `router.tsx`, the module would import the file that imports the registry
 * (`@/modules`) — a cycle. This file is the parent's home and imports neither the
 * registry nor the shell:
 *
 *  - no `@/modules` (the registry evaluates `WEB_MODULES = [recipeModule]`; importing it
 *    from here would re-enter while a manifest is still evaluating — a TDZ
 *    `ReferenceError` the moment a test imports a manifest first);
 *  - no app shell and no layout barrel (the shell reaches the registry through
 *    `BottomTabBar` → `use-nav-items` → the registry, the same cycle).
 *    `NotFoundPage` is imported as its own file; it imports no layout.
 *
 * `appRoute` therefore has no component here: `router.tsx` attaches `AppLayout`
 * (`RequireAuth` + the app shell) with `appRoute.update({ component: AppLayout })` before
 * the tree is built.
 */
import { Outlet, createRootRoute, createRoute } from "@tanstack/react-router";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { RequireActiveHousehold, SessionProvider } from "@/lib/session";

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Search-param validators return objects with OPTIONAL keys only, so `<Link to="/">`
 * never has to pass a `search` prop.
 */
export function pick<Keys extends string>(
  search: Record<string, unknown>,
  keys: readonly Keys[],
): Partial<Record<Keys, string>> {
  const result: Partial<Record<Keys, string>> = {};
  for (const key of keys) {
    const value = optionalString(search[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* root                                                                       */
/* -------------------------------------------------------------------------- */

function RootLayout() {
  // SessionProvider lives inside the router so a 401 can navigate client-side.
  return (
    <SessionProvider>
      <Outlet />
    </SessionProvider>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

/* -------------------------------------------------------------------------- */
/* guarded app shell                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Pathless layout route: everything below it requires a session. Its component
 * (`AppLayout`: `RequireAuth` + the app shell + `Outlet`) is attached by `router.tsx`
 * (decision 15) — never here, see the file comment.
 */
export const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
});

/**
 * Second pathless layout route: everything below it additionally needs an ACTIVE
 * HOUSEHOLD (Home and every module — the household owns the content). The parent of
 * every module's layout route (`WebModule.route`, SPEC §2).
 *
 * The guard is a layout route rather than a wrapper around each screen because a
 * wrapper is a different component than the lazy one, and `.preload` lives on the
 * lazy component — wrapping it hides that property from the router and kills
 * preloading. `/households`, `/households/$householdId` and `/settings` stay outside:
 * they are how a user WITH no household gets one, so guarding them would deadlock.
 */
export const householdScopedRoute = createRoute({
  getParentRoute: () => appRoute,
  id: "household-scoped",
  component: function HouseholdScopedLayout() {
    return (
      <RequireActiveHousehold>
        <Outlet />
      </RequireActiveHousehold>
    );
  },
});
