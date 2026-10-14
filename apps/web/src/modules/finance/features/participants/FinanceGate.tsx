import { Outlet } from "@tanstack/react-router";
import { PhoneHeaderRow } from "@/components/layout/PhoneHeaderRow";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useActiveHousehold } from "@/lib/session";
import { NonParticipantState } from "./NonParticipantState";
import { useFinanceParticipants } from "./lib/queries";

/**
 * The pathless gate route under `/finance` (M3 decision 3, 13): a household member without a
 * slot sees nothing of the ledger, so every finance screen renders `NonParticipantState`
 * instead of its outlet (the API answers `403 finance_not_participant` on those reads anyway).
 * Default export: the route loads it through `lazyRouteComponent`.
 */
export default function FinanceGate() {
  const { householdId } = useActiveHousehold();
  const participants = useFinanceParticipants(householdId);

  // The phone chips stay reachable while loading and on error (the TopBar is gone).
  if (participants.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <PhoneHeaderRow />
        <LoadingBlock />
      </div>
    );
  }
  if (participants.isError) {
    return (
      <div className="flex flex-col gap-4">
        <PhoneHeaderRow />
        <ErrorState error={participants.error} onRetry={() => void participants.refetch()} />
      </div>
    );
  }
  if (participants.data.viewerSlot === null) {
    return <NonParticipantState participants={participants.data.items} />;
  }
  return <Outlet />;
}
