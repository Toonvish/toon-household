import type { NamespaceCatalog } from "@toon/shared";

/**
 * Kalender-Abo (`/calendar/feed`, plan m9 P16, P19): the member's own subscription link for the phone calendar, the
 * setup per platform and the management of an existing link. New German, admitted by namespace (ADR 0016).
 */
export const calendarFeedDe = {
  "calendar.feed.title": "Kalender-Abo",
  "calendar.feed.description": "Die Termine des Haushalts im Kalender deines Handys.",
  "calendar.feed.offline": "Für das Kalender-Abo brauchst du eine Verbindung.",

  "calendar.feed.agendaLink": "Kalender-Abo",
  "calendar.feed.agendaHint": "Termine im Kalender deines Handys",

  "calendar.feed.intro":
    "Mit einem Abo-Link zeigt der Kalender auf deinem Handy die Termine, Aufgaben, Autobuchungen und Abholtage des Haushalts. Er hält sich von selbst aktuell. Ändern kannst du dort nichts, nur hier in der App.",
  "calendar.feed.scope.label": "Was soll im Abo stehen?",
  "calendar.feed.scope.all": "Alle Termine des Haushalts",
  "calendar.feed.scope.allHint": "Alles, was im Kalender steht.",
  "calendar.feed.scope.mine": "Nur meine Termine",
  "calendar.feed.scope.mineHint": "Was alle betrifft, und alles, wofür du eingetragen bist.",
  "calendar.feed.create": "Link erstellen",
  "calendar.feed.createdToast": "Dein Abo-Link ist fertig.",

  "calendar.feed.privacy.title": "Nur für dich",
  "calendar.feed.privacy.text":
    "Der Link ist persönlich und funktioniert ohne Passwort: Wer ihn hat, sieht eure Termine. Gib ihn nicht weiter. Ist er doch in falsche Hände geraten, erzeuge einen neuen.",

  "calendar.feed.link.title": "Dein Abo-Link",
  "calendar.feed.link.label": "Abo-Link",
  "calendar.feed.link.once": "Der Link wird nur jetzt angezeigt. Richte das Abo gleich ein oder kopiere ihn.",
  "calendar.feed.link.copy": "Kopieren",
  "calendar.feed.link.copied": "Link kopiert.",
  "calendar.feed.link.copyFailed": "Kopieren hat nicht geklappt. Markiere den Link und kopiere ihn von Hand.",
  "calendar.feed.link.connect": "Mit iPhone-Kalender verbinden",

  "calendar.feed.setup.title": "So richtest du das Abo ein",
  "calendar.feed.setup.ios.title": "iPhone und iPad",
  "calendar.feed.setup.ios.button": "Tippe auf „Mit iPhone-Kalender verbinden“ und dann auf „Abonnieren“.",
  "calendar.feed.setup.ios.manual":
    "Oder von Hand: Einstellungen > Kalender > Accounts > Account hinzufügen > Andere > Kalenderabo hinzufügen. Dort den Link einfügen.",
  "calendar.feed.setup.ios.newer": "Ab iOS 18 findest du den Kalender in den Einstellungen unter „Apps“.",
  "calendar.feed.setup.android.title": "Android und Samsung",
  "calendar.feed.setup.android.app": "Installiere die kostenlose App ICSx⁵:",
  "calendar.feed.setup.android.playStore": "Play Store",
  "calendar.feed.setup.android.fdroid": "F-Droid",
  "calendar.feed.setup.android.add":
    "Öffne ICSx⁵, tippe auf +, füge den Link ein und wähle, wie oft das Abo aktualisiert werden soll.",
  "calendar.feed.setup.android.show":
    "Danach zeigen Samsung Kalender und Google Kalender die Termine an. Falls nicht, schalte den Kalender in der Kalender-App unter den angezeigten Kalendern ein.",
  "calendar.feed.setup.google.title": "Google Kalender im Browser",
  "calendar.feed.setup.google.steps":
    "Öffne calendar.google.com, klicke links bei „Weitere Kalender“ auf + und dann auf „Per URL“. Füge den Link ein.",
  "calendar.feed.setup.google.slow": "Google holt Änderungen nur alle paar Stunden ab. Auf dem Handy ist ICSx⁵ schneller.",
  "calendar.feed.setup.desktop.title": "Outlook und Mac",
  "calendar.feed.setup.desktop.steps":
    "Outlook: Kalender hinzufügen > Aus dem Internet abonnieren. Mac: In der App Kalender Ablage > Neues Kalenderabonnement. Jeweils den Link einfügen.",

  "calendar.feed.manage.title": "Dein Abo",
  "calendar.feed.manage.created": "Erstellt am {date}",
  "calendar.feed.manage.lastUsed": "Zuletzt abgerufen: {date}",
  "calendar.feed.manage.neverUsed": "Noch nicht abgerufen",
  "calendar.feed.manage.neverUsedHint": "Sobald dein Kalender das Abo zum ersten Mal lädt, steht hier, wann.",
  "calendar.feed.manage.linkHidden":
    "Der Link wird nur beim Erstellen angezeigt. Brauchst du ihn noch einmal, erzeuge einen neuen und richte das Abo damit neu ein.",
  "calendar.feed.manage.scopeSaved": "Gespeichert. Dein Kalender übernimmt es beim nächsten Abruf.",

  "calendar.feed.rotate.action": "Neuen Link erzeugen",
  "calendar.feed.rotate.title": "Neuen Link erzeugen?",
  "calendar.feed.rotate.description":
    "Der alte Link funktioniert dann sofort nicht mehr, auf keinem Gerät. Dort musst du das Abo mit dem neuen Link neu einrichten.",
  "calendar.feed.rotate.done": "Neuer Link erstellt.",
  "calendar.feed.end.action": "Abo beenden",
  "calendar.feed.end.title": "Abo beenden?",
  "calendar.feed.end.description":
    "Der Link funktioniert dann sofort nicht mehr. Deine Kalender bekommen keine neuen Termine mehr; das Abo kannst du dort löschen.",
  "calendar.feed.end.done": "Abo beendet.",
} as const satisfies NamespaceCatalog<"calendar">;

export type CalendarFeedCatalog = typeof calendarFeedDe;
