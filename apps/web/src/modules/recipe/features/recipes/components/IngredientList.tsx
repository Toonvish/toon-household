/**
 * Ingredient list for the detail screen: grouped by section, amounts already scaled
 * by the servings stepper and rendered as German fractions.
 *
 * A04 §5.1: the row grid is `78px` (desktop) / `70px` (mobile, `1f`) for the amount
 * column, and the amount is the list's ONE piece of conditional styling — `--accent`
 * for a real quantity, `--fg-subtle` for a vague one ("n. B.") **and for a blank**
 * ("Salz und Pfeffer"). `quantity: null` means "no amount given" and must never
 * render as `0`, so the colour follows the SAME null check `formatAmountWithUnit`
 * already uses, never the rendered string's length.
 */
import type { RecipeIngredient } from "@toon/shared";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { formatAmountWithUnit, groupBySection } from "../lib/format";

export interface IngredientListProps {
  ingredients: readonly RecipeIngredient[];
  /**
   * True when the shown amounts differ from the stored ones. Kept for callers
   * (the page's own `recipe.recipes.detail.scaledNote` status line reads the same
   * signal) but no longer changes this list's colouring — `text-accent` is now
   * the amount colour unconditionally, so a second colour meaning here would be
   * ambiguous against it.
   */
  scaled?: boolean;
  className?: string;
}

export function IngredientList({ ingredients, className }: IngredientListProps) {
  const t = useT();
  if (ingredients.length === 0) {
    return <p className="text-sm text-fg-muted">{t("recipe.recipes.ingredients.empty")}</p>;
  }

  const groups = groupBySection(ingredients);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {groups.map((group, groupIndex) => (
        <section key={group.section ?? `group-${groupIndex}`} className="flex flex-col">
          {group.section ? (
            <h3 className="mb-1 text-sm font-semibold tracking-wide text-fg-muted uppercase">
              {group.section}
            </h3>
          ) : null}
          <ul className="flex flex-col">
            {group.items.map((ingredient, index) => {
              const amount = formatAmountWithUnit(ingredient);
              return (
                <li
                  key={`${group.section ?? ""}-${ingredient.position}-${index}`}
                  className="grid grid-cols-[70px_minmax(0,1fr)] gap-3 border-t border-surface-2 py-2.5 text-[15px] leading-[1.35] sm:grid-cols-[78px_minmax(0,1fr)]"
                >
                  <span
                    className={cn(
                      "text-right font-semibold tabular-nums",
                      ingredient.quantity != null ? "text-accent" : "text-fg-subtle",
                    )}
                  >
                    {amount}
                  </span>
                  <span className="text-fg">
                    {ingredient.name}
                    {ingredient.note ? <span className="text-fg-subtle"> {ingredient.note}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
