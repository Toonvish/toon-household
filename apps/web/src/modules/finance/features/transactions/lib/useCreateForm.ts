/**
 * Everything "erfasse eine Buchung" does, minus the frame around it (toon-finance `useCreateForm.ts`
 * at 1715207, M3b decision 10).
 *
 * Two frames render it: the finance quick-add sheet (`QuickAddDialog`, mounted by `FinanceGate`) and
 * the full-page `/finance/new` route. They differ in chrome (a sheet footer versus a sticky "Buchen"
 * bar) and in nothing else, so the validation, the `mutationId` minting, the optimistic clear and the
 * undo toast live here instead of being written twice and drifting. It rides H's ONE create mutation
 * (`useCreateTransactionMutation`, namespace `["toon","finance","tx","create"]`), never a second path.
 *
 * The `mutationId` is minted AT CALL TIME, never inside the mutation function, which reruns verbatim
 * on every offline replay (toon-finance gotchas 9, 10 and 47: the API claims an id once).
 *
 * Each frame holds its OWN instance of this state (toon-finance gotcha 65); `useQuickAddHostedHere`
 * keeps the sheet from opening over `/finance/new`.
 */
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useT, type MessageKey } from "@/lib/i18n";
import { useCurrentUser, useRequiredHouseholdId, useSession } from "@/lib/session";
import { clearField, type FieldErrors } from "@/lib/validation";
import { useOtherParticipant } from "@/modules/finance/lib/participants";
import {
  createEmptyFormState,
  isFormDirty,
  resolvedBookedAtIso,
  type TransactionFormState,
} from "../components/TransactionFormFields";
import { useCreateTransactionMutation, useDeleteTransactionMutation } from "./queries";

/** The two fields a create can fail on, and the catalog key that explains each failure. */
export type CreateFormErrorKeys = Partial<Record<"amountCents" | "description", MessageKey>>;

/**
 * Pure validation of the create form: no amount, a zero amount (the ledger refuses `0`)
 * and a blank description. Returns catalog KEYS so the caller translates them with the viewer's `t`.
 */
export function validateCreateForm(state: TransactionFormState): CreateFormErrorKeys {
  const errors: CreateFormErrorKeys = {};
  if (state.amountCents === null) errors.amountCents = "finance.transactions.form.amountInvalid";
  else if (state.amountCents === 0) errors.amountCents = "finance.transactions.form.amountZero";
  if (state.description.trim().length === 0) errors.description = "finance.transactions.form.descriptionRequired";
  return errors;
}

/** `true` while the form holds something a reload would throw away (feeds `useUnsavedWork`). */
export function isCreateFormDirty(state: TransactionFormState): boolean {
  return isFormDirty(state);
}

/** The state after a booking: everything cleared, the KIND kept (receipts of one kind arrive in runs). */
export function emptyStateAfterSubmit(state: TransactionFormState): TransactionFormState {
  return createEmptyFormState(state.kind);
}

export interface CreateTransactionForm {
  householdId: string;
  state: TransactionFormState;
  errors: FieldErrors;
  patch: (next: Partial<TransactionFormState>) => void;
  /** Validates, books, and clears the form. `true` when the booking was actually submitted. */
  submit: () => boolean;
  isPending: boolean;
  isDirty: boolean;
  /** `null` while loading, and `null` for a one-person household: the caller shows the invite prompt. */
  otherName: string | null;
  hasOther: boolean;
  isLoadingOther: boolean;
}

export function useCreateTransactionForm(): CreateTransactionForm {
  const t = useT();
  const toast = useToast();
  const householdId = useRequiredHouseholdId();
  const viewer = useCurrentUser();
  const { member: other, isLoading: isLoadingOther } = useOtherParticipant();
  const { isOnline } = useSession();

  const [state, setState] = useState<TransactionFormState>(() => createEmptyFormState());
  const [errors, setErrors] = useState<FieldErrors>({});

  const createMutation = useCreateTransactionMutation();
  const deleteMutation = useDeleteTransactionMutation();

  function patch(next: Partial<TransactionFormState>) {
    setState((current) => ({ ...current, ...next }));
    for (const key of Object.keys(next)) {
      if (key === "amountCents") setErrors((current) => clearField(current, "amountCents"));
      if (key === "description") setErrors((current) => clearField(current, "description"));
    }
  }

  function submit(): boolean {
    if (!other) return false;

    const errorKeys = validateCreateForm(state);
    if (Object.keys(errorKeys).length > 0) {
      const nextErrors: FieldErrors = {};
      if (errorKeys.amountCents) nextErrors.amountCents = t(errorKeys.amountCents);
      if (errorKeys.description) nextErrors.description = t(errorKeys.description);
      setErrors(nextErrors);
      return false;
    }

    const mutationId = crypto.randomUUID();
    const wasOnline = isOnline;

    createMutation.mutate(
      {
        householdId,
        kind: state.kind,
        amountCents: state.amountCents as number,
        description: state.description.trim(),
        categoryId: state.category?.id ?? null,
        tags: state.tags,
        bookedAt: resolvedBookedAtIso(state),
        mutationId,
        optimistic: { viewerId: viewer.id, otherId: other.userId },
      },
      {
        onSuccess: (created) => {
          toast.toast({
            title: t("finance.transactions.toast.created"),
            variant: "success",
            action: {
              label: t("finance.common.undo"),
              onClick: () => {
                deleteMutation.mutate({ householdId, transactionId: created.id, mutationId: crypto.randomUUID() });
              },
            },
          });
        },
        onError: (error) => toast.fromError(error),
      },
    );

    // The form clears IMMEDIATELY: the request itself may still be queued (offline) or in flight,
    // and the screen must not block on it.
    setState(emptyStateAfterSubmit(state));
    setErrors({});
    if (!wasOnline) toast.toast({ title: t("finance.transactions.toast.queued") });
    return true;
  }

  return {
    householdId,
    state,
    errors,
    patch,
    submit,
    isPending: createMutation.isPending,
    isDirty: isCreateFormDirty(state),
    otherName: other?.displayName ?? null,
    hasOther: other !== null,
    isLoadingOther,
  };
}
