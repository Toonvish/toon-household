/**
 * English — namespace "plan". See `plan.de.ts` for who owns this file and why
 * every key here is new copy with no base-tree counterpart.
 */
import type { LocaleCatalog } from "@toon/shared";
import type { PlanCatalog } from "./plan.de.ts";

export const planEn: LocaleCatalog<PlanCatalog> = {
  /* --------------------------- PlanPage / PlanWeekNav ------------------------ */
  "recipe.plan.title": "Meal plan",
  "recipe.plan.weekRange": "{start} – {end}",
  "recipe.plan.thisWeek": "This week",
  "recipe.plan.prevWeek": "Previous week",
  "recipe.plan.nextWeek": "Next week",
  "recipe.plan.loading": "Loading meal plan",
  "recipe.plan.offlineHint": "Planning needs a connection.",

  /* -------------------------------- PlanDayCard ------------------------------ */
  "recipe.plan.day.eyebrow": "{weekday} {day}",
  "recipe.plan.day.empty": "Plan",
  "recipe.plan.day.addAriaLabel": "Plan a recipe for {day}",
  "recipe.plan.day.today": "today",
  "recipe.plan.day.cooked": "cooked",
  "recipe.plan.day.more": {
    one: "+{count} more recipe",
    other: "+{count} more recipes",
  },

  /* ------------------------- Empty state + recipe picker --------------------- */
  "recipe.plan.empty.title": "Nothing is planned for this week yet.",
  "recipe.plan.empty.description": "Tap a day to plan a recipe.",
  "recipe.plan.picker.title": "Choose a recipe for {day}",
  "recipe.plan.picker.search": "Search recipes",
  "recipe.plan.picker.searchAriaLabel": "Search recipes",
  "recipe.plan.picker.empty": "No recipes found.",
  "recipe.plan.picker.loading": "Loading recipes",
  "recipe.plan.lastPlanned": "Last planned: {date}",

  /* -------------------------- Entry ActionMenu + dialogs ---------------------- */
  "recipe.plan.entry.menuLabel": "Actions for {title}",
  "recipe.plan.entry.openRecipe": "Open recipe",
  "recipe.plan.entry.servings": "Change servings",
  "recipe.plan.entry.markCooked": "Mark as cooked",
  "recipe.plan.entry.move": "Move to another day",
  "recipe.plan.entry.addToList": "Ingredients to the shopping list",
  "recipe.plan.entry.remove": "Remove from the plan",

  "recipe.plan.servings.title": "Servings for {day}",
  "recipe.plan.servings.reset": "Use the recipe's servings",
  "recipe.plan.servings.submit": "Save",

  "recipe.plan.move.title": "Move “{title}”",
  "recipe.plan.move.dateLabel": "New date",
  "recipe.plan.move.submit": "Move",

  "recipe.plan.action.cancel": "Cancel",

  /* ---------------------------------- Toasts ---------------------------------- */
  "recipe.plan.toast.planned": "Planned.",
  "recipe.plan.toast.moved": "Moved.",
  "recipe.plan.toast.cooked": "Marked as cooked.",
  "recipe.plan.toast.removed": "Removed from the plan.",
  "recipe.plan.toast.failed": "Could not be saved.",

  "recipe.plan.remove.confirmTitle": "Remove “{title}” from the plan?",

  /* ------------------------- WeekStrip (the library strip) -------------------- */
  "recipe.plan.strip.heading": "This week",
  "recipe.plan.strip.link": "Plan",
};
