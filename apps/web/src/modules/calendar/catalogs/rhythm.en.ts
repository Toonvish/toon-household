import type { LocaleCatalog } from "@toon/shared";
import type { CalendarRhythmCatalog } from "./rhythm.de.ts";

export const calendarRhythmEn: LocaleCatalog<CalendarRhythmCatalog> = {
  "calendar.rhythm.once": "once",
  "calendar.rhythm.daily": { one: "daily", other: "every {count} days" },
  "calendar.rhythm.weekly": { one: "every {days}", other: "every {count} weeks: {days}" },
  "calendar.rhythm.monthly": { one: "monthly on day {day}", other: "every {count} months on day {day}" },
  "calendar.rhythm.yearly": { one: "yearly on {date}", other: "every {count} years on {date}" },
  "calendar.rhythm.until": "{rhythm} until {date}",
};
