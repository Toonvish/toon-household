/**
 * Debounced autosave for the draft review screen.
 *
 * A phone interruption (call, app switch, tab discard) must never lose OCR
 * corrections, so besides the ~1s debounce we force a save when the page goes
 * to the background (`visibilitychange` / `pagehide`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { INTL_LOCALE, type ParsedRecipe } from "@toon/shared";
import { useLocale, useT } from "@/lib/i18n";
import { useUnsavedWork } from "@/lib/unsavedWork";
import { isSameParsedRecipe, normalizeParsedRecipe } from "./draftEdit";
import { describeError, type ImportErrorText } from "./importApi";
import { resolveImportErrorText } from "./importErrorText";
import { useSaveDraft } from "./queries";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface AutosaveResult {
  state: SaveState;
  /** Localised label for the indicator next to the title. */
  label: string;
  errorHint?: string;
  lastSavedAt?: Date;
  /** Save immediately (used by "Speichern" and by retry). */
  saveNow: () => Promise<boolean>;
}

export interface AutosaveOptions {
  householdId: string | undefined;
  draftId: string | undefined;
  value: ParsedRecipe | undefined;
  /** Server state to compare against; pass the freshly loaded draft's parsed. */
  baseline: ParsedRecipe | undefined;
  enabled?: boolean;
  delayMs?: number;
}

export function useDraftAutosave(options: AutosaveOptions): AutosaveResult {
  const { householdId, draftId, value, baseline, enabled = true, delayMs = 1000 } = options;
  const t = useT();
  const locale = useLocale();
  const save = useSaveDraft();
  // useMutation returns a fresh object every render; keeping it in a ref stops the
  // debounce timer from being reset by unrelated re-renders.
  const saveRef = useRef(save);
  saveRef.current = save;
  const [state, setState] = useState<SaveState>("idle");
  /*
    The UNRENDERED hint, not a string: a save error can sit on screen for as long
    as the review page is open, so storing translated copy here would leave a
    stale sentence behind after a language switch. It is rendered on the way out,
    below, where `t` is current.
  */
  const [errorText, setErrorText] = useState<ImportErrorText | undefined>(undefined);
  const [lastSavedAt, setLastSavedAt] = useState<Date | undefined>(undefined);

  const savedRef = useRef<ParsedRecipe | undefined>(baseline);
  const valueRef = useRef<ParsedRecipe | undefined>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlightRef = useRef<Promise<boolean> | undefined>(undefined);
  // Lets the in-flight branch below re-enter the LATEST runSave without listing
  // itself as its own dependency.
  const runSaveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));

  valueRef.current = value;

  // A fresh server payload becomes the new baseline (e.g. after a refetch).
  useEffect(() => {
    if (baseline !== undefined && savedRef.current === undefined) savedRef.current = baseline;
  }, [baseline]);

  const runSave = useCallback(async (): Promise<boolean> => {
    const current = valueRef.current;
    if (householdId === undefined || draftId === undefined || current === undefined) return false;
    const normalized = normalizeParsedRecipe(current);
    const previous = savedRef.current;
    if (previous !== undefined && isSameParsedRecipe(normalized, normalizeParsedRecipe(previous))) {
      setState((old) => (old === "error" ? "error" : old === "idle" ? "idle" : "saved"));
      return true;
    }
    /*
      A save is already on the wire, and it carries the value as it looked when it
      LEFT — not `current`. Returning its promise (which this used to do) reported
      somebody else's success for an edit that was never sent: the request resolves,
      `savedRef` moves to the OLDER payload, the indicator says "saved" and
      `useUnsavedWork` goes quiet, so a pending PWA update is free to reload over the
      edit. `value` is a `useState` value in ImportReviewPage, so its identity does not
      change on that re-render either and the debounce effect never reschedules.

      So chain instead: wait for the in-flight request, then run again. The equality
      check at the top of this function is the terminator — once the server holds the
      current value the follow-up returns immediately without a request.
    */
    if (inFlightRef.current !== undefined) {
      return inFlightRef.current.then(() => runSaveRef.current());
    }

    setState("saving");
    setErrorText(undefined);
    const promise = (async () => {
      try {
        const draft = await saveRef.current.mutateAsync({ householdId, draftId, parsed: normalized });
        savedRef.current = draft.parsed ?? normalized;
        setLastSavedAt(new Date());
        setState("saved");
        return true;
      } catch (error) {
        setErrorText(describeError(error).hint);
        setState("error");
        return false;
      } finally {
        inFlightRef.current = undefined;
      }
    })();
    inFlightRef.current = promise;
    return promise;
  }, [draftId, householdId]);

  runSaveRef.current = runSave;

  // debounce
  useEffect(() => {
    if (!enabled || value === undefined || householdId === undefined || draftId === undefined) return;
    const previous = savedRef.current;
    if (previous !== undefined && isSameParsedRecipe(normalizeParsedRecipe(value), normalizeParsedRecipe(previous))) {
      return;
    }
    setState((old) => (old === "saving" ? old : "dirty"));
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void runSave();
    }, delayMs);
    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
  }, [value, enabled, delayMs, householdId, draftId, runSave]);

  // flush when the app goes to the background
  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      if (document.visibilityState === "hidden") void runSave();
    };
    const onPageHide = () => {
      void runSave();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [enabled, runSave]);

  // An app update reloads the document, which would drop edits the debounce has not
  // flushed yet (and a failed save has nowhere else to live). Registering the state here
  // means the update waits and the UpdateBanner asks instead — see lib/pwa.ts.
  useUnsavedWork(state === "dirty" || state === "saving" || state === "error");

  const label =
    state === "saving"
      ? t("recipe.import.autosave.saving")
      : state === "dirty"
        ? t("recipe.import.autosave.dirty")
        : state === "saved"
          ? lastSavedAt === undefined
            ? t("recipe.import.autosave.saved")
            : t("recipe.import.autosave.savedAt", {
                time: new Intl.DateTimeFormat(INTL_LOCALE[locale], { hour: "2-digit", minute: "2-digit" }).format(
                  lastSavedAt,
                ),
              })
          : state === "error"
            ? t("recipe.import.autosave.error")
            : t("recipe.import.autosave.idle");

  const errorHint = errorText === undefined ? undefined : resolveImportErrorText(t, errorText);

  return { state, label, errorHint, lastSavedAt, saveNow: runSave };
}
