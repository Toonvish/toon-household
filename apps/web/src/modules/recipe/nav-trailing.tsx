/**
 * The recipe module's sidebar trailing slots (`NavItem.trailing`, plan m4-design-pass §1
 * decision 6): toon-recipe's `SideNav` count slot and "Neu" pill
 * (R `apps/web/src/components/layout/SideNav.tsx`), moved out of the shell because the core
 * cannot count a module's rows (SPEC §2; ADR 0001).
 *
 * STATIC MANIFEST IMPORT: `index.ts` imports this file, so it obeys the shell-free graph rule
 * (plan m2-recipe-module §1 decision 15) — never `@/modules` (the registry) and never
 * `@/components/layout` (the shell). Only `@/components/ui`, `@/lib/*`, this module's own
 * `lib/` and the recipe list queries.
 *
 * A count renders exactly as R draws it — `ml-auto text-xs font-medium tabular-nums`,
 * `text-brand-hover` on the active row, else `text-fg-subtle` — and renders NOTHING while it
 * is `undefined` (never a flashing `0`).
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useActiveHousehold } from "@/lib/session";
import { useHouseholdRecipeCount } from "@/modules/recipe/features/recipes/lib/queries";
import { shoppingListsQuery } from "@/modules/recipe/lib/queries";

interface TrailingProps {
  isActive: boolean;
}

/**
 * The sum of `itemCount` over the household's shopping lists (R's `shoppingCount` reduce).
 * `itemCount` is optional (an older server may omit it), so ANY missing value makes the total
 * itself unknown: `undefined`, rendered as nothing rather than a `0` that looks like an empty
 * list. No lists at all is a known `0`.
 */
export function sumItemCounts(lists: readonly { itemCount?: number | undefined }[]): number | undefined {
  return lists.reduce<number | undefined>((total, list) => {
    if (total === undefined || list.itemCount === undefined) return undefined;
    return total + list.itemCount;
  }, 0);
}

/** R's count slot; nothing while the count is unknown. */
function NavCount({ count, isActive }: { count: number | undefined; isActive: boolean }): ReactElement | null {
  if (count === undefined) return null;
  return (
    <span
      className={cn("ml-auto text-xs font-medium tabular-nums", isActive ? "text-brand-hover" : "text-fg-subtle")}
    >
      {count}
    </span>
  );
}

/** Rezepte: the household's recipe count, the module's own query (ADR 0001). */
export function RecipeCountTrailing({ isActive }: TrailingProps) {
  const { householdId } = useActiveHousehold();
  const count = useHouseholdRecipeCount(householdId);
  return <NavCount count={count} isActive={isActive} />;
}

/** Plan: R's "Neu" pill. */
export function PlanNewTrailing(_props: TrailingProps) {
  const t = useT();
  return (
    <Badge variant="accent" size="sm" className="ml-auto">
      {t("common.nav.planNewBadge")}
    </Badge>
  );
}

/**
 * Einkauf: the summed open items of the household's lists — the same query `/recipe/shopping`
 * already fetches and caches, so it costs nothing extra.
 */
export function ShoppingCountTrailing({ isActive }: TrailingProps) {
  const { householdId } = useActiveHousehold();
  const { data } = useQuery({
    ...shoppingListsQuery(householdId ?? ""),
    enabled: householdId !== null,
  });
  const count = data ? sumItemCounts(data.items) : undefined;
  return <NavCount count={count} isActive={isActive} />;
}
