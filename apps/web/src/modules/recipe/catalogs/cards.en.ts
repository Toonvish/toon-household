/**
 * English — namespace "cards". See `cards.de.ts` for who owns this file and why
 * the symbology names below are deliberately unchanged.
 */
import type { LocaleCatalog } from "@toon/shared";
import type { CardsCatalog } from "./cards.de.ts";

export const cardsEn: LocaleCatalog<CardsCatalog> = {
  // CardsPage
  "recipe.cards.heading": "Cards",
  "recipe.cards.subtitle": "Loyalty and membership cards — just show them at the till.",
  "recipe.cards.add": "Add card",
  "recipe.cards.privateHint":
    "Cards belong to your account, not to the group — other members cannot see them.",
  "recipe.cards.count": { one: "{count} card", other: "{count} cards" },
  "recipe.cards.empty.title": "No card saved yet",
  "recipe.cards.empty.description":
    "Scan your loyalty card's code or type in its number. After that you can show the card from your phone at the till and leave the plastic one at home.",
  "recipe.cards.empty.action": "Add your first card",

  // The link from /shopping into this screen
  "recipe.cards.link.panelTitle": "Loyalty cards",
  "recipe.cards.link.description": "Show loyalty cards at the till, from your phone",
  "recipe.cards.link.action": "Manage cards",

  // Card tile + its overflow menu
  "recipe.cards.tile.show": "Show card",
  "recipe.cards.tile.menu": "More actions for “{label}”",
  "recipe.cards.action.edit": "Edit",
  "recipe.cards.action.delete": "Delete",
  "recipe.cards.action.cancel": "Cancel",
  "recipe.cards.action.save": "Save",
  "recipe.cards.action.add": "Add",

  // CardFormDialog
  "recipe.cards.form.addTitle": "Add card",
  "recipe.cards.form.editTitle": "Edit card",
  "recipe.cards.form.label.label": "Name",
  "recipe.cards.form.label.placeholder": "e.g. Payback",
  "recipe.cards.form.format.label": "Code type",
  "recipe.cards.form.format.hint": "Usually printed in small type next to the code. If unsure, just scan it.",
  "recipe.cards.form.value.label": "Number",
  "recipe.cards.form.value.placeholder": "The digits under the code",
  "recipe.cards.form.value.hint":
    "You can leave out spaces and dashes. If the final check digit is missing, we add it.",
  "recipe.cards.form.note.label": "Note",
  "recipe.cards.form.note.placeholder": "e.g. Anna's card",
  "recipe.cards.form.scan": "Scan",
  "recipe.cards.form.preview": "Preview",
  "recipe.cards.form.previewPending": "Once the number checks out, the code appears here.",
  "recipe.cards.form.saved": "“{label}” saved",
  "recipe.cards.form.updated": "“{label}” updated",

  // Delete
  "recipe.cards.delete.title": "Delete card?",
  "recipe.cards.delete.description": "“{label}” will be removed from your cards. This cannot be undone.",
  "recipe.cards.delete.success": "“{label}” deleted",
  "recipe.cards.delete.error": "Deleting failed",

  // CardDisplayDialog — the screen you hold up at the till
  "recipe.cards.show.brightnessHint": "Tip: turn the brightness up, scanners read it better.",

  // ScannerDialog
  "recipe.cards.scan.title": "Scan code",
  "recipe.cards.scan.hint": "Hold the card's barcode or QR code inside the frame.",
  "recipe.cards.scan.starting": "Starting the camera …",
  "recipe.cards.scan.retry": "Try again",
  "recipe.cards.scan.manual": "Type the number",
  "recipe.cards.scan.error.permission":
    "No access to the camera. Allow it in your browser's settings — or type the number instead.",
  "recipe.cards.scan.error.unavailable":
    "This device has no camera we can use. Please type the number instead.",
  "recipe.cards.scan.error.load":
    "The scanner could not be loaded. That needs a connection once — typing the number always works.",
  "recipe.cards.scan.error.unsupported":
    "This app cannot display that code type. Please type the number, or use a different card.",
  "recipe.cards.scan.offline": "Scanning needs a connection once.",
  "recipe.cards.scan.success": "Code detected: {format}",

  // Symbology names — the labels printed on the cards, so unchanged.
  "recipe.cards.format.qr": "QR code",
  "recipe.cards.format.ean13": "EAN-13",
  "recipe.cards.format.ean8": "EAN-8",
  "recipe.cards.format.upca": "UPC-A",
  "recipe.cards.format.code128": "Code 128",
  "recipe.cards.format.code39": "Code 39",
  "recipe.cards.format.itf": "ITF (2 of 5)",
};
