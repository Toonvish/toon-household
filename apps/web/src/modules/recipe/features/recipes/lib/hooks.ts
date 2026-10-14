/**
 * Small React hooks used by the recipe/household/collection/tag features.
 * All browser APIs are feature-detected and degrade silently.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Debounces a rapidly changing value (search box). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/* ----------------------------- checked steps ------------------------------ */

const STEP_STORAGE_PREFIX = "toon:steps:";

function readCheckedSteps(recipeId: string): string[] {
  try {
    const raw = window.sessionStorage.getItem(`${STEP_STORAGE_PREFIX}${recipeId}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export interface CheckedSteps {
  isDone: (stepId: string) => boolean;
  toggle: (stepId: string) => void;
  reset: () => void;
  doneCount: number;
}

/**
 * "Erledigt" state for recipe steps. Persisted in `sessionStorage` so it survives
 * navigating away and back inside the same browser session (and is gone on the next
 * one, which is what a cook wants).
 */
export function useCheckedSteps(recipeId: string | undefined): CheckedSteps {
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    setDone(recipeId ? readCheckedSteps(recipeId) : []);
  }, [recipeId]);

  const persist = useCallback(
    (next: string[]) => {
      setDone(next);
      if (!recipeId) return;
      try {
        window.sessionStorage.setItem(`${STEP_STORAGE_PREFIX}${recipeId}`, JSON.stringify(next));
      } catch {
        /* storage full or blocked — the in-memory state still works */
      }
    },
    [recipeId],
  );

  const toggle = useCallback(
    (stepId: string) => {
      persist(done.includes(stepId) ? done.filter((id) => id !== stepId) : [...done, stepId]);
    },
    [done, persist],
  );

  const reset = useCallback(() => persist([]), [persist]);

  return {
    isDone: (stepId: string) => done.includes(stepId),
    toggle,
    reset,
    doneCount: done.length,
  };
}

/* ------------------------------- wake lock -------------------------------- */

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
}

interface WakeLockLike {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | undefined {
  const candidate = (navigator as unknown as { wakeLock?: unknown }).wakeLock;
  if (candidate && typeof (candidate as WakeLockLike).request === "function") {
    return candidate as WakeLockLike;
  }
  return undefined;
}

/**
 * Keeps the screen awake while `active` is true (Cook Mode). Feature-detected:
 * on browsers without the Screen Wake Lock API nothing happens and no error surfaces.
 * Re-acquires the lock when the tab becomes visible again.
 */
export function useWakeLock(active: boolean): { supported: boolean; held: boolean } {
  const sentinel = useRef<WakeLockSentinelLike | null>(null);
  const [held, setHeld] = useState(false);
  const supported = typeof navigator !== "undefined" && wakeLockApi() !== undefined;

  useEffect(() => {
    if (!active) return;
    const api = wakeLockApi();
    if (!api) return;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || sentinel.current) return;
      try {
        const lock = await api.request("screen");
        if (cancelled) {
          void lock.release().catch(() => undefined);
          return;
        }
        sentinel.current = lock;
        setHeld(true);
        lock.addEventListener?.("release", () => {
          sentinel.current = null;
          setHeld(false);
        });
      } catch {
        setHeld(false);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const lock = sentinel.current;
      sentinel.current = null;
      setHeld(false);
      if (lock) void lock.release().catch(() => undefined);
    };
  }, [active]);

  return { supported, held };
}

/* ---------------------------- unsaved changes ----------------------------- */

/**
 * Warns before leaving the page (reload/close) while a form is dirty.
 * In-app navigation is guarded by the form's own confirm dialogs.
 */
export function useUnsavedChangesWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

/* ------------------------------ misc helpers ------------------------------ */

/** Stable id generator for client-side list rows (ingredients/steps editors). */
export function localId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `row-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/* ------------------------- list-editor row helpers ------------------------ */
/*
 * Shared by IngredientsEditor and StepsEditor, which are the same editor over a
 * different row type. Only the pure list maths lives here — the `t()` calls that
 * announce each change stay in the components, because a translator key has to be
 * a LITERAL for the placeholder check to mean anything.
 */

/** Replaces one row, returning a new array. */
export function patchRow<T>(rows: readonly T[], index: number, changes: Partial<T>): T[] {
  return rows.map((row, position) => (position === index ? { ...row, ...changes } : row));
}

/**
 * Removes one row, **never leaving the editor empty**: removing the last row
 * yields a fresh blank one instead. An editor with zero rows has nothing to type
 * into and reads as broken, so the last delete is a reset.
 */
export function removeRow<T>(rows: readonly T[], index: number, emptyRow: () => T): T[] {
  const next = rows.filter((_row, position) => position !== index);
  return next.length > 0 ? next : [emptyRow()];
}

/** Target index for a relative move, or undefined when it would leave the list. */
export function moveTargetIndex(
  length: number,
  index: number,
  delta: number,
): number | undefined {
  const target = index + delta;
  return target < 0 || target >= length ? undefined : target;
}

/** Moves an array item, returning a new array. Out-of-range moves are no-ops. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [removed] = next.splice(from, 1);
  if (removed === undefined) return [...items];
  next.splice(to, 0, removed);
  return next;
}
