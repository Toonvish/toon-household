/**
 * German — namespace "recipes" (see docs/i18n.md §9 for the file's owner).
 * Covers `features/recipes/**`: the list/detail/new/edit screens, the recipe
 * form, the ingredients/steps editors, the servings scaler, cook mode and the
 * image picker.
 */
import type { NamespaceCatalog } from "@toon/shared";

export const recipesDe = {
  /* ------------------------------ enum labels ------------------------------- */
  // `RecipeSort` is the domain value (locked); only the label moves. See
  // components/RecipeFilters.tsx.
  "recipe.recipes.sort.newest": "Neueste zuerst",
  "recipe.recipes.sort.oldest": "Älteste zuerst",
  "recipe.recipes.sort.title": "Titel (A–Z)",
  "recipe.recipes.sort.rating": "Beste Bewertung",
  "recipe.recipes.sort.time": "Kürzeste Zeit",

  // `Difficulty` ("einfach"/"mittel"/"schwer") is the WIRE value and stays
  // locked; only the label moves here. Resolved through DIFFICULTY_LABEL_KEYS
  // (lib/difficultyLabels.ts) at render time, never frozen at import time.
  "recipe.recipes.difficulty.einfach": "Einfach",
  "recipe.recipes.difficulty.mittel": "Mittel",
  "recipe.recipes.difficulty.schwer": "Schwer",

  // `lastCooked` label for `SORT_LABELS` (features/recipes/lib/format.ts, T8.1). The
  // wire value `"lastCooked"` is locked in packages/shared; only the label moves.
  "recipe.recipes.sort.lastCooked": "Zuletzt gekocht",

  /* -------------------------------- RecipeListPage --------------------------- */
  "recipe.recipes.list.title": "Rezepte",
  "recipe.recipes.list.groupSummary": { one: "{name} · {count} Rezept", other: "{name} · {count} Rezepte" },
  "recipe.recipes.list.importAction": "Importieren",
  "recipe.recipes.list.newAction": "Neu",
  "recipe.recipes.list.empty.filtered.title": "Keine Treffer",
  "recipe.recipes.list.empty.filtered.description":
    "Für diese Suche und Filter gibt es kein Rezept. Setze die Filter zurück oder suche anders.",
  "recipe.recipes.list.empty.none.title": "Noch keine Rezepte",
  "recipe.recipes.list.empty.none.description":
    "Lege dein erstes Rezept an oder importiere es aus einer Website, einem Foto oder einem PDF.",
  "recipe.recipes.list.empty.createAction": "Rezept anlegen",
  "recipe.recipes.list.empty.importAction": "Rezept importieren",
  "recipe.recipes.list.resultsCount": { one: "{shown} von {count} Rezept", other: "{shown} von {count} Rezepten" },
  "recipe.recipes.list.loadMore": "Mehr laden",
  "recipe.recipes.list.refreshing": "Liste wird aktualisiert",
  // The library search field: a plural key with a count from `totalCount`, not a
  // static placeholder (i18n-keys.md §8.1) — falls back to no count while it's
  // `undefined` (render nothing, never "0").
  "recipe.recipes.list.searchPlaceholder": {
    one: "{count} Rezept durchsuchen",
    other: "{count} Rezepte durchsuchen",
  },
  "recipe.recipes.list.sharedSummary": "Geteilt mit {group} · {members} · {recipes}",
  "recipe.recipes.list.filterAction": "Filter",
  "recipe.recipes.list.filterActionWithCount": "Filter · {count}",
  "recipe.recipes.list.allRecipes": "Alle Rezepte",
  "recipe.recipes.list.recentlyCooked": "Kürzlich gekocht",
  "recipe.recipes.list.rowMeta": "{time} · {servings}",
  "recipe.recipes.list.cookedRelative": "Gekocht {relative}",

  /* -------------------------------- LibraryCreateMenu (the "+" sheet) --------- */
  // Composed mostly of existing keys (recipe.recipes.list.newAction, common.sidenav.newRecipe,
  // common.nav.import) plus these three — see i18n-keys.md §8.2 for the slot map.
  "recipe.recipes.create.triggerLabel": "Rezept hinzufügen",
  "recipe.recipes.create.newRecipeHint": "Von Hand eingeben",
  "recipe.recipes.create.importHint": "Aus URL, Foto oder PDF",

  /* -------------------------------- RecipeNewPage ----------------------------- */
  "recipe.recipes.new.title": "Neues Rezept",
  "recipe.recipes.new.submit": "Rezept speichern",
  "recipe.recipes.new.imageHint": "Wird direkt nach dem Speichern hochgeladen.",
  "recipe.recipes.new.photoUploadFailedToast": "Rezept gespeichert, das Foto konnte aber nicht hochgeladen werden",
  "recipe.recipes.new.createdToast": "Rezept angelegt",
  "recipe.recipes.new.noGroup.title": "Keine aktive Gruppe",
  "recipe.recipes.new.noGroup.description":
    "Wähle oben eine Gruppe aus oder lege eine neue an, um Rezepte zu speichern.",
  "recipe.recipes.new.noGroup.action": "Zu den Gruppen",

  /* -------------------------------- RecipeEditPage ---------------------------- */
  "recipe.recipes.edit.title": "Rezept bearbeiten",
  "recipe.recipes.edit.submit": "Änderungen speichern",
  "recipe.recipes.edit.photoUploadFailedToast": "Das Foto konnte nicht hochgeladen werden",
  "recipe.recipes.edit.savedToast": "Änderungen gespeichert",
  "recipe.recipes.edit.forbidden.title": "Bearbeiten nicht erlaubt",
  "recipe.recipes.edit.forbidden.description":
    "Dieses Rezept darf nur die Autorin bzw. der Autor oder eine Administratorin bearbeiten.",

  /* -------------------------------- shared actions ---------------------------- */
  "recipe.recipes.action.backToList": "Zur Rezeptliste",
  "recipe.recipes.action.backToRecipe": "Zum Rezept",
  "recipe.recipes.detail.loading": "Rezept wird geladen …",

  /* -------------------------------- RecipeDetailPage -------------------------- */
  "recipe.recipes.detail.actionsMenuLabel": "Rezept-Aktionen",
  "recipe.recipes.detail.actions.edit": "Bearbeiten",
  "recipe.recipes.detail.actions.share": "Teilen",
  "recipe.recipes.detail.actions.copyText": "Als Text kopieren",
  "recipe.recipes.detail.actions.print": "Drucken",
  "recipe.recipes.detail.actions.duplicate": "Duplizieren",
  "recipe.recipes.detail.actions.duplicating": "Kopie wird angelegt …",
  "recipe.recipes.detail.actions.delete": "Löschen",
  "recipe.recipes.detail.imageAlt": "Foto von {title}",
  "recipe.recipes.detail.byline": "Von {author} · {date}",
  "recipe.recipes.detail.shareCopiedToast": "In die Zwischenablage kopiert",
  "recipe.recipes.detail.shareUnavailableToast": "Teilen nicht möglich",
  "recipe.recipes.detail.copiedToast": "Rezept kopiert",
  "recipe.recipes.detail.copiedScaledDetail": "Skaliert auf {servings}",
  "recipe.recipes.detail.copyUnavailableToast": "Kopieren nicht möglich",
  "recipe.recipes.detail.duplicatedToast": "Kopie angelegt",
  "recipe.recipes.detail.duplicateFailedToast": "Duplizieren fehlgeschlagen",
  "recipe.recipes.detail.meta.servings": "Portionen",
  "recipe.recipes.detail.meta.prep": "Arbeitszeit",
  "recipe.recipes.detail.meta.cook": "Backzeit",
  "recipe.recipes.detail.meta.total": "Gesamt",
  "recipe.recipes.detail.scaledNote":
    "Mengen umgerechnet (Faktor {factor}). Prisen und Spritzer bleiben unverändert.",
  "recipe.recipes.detail.addToShoppingList": "Zur Einkaufsliste",
  "recipe.recipes.detail.resetChecked": "Zurücksetzen ({count})",
  "recipe.recipes.detail.cookModeAction": "Kochmodus",
  "recipe.recipes.detail.notesHeading": "Notizen",
  "recipe.recipes.detail.sourceHeading": "Quelle",
  "recipe.recipes.detail.addedToListToast": "Auf der Einkaufsliste",
  "recipe.recipes.detail.addedToListDetail": {
    one: "{listName} · {count} Position",
    other: "{listName} · {count} Positionen",
  },
  "recipe.recipes.detail.addToListFailedToast": "Konnte nicht hinzugefügt werden",
  "recipe.recipes.detail.deleteConfirm.title": "Rezept löschen?",
  "recipe.recipes.detail.deleteConfirm.description":
    "„{title}“ wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.",
  "recipe.recipes.detail.deleteConfirm.confirm": "Löschen",
  "recipe.recipes.detail.deletedToast": "Rezept gelöscht",
  "recipe.recipes.detail.deleteFailedToast": "Löschen fehlgeschlagen",

  // recipe.recipes.detail.planDayAction and .cookedAction take useCanMutate() (online-only);
  // recipe.recipes.detail.addToShoppingList above stays on useEmailVerificationBlock()
  // because it queues offline — two gates on one screen, deliberately not unified
  // (R38, i18n-keys.md §8.5).
  "recipe.recipes.detail.planDayAction": "Für einen Tag planen",
  "recipe.recipes.detail.cookedAction": "Gekocht",
  "recipe.recipes.detail.markCookedAriaLabel": "Als gekocht markieren",
  "recipe.recipes.detail.cookedToast": "Als gekocht markiert",
  // R18's 10-minute, own-row-only undo, offered in the success Toast (T8.4).
  "recipe.recipes.detail.cookedUndo": "Rückgängig",
  "recipe.recipes.detail.cookedUndoneToast": "Rückgängig gemacht",
  "recipe.recipes.detail.cookedFailedToast": "Konnte nicht gespeichert werden",
  // .meta.lastCooked (desktop) and .meta.cooked (phone 4-up grid) are two keys for
  // the same English word in different slots, split so a translator can shorten
  // the phone caption without touching the desktop one.
  "recipe.recipes.detail.meta.lastCooked": "Zuletzt gekocht",
  "recipe.recipes.detail.meta.cooked": "Gekocht",
  "recipe.recipes.detail.meta.never": "noch nie",
  "recipe.recipes.detail.stepCount": { one: "{count} Schritt", other: "{count} Schritte" },
  "recipe.recipes.detail.tabs.ingredients": "Zutaten · {count}",
  "recipe.recipes.detail.tabs.steps": "Zubereitung · {count}",
  "recipe.recipes.detail.backAriaLabel": "Zurück",
  "recipe.recipes.detail.planDialogTitle": "„{title}“ einplanen",
  // The date input under the week chips — any day outside the week shown above.
  "recipe.recipes.detail.planDialog.dateLabel": "Anderes Datum",

  "recipe.recipes.rating.outOfFive": "von 5 Sternen",

  /* -------------------------------- ingredients / steps (shared) -------------- */
  "recipe.recipes.ingredients.heading": "Zutaten",
  "recipe.recipes.ingredients.count": { one: "{count} Zutat", other: "{count} Zutaten" },
  "recipe.recipes.ingredients.empty": "Für dieses Rezept sind keine Zutaten erfasst.",
  "recipe.recipes.steps.heading": "Zubereitung",
  "recipe.recipes.steps.empty": "Für dieses Rezept sind keine Schritte erfasst.",
  "recipe.recipes.steps.doneSr": "erledigt",
  "recipe.recipes.steps.markDoneSr": "als erledigt markieren",
  "recipe.recipes.editor.positionOf": "Position {index} von {total}",
  "recipe.recipes.editor.cancel": "Abbrechen",
  "recipe.recipes.editor.apply": "Übernehmen",

  /* -------------------------------- plain-text export ------------------------- */
  "recipe.recipes.plainText.totalTime": "Gesamtzeit: {time}",
  "recipe.recipes.plainText.ingredientsHeading": "Zutaten:",
  "recipe.recipes.plainText.stepsHeading": "Zubereitung:",
  "recipe.recipes.plainText.notesHeading": "Notizen:",
  "recipe.recipes.plainText.sourceLine": "Quelle: {url}",

  /* -------------------------------- duplicate suffix -------------------------- */
  "recipe.recipes.duplicateSuffix": "{title} (Kopie)",

  /* -------------------------------- RecipeForm --------------------------------- */
  "recipe.recipes.form.title.label": "Titel",
  "recipe.recipes.form.title.placeholder": "Apfelkuchen vom Blech",
  "recipe.recipes.form.description.label": "Kurzbeschreibung",
  "recipe.recipes.form.description.placeholder": "Saftig, schnell gebacken und perfekt für Besuch.",
  "recipe.recipes.form.detailsHeading": "Angaben",
  "recipe.recipes.form.servingsAmount.label": "Portionen",
  "recipe.recipes.form.servingsAmount.placeholder": "4",
  "recipe.recipes.form.servingsUnit.label": "Einheit",
  "recipe.recipes.form.prepMinutes.label": "Arbeitszeit (Min.)",
  "recipe.recipes.form.prepMinutes.placeholder": "20",
  "recipe.recipes.form.cookMinutes.label": "Backzeit (Min.)",
  "recipe.recipes.form.cookMinutes.placeholder": "35",
  "recipe.recipes.form.totalMinutes.label": "Gesamtzeit (Min.)",
  "recipe.recipes.form.totalMinutes.placeholder": "55",
  "recipe.recipes.form.totalMinutes.hint": "Vorschlag aus Arbeits- + Backzeit: {minutes} Min.",
  "recipe.recipes.form.difficulty.label": "Schwierigkeit",
  "recipe.recipes.form.difficulty.none": "Keine Angabe",
  "recipe.recipes.form.rating.label": "Bewertung",
  "recipe.recipes.form.rating.none": "Keine Bewertung",
  "recipe.recipes.form.rating.stars": { one: "{count} Stern", other: "{count} Sterne" },
  // Single-select over the group's kind==="course" tags plus .none — this is where
  // the "one course per recipe" invariant actually lives (no DB constraint enforces
  // it). Writes CreateRecipeRequest.course, a tag NAME, not an id. Option labels are
  // the German tag names rendered verbatim — CONTENT, not this key.
  "recipe.recipes.form.course.label": "Gang",
  "recipe.recipes.form.course.none": "Keine Angabe",
  "recipe.recipes.form.course.hint": "Ein Rezept hat genau einen Gang. Alles andere sind Tags.",
  "recipe.recipes.form.collectionsLegend": "Sammlungen",
  "recipe.recipes.form.notes.label": "Notizen",
  "recipe.recipes.form.notes.placeholder": "Mit Vanilleeis servieren. Hält sich 2 Tage.",
  "recipe.recipes.form.sourceUrl.label": "Quelle (URL)",
  "recipe.recipes.form.sourceName.label": "Quelle (Name)",
  "recipe.recipes.form.cancel": "Abbrechen",
  "recipe.recipes.form.unsavedConfirm.title": "Ungespeicherte Änderungen",
  "recipe.recipes.form.unsavedConfirm.description": "Wenn du diese Seite verlässt, gehen deine Eingaben verloren.",
  "recipe.recipes.form.unsavedConfirm.confirm": "Verlassen",
  "recipe.recipes.form.unsavedConfirm.cancel": "Hier bleiben",

  /* -------------------------------- RecipeFilters ------------------------------ */
  // recipe.recipes.filters.searchPlaceholder is GONE: RecipeFilters.tsx is deleted (T8.2)
  // and the search field moves into RecipeListPage with recipe.recipes.list.searchPlaceholder
  // above. searchAriaLabel is kept — a placeholder is not an accessible name.
  "recipe.recipes.filters.searchAriaLabel": "Rezepte durchsuchen",
  // recipe.recipes.filters.advancedToggle ("Erweiterte Suche") is GONE: its only call site was
  // RecipeFilters.tsx, deleted in this same commit (T8.2). The rail is now permanent on
  // desktop and the phone trigger is `recipe.recipes.list.filterAction` ("Filter") next to the
  // search field, with `moreFilters` ("Mehr Filter") for the inner disclosure — grep
  // found no other reference, so the key is deleted rather than left as dead copy
  // (i18n-keys.md §15 G3).
  "recipe.recipes.filters.sheetTitle": "Filter",
  // The rail's HEADING for the course group is interface; the course NAMES listed
  // under it are CONTENT and never go through t() — i18n-keys.md §8.3.
  "recipe.recipes.filters.courseLegend": "Gänge",
  "recipe.recipes.filters.courseAny": "Alle Gänge",
  "recipe.recipes.filters.moreFilters": "Mehr Filter",
  // The only phone route to /collections and /tags (R30) — repeated in both the
  // rail and the "Mehr Filter" sheet.
  "recipe.recipes.filters.manageCollections": "Sammlungen verwalten",
  "recipe.recipes.filters.manageTags": "Tags verwalten",
  "recipe.recipes.filters.sort.label": "Sortierung",
  "recipe.recipes.filters.collection.label": "Sammlung",
  "recipe.recipes.filters.collection.all": "Alle Sammlungen",
  "recipe.recipes.filters.maxDuration.label": "Maximale Dauer",
  "recipe.recipes.filters.maxDuration.any": "Beliebige Dauer",
  "recipe.recipes.filters.maxDuration.upTo15": "bis 15 Min.",
  "recipe.recipes.filters.maxDuration.upTo30": "bis 30 Min.",
  "recipe.recipes.filters.maxDuration.upTo45": "bis 45 Min.",
  "recipe.recipes.filters.maxDuration.upTo60": "bis 1 Std.",
  "recipe.recipes.filters.maxDuration.upTo120": "bis 2 Std.",
  "recipe.recipes.filters.difficulty.label": "Schwierigkeit",
  "recipe.recipes.filters.difficulty.any": "Jede Schwierigkeit",
  "recipe.recipes.filters.tagsLegend": "Tags",
  "recipe.recipes.filters.tagsEmpty": "Noch keine Tags in dieser Gruppe. Tags entstehen beim Anlegen eines Rezepts.",
  "recipe.recipes.filters.tagsAllRequired": "Ein Rezept muss ALLE gewählten Tags haben.",
  "recipe.recipes.filters.resultsCount": { one: "{count} Rezept gefunden", other: "{count} Rezepte gefunden" },
  "recipe.recipes.filters.reset": "Filter zurücksetzen",

  /* -------------------------------- IngredientsEditor -------------------------- */
  "recipe.recipes.ingredientsEditor.insertAction": "Zutaten einfügen",
  "recipe.recipes.ingredientsEditor.status.moved": "Zutat an Position {position} verschoben.",
  "recipe.recipes.ingredientsEditor.status.removed": "Zutat entfernt.",
  "recipe.recipes.ingredientsEditor.status.added": "Zutat hinzugefügt.",
  "recipe.recipes.ingredientsEditor.status.reparsed": "Zeile neu erkannt.",
  "recipe.recipes.ingredientsEditor.status.pasteEmpty": "Keine Zutaten erkannt.",
  "recipe.recipes.ingredientsEditor.status.pasted": {
    one: "{count} Zutat übernommen.",
    other: "{count} Zutaten übernommen.",
  },
  "recipe.recipes.ingredientsEditor.section.label": "Abschnitt",
  "recipe.recipes.ingredientsEditor.section.placeholder": "z. B. Für den Teig",
  "recipe.recipes.ingredientsEditor.quantity.label": "Menge",
  "recipe.recipes.ingredientsEditor.unit.label": "Einheit",
  "recipe.recipes.ingredientsEditor.name.label": "Zutat",
  "recipe.recipes.ingredientsEditor.name.placeholder": "Mehl",
  "recipe.recipes.ingredientsEditor.quantityMax.label": "bis",
  "recipe.recipes.ingredientsEditor.note.label": "Notiz",
  "recipe.recipes.ingredientsEditor.note.placeholder": "fein gehackt",
  "recipe.recipes.ingredientsEditor.reparseAction": "Zutat {index} neu erkennen",
  "recipe.recipes.ingredientsEditor.moveUpAction": "Zutat {index} nach oben",
  "recipe.recipes.ingredientsEditor.moveDownAction": "Zutat {index} nach unten",
  "recipe.recipes.ingredientsEditor.removeAction": "Zutat {index} entfernen",
  "recipe.recipes.ingredientsEditor.addAction": "Zutat hinzufügen",
  "recipe.recipes.ingredientsEditor.addSameSectionAction": "Weitere im gleichen Abschnitt",
  "recipe.recipes.ingredientsEditor.dialog.description":
    "Eine Zutat pro Zeile. Zeilen wie „Für den Teig:“ werden zu Abschnitten. Mengen, Einheiten und Notizen werden automatisch erkannt.",
  "recipe.recipes.ingredientsEditor.dialog.textareaLabel": "Zutatenliste",

  /* -------------------------------- StepsEditor --------------------------------- */
  "recipe.recipes.stepsEditor.insertAction": "Text einfügen",
  "recipe.recipes.stepsEditor.status.moved": "Schritt an Position {position} verschoben.",
  "recipe.recipes.stepsEditor.status.removed": "Schritt entfernt.",
  "recipe.recipes.stepsEditor.status.added": "Schritt hinzugefügt.",
  "recipe.recipes.stepsEditor.status.pasteEmpty": "Keine Schritte erkannt.",
  "recipe.recipes.stepsEditor.status.pasted": {
    one: "{count} Schritt übernommen.",
    other: "{count} Schritte übernommen.",
  },
  "recipe.recipes.stepsEditor.section.placeholder": "z. B. Teig zubereiten",
  "recipe.recipes.stepsEditor.text.label": "Schritt {index}",
  "recipe.recipes.stepsEditor.text.placeholder": "Mehl, Backpulver und Salz in einer Schüssel vermischen.",
  "recipe.recipes.stepsEditor.moveUpAction": "Schritt {index} nach oben",
  "recipe.recipes.stepsEditor.moveDownAction": "Schritt {index} nach unten",
  "recipe.recipes.stepsEditor.removeAction": "Schritt {index} entfernen",
  "recipe.recipes.stepsEditor.addAction": "Schritt hinzufügen",
  "recipe.recipes.stepsEditor.addSameSectionAction": "Weiterer im gleichen Abschnitt",
  "recipe.recipes.stepsEditor.dialog.title": "Zubereitung einfügen",
  "recipe.recipes.stepsEditor.dialog.description":
    "Nummerierte Schritte („1.“, „Schritt 2)“) oder Absätze werden automatisch getrennt.",
  "recipe.recipes.stepsEditor.dialog.textareaLabel": "Zubereitungstext",
  "recipe.recipes.stepsEditor.dialog.placeholder":
    "1. Backofen auf 180 °C vorheizen.\n2. Mehl und Backpulver vermischen.\n3. Eier unterrühren.",

  /* -------------------------------- ServingsScaler ------------------------------ */
  "recipe.recipes.scaler.srLabel": "Anzahl {noun}",
  "recipe.recipes.scaler.decreaseAction": "Weniger {noun}",
  "recipe.recipes.scaler.increaseAction": "Mehr {noun}",
  "recipe.recipes.scaler.resetAction": "Original",

  /* -------------------------------- RecipeImagePicker --------------------------- */
  "recipe.recipes.imagePicker.label": "Bild",
  "recipe.recipes.imagePicker.previewAlt": "Vorschau des Rezeptbildes",
  "recipe.recipes.imagePicker.empty": "Noch kein Bild",
  "recipe.recipes.imagePicker.takePhoto": "Foto aufnehmen",
  "recipe.recipes.imagePicker.choosePhoto": "Bild auswählen",
  "recipe.recipes.imagePicker.urlToggle": "Bild-URL",
  "recipe.recipes.imagePicker.remove": "Entfernen",
  "recipe.recipes.imagePicker.tooLarge": "Das Bild ist {size} groß. Maximal 15 MB sind erlaubt.",
  "recipe.recipes.imagePicker.invalidType": "Bitte wähle eine Bilddatei.",

  /* -------------------------------- CookMode ------------------------------------ */
  "recipe.recipes.cookMode.dialogLabel": "Kochmodus: {title}",
  "recipe.recipes.cookMode.wakeLock.active": "Display bleibt an",
  "recipe.recipes.cookMode.wakeLock.inactiveTitle": "Display-Sperre nicht aktiv",
  "recipe.recipes.cookMode.wakeLock.inactiveText": "Display kann sperren",
  "recipe.recipes.cookMode.closeAction": "Kochmodus beenden",
  "recipe.recipes.cookMode.stepOf": "Schritt {current} von {total}",
  "recipe.recipes.cookMode.back": "Zurück",
  "recipe.recipes.cookMode.doneLabel": "Erledigt",
  "recipe.recipes.cookMode.finish": "Fertig",
  "recipe.recipes.cookMode.next": "Weiter",
  "recipe.recipes.cookMode.progressAriaLabel": "Fortschritt",
} as const satisfies NamespaceCatalog<"recipe">;

export type RecipesCatalog = typeof recipesDe;
