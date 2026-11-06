import type { CalendarOccurrence, CalendarResource } from "@toon/shared";
import { Car } from "lucide-react";
import { Card } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { formatShortDate, formatTimeRange } from "@/modules/calendar/lib/format";
import { coversDate } from "@/modules/calendar/lib/group";
import { memberName, type MemberMap } from "@/modules/calendar/lib/people";

/** The desktop rail's "Autos" card (design §4.2): each car with its current or next booking, then Autos verwalten. */
export function CarStatusCard({
  today,
  cars,
  items,
  members,
}: {
  today: string;
  cars: ReadonlyArray<CalendarResource>;
  items: ReadonlyArray<CalendarOccurrence>;
  members: MemberMap;
}) {
  const t = useT();
  return (
    <Card as="section" aria-labelledby="calendar-cars-card" className="flex min-w-0 flex-col gap-3">
      <h2 id="calendar-cars-card" className="font-display text-display-sm font-medium text-fg">
        {t("calendar.agenda.cars.title")}
      </h2>
      {cars.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("calendar.agenda.cars.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {cars.map((car) => {
            const bookings = items.filter((item) => item.kind === "car" && item.resourceId === car.id && item.endDate >= today);
            const current = bookings.find((booking) => coversDate(booking, today));
            const next = current ?? bookings[0];
            const who = next ? next.memberIds.map((id) => memberName(members, id)).join(", ") : "";
            return (
              <li key={car.id} className="flex min-w-0 items-start gap-2.5 text-sm">
                <Car aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-fg">{car.name}</span>
                  <span className="break-words text-fg-muted">
                    {next === undefined
                      ? t("calendar.agenda.cars.free")
                      : current !== undefined
                        ? [who, current.allDay ? t("calendar.common.allDay") : formatTimeRange(current.startTime, current.endTime)]
                            .filter((part) => part.length > 0)
                            .join(" · ")
                        : [who, t("calendar.agenda.cars.next", { date: formatShortDate(next.date, today) })]
                            .filter((part) => part.length > 0)
                            .join(" · ")}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <AppLink to="/calendar/cars" className="self-start text-sm font-semibold text-brand hover:underline">
        {t("calendar.agenda.cars.manage")}
      </AppLink>
    </Card>
  );
}
