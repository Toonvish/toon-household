/**
 * German — namespace "cards". Covers apps/web/src/features/cards/** : the wallet
 * screen, the add/edit form, the camera scanner and the full-screen display used
 * at a till, plus the entry point on /shopping.
 *
 * ALL NEW COPY — this feature did not exist before the i18n port, so
 * `scripts/i18n-check.ts` reports every key here as "no counterpart in the base
 * tree" (its known false-positive class 1). There is nothing to be byte-identical
 * to.
 *
 * The seven symbology names (`recipe.cards.format.*`) are the SAME in both catalogs on
 * purpose: they are the labels printed on the cards themselves ("EAN-13",
 * "Code 128"), not descriptions, and a user comparing the app to their card has to
 * find the same string. Only "QR-Code"/"QR code" differs, because that one has a
 * real German spelling.
 */
import type { NamespaceCatalog } from "@toon/shared";

export const cardsDe = {
  // CardsPage
  "recipe.cards.heading": "Karten",
  "recipe.cards.subtitle": "Kundenkarten und Ausweise — an der Kasse einfach vorzeigen.",
  "recipe.cards.add": "Karte hinzufügen",
  "recipe.cards.privateHint":
    "Karten gehören zu deinem Konto, nicht zur Gruppe — andere Mitglieder sehen sie nicht.",
  "recipe.cards.count": { one: "{count} Karte", other: "{count} Karten" },
  "recipe.cards.empty.title": "Noch keine Karte gespeichert",
  "recipe.cards.empty.description":
    "Scanne den Code deiner Kundenkarte oder tippe die Nummer ein. Danach kannst du die Karte an der Kasse vom Handy zeigen und die Plastikkarte zu Hause lassen.",
  "recipe.cards.empty.action": "Erste Karte hinzufügen",

  // The link from /shopping into this screen
  "recipe.cards.link.panelTitle": "Treuekarten",
  "recipe.cards.link.description": "Kundenkarten an der Kasse vom Handy zeigen",
  "recipe.cards.link.action": "Karten verwalten",

  // Card tile + its overflow menu
  "recipe.cards.tile.show": "Karte zeigen",
  "recipe.cards.tile.menu": "Weitere Aktionen für „{label}“",
  "recipe.cards.action.edit": "Bearbeiten",
  "recipe.cards.action.delete": "Löschen",
  "recipe.cards.action.cancel": "Abbrechen",
  "recipe.cards.action.save": "Speichern",
  "recipe.cards.action.add": "Hinzufügen",

  // CardFormDialog
  "recipe.cards.form.addTitle": "Karte hinzufügen",
  "recipe.cards.form.editTitle": "Karte bearbeiten",
  "recipe.cards.form.label.label": "Bezeichnung",
  "recipe.cards.form.label.placeholder": "z. B. Payback",
  "recipe.cards.form.format.label": "Codetyp",
  "recipe.cards.form.format.hint": "Steht meist klein neben dem Code. Im Zweifel einfach scannen.",
  "recipe.cards.form.value.label": "Nummer",
  "recipe.cards.form.value.placeholder": "Ziffern unter dem Code",
  "recipe.cards.form.value.hint":
    "Leerzeichen und Bindestriche kannst du weglassen. Fehlt die letzte Prüfziffer, ergänzen wir sie.",
  "recipe.cards.form.note.label": "Notiz",
  "recipe.cards.form.note.placeholder": "z. B. Karte von Anna",
  "recipe.cards.form.scan": "Scannen",
  "recipe.cards.form.preview": "Vorschau",
  "recipe.cards.form.previewPending": "Sobald die Nummer stimmt, siehst du hier den Code.",
  "recipe.cards.form.saved": "„{label}“ gespeichert",
  "recipe.cards.form.updated": "„{label}“ aktualisiert",

  // Delete
  "recipe.cards.delete.title": "Karte löschen?",
  "recipe.cards.delete.description":
    "„{label}“ wird aus deinen Karten entfernt. Das lässt sich nicht rückgängig machen.",
  "recipe.cards.delete.success": "„{label}“ gelöscht",
  "recipe.cards.delete.error": "Löschen fehlgeschlagen",

  // CardDisplayDialog — the screen you hold up at the till
  "recipe.cards.show.brightnessHint": "Tipp: Helligkeit hochdrehen, dann liest der Scanner besser.",

  // ScannerDialog
  "recipe.cards.scan.title": "Code scannen",
  "recipe.cards.scan.hint": "Halte den Barcode oder QR-Code der Karte in den Rahmen.",
  "recipe.cards.scan.starting": "Kamera wird gestartet …",
  "recipe.cards.scan.retry": "Nochmal versuchen",
  "recipe.cards.scan.manual": "Nummer eintippen",
  "recipe.cards.scan.error.permission":
    "Kein Zugriff auf die Kamera. Erlaube den Zugriff in den Browser-Einstellungen — oder tippe die Nummer ein.",
  "recipe.cards.scan.error.unavailable":
    "Dieses Gerät hat keine Kamera, die wir nutzen können. Bitte tippe die Nummer ein.",
  "recipe.cards.scan.error.load":
    "Der Scanner konnte nicht geladen werden. Dafür braucht es einmal eine Verbindung — die Nummer kannst du aber immer eintippen.",
  "recipe.cards.scan.error.unsupported":
    "Diesen Codetyp kann die App nicht anzeigen. Bitte tippe die Nummer ein oder nimm eine andere Karte.",
  "recipe.cards.scan.offline": "Zum Scannen brauchst du einmal eine Verbindung.",
  "recipe.cards.scan.success": "Code erkannt: {format}",

  // Symbology names — see the header for why these are identical in `en`.
  "recipe.cards.format.qr": "QR-Code",
  "recipe.cards.format.ean13": "EAN-13",
  "recipe.cards.format.ean8": "EAN-8",
  "recipe.cards.format.upca": "UPC-A",
  "recipe.cards.format.code128": "Code 128",
  "recipe.cards.format.code39": "Code 39",
  "recipe.cards.format.itf": "ITF (2 aus 5)",
} as const satisfies NamespaceCatalog<"recipe">;

export type CardsCatalog = typeof cardsDe;
