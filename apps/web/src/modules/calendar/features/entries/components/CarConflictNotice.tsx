import type { CalendarCarConflict } from "@toon/shared";
import { CarFront } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { formatShortDate, formatTimeRange } from "@/modules/calendar/lib/format";
import { memberName, type MemberMap } from "@/modules/calendar/lib/people";

/**
 * The answer to a `409 calendar_car_conflict` (design §4.5, plan m8 P11): who has the car when, and
 * "Trotzdem buchen", which sends the same booking again with `allowConflict: true`.
 */
export function CarConflictNotice({
  conflicts,
  carName,
  members,
  today,
  pending,
  onForce,
}: {
  conflicts: ReadonlyArray<CalendarCarConflict>;
  carName: string;
  members: MemberMap;
  today: string;
  pending: boolean;
  onForce: () => void;
}) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-card border border-warning/40 bg-warning-soft p-3 text-warning-soft-fg">
      <p className="flex items-center gap-2 font-semibold">
        <CarFront aria-hidden="true" className="size-5 shrink-0" />
        {t("calendar.entries.conflict.title")}
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {conflicts.map((conflict) => (
          <li key={`${conflict.entryId}:${conflict.date}`}>
            {t("calendar.entries.conflict.line", {
              car: carName,
              name: conflict.memberIds.length === 0 ? t("calendar.common.nobody") : conflict.memberIds.map((id) => memberName(members, id)).join(", "),
              date: formatShortDate(conflict.date, today),
              time:
                conflict.startTime === null ? t("calendar.common.allDay") : formatTimeRange(conflict.startTime, conflict.endTime),
            })}
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" className="self-start" loading={pending} onClick={onForce}>
        {t("calendar.entries.conflict.force")}
      </Button>
    </div>
  );
}
