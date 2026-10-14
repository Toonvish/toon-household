/**
 * RecipeStatRow — the recipe detail screen's stat line, in its two artboard shapes
 * (desktop A04 §5.4: a divided flex row, "Zuletzt gekocht" pinned right; mobile
 * A04 §6.1: a 4-up grid, the fourth cell swapped between "Gekocht" and "Gesamt").
 *
 * Composes `Stat`/`StatRow` from `components/ui` and contains no independent markup
 * (R7) — this file owns only the recipe-specific field mapping. `Stat` already
 * carries the `.eyebrow`/`text-fg-faint` label styling (R11) and the `min-w-0` a
 * grid/flex item needs, so nothing here repeats it.
 */
import type { RecipeDetail } from "@toon/shared";
import { Stat, StatRow } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { formatRelative } from "@/modules/recipe/lib/format";
import { optionalMinutes, optionalServings } from "../lib/format";

export interface RecipeStatRowProps {
  recipe: Pick<
    RecipeDetail,
    "servingsAmount" | "servingsUnit" | "prepMinutes" | "cookMinutes" | "totalMinutes" | "lastCookedAt"
  >;
  /** `desktop` = A04 §5.4's divided flex row; `mobile` = §6.1's 4-up grid. */
  layout: "desktop" | "mobile";
  className?: string;
}

export function RecipeStatRow({ recipe, layout, className }: RecipeStatRowProps) {
  const t = useT();
  const servings = optionalServings(recipe.servingsAmount, recipe.servingsUnit);
  const prep = optionalMinutes(recipe.prepMinutes);
  const cook = optionalMinutes(recipe.cookMinutes);
  const total = optionalMinutes(recipe.totalMinutes);
  const lastCooked = recipe.lastCookedAt ? formatRelative(recipe.lastCookedAt) : null;

  if (layout === "mobile") {
    // The phone shows exactly four cells (§6.1: a 3-of-4 grid leaves a hole), and
    // "Gesamt" is not one of them UNLESS there is nothing cooked to show instead —
    // the artboard's own trade, made explicit rather than silently dropping a cell.
    return (
      <StatRow columns={4} className={className}>
        {servings ? <Stat label={t("recipe.recipes.detail.meta.servings")} value={servings} /> : null}
        {prep ? <Stat label={t("recipe.recipes.detail.meta.prep")} value={prep} /> : null}
        {cook ? <Stat label={t("recipe.recipes.detail.meta.cook")} value={cook} /> : null}
        {lastCooked ? (
          <Stat label={t("recipe.recipes.detail.meta.cooked")} value={lastCooked} tone="success" />
        ) : total ? (
          <Stat label={t("recipe.recipes.detail.meta.total")} value={total} />
        ) : null}
      </StatRow>
    );
  }

  return (
    <StatRow divided className={className}>
      {servings ? <Stat label={t("recipe.recipes.detail.meta.servings")} value={servings} size="md" /> : null}
      {prep ? <Stat label={t("recipe.recipes.detail.meta.prep")} value={prep} size="md" /> : null}
      {cook ? <Stat label={t("recipe.recipes.detail.meta.cook")} value={cook} size="md" /> : null}
      {total ? <Stat label={t("recipe.recipes.detail.meta.total")} value={total} size="md" /> : null}
      {lastCooked ? (
        <div className="ml-auto min-w-0 text-right">
          <Stat label={t("recipe.recipes.detail.meta.lastCooked")} value={lastCooked} tone="success" size="md" />
        </div>
      ) : null}
    </StatRow>
  );
}
