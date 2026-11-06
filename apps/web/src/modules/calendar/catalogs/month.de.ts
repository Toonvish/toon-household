import type { NamespaceCatalog } from "@toon/shared";

/** Monat (`/calendar/month`, design §4.3). `calendar.month.<n>` are the month NAMES (common); the screen is `monthView`. */
export const calendarMonthDe = {
  "calendar.monthView.previous": "Vorheriger Monat",
  "calendar.monthView.next": "Nächster Monat",
  "calendar.monthView.today": "Heute",
  "calendar.monthView.more": { one: "+1 weiterer", other: "+{count} weitere" },
  "calendar.monthView.dayEmpty": "An diesem Tag steht nichts an.",
  "calendar.monthView.dayLabel": { one: "{date}: 1 Eintrag", other: "{date}: {count} Einträge" },
} as const satisfies NamespaceCatalog<"calendar">;

export type CalendarMonthCatalog = typeof calendarMonthDe;
