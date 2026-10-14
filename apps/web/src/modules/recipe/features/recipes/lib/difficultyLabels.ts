/**
 * Difficulty labels as translator keys, so they resolve at render time under the
 * active locale (docs/i18n.md §10 rule 8) instead of freezing at import time the
 * way `lib/format.ts`'s old `difficultyLabels` map did. The map's KEYS
 * (`einfach`/`mittel`/`schwer`) are the wire values — `DifficultySchema` in
 * `@toon/shared` — and stay locked; only the label moves into the catalog.
 *
 * Same shape and same reasoning as `core/features/households/lib/roleLabels.ts`.
 */
import type { Difficulty } from "@toon/shared";
import type { MessageKey } from "@/lib/i18n";

export const DIFFICULTY_LABEL_KEYS: Record<Difficulty, MessageKey> = {
  einfach: "recipe.recipes.difficulty.einfach",
  mittel: "recipe.recipes.difficulty.mittel",
  schwer: "recipe.recipes.difficulty.schwer",
};
