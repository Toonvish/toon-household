import { currentPeriod } from "@toon/shared";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";
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
 * screen's title, so there is no separate `PageHeader` here. On phones the screen still opens with
 * the shell's `PhoneHeaderRow` (household + module chips, SPEC D6/§5), also while loading and in
 * the error state: the TopBar is gone, so this row is the only way to switch module or household.
 */
export function PlanPage() {
  const householdId = useRequiredHouseholdId();
  const plan = usePlan(householdId);
  const members = useHouseholdMembers(householdId);
  const booked = useBookedPeriods(householdId, 12);
  const period = currentPeriod(Date.now());

  if (plan.isPending || members.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <PhoneHeaderRow />
        <LoadingBlock />
      </div>
    );
  }
  if (plan.isError || !plan.data) {
    return (
      <div className="flex flex-col gap-4">
        <PhoneHeaderRow />
        <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PhoneHeaderRow />
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
