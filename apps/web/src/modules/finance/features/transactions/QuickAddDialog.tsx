/**
 * The finance "Erfassen" sheet (docs/spec.md §4.5, toon-finance 1715207): a bottom sheet on phones, a
 * centred dialog from `sm` up, mounted by `FinanceGate` for participants and opened by `n` and by the
 * "Erste Buchung erfassen" action of `/finance/transactions`. There is no floating "+" and no sidebar
 * button here (M3b decision 10): the phone's Erfassen tab at `/finance/new` stays (SPEC D6).
 *
 * It is the same `TransactionFormFields` the `/finance/new` page renders, in a frame that does not
 * cost a navigation: the booking you are looking at, the receipt in your hand and the form are on
 * screen at the same time.
 *
 * After a successful submit the sheet STAYS OPEN and the form clears (kind excepted), because receipts
 * arrive in batches; "Abbrechen" and Esc are the only things that close it. Cmd/Ctrl + Enter books from
 * anywhere inside, so the amount field never has to be left to reach the button.
 */
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useT } from "@/lib/i18n";
import { useUnsavedWork } from "@/lib/unsavedWork";
import { useQuickAdd } from "@/modules/finance/lib/quick-add";
import { InviteSecondPerson } from "./components/InviteSecondPerson";
import { TransactionFormFields } from "./components/TransactionFormFields";
import { useCreateTransactionForm } from "./lib/useCreateForm";

/**
 * The footer buttons live in `Dialog`'s footer SLOT, not in a sticky bar inside the scrolling body:
 * the slot already carries the border, the safe-area padding and the sheet's own bottom inset, and a
 * second bar stacked on top of it left a sliver of scrolled content visible below the primary
 * action. They reach the form by id: a `<button form="...">` outside its form is exactly what the
 * attribute is for.
 */
const FORM_ID = "quick-add-form";

export function QuickAddDialog() {
  const t = useT();
  const { isOpen, close } = useQuickAdd();
  const form = useCreateTransactionForm();

  // NOT gated on `isOpen` (toon-finance gotcha 62). `useCreateTransactionForm` keeps its state across
  // open and close on purpose, re-opening after a mis-tap must not lose a typed amount, so a closed
  // sheet very much CAN hold unsaved work, and releasing the claim on close is what let a waiting
  // service-worker update reload the document and throw that amount away (lib/pwa.ts).
  useUnsavedWork(form.isDirty);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    form.submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      form.submit();
    }
  }

  return (
    <Dialog
      open={isOpen}
      onClose={close}
      size="lg"
      title={t("finance.transactions.new.title")}
      description={<span className="hidden lg:inline">{t("finance.transactions.quickAdd.shortcuts")}</span>}
      footer={
        form.hasOther ? (
          <div className="flex w-full items-center gap-2 lg:justify-between">
            <p className="hidden text-sm text-fg-muted lg:block">{t("finance.transactions.quickAdd.staysOpen")}</p>
            <div className="flex flex-1 gap-2 lg:flex-none">
              <Button type="button" variant="outline" onClick={close}>
                {t("finance.common.cancel")}
              </Button>
              <Button type="submit" form={FORM_ID} loading={form.isPending} className="flex-1 lg:flex-none lg:px-8">
                {t("finance.transactions.form.submitCreate")}
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      {form.isLoadingOther ? (
        <LoadingBlock />
      ) : !form.hasOther ? (
        <InviteSecondPerson onNavigate={close} />
      ) : (
        <form id={FORM_ID} onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="flex flex-col gap-5 pb-2">
          <TransactionFormFields
            householdId={form.householdId}
            otherName={form.otherName}
            value={form.state}
            onChange={form.patch}
            errors={form.errors}
          />
        </form>
      )}
    </Dialog>
  );
}

/**
 * Mounts the dialog only once something has opened it, so the form's category and tag queries do not
 * fire on every finance screen. The component itself is statically imported (never lazy): the capture
 * flow has to work on a cold, offline start, and a lazy chunk is one more thing that can be missing at
 * exactly that moment.
 */
export function QuickAddHost() {
  const { isOpen } = useQuickAdd();
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => {
    if (isOpen) setEverOpened(true);
  }, [isOpen]);
  return everOpened ? <QuickAddDialog /> : null;
}
