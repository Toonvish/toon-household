/**
 * The recipe module's card on Home (SPEC §5, D5; plan m2-recipe-module §4 M2-T11b Work 4):
 * the module name, this week's planned recipes, the open items of the household's
 * shopping lists, and links to the planner and the lists. M4 polishes it.
 *
 * Design-system primitives (`@/components/ui`) and the type scale only. Empty parts render
 * nothing extra — no plan entries means no "Diese Woche" block, no lists means no count
 * (R "THREE SCREENS…" consequence: Home is not a second empty state).
 *
 * Recipe titles are CONTENT and never go through `t()`. Every label reuses an existing
 * key (`common.nav.*`, `recipe.plan.thisWeek`, `recipe.shopping.list.itemCount`); no new
 * German.
 *
 * Imports nothing from the layout components and not the module registry (decision 15):
 * this file is in the manifest's static import graph, and either import would make the
 * manifest re-enter the registry while it is still evaluating.
 */
import { useQuery } from "@tanstack/react-query";
import { planWeekRange } from "@toon/shared";
import { BookOpen, CalendarDays, ShoppingBasket } from "lucide-react";
import type { ReactElement } from "react";
import { Card, buttonClasses } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { useActiveHousehold } from "@/lib/session";
import { planQuery, shoppingListsQuery } from "@/modules/recipe/lib/queries";

/** At most this many planned recipes are listed on the card; the planner has the rest. */
const MAX_PLANNED = 5;

export function RecipeHomeCard(): ReactElement {
  const t = useT();
  const { householdId } = useActiveHousehold();
  const id = householdId ?? "";
  const enabled = householdId !== null && householdId !== undefined;

  const plan = useQuery({ ...planQuery(id, planWeekRange()), enabled });
  const lists = useQuery({ ...shoppingListsQuery(id), enabled });

  const planned = [...(plan.data?.items ?? [])]
    .sort((a, b) => a.plannedOn.localeCompare(b.plannedOn) || a.position - b.position)
    .slice(0, MAX_PLANNED);
  const openItems = lists.data?.items.reduce((sum, list) => sum + (list.itemCount ?? 0), 0);
  const hasLists = (lists.data?.items.length ?? 0) > 0;

  return (
    <Card as="section" aria-labelledby="home-card-recipe" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-fg"
        >
          <BookOpen className="size-5" />
        </span>
        <h2 id="home-card-recipe" className="font-display text-display-md font-medium text-fg">
          <AppLink to="/recipe" className="hover:underline">
            {t("common.nav.recipes")}
          </AppLink>
        </h2>
      </div>

      {planned.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="eyebrow text-fg-faint">{t("recipe.plan.thisWeek")}</p>
          <ul className="flex flex-col gap-1">
            {planned.map((entry) => (
              <li key={entry.id} className="truncate text-sm text-fg">
                <AppLink
                  to="/recipe/recipes/$recipeId"
                  params={{ recipeId: entry.recipeId }}
                  className="hover:underline"
                >
                  {entry.recipe.title}
                </AppLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <AppLink to="/recipe/plan" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          <CalendarDays aria-hidden="true" className="size-4" />
          {t("common.nav.plan")}
        </AppLink>
        <AppLink to="/recipe/shopping" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          <ShoppingBasket aria-hidden="true" className="size-4" />
          {t("common.nav.shopping")}
          {hasLists && openItems !== undefined ? (
            <span className="text-fg-muted">
              {" · "}
              {t("recipe.shopping.list.itemCount", { count: openItems })}
            </span>
          ) : null}
        </AppLink>
      </div>
    </Card>
  );
}

export default RecipeHomeCard;
