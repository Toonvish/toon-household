/**
 * The viewer's household and slot, and the other participant, for the finance module (M3
 * decision 10 `participants.ts`; replaces F `lib/session.tsx`'s `useHousehold` and
 * `useOtherMember`). The household comes from the core's `useActiveHousehold()`; the viewer's
 * slot and the other person come from the participants query (`financeParticipantsQuery`),
 * because the core knows nothing of slots: `finance_participants` is the truth (M3 decision 4).
 *
 * No JSX in this file: the manifest and the Home card import it, and a `.tsx` would pull the
 * component layer into the manifest graph.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FinanceParticipantResponse, HouseholdWithRole, MemberSlot } from "@toon/shared";
import { useActiveHousehold } from "@/lib/session";
import { financeParticipantsQuery } from "./queries";

export interface FinanceHouseholdValue {
  /** Null only when the user is in no household at all. */
  householdId: string | null;
  household: HouseholdWithRole | null;
  /** The viewer's slot (1 or 2); null while the participants are not loaded or the viewer is no participant. */
  memberSlot: MemberSlot | null;
  isLoading: boolean;
}

/** The household, the viewer's slot and whether the participants are still loading. */
export function useFinanceHousehold(): FinanceHouseholdValue {
  const { householdId, household } = useActiveHousehold();
  const query = useQuery({
    ...financeParticipantsQuery(householdId ?? ""),
    enabled: householdId !== null,
  });
  return {
    householdId,
    household,
    memberSlot: query.data?.viewerSlot ?? null,
    isLoading: query.isPending,
  };
}

/**
 * The OTHER participant (the one not in the viewer's slot) — the source of every `{name}`
 * placeholder in the finance screens (`finance.transactions.kind.forThem.label`,
 * `finance.balance.owesYou`, …). While it is loading, or no slot is known yet, `member` is
 * `null` and callers fall back to a generic label.
 */
export function useOtherParticipant(): { member: FinanceParticipantResponse | null; isLoading: boolean } {
  const { householdId, memberSlot } = useFinanceHousehold();
  const query = useQuery({
    ...financeParticipantsQuery(householdId ?? ""),
    enabled: householdId !== null,
  });
  const member = useMemo(() => {
    if (!query.data || memberSlot === null) return null;
    return query.data.items.find((item) => item.memberSlot !== memberSlot) ?? null;
  }, [query.data, memberSlot]);
  return { member, isLoading: query.isPending };
}
