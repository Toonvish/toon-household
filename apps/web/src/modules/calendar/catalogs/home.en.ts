import type { LocaleCatalog } from "@toon/shared";
import type { CalendarHomeCatalog } from "./home.de.ts";

export const calendarHomeEn: LocaleCatalog<CalendarHomeCatalog> = {
  "calendar.home.empty": "Nothing on today or tomorrow.",
  "calendar.home.open": "Calendar",
  "calendar.home.more": { one: "and 1 more entry", other: "and {count} more entries" },
};
