/**
 * The calendar module's card on Home (SPEC §5, design §4.7): HEUTE and MORGEN with at most four rows together
 * (time, title, person), the "Heute Abend rausstellen" line when tomorrow has pickups, and the two buttons
 * Kalender / + Neu. Titles and names are content: never `t()`, never cut so that the person is hidden.
 *
 * Static manifest graph: only `@/components/ui`, `@/lib/*`, lucide and the module's `lib/` and dots; never the
 * module registry, the layout components or `CalendarPageHeader` (it renders `PhoneHeaderRow`).
 */
import { useQuery } from "@tanstack/react-query";
import { addCalendarDays, todayPlanDate } from "@toon/shared";
import { CalendarDays, Plus } from "lucide-react";
import type { ReactElement } from "react";
import { Card, Skeleton, buttonClasses } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { useActiveHousehold } from "@/lib/session";
import { PersonDot } from "@/modules/calendar/components/PersonDot";
import { WasteDot } from "@/modules/calendar/components/WasteDot";
import { entryTitle, wasteLabel, wasteListLabel } from "@/modules/calendar/lib/format";
import { agendaRows, occurrencesOn, tonightPickups, type AgendaRow } from "@/modules/calendar/lib/group";
import { memberMap, memberName, occurrencePeople, type MemberMap } from "@/modules/calendar/lib/people";
import { occurrencesQuery } from "@/modules/calendar/lib/queries";

/** At most this many rows for today and tomorrow together (design §4.7). */
const MAX_ROWS = 4;

export function CalendarHomeCard(): ReactElement {
  const t = useT();
  const { householdId } = useActiveHousehold();
  const today = todayPlanDate();
  const tomorrow = addCalendarDays(today, 1);
  const query = useQuery({ ...occurrencesQuery(householdId ?? "", today, tomorrow), enabled: householdId !== null });

  const items = query.data?.items ?? [];
  const members = memberMap(query.data?.members ?? []);
  const days = [
    { date: today, label: t("calendar.common.today"), rows: agendaRows(occurrencesOn(items, today)) },
    { date: tomorrow, label: t("calendar.common.tomorrow"), rows: agendaRows(occurrencesOn(items, tomorrow)) },
  ];
  let budget = MAX_ROWS;
  const shown = days.map((day) => {
    const rows = day.rows.slice(0, Math.max(0, budget));
    budget -= rows.length;
    return { ...day, rows, hidden: day.rows.length - rows.length };
  });
  const hidden = shown.reduce((sum, day) => sum + day.hidden, 0);
  const tonight = tonightPickups(items, today);

  return (
    <Card as="section" aria-labelledby="home-card-calendar" className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-fg"
        >
          <CalendarDays className="size-5" />
        </span>
        <h2 id="home-card-calendar" className="min-w-0 font-display text-display-md font-medium text-fg">
          <AppLink to="/calendar" className="hover:underline">
            {t("calendar.module.name")}
          </AppLink>
        </h2>
      </div>

      {query.isPending && householdId !== null ? (
        <Skeleton lines={3} />
      ) : shown.every((day) => day.rows.length === 0) ? (
        <p className="text-sm text-fg-muted">{t("calendar.home.empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((day) =>
            day.rows.length === 0 ? null : (
              <div key={day.date} className="flex flex-col gap-1.5">
                <p className="eyebrow text-fg-faint">{day.label}</p>
                <ul className="flex flex-col gap-1.5">
                  {day.rows.map((row) => (
                    <HomeRow key={row.key} row={row} members={members} />
                  ))}
                </ul>
              </div>
            ),
          )}
          {hidden > 0 ? <p className="text-sm text-fg-muted">{t("calendar.home.more", { count: hidden })}</p> : null}
        </div>
      )}

      {tonight.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-sm text-fg">
          <span className="font-semibold">{t("calendar.waste.tonight")}</span>
          {tonight.map((category) => (
            <span key={category} className="inline-flex items-center gap-1.5">
              <WasteDot category={category} />
              {wasteLabel(category)}
            </span>
          ))}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <AppLink to="/calendar" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          {t("calendar.home.open")}
        </AppLink>
        <AppLink to="/calendar/new" search={{ date: today }} className={buttonClasses({ variant: "secondary", size: "sm" })}>
          <Plus aria-hidden="true" className="size-4" />
          {t("calendar.common.new")}
        </AppLink>
      </div>
    </Card>
  );
}

function HomeRow({ row, members }: { row: AgendaRow; members: MemberMap }) {
  const t = useT();
  if (row.type === "waste") {
    const label = wasteListLabel(
      row.occurrences.flatMap((o) => (o.category === null ? [] : [{ category: o.category, detail: o.categoryDetail }])),
    );
    return (
      <li className="flex min-w-0 items-center gap-2 text-sm">
        <span className="w-16 shrink-0 text-fg-muted">{t("calendar.common.allDay")}</span>
        {row.occurrences.map((o) => (o.category === null ? null : <WasteDot key={o.id} category={o.category} />))}
        <span className="min-w-0 break-words text-fg">{label}</span>
      </li>
    );
  }
  const occurrence = row.occurrence;
  const people = occurrencePeople(occurrence);
  return (
    <li className="flex min-w-0 items-start gap-2 text-sm">
      <span className="w-16 shrink-0 text-fg-muted tabular-nums">
        {occurrence.allDay || occurrence.startTime === null ? t("calendar.common.allDay") : occurrence.startTime}
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
        {people.slice(0, 3).map((id) => (
          <PersonDot key={id} colorIndex={members.get(id)?.colorIndex ?? 1} />
        ))}
        <span className="min-w-0 break-words text-fg">{entryTitle(occurrence)}</span>
        {people.length > 0 ? (
          <span className="text-fg-muted">{people.map((id) => memberName(members, id)).join(", ")}</span>
        ) : null}
      </span>
    </li>
  );
}

export default CalendarHomeCard;
