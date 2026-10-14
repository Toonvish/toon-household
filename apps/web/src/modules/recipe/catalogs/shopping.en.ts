/**
 * English — namespace "shopping". See `shopping.de.ts` for who owns this file.
 */
import type { LocaleCatalog } from "@toon/shared";
import type { ShoppingCatalog } from "./shopping.de.ts";

export const shoppingEn: LocaleCatalog<ShoppingCatalog> = {
  // ShoppingListsPage — overview
  "recipe.shopping.lists.heading": "Shopping",
  "recipe.shopping.lists.subtitle": "Shared shopping lists for the whole group.",
  "recipe.shopping.lists.create": "Create list",
  "recipe.shopping.lists.offlineHint": "You need a connection for that",
  "recipe.shopping.lists.empty.title": "No shopping list yet",
  "recipe.shopping.lists.empty.description":
    "Create a list, add items, or send it a whole recipe — amounts are scaled to the servings you want.",
  "recipe.shopping.lists.empty.action": "Create first list",
  "recipe.shopping.lists.rename": "Rename",
  "recipe.shopping.lists.delete": "Delete list",
  "recipe.shopping.lists.sharedSummary": "Shared with {group} · {members}",
  "recipe.shopping.lists.sharedSummarySynced": "Shared with {group} · {members} · {synced}",
  "recipe.shopping.lists.syncedRelative": "Synced {relative}",
  "recipe.shopping.lists.shopperActive": "{name} is shopping right now",
  "recipe.shopping.lists.counts": "{open} to buy · {bought} bought today",
  "recipe.shopping.lists.openList": "Open",
  "recipe.shopping.lists.previewMore": { one: "+{count} more", other: "+{count} more" },
  "recipe.shopping.lists.progressAriaLabel": "Progress: {percent}%",
  "recipe.shopping.lists.cardMenuLabel": "Actions for “{name}”",
  "recipe.shopping.lists.allLists": "All lists",

  // Shared across list row, detail header, delete/clear confirms, AddRecipeToListDialog
  "recipe.shopping.list.empty": "empty",
  "recipe.shopping.list.itemCount": { one: "{count} item", other: "{count} items" },
  "recipe.shopping.list.name.label": "Name",
  "recipe.shopping.list.name.placeholder": "e.g. Rewe",
  "recipe.shopping.list.defaultName": "Shopping list",

  // Generic actions reused across the shopping dialogs
  "recipe.shopping.action.cancel": "Cancel",
  "recipe.shopping.action.save": "Save",
  "recipe.shopping.action.create": "Create",
  "recipe.shopping.action.delete": "Delete",
  "recipe.shopping.action.clear": "Clear",
  "recipe.shopping.action.add": "Add",

  // CreateListDialog
  "recipe.shopping.create.title": "Create shopping list",
  "recipe.shopping.create.success": "“{name}” created",

  // RenameListDialog
  "recipe.shopping.rename.title": "Rename list",

  // DeleteListDialog
  "recipe.shopping.delete.title": "Delete shopping list?",
  "recipe.shopping.delete.confirmDescription":
    "“{name}” and all {itemCount} will be deleted. This cannot be undone.",
  "recipe.shopping.delete.success": "“{name}” deleted",
  "recipe.shopping.delete.error": "Delete failed",

  // ShoppingListDetailPage
  "recipe.shopping.detail.backToLists": "All lists",
  "recipe.shopping.detail.backToListsShort": "Lists",
  "recipe.shopping.detail.allDone": "All done",
  "recipe.shopping.detail.queuedCount": {
    one: "{count} change pending",
    other: "{count} changes pending",
  },
  "recipe.shopping.detail.clearList": "Clear list",
  "recipe.shopping.detail.offlineBanner":
    "Offline — checking off and adding still work and will sync later.",
  "recipe.shopping.detail.empty.title": "Nothing left to buy",
  "recipe.shopping.detail.empty.descriptionWithCatalog":
    "Tap a suggestion below or enter something new.",
  "recipe.shopping.detail.empty.description":
    "Add items below — or send a whole recipe over from the recipe view.",
  "recipe.shopping.detail.subtitle": "{open} to buy · {bought} bought today · tap to tick off",
  "recipe.shopping.detail.subtitleShort": "{open} to buy · {bought} bought · tap to tick off",
  "recipe.shopping.detail.share": "Share",
  "recipe.shopping.detail.shareCopiedToast": "Copied to clipboard",
  "recipe.shopping.detail.shareUnavailableToast": "Sharing not possible",
  "recipe.shopping.detail.sort.label": "Sort",
  "recipe.shopping.detail.sort.position": "List order",
  "recipe.shopping.detail.sort.newest": "Newest first",
  "recipe.shopping.detail.sort.alpha": "A–Z",
  "recipe.shopping.suggestion.dismissError": "Suggestion stays",

  // Clear-list confirm
  "recipe.shopping.clear.title": "Clear list?",
  "recipe.shopping.clear.description": "All {itemCount} will be removed. “{sectionName}” stays.",

  // AddItemBar
  "recipe.shopping.addItem.placeholderExamples": "Add an item — “500 g flour, 2 lemons, milk”",
  "recipe.shopping.addItem.ariaLabel": "Add item",
  "recipe.shopping.addItem.previewLabel": "Will be added:",

  // AddRecipeToListDialog
  "recipe.shopping.addRecipe.title": "Add to shopping list",
  "recipe.shopping.addRecipe.submit": {
    one: "Add {count} item",
    other: "Add {count} items",
  },
  "recipe.shopping.addRecipe.listsLoading": "Loading shopping lists",
  "recipe.shopping.addRecipe.noLists": "This group has no shopping list yet. Create one right here.",
  "recipe.shopping.addRecipe.createListError": "Could not create the list.",
  "recipe.shopping.addRecipe.createOffline":
    "You need an internet connection for that — creating lists does not work offline.",
  "recipe.shopping.addRecipe.list.label": "List",
  "recipe.shopping.addRecipe.servings.label": "Servings",
  "recipe.shopping.addRecipe.servings.hint": "Amounts are scaled accordingly.",
  "recipe.shopping.addRecipe.noServings":
    "This recipe has no serving size, so the amounts are added unchanged.",
  "recipe.shopping.addRecipe.ingredients.heading": "Ingredients",
  "recipe.shopping.addRecipe.selectAll": "All",
  "recipe.shopping.addRecipe.selectAtLeastOne": "Select at least one ingredient.",
  "recipe.shopping.addRecipe.mergeNotice": {
    one: "Will be merged into {count} item. Matching items are added to what is already on the list.",
    other:
      "Will be merged into {count} items. Matching items are added to what is already on the list.",
  },
  "recipe.shopping.addRecipe.mergeHint":
    "Matching items are added to what is already on the list.",
  "recipe.shopping.addRecipe.noIngredients":
    "This recipe has no ingredients that fit on a shopping list.",

  // EditItemDialog
  "recipe.shopping.editItem.title": "Edit item",
  "recipe.shopping.editItem.name.label": "Item",
  "recipe.shopping.editItem.quantity.label": "Amount",
  "recipe.shopping.editItem.quantity.placeholder": "empty = no amount",
  "recipe.shopping.editItem.quantity.error": "Please enter a number",
  "recipe.shopping.editItem.unit.label": "Unit",
  "recipe.shopping.editItem.unit.placeholder": "g, ml, pcs …",
  "recipe.shopping.editItem.note.label": "Note",
  "recipe.shopping.editItem.note.placeholder": "e.g. lactose-free",
  "recipe.shopping.editItem.mergeWarning":
    "“{name}” is already on the list — the two items will be merged.",

  // FrequentlyUsed
  "recipe.shopping.frequentlyUsed.heading": "Frequently bought",
  "recipe.shopping.frequentlyUsed.dismissAriaLabel": "Stop suggesting {name}",
  "recipe.shopping.frequentlyUsed.dismissTitle": "Stop suggesting",
  "recipe.shopping.frequentlyUsed.showAll": "Show all {count}",
  "recipe.shopping.frequentlyUsed.hideHint": "Right-click or long-press a chip to hide it.",
  "recipe.shopping.frequentlyUsed.hideConfirm.title": "Stop suggesting “{name}”?",
  "recipe.shopping.frequentlyUsed.hideConfirm.description":
    "The suggestion disappears from “Frequently bought”. You can bring it back from “Show all”.",
  "recipe.shopping.frequentlyUsed.hiddenToast": "No longer suggested",
  "recipe.shopping.frequentlyUsed.showHidden": "Show hidden",
  "recipe.shopping.frequentlyUsed.unhide": "Suggest again",
  "recipe.shopping.frequentlyUsed.unhiddenToast": "Suggested again",
  "recipe.shopping.frequentlyUsed.addAriaLabel": "Add “{name}” to the list",

  // ShoppingItemCard (desktop row) + ShoppingItemTile (phone grid)
  "recipe.shopping.item.checkAriaLabel": "Check off {name}",
  "recipe.shopping.item.sources": "from {sources}",
  "recipe.shopping.item.sourcesMore": "from {name} +{count}",
  "recipe.shopping.item.edit": "Edit",
  "recipe.shopping.item.remove": "Remove from list",
  "recipe.shopping.item.check": "Check off",
  "recipe.shopping.item.details": "Details for {name}",
  "recipe.shopping.item.longPressHint": "Press and hold a card for details.",

  // ItemDetailDialog
  "recipe.shopping.item.detail.amount": "Amount",
  "recipe.shopping.item.detail.note": "Note",
  "recipe.shopping.item.detail.sources": { one: "From recipe", other: "From recipes" },
  "recipe.shopping.item.detail.empty": "No further details.",

  // Section headers + the bought section
  "recipe.shopping.toBuy.heading": "To buy",
  "recipe.shopping.toBuy.headingWithCount": "To buy · {count}",
  "recipe.shopping.bought.heading": "Bought today",
  "recipe.shopping.bought.headingWithCount": "Bought today · {count}",
  "recipe.shopping.bought.collapse": "Collapse bought items",
  "recipe.shopping.bought.expand": "Expand bought items",
  "recipe.shopping.bought.clear": "Clear bought",
  "recipe.shopping.bought.clearConfirm.title": "Remove bought items from this view?",
  "recipe.shopping.bought.clearConfirm.description":
    "The items stay in the bought history — only this view is cleared.",
  "recipe.shopping.bought.clearConfirm.confirm": "Remove from view",
  "recipe.shopping.bought.clearedToast": "View cleared",
  "recipe.shopping.bought.rowMeta": "{who} · {when}",
  "recipe.shopping.bought.you": "You",
  "recipe.shopping.bought.unknownBuyer": "Unknown",
  "recipe.shopping.bought.buyers": "{first} +{count}",
  "recipe.shopping.bought.undo": "Back on the list",
  "recipe.shopping.bought.undoMergeHint":
    "If “{name}” is on the list again, the amounts are added together.",
  "recipe.shopping.bought.undoSuccess": "“{name}” is back on the list",
  "recipe.shopping.bought.undoFailed": "Could not be put back",

  // "From this week's plan" (WeekPlanPanel)
  "recipe.shopping.fromPlan.title": "From this week's plan",
  "recipe.shopping.fromPlan.recipeCount": { one: "{count} recipe", other: "{count} recipes" },
  "recipe.shopping.fromPlan.ingredientCount": { one: "{count} ingredient", other: "{count} ingredients" },
  "recipe.shopping.fromPlan.missingCount": {
    one: "{count} ingredient not yet on a list",
    other: "{count} ingredients not yet on a list",
  },
  "recipe.shopping.fromPlan.subtitle": "{recipes} · {ingredients}",
  "recipe.shopping.fromPlan.rowMeta": "{weekday} · {ingredients}",
  "recipe.shopping.fromPlan.addAll": "Add everything to “{list}”",
  "recipe.shopping.fromPlan.dialog.title": "Add from this week's plan",
  "recipe.shopping.fromPlan.dialog.hint": "Untick what you already have at home.",
  "recipe.shopping.fromPlan.dialog.submit": {
    one: "{count} ingredient to “{list}”",
    other: "{count} ingredients to “{list}”",
  },
  "recipe.shopping.fromPlan.pickList": "Choose another list",
  "recipe.shopping.fromPlan.addedToast": "Added to “{list}”",
  "recipe.shopping.fromPlan.addFailedToast": "Could not be added",
  "recipe.shopping.fromPlan.empty": "Nothing from this week's plan is missing from the list.",
  "recipe.shopping.fromPlan.noList": "You need a shopping list before you can add the week's plan.",

  // Bought history: desktop panel + /shopping/history screen
  "recipe.shopping.history.title": "Bought history",
  "recipe.shopping.history.titleShort": "History",
  "recipe.shopping.history.subtitle": "Everything that was ticked off, by day.",
  "recipe.shopping.history.all": "All",
  "recipe.shopping.history.today": "Today",
  "recipe.shopping.history.itemCount": { one: "{count} item", other: "{count} items" },
  "recipe.shopping.history.dayMeta": "{items} · {who}",
  "recipe.shopping.history.dayMetaShort": "{day} · {count}",
  "recipe.shopping.history.empty": "Nothing bought yet.",
  "recipe.shopping.history.loadMore": "Load more",

  // ListRecipesPanel + provenance
  "recipe.shopping.listRecipe.heading": "Recipes on this list",
  "recipe.shopping.listRecipe.ingredientsOf": "{onList} of {total} ingredients",
  "recipe.shopping.listRecipe.meta": "{ingredients} · {servings}",
  "recipe.shopping.listRecipe.remove": "Remove",
  "recipe.shopping.listRecipe.addRecipe": "Add a recipe's ingredients",
  "recipe.shopping.listRecipe.remove.title": "Take “{title}” off the list?",
  "recipe.shopping.listRecipe.remove.description": {
    one: "One item will be removed.",
    other: "{count} items will be removed.",
  },
  "recipe.shopping.listRecipe.remove.sharedNote": {
    one: "One item stays because it also comes from another recipe — its amount does not change.",
    other:
      "{count} items stay because they also come from other recipes — their amounts do not change.",
  },
  "recipe.shopping.listRecipe.remove.descriptionExclusive": {
    one: "The only item from “{title}” will be removed.",
    other: "All {count} items from “{title}” will be removed.",
  },
  "recipe.shopping.listRecipe.removedToast": "“{title}” taken off the list",
  "recipe.shopping.listRecipe.removeFailedToast": "Removing failed",
};
