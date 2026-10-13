/**
 * The module layout route's component (SPEC D2, §2, §5; plan m1-core §1 decision 8).
 *
 * `router.tsx` creates one layout route per `WEB_MODULES` entry at its `basePath` and gives
 * it `moduleLayoutComponent(module.id)` as its component — never an inline component and
 * never a wrapper around a lazy screen (that would hide `.preload` from the router, R gotcha
 * "SCREENS ARE CODE-SPLIT WITH `lazyRouteComponent`").
 *
 * Imports `RequireModule` from `@/lib/session` and NEVER the registry (`@/modules`): the
 * manifests import screens, the screens import the session layer, and a registry import here
 * would close a cycle. `RequireModule`'s decision is the pure `moduleGuard` of `./enabled`.
 */
import { Outlet } from "@tanstack/react-router";
import type { ModuleId } from "@toon/shared";
import type { ReactElement } from "react";
import { RequireModule } from "@/lib/session";

/** The component of every module's layout route (SPEC D2, §5): the guard sits ABOVE the module's
 *  lazy screens, so a disabled module redirects Home before any module chunk loads. */
export function moduleLayoutComponent(moduleId: ModuleId): () => ReactElement {
  return function ModuleLayout() {
    return (
      <RequireModule moduleId={moduleId}>
        <Outlet />
      </RequireModule>
    );
  };
}
