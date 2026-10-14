/**
 * The recipe module's card on Home (SPEC §5, D5; plan m4-design-pass M4-T04): the module
 * name, this week as a compact strip with the next planned titles (`HomeWeekStrip`), and
 * the active shopping list with its open-item count.
 *
 * The "active" list is the first one `shoppingListsQuery` returns, the order
 * `/recipe/shopping` shows. No lists: a secondary "Einkauf" link instead (Home is not a
 * second empty state). Recipe titles and list names are CONTENT and never go through
 * `t()`; every label reuses an existing key, no new German.
 *
 * Imports nothing from the layout components and not the module registry (decision 15):
 * this file is in the manifest's static import graph, and either import would make the
 * manifest re-enter the registry while it is still evaluating.
 */
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ShoppingBasket } from "lucide-react";
import type { ReactElement } from "react";
import { Card, buttonClasses } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { useActiveHousehold } from "@/lib/session";
import { HomeWeekStrip } from "@/modules/recipe/features/plan/components/HomeWeekStrip";
import { activeShoppingList } from "@/modules/recipe/features/plan/lib/home-week";
import { shoppingListsQuery } from "@/modules/recipe/lib/queries";

export function RecipeHomeCard(): ReactElement {
  const t = useT();
  const { householdId } = useActiveHousehold();
  const id = householdId ?? "";
  const enabled = householdId !== null && householdId !== undefined;

  const lists = useQuery({ ...shoppingListsQuery(id), enabled });
  const active = activeShoppingList(lists.data?.items ?? []);

  return (
    <Card as="section" aria-labelledby="home-card-recipe" className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-fg"
        >
          <BookOpen className="size-5" />
        </span>
        <h2 id="home-card-recipe" className="min-w-0 font-display text-display-md font-medium text-fg">
          <AppLink to="/recipe" className="hover:underline">
            {t("common.nav.recipes")}
          </AppLink>
        </h2>
      </div>

      <HomeWeekStrip householdId={id} />

      {active ? (
        <AppLink
          to="/recipe/shopping/$listId"
          params={{ listId: active.id }}
          className="flex min-w-0 items-start gap-2 text-sm text-fg hover:underline"
        >
          <ShoppingBasket aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          <span className="min-w-0 text-pretty">
            {active.itemCount === undefined
              ? active.name
              : `${active.name} · ${t("recipe.shopping.list.itemCount", { count: active.itemCount })}`}
          </span>
        </AppLink>
      ) : lists.isPending && enabled ? null : (
        <div>
          <AppLink to="/recipe/shopping" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            {t("common.nav.shopping")}
          </AppLink>
        </div>
      )}
    </Card>
  );
}

export default RecipeHomeCard;
