import type { TransactionResponse } from "@toon/shared";
import { AmountText } from "@/modules/finance/components/AmountText";
import { PeriodLabel } from "@/modules/finance/components/PeriodLabel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";
import { CalendarClock } from "lucide-react";
import { useRunPlan } from "../lib/queries";

/**
 * "Gebuchte Monate" (docs/spec.md §4.6): the plan's own bookings
 * (`origin=fixed_plan`, never adjustments — those get their own audit trail
 * via `plan_period`) plus any period the next catch-up would still book,
 * highlighted with its own "Jetzt buchen".
 */
export function PlanPeriodList({
  householdId,
  bookedTransactions,
  isLoading,
  isError,
  onRetry,
  pendingPeriods,
}: {
  householdId: string;
  bookedTransactions: readonly TransactionResponse[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  pendingPeriods: readonly string[];
}) {
  const t = useT();
  const toast = useToast();
  const runPlan = useRunPlan(householdId);

  async function runNow() {
    try {
      const result = await runPlan.mutateAsync({});
      if (result.bookedPeriods.length > 0) toast.success(t("finance.plan.toast.run", { count: result.bookedPeriods.length }));
      else toast.toast({ title: t("finance.plan.toast.nothingToDo") });
    } catch (error) {
      toast.fromError(error);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <CardHeader title={t("finance.plan.periods.title")} />

      {pendingPeriods.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {pendingPeriods.map((period) => (
            <li
              key={period}
              className="flex items-center justify-between gap-3 rounded-xl bg-warning-soft/50 px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">
                <PeriodLabel period={period} />
                <Badge variant="warning" size="sm">
                  {t("finance.plan.periods.pending")}
                </Badge>
              </span>
              <Button size="sm" loading={runPlan.isPending} onClick={() => void runNow()}>
                {t("finance.plan.run")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {isLoading ? (
        <SkeletonList count={4} />
      ) : isError ? (
        <ErrorState inline onRetry={onRetry} />
      ) : bookedTransactions.length === 0 && pendingPeriods.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title={t("finance.plan.periods.empty")} />
      ) : bookedTransactions.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line">
          {bookedTransactions.map((transaction) => (
            <li key={transaction.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0 text-sm font-medium text-fg">
                {transaction.planPeriod ? <PeriodLabel period={transaction.planPeriod} /> : transaction.description}
              </span>
              <AmountText cents={transaction.amountCents} colorNegative={false} size="sm" className="shrink-0" />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
