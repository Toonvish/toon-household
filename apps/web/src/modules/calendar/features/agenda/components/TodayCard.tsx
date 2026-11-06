import type { CalendarOccurrence, CalendarResource } from "@toon/shared";
import { Car } from "lucide-react";
import { Card } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { OccurrenceRow } from "@/modules/calendar/components/OccurrenceRow";
import { WasteDot } from "@/modules/calendar/components/WasteDot";
import { formatLongDate, formatTimeRange, wasteLabel } from "@/modules/calendar/lib/format";
import { agendaRows, coversDate, occurrencesOn, tonightPickups } from "@/modules/calendar/lib/group";
import { memberName, type MemberMap } from "@/modules/calendar/lib/people";
import type { OccurrenceStatusChange } from "@/modules/calendar/lib/queries";

/**
 * The Today card (design §4.2): today's date in the display face, today's rows, "Heute Abend rausstellen" when
 * tomorrow has pickups, and each car's status today with the link to Autos (the phone's way there, design §4.1).
 */
export function TodayCard({
  today,
  items,
  allItems,
  members,
  cars,
  carNames,
  canToggle,
  onToggle,
}: {
  today: string;
  /** The member-filtered list. */
  items: ReadonlyArray<CalendarOccurrence>;
  /** The unfiltered list: tonight's pickups and the cars are the household's, whoever is selected. */
  allItems: ReadonlyArray<CalendarOccurrence>;
  members: MemberMap;
  cars: ReadonlyArray<CalendarResource>;
  carNames: ReadonlyMap<string, string>;
  canToggle: boolean;
  onToggle: (change: OccurrenceStatusChange) => void;
}) {
  const t = useT();
  const rows = agendaRows(occurrencesOn(items, today));
  const tonight = tonightPickups(allItems, today);

  return (
    <Card as="section" aria-labelledby="calendar-today" className="flex min-w-0 flex-col gap-3">
      <div>
        <p className="eyebrow text-brand">{t("calendar.common.today")}</p>
        <h2 id="calendar-today" className="font-display text-display-md font-medium text-fg">
          {formatLongDate(today)}
        </h2>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("calendar.agenda.today.empty")}</p>
      ) : (
        <ul className="flex flex-col">
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

      {tonight.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <p className="text-sm font-semibold text-fg">{t("calendar.waste.tonight")}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg">
            {tonight.map((category) => (
              <span key={category} className="inline-flex items-center gap-1.5">
                <WasteDot category={category} />
                {wasteLabel(category)}
              </span>
            ))}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        {cars.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("calendar.agenda.cars.none")}</p>
        ) : (
          cars.map((car) => {
            const bookings = allItems.filter((item) => item.kind === "car" && item.resourceId === car.id && coversDate(item, today));
            return (
              <p key={car.id} className="flex min-w-0 items-start gap-2 text-sm text-fg">
                <Car aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                <span className="min-w-0 break-words">
                  {bookings.length === 0
                    ? t("calendar.agenda.cars.freeToday", { car: car.name })
                    : bookings
                        .map((booking) =>
                          [
                            car.name,
                            booking.memberIds.map((id) => memberName(members, id)).join(", "),
                            booking.allDay ? t("calendar.common.allDay") : formatTimeRange(booking.startTime, booking.endTime),
                          ]
                            .filter((part) => part.length > 0)
                            .join(" · "),
                        )
                        .join("; ")}
                </span>
              </p>
            );
          })
        )}
        <AppLink to="/calendar/cars" className="self-start text-sm font-semibold text-brand hover:underline">
          {t("calendar.agenda.cars.manage")}
        </AppLink>
      </div>
    </Card>
  );
}
