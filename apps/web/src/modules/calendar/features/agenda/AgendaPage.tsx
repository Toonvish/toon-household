/**
 * The overview (`/calendar`, design §4.2). Phone: the Today card, the member chips, the overdue tasks, then the next
 * 14 days by day (empty days skipped). Desktop: the agenda on the left (two thirds) and a rail with the Today card,
 * the cars and the next pickups. The link to the subscription screen (plan m9 P16) follows the Today card on phones
 * and closes the rail from `lg`.
 *
 * ONE occurrence request covers the overdue window and the 14 days (`today - 7` … `today + 13`); the member chips
 * filter it client side with the API's rule (`matchesMember`), so the list, the card and the offline copy share one
 * persisted cache entry.
 */
import { useQuery } from "@tanstack/react-query";
import { addCalendarDays } from "@toon/shared";
import { CalendarDays } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { CalendarPageHeader, NewEntryLink } from "@/modules/calendar/components/CalendarPageHeader";
import { DayHeading } from "@/modules/calendar/components/DayHeading";
import { MemberFilterChips } from "@/modules/calendar/components/MemberFilterChips";
import { OccurrenceRow } from "@/modules/calendar/components/OccurrenceRow";
import { agendaRows, groupByDay, matchesMember, overdueTasks } from "@/modules/calendar/lib/group";
import { useCalendarContext, useCars, useOccurrenceToggle } from "@/modules/calendar/lib/hooks";
import { memberMap } from "@/modules/calendar/lib/people";
import { occurrencesQuery } from "@/modules/calendar/lib/queries";
import { CarStatusCard } from "./components/CarStatusCard";
import { FeedLink } from "./components/FeedLink";
import { NextPickupsCard } from "./components/NextPickupsCard";
import { TodayCard } from "./components/TodayCard";

/** How far back open tasks count as overdue, and how many days the agenda shows (today included). */
const OVERDUE_DAYS = 7;
const AGENDA_DAYS = 14;

export function AgendaPage() {
  const t = useT();
  const { householdId, userId, today } = useCalendarContext();
  const { canToggle, onToggle } = useOccurrenceToggle(householdId, userId);
  const { activeCars, carNames } = useCars(householdId);
  const [memberId, setMemberId] = useState<string | undefined>(undefined);

  const from = addCalendarDays(today, -OVERDUE_DAYS);
  const to = addCalendarDays(today, AGENDA_DAYS - 1);
  const query = useQuery(occurrencesQuery(householdId, from, to));

  const allItems = query.data?.items ?? [];
  const members = useMemo(() => memberMap(query.data?.members ?? []), [query.data]);
  const items = useMemo(() => allItems.filter((item) => matchesMember(item, memberId)), [allItems, memberId]);
  const overdue = overdueTasks(items, today, OVERDUE_DAYS);
  const days = groupByDay(items, addCalendarDays(today, 1), to);

  const header = (
    <CalendarPageHeader title={t("calendar.agenda.title")} actions={<NewEntryLink date={today} />} />
  );

  if (query.isPending) {
    return (
      <div className="flex flex-col">
        {header}
        <Skeleton lines={6} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex flex-col">
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const rowProps = { members, cars: carNames, today, canToggle, onToggle };

  return (
    <div className="flex flex-col">
      {header}
      <div className="grid gap-6 lg:grid-cols-3">
        <aside className="flex min-w-0 flex-col gap-4 lg:order-2">
          <TodayCard
            today={today}
            items={items}
            allItems={allItems}
            members={members}
            cars={activeCars}
            carNames={carNames}
            canToggle={canToggle}
            onToggle={onToggle}
          />
          <div className="hidden flex-col gap-4 lg:flex">
            <CarStatusCard today={today} cars={activeCars} items={allItems} members={members} />
            <NextPickupsCard householdId={householdId} today={today} />
          </div>
          <FeedLink />
        </aside>

        <section aria-label={t("calendar.agenda.title")} className="flex min-w-0 flex-col gap-5 lg:order-1 lg:col-span-2">
          <MemberFilterChips members={query.data.members} value={memberId} onChange={setMemberId} />

          {overdue.length > 0 ? (
            <section aria-labelledby="calendar-overdue" className="rounded-card border border-danger/30 bg-danger-soft px-3 py-2">
              <h3 id="calendar-overdue" className="eyebrow pt-1 text-danger-soft-fg">
                {t("calendar.agenda.overdue")}
              </h3>
              <ul className="flex flex-col">
                {agendaRows(overdue).map((row) => (
                  <OccurrenceRow key={row.key} row={row} showDate {...rowProps} />
                ))}
              </ul>
            </section>
          ) : null}

          {days.length === 0 ? (
            <EmptyState
              icon={<CalendarDays />}
              title={t("calendar.agenda.empty.title")}
              description={t("calendar.agenda.empty.description")}
            />
          ) : (
            days.map((day) => (
              <section key={day.date} aria-labelledby={`calendar-day-${day.date}`} className="flex flex-col gap-1">
                <DayHeading id={`calendar-day-${day.date}`} date={day.date} today={today} />
                <ul className="flex flex-col divide-y divide-line">
                  {day.rows.map((row) => (
                    <OccurrenceRow key={row.key} row={row} {...rowProps} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
