import type { CalendarWastePickup } from "@toon/shared";
import { formatShortDate, wasteLabel } from "@/modules/calendar/lib/format";
import { WasteDot } from "./WasteDot";

/** The next pickup per waste type (design §4.4): dot, label, date. */
export function PickupList({ pickups, today }: { pickups: ReadonlyArray<CalendarWastePickup>; today: string }) {
  return (
    <ul className="flex flex-col gap-2">
      {pickups.map((pickup) => (
        <li key={pickup.category} className="flex min-w-0 items-center gap-2.5 text-sm">
          <WasteDot category={pickup.category} />
          <span className="min-w-0 flex-1 text-fg">{wasteLabel(pickup.category, pickup.detail)}</span>
          <span className="shrink-0 text-fg-muted tabular-nums">{formatShortDate(pickup.date, today)}</span>
        </li>
      ))}
    </ul>
  );
}
