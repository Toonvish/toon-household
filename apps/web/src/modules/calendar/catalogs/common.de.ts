import type { NamespaceCatalog } from "@toon/shared";

/**
 * The calendar module's shared strings (new German, ADR 0016: `NEW_GERMAN_NAMESPACES` admits `calendar.`): the
 * module name, the words every screen uses, the weekday and month names `lib/format.ts` builds its labels from,
 * and the date templates (a template per locale, so the order of day and month is the catalog's).
 */
export const calendarCommonDe = {
  "calendar.module.name": "Kalender",

  "calendar.common.new": "Neu",
  "calendar.common.newEntry": "Neuer Eintrag",
  "calendar.common.allDay": "ganztägig",
  "calendar.common.everybody": "Alle",
  "calendar.common.nobody": "Niemand",
  "calendar.common.formerMember": "Ehemaliges Mitglied",
  "calendar.common.untitled": "Ohne Titel",
  "calendar.common.today": "Heute",
  "calendar.common.tomorrow": "Morgen",
  "calendar.common.save": "Speichern",
  "calendar.common.cancel": "Abbrechen",
  "calendar.common.delete": "Löschen",
  "calendar.common.edit": "Bearbeiten",
  "calendar.common.back": "Zurück",
  "calendar.common.unsavedWarning": "Ungespeicherte Änderungen verwerfen?",
  "calendar.common.discard": "Verwerfen",
  "calendar.common.recurring": "wiederkehrend",
  "calendar.common.timeRange": "{start}–{end}",
  "calendar.common.timeFrom": "ab {start}",
  "calendar.common.dateRange": "{from} bis {to}",
  "calendar.common.markDone": "„{title}“ als erledigt markieren",
  "calendar.common.markOpen": "„{title}“ wieder öffnen",
  "calendar.common.status.done": "erledigt",
  "calendar.common.status.skipped": "übersprungen",
  "calendar.common.doneBy": "erledigt von {name}",
  "calendar.common.nextUp": "als Nächstes: {name}",
  "calendar.common.kind.event": "Termin",
  "calendar.common.kind.task": "Aufgabe",
  "calendar.common.kind.car": "Auto",
  "calendar.common.filterLabel": "Für wen",
  "calendar.common.loadError": "Der Kalender konnte nicht geladen werden.",

  "calendar.weekday.short.MO": "Mo",
  "calendar.weekday.short.TU": "Di",
  "calendar.weekday.short.WE": "Mi",
  "calendar.weekday.short.TH": "Do",
  "calendar.weekday.short.FR": "Fr",
  "calendar.weekday.short.SA": "Sa",
  "calendar.weekday.short.SU": "So",
  "calendar.weekday.long.MO": "Montag",
  "calendar.weekday.long.TU": "Dienstag",
  "calendar.weekday.long.WE": "Mittwoch",
  "calendar.weekday.long.TH": "Donnerstag",
  "calendar.weekday.long.FR": "Freitag",
  "calendar.weekday.long.SA": "Samstag",
  "calendar.weekday.long.SU": "Sonntag",

  "calendar.month.1": "Januar",
  "calendar.month.2": "Februar",
  "calendar.month.3": "März",
  "calendar.month.4": "April",
  "calendar.month.5": "Mai",
  "calendar.month.6": "Juni",
  "calendar.month.7": "Juli",
  "calendar.month.8": "August",
  "calendar.month.9": "September",
  "calendar.month.10": "Oktober",
  "calendar.month.11": "November",
  "calendar.month.12": "Dezember",

  /** `Fr 13.11.` */
  "calendar.format.shortDate": "{weekday} {day}.{month}.",
  /** `Fr 13.11.2028` (another year than today's) */
  "calendar.format.shortDateYear": "{weekday} {day}.{month}.{year}",
  /** `Mittwoch, 11. November` */
  "calendar.format.longDate": "{weekday}, {day}. {month}",
  /** `November 2026` */
  "calendar.format.monthTitle": "{month} {year}",
  /** `Heute · Mittwoch, 11. November` */
  "calendar.format.relativeDay": "{relative} · {date}",
  "calendar.format.time": "{time} Uhr",
  /** `13.11.` (the yearly rhythm) */
  "calendar.format.dayMonth": "{day}.{month}.",
} as const satisfies NamespaceCatalog<"calendar">;

export type CalendarCommonCatalog = typeof calendarCommonDe;
