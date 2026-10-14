/**
 * "Rezepte auf dieser Liste" — the desktop right rail's second panel (artboard
 * `1d` §8.1), reading the `shopping_list_recipes` join the API resolves per list
 * (D9/R10). Both numbers in `{onList} von {total} Zutaten · {servings} Portionen`
 * are drawn on purpose: `total`/`onList` are `ingredientTotal`/`onListCount` AS THE
 * RECIPE STANDS TODAY, not as it was when added, so a recipe that gained a line
 * since reads "5 von 6" — the prompt to add the missing one, not a bug. `servings`
 * is the count CHOSEN at add time, which no other column can reconstruct
 * (`source_recipe_ids` is per-item and every merge rewrites it).
 *
 * This is the ONE rail panel whose empty state renders real content (R44): with no
 * recipes attached it draws only the heading and the dashed "+ …" button, which is
 * also how a first recipe gets attached — there is nothing else to say.
 *
 * The dashed button is a two-step flow: pick a recipe (this panel's own lightweight
 * search — nothing in the app already lets you search FOR a recipe from HERE), then
 * hand it to the EXISTING `AddRecipeToListDialog` for the servings/ingredient
 * picker, so its `<fieldset class="min-w-0">` and EXCLUDED-set tracking (a recipe
 * that gains a line stays all-on) are reused rather than duplicated.
 *
 * `Entfernen` is online-only (R28, like catalog hide/unhide): a bulk delete
 * replayed against a list the user can no longer see is exactly the class the
 * offline outbox excludes (see `removeRecipeFromShoppingList`'s own doc comment).
 * Remove semantics are A03's: delete only the lines whose ONLY source is this
 * recipe, keep shared lines with their quantities unchanged — the confirm states
 * BOTH counts before the tap (R10), because the merge is destructive by design and
 * the two contributions are not recoverable afterwards.
 */
import { useState } from "react";
import { Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { RecipeListItem, ShoppingList, ShoppingListRecipe } from "@toon/shared";
import { Button, ConfirmDialog, Dialog, Input, SkeletonList, Spinner, useToast } from "@/components/ui";
import { errorMessage, mediaUrl, removeRecipeFromShoppingList } from "@/modules/recipe/lib/api";
import { formatServingsLabel } from "@/modules/recipe/lib/format";
import { useT } from "@/lib/i18n";
import { queryKeys } from "@/modules/recipe/lib/queries";
import {
  flattenPages,
  totalCount,
  useDebouncedValue,
  useRecipe,
  useRecipeList,
} from "@/modules/recipe/features/recipes";
import { RecipeEditorialRow } from "@/modules/recipe/features/recipes/components/RecipeEditorialRow";
import { AddRecipeToListDialog } from "./AddRecipeToListDialog";
import { useAddRecipeToShoppingList } from "../lib/queries";

export interface ListRecipesPanelProps {
  householdId: string;
  listId: string;
  list: ShoppingList;
  recipes: ShoppingListRecipe[];
  canMutate: boolean;
  /** Gates `Entfernen` — an online-only write, unlike the to-buy section (R28). */
  isOnline: boolean;
}

export function ListRecipesPanel({
  householdId,
  listId,
  list,
  recipes,
  canMutate,
  isOnline,
}: ListRecipesPanelProps) {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const addRecipe = useAddRecipeToShoppingList();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ShoppingListRecipe | null>(null);

  const pickerFilters =
    debouncedQuery.trim().length > 0 ? { q: debouncedQuery.trim(), limit: 8 } : { limit: 8 };
  const results = useRecipeList(pickerOpen ? householdId : null, pickerFilters);
  const pickedDetail = useRecipe(householdId, pickedId ?? undefined);

  const removeDisabled = !canMutate || !isOnline;
  const removeTitle = !isOnline ? t("recipe.shopping.lists.offlineHint") : undefined;

  const sharedCount = removing?.sharedCount ?? 0;
  const removedCount = removing ? removing.onListCount - removing.sharedCount : 0;

  async function confirmRemove() {
    if (!removing) return;
    try {
      const data = await removeRecipeFromShoppingList(householdId, listId, removing.recipeId);
      client.setQueryData(queryKeys.shoppingList(householdId, listId), data);
      toast.success(t("recipe.shopping.listRecipe.removedToast", { title: removing.title }));
    } catch (error) {
      toast.error(t("recipe.shopping.listRecipe.removeFailedToast"), errorMessage(error));
      throw error;
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="font-display text-display-sm font-medium text-fg">
        {t("recipe.shopping.listRecipe.heading")}
      </span>

      {recipes.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {recipes.map((recipe) => {
            const ingredientsOf = t("recipe.shopping.listRecipe.ingredientsOf", {
              onList: recipe.onListCount,
              total: recipe.ingredientTotal,
            });
            const meta =
              recipe.servings != null
                ? t("recipe.shopping.listRecipe.meta", {
                    ingredients: ingredientsOf,
                    servings: formatServingsLabel(recipe.servings, recipe.servingsUnit),
                  })
                : ingredientsOf;
            return (
              <li
                key={recipe.recipeId}
                className="flex items-center gap-3 rounded-card border border-line bg-surface p-2.5"
              >
                <span className="size-11 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                  {recipe.thumbnailUrl ? (
                    <img
                      src={mediaUrl(recipe.thumbnailUrl)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-display block truncate text-[15px] font-medium text-fg">
                    {recipe.title}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">{meta}</span>
                </span>
                <button
                  type="button"
                  disabled={removeDisabled}
                  title={removeTitle}
                  onClick={() => setRemoving(recipe)}
                  className="shrink-0 text-xs font-semibold text-fg-muted hover:text-danger disabled:pointer-events-none disabled:opacity-55"
                >
                  {t("recipe.shopping.listRecipe.remove")}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Button
        variant="dashed"
        leftIcon={<Plus className="size-4" />}
        disabled={!canMutate}
        onClick={() => setPickerOpen(true)}
      >
        {t("recipe.shopping.listRecipe.addRecipe")}
      </Button>

      <Dialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t("recipe.shopping.listRecipe.addRecipe")}
        size="sm"
      >
        <div className="flex flex-col gap-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("recipe.recipes.list.searchPlaceholder", { count: totalCount(results.data) })}
            autoComplete="off"
          />
          {results.isPending ? (
            <SkeletonList variant="editorial" count={4} />
          ) : (
            <ul className="flex flex-col">
              {flattenPages(results.data).map((recipe: RecipeListItem) => (
                <li key={recipe.id}>
                  <RecipeEditorialRow
                    recipe={recipe}
                    as="button"
                    onSelect={() => {
                      setPickedId(recipe.id);
                      setPickerOpen(false);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>

      {pickedId ? (
        pickedDetail.data ? (
          <AddRecipeToListDialog
            open
            onClose={() => setPickedId(null)}
            recipe={pickedDetail.data}
            initialServings={pickedDetail.data.servingsAmount ?? 1}
            lists={[list]}
            listsLoading={false}
            canCreateList={false}
            submitting={addRecipe.isPending}
            onSubmit={({ servings, ingredientIds }) => {
              addRecipe
                .addRecipe({ householdId, listId, recipeId: pickedId, servings, ingredientIds })
                .then(() => setPickedId(null))
                .catch((error: unknown) => toast.fromError(error));
            }}
          />
        ) : (
          <Dialog open onClose={() => setPickedId(null)} title={t("recipe.shopping.addRecipe.title")}>
            <Spinner />
          </Dialog>
        )
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("recipe.shopping.listRecipe.remove.title", { title: removing?.title ?? "" })}
        description={
          sharedCount === 0 ? (
            <p>
              {t("recipe.shopping.listRecipe.remove.descriptionExclusive", {
                count: removing?.onListCount ?? 0,
                title: removing?.title ?? "",
              })}
            </p>
          ) : (
            <>
              <p>{t("recipe.shopping.listRecipe.remove.description", { count: removedCount })}</p>
              <p>{t("recipe.shopping.listRecipe.remove.sharedNote", { count: sharedCount })}</p>
            </>
          )
        }
        confirmLabel={t("recipe.shopping.listRecipe.remove")}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
