/**
 * Code-based TanStack Router tree (toon-recipe's `router.tsx`, re-rooted for the
 * household shell — SPEC D6, §2, §5).
 *
 * Route map:
 *   root                  SessionProvider + Outlet; notFound -> NotFoundPage
 *     public              /login  /register  /oauth/callback  /invite/$token
 *                         /forgot-password  /reset-password/$token  /verify-email/$token
 *     app (pathless)      RequireAuth + AppShell + Outlet
 *       /households  /households/$householdId  /settings
 *                         session only: how a user WITHOUT a household gets one
 *       household-scoped (pathless)  RequireActiveHousehold
 *         /               Home (module-less)
 *         /<module>       one layout route per WEB_MODULES entry, component
 *                         `moduleLayoutComponent(module.id)` (RequireModule); the module's
 *                         `routes` are its children (M2 recipe, M3 finance)
 * No `/search` and no recipe routes here: they arrive with the recipe module (M2), under
 * `/recipe`.
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
import { ForgotPasswordPage } from "@/core/features/auth/ForgotPasswordPage";
import { InvitePage } from "@/core/features/auth/InvitePage";
import { LoginPage } from "@/core/features/auth/LoginPage";
import { OAuthCallbackPage } from "@/core/features/auth/OAuthCallbackPage";
import { RegisterPage } from "@/core/features/auth/RegisterPage";
import { ResetPasswordPage } from "@/core/features/auth/ResetPasswordPage";
import { VerifyEmailPage } from "@/core/features/auth/VerifyEmailPage";
import { RequireActiveHousehold, RequireAuth, SessionProvider } from "@/lib/session";
import { WEB_MODULES } from "@/modules";
import { moduleLayoutComponent } from "@/modules/layout";

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Search-param validators return objects with OPTIONAL keys only, so `<Link to="/">`
 * never has to pass a `search` prop.
 */
function pick<Keys extends string>(
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

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

/* -------------------------------------------------------------------------- */
/* public routes                                                              */
/* -------------------------------------------------------------------------- */

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  // `reset=1` comes back from a completed password reset ("bitte neu anmelden").
  validateSearch: (search: Record<string, unknown>) => pick(search, ["next", "error", "reset"]),
  component: LoginPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPasswordPage,
});

/**
 * The token sits in the PATH, not in a query param: `?token=` values end up in
 * `Referer` headers and in hono's request log (`c.req.path` is logged too, but a
 * path segment at least does not travel to third-party assets the page loads).
 */
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password/$token",
  component: ResetPasswordPage,
});

const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email/$token",
  component: VerifyEmailPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  validateSearch: (search: Record<string, unknown>) => pick(search, ["next", "invite"]),
  component: RegisterPage,
});

const oauthCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/oauth/callback",
  validateSearch: (search: Record<string, unknown>) => pick(search, ["next", "error"]),
  component: OAuthCallbackPage,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: InvitePage,
});

/* -------------------------------------------------------------------------- */
/* guarded app shell                                                          */
/* -------------------------------------------------------------------------- */

function AppLayout() {
  return (
    <RequireAuth>
      <AppShell>
        <Outlet />
      </AppShell>
    </RequireAuth>
  );
}

/** Pathless layout route: everything below it requires a session. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppLayout,
});

/**
 * Second pathless layout route: everything below it additionally needs an ACTIVE
 * HOUSEHOLD (Home and every module — the household owns the content).
 *
 * The guard is a layout route rather than a wrapper around each screen because a
 * wrapper is a different component than the lazy one, and `.preload` lives on the
 * lazy component — wrapping it hides that property from the router and kills
 * preloading. `/households`, `/households/$householdId` and `/settings` stay outside:
 * they are how a user WITH no household gets one, so guarding them would deadlock.
 */
const householdScopedRoute = createRoute({
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

const homeRoute = createRoute({
  getParentRoute: () => householdScopedRoute,
  path: "/",
  component: lazyRouteComponent(() => import("@/core/features/home/HomePage")),
});

/**
 * One layout route per module at its `basePath` (SPEC §2): the module's `routes` are
 * its children, the first one being the module home. M1 has no modules, so this maps
 * an empty list. Open for M2: router-core calls each child's `getParentRoute()` at
 * init and requires it to return THIS layout instance, so the first module must give
 * its routes a way to reach it without importing this file (a cycle through
 * `modules/index.ts`) — e.g. the layout moves into a module-owned file the manifest
 * exports, or `routes` becomes a factory taking the parent.
 *
 * The module-enabled guard sits HERE: the component is `moduleLayoutComponent(module.id)`
 * (`modules/layout.tsx`, `<RequireModule moduleId><Outlet/></RequireModule>`), so a
 * disabled module redirects to Home with a toast (SPEC §5) before any module chunk loads —
 * on the layout, never as a wrapper around a lazy screen, which would hide `.preload` from
 * the router. `modules/layout.test.tsx` pins the factory; `modules/enabled.test.ts` pins
 * the decision.
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
    getParentRoute: () => householdScopedRoute,
    path: module.basePath,
    component: moduleLayoutComponent(module.id),
  }).addChildren(module.routes),
);

/* -------------------------------------------------------------------------- */
/* session-only screens                                                       */
/* -------------------------------------------------------------------------- */

const householdsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/households",
  component: lazyRouteComponent(() => import("@/core/features/households/HouseholdsPage")),
});

const householdDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/households/$householdId",
  component: lazyRouteComponent(() => import("@/core/features/households/HouseholdDetailPage")),
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  // `?linked=google` / `?error=…` come back from the OAuth link round-trip.
  validateSearch: (search: Record<string, unknown>) => pick(search, ["linked", "error"]),
  component: lazyRouteComponent(() => import("@/core/features/settings/SettingsPage")),
});

/* -------------------------------------------------------------------------- */
/* tree + router                                                              */
/* -------------------------------------------------------------------------- */

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  verifyEmailRoute,
  oauthCallbackRoute,
  inviteRoute,
  appRoute.addChildren([
    // Needs an active household.
    householdScopedRoute.addChildren([homeRoute, ...moduleRoutes]),
    // Session only — these are how a user without a household gets one.
    householdsRoute,
    householdDetailRoute,
    settingsRoute,
  ]),
]);

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
  login: loginRoute,
  register: registerRoute,
  forgotPassword: forgotPasswordRoute,
  resetPassword: resetPasswordRoute,
  verifyEmail: verifyEmailRoute,
  oauthCallback: oauthCallbackRoute,
  invite: inviteRoute,
  app: appRoute,
  householdScoped: householdScopedRoute,
  home: homeRoute,
  households: householdsRoute,
  householdDetail: householdDetailRoute,
  settings: settingsRoute,
} as const;

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
