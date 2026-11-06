import type { CalendarOccurrence } from "@toon/shared";
import { Card } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { DayHeading } from "@/modules/calendar/components/DayHeading";
import { OccurrenceRow } from "@/modules/calendar/components/OccurrenceRow";
import { agendaRows, occurrencesOn } from "@/modules/calendar/lib/group";
import type { MemberMap } from "@/modules/calendar/lib/people";
import type { OccurrenceStatusChange } from "@/modules/calendar/lib/queries";

/** The selected day's rows (design §4.3): below the grid on phones, the side panel from `lg`. */
export function DayList({
  date,
  today,
  items,
  members,
  carNames,
  canToggle,
  onToggle,
}: {
  date: string;
  today: string;
  items: ReadonlyArray<CalendarOccurrence>;
  members: MemberMap;
  carNames: ReadonlyMap<string, string>;
  canToggle: boolean;
  onToggle: (change: OccurrenceStatusChange) => void;
}) {
  const t = useT();
  const rows = agendaRows(occurrencesOn(items, date));
  return (
    <Card as="section" aria-labelledby="calendar-day-list" className="flex min-w-0 flex-col gap-2">
      <DayHeading id="calendar-day-list" date={date} today={today} />
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("calendar.monthView.dayEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((row) => (
            <OccurrenceRow
              key={row.key}
              row={row}
              members={members}
              cars={carNames}
              today={today}
              canToggle={canToggle}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
