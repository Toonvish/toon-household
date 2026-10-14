/**
 * German — namespace "import" (see docs/i18n.md §9 for the file's owner).
 * Skeleton: the foundation wires this namespace up; the port agent for
 * "import" adds keys here (and to import.en.ts) as it moves strings out of
 * its screens. Empty is a valid, final shape until then.
 */
import type { NamespaceCatalog } from "@toon/shared";

export const importDe = {
  /* ------------------------------- /import -------------------------------- */
  "recipe.import.page.title": "Rezept importieren",
  "recipe.import.page.subtitle.ocr":
    "Aus dem Netz, vom Kochbuch-Foto oder aus einem PDF. Vor dem Speichern kannst du alles prüfen und korrigieren.",
  "recipe.import.page.subtitle.noOcr":
    "Aus dem Netz oder als eingefügter Text. Vor dem Speichern kannst du alles prüfen und korrigieren.",
  "recipe.import.page.offline.ocr":
    "Offline — Importieren braucht eine Verbindung, weil die Texterkennung auf dem Server läuft. Gespeicherte Rezepte kannst du weiterhin ansehen und nachkochen.",
  "recipe.import.page.offline.url":
    "Offline — Importieren braucht eine Verbindung, weil der Server die Seite abrufen muss. Gespeicherte Rezepte kannst du weiterhin ansehen und nachkochen.",
  "recipe.import.page.toast.noGroup.title": "Keine Gruppe ausgewählt",
  "recipe.import.page.toast.noGroup.description": "Wähle zuerst die Gruppe, in die das Rezept importiert werden soll.",
  "recipe.import.common.targetGroup": "Ziel-Gruppe",
  "recipe.import.page.savingToGroup": "Wird gespeichert in {groupName}",

  "recipe.import.page.url.heading": "Von einer Webseite",
  "recipe.import.page.url.subtitle": "Link einfügen, wir lesen das Rezept aus.",
  "recipe.import.page.url.placeholder": "https://www.chefkoch.de/rezepte/…",
  "recipe.import.page.url.ariaLabel": "Rezept-URL",
  "recipe.import.page.url.pasteLabel": "Aus Zwischenablage einfügen",
  "recipe.import.page.url.invalid":
    "Das sieht noch nicht nach einer vollständigen Adresse aus – sie muss mit http:// oder https:// beginnen.",
  "recipe.import.page.url.hint":
    "Getestet mit {first} und {second}. Andere Seiten funktionieren, wenn sie Rezeptdaten im Standardformat mitliefern.",
  "recipe.import.page.url.submit": "Rezept laden",
  "recipe.import.page.url.retryPhoto": "Trotzdem als Foto importieren",
  "recipe.import.page.url.retryText": "Text von Hand einfügen",

  "recipe.import.page.photo.heading": "Foto vom Rezept",
  "recipe.import.page.photo.subtitle": "Kochbuch, Zeitschrift, Zettel – die Texterkennung läuft auf dem Server.",
  "recipe.import.page.photo.tip":
    "Tipp: gerade von oben fotografieren, gutes Licht, keine Schatten. Bilder werden vor dem Upload automatisch verkleinert.",
  "recipe.import.page.photo.count": { one: "{count} Foto · {bytes}", other: "{count} Fotos · {bytes}" },
  "recipe.import.page.photo.merge": "werden zu einer Vorlage zusammengefügt",
  "recipe.import.page.photo.altSelected": "Ausgewähltes Foto {index}",
  "recipe.import.page.photo.remove": "Foto {index} entfernen",
  "recipe.import.page.photo.submit": { one: "Foto importieren", other: "{count} Fotos importieren" },
  "recipe.import.page.photo.invalidFile": "„{filename}“ ist kein Bild. Erlaubt sind JPEG, PNG, WebP oder HEIC.",
  "recipe.import.page.photo.subjectCount": "{count} Fotos",

  "recipe.import.page.document.heading": "PDF oder Bilddatei",
  "recipe.import.page.document.subtitle": "Bei PDFs wird zuerst die Textebene gelesen – das ist exakt und schnell.",
  // Der kleine Build: Foto-Erkennung an, PDF-Import aus (IMPORT_PDF_ENABLED=0).
  "recipe.import.page.document.headingImageOnly": "Bilddatei",
  "recipe.import.page.document.subtitleImageOnly":
    "PDF-Import ist auf diesem Server aus – Bilddateien werden gelesen.",
  "recipe.import.page.document.dragHint": "Datei hierher ziehen oder",
  "recipe.import.page.document.pick": "Datei auswählen",
  "recipe.import.page.document.formats": "PDF, JPEG, PNG, WebP oder HEIC · max. {size}",
  "recipe.import.page.document.formatsImageOnly": "JPEG, PNG, WebP oder HEIC · max. {size}",
  "recipe.import.page.document.remove": "Datei entfernen",
  "recipe.import.page.document.submit": "Datei importieren",
  "recipe.import.page.document.invalid": "Bitte eine PDF-Datei oder ein Bild auswählen.",
  "recipe.import.page.document.invalidImageOnly": "Bitte ein Bild auswählen.",
  "recipe.import.page.document.pdfUnavailable":
    "PDF-Import ist auf diesem Server aus. Ein Foto der Seite funktioniert.",
  "recipe.import.page.document.retryPhoto": "Stattdessen Foto aufnehmen",

  "recipe.import.page.text.heading": "Text einfügen",
  "recipe.import.page.text.subtitle": "Wenn du das Rezept schon als Text hast – z. B. aus einer Nachricht.",
  "recipe.import.page.text.toggleClose": "schließen",
  "recipe.import.page.text.toggleOpen": "öffnen",
  "recipe.import.page.text.titlePlaceholder": "Titel (optional)",
  "recipe.import.page.text.titleLabel": "Titel",
  "recipe.import.page.text.bodyLabel": "Rezepttext",
  "recipe.import.page.text.bodyPlaceholder":
    "Zutaten und Zubereitung einfügen.\n\nZutaten\n250 g Mehl\n2 Eier\n\nZubereitung\n1. Alles verrühren…",
  "recipe.import.page.text.submit": "Text auswerten",
  "recipe.import.page.text.subject": "Eingefügter Text",

  "recipe.import.page.drafts.heading": "Offene Entwürfe",
  "recipe.import.page.drafts.hint": "Ein abgebrochener Import ist nicht verloren – hier kannst du weitermachen.",
  "recipe.import.page.drafts.deleteError.title": "Entwurf konnte nicht verworfen werden",
  "recipe.import.page.drafts.deleteError.description": "Bitte versuche es erneut.",

  "recipe.import.page.clipboard.unreadable.title": "Zwischenablage nicht lesbar",
  "recipe.import.page.clipboard.unreadable.description":
    "Dein Browser erlaubt das Einfügen nicht automatisch – bitte die URL manuell einfügen.",

  /* --------------------------- /import/:draftId ---------------------------- */
  "recipe.import.review.back": "Import",
  "recipe.import.review.noDraft": "Kein Entwurf ausgewählt",
  "recipe.import.review.toImport": "Zum Import",
  "recipe.import.review.loadError": "Entwurf konnte nicht geladen werden",
  "recipe.import.review.toOverview": "Zur Import-Übersicht",
  "recipe.import.review.quality": "Erkennungsqualität {value}",
  "recipe.import.review.title.fallback": "Import prüfen",
  "recipe.import.review.autosaveError.title": "Automatisches Speichern fehlgeschlagen",
  "recipe.import.review.autosaveError.retry": "Jetzt speichern",
  "recipe.import.review.committed.title": "Dieser Entwurf wurde bereits als Rezept gespeichert.",
  "recipe.import.review.committed.open": "Rezept öffnen",
  "recipe.import.review.groupMismatch.text": "Dieser Entwurf gehört zur Gruppe {groupName}. Gespeichert wird das Rezept dort.",
  "recipe.import.review.groupMismatch.fallbackName": "einer anderen Gruppe",
  "recipe.import.review.groupMismatch.switch": "Gruppe wechseln",
  "recipe.import.review.groupStays.title": "Entwurf bleibt in seiner Gruppe",
  "recipe.import.review.groupStays.description":
    "Ein bestehender Entwurf kann nicht verschoben werden. Starte den Import in der anderen Gruppe neu, wenn das Rezept dort landen soll.",
  "recipe.import.review.lowConfidence.title": "Die Erkennung war unsicher – bitte gründlich prüfen.",
  "recipe.import.review.lowConfidence.hint":
    "Vergleiche die Felder mit der Quelle. Zeilen mit „bitte prüfen“ sind die wahrscheinlichsten Fehler.",
  "recipe.import.review.lowConfidence.countHint": "Aktuell markiert: {ingredients} Zutaten, {steps} Schritte.",
  "recipe.import.review.tabs.ariaLabel": "Ansicht",
  "recipe.import.review.tabs.source": "Quelle",
  "recipe.import.review.tabs.form": "Rezept",
  "recipe.import.review.retrySave": "Nochmal speichern",
  "recipe.import.review.discard": "Verwerfen",
  "recipe.import.review.saving": "Speichert…",
  "recipe.import.review.save": "Speichern",
  "recipe.import.review.discardDialog.title": "Entwurf verwerfen?",
  "recipe.import.review.discardDialog.description":
    "Der Import-Entwurf wird gelöscht. Das Foto bzw. der erkannte Text ist dann weg – das Rezept wurde noch nicht gespeichert.",
  "recipe.import.review.discardDialog.message": "Der Import-Entwurf wird gelöscht. Das Rezept wurde noch nicht gespeichert.",
  "recipe.import.review.discardDialog.confirm": "Verwerfen",
  "recipe.import.review.discardDialog.cancel": "Weiter bearbeiten",
  "recipe.import.review.toast.saved.title": "Rezept gespeichert",
  "recipe.import.review.toast.discarded.title": "Entwurf verworfen",
  "recipe.import.review.toast.saveFallback": "Bitte prüfe die Eingaben",

  "recipe.import.autosave.saving": "Speichert…",
  "recipe.import.autosave.dirty": "Änderungen noch nicht gespeichert",
  "recipe.import.autosave.saved": "Gespeichert",
  "recipe.import.autosave.savedAt": "Gespeichert um {time}",
  "recipe.import.autosave.error": "Speichern fehlgeschlagen",
  "recipe.import.autosave.idle": "Automatisch gespeichert",

  /* ------------------------------ confidence -------------------------------- */
  "recipe.import.confidence.good": "sieht gut aus",
  "recipe.import.confidence.needsCheck": "bitte prüfen",
  "recipe.import.confidence.quality": "Erkennungsqualität: {value}",
  "recipe.import.confidence.unknown": "unbekannt",
  "recipe.import.confidence.field.title": "Titel",
  "recipe.import.confidence.field.description": "Beschreibung",
  "recipe.import.confidence.field.ingredients": "Zutaten",
  "recipe.import.confidence.field.steps": "Zubereitung",
  "recipe.import.confidence.field.servings": "Portionen",
  "recipe.import.confidence.field.times": "Zeiten",
  "recipe.import.confidence.field.image": "Bild",
  "recipe.import.confidence.reason.noName": "Kein Name erkannt",
  "recipe.import.confidence.reason.shortName": "Sehr kurzer Name",
  "recipe.import.confidence.reason.noLetters": "Name enthält keine Buchstaben",
  "recipe.import.confidence.reason.strangeChars": "Ungewöhnliche Zeichen im Namen",
  "recipe.import.confidence.reason.unknownUnit": "Einheit „{unit}“ unbekannt",
  "recipe.import.confidence.reason.numberNoQuantity": "Zahl in der Zeile, aber keine Menge erkannt",
  "recipe.import.confidence.reason.largeQuantityNoUnit": "Sehr große Menge ohne Einheit",
  "recipe.import.confidence.reason.mergedLine": "Zeile wirkt zusammengefasst – evtl. teilen",
  "recipe.import.confidence.reason.quantityInName": "Menge steckt noch im Namen",
  "recipe.import.confidence.reason.listUncertainIngredients": "Zutatenliste unsicher erkannt",
  "recipe.import.confidence.reason.emptyStep": "Leerer Schritt",
  "recipe.import.confidence.reason.shortStep": "Sehr kurzer Schritt",
  "recipe.import.confidence.reason.strangeCharsStep": "Ungewöhnliche Zeichen im Text",
  "recipe.import.confidence.reason.longStep": "Sehr langer Schritt – evtl. teilen",
  "recipe.import.confidence.reason.listUncertainSteps": "Zubereitung unsicher erkannt",

  /* ---------------------------- image capture -------------------------------- */
  "recipe.import.imageCapture.captureLabel": "Foto aufnehmen",
  "recipe.import.imageCapture.galleryLabel": "Aus Galerie wählen",

  /* ----------------------------- error panel --------------------------------- */
  "recipe.import.errorPanel.retry": "Erneut versuchen",

  /* --------------------------- OCR progress panel ----------------------------- */
  "recipe.import.ocrProgress.ocr.title": "Texterkennung läuft…",
  "recipe.import.ocrProgress.ocr.body":
    "Der Server liest die Schrift aus dem Bild (Deutsch + Englisch). Das dauert je nach Bildgröße bis zu einer Minute und kann nicht abgebrochen werden. Du kannst das Fenster offen lassen – schließe es bitte nicht.",
  "recipe.import.ocrProgress.text.title": "PDF wird gelesen…",
  "recipe.import.ocrProgress.text.body":
    "Zuerst wird die Textebene des PDFs ausgelesen. Fehlt sie, werden die Seiten in Bilder umgewandelt und per Texterkennung gelesen – das dauert dann bis zu einer Minute.",
  "recipe.import.ocrProgress.url.title": "Seite wird geladen…",
  "recipe.import.ocrProgress.url.body": "Die Seite wird abgerufen und nach Rezeptdaten durchsucht. Das dauert meist nur wenige Sekunden.",
  "recipe.import.ocrProgress.preparing": "Foto wird vorbereitet…",
  "recipe.import.ocrProgress.uploading": "Datei wird übertragen…",
  "recipe.import.ocrProgress.longWait":
    "Das dauert länger als üblich. Bitte noch etwas Geduld – abbrechen würde die Erkennung nicht beschleunigen.",

  /* --------------------------- pending drafts list ----------------------------- */
  "recipe.import.pendingDrafts.source.website": "Webseite",
  "recipe.import.pendingDrafts.source.pdfText": "PDF (Textebene)",
  "recipe.import.pendingDrafts.source.pdfOcr": "PDF (Texterkennung)",
  "recipe.import.pendingDrafts.source.photoOcr": "Foto (Texterkennung)",
  "recipe.import.pendingDrafts.source.manualText": "Eingefügter Text",
  "recipe.import.pendingDrafts.source.fallback": "Import",
  "recipe.import.pendingDrafts.openLabel": "Entwurf {title} weiter bearbeiten",
  "recipe.import.pendingDrafts.untitled": "Ohne Titel",
  "recipe.import.pendingDrafts.untitledLower": "ohne Titel",
  "recipe.import.pendingDrafts.summary": "{source} · {ingredients} Zutaten · {steps} Schritte · {date}",
  "recipe.import.pendingDrafts.loadError": "Offene Entwürfe konnten nicht geladen werden: {title}",
  "recipe.import.pendingDrafts.deleteLabel": "Entwurf verwerfen",

  /* ------------------------------ source viewer -------------------------------- */
  "recipe.import.source.tabsAriaLabel": "Quelle",
  "recipe.import.source.tab.image": "Bild",
  "recipe.import.source.tab.text": "Rohtext",
  "recipe.import.source.tab.link": "Quelle",
  "recipe.import.source.empty": "Für diesen Entwurf gibt es keine Quellansicht. Du kannst die Felder rechts direkt bearbeiten.",
  "recipe.import.source.imageFailed":
    "Das Quellbild konnte nicht geladen werden. Vielleicht bist du kein Mitglied dieser Gruppe mehr, oder die Datei wurde gelöscht.",
  "recipe.import.source.zoom.out": "Verkleinern",
  "recipe.import.source.zoom.in": "Vergrößern",
  "recipe.import.source.zoom.rotate": "Drehen",
  "recipe.import.source.zoom.reset": "Zurücksetzen",
  "recipe.import.source.zoom.openNewTab": "Bild in neuem Tab öffnen",
  "recipe.import.source.zoom.hint": "Zwei Finger zum Zoomen, ziehen zum Verschieben. Am Desktop: Strg + Mausrad.",
  "recipe.import.source.imageLoadFailed": "Das Quellbild konnte nicht geladen werden.",
  "recipe.import.source.openDirect": "Direkt öffnen",
  "recipe.import.source.alt": "Quellbild des Rezepts",
  "recipe.import.source.text.lineCount": { one: "{count} erkannte Zeile", other: "{count} erkannte Zeilen" },
  "recipe.import.source.text.copied": "Kopiert",
  "recipe.import.source.text.copyAll": "Alles kopieren",
  "recipe.import.source.text.pdfLoading": "PDF wird geladen …",
  "recipe.import.source.text.pdfOpen": "PDF öffnen",
  "recipe.import.source.text.pdfPreviewOn": "PDF-Vorschau",
  "recipe.import.source.text.pdfPreviewOff": "Vorschau aus",
  "recipe.import.source.text.empty": "Es wurde kein Text erkannt.",
  "recipe.import.source.line.toIngredientTitle": "Zeile in Zutat umwandeln",
  "recipe.import.source.line.toIngredientAria": "Zeile {index} in Zutat umwandeln",
  "recipe.import.source.line.toStepTitle": "Zeile in Schritt umwandeln",
  "recipe.import.source.line.toStepAria": "Zeile {index} in Schritt umwandeln",
  "recipe.import.source.link.fallbackName": "Quelle",
  "recipe.import.source.link.openOriginal": "Originalseite öffnen",
  "recipe.import.source.link.notHttp": "Diese Quelle ist kein http(s)-Link und wird nicht verlinkt.",
  "recipe.import.source.link.compareHint":
    "Vergleiche die Angaben rechts mit der Originalseite und korrigiere, was der Importer nicht sauber erkannt hat.",

  /* ------------------------------ upload progress -------------------------------- */
  "recipe.import.upload.defaultFileName": "Datei",
  "recipe.import.upload.ariaLabel": "Upload-Fortschritt",

  /* -------------------------------- draft edit ------------------------------------ */
  "recipe.import.draftEdit.needTitle": "Bitte einen Titel eingeben.",
  "recipe.import.draftEdit.noIngredients": "Das Rezept hat noch keine Zutaten.",
  "recipe.import.draftEdit.noSteps": "Das Rezept hat noch keine Zubereitungsschritte.",

  /* ---------------------------------- image --------------------------------------- */
  "recipe.import.image.tooLarge": "Die Datei ist {size} groß. Erlaubt sind maximal {max}.",
  "recipe.import.image.empty": "Die Datei ist leer.",

  /* --------------------------------- queries --------------------------------------- */
  "recipe.import.queries.draftNotFound.message": "Entwurf nicht gefunden",
  "recipe.import.queries.draftNotFound.hint": "Dieser Import-Entwurf existiert in keiner deiner Gruppen.",

  /* ------------------------- review editor (ParsedRecipeEditor) --------------------
     Three placeholders keep GERMAN example text in the English catalog on purpose,
     because a German-only parser is what consumes them: `parseDuration` reads
     "1 Std 15 Min", and `INGREDIENT_HEADING_RE` matches "Für den Teig:". Showing an
     English example there would advertise input the parser silently drops. The
     surrounding sentence IS translated — only the sample token stays German. */
  "recipe.import.editor.basics.title": "Grunddaten",
  "recipe.import.editor.title.label": "Titel *",
  "recipe.import.editor.title.placeholder": "Wie heißt das Rezept?",
  "recipe.import.editor.description.label": "Kurzbeschreibung",
  "recipe.import.editor.description.placeholder": "Optional – ein Satz zum Rezept",
  "recipe.import.editor.servings.label": "Portionen",
  "recipe.import.editor.servings.ariaLabel": "Anzahl Portionen",
  "recipe.import.editor.servingsUnit.label": "Einheit",
  "recipe.import.editor.times.label": "Zeiten (Minuten)",
  "recipe.import.editor.times.prep": "Vorbereitung",
  "recipe.import.editor.times.cook": "Kochen / Backen",
  "recipe.import.editor.times.total": "Gesamt",
  "recipe.import.editor.minutes.placeholder": "z. B. 30 oder 1 Std 15 Min",
  "recipe.import.editor.difficulty.label": "Schwierigkeit",
  "recipe.import.editor.difficulty.none": "– keine Angabe –",
  /* Lowercase on purpose — these are the editor's own Select labels and differ from
     `recipe.recipes.difficulty.*` ("Einfach"). Pre-existing copy; parity forbids tidying it. */
  "recipe.import.editor.difficulty.einfach": "einfach",
  "recipe.import.editor.difficulty.mittel": "mittel",
  "recipe.import.editor.difficulty.schwer": "schwer",
  "recipe.import.editor.source.label": "Quelle",
  "recipe.import.editor.source.placeholder": "z. B. chefkoch.de oder Omas Kochbuch",
  "recipe.import.editor.tags.label": "Tags",
  "recipe.import.editor.tags.placeholder": "Tag hinzufügen (Enter)",
  "recipe.import.editor.tags.remove": "Tag {tag} entfernen",

  "recipe.import.editor.ingredients.title": "Zutaten ({count})",
  "recipe.import.editor.flagged": "{count} prüfen",
  "recipe.import.editor.ingredients.reparseAll": "Alle neu parsen",
  "recipe.import.editor.pasteText": "Text einfügen",
  "recipe.import.editor.cancel": "Abbrechen",
  "recipe.import.editor.ingredients.addRow": "Zeile",
  "recipe.import.editor.ingredients.paste.placeholder":
    "Eine Zutat pro Zeile einfügen.\nAbschnitte als „Für den Teig:“",
  "recipe.import.editor.ingredients.paste.submit": "Zeilen übernehmen",
  "recipe.import.editor.ingredients.empty":
    "Noch keine Zutaten. Füge eine Zeile hinzu oder übernimm Zeilen aus dem Rohtext links.",
  "recipe.import.editor.section.ariaLabel": "Abschnitt",
  "recipe.import.editor.ingredients.quantity.ariaLabel": "Menge Zeile {index}",
  "recipe.import.editor.ingredients.quantity.placeholder": "Menge",
  "recipe.import.editor.ingredients.unit.ariaLabel": "Einheit Zeile {index}",
  "recipe.import.editor.ingredients.unit.placeholder": "Einheit",
  "recipe.import.editor.ingredients.name.ariaLabel": "Zutat Zeile {index}",
  "recipe.import.editor.ingredients.name.placeholder": "Zutat",
  "recipe.import.editor.ingredients.quantityMax.ariaLabel": "Menge bis Zeile {index}",
  "recipe.import.editor.ingredients.quantityMax.placeholder": "bis (z. B. 3)",
  "recipe.import.editor.ingredients.note.ariaLabel": "Notiz Zeile {index}",
  "recipe.import.editor.ingredients.note.placeholder": "Notiz (z. B. fein gehackt)",
  "recipe.import.editor.ingredients.section.ariaLabel": "Abschnitt Zeile {index}",
  "recipe.import.editor.ingredients.section.placeholder": "Abschnitt (z. B. Für den Teig)",
  "recipe.import.editor.ingredients.raw.label": "Rohzeile (aus der Quelle)",
  "recipe.import.editor.ingredients.raw.ariaLabel": "Rohzeile {index}",
  "recipe.import.editor.ingredients.raw.reparse": "Rohzeile neu parsen",
  "recipe.import.editor.row.up": "Nach oben",
  "recipe.import.editor.row.down": "Nach unten",
  "recipe.import.editor.row.editDetails": "Details bearbeiten",
  "recipe.import.editor.row.delete": "Zeile löschen",
  "recipe.import.editor.ingredients.row.reparse": "Zeile neu parsen",
  "recipe.import.editor.ingredients.row.split": "Zusammengefasste Zeile teilen",
  "recipe.import.editor.ingredients.row.toStep": "Zutat zu Schritt verschieben",

  "recipe.import.editor.steps.title": "Zubereitung ({count})",
  "recipe.import.editor.steps.resplit": "Neu aufteilen",
  "recipe.import.editor.steps.addStep": "Schritt",
  "recipe.import.editor.steps.paste.placeholder":
    "Zubereitungstext einfügen – „1.“, „2.“ oder Leerzeilen trennen die Schritte.",
  "recipe.import.editor.steps.paste.submit": "Schritte übernehmen",
  "recipe.import.editor.steps.empty":
    "Noch keine Schritte. Füge einen Schritt hinzu oder übernimm Zeilen aus dem Rohtext links.",
  "recipe.import.editor.steps.text.ariaLabel": "Schritt {index}",
  "recipe.import.editor.steps.text.placeholder": "Was ist zu tun?",
  "recipe.import.editor.steps.section.ariaLabel": "Abschnitt Schritt {index}",
  "recipe.import.editor.steps.section.placeholder": "Abschnitt (z. B. Teig zubereiten)",
  "recipe.import.editor.steps.row.split": "Schritt teilen",
  "recipe.import.editor.steps.row.toIngredient": "Schritt zu Zutat verschieben",
  "recipe.import.editor.steps.row.editSection": "Abschnitt bearbeiten",
  "recipe.import.editor.steps.row.delete": "Schritt löschen",

  "recipe.import.editor.notes.title": "Notizen",
  "recipe.import.editor.notes.hint": "Alles, was nicht in die Schritte gehört – z. B. Tipps oder Varianten.",
  "recipe.import.editor.notes.ariaLabel": "Notizen",
  "recipe.import.editor.notes.placeholder": "Optional",

  /* ---------------------------------- errors ---------------------------------------
     The title/hint pairs `toImportApiError()` maps a status + error code onto.
     A hint is deliberately long and actionable: this panel is the only thing a
     user sees when an import fails, so "Fehler" is never an acceptable answer. */
  "recipe.import.error.network.title": "Keine Verbindung zum Server",
  "recipe.import.error.network.hint":
    "Prüfe deine Internetverbindung. Der Import wurde nicht gestartet, du kannst es einfach nochmal versuchen.",
  "recipe.import.error.unauthorized.title": "Du bist nicht mehr angemeldet",
  "recipe.import.error.unauthorized.hint":
    "Deine Sitzung ist abgelaufen. Melde dich neu an – dein Entwurf bleibt gespeichert.",
  "recipe.import.error.forbidden.title": "Kein Zugriff auf diese Gruppe",
  "recipe.import.error.forbidden.hint":
    "Du bist kein Mitglied der Gruppe, in die importiert werden soll. Wechsle die Gruppe oder lass dich einladen.",
  "recipe.import.error.notFound.title": "Entwurf nicht gefunden",
  "recipe.import.error.notFound.hint":
    "Der Import-Entwurf existiert nicht mehr – vielleicht wurde er schon gespeichert oder verworfen.",
  "recipe.import.error.tooLarge.title": "Datei zu groß",
  "recipe.import.error.tooLarge.hint":
    "Die Datei ist größer als 15 MB. Mach ein Foto mit geringerer Auflösung oder verkleinere die PDF-Datei.",
  "recipe.import.error.unsupportedMediaType.title": "Dateityp nicht unterstützt",
  "recipe.import.error.unsupportedMediaType.hint": "Erlaubt sind Fotos (JPEG, PNG, WebP, HEIC) und PDF-Dateien.",
  "recipe.import.error.pdfNoTextLayer.title": "PDF ohne Textebene",
  "recipe.import.error.pdfNoTextLayer.hint":
    "Dieses PDF enthält keinen auslesbaren Text und konnte auch nicht in Bilder umgewandelt werden. Bitte lade ein Foto der Seite hoch.",
  "recipe.import.error.ocrFailed.title": "Text konnte nicht erkannt werden",
  "recipe.import.error.ocrFailed.hint":
    "Die Texterkennung hat auf diesem Bild nichts gefunden. Tipps: gerade von oben fotografieren, gutes Licht, keine Schatten, Seite ganz im Bild.",
  "recipe.import.error.noRecipeData.title": "Auf dieser Seite wurden keine Rezeptdaten gefunden",
  "recipe.import.error.noRecipeData.hint":
    "Die Seite liefert kein maschinenlesbares Rezept. Du kannst die Seite stattdessen abfotografieren oder den Text von Hand einfügen.",
  "recipe.import.error.fetchFailed.title": "Seite konnte nicht geladen werden",
  "recipe.import.error.fetchFailed.hint":
    "Der Server konnte die URL nicht abrufen (offline, Login-Pflicht oder Bot-Schutz). Prüfe die Adresse oder importiere die Seite als Foto.",
  "recipe.import.error.ocrTimeout.title": "Die Texterkennung hat zu lange gedauert",
  "recipe.import.error.ocrTimeout.hint":
    "Der Server hat abgebrochen. Versuche es mit einem kleineren Ausschnitt oder einem Foto pro Seite nochmal.",
  "recipe.import.error.ocrTimeoutClient.hint":
    "Der Server hat nicht rechtzeitig geantwortet. Versuche es mit einem Foto pro Seite oder einem kleineren Bild erneut.",
  "recipe.import.error.rateLimited.title": "Zu viele Anfragen",
  "recipe.import.error.rateLimited.hint": "Bitte warte einen Moment und versuche es dann erneut.",
  "recipe.import.error.validation.title": "Die Daten wurden nicht akzeptiert",
  "recipe.import.error.validation.hint":
    "Bitte prüfe die markierten Felder. Ein Titel ist Pflicht, Mengen müssen Zahlen sein.",
  "recipe.import.error.server.title": "Serverfehler",
  "recipe.import.error.server.hint": "Auf dem Server ist etwas schiefgelaufen. Bitte versuche es in einem Moment erneut.",
  "recipe.import.error.unknown.title": "Unerwarteter Fehler",
  "recipe.import.error.unknown.hint":
    "Bitte versuche es erneut. Falls es wieder passiert, notiere dir was du getan hast.",
  "recipe.import.error.unexpected.hint": "Bitte versuche es erneut.",
  "recipe.import.error.aborted.title": "Abgebrochen",
  "recipe.import.error.aborted.hint": "Der Vorgang wurde abgebrochen.",
  "recipe.import.error.noFiles.title": "Keine Datei ausgewählt",
  "recipe.import.error.noFiles.hint": "Bitte wähle zuerst ein Foto oder eine Datei aus.",
} as const satisfies NamespaceCatalog<"recipe">;

export type ImportCatalog = typeof importDe;
