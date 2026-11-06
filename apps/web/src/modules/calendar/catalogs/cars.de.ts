import type { NamespaceCatalog } from "@toon/shared";

/** Autos (`/calendar/cars`, design §4.1; plan m8 P13). */
export const calendarCarsDe = {
  "calendar.cars.title": "Autos",
  "calendar.cars.description": "Wer braucht wann das Auto?",
  "calendar.cars.add.label": "Neues Auto",
  "calendar.cars.add.placeholder": "z. B. Familienauto",
  "calendar.cars.add.submit": "Hinzufügen",
  "calendar.cars.toast.added": "Auto hinzugefügt.",
  "calendar.cars.toast.saved": "Gespeichert.",
  "calendar.cars.toast.deleted": "Auto gelöscht.",
  "calendar.cars.empty.title": "Noch kein Auto",
  "calendar.cars.empty.description": "Leg euer Auto an, dann könnt ihr es buchen.",
  "calendar.cars.book": "Auto buchen",
  "calendar.cars.rename": "Umbenennen",
  "calendar.cars.renameTitle": "Auto umbenennen",
  "calendar.cars.archive": "Archivieren",
  "calendar.cars.restore": "Wiederherstellen",
  "calendar.cars.archived": "archiviert",
  "calendar.cars.delete": "Löschen",
  "calendar.cars.deleteConfirm": "„{name}“ löschen?",
  "calendar.cars.inUse": "Das Auto hat Buchungen. Archiviere es stattdessen.",
  "calendar.cars.upcoming": "Nächste Buchungen",
  "calendar.cars.noBookings": "Keine Buchungen in den nächsten 30 Tagen.",
} as const satisfies NamespaceCatalog<"calendar">;

export type CalendarCarsCatalog = typeof calendarCarsDe;
