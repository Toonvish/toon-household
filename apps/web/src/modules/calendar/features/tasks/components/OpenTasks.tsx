import type { CalendarOccurrence } from "@toon/shared";
import { CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { DayHeading } from "@/modules/calendar/components/DayHeading";
import { OccurrenceRow } from "@/modules/calendar/components/OccurrenceRow";
import { groupByDay, isWaste } from "@/modules/calendar/lib/group";
import type { MemberMap } from "@/modules/calendar/lib/people";
import type { OccurrenceStatusChange } from "@/modules/calendar/lib/queries";

/**
 * Aufgaben "Offen" (design §4.4): the open task occurrences from a week back to a week ahead, by day, each with its
 * checkbox and its person for that day (the rotation's pick). Today's done ones stay, so a tick can be taken back.
 */
export function OpenTasks({
  items,
  from,
  to,
  today,
  members,
  canToggle,
  onToggle,
}: {
  items: ReadonlyArray<CalendarOccurrence>;
  from: string;
  to: string;
  today: string;
  members: MemberMap;
  canToggle: boolean;
  onToggle: (change: OccurrenceStatusChange) => void;
}) {
  const t = useT();
  const open = items.filter(
    (item) =>
      item.kind === "task" &&
      // a past pickup is not a chore to catch up on (as the agenda's overdue list)
      !(isWaste(item) && item.date < today) &&
      (item.status === "open" || (item.status === "done" && item.date === today)),
  );
  const days = groupByDay(open, from, to);
  return (
    <section aria-labelledby="calendar-tasks-open" className="flex min-w-0 flex-col gap-3">
      <h2 id="calendar-tasks-open" className="font-display text-display-md font-medium text-fg">
        {t("calendar.tasks.open")}
      </h2>
      {days.length === 0 ? (
        <EmptyState icon={<CheckCircle2 />} title={t("calendar.tasks.openEmpty")} />
      ) : (
        days.map((day) => (
          <div key={day.date} className="flex flex-col gap-1">
            <DayHeading date={day.date} today={today} className={day.date < today ? "text-danger" : undefined} />
            <ul className="flex flex-col divide-y divide-line">
              {day.rows.map((row) => (
                <OccurrenceRow
                  key={row.key}
                  row={row}
                  members={members}
                  today={today}
                  canToggle={canToggle}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
