/**
 * German — namespace "plan". Covers apps/web/src/features/plan/**: `PlanPage`,
 * `PlanDayCard`, `PlanWeekNav`, `PlanRecipePicker`, `PlanServingsDialog` and
 * `WeekStrip` (the library's four-day strip, whose file lives in
 * `features/plan/components/WeekStrip.tsx` — its two keys are §6.4 below, not
 * `recipes.*`, because `docs/i18n.md`'s ownership boundary is per directory).
 *
 * ALL NEW COPY — `/plan` did not exist before the i18n port, so every key here
 * is `scripts/i18n-check.ts`'s known false-positive class 1 ("no counterpart in
 * the base tree"). There is nothing to be byte-identical to.
 *
 * Nothing in this file may contain a German recipe term: the day cards render
 * recipe titles and course eyebrows, both of which are CONTENT that arrives
 * from the API, never through this catalog.
 */
import type { NamespaceCatalog } from "@toon/shared";

export const planDe = {
  /* --------------------------- PlanPage / PlanWeekNav ------------------------ */
  "recipe.plan.title": "Wochenplan",
  // `{start}`/`{end}` are `formatDate()` output; the dash is an EN DASH
  // (U+2013) with spaces, not a hyphen.
  "recipe.plan.weekRange": "{start} – {end}",
  "recipe.plan.thisWeek": "Diese Woche",
  "recipe.plan.prevWeek": "Vorherige Woche",
  "recipe.plan.nextWeek": "Nächste Woche",
  "recipe.plan.loading": "Wochenplan wird geladen",
  // The `title` on every disabled plan write — planner writes are online-only.
  "recipe.plan.offlineHint": "Planen braucht eine Verbindung.",

  /* -------------------------------- PlanDayCard ------------------------------ */
  // Filled with formatWeekdayShort(date) + formatDayOfMonth(date) — a key
  // rather than a template literal because some locales put the number first.
  "recipe.plan.day.eyebrow": "{weekday} {day}",
  // The empty card's whole-button label. The "+" is a lucide `Plus` icon, not
  // part of the string.
  "recipe.plan.day.empty": "Planen",
  "recipe.plan.day.addAriaLabel": "Rezept für {day} einplanen",
  // Lower-case: appended to the meta line after formatMinutes(...) + " · ",
  // e.g. "15 min · heute" / "1 Std. 15 · gekocht".
  "recipe.plan.day.today": "heute",
  "recipe.plan.day.cooked": "gekocht",
  "recipe.plan.day.more": {
    one: "+{count} weiteres Rezept",
    other: "+{count} weitere Rezepte",
  },

  /* ------------------------- Empty state + recipe picker --------------------- */
  "recipe.plan.empty.title": "Diese Woche ist noch nichts geplant.",
  "recipe.plan.empty.description": "Tippe auf einen Tag, um ein Rezept einzuplanen.",
  "recipe.plan.picker.title": "Rezept für {day} wählen",
  "recipe.plan.picker.search": "Rezepte durchsuchen",
  "recipe.plan.picker.searchAriaLabel": "Rezepte durchsuchen",
  "recipe.plan.picker.empty": "Keine Rezepte gefunden.",
  "recipe.plan.picker.loading": "Rezepte werden geladen",
  "recipe.plan.lastPlanned": "Zuletzt geplant: {date}",

  /* -------------------------- Entry ActionMenu + dialogs ---------------------- */
  "recipe.plan.entry.menuLabel": "Aktionen für {title}",
  "recipe.plan.entry.openRecipe": "Rezept öffnen",
  "recipe.plan.entry.servings": "Portionen ändern",
  "recipe.plan.entry.markCooked": "Als gekocht markieren",
  "recipe.plan.entry.move": "Auf einen anderen Tag verschieben",
  "recipe.plan.entry.addToList": "Zutaten zur Einkaufsliste",
  "recipe.plan.entry.remove": "Vom Plan entfernen",

  "recipe.plan.servings.title": "Portionen für {day}",
  "recipe.plan.servings.reset": "Rezept-Portionen verwenden",
  "recipe.plan.servings.submit": "Speichern",

  "recipe.plan.move.title": "„{title}“ verschieben",
  "recipe.plan.move.dateLabel": "Neues Datum",
  "recipe.plan.move.submit": "Verschieben",

  "recipe.plan.action.cancel": "Abbrechen",

  /* ---------------------------------- Toasts ---------------------------------- */
  "recipe.plan.toast.planned": "Eingeplant.",
  "recipe.plan.toast.moved": "Verschoben.",
  "recipe.plan.toast.cooked": "Als gekocht markiert.",
  "recipe.plan.toast.removed": "Vom Plan entfernt.",
  "recipe.plan.toast.failed": "Konnte nicht gespeichert werden.",

  // The ConfirmDialog guarding recipe.plan.entry.remove; its buttons reuse the
  // existing common.confirmDialog.confirm / .cancel.
  "recipe.plan.remove.confirmTitle": "„{title}“ vom Plan entfernen?",

  /* ------------------------- WeekStrip (the library strip) -------------------- */
  "recipe.plan.strip.heading": "Diese Woche",
  "recipe.plan.strip.link": "Planen",
} as const satisfies NamespaceCatalog<"recipe">;

export type PlanCatalog = typeof planDe;
