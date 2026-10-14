/**
 * German/English — the recipe module's collection and tag strings (R `groups.*`, keys renamed per
 * SPEC D10). Copied from toon-recipe's `groups` namespace: values, comments and order are
 * unchanged; only the keys move (Table E). See docs/i18n.md §9 for the source file's owner.
 */
import type { NamespaceCatalog } from "@toon/shared";

export const organiseDe = {
  "recipe.count.recipes": { one: "{count} Rezept", other: "{count} Rezepte" },

  /* --------------------------------- TagsPage.tsx ---------------------------- */
  "recipe.tags.title": "Tags",
  "recipe.tags.subtitle": "Tags gehören zur Gruppe und lassen sich in der Rezeptliste als Filter nutzen.",
  "recipe.tags.create": "Tag anlegen",
  "recipe.tags.emptyTitle": "Noch keine Tags",
  "recipe.tags.emptyDescription":
    "Tags entstehen automatisch, wenn du sie beim Anlegen eines Rezepts eintippst — oder du legst sie hier vorab an.",
  "recipe.tags.toRecipeList": "Zur Rezeptliste",
  "recipe.tags.editLabel": "Tag {name} bearbeiten",
  "recipe.tags.deleteLabel": "Tag {name} löschen",
  "recipe.tags.deleteConfirmTitle": "Tag löschen?",
  "recipe.tags.deleteConfirmDescription": {
    one: "„{name}“ wird von allen {count} Rezept entfernt. Die Rezepte selbst bleiben erhalten.",
    other: "„{name}“ wird von allen {count} Rezepten entfernt. Die Rezepte selbst bleiben erhalten.",
  },
  "recipe.tags.deletedToast": "Tag gelöscht",
  "recipe.tags.deleteFailedToast": "Löschen fehlgeschlagen",
  "recipe.tags.savedToast": "Tag gespeichert",
  "recipe.tags.createdToast": "Tag angelegt",
  "recipe.tags.nameTakenError": "Diesen Tag gibt es in der Gruppe schon.",
  "recipe.tags.editTitle": "Tag bearbeiten",
  "recipe.tags.createTitle": "Neuer Tag",
  "recipe.tags.namePlaceholder": "Vegetarisch",
  "recipe.tags.colorLegend": "Farbe",
  "recipe.tags.noColor": "Standard",
  "recipe.tags.noColorAriaLabel": "Keine Farbe",
  "recipe.tags.colorAriaLabel": "Farbe {hex}",
  "recipe.tags.customHexLabel": "Eigener Hex-Wert",
  "recipe.tags.previewLabel": "Vorschau:",
  "recipe.tags.previewName": "Beispiel",
  /**
   * The `kind` toggle (T9.2, R41): how an existing library adopts the eyebrow, since
   * the migration's `DEFAULT 'free'` is the whole backfill — no name-matching guess at
   * somebody else's German content. `kindFree` is the word "Tag" in both locales, same
   * as `common.nav.plan` — not a missing translation.
   */
  "recipe.tags.kindLegend": "Art",
  "recipe.tags.kindCourse": "Gang",
  "recipe.tags.kindFree": "Tag",
  "recipe.tags.kindToggleLabel": "Art von „{name}“ ändern",
  "recipe.tags.kindHint":
    "Ein Gang erscheint als Kategorie über dem Rezepttitel. Jedes Rezept hat höchstens einen.",
  "recipe.tags.kindChangedToast": "Art geändert",
  "recipe.tags.kindChangeFailedToast": "Ändern fehlgeschlagen",
  "recipe.tags.sectionCourses": "Gänge",
  "recipe.tags.sectionFree": "Tags",

  /* --------------------------- components/TagCombobox.tsx ------------------- */
  "recipe.tagCombobox.label": "Tags",
  "recipe.tagCombobox.removeLabel": "Tag {name} entfernen",
  "recipe.tagCombobox.createOption": "„{name}“ neu anlegen",
  "recipe.tagCombobox.hint":
    "Enter fügt hinzu, Backspace entfernt den letzten. Neue Tags werden automatisch angelegt.",
  "recipe.tagCombobox.maxReached": "Maximum erreicht",
  "recipe.tagCombobox.placeholder": "Tag eingeben oder wählen …",

  /* ------------------------------ CollectionsPage.tsx ------------------------ */
  "recipe.collections.title": "Sammlungen",
  "recipe.collections.subtitle": "Bündle Rezepte thematisch, z. B. „Weihnachten“ oder „Meal Prep“.",
  "recipe.collections.create": "Sammlung anlegen",
  "recipe.collections.emptyTitle": "Noch keine Sammlungen",
  "recipe.collections.emptyDescription":
    "Eine Sammlung ist eine geordnete Liste von Rezepten — perfekt für Menüs oder Wochenpläne.",
  "recipe.collections.createFirst": "Erste Sammlung anlegen",
  "recipe.collections.createTitle": "Neue Sammlung",
  "recipe.collections.namePlaceholder": "Weihnachtsbäckerei",
  "recipe.collections.createdToast": "Sammlung angelegt",

  /* --------------------------- CollectionDetailPage.tsx ---------------------- */
  "recipe.collectionDetail.loading": "Sammlung wird geladen …",
  "recipe.collectionDetail.backToList": "Zu den Sammlungen",
  "recipe.collectionDetail.backLink": "← Alle Sammlungen",
  "recipe.collectionDetail.movedStatus": "Rezept an Position {position} verschoben.",
  "recipe.collectionDetail.reorderFailedToast": "Reihenfolge konnte nicht gespeichert werden",
  "recipe.collectionDetail.addRecipes": "Rezepte hinzufügen",
  "recipe.collectionDetail.editLabel": "Sammlung bearbeiten",
  "recipe.collectionDetail.deleteLabel": "Sammlung löschen",
  "recipe.collectionDetail.emptyTitle": "Diese Sammlung ist leer",
  "recipe.collectionDetail.emptyDescription":
    "Füge Rezepte hinzu, um sie hier in deiner gewünschten Reihenfolge zu sehen.",
  "recipe.collectionDetail.moveUpLabel": "{title} nach oben",
  "recipe.collectionDetail.moveDownLabel": "{title} nach unten",
  "recipe.collectionDetail.removeLabel": "{title} aus Sammlung entfernen",
  "recipe.collectionDetail.removedStatus": "{title} entfernt.",
  "recipe.collectionDetail.removeFailedToast": "Entfernen fehlgeschlagen",
  "recipe.collectionDetail.deleteConfirmTitle": "Sammlung löschen?",
  "recipe.collectionDetail.deleteConfirmDescription":
    "„{name}“ wird gelöscht. Die Rezepte selbst bleiben erhalten.",
  "recipe.collectionDetail.deletedToast": "Sammlung gelöscht",
  "recipe.collectionDetail.deleteFailedToast": "Löschen fehlgeschlagen",
  "recipe.collectionDetail.editTitle": "Sammlung bearbeiten",
  "recipe.collectionDetail.savedToast": "Sammlung gespeichert",
  "recipe.collectionDetail.addDialogTitle": "Rezepte hinzufügen",
  "recipe.collectionDetail.addDialogDescription":
    "Suche ein Rezept und tippe darauf, um es an das Ende der Sammlung zu setzen.",
  "recipe.collectionDetail.searchLabel": "Suche",
  "recipe.collectionDetail.searchPlaceholder": "Titel oder Zutat …",
  "recipe.collectionDetail.loadingRecipes": "Rezepte werden geladen …",
  "recipe.collectionDetail.noRecipesFound": "Keine Rezepte gefunden.",
  "recipe.collectionDetail.included": "Enthalten",
  "recipe.collectionDetail.addedToast": "Hinzugefügt",
  "recipe.collectionDetail.addFailedToast": "Hinzufügen fehlgeschlagen",
  "recipe.collectionDetail.done": "Fertig",
} as const satisfies NamespaceCatalog<"recipe">;

export type OrganiseCatalog = typeof organiseDe;
