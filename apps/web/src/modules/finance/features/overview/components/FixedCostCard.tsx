import { AppLink } from "@/lib/nav";
import type { PlanResponse } from "@toon/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency, formatPercent } from "@/modules/finance/lib/format";
import { useT } from "@/lib/i18n";
import { useRunPlan } from "../lib/queries";

/**
 * Mobile's only door to `/plan` (docs/spec.md §4.1, §4.3) — deleting this
 * card kills the fixed-cost plan on a phone, and the plan is the reason the
 * app exists. The clickable area is a real `<Link>`, but the "Jetzt buchen"
 * action sits OUTSIDE it (a `<button>` nested in an `<a>` is invalid HTML and
 * would fire both handlers on tap).
 */
export function FixedCostCard({
  householdId,
  plan,
  isLoading,
  otherName,
}: {
  householdId: string;
  plan: PlanResponse | undefined;
  isLoading: boolean;
  otherName: string;
}) {
  const t = useT();
  const toast = useToast();
  const runPlanMutation = useRunPlan(householdId);

  if (isLoading || !plan) {
    return (
      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-col gap-2 p-4 sm:p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-40" />
        </div>
      </Card>
    );
  }

  const pendingCount = plan.pendingPeriods.length;

  async function runNow() {
    try {
      const result = await runPlanMutation.mutateAsync({});
      if (result.bookedPeriods.length > 0) {
        toast.success(t("finance.plan.toast.run", { count: result.bookedPeriods.length }));
      } else {
        toast.toast({ title: t("finance.plan.toast.nothingToDo") });
      }
    } catch (error) {
      toast.fromError(error);
    }
  }

  return (
    <Card padding="none" className="overflow-hidden" interactive>
      <AppLink to="/finance/plan" className="block p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg-muted">{t("finance.plan.title")}</p>
            {plan.plan.enabled && plan.current ? (
              <>
                <p className="mt-1 font-display text-display-xl font-medium tabular-nums text-fg">
                  {formatCurrency(plan.current.bookableCents)}
                </p>
                <p className="mt-0.5 text-sm text-fg-muted">
                  {t("finance.plan.shareOther", { name: otherName })} ·{" "}
                  {formatPercent(plan.current.quoteNumerator, plan.current.quoteDenominator)}
                </p>
              </>
            ) : !plan.plan.enabled ? (
              <p className="mt-1 text-sm text-fg-muted">{t("finance.plan.disabledHint")}</p>
            ) : (
              <p className="mt-1 text-sm text-fg-muted">{t("finance.plan.error.incomplete")}</p>
            )}
          </div>
          {plan.plan.lastBookedPeriod ? (
            <Badge variant="neutral" className="shrink-0">
              {t("finance.plan.lastBooked", { period: plan.plan.lastBookedPeriod })}
            </Badge>
          ) : null}
        </div>
      </AppLink>

      {pendingCount > 0 ? (
        <div className="flex flex-col gap-2 border-t border-line bg-warning-soft/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-fg">{t("finance.plan.pendingNotice", { count: pendingCount })}</p>
          <Button
            size="sm"
            loading={runPlanMutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void runNow();
            }}
          >
            {t("finance.plan.run")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
