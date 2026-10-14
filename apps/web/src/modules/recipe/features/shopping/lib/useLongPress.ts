/**
 * Long press as a bundle of pointer handlers.
 *
 * The shopping tiles have exactly one visible affordance — tap to check off — so the
 * secondary actions (details, edit, remove) hang off a press-and-hold. Four details
 * make that safe on a phone:
 *
 *  1. **A move cancels it.** A press that turns into a scroll must not open anything,
 *     so the timer is dropped as soon as the pointer travels more than a few pixels.
 *     `pointercancel` (which the browser fires once it claims the gesture for panning)
 *     drops it too.
 *  2. **The click that follows is swallowed.** A long press ends in a `pointerup`, and
 *     the browser still dispatches a `click`. Without `consume()` in the click handler
 *     the item would be checked off the moment the detail sheet opened.
 *  3. **`contextmenu` is prevented, and doubles as the second trigger.** Left alone it
 *     is iOS's text-selection callout and Android's selection menu over the card. It is
 *     also what a desktop right-click and the keyboard menu key emit, so it opens the
 *     same sheet — but only if the timer has not already fired, or Android would open
 *     it twice.
 *  4. **The "did fire" flag resets on the next press**, not on release. If the sheet
 *     steals the `pointerup` (its overlay is on top by then) no click ever arrives, and
 *     a flag cleared on release would swallow the *next* tap instead.
 */
import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

/** Long enough not to fire on a deliberate tap, short enough to feel like a press. */
export const LONG_PRESS_MS = 450;

/** Slop for a finger that is not perfectly still. Beyond this it is a scroll. */
const MOVE_TOLERANCE_PX = 12;

export interface LongPressHandlers {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
}

export interface UseLongPress {
  /** Spread onto the pressable element. */
  handlers: LongPressHandlers;
  /**
   * True once for the click that followed a long press, and false otherwise. Call it
   * FIRST in the element's `onClick` and bail out when it returns true.
   */
  consume: () => boolean;
}

export function useLongPress(onLongPress: () => void, delay = LONG_PRESS_MS): UseLongPress {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const handlers: LongPressHandlers = {
    onPointerDown: (event) => {
      // A secondary mouse button gets `contextmenu` below; no timer for it.
      if (event.pointerType === "mouse" && event.button !== 0) return;
      cancel();
      fired.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        origin.current = null;
        fired.current = true;
        onLongPress();
      }, delay);
    },
    onPointerMove: (event) => {
      const start = origin.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (event) => {
      event.preventDefault();
      if (fired.current) return;
      cancel();
      fired.current = true;
      onLongPress();
    },
  };

  return {
    handlers,
    consume: () => {
      if (!fired.current) return false;
      fired.current = false;
      return true;
    },
  };
}
