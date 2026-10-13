/**
 * "Is there work on screen that a reload would throw away?"
 *
 * One counter, module-level, so the answer is available OUTSIDE React — the
 * service-worker update policy in ./pwa.ts needs it in an event handler, not in a
 * render. A counter rather than a boolean because two screens can be dirty at once
 * (a recipe form behind an open dialog), and the last one to finish must not clear
 * the flag for the other.
 *
 * The only reader today is the update policy: an app update reloads the document, so
 * it waits while this is true and the UpdateBanner asks instead. Deliberately NOT a
 * general "block everything" flag — navigation blocking is the router's `useBlocker`
 * (see features/recipes/lib/nav.tsx), which registers here so the two never disagree.
 *
 * Queued shopping-list mutations are NOT unsaved work: they live in IndexedDB and are
 * replayed after a reload (lib/persist.ts), and their `mutationId` makes a double
 * delivery a no-op. Only in-memory edits count.
 */
import { useEffect } from "react";

let claims = 0;
const listeners = new Set<() => void>();

/** True while at least one screen holds unsaved in-memory edits. */
export function hasUnsavedWork(): boolean {
  return claims > 0;
}

/** Notified whenever the answer to {@link hasUnsavedWork} changes. */
export function subscribeUnsavedWork(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Claims "I have unsaved edits" for as long as the caller holds the handle. Returns the
 * release function; calling it twice is harmless.
 */
export function claimUnsavedWork(): () => void {
  claims += 1;
  if (claims === 1) emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims -= 1;
    if (claims === 0) emit();
  };
}

/**
 * Registers `dirty` for the lifetime of the component. Called by
 * `useNavigationGuard`, so every screen that already blocks navigation on unsaved
 * changes also holds back an automatic reload — no screen has to know this exists.
 */
export function useUnsavedWork(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    return claimUnsavedWork();
  }, [dirty]);
}

/** Test seam: drops every claim and listener. */
export function resetUnsavedWork(): void {
  claims = 0;
  listeners.clear();
}
