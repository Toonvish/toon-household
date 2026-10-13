/**
 * Viewport media queries as React state.
 *
 * Tailwind handles almost everything responsive here, and it should: a CSS
 * breakpoint costs nothing and cannot be wrong. This exists for the cases where
 * the two layouts are DIFFERENT MARKUP rather than different styling — the recipe
 * list is one (a compact row on a phone, a card in the desktop grid). Rendering
 * both and hiding one with `sm:hidden` would be the cheaper-looking answer and is
 * a trap: a `display: none` `<img>` is still fetched, so every recipe would load
 * its image twice.
 */
import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's `sm`. Below it there is one column and no room for a card. */
export const SM_QUERY = "(min-width: 40rem)";

/** Subscribes to a media query and re-renders when it flips. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === "undefined") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onStoreChange);
      return () => list.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => (typeof window === "undefined" ? false : window.matchMedia(query).matches),
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * False on a phone in portrait, true from Tailwind's `sm` up.
 *
 * Named for the layout question it answers ("is there room for cards side by
 * side?") rather than for a device, because that is what the callers branch on.
 */
export function useIsWideViewport(): boolean {
  return useMediaQuery(SM_QUERY);
}
