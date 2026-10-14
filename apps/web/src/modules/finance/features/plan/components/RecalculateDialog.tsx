import { useState } from "react";
import type { RecalculatePlanResponse } from "@toon/shared";
import { AmountText } from "@/modules/finance/components/AmountText";
import { PeriodLabel } from "@/modules/finance/components/PeriodLabel";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";
import { useRecalculatePlan } from "../lib/queries";

/**
 * "Neuberechnung" (docs/spec.md §4.6): a dry run first, always — a booked
 * period never changes silently. Confirming writes new adjustment rows; the
 * old ones are never touched (ledger-spec.md §4.6).
 */
export function RecalculateDialog({ householdId }: { householdId: string }) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<RecalculatePlanResponse | null>(null);
  const recalculate = useRecalculatePlan(householdId);

  function close() {
    setOpen(false);
    setPreview(null);
  }

  async function loadPreview() {
    try {
      const result = await recalculate.mutateAsync({ dryRun: true });
      setPreview(result);
    } catch (error) {
      toast.fromError(error);
    }
  }

  async function confirm() {
    try {
      const result = await recalculate.mutateAsync({ dryRun: false });
      toast.success(t("finance.plan.recalculate.done", { count: result.adjustments.length }));
      close();
    } catch (error) {
      toast.fromError(error);
    }
  }

  return (
    <>
      <Card className="flex flex-col gap-3">
        <CardHeader title={t("finance.plan.recalculate.title")} description={t("finance.plan.recalculate.description")} />
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
            void loadPreview();
          }}
        >
          {t("finance.plan.recalculate.title")}
        </Button>
      </Card>

      <Dialog
        open={open}
        onClose={close}
        title={t("finance.plan.recalculate.title")}
        size="lg"
        footer={
          preview && preview.items.length > 0 ? (
            <Button fullWidth loading={recalculate.isPending} onClick={confirm}>
              {t("finance.plan.recalculate.confirm")}
            </Button>
          ) : null
        }
      >
        <div className="flex flex-col gap-3 pb-2">
          {recalculate.isPending && !preview ? (
            <Button loading disabled fullWidth>
              {t("finance.plan.recalculate.preview")}
            </Button>
          ) : recalculate.isError && !preview ? (
            <ErrorState inline error={recalculate.error} onRetry={() => void loadPreview()} />
          ) : preview && preview.items.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("finance.plan.recalculate.none")}</p>
          ) : preview ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[24rem] text-sm">
                <thead>
                  <tr className="text-left text-fg-muted">
                    <th className="py-1 font-medium">{t("finance.plan.recalculate.period")}</th>
                    <th className="py-1 text-right font-medium">{t("finance.plan.recalculate.booked")}</th>
                    <th className="py-1 text-right font-medium">{t("finance.plan.recalculate.recomputed")}</th>
                    <th className="py-1 text-right font-medium">{t("finance.plan.recalculate.delta")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {preview.items.map((line) => (
                    <tr key={line.period}>
                      <td className="py-1.5">
                        <PeriodLabel period={line.period} />
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        <AmountText cents={line.bookedCents} colorNegative={false} size="sm" />
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        <AmountText cents={line.recomputedCents} colorNegative={false} size="sm" />
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        <AmountText cents={line.deltaCents} showPlusSign size="sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line-strong font-semibold">
                    <td className="py-1.5">{t("finance.plan.recalculate.total")}</td>
                    <td colSpan={2} />
                    <td className="py-1.5 text-right tabular-nums">
                      <AmountText cents={preview.totalDeltaCents} showPlusSign size="sm" />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
