import type { LocaleCatalog } from "@toon/shared";
import type { CalendarMonthCatalog } from "./month.de.ts";

export const calendarMonthEn: LocaleCatalog<CalendarMonthCatalog> = {
  "calendar.monthView.previous": "Previous month",
  "calendar.monthView.next": "Next month",
  "calendar.monthView.today": "Today",
  "calendar.monthView.more": { one: "+1 more", other: "+{count} more" },
  "calendar.monthView.dayEmpty": "Nothing on this day.",
  "calendar.monthView.dayLabel": { one: "{date}: 1 entry", other: "{date}: {count} entries" },
};
