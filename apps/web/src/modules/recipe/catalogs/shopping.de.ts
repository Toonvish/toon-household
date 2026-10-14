/**
 * German — namespace "shopping" (see docs/i18n.md §9 for the file's owner).
 * Covers apps/web/src/features/shopping/** — lists, list detail, "Häufig
 * gekauft", AddRecipeToListDialog, and the sticky add bar.
 */
import type { NamespaceCatalog } from "@toon/shared";

export const shoppingDe = {
  // ShoppingListsPage — overview
  "recipe.shopping.lists.heading": "Einkaufen",
  "recipe.shopping.lists.subtitle": "Gemeinsame Einkaufslisten für die ganze Gruppe.",
  "recipe.shopping.lists.create": "Liste anlegen",
  "recipe.shopping.lists.offlineHint": "Dafür brauchst du eine Verbindung",
  "recipe.shopping.lists.empty.title": "Noch keine Einkaufsliste",
  "recipe.shopping.lists.empty.description":
    "Lege eine Liste an, füge Artikel hinzu oder schicke ein ganzes Rezept darauf — die Mengen werden für die gewünschte Portionszahl umgerechnet.",
  "recipe.shopping.lists.empty.action": "Erste Liste anlegen",
  "recipe.shopping.lists.rename": "Umbenennen",
  "recipe.shopping.lists.delete": "Liste löschen",
  // Two whole sentences rather than one key with a conditional `{synced}` — a placeholder that
  // may be empty renders a dangling `·` (i18n-keys.md §7.1). `{members}` is filled with
  // `t("household.count.members", { count })`, never inlined, because two pluralised numbers cannot
  // share one plural entry (R-B).
  "recipe.shopping.lists.sharedSummary": "Geteilt mit {group} · {members}",
  "recipe.shopping.lists.sharedSummarySynced": "Geteilt mit {group} · {members} · {synced}",
  "recipe.shopping.lists.syncedRelative": "{relative} synchronisiert",
  "recipe.shopping.lists.shopperActive": "{name} kauft gerade ein",
  "recipe.shopping.lists.counts": "{open} offen · {bought} heute gekauft",
  "recipe.shopping.lists.openList": "Öffnen",
  "recipe.shopping.lists.previewMore": { one: "+{count} weitere", other: "+{count} weitere" },
  "recipe.shopping.lists.progressAriaLabel": "Fortschritt: {percent} %",
  "recipe.shopping.lists.cardMenuLabel": "Aktionen für „{name}“",
  "recipe.shopping.lists.allLists": "Alle Listen",

  // Shared across list row, detail header, delete/clear confirms, AddRecipeToListDialog
  "recipe.shopping.list.empty": "leer",
  "recipe.shopping.list.itemCount": { one: "{count} Position", other: "{count} Positionen" },
  "recipe.shopping.list.name.label": "Name",
  "recipe.shopping.list.name.placeholder": "z. B. Rewe",
  "recipe.shopping.list.defaultName": "Einkaufsliste",

  // Generic actions reused across the shopping dialogs
  "recipe.shopping.action.cancel": "Abbrechen",
  "recipe.shopping.action.save": "Speichern",
  "recipe.shopping.action.create": "Anlegen",
  "recipe.shopping.action.delete": "Löschen",
  "recipe.shopping.action.clear": "Leeren",
  "recipe.shopping.action.add": "Hinzufügen",

  // CreateListDialog
  "recipe.shopping.create.title": "Einkaufsliste anlegen",
  "recipe.shopping.create.success": "„{name}“ angelegt",

  // RenameListDialog
  "recipe.shopping.rename.title": "Liste umbenennen",

  // DeleteListDialog
  "recipe.shopping.delete.title": "Einkaufsliste löschen?",
  "recipe.shopping.delete.confirmDescription":
    "„{name}“ und alle {itemCount} werden gelöscht. Das lässt sich nicht rückgängig machen.",
  "recipe.shopping.delete.success": "„{name}“ gelöscht",
  "recipe.shopping.delete.error": "Löschen fehlgeschlagen",

  // ShoppingListDetailPage
  "recipe.shopping.detail.backToLists": "Alle Listen",
  "recipe.shopping.detail.backToListsShort": "Listen",
  "recipe.shopping.detail.allDone": "Alles erledigt",
  "recipe.shopping.detail.queuedCount": {
    one: "{count} Änderung wartet",
    other: "{count} Änderungen warten",
  },
  "recipe.shopping.detail.clearList": "Liste leeren",
  "recipe.shopping.detail.offlineBanner":
    "Offline — Abhaken und Hinzufügen funktionieren trotzdem und werden später synchronisiert.",
  "recipe.shopping.detail.empty.title": "Nichts mehr zu kaufen",
  "recipe.shopping.detail.empty.descriptionWithCatalog":
    "Tippe unten auf einen Vorschlag oder gib etwas Neues ein.",
  "recipe.shopping.detail.empty.description":
    "Füge unten Artikel hinzu — oder schicke ein ganzes Rezept aus der Rezeptansicht hierher.",
  "recipe.shopping.detail.subtitle": "{open} offen · {bought} heute gekauft · zum Abhaken antippen",
  "recipe.shopping.detail.subtitleShort": "{open} offen · {bought} gekauft · zum Abhaken antippen",
  "recipe.shopping.detail.share": "Teilen",
  "recipe.shopping.detail.shareCopiedToast": "In die Zwischenablage kopiert",
  "recipe.shopping.detail.shareUnavailableToast": "Teilen nicht möglich",
  // Three sort options only (R32), client-side, default "position" — do not add a fourth.
  "recipe.shopping.detail.sort.label": "Sortierung",
  "recipe.shopping.detail.sort.position": "Reihenfolge",
  "recipe.shopping.detail.sort.newest": "Neueste zuerst",
  "recipe.shopping.detail.sort.alpha": "A–Z",
  "recipe.shopping.suggestion.dismissError": "Vorschlag bleibt bestehen",

  // Clear-list confirm
  "recipe.shopping.clear.title": "Liste leeren?",
  "recipe.shopping.clear.description": "Alle {itemCount} werden entfernt. „{sectionName}“ bleibt erhalten.",

  // AddItemBar — placeholder now carries the examples; the short form was AddItemBar's only
  // call site and both placements use the longer one (i18n-keys.md §7.8).
  "recipe.shopping.addItem.placeholderExamples": "Artikel hinzufügen — „500 g Mehl, 2 Zitronen, Milch“",
  "recipe.shopping.addItem.ariaLabel": "Artikel hinzufügen",
  "recipe.shopping.addItem.previewLabel": "Wird hinzugefügt:",

  // AddRecipeToListDialog
  "recipe.shopping.addRecipe.title": "Zur Einkaufsliste",
  "recipe.shopping.addRecipe.submit": {
    one: "{count} Position hinzufügen",
    other: "{count} Positionen hinzufügen",
  },
  "recipe.shopping.addRecipe.listsLoading": "Einkaufslisten werden geladen",
  "recipe.shopping.addRecipe.noLists": "Diese Gruppe hat noch keine Einkaufsliste. Leg gleich hier eine an.",
  "recipe.shopping.addRecipe.createListError": "Liste konnte nicht angelegt werden.",
  "recipe.shopping.addRecipe.createOffline":
    "Dafür brauchst du eine Internetverbindung — Listen anlegen geht nicht offline.",
  "recipe.shopping.addRecipe.list.label": "Liste",
  "recipe.shopping.addRecipe.servings.label": "Portionen",
  "recipe.shopping.addRecipe.servings.hint": "Die Mengen werden entsprechend umgerechnet.",
  "recipe.shopping.addRecipe.noServings":
    "Dieses Rezept hat keine Portionsangabe, die Mengen werden unverändert übernommen.",
  "recipe.shopping.addRecipe.ingredients.heading": "Zutaten",
  "recipe.shopping.addRecipe.selectAll": "Alle",
  "recipe.shopping.addRecipe.selectAtLeastOne": "Wähle mindestens eine Zutat aus.",
  "recipe.shopping.addRecipe.mergeNotice": {
    one: "Wird zu {count} Position zusammengefasst. Gleiche Artikel werden mit dem zusammengezählt, was schon auf der Liste steht.",
    other:
      "Wird zu {count} Positionen zusammengefasst. Gleiche Artikel werden mit dem zusammengezählt, was schon auf der Liste steht.",
  },
  "recipe.shopping.addRecipe.mergeHint":
    "Gleiche Artikel werden mit dem zusammengezählt, was schon auf der Liste steht.",
  "recipe.shopping.addRecipe.noIngredients":
    "Dieses Rezept hat keine Zutaten, die auf eine Einkaufsliste passen.",

  // EditItemDialog
  "recipe.shopping.editItem.title": "Position bearbeiten",
  "recipe.shopping.editItem.name.label": "Artikel",
  "recipe.shopping.editItem.quantity.label": "Menge",
  "recipe.shopping.editItem.quantity.placeholder": "leer = ohne Menge",
  "recipe.shopping.editItem.quantity.error": "Bitte eine Zahl eingeben",
  "recipe.shopping.editItem.unit.label": "Einheit",
  "recipe.shopping.editItem.unit.placeholder": "g, ml, Stück …",
  "recipe.shopping.editItem.note.label": "Notiz",
  "recipe.shopping.editItem.note.placeholder": "z. B. laktosefrei",
  "recipe.shopping.editItem.mergeWarning":
    "„{name}“ steht schon auf der Liste — die beiden Positionen werden zusammengefasst.",

  // FrequentlyUsed
  "recipe.shopping.frequentlyUsed.heading": "Häufig gekauft",
  // Re-purposed, not deleted: the per-chip `×` is gone, so `dismissAriaLabel` becomes the chip's
  // `title` attribute (advertising the long-press affordance) and `dismissTitle` becomes the
  // ConfirmDialog's confirm-button label. Byte-identical to the pre-redesign value.
  "recipe.shopping.frequentlyUsed.dismissAriaLabel": "{name} nicht mehr vorschlagen",
  "recipe.shopping.frequentlyUsed.dismissTitle": "Nicht mehr vorschlagen",
  "recipe.shopping.frequentlyUsed.showAll": "Alle {count} anzeigen",
  "recipe.shopping.frequentlyUsed.hideHint": "Rechtsklick oder langes Drücken versteckt einen Vorschlag.",
  "recipe.shopping.frequentlyUsed.hideConfirm.title": "„{name}“ nicht mehr vorschlagen?",
  "recipe.shopping.frequentlyUsed.hideConfirm.description":
    "Der Vorschlag verschwindet aus „Häufig gekauft“. Über „Alle anzeigen“ kannst du ihn wieder einblenden.",
  "recipe.shopping.frequentlyUsed.hiddenToast": "Wird nicht mehr vorgeschlagen",
  "recipe.shopping.frequentlyUsed.showHidden": "Ausgeblendete anzeigen",
  "recipe.shopping.frequentlyUsed.unhide": "Wieder vorschlagen",
  "recipe.shopping.frequentlyUsed.unhiddenToast": "Wird wieder vorgeschlagen",
  "recipe.shopping.frequentlyUsed.addAriaLabel": "„{name}“ zur Liste hinzufügen",

  // ShoppingItemCard (desktop row) + ShoppingItemTile (phone grid)
  "recipe.shopping.item.checkAriaLabel": "{name} abhaken",
  "recipe.shopping.item.sources": "aus {sources}",
  "recipe.shopping.item.sourcesMore": "aus {name} +{count}",
  "recipe.shopping.item.edit": "Bearbeiten",
  "recipe.shopping.item.remove": "Von der Liste entfernen",
  "recipe.shopping.item.check": "Abhaken",
  "recipe.shopping.item.details": "Details zu {name}",
  "recipe.shopping.item.longPressHint": "Lange auf eine Karte tippen für Details.",

  // ItemDetailDialog
  "recipe.shopping.item.detail.amount": "Menge",
  "recipe.shopping.item.detail.note": "Notiz",
  "recipe.shopping.item.detail.sources": { one: "Aus Rezept", other: "Aus Rezepten" },
  "recipe.shopping.item.detail.empty": "Keine weiteren Angaben.",

  // Section headers + the bought section (BoughtSection renders nothing — no header, no empty
  // state — when there are no bought entries, so there is deliberately no `recipe.shopping.bought.empty`).
  "recipe.shopping.toBuy.heading": "Zu kaufen",
  "recipe.shopping.toBuy.headingWithCount": "Zu kaufen · {count}",
  "recipe.shopping.bought.heading": "Heute gekauft",
  "recipe.shopping.bought.headingWithCount": "Heute gekauft · {count}",
  "recipe.shopping.bought.collapse": "Gekauftes einklappen",
  "recipe.shopping.bought.expand": "Gekauftes ausklappen",
  // "Gekauftes leeren" is NOT destructive (R31): the confirm says "aus dieser Ansicht entfernen",
  // never "löschen" — POST …/bought/clear moves a watermark, the log rows stay in the history.
  "recipe.shopping.bought.clear": "Gekauftes leeren",
  "recipe.shopping.bought.clearConfirm.title": "Gekaufte Artikel aus dieser Ansicht entfernen?",
  "recipe.shopping.bought.clearConfirm.description":
    "Die Artikel bleiben in der Einkaufshistorie — nur diese Ansicht wird geleert.",
  "recipe.shopping.bought.clearConfirm.confirm": "Aus der Ansicht entfernen",
  "recipe.shopping.bought.clearedToast": "Ansicht geleert",
  "recipe.shopping.bought.rowMeta": "{who} · {when}",
  "recipe.shopping.bought.you": "Du",
  "recipe.shopping.bought.unknownBuyer": "Unbekannt",
  "recipe.shopping.bought.buyers": "{first} +{count}",
  // The undo copy is deliberately not "Undo": re-adding the line MAY merge with what is on the
  // list now, so the merge hint has to be readable before the tap, not after (i18n-keys.md §7.3).
  "recipe.shopping.bought.undo": "Zurück auf die Liste",
  "recipe.shopping.bought.undoMergeHint":
    "Wenn „{name}“ schon wieder auf der Liste steht, werden die Mengen zusammengerechnet.",
  "recipe.shopping.bought.undoSuccess": "„{name}“ steht wieder auf der Liste",
  "recipe.shopping.bought.undoFailed": "Konnte nicht zurückgelegt werden",

  // "From this week's plan" (WeekPlanPanel)
  "recipe.shopping.fromPlan.title": "Aus dem Wochenplan",
  "recipe.shopping.fromPlan.recipeCount": { one: "{count} Rezept", other: "{count} Rezepte" },
  "recipe.shopping.fromPlan.ingredientCount": { one: "{count} Zutat", other: "{count} Zutaten" },
  "recipe.shopping.fromPlan.missingCount": {
    one: "{count} Zutat noch auf keiner Liste",
    other: "{count} Zutaten noch auf keiner Liste",
  },
  "recipe.shopping.fromPlan.subtitle": "{recipes} · {ingredients}",
  "recipe.shopping.fromPlan.rowMeta": "{weekday} · {ingredients}",
  // Names the target list — the target is the CLIENT's choice (storageKeys.lastShoppingListId,
  // falling back to the alphabetically first list), never a server-side default (R9).
  "recipe.shopping.fromPlan.addAll": "Alles auf „{list}“",
  "recipe.shopping.fromPlan.dialog.title": "Aus dem Wochenplan hinzufügen",
  "recipe.shopping.fromPlan.dialog.hint": "Wähle ab, was du schon zu Hause hast.",
  "recipe.shopping.fromPlan.dialog.submit": {
    one: "{count} Zutat auf „{list}“",
    other: "{count} Zutaten auf „{list}“",
  },
  "recipe.shopping.fromPlan.pickList": "Andere Liste wählen",
  "recipe.shopping.fromPlan.addedToast": "Auf „{list}“ hinzugefügt",
  "recipe.shopping.fromPlan.addFailedToast": "Konnte nicht hinzugefügt werden",
  "recipe.shopping.fromPlan.empty": "Vom Wochenplan fehlt nichts mehr auf der Liste.",
  "recipe.shopping.fromPlan.noList": "Für den Wochenplan brauchst du erst eine Einkaufsliste.",

  // Bought history: desktop panel + /shopping/history screen
  "recipe.shopping.history.title": "Einkaufshistorie",
  "recipe.shopping.history.titleShort": "Historie",
  "recipe.shopping.history.subtitle": "Alles, was abgehakt wurde — nach Tag.",
  "recipe.shopping.history.all": "Alle",
  "recipe.shopping.history.today": "Heute",
  "recipe.shopping.history.itemCount": { one: "{count} Artikel", other: "{count} Artikel" },
  // {who} = one buyer's name, `recipe.shopping.bought.you`, or `recipe.shopping.bought.unknownBuyer`
  "recipe.shopping.history.dayMeta": "{items} · {who}",
  "recipe.shopping.history.dayMetaShort": "{day} · {count}",
  "recipe.shopping.history.empty": "Noch nichts gekauft.",
  "recipe.shopping.history.loadMore": "Mehr laden",

  // ListRecipesPanel + provenance
  "recipe.shopping.listRecipe.heading": "Rezepte auf dieser Liste",
  "recipe.shopping.listRecipe.ingredientsOf": "{onList} von {total} Zutaten",
  "recipe.shopping.listRecipe.meta": "{ingredients} · {servings}",
  "recipe.shopping.listRecipe.remove": "Entfernen",
  "recipe.shopping.listRecipe.addRecipe": "Zutaten eines Rezepts hinzufügen",
  "recipe.shopping.listRecipe.remove.title": "„{title}“ von der Liste nehmen?",
  // The remove dialog is THREE keys, not one composite sentence (R-B.2): the runtime selects a
  // plural form from exactly one count, so `description` pluralises on the removed count and
  // `sharedNote` pluralises on the shared count, each its own whole sentence. When sharedCount is
  // 0 the dialog renders `descriptionExclusive` alone instead of the pair.
  "recipe.shopping.listRecipe.remove.description": {
    one: "Eine Position wird entfernt.",
    other: "{count} Positionen werden entfernt.",
  },
  "recipe.shopping.listRecipe.remove.sharedNote": {
    one: "Eine Position bleibt, weil sie auch aus einem anderen Rezept kommt — ihre Menge ändert sich nicht.",
    other:
      "{count} Positionen bleiben, weil sie auch aus anderen Rezepten kommen — ihre Mengen ändern sich nicht.",
  },
  "recipe.shopping.listRecipe.remove.descriptionExclusive": {
    one: "Die einzige Position von „{title}“ wird entfernt.",
    other: "Alle {count} Positionen von „{title}“ werden entfernt.",
  },
  "recipe.shopping.listRecipe.removedToast": "„{title}“ von der Liste genommen",
  "recipe.shopping.listRecipe.removeFailedToast": "Entfernen fehlgeschlagen",
} as const satisfies NamespaceCatalog<"recipe">;

export type ShoppingCatalog = typeof shoppingDe;
