/**
 * The one piece of state the finance "Erfassen" sheet needs: is it open, and does a screen already
 * host the capture form?
 *
 * Module-local port of toon-finance's `lib/quick-add.tsx` at 1715207 (M3b decision 10). F mounts the
 * provider in its app shell and opens the sheet from a floating "+" and the sidebar's primary
 * button; H has neither (SPEC D6: Erfassen stays the third phone tab at `/finance/new`, the shell is
 * core and module-neutral), so `FinanceGate` mounts the provider and the host for participants only
 * and the openers are the `n` key and the "Erste Buchung erfassen" action of `/finance/transactions`.
 *
 * The `n` shortcut is bound here, next to the state it flips, so it can never drift from what the
 * sheet advertises ("Esc schliesst" and the like live in the catalog).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface QuickAddApi {
  isOpen: boolean;
  /**
   * `false` while a screen already IS the capture form (`/finance/new`). The two frames share
   * `useCreateTransactionForm` but each frame owns its own INSTANCE of that state, so an opener
   * used on `/finance/new` would lay a second, independent draft over the one being typed into:
   * two amounts, two "Buchen" buttons and no way to tell which is about to be sent (toon-finance
   * gotcha 65, "shared code is not shared state").
   */
  isAvailable: boolean;
  open: () => void;
  close: () => void;
  /** See {@link useQuickAddHostedHere}; returns the release function. */
  claimHost: () => () => void;
}

const QuickAddContext = createContext<QuickAddApi | null>(null);

/**
 * `true` while the keystroke belongs to something the user is typing into: a bare `n` must reach
 * the field, not the sheet. `isContentEditable` covers rich-text hosts; `closest("[role=textbox]")`
 * covers the rest. Structural (no `instanceof HTMLElement`) so a unit test can pass a plain object.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null) return false;
  const element = target as Partial<HTMLElement>;
  if (typeof element.tagName !== "string") return false;
  if (element.isContentEditable === true) return true;
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return typeof element.closest === "function" && element.closest("[role='textbox']") !== null;
}

/** Whether a keydown is the bare `n` shortcut (no modifier), before the typing-target check. */
export function isQuickAddShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): boolean {
  if (event.key !== "n" && event.key !== "N") return false;
  return !event.metaKey && !event.ctrlKey && !event.altKey;
}

/**
 * The host counter's step. A COUNTER, not a boolean: React mounts the incoming screen before it
 * unmounts the outgoing one, so two hosts overlap for a render during a navigation and a boolean
 * would be cleared by the one that is leaving. Never goes below zero.
 */
export function nextHostCount(count: number, delta: 1 | -1): number {
  return Math.max(0, count + delta);
}

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hostCount, setHostCount] = useState(0);
  const isAvailable = hostCount === 0;

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const claimHost = useCallback(() => {
    setHostCount((count) => nextHostCount(count, 1));
    // Navigating to `/finance/new` while the sheet is up would leave both on screen.
    setIsOpen(false);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setHostCount((count) => nextHostCount(count, -1));
    };
  }, []);

  // The `n` listener is bound ONCE and reads the claim through a ref: re-binding it whenever
  // `/finance/new` mounts or unmounts would drop the keystrokes that land in between.
  const availableRef = useRef(isAvailable);
  availableRef.current = isAvailable;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isQuickAddShortcut(event)) return;
      if (isTypingTarget(event.target)) return;
      if (!availableRef.current) return;
      event.preventDefault();
      setIsOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo<QuickAddApi>(
    () => ({ isOpen, isAvailable, open, close, claimHost }),
    [isOpen, isAvailable, open, close, claimHost],
  );
  return <QuickAddContext.Provider value={value}>{children}</QuickAddContext.Provider>;
}

/** Throws outside the provider on purpose: an opener that silently does nothing is the worst failure mode. */
export function useQuickAdd(): QuickAddApi {
  const value = useContext(QuickAddContext);
  if (!value) throw new Error("useQuickAdd must be used inside <QuickAddProvider>");
  return value;
}

/**
 * Claims "this screen already hosts the capture form" for the component's lifetime, so `n` and the
 * other openers stand down instead of opening a second draft on top of this one (`/finance/new`,
 * toon-finance gotcha 65).
 */
export function useQuickAddHostedHere(): void {
  const { claimHost } = useQuickAdd();
  useEffect(() => claimHost(), [claimHost]);
}
