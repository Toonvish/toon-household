import { currentPeriod } from "@toon/shared";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useRequiredHouseholdId } from "@/lib/session";
import { FixedCostItemList } from "./components/FixedCostItemList";
import { IncomeList } from "./components/IncomeList";
import { PlanPeriodList } from "./components/PlanPeriodList";
import { PlanSummary } from "./components/PlanSummary";
import { RecalculateDialog } from "./components/RecalculateDialog";
import { useBookedPeriods, useHouseholdMembers, usePlan } from "./lib/queries";

/**
 * `/plan` — sidebar destination, reachable on mobile via `FixedCostCard` on
 * `/` (docs/spec.md §4.6). `PlanSummary`'s own `CardHeader` carries the
 * screen's title, so there is no separate `PageHeader` here.
 */
export function PlanPage() {
  const householdId = useRequiredHouseholdId();
  const plan = usePlan(householdId);
  const members = useHouseholdMembers(householdId);
  const booked = useBookedPeriods(householdId, 12);
  const period = currentPeriod(Date.now());

  if (plan.isPending || members.isLoading) return <LoadingBlock />;
  if (plan.isError || !plan.data) {
    return <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <PlanSummary householdId={householdId} plan={plan.data} members={members} />
      <FixedCostItemList householdId={householdId} items={plan.data.items} currentPeriod={period} />
      <IncomeList householdId={householdId} incomes={plan.data.incomes} members={members} currentPeriod={period} />
      <PlanPeriodList
        householdId={householdId}
        bookedTransactions={booked.data?.items ?? []}
        isLoading={booked.isPending}
        isError={booked.isError}
        onRetry={() => void booked.refetch()}
        pendingPeriods={plan.data.pendingPeriods}
      />
      <RecalculateDialog householdId={householdId} />
    </div>
  );
}

export default PlanPage;
