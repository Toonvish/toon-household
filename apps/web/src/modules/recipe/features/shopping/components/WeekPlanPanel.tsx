/**
 * WeekPlanPanel — "From this week's plan" (artboards 1c/1g), column 2 of the
 * `/recipe/shopping` overview grid (R46). The same diff `WeekStrip` implies on the
 * library, read from the shopping side: which of this week's planned recipes
 * still have ingredients missing from a list, and a one-tap bulk add.
 *
 * RENDERS NOTHING AT ALL WHEN OFFLINE. R24 keeps this diff off the persist
 * allow-list on purpose — its only affordance is an online-only bulk add, so a
 * restored, stale diff would draw an "Add" button that cannot run. An unpersisted
 * query on a persisted screen (`/recipe/shopping` IS persisted) is a spinner that never
 * resolves; the honest fix is silence, not a spinner, so this panel simply is not
 * there when there is no connection — never a loading/error state either.
 *
 * The target list is the CLIENT's choice (R9), never a server default:
 * `storageKeys.lastShoppingListId` first, then the alphabetically first list, and
 * the panel NAMES that target in its button ("Add all to Einkaufsliste") so the
 * choice is never invisible. `pickList` lets the viewer override it for THIS
 * panel's adds without leaving the screen; picking writes the same storage key, so
 * the choice also becomes every other screen's next default.
 */
import { useState } from "react";
import { planWeekRange, type PlanShoppingPreviewRecipe, type ShoppingList } from "@toon/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Select, useToast } from "@/components/ui";
import { thumbnailUrl } from "@/modules/recipe/lib/api";
import { formatWeekdayShort } from "@/modules/recipe/lib/format";
import { useT } from "@/lib/i18n";
import { invalidate, planShoppingQuery } from "@/modules/recipe/lib/queries";
import { useEmailVerificationBlock, useSession } from "@/lib/session";
import { readStorage, storageKeys, writeStorage } from "@/lib/storage";
import { useAddRecipeToShoppingList } from "../lib/queries";
import { AddPlanToListDialog, type PlanAddSelection } from "./AddPlanToListDialog";

export interface WeekPlanPanelProps {
  householdId: string;
  /** All of the household's lists — for target resolution (R9) and `pickList`. */
  lists: readonly ShoppingList[];
  /** True while `useShoppingLists` itself is still pending — see the module doc. */
  listsLoading: boolean;
}

/** R9's target-list resolution — same rule as `RecipeDetailPage`'s own copy of it. */
function resolveTargetList(
  householdId: string,
  lists: ReadonlyArray<{ id: string; name: string }>,
): { id: string; name: string } | null {
  const saved = readStorage(storageKeys.lastShoppingListId);
  if (saved) {
    const [savedHouseholdId, savedListId] = saved.split(":");
    if (savedHouseholdId === householdId) {
      const match = lists.find((list) => list.id === savedListId);
      if (match) return match;
    }
  }
  return [...lists].sort((a, b) => a.name.localeCompare(b.name, "de"))[0] ?? null;
}

export function WeekPlanPanel({ householdId, lists, listsLoading }: WeekPlanPanelProps) {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const { isOnline } = useSession();
  const unverified = useEmailVerificationBlock();
  const { addRecipe, isPending: adding } = useAddRecipeToShoppingList();
  const [overrideListId, setOverrideListId] = useState<string | null>(null);
  /**
   * The recipes the picker is open FOR — one for a row's "Hinzufügen", all of them
   * for "Alles auf …" — or `null` while it is closed. Both buttons go through the
   * same dialog: nothing on this panel adds without a chance to untick a line,
   * the same rule the recipe screen applies to "Zur Einkaufsliste".
   */
  const [picking, setPicking] = useState<readonly PlanShoppingPreviewRecipe[] | null>(null);

  const resolved = resolveTargetList(householdId, lists);
  const target =
    (overrideListId ? lists.find((list) => list.id === overrideListId) : undefined) ?? resolved;

  const range = planWeekRange();
  const preview = useQuery({
    ...planShoppingQuery(householdId, target?.id ?? "", range),
    // Also gated on `isOnline` so a reconnect after a spell offline doesn't fire
    // this the instant the component would otherwise unmount — the caller stops
    // rendering this panel first, but a stale enabled query would still race it.
    enabled: isOnline && target !== null,
  });

  // Every hook above runs unconditionally regardless of `isOnline` — this early
  // return is a RENDER decision (R24), never a hook-order one. See the module doc:
  // an unpersisted query on a persisted screen is a spinner that never resolves,
  // so offline this panel is simply not here, not loading and not erroring.
  if (!isOnline) return null;

  // A write this panel makes is an ordinary online mutation the server will 403
  // for an unconfirmed address (same reason `ShoppingListsPage`'s own `canManage`
  // exists) — disable rather than let every tap end in a doomed request.
  const addDisabled = adding || unverified !== undefined;

  /**
   * Every add on this panel goes through `AddPlanToListDialog` (see `picking`).
   * The dialog hands back one entry per recipe with a ticked line; a recipe left
   * fully unticked is simply not in `selection`.
   */
  async function addSelection(selection: readonly PlanAddSelection[]) {
    if (!target) return;
    try {
      // One `mutationId` per recipe, minted at CALL time inside `addRecipe` itself
      // (see lib/queries.ts) — sequential, not `Promise.all`, so a failure partway
      // through leaves the toast honest about what actually landed.
      for (const { recipe, ingredientIds } of selection) {
        const wholeRecipe =
          recipe.missingCount === recipe.ingredientTotal &&
          ingredientIds.length === recipe.missingIngredientIds.length;
        await addRecipe({
          householdId,
          listId: target.id,
          recipeId: recipe.recipeId,
          servings: recipe.servings ?? undefined,
          ingredientIds: wholeRecipe ? undefined : ingredientIds,
        });
      }
      setPicking(null);
      await invalidate.planShopping(client, householdId, target.id);
      toast.success(t("recipe.shopping.fromPlan.addedToast", { list: target.name }));
    } catch (error) {
      toast.fromError(error, t("recipe.shopping.fromPlan.addFailedToast"));
    }
  }

  if (listsLoading) return null;

  if (lists.length === 0 || target === null) {
    return (
      <Card className="flex flex-col gap-3">
        <h2 className="font-display text-display-md font-medium text-fg">
          {t("recipe.shopping.fromPlan.title")}
        </h2>
        <p className="text-sm text-fg-muted">{t("recipe.shopping.fromPlan.noList")}</p>
      </Card>
    );
  }

  // No spinner: a rail panel renders nothing while its own query is pending
  // (R44) rather than competing with the list-card column's skeleton.
  if (preview.isPending || preview.isError) return null;

  const recipes = preview.data.recipes;

  return (
    <Card className="flex flex-col gap-3.5">
      <div>
        <h2 className="font-display text-display-md font-medium text-fg">
          {t("recipe.shopping.fromPlan.title")}
        </h2>
        {recipes.length > 0 ? (
          <p className="text-sm text-fg-muted">
            {t("recipe.shopping.fromPlan.subtitle", {
              recipes: t("recipe.shopping.fromPlan.recipeCount", { count: recipes.length }),
              ingredients: t("recipe.shopping.fromPlan.missingCount", {
                count: preview.data.totalMissingCount,
              }),
            })}
          </p>
        ) : null}
      </div>

      {recipes.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("recipe.shopping.fromPlan.empty")}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {recipes.map((recipe) => (
              <li key={recipe.recipeId} className="flex items-center gap-2.5">
                <img
                  src={thumbnailUrl({ thumbnailUrl: recipe.thumbnailUrl })}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-9 shrink-0 rounded-lg bg-surface-2 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <span className="font-display block truncate text-item font-medium">
                    {recipe.title}
                  </span>
                  <span className="text-xs text-fg-faint">
                    {t("recipe.shopping.fromPlan.rowMeta", {
                      weekday: formatWeekdayShort(recipe.plannedOn),
                      ingredients: t("recipe.shopping.fromPlan.ingredientCount", {
                        count: recipe.missingCount,
                      }),
                    })}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={addDisabled}
                  title={unverified}
                  onClick={() => setPicking([recipe])}
                  className="shrink-0"
                >
                  {t("recipe.shopping.action.add")}
                </Button>
              </li>
            ))}
          </ul>

          <Button
            variant="outline"
            disabled={addDisabled}
            title={unverified}
            onClick={() => setPicking(recipes)}
            fullWidth
          >
            {t("recipe.shopping.fromPlan.addAll", { list: target.name })}
          </Button>

          <AddPlanToListDialog
            open={picking !== null}
            onClose={() => setPicking(null)}
            recipes={picking ?? []}
            listName={target.name}
            submitting={adding}
            onSubmit={(selection) => void addSelection(selection)}
          />
        </>
      )}

      {lists.length > 1 ? (
        <Select
          label={t("recipe.shopping.fromPlan.pickList")}
          value={target.id}
          onChange={(event) => {
            const id = event.target.value;
            setOverrideListId(id);
            writeStorage(storageKeys.lastShoppingListId, `${householdId}:${id}`);
          }}
          options={lists.map((list) => ({ value: list.id, label: list.name }))}
        />
      ) : null}
    </Card>
  );
}
