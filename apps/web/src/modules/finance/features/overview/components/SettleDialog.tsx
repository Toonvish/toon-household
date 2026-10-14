import { useState } from "react";
import type { BalanceResponse } from "@toon/shared";
import { parseGermanAmount } from "@toon/shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { isApiError } from "@/modules/finance/lib/api";
import { formatCurrency } from "@/modules/finance/lib/format";
import { useT } from "@/lib/i18n";
import { useCreateSettlement } from "../lib/queries";

/**
 * "Jetzt ausgleichen" (docs/spec.md §4.3, §3.9). Defaults to the full open
 * amount and accepts a partial one; `expectedBalanceCents` is ALWAYS the raw,
 * un-negated `balanceCents` the server compares against (ledger-spec.md
 * §5.4) — never `viewerBalanceCents`, which only exists to render a sentence.
 */
export function SettleDialog({
  open,
  onClose,
  householdId,
  balance,
  ownName,
  otherName,
}: {
  open: boolean;
  onClose: () => void;
  householdId: string;
  balance: BalanceResponse;
  ownName: string;
  otherName: string;
}) {
  const t = useT();
  const toast = useToast();
  const createSettlement = useCreateSettlement(householdId);

  const fullAmountCents = Math.abs(balance.viewerBalanceCents);
  const [partial, setPartial] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [staleAmountCents, setStaleAmountCents] = useState<number | null>(null);

  function reset() {
    setPartial(false);
    setAmountInput("");
    setNote("");
    setFormError(null);
    setStaleAmountCents(null);
  }

  const parsedAmount = partial ? parseGermanAmount(amountInput) : fullAmountCents;
  const amountCents = parsedAmount !== null && parsedAmount > 0 ? parsedAmount : null;

  // `viewerBalanceCents - sign(viewerBalanceCents) * amountCents` is the
  // resulting balance from the VIEWER's own perspective — this holds
  // regardless of which slot the viewer sits in, because `viewerSign` cancels
  // out (see the derivation in `BalanceHero.tsx`'s doc comment).
  const viewerSign = Math.sign(balance.viewerBalanceCents);
  const prospectiveViewerBalance = amountCents !== null ? balance.viewerBalanceCents - viewerSign * amountCents : null;
  const overpaying =
    viewerSign < 0 && amountCents !== null && amountCents > fullAmountCents && prospectiveViewerBalance !== null;

  const payerIsViewer = balance.viewerBalanceCents < 0;
  const fromName = payerIsViewer ? ownName : otherName;
  const toName = payerIsViewer ? otherName : ownName;

  function handleClose() {
    reset();
    onClose();
  }

  async function submit() {
    setFormError(null);
    setStaleAmountCents(null);
    if (amountCents === null) {
      setFormError(t("finance.transactions.form.amountInvalid"));
      return;
    }
    try {
      await createSettlement.mutateAsync({
        expectedBalanceCents: balance.balanceCents,
        amountCents,
        note: note.trim().length > 0 ? note.trim() : undefined,
      });
      toast.success(t("finance.balance.settle.done"));
      handleClose();
    } catch (error) {
      if (isApiError(error) && error.code === "balance_stale") {
        const details = error.details as { currentBalanceCents?: number } | undefined;
        setStaleAmountCents(typeof details?.currentBalanceCents === "number" ? details.currentBalanceCents : 0);
        return;
      }
      setFormError(t("finance.common.errorGeneric"));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t("finance.balance.settle.title")}
      variant="sheet"
      footer={
        staleAmountCents === null ? (
          <Button fullWidth loading={createSettlement.isPending} onClick={submit} disabled={amountCents === null}>
            {t("finance.balance.settle.submit")}
          </Button>
        ) : null
      }
    >
      {staleAmountCents !== null ? (
        <div className="flex flex-col gap-3">
          <ErrorState
            inline
            title={t("finance.balance.settle.stale", { amount: formatCurrency(Math.abs(staleAmountCents)) })}
          />
          <Button
            fullWidth
            onClick={() => {
              setStaleAmountCents(null);
            }}
          >
            {t("finance.balance.settle.staleAction")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-sm text-fg-muted">{t("finance.balance.settle.direction", { from: fromName, to: toName })}</p>

          {formError ? <ErrorState inline description={formError} /> : null}

          <div className="flex flex-col gap-2">
            <Button
              variant={partial ? "outline" : "primary"}
              fullWidth
              onClick={() => setPartial(false)}
            >
              {t("finance.balance.settle.full", { amount: formatCurrency(fullAmountCents) })}
            </Button>
            <Button variant={partial ? "primary" : "outline"} fullWidth onClick={() => setPartial(true)}>
              {t("finance.balance.settle.partial")}
            </Button>
          </div>

          {partial ? (
            <Input
              label={t("finance.balance.settle.amount")}
              inputMode="decimal"
              autoFocus
              value={amountInput}
              onChange={(event) => setAmountInput(event.currentTarget.value)}
              placeholder={t("finance.transactions.form.amountPlaceholder")}
              error={amountInput.length > 0 && amountCents === null ? t("finance.transactions.form.amountInvalid") : undefined}
            />
          ) : null}

          {overpaying ? <p className="text-sm text-warning-soft-fg">{t("finance.balance.settle.overpayHint", { name: otherName })}</p> : null}

          <Textarea
            label={t("finance.balance.settle.note")}
            optional
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            placeholder={t("finance.balance.settle.notePlaceholder")}
            rows={2}
          />
        </div>
      )}
    </Dialog>
  );
}
