/**
 * Router helpers shared by core screens and module screens.
 *
 * TanStack Router types `Link.to` and `navigate({to})` against the generated route
 * tree, which lives in the shell agent's router module. These thin wrappers keep the
 * feature code decoupled from that generic type so a route rename never breaks a
 * hundred call sites.
 */
import type { ComponentType, ReactNode } from "react";
import { Link, useBlocker, useNavigate, useParams } from "@tanstack/react-router";
import { useUnsavedWork } from "@/lib/unsavedWork";

type LooseProps = Record<string, unknown>;
const LooseLink = Link as unknown as ComponentType<LooseProps>;

export interface AppLinkProps {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string | number | boolean | undefined>;
  className?: string;
  title?: string;
  replace?: boolean;
  children: ReactNode;
  "aria-label"?: string;
  "aria-current"?: "page" | undefined;
  onClick?: () => void;
}

/** `<Link>` with a plain `string` path — see the module comment. */
export function AppLink({ to, params, search, children, ...rest }: AppLinkProps) {
  return (
    <LooseLink to={to} params={params} search={search} {...rest}>
      {children}
    </LooseLink>
  );
}

export interface NavigateOptions {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string | number | boolean | undefined>;
  replace?: boolean;
}

export type AppNavigate = (options: NavigateOptions) => void;

/** `useNavigate()` accepting a plain `string` path. */
export function useAppNavigate(): AppNavigate {
  const navigate = useNavigate() as unknown as (options: LooseProps) => unknown;
  return (options: NavigateOptions) => {
    void navigate({
      to: options.to,
      params: options.params,
      search: options.search,
      replace: options.replace,
    });
  };
}

/** Route params without needing the route id (`strict: false`). */
export function useRouteParams(): Record<string, string | undefined> {
  const params = useParams({ strict: false }) as unknown as Record<string, string | undefined>;
  return params ?? {};
}

/** Reads one route param, or undefined. */
export function useRouteParam(name: string): string | undefined {
  return useRouteParams()[name];
}

/** State of a blocked in-app navigation. */
export interface NavigationGuard {
  blocked: boolean;
  /** Continue to the target the user tried to reach. */
  proceed: () => void;
  /** Stay on the current screen. */
  reset: () => void;
}

/**
 * Blocks in-app navigation (and the browser's own unload prompt) while `dirty` is true,
 * so an unsaved recipe form can ask for confirmation. The generic `useBlocker` types are
 * bound to the router's route tree, hence the narrow local typing.
 *
 * It also registers the same flag with {@link useUnsavedWork}, because a service-worker
 * update reloads the document — which is a navigation the router cannot block. Doing it
 * here means every existing caller is covered without knowing about it.
 */
export function useNavigationGuard(dirty: boolean): NavigationGuard {
  useUnsavedWork(dirty);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
    disabled: !dirty,
  }) as unknown as {
    status: "blocked" | "idle";
    proceed?: () => void;
    reset?: () => void;
  };

  return {
    blocked: blocker.status === "blocked",
    proceed: () => blocker.proceed?.(),
    reset: () => blocker.reset?.(),
  };
}
