/**
 * Aufgaben (`/calendar/tasks`, design §4.4): Offen (a week back to a week ahead), Wiederkehrend (every task
 * series) and the Müllabfuhr card. Desktop: the open tasks on the left, the series and the waste card on the right.
 */
import { useQuery } from "@tanstack/react-query";
import { addCalendarDays } from "@toon/shared";
import { useMemo } from "react";
import { ErrorState, Skeleton } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { CalendarPageHeader, NewEntryLink } from "@/modules/calendar/components/CalendarPageHeader";
import { useCalendarContext, useCalendarMembers, useOccurrenceToggle } from "@/modules/calendar/lib/hooks";
import { memberMap } from "@/modules/calendar/lib/people";
import { entriesQuery, occurrencesQuery } from "@/modules/calendar/lib/queries";
import { OpenTasks } from "./components/OpenTasks";
import { TaskSeries } from "./components/TaskSeries";
import { WasteSummaryCard } from "./components/WasteSummaryCard";

/** Open tasks are listed from this many days back to this many days ahead. */
const WINDOW_DAYS = 7;

export function TasksPage() {
  const t = useT();
  const { householdId, userId, today } = useCalendarContext();
  const { canToggle, onToggle } = useOccurrenceToggle(householdId, userId);
  const from = addCalendarDays(today, -WINDOW_DAYS);
  const to = addCalendarDays(today, WINDOW_DAYS);
  const occurrences = useQuery(occurrencesQuery(householdId, from, to, { kind: "task" }));
  const series = useQuery(entriesQuery(householdId, { kind: "task", recurring: "true" }));
  const { members: householdMembers } = useCalendarMembers(householdId);
  const members = useMemo(() => memberMap(occurrences.data?.members ?? []), [occurrences.data]);
  // The series list names people too: the occurrence list's members (persisted) first, else the core list.
  const seriesMembers = occurrences.data?.members ?? householdMembers;

  return (
    <div className="flex flex-col">
      <CalendarPageHeader title={t("calendar.tasks.title")} actions={<NewEntryLink date={today} kind="task" />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {occurrences.isPending ? (
            <Skeleton lines={6} />
          ) : occurrences.isError ? (
            <ErrorState error={occurrences.error} onRetry={() => void occurrences.refetch()} />
          ) : (
            <OpenTasks
              items={occurrences.data.items}
              from={from}
              to={to}
              today={today}
              members={members}
              canToggle={canToggle}
              onToggle={onToggle}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <WasteSummaryCard householdId={householdId} today={today} />
          {series.isPending ? (
            <Skeleton lines={4} />
          ) : series.isError ? (
            <ErrorState error={series.error} onRetry={() => void series.refetch()} />
          ) : (
            <TaskSeries entries={series.data.items} members={seriesMembers} today={today} />
          )}
        </div>
      </div>
    </div>
  );
}
