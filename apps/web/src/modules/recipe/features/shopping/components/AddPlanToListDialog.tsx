/**
 * The picker behind BOTH of `WeekPlanPanel`'s adds — a row's "Hinzufügen" (one
 * recipe) and "Alles auf „{list}“" (every recipe): the missing lines, grouped by
 * recipe, each one tickable, then ONE add.
 *
 * The same deal as `AddRecipeToListDialog` (the recipe screen's picker), on the
 * from-plan diff instead of one recipe: everything is TICKED when it opens, because
 * "add everything" is what the button said, and unticking is for the salt and the
 * flour that are already in the cupboard. Selection is tracked as the set of
 * EXCLUDED ids, so a preview that gains a line between two refetches stays all-on.
 *
 * The lines come off the wire ALREADY SCALED and already diffed against the target
 * list (`missingIngredients` on the from-plan preview): there is no second fetch per
 * recipe, no client-side scaling, and the picker can never disagree with the count
 * the panel showed a moment ago. No portion stepper either — the portions are the
 * plan entry's, and changing them belongs on `/plan`.
 *
 * `onSubmit` receives one entry per recipe that still has a ticked line. A recipe
 * whose lines are all unticked is simply left out — the caller adds recipe by
 * recipe, the way `addAll` always did.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ShoppingBasket } from "lucide-react";
import {
  formatQuantity,
  formatShoppingAmount,
  type PlanShoppingPreviewRecipe,
} from "@toon/shared";
import { Button, Dialog } from "@/components/ui";
import { formatWeekdayShort } from "@/modules/recipe/lib/format";
import { useT } from "@/lib/i18n";

export interface PlanAddSelection {
  recipe: PlanShoppingPreviewRecipe;
  /** The ticked `recipe_ingredients` ids — always a subset of `missingIngredientIds`. */
  ingredientIds: readonly string[];
}

export interface AddPlanToListDialogProps {
  open: boolean;
  onClose: () => void;
  recipes: readonly PlanShoppingPreviewRecipe[];
  /** The target list's name — named in the button, so the choice is never invisible. */
  listName: string;
  submitting: boolean;
  onSubmit: (selection: readonly PlanAddSelection[]) => void;
}

export function AddPlanToListDialog({
  open,
  onClose,
  recipes,
  listName,
  submitting,
  onSubmit,
}: AddPlanToListDialogProps) {
  const t = useT();
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());

  // Re-seed ONCE PER OPENING, never on every `recipes` identity change: the preview
  // refetches in the background, and re-running the seed then would un-tick nothing
  // but would throw away every deselection made so far (same guard as the recipe
  // picker's).
  const opened = useRef(false);
  useEffect(() => {
    if (!open) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setExcluded(new Set());
  }, [open]);

  const allIds = useMemo(
    () => recipes.flatMap((recipe) => recipe.missingIngredients.map((line) => line.id)),
    [recipes],
  );
  const selectedCount = allIds.filter((id) => !excluded.has(id)).length;
  const allSelected = selectedCount === allIds.length;
  const noneSelected = selectedCount === 0;

  // `indeterminate` is a DOM property with no JSX attribute — set on the node.
  const allBoxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allBoxRef.current) allBoxRef.current.indeterminate = !allSelected && !noneSelected;
  }, [allSelected, noneSelected]);

  const toggle = (id: string) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setExcluded(allSelected ? new Set(allIds) : new Set());
  };

  const submit = () => {
    const selection: PlanAddSelection[] = [];
    for (const recipe of recipes) {
      const ingredientIds = recipe.missingIngredients
        .map((line) => line.id)
        .filter((id) => !excluded.has(id));
      if (ingredientIds.length > 0) selection.push({ recipe, ingredientIds });
    }
    onSubmit(selection);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("recipe.shopping.fromPlan.dialog.title")}
      description={t("recipe.shopping.fromPlan.dialog.hint")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t("recipe.shopping.action.cancel")}
          </Button>
          <Button
            leftIcon={<ShoppingBasket />}
            loading={submitting}
            disabled={noneSelected}
            onClick={submit}
          >
            {t("recipe.shopping.fromPlan.dialog.submit", { count: selectedCount, list: listName })}
          </Button>
        </>
      }
    >
      <fieldset className="min-w-0">
        <legend className="sr-only">{t("recipe.shopping.addRecipe.ingredients.heading")}</legend>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className="text-sm font-medium text-fg">
            {t("recipe.shopping.addRecipe.ingredients.heading")}
          </span>
          <label className="ml-auto flex min-h-11 items-center gap-2 text-sm text-fg-muted">
            <input
              ref={allBoxRef}
              type="checkbox"
              className="size-5 accent-[var(--brand)]"
              checked={allSelected}
              onChange={toggleAll}
            />
            {t("recipe.shopping.addRecipe.selectAll")}
          </label>
        </div>
        <div className="max-h-[60dvh] overflow-y-auto rounded-xl border border-line bg-surface-2/50 px-3 py-1 text-sm">
          {recipes.map((recipe) => (
            <section key={recipe.recipeId} className="py-1.5">
              <h3 className="font-display flex min-w-0 items-baseline gap-2 pt-1 text-item font-medium text-fg">
                <span className="min-w-0 text-pretty">{recipe.title}</span>
                <span className="shrink-0 text-xs font-normal text-fg-faint">
                  {formatWeekdayShort(recipe.plannedOn)}
                </span>
              </h3>
              <ul>
                {recipe.missingIngredients.map((line) => {
                  const amount = formatShoppingAmount(line, formatQuantity);
                  const off = excluded.has(line.id);
                  return (
                    <li key={line.id}>
                      <label className="flex min-h-11 min-w-0 items-center gap-2.5 py-0.5">
                        <input
                          type="checkbox"
                          className="size-5 shrink-0 accent-[var(--brand)]"
                          checked={!off}
                          onChange={() => toggle(line.id)}
                          aria-label={line.name}
                        />
                        <span className="min-w-16 shrink-0 text-right font-medium tabular-nums text-fg">
                          {amount.length === 0 ? "—" : amount}
                        </span>
                        {/* Wraps rather than truncates — the full name is what decides the tick. */}
                        <span
                          className={
                            off
                              ? "min-w-0 flex-1 break-words text-fg-subtle line-through"
                              : "min-w-0 flex-1 break-words text-fg-muted"
                          }
                        >
                          {line.name}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        {noneSelected ? (
          <p className="mt-1.5 text-xs text-fg-muted">{t("recipe.shopping.addRecipe.selectAtLeastOne")}</p>
        ) : null}
      </fieldset>
    </Dialog>
  );
}
