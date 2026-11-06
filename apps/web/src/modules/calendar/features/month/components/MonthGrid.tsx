import { CALENDAR_WEEKDAYS, type CalendarOccurrence } from "@toon/shared";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { entryTitle, formatLongDate, wasteListLabel, weekdayShortName } from "@/modules/calendar/lib/format";
import { agendaRows, isWeekend, occurrencesOn, type AgendaRow } from "@/modules/calendar/lib/group";
import { occurrencePeople, personColorClass, wasteColorClass, type MemberMap } from "@/modules/calendar/lib/people";

/** At most this many dots (phone) or chips (desktop) per day; the rest is "+N weitere". */
const PER_DAY = 3;

/**
 * The month grid (design §4.3): seven columns, Monday first, whole ISO weeks. Every cell is ONE button that selects
 * its day: the day number, up to three dots on phones (person colour, waste colour, a car in `--fg-muted`), up to
 * three chips with a colour bar from `lg` and "+N weitere". Today is ringed in `--brand`, the selected day filled
 * `--brand-soft`, weekends sit on `--bg-sunken`, days of the neighbouring months are faint.
 */
export function MonthGrid({
  month,
  days,
  items,
  members,
  today,
  selected,
  onSelect,
}: {
  month: string;
  days: ReadonlyArray<string>;
  items: ReadonlyArray<CalendarOccurrence>;
  members: MemberMap;
  today: string;
  selected: string;
  onSelect: (date: string) => void;
}) {
  const t = useT();
  return (
    <div className="min-w-0">
      <div aria-hidden="true" className="grid grid-cols-7 gap-1 pb-1">
        {CALENDAR_WEEKDAYS.map((code) => (
          <span key={code} className="eyebrow text-center text-fg-faint">
            {weekdayShortName(code)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((date) => {
          const rows = agendaRows(occurrencesOn(items, date));
          const inMonth = date.startsWith(month);
          const isSelected = date === selected;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              aria-pressed={isSelected}
              aria-label={t("calendar.monthView.dayLabel", { date: formatLongDate(date), count: rows.length })}
              className={cn(
                "flex min-h-14 min-w-0 flex-col items-stretch gap-1 overflow-hidden rounded-control p-1 text-left lg:min-h-28 lg:p-1.5",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                isSelected ? "bg-brand-soft" : isWeekend(date) ? "bg-bg-sunken" : "bg-surface",
                date === today && "ring-2 ring-brand",
              )}
            >
              <span
                className={cn(
                  "text-sm tabular-nums",
                  date === today ? "font-bold text-brand" : inMonth ? "font-medium text-fg" : "text-fg-faint",
                )}
              >
                {Number(date.slice(8, 10))}
              </span>
              <span className="flex flex-wrap gap-1 lg:hidden">
                {dotClasses(rows, members)
                  .slice(0, PER_DAY)
                  .map((dot, index) => (
                    <span key={`${dot}-${index}`} aria-hidden="true" className={cn("size-2 rounded-full", dot)} />
                  ))}
              </span>
              <span className="hidden min-w-0 flex-col gap-0.5 lg:flex">
                {rows.slice(0, PER_DAY).map((row) => (
                  <DayChip key={row.key} row={row} members={members} />
                ))}
                {rows.length > PER_DAY ? (
                  <span className="truncate text-xs text-fg-muted">{t("calendar.monthView.more", { count: rows.length - PER_DAY })}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The colour of one row's marker: the first person, the waste type, or a car's muted grey. */
function rowColor(row: AgendaRow, members: MemberMap): string {
  if (row.type === "waste") {
    const category = row.occurrences[0]?.category;
    return category ? wasteColorClass(category) : "bg-fg-muted";
  }
  if (row.occurrence.kind === "car") return "bg-fg-muted";
  const first = occurrencePeople(row.occurrence)[0];
  return first === undefined ? "bg-brand" : personColorClass(members.get(first)?.colorIndex ?? 1);
}

/** One dot per row, a merged waste row giving one dot per type. */
function dotClasses(rows: ReadonlyArray<AgendaRow>, members: MemberMap): string[] {
  return rows.flatMap((row) =>
    row.type === "waste"
      ? row.occurrences.flatMap((occurrence) => (occurrence.category ? [wasteColorClass(occurrence.category)] : []))
      : [rowColor(row, members)],
  );
}

function DayChip({ row, members }: { row: AgendaRow; members: MemberMap }) {
  const label =
    row.type === "waste"
      ? wasteListLabel(row.occurrences.flatMap((o) => (o.category ? [{ category: o.category, detail: o.categoryDetail }] : [])))
      : entryTitle(row.occurrence);
  const time = row.type === "occurrence" && !row.occurrence.allDay ? row.occurrence.startTime : null;
  return (
    <span className="flex min-w-0 items-stretch gap-1 rounded-sm bg-surface-2 text-xs text-fg">
      <span aria-hidden="true" className={cn("w-0.75 shrink-0 rounded-l-sm", rowColor(row, members))} />
      <span className="min-w-0 truncate py-0.5 pr-1">
        {time !== null ? <span className="tabular-nums text-fg-muted">{time} </span> : null}
        {label}
      </span>
    </span>
  );
}
