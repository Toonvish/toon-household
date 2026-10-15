/**
 * `/finance/new` — Erfassen (phone tab 3, SPEC D6), the full-page frame around the same capture form
 * the `QuickAddDialog` sheet shows (docs/spec.md §4.5, toon-finance 1715207).
 *
 * One-handed on a 390px phone: amount first (the numeric keypad covers the lower half of the screen
 * the moment it has focus), the four-kind picker, description, date and category chips, tags, and a
 * sticky "Buchen" bar pinned above the tab bar (`.bottom-tabbar`, never `bottom-0`: toon-finance
 * gotcha 15). Nothing sits behind a "Mehr Details" disclosure any more.
 *
 * Both frames share `useCreateTransactionForm`, so the validation, the `mutationId` minting (AT CALL
 * TIME, never inside the mutation function: gotcha 10), the clear-and-stay behaviour and the undo
 * toast exist exactly once. After booking the user STAYS here: the form clears (kind excepted), a
 * toast confirms it and "Rückgängig" deletes the just-created row.
 */
import type { FormEvent } from "react";
import { PageHeader } from "@/modules/finance/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n";
import { useUnsavedWork } from "@/lib/unsavedWork";
import { useQuickAddHostedHere } from "@/modules/finance/lib/quick-add";
import { InviteSecondPerson } from "./components/InviteSecondPerson";
import { TransactionFormFields } from "./components/TransactionFormFields";
import { useCreateTransactionForm } from "./lib/useCreateForm";

export function NewTransactionPage() {
  const t = useT();
  const form = useCreateTransactionForm();

  useUnsavedWork(form.isDirty);
  // This screen IS the capture form, so `n` and the other openers stand down: they would open a
  // SECOND, independent draft over this one (toon-finance gotcha 65).
  useQuickAddHostedHere();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    form.submit();
  }

  if (form.isLoadingOther) return <LoadingBlock />;

  if (!form.hasOther) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("finance.transactions.new.title")} />
        <InviteSecondPerson />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("finance.transactions.new.title")} />
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-5">
        <TransactionFormFields
          householdId={form.householdId}
          otherName={form.otherName}
          value={form.state}
          onChange={form.patch}
          errors={form.errors}
        />

        <div className="flex-1" />

        <div className="sticky bottom-tabbar z-20 -mb-4 bleed-gutter-inset border-t border-line bg-bg/95 py-3 backdrop-blur-sm">
          <Button type="submit" fullWidth loading={form.isPending}>
            {t("finance.transactions.form.submitCreate")}
          </Button>
        </div>
      </form>
    </div>
  );
}
