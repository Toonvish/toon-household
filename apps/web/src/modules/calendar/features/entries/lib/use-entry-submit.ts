/**
 * The submit of Neu and Bearbeiten (design §4.5; plan m8 P6, P7, P11): decode the draft with the shared create
 * schema first (a refusal shows at its field, worded as the server words it), send it, answer a car conflict with
 * the notice and its "Trotzdem buchen" (the same body again with `allowConflict: true`), put a server 422 on its
 * fields and anything else in a toast. Navigation happens only after the dirty flag is down, so the unsaved-input
 * guard never asks about a saved form.
 */
import { CreateCalendarEntryRequestSchema, type CalendarCarConflict, type CalendarEntry } from "@toon/shared";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui";
import { useAppNavigate, useNavigationGuard } from "@/lib/nav";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { isApiError } from "@/modules/calendar/lib/api";
import { carConflicts, toCreateBody, type EntryFormState } from "./form";

export interface EntryEditor {
  state: EntryFormState | null;
  setState: (next: EntryFormState) => void;
  /** Sets the first draft without marking the form dirty (Bearbeiten, once the series has loaded). */
  initialise: (state: EntryFormState) => void;
  errors: FieldErrors;
  conflicts: CalendarCarConflict[] | null;
  guard: ReturnType<typeof useNavigationGuard>;
  /** Validates and sends; `allowConflict` is the "Trotzdem buchen" retry. */
  submit: (allowConflict: boolean) => void;
}

export function useEntryEditor({
  initial,
  pending,
  skipDraftCheck = false,
  send,
  successMessage,
  destination,
}: {
  initial: EntryFormState | null;
  pending: boolean;
  /** An imported waste entry has no title to check: only its note and assignees are sent (plan m8 P8). */
  skipDraftCheck?: boolean;
  /** Sends the checked draft (the page maps it to its request body). */
  send: (
    draft: { state: EntryFormState; allowConflict: boolean },
    callbacks: { onSuccess: (entry: CalendarEntry) => void; onError: (error: unknown) => void },
  ) => void;
  /** The toast after a save. */
  successMessage: string;
  /** Where a saved entry goes. */
  destination: (entry: CalendarEntry) => { to: string; params?: Record<string, string>; search?: Record<string, string | undefined> };
}): EntryEditor {
  const toast = useToast();
  const navigate = useAppNavigate();
  const [state, setRawState] = useState<EntryFormState | null>(initial);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflicts, setConflicts] = useState<CalendarCarConflict[] | null>(null);
  const [saved, setSaved] = useState<CalendarEntry | null>(null);
  const guard = useNavigationGuard(dirty && !pending);

  useEffect(() => {
    if (saved === null || dirty) return;
    navigate({ ...destination(saved), replace: true });
    // `destination` and `navigate` are stable enough for a one-shot redirect after the save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, dirty]);

  function setState(next: EntryFormState) {
    setRawState(next);
    setDirty(true);
    setConflicts(null);
  }

  function submit(allowConflict: boolean) {
    if (state === null) return;
    if (!skipDraftCheck) {
      const result = validate(CreateCalendarEntryRequestSchema, toCreateBody(state));
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
    }
    setErrors({});
    send({ state, allowConflict }, {
      onSuccess: (entry) => {
        toast.success(successMessage);
        setConflicts(null);
        setDirty(false);
        setSaved(entry);
      },
      onError: (error) => {
        const found = carConflicts(error);
        if (found !== null) {
          setConflicts(found);
          return;
        }
        if (isApiError(error) && error.code === "validation_failed") {
          setErrors(apiFieldErrors(error));
          return;
        }
        toast.fromError(error);
      },
    });
  }

  return { state, setState, initialise: setRawState, errors, conflicts, guard, submit };
}
