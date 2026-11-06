import type { NamespaceCatalog } from "@toon/shared";

/** Tabs Übersicht · Monat · Aufgaben (the shell appends Profil), sidebar-only Autos · Müllabfuhr (ADR 0016, D6). */
export const calendarNavDe = {
  "calendar.nav.overview": "Übersicht",
  "calendar.nav.month": "Monat",
  "calendar.nav.tasks": "Aufgaben",
  "calendar.nav.cars": "Autos",
  "calendar.nav.waste": "Müllabfuhr",
} as const satisfies NamespaceCatalog<"calendar">;

export type CalendarNavCatalog = typeof calendarNavDe;
