/**
 * "Rezept für {day} wählen" — an empty day card's own picker. Reuses
 * `RecipeEditorialRow`'s `as="button"`/`onSelect` seam (T7.5) rather than a second
 * row implementation, exactly as `docs/redesign/specs/05-frontend-shell.md` §10.7
 * specifies: a compact search over the household's recipes, one tap plans the day.
 *
 * Deliberately NOT a second recipe-list hook: `useRecipeList` (T2.2/T7.5's
 * dependency, already infinite-paginated) is the one this reuses, same as every
 * other recipe search in the app.
 */
import { useState } from "react";
import { Search } from "lucide-react";
import type { RecipeListItem } from "@toon/shared";
import { Dialog, Input, SkeletonList } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { formatPlanDateNear, formatShortWeekdayDate } from "@/modules/recipe/lib/format";
import {
  flattenPages,
  useDebouncedValue,
  useRecipeList,
  type RecipeListFilters,
} from "@/modules/recipe/features/recipes";
import { RecipeEditorialRow } from "@/modules/recipe/features/recipes/components/RecipeEditorialRow";
import { useLastPlanned } from "../lib/queries";

export interface PlanRecipePickerProps {
  open: boolean;
  onClose: () => void;
  householdId: string;
  /** The day being planned — only used for the dialog's title copy. */
  date: string;
  onSelect: (recipe: RecipeListItem) => void;
}

export function PlanRecipePicker({ open, onClose, householdId, date, onSelect }: PlanRecipePickerProps) {
  const t = useT();
  const [text, setText] = useState("");
  const q = useDebouncedValue(text, 300);

  const filters: RecipeListFilters = q.trim().length > 0 ? { q: q.trim(), limit: 20 } : { limit: 20 };
  const list = useRecipeList(open ? householdId : null, filters);
  const recipes = flattenPages(list.data);
  // Best-effort: while it loads (or if it fails) the rows simply carry no note.
  const lastPlanned = useLastPlanned(open ? householdId : null, date).data;

  function select(recipe: RecipeListItem) {
    onSelect(recipe);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("recipe.plan.picker.title", { day: formatShortWeekdayDate(date) })}
      size="md"
    >
      <div className="flex flex-col gap-3">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t("recipe.plan.picker.search")}
          aria-label={t("recipe.plan.picker.searchAriaLabel")}
          leftIcon={<Search className="size-4" />}
          autoFocus
        />

        {list.isPending ? (
          <>
            <p role="status" className="sr-only">
              {t("recipe.plan.picker.loading")}
            </p>
            <SkeletonList variant="editorial" count={4} />
          </>
        ) : recipes.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">{t("recipe.plan.picker.empty")}</p>
        ) : (
          <ul className="flex flex-col">
            {recipes.map((recipe) => {
              const plannedOn = lastPlanned?.get(recipe.id);
              return (
                <li key={recipe.id}>
                  <RecipeEditorialRow
                    recipe={recipe}
                    as="button"
                    onSelect={() => select(recipe)}
                    note={
                      plannedOn
                        ? t("recipe.plan.lastPlanned", { date: formatPlanDateNear(plannedOn, date) })
                        : undefined
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
