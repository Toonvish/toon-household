/**
 * Router seam. The shell registers the code-based routes, so this feature only
 * navigates by plain path strings (TanStack Router resolves those at runtime)
 * instead of depending on generated route ids that do not exist yet.
 *
 * Paths used: `/recipe/import`, `/recipe/import/<draftId>`, `/recipe/recipes/<recipeId>`.
 */
import { useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { useGoTo } from "@/lib/navigation";

export interface ImportNavigation {
  toImport: (options?: { replace?: boolean }) => void;
  toDraft: (draftId: string, options?: { replace?: boolean }) => void;
  toRecipe: (recipeId: string, options?: { replace?: boolean }) => void;
}

export function useImportNavigation(): ImportNavigation {
  const goTo = useGoTo();

  const go = useCallback(
    (to: string, replace?: boolean) => {
      try {
        goTo(to, { replace: replace === true });
      } catch {
        // A path the router does not know must not dead-end the user.
        window.location.assign(to);
      }
    },
    [goTo],
  );

  return {
    toImport: (options) => go("/recipe/import", options?.replace),
    toDraft: (draftId, options) => go(`/recipe/import/${encodeURIComponent(draftId)}`, options?.replace),
    toRecipe: (recipeId, options) => go(`/recipe/recipes/${encodeURIComponent(recipeId)}`, options?.replace),
  };
}

/**
 * Reads the draft id from the route. Tolerates the param being called `draftId`
 * or `id`, and falls back to the last path segment so the screen also works when
 * it is mounted directly.
 */
export function useDraftIdFromRoute(explicit?: string): string | undefined {
  let params: Record<string, string | undefined> = {};
  try {
    params = useParams({ strict: false }) as unknown as Record<string, string | undefined>;
  } catch {
    params = {};
  }
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  const fromParams = params.draftId ?? params.id;
  if (typeof fromParams === "string" && fromParams.length > 0) return fromParams;
  if (typeof window === "undefined") return undefined;
  const segments = window.location.pathname.split("/").filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1];
  if (last === undefined || last === "import") return undefined;
  return decodeURIComponent(last);
}
