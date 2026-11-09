import type { NamespaceCatalog } from "@toon/shared";

/** Tabs Übersicht · Monat · Aufgaben (the shell appends Profil), sidebar-only Autos · Müllabfuhr · Kalender-Abo (ADR 0016, D6; plan m9 P16). */
export const calendarNavDe = {
  "calendar.nav.overview": "Übersicht",
  "calendar.nav.month": "Monat",
  "calendar.nav.tasks": "Aufgaben",
  "calendar.nav.cars": "Autos",
  "calendar.nav.waste": "Müllabfuhr",
  "calendar.nav.feed": "Kalender-Abo",
} as const satisfies NamespaceCatalog<"calendar">;

export type CalendarNavCatalog = typeof calendarNavDe;
