import type { CalendarEntry, CalendarMember } from "@toon/shared";
import { Repeat } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { PersonDot } from "@/modules/calendar/components/PersonDot";
import { entryTitle, formatShortDate } from "@/modules/calendar/lib/format";
import { memberName, type MemberMap } from "@/modules/calendar/lib/people";
import { nextAssignment, rhythmLabel } from "@/modules/calendar/lib/rhythm";

/**
 * Aufgaben "Wiederkehrend" (design §4.4): every task series with its rhythm in words, its next date and person,
 * and a rotation's order with the next one marked. Every series is listed, also one with no date in sight
 * (`GET /entries`, plan m8 P9b).
 */
export function TaskSeries({
  entries,
  members,
  today,
}: {
  entries: ReadonlyArray<CalendarEntry>;
  members: ReadonlyArray<CalendarMember>;
  today: string;
}) {
  const t = useT();
  const byId: MemberMap = new Map(members.map((member) => [member.userId, member]));
  return (
    <section aria-labelledby="calendar-tasks-recurring" className="flex min-w-0 flex-col gap-3">
      <h2 id="calendar-tasks-recurring" className="font-display text-display-md font-medium text-fg">
        {t("calendar.tasks.recurring")}
      </h2>
      {entries.length === 0 ? (
        <EmptyState icon={<Repeat />} title={t("calendar.tasks.recurringEmpty")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => {
            const next = nextAssignment(entry, today);
            return (
              <li key={entry.id}>
                <Card padding="sm" className="flex min-w-0 flex-col gap-1.5">
                  <AppLink
                    to="/calendar/entries/$entryId"
                    params={{ entryId: entry.id }}
                    search={next ? { date: next.date } : undefined}
                    className="font-medium break-words text-fg hover:underline"
                  >
                    {entryTitle(entry)}
                  </AppLink>
                  <p className="text-sm text-fg-muted">{rhythmLabel(entry.repeat, entry.startDate, today)}</p>
                  {next ? (
                    <p className="text-sm text-fg">
                      {next.userId === null
                        ? t("calendar.tasks.next", { date: formatShortDate(next.date, today) })
                        : t("calendar.tasks.nextWho", { date: formatShortDate(next.date, today), name: memberName(byId, next.userId) })}
                    </p>
                  ) : null}
                  {entry.assigneeMode === "rotate" ? (
                    <div className="flex flex-wrap items-center gap-1.5" aria-label={t("calendar.tasks.rotationOrder")}>
                      {entry.assigneeIds.map((id, index) => (
                        <span
                          key={id}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm",
                            next?.userId === id
                              ? "border-brand bg-brand-soft font-semibold text-brand-soft-fg"
                              : "border-line text-fg-muted",
                          )}
                        >
                          <span className="tabular-nums">{index + 1}.</span>
                          <PersonDot colorIndex={byId.get(id)?.colorIndex ?? 1} />
                          {memberName(byId, id)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
