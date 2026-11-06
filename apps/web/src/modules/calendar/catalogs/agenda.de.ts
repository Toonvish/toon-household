import type { NamespaceCatalog } from "@toon/shared";

/** Übersicht (`/calendar`, design §4.2): the agenda, the Today card, the car and pickup cards. */
export const calendarAgendaDe = {
  "calendar.agenda.title": "Übersicht",
  "calendar.agenda.overdue": "Überfällig",
  "calendar.agenda.empty.title": "Nichts geplant",
  "calendar.agenda.empty.description": "In den nächsten 14 Tagen steht nichts an.",
  "calendar.agenda.today.empty": "Heute steht nichts an.",
  "calendar.agenda.cars.title": "Autos",
  "calendar.agenda.cars.manage": "Autos verwalten",
  "calendar.agenda.cars.none": "Noch kein Auto angelegt.",
  "calendar.agenda.cars.free": "frei",
  "calendar.agenda.cars.freeToday": "{car} ist heute frei",
  "calendar.agenda.cars.next": "nächste Buchung: {date}",
  "calendar.agenda.pickups.title": "Nächste Abholungen",
} as const satisfies NamespaceCatalog<"calendar">;

export type CalendarAgendaCatalog = typeof calendarAgendaDe;
