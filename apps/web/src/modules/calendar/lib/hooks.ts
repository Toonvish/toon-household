/**
 * The hooks every calendar screen shares: the household, the viewer, the CLIENT's today (design §1.2: the server
 * never decides it) and the done toggle with its write gate.
 */
import { todayPlanDate, type CalendarMember, type CalendarResource } from "@toon/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { householdMembersQuery } from "@/lib/queries";
import { useCanMutate, useCurrentUser, useRequiredHouseholdId } from "@/lib/session";
import { calendarMembersFromHousehold } from "./people";
import { resourcesQuery, useSetOccurrenceStatus, type OccurrenceStatusChange } from "./queries";

/** The household, the viewer and today (`YYYY-MM-DD` in the device's calendar). */
export function useCalendarContext(): { householdId: string; userId: string; today: string } {
  const householdId = useRequiredHouseholdId();
  const user = useCurrentUser();
  return { householdId, userId: user.id, today: todayPlanDate() };
}

/** The done/skip toggle for rows, gated like every write (online, confirmed address). */
export function useOccurrenceToggle(householdId: string, userId: string): {
  canToggle: boolean;
  onToggle: (change: OccurrenceStatusChange) => void;
} {
  const { canMutate } = useCanMutate();
  const mutation = useSetOccurrenceStatus(householdId, userId);
  return { canToggle: canMutate, onToggle: mutation.mutate };
}

/** Every car (archived ones too, so an old booking still names its car) and the id -> name map. */
export function useCars(householdId: string): {
  cars: ReadonlyArray<CalendarResource>;
  activeCars: ReadonlyArray<CalendarResource>;
  carNames: ReadonlyMap<string, string>;
  isPending: boolean;
} {
  const query = useQuery(resourcesQuery(householdId, true));
  return useMemo(() => {
    const cars = query.data?.items ?? [];
    return {
      cars,
      activeCars: cars.filter((car) => !car.archived),
      carNames: new Map(cars.map((car) => [car.id, car.name])),
      isPending: query.isPending,
    };
  }, [query.data, query.isPending]);
}

/** The household's members as calendar members (forms: who, rotation), from the core members query. */
export function useCalendarMembers(householdId: string): {
  members: ReadonlyArray<CalendarMember>;
  isPending: boolean;
  isError: boolean;
} {
  const query = useQuery(householdMembersQuery(householdId));
  const members = useMemo(() => calendarMembersFromHousehold(query.data?.items ?? []), [query.data]);
  return { members, isPending: query.isPending, isError: query.isError };
}
