import type { CalendarOccurrence } from "@toon/shared";
import { Car, Check, Repeat } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { entryTitle, formatShortDate, wasteListLabel } from "@/modules/calendar/lib/format";
import type { AgendaRow } from "@/modules/calendar/lib/group";
import { memberName, occurrencePeople, type MemberMap } from "@/modules/calendar/lib/people";
import type { OccurrenceStatusChange } from "@/modules/calendar/lib/queries";
import { PersonDot } from "./PersonDot";
import { WasteDot } from "./WasteDot";

/**
 * One line of the agenda, the Today card, the month's day list and the open tasks (design §4.2): the time column,
 * a task's checkbox, the colour dots, the title (a link to the occurrence's detail) and below it who, which car,
 * where. A day's waste pickups arrive as ONE merged row (`Restmüll · Gelber Sack`, design §5.6) whose checkbox
 * ticks all of them. Colour is never the only signal: names and labels are always written.
 */
export interface OccurrenceRowProps {
  row: AgendaRow;
  members: MemberMap;
  /** Car names by resource id. */
  cars?: ReadonlyMap<string, string>;
  today: string;
  /** Show the date in the time column (the overdue list, where rows of several days meet). */
  showDate?: boolean;
  /** Writes allowed now (online, confirmed address); a disabled checkbox keeps the state visible. */
  canToggle: boolean;
  onToggle: (change: OccurrenceStatusChange) => void;
}

export function OccurrenceRow({ row, members, cars, today, showDate = false, canToggle, onToggle }: OccurrenceRowProps) {
  if (row.type === "waste") {
    return <WasteRow occurrences={row.occurrences} members={members} today={today} showDate={showDate} canToggle={canToggle} onToggle={onToggle} />;
  }
  return <SingleRow occurrence={row.occurrence} members={members} cars={cars} today={today} showDate={showDate} canToggle={canToggle} onToggle={onToggle} />;
}

function detailSearch(occurrence: CalendarOccurrence) {
  return { date: occurrence.date };
}

function SingleRow({
  occurrence,
  members,
  cars,
  today,
  showDate,
  canToggle,
  onToggle,
}: {
  occurrence: CalendarOccurrence;
  members: MemberMap;
  cars: ReadonlyMap<string, string> | undefined;
  today: string;
  showDate: boolean;
  canToggle: boolean;
  onToggle: (change: OccurrenceStatusChange) => void;
}) {
  const t = useT();
  const title = entryTitle(occurrence);
  const people = occurrencePeople(occurrence);
  const done = occurrence.status === "done";
  const skipped = occurrence.status === "skipped";
  const car = occurrence.resourceId !== null ? cars?.get(occurrence.resourceId) : undefined;
  const meta: string[] = [];
  if (car !== undefined) meta.push(car);
  if (people.length > 0) meta.push(people.map((id) => memberName(members, id)).join(", "));
  else if (occurrence.kind === "event") meta.push(t("calendar.common.everybody"));
  if (occurrence.location !== null && occurrence.location.length > 0) meta.push(occurrence.location);
  if (done && occurrence.doneBy !== null && occurrence.doneBy !== occurrence.assigneeId) {
    meta.push(t("calendar.common.doneBy", { name: memberName(members, occurrence.doneBy) }));
  }

  return (
    <li className="flex min-w-0 items-start gap-3 py-2">
      <TimeColumn occurrence={occurrence} today={today} showDate={showDate} />
      {occurrence.kind === "task" ? (
        <TaskCheckbox
          checked={done}
          disabled={!canToggle || skipped}
          label={done ? t("calendar.common.markOpen", { title }) : t("calendar.common.markDone", { title })}
          onChange={() => onToggle({ entryId: occurrence.entryId, date: occurrence.date, status: done ? null : "done" })}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
        <div className="flex min-w-0 items-center gap-2">
          {occurrence.kind === "car" ? (
            <Car aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
          ) : (
            people.slice(0, 3).map((id) => <PersonDot key={id} colorIndex={members.get(id)?.colorIndex ?? 1} />)
          )}
          <AppLink
            to="/calendar/entries/$entryId"
            params={{ entryId: occurrence.entryId }}
            search={detailSearch(occurrence)}
            className={cn(
              "min-w-0 font-medium break-words hover:underline",
              done || skipped ? "text-fg-muted line-through" : "text-fg",
            )}
          >
            {title}
          </AppLink>
          {occurrence.recurring ? (
            <Repeat aria-label={t("calendar.common.recurring")} className="size-3.5 shrink-0 text-fg-faint" />
          ) : null}
          {skipped ? (
            <Badge size="sm" variant="neutral">
              {t("calendar.common.status.skipped")}
            </Badge>
          ) : null}
        </div>
        {meta.length > 0 ? <p className="text-sm break-words text-fg-muted">{meta.join(" · ")}</p> : null}
      </div>
    </li>
  );
}

function WasteRow({
  occurrences,
  members,
  today,
  showDate,
  canToggle,
  onToggle,
}: {
  occurrences: ReadonlyArray<CalendarOccurrence>;
  members: MemberMap;
  today: string;
  showDate: boolean;
  canToggle: boolean;
  onToggle: (change: OccurrenceStatusChange) => void;
}) {
  const t = useT();
  const first = occurrences[0];
  if (first === undefined) return null;
  const active = occurrences.filter((occurrence) => occurrence.status !== "skipped");
  const done = active.length > 0 && active.every((occurrence) => occurrence.status === "done");
  const label = wasteListLabel(
    occurrences.flatMap((occurrence) =>
      occurrence.category === null ? [] : [{ category: occurrence.category, detail: occurrence.categoryDetail }],
    ),
  );
  const assignees = [...new Set(occurrences.flatMap((occurrence) => (occurrence.assigneeId === null ? [] : [occurrence.assigneeId])))];

  function toggle() {
    for (const occurrence of active) {
      const next = done ? null : "done";
      if ((occurrence.status === "done") !== (next === "done")) {
        onToggle({ entryId: occurrence.entryId, date: occurrence.date, status: next });
      }
    }
  }

  return (
    <li className="flex min-w-0 items-start gap-3 py-2">
      <TimeColumn occurrence={first} today={today} showDate={showDate} />
      <TaskCheckbox
        checked={done}
        disabled={!canToggle || active.length === 0}
        label={done ? t("calendar.common.markOpen", { title: label }) : t("calendar.common.markDone", { title: label })}
        onChange={toggle}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
        <div className="flex min-w-0 items-center gap-2">
          {occurrences.map((occurrence) =>
            occurrence.category === null ? null : <WasteDot key={occurrence.id} category={occurrence.category} />,
          )}
          <AppLink
            to="/calendar/entries/$entryId"
            params={{ entryId: first.entryId }}
            search={detailSearch(first)}
            className={cn("min-w-0 font-medium break-words hover:underline", done ? "text-fg-muted line-through" : "text-fg")}
          >
            {label}
          </AppLink>
        </div>
        {assignees.length > 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-fg-muted">
            {assignees.map((id) => (
              <PersonDot key={id} colorIndex={members.get(id)?.colorIndex ?? 1} />
            ))}
            {assignees.map((id) => memberName(members, id)).join(", ")}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function TimeColumn({ occurrence, today, showDate }: { occurrence: CalendarOccurrence; today: string; showDate: boolean }) {
  const t = useT();
  return (
    <span className="w-18 shrink-0 pt-1.5 text-sm leading-snug text-fg-muted tabular-nums">
      {showDate ? <span className="block">{formatShortDate(occurrence.date, today)}</span> : null}
      {occurrence.allDay || occurrence.startTime === null ? (
        <span className="block">{t("calendar.common.allDay")}</span>
      ) : (
        <>
          <span className="block text-fg">{occurrence.startTime}</span>
          {occurrence.endTime !== null ? <span className="block text-fg-faint">{occurrence.endTime}</span> : null}
        </>
      )}
    </span>
  );
}

/** A task's checkbox: a 44 px target around a 22 px box, `role="checkbox"` for assistive tech. */
export function TaskCheckbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="-my-1 flex size-11 shrink-0 items-center justify-center rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-55"
    >
      <span
        className={cn(
          "flex size-5.5 items-center justify-center rounded-md border-2 transition-colors duration-150",
          checked ? "border-success bg-success text-brand-fg" : "border-line-strong bg-surface",
        )}
      >
        {checked ? <Check aria-hidden="true" className="size-4" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}
