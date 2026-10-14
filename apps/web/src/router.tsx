/**
 * Code-based TanStack Router tree (toon-recipe's `router.tsx`, re-rooted for the
 * household shell — SPEC D6, §2, §5).
 *
 * Route map:
 *   root                  SessionProvider + Outlet; notFound -> NotFoundPage
 *     public              /login  /register  /oauth/callback  /invite/$token
 *                         /forgot-password  /reset-password/$token  /verify-email/$token
 *     app (pathless)      RequireAuth + AppShell + Outlet (attached here, see AppLayout)
 *       /households  /households/$householdId  /settings
 *                         session only: how a user WITHOUT a household gets one
 *       household-scoped (pathless)  RequireActiveHousehold
 *         /               Home (module-less)
 *         /<module>       one layout route per WEB_MODULES entry: `module.route`, owned and
 *                         built by the module (`modules/<id>/routes.tsx`, component
 *                         `moduleLayoutComponent(id)`, parent `householdScopedRoute`)
 *                         /recipe/…  the recipe module (M2), incl. the `/recipe/search`
 *                         redirect; /finance/…  the finance module (M3)
 *
 * `rootRoute`, `appRoute`, `householdScopedRoute` and the `pick` helper live in
 * `route-roots.tsx` (plan m2-recipe-module §1 decisions 10 and 15) so a module's route
 * tree can name its parent without importing this file, which imports the registry.
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
import { Outlet, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
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
import { RequireAuth } from "@/lib/session";
import { WEB_MODULES } from "@/modules";
import { appRoute, householdScopedRoute, pick, rootRoute } from "@/route-roots";

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

/**
 * The shell is attached HERE, not in `route-roots.tsx` (plan m2-recipe-module §1
 * decision 15): `AppShell` reaches the registry (`BottomTabBar` → `use-nav-items` →
 * `@/modules`), and the registry's manifests import their route trees, whose parent
 * lives in `route-roots.tsx`. Keeping the shell out of that file keeps every manifest's
 * static import graph free of the registry, so importing a manifest first (its tests do)
 * cannot hit a TDZ `ReferenceError`. `Route.update` (router-core 1.171.28) merges the
 * option into the existing instance, so every child's `getParentRoute()` still returns
 * this same `appRoute`; it runs at module scope, before `createRouter` below.
 */
appRoute.update({ component: AppLayout });

const homeRoute = createRoute({
  getParentRoute: () => householdScopedRoute,
  path: "/",
  component: lazyRouteComponent(() => import("@/core/features/home/HomePage")),
});

/**
 * One layout route per module at its `basePath` (SPEC §2): `module.route`, built by the
 * module itself in its `routes.tsx` with `getParentRoute: () => householdScopedRoute`
 * (from `route-roots.tsx`) and `component: moduleLayoutComponent(module.id)`, its
 * children attached with `addChildren`; the first child is the module home.
 *
 * The module-enabled guard sits on that layout (`modules/layout.tsx`, `<RequireModule
 * moduleId><Outlet/></RequireModule>`), so a disabled module redirects to Home with a
 * toast (SPEC §5) before any module chunk loads — never as a wrapper around a lazy
 * screen, which would hide `.preload` from the router. `modules/layout.test.tsx` pins
 * the factory; `modules/enabled.test.ts` pins the decision.
 *
 * TYPE NOTE. `WEB_MODULES` is `[recipeModule] as const satisfies readonly WebModule[]`
 * and each manifest is literal-typed (`satisfies WebModule<id>`, no annotation), so the
 * mapped tuple below carries the concrete route types and the registered tree is STRICT:
 * a raw `<Link to="/recipe/nope">` fails `tsc` (pinned by an `@ts-expect-error` in
 * `modules/recipe/manifest.test.ts`). Recipe screens navigate through the string-typed
 * `AppLink` / `useAppNavigate` (`@/lib/nav`), which the tree does not check — the
 * plan's `LINKS` grep does. Nav items keep their own `NavPath` union (nav-items.ts).
 */
const moduleRoutes = WEB_MODULES.map((module) => module.route);

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
