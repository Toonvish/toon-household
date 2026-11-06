import type { NamespaceCatalog } from "@toon/shared";

/** Aufgaben (`/calendar/tasks`, design §4.4). */
export const calendarTasksDe = {
  "calendar.tasks.title": "Aufgaben",
  "calendar.tasks.open": "Offen",
  "calendar.tasks.openEmpty": "Keine offenen Aufgaben. Schön!",
  "calendar.tasks.recurring": "Wiederkehrend",
  "calendar.tasks.recurringEmpty": "Noch keine wiederkehrenden Aufgaben.",
  "calendar.tasks.newTask": "Aufgabe anlegen",
  "calendar.tasks.next": "Nächste: {date}",
  "calendar.tasks.nextWho": "Nächste: {date}, {name}",
  "calendar.tasks.rotationOrder": "Reihenfolge",
  "calendar.tasks.waste": "Müllabfuhr",
} as const satisfies NamespaceCatalog<"calendar">;

export type CalendarTasksCatalog = typeof calendarTasksDe;
