/**
 * Monat (`/calendar/month?month=YYYY-MM&day=YYYY-MM-DD`, design §4.3): the month title with previous / next and
 * "Heute", the grid, and the selected day's list (below the grid on phones, a side panel from `lg`). The month and
 * the day are URL state; a missing or malformed value falls back to today's month and today (or the 1st).
 */
import { useQuery } from "@tanstack/react-query";
import { isCalendarDate } from "@toon/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { Button, ErrorState, IconButton, Skeleton } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useAppNavigate } from "@/lib/nav";
import { useSearchParams } from "@/lib/navigation";
import { CalendarPageHeader, NewEntryLink } from "@/modules/calendar/components/CalendarPageHeader";
import { formatMonthTitle } from "@/modules/calendar/lib/format";
import { addMonths, isCalendarMonth, monthGridDays, monthOf } from "@/modules/calendar/lib/group";
import { useCalendarContext, useCars, useOccurrenceToggle } from "@/modules/calendar/lib/hooks";
import { memberMap } from "@/modules/calendar/lib/people";
import { occurrencesQuery } from "@/modules/calendar/lib/queries";
import { DayList } from "./components/DayList";
import { MonthGrid } from "./components/MonthGrid";

export function MonthPage() {
  const t = useT();
  const navigate = useAppNavigate();
  const search = useSearchParams();
  const { householdId, userId, today } = useCalendarContext();
  const { canToggle, onToggle } = useOccurrenceToggle(householdId, userId);
  const { carNames } = useCars(householdId);

  const month = isCalendarMonth(search.month) ? search.month : monthOf(today);
  const selected =
    search.day !== undefined && isCalendarDate(search.day) && search.day.startsWith(month)
      ? search.day
      : today.startsWith(month)
        ? today
        : `${month}-01`;
  const days = useMemo(() => monthGridDays(month), [month]);
  const from = days[0] ?? `${month}-01`;
  const to = days.at(-1) ?? `${month}-28`;
  const query = useQuery(occurrencesQuery(householdId, from, to));
  const members = useMemo(() => memberMap(query.data?.members ?? []), [query.data]);

  function go(next: { month: string; day?: string | undefined }) {
    navigate({ to: "/calendar/month", search: { month: next.month, day: next.day }, replace: true });
  }

  return (
    <div className="flex flex-col">
      <CalendarPageHeader title={formatMonthTitle(month)} actions={<NewEntryLink date={selected} />} />
      <div className="mb-4 flex items-center gap-2">
        <IconButton
          label={t("calendar.monthView.previous")}
          variant="surface"
          icon={<ChevronLeft />}
          onClick={() => go({ month: addMonths(month, -1) })}
        />
        <IconButton
          label={t("calendar.monthView.next")}
          variant="surface"
          icon={<ChevronRight />}
          onClick={() => go({ month: addMonths(month, 1) })}
        />
        <Button variant="outline" size="sm" onClick={() => go({ month: monthOf(today), day: today })}>
          {t("calendar.monthView.today")}
        </Button>
      </div>

      {query.isPending ? (
        <Skeleton lines={8} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
          <div className="min-w-0 lg:col-span-2">
            <MonthGrid
              month={month}
              days={days}
              items={query.data.items}
              members={members}
              today={today}
              selected={selected}
              onSelect={(date) => go({ month: monthOf(date), day: date })}
            />
          </div>
          <div className="min-w-0">
            <DayList
              date={selected}
              today={today}
              items={query.data.items}
              members={members}
              carNames={carNames}
              canToggle={canToggle}
              onToggle={onToggle}
            />
          </div>
        </div>
      )}
    </div>
  );
}
