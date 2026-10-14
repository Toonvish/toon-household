/**
 * German/English — the recipe module's collection and tag strings (R `groups.*`, keys renamed per
 * SPEC D10). English half of the `groups` namespace, see organise.de.ts.
 */
import type { LocaleCatalog } from "@toon/shared";
import type { OrganiseCatalog } from "./organise.de.ts";

export const organiseEn: LocaleCatalog<OrganiseCatalog> = {
  "recipe.count.recipes": { one: "{count} recipe", other: "{count} recipes" },

  /* --------------------------------- TagsPage.tsx ---------------------------- */
  "recipe.tags.title": "Tags",
  "recipe.tags.subtitle": "Tags belong to the group and can be used as filters in the recipe list.",
  "recipe.tags.create": "Create tag",
  "recipe.tags.emptyTitle": "No tags yet",
  "recipe.tags.emptyDescription":
    "Tags appear automatically when you type them while creating a recipe — or you can create them here ahead of time.",
  "recipe.tags.toRecipeList": "To the recipe list",
  "recipe.tags.editLabel": "Edit tag {name}",
  "recipe.tags.deleteLabel": "Delete tag {name}",
  "recipe.tags.deleteConfirmTitle": "Delete tag?",
  "recipe.tags.deleteConfirmDescription": {
    one: "“{name}” will be removed from {count} recipe. The recipes themselves are kept.",
    other: "“{name}” will be removed from {count} recipes. The recipes themselves are kept.",
  },
  "recipe.tags.deletedToast": "Tag deleted",
  "recipe.tags.deleteFailedToast": "Delete failed",
  "recipe.tags.savedToast": "Tag saved",
  "recipe.tags.createdToast": "Tag created",
  "recipe.tags.nameTakenError": "This tag already exists in the group.",
  "recipe.tags.editTitle": "Edit tag",
  "recipe.tags.createTitle": "New tag",
  "recipe.tags.namePlaceholder": "Vegetarian",
  "recipe.tags.colorLegend": "Color",
  "recipe.tags.noColor": "Default",
  "recipe.tags.noColorAriaLabel": "No color",
  "recipe.tags.colorAriaLabel": "Color {hex}",
  "recipe.tags.customHexLabel": "Custom hex value",
  "recipe.tags.previewLabel": "Preview:",
  "recipe.tags.previewName": "Example",
  "recipe.tags.kindLegend": "Kind",
  "recipe.tags.kindCourse": "Course",
  "recipe.tags.kindFree": "Tag",
  "recipe.tags.kindToggleLabel": "Change the kind of “{name}”",
  "recipe.tags.kindHint":
    "A course appears as the category above the recipe title. A recipe has at most one.",
  "recipe.tags.kindChangedToast": "Kind changed",
  "recipe.tags.kindChangeFailedToast": "Could not be changed",
  "recipe.tags.sectionCourses": "Courses",
  "recipe.tags.sectionFree": "Tags",

  /* --------------------------- components/TagCombobox.tsx ------------------- */
  "recipe.tagCombobox.label": "Tags",
  "recipe.tagCombobox.removeLabel": "Remove tag {name}",
  "recipe.tagCombobox.createOption": "Create “{name}”",
  "recipe.tagCombobox.hint":
    "Enter adds it, Backspace removes the last one. New tags are created automatically.",
  "recipe.tagCombobox.maxReached": "Maximum reached",
  "recipe.tagCombobox.placeholder": "Type or select a tag …",

  /* ------------------------------ CollectionsPage.tsx ------------------------ */
  "recipe.collections.title": "Collections",
  "recipe.collections.subtitle": "Group recipes by theme, e.g. “Christmas” or “Meal prep”.",
  "recipe.collections.create": "Create collection",
  "recipe.collections.emptyTitle": "No collections yet",
  "recipe.collections.emptyDescription":
    "A collection is an ordered list of recipes — perfect for menus or weekly plans.",
  "recipe.collections.createFirst": "Create first collection",
  "recipe.collections.createTitle": "New collection",
  "recipe.collections.namePlaceholder": "Christmas baking",
  "recipe.collections.createdToast": "Collection created",

  /* --------------------------- CollectionDetailPage.tsx ---------------------- */
  "recipe.collectionDetail.loading": "Loading collection …",
  "recipe.collectionDetail.backToList": "Back to collections",
  "recipe.collectionDetail.backLink": "← All collections",
  "recipe.collectionDetail.movedStatus": "Recipe moved to position {position}.",
  "recipe.collectionDetail.reorderFailedToast": "Could not save the new order",
  "recipe.collectionDetail.addRecipes": "Add recipes",
  "recipe.collectionDetail.editLabel": "Edit collection",
  "recipe.collectionDetail.deleteLabel": "Delete collection",
  "recipe.collectionDetail.emptyTitle": "This collection is empty",
  "recipe.collectionDetail.emptyDescription":
    "Add recipes to see them here in your preferred order.",
  "recipe.collectionDetail.moveUpLabel": "Move {title} up",
  "recipe.collectionDetail.moveDownLabel": "Move {title} down",
  "recipe.collectionDetail.removeLabel": "Remove {title} from collection",
  "recipe.collectionDetail.removedStatus": "{title} removed.",
  "recipe.collectionDetail.removeFailedToast": "Remove failed",
  "recipe.collectionDetail.deleteConfirmTitle": "Delete collection?",
  "recipe.collectionDetail.deleteConfirmDescription":
    "“{name}” will be deleted. The recipes themselves are kept.",
  "recipe.collectionDetail.deletedToast": "Collection deleted",
  "recipe.collectionDetail.deleteFailedToast": "Delete failed",
  "recipe.collectionDetail.editTitle": "Edit collection",
  "recipe.collectionDetail.savedToast": "Collection saved",
  "recipe.collectionDetail.addDialogTitle": "Add recipes",
  "recipe.collectionDetail.addDialogDescription":
    "Search for a recipe and tap it to add it to the end of the collection.",
  "recipe.collectionDetail.searchLabel": "Search",
  "recipe.collectionDetail.searchPlaceholder": "Title or ingredient …",
  "recipe.collectionDetail.loadingRecipes": "Loading recipes …",
  "recipe.collectionDetail.noRecipesFound": "No recipes found.",
  "recipe.collectionDetail.included": "Included",
  "recipe.collectionDetail.addedToast": "Added",
  "recipe.collectionDetail.addFailedToast": "Add failed",
  "recipe.collectionDetail.done": "Done",
};
