import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { currentPeriod, previousPeriod } from "@toon/shared";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";
import { ErrorState } from "@/components/ui/ErrorState";
import { categoriesQuery } from "@/modules/finance/lib/queries";
import { useRequiredHouseholdId } from "@/lib/session";
import { BalanceHero } from "./components/BalanceHero";
import { FixedCostCard } from "./components/FixedCostCard";
import { MonthSummaryCard } from "./components/MonthSummaryCard";
import { RecentTransactionsCard } from "./components/RecentTransactionsCard";
import { SettleDialog } from "./components/SettleDialog";
import { SpendByCategoryCard, type SpendRangeKey } from "./components/SpendByCategoryCard";
import { useBalance, useHouseholdMembers, useOverviewPlan, useRecentTransactions, useTransactionSummary } from "./lib/queries";

function rangeBounds(range: SpendRangeKey): { from?: string; to: string } {
  const now = currentPeriod(Date.now());
  switch (range) {
    case "thisMonth":
      return { from: now, to: now };
    case "lastMonth": {
      const month = previousPeriod(now);
      return { from: month, to: month };
    }
    case "thisYear":
      return { from: `${now.slice(0, 4)}-01`, to: now };
    case "allTime":
      return { to: now };
  }
}

/**
 * `/` — the startscreen (docs/spec.md §4.3). Card order is fixed: the balance
 * first (the reason anyone opens this app), the fixed-cost plan second (the
 * reason the app exists), then the two "Auswertung" cards, then the recent
 * list. `RequireHousehold` already guarantees a household by the time this
 * mounts.
 *
 * No `PageHeader` (the screen has no title), but on phones it still opens with the shell's
 * `PhoneHeaderRow` (household + module chips, SPEC D6/§5): the TopBar is gone, so without it a
 * phone user landing here from Home could not switch module or household. It is also in the
 * error state, so a failing balance query never strands the user. Hidden from `lg`.
 */
export function OverviewPage() {
  const householdId = useRequiredHouseholdId();
  const [settleOpen, setSettleOpen] = useState(false);
  const [categoryRange, setCategoryRange] = useState<SpendRangeKey>("thisMonth");

  const balance = useBalance(householdId);
  const plan = useOverviewPlan(householdId);
  const members = useHouseholdMembers(householdId);
  const summary = useTransactionSummary(householdId, rangeBounds(categoryRange));
  const categories = useQuery(categoriesQuery(householdId));
  const recent = useRecentTransactions(householdId, 5);

  const otherName = members.other?.displayName ?? "";
  const ownName = members.own?.displayName ?? "";

  if (balance.isError) {
    return (
      <div className="flex flex-col gap-4">
        <PhoneHeaderRow />
        <ErrorState error={balance.error} onRetry={() => void balance.refetch()} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PhoneHeaderRow />

      <BalanceHero
        balance={balance.data}
        isLoading={balance.isPending || members.isLoading}
        otherName={otherName}
        onSettle={() => setSettleOpen(true)}
      />

      <FixedCostCard householdId={householdId} plan={plan.data} isLoading={plan.isPending} otherName={otherName} />

      <MonthSummaryCard householdId={householdId} />

      <SpendByCategoryCard
        range={categoryRange}
        onRangeChange={setCategoryRange}
        isLoading={summary.isPending}
        isError={summary.isError}
        onRetry={() => void summary.refetch()}
        byCategory={summary.data?.byCategory ?? []}
        categories={categories.data?.items ?? []}
      />

      <RecentTransactionsCard
        items={recent.data?.items ?? []}
        isLoading={recent.isPending}
        isError={recent.isError}
        onRetry={() => void recent.refetch()}
      />

      {balance.data ? (
        <SettleDialog
          open={settleOpen}
          onClose={() => setSettleOpen(false)}
          householdId={householdId}
          balance={balance.data}
          ownName={ownName}
          otherName={otherName}
        />
      ) : null}
    </div>
  );
}

export default OverviewPage;
