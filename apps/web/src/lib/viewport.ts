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
import { useCallback, useRef, useSyncExternalStore } from "react";

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

  // While the page is being PRINTED the browser evaluates every media query against the PAPER
  // width (A4 is ~794 CSS px), so a phone's `(min-width: 40rem)` flips to true mid-print and
  // React swaps the phone markup for the desktop markup in the middle of the snapshot: printing the
  // recipe detail from a 390 px window produced a truncated hybrid (steps 3 to 7 missing; found by
  // printing to PDF in M4-T09). The last value seen on SCREEN is held for the duration of the
  // print, so paper shows the markup the reader was looking at (print.css is written for both).
  const screenValue = useRef<boolean | undefined>(undefined);
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    const matches = window.matchMedia(query).matches;
    if (window.matchMedia("print").matches && screenValue.current !== undefined) return screenValue.current;
    screenValue.current = matches;
    return matches;
  }, [query]);

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
