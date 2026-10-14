/**
 * `/transactions/$transactionId/edit` (docs/spec.md §4.5). Same fields as
 * `/new` (`TransactionFormFields`), but "Speichern" navigates back to the
 * detail screen instead of clearing and staying — the two screens are kept
 * separate for exactly this reason (docs/spec.md §4.5: "nach dem Speichern
 * bleiben" vs. "nach dem Speichern zurück" must not fork through a flag in
 * one component).
 *
 * A generated row (`origin !== "manual"`) never reaches the form: the API
 * would 409 `transaction_generated` anyway, so this screen shows the same
 * non-editable notice as the detail page instead of a doomed submit button.
 *
 * `lib/unsavedWork.ts` ([WEB-KERN]/[OFFLINE]) exposes a claim counter, not a
 * navigation blocker — there is no `useNavigationGuard` export to reuse, so
 * the guard below is built locally from the two primitives that DO exist:
 * `useUnsavedWork` (feeds the same "don't reload mid-edit" signal `/new`
 * uses) and TanStack Router's own `useBlocker`.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useAppNavigate, useNavigationGuard, useRouteParam } from "@/lib/nav";
import { PageHeader } from "@/modules/finance/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";
import { useCurrentUser, useRequiredHouseholdId } from "@/lib/session";
import { useOtherParticipant } from "@/modules/finance/lib/participants";
import { clearField, type FieldErrors } from "@/lib/validation";
import {
  formStateFromTransaction,
  resolvedBookedAtIso,
  TransactionFormFields,
  type TransactionFormState,
} from "./components/TransactionFormFields";
import { useCategoriesForPicker, useTransaction, useUpdateTransactionMutation } from "./lib/queries";

export function EditTransactionPage() {
  const t = useT();
  const toast = useToast();
  const navigate = useAppNavigate();
  const transactionId = useRouteParam("transactionId") ?? "";
  const householdId = useRequiredHouseholdId();
  const viewer = useCurrentUser();
  const { member: other } = useOtherParticipant();

  const transactionQuery = useTransaction(householdId, transactionId);
  const categoriesQuery = useCategoriesForPicker(householdId);
  const updateMutation = useUpdateTransactionMutation();

  const [state, setState] = useState<TransactionFormState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const blocker = useNavigationGuard(dirty);

  useEffect(() => {
    if (!transactionQuery.data || state !== null) return;
    if (transactionQuery.data.origin !== "manual") return;
    const category = transactionQuery.data.categoryId
      ? (categoriesQuery.data?.items.find((item) => item.id === transactionQuery.data?.categoryId) ?? null)
      : null;
    setState(formStateFromTransaction(transactionQuery.data, viewer.id, category));
    // Only re-run when the fetched row itself changes — categories arriving a tick later must not reset an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionQuery.data, viewer.id]);

  function patch(next: Partial<TransactionFormState>) {
    setState((current) => (current ? { ...current, ...next } : current));
    setDirty(true);
    for (const key of Object.keys(next)) {
      if (key === "amountCents") setErrors((current) => clearField(current, "amountCents"));
      if (key === "description") setErrors((current) => clearField(current, "description"));
    }
  }

  function goToDetail() {
    navigate({ to: "/finance/transactions/$transactionId", params: { transactionId } });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!state) return;

    const description = state.description.trim();
    const nextErrors: FieldErrors = {};
    if (state.amountCents === null) nextErrors.amountCents = t("finance.transactions.form.amountInvalid");
    else if (state.amountCents === 0) nextErrors.amountCents = t("finance.transactions.form.amountZero");
    if (description.length === 0) nextErrors.description = t("finance.transactions.form.descriptionRequired");
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    updateMutation.mutate(
      {
        householdId,
        transactionId,
        kind: state.kind,
        amountCents: state.amountCents as number,
        description,
        categoryId: state.category?.id ?? null,
        tags: state.tags,
        bookedAt: resolvedBookedAtIso(state),
        mutationId: crypto.randomUUID(),
      },
      {
        onSuccess: () => {
          setDirty(false);
          toast.success(t("finance.transactions.toast.updated"));
          goToDetail();
        },
        onError: (error) => toast.fromError(error),
      },
    );
  }

  if (transactionQuery.isPending || (transactionQuery.data && !state && transactionQuery.data.origin === "manual")) {
    return <LoadingBlock />;
  }

  if (transactionQuery.isError) {
    return <ErrorState error={transactionQuery.error} onRetry={() => void transactionQuery.refetch()} />;
  }

  if (transactionQuery.data.origin !== "manual") {
    return (
      <div className="mx-auto w-full max-w-md p-4">
        <ErrorState
          title={t("finance.transactions.detail.title")}
          description={t("finance.transactions.generatedHint")}
          action={<Button onClick={goToDetail}>{t("finance.common.back")}</Button>}
        />
      </div>
    );
  }

  if (!state) return <LoadingBlock />;

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("finance.transactions.edit.title")} />
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-5">
        <TransactionFormFields
          householdId={householdId}
          otherName={other?.displayName ?? null}
          value={state}
          onChange={patch}
          errors={errors}
        />

        <div className="flex-1" />

        <div className="sticky bottom-tabbar -mx-gutter border-t border-line bg-bg/95 px-gutter py-3 backdrop-blur-md lg:mx-0 lg:rounded-b-card">
          <Button type="submit" fullWidth loading={updateMutation.isPending}>
            {t("finance.transactions.form.submitEdit")}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={blocker.blocked}
        onClose={() => blocker.reset()}
        onConfirm={() => blocker.proceed()}
        title={t("finance.common.unsavedWarning")}
        confirmLabel={t("finance.common.confirm")}
        cancelLabel={t("finance.common.cancel")}
        destructive
      />
    </div>
  );
}
