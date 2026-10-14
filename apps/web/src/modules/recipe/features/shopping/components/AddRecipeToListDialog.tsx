/**
 * "Zur Einkaufsliste" — pick a list, pick the portions, pick the ingredients, add.
 *
 * The portion stepper is the same `ServingsScaler` the recipe page uses, and it opens
 * on whatever the cook is currently LOOKING at (the scaled value, not the stored one),
 * because "I'm cooking this for six" is the state they are already in. Changing it here
 * re-scales the ingredients before they land on the list — the API applies the same
 * `scaleIngredients` the screen does, so the amounts match what was on screen.
 *
 * Ingredients are all TICKED when the dialog opens: "everything" is the common case and
 * the whole point is that adding a recipe is one tap. Unticking is for the salt and the
 * olive oil that are already in the cupboard. Selection is tracked as the set of
 * EXCLUDED ids, so a default-on list stays default-on even if the recipe gains a line.
 *
 * The line under each amount is the SCALED amount, and the button counts the resulting
 * positions, because scaling plus merging plus nicest-unit conversion means the list
 * will not read exactly like the recipe ("500 ml Milch" x3 becomes "1,5 l").
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ListPlus, ShoppingBasket } from "lucide-react";
import {
  formatQuantity,
  formatShoppingAmount,
  recipeToShoppingItems,
  scaleIngredients,
  type RecipeDetail,
  type RecipeIngredientRecord,
  type ShoppingList,
} from "@toon/shared";
import { Button, Dialog, Field, Input, Select, Spinner } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { readStorage, storageKeys } from "@/lib/storage";
import { ServingsScaler } from "@/modules/recipe/features/recipes/components/ServingsScaler";

/**
 * R9's target-list resolution, reused here for the same reason `WeekPlanPanel.tsx` and
 * `ShoppingListsPage.tsx` carry their own copy (there is no shared constant to
 * import): `storageKeys.lastShoppingListId` first
 * — so a cook who picked "Wocheneinkauf" last time gets it again without re-choosing —
 * then the alphabetically first list, never a server-side default. `householdId` comes off
 * `lists[0]` rather than a prop of its own: every list this dialog is ever handed belongs
 * to the one active household, so there is nothing to pass through that the lists don't
 * already carry.
 */
function resolveInitialListId(lists: readonly ShoppingList[]): string {
  if (lists.length === 0) return "";
  const householdId = lists[0]?.householdId;
  const saved = readStorage(storageKeys.lastShoppingListId);
  if (saved) {
    const [savedHouseholdId, savedListId] = saved.split(":");
    if (savedHouseholdId === householdId) {
      const match = lists.find((list) => list.id === savedListId);
      if (match) return match.id;
    }
  }
  return [...lists].sort((a, b) => a.name.localeCompare(b.name, "de"))[0]?.id ?? "";
}

export interface AddRecipeToListDialogProps {
  open: boolean;
  onClose: () => void;
  recipe: RecipeDetail;
  /** Servings the recipe screen is currently showing. */
  initialServings: number;
  lists: ShoppingList[];
  listsLoading: boolean;
  submitting: boolean;
  /**
   * Creates the household's first list. Absent (or `canCreateList: false`) hides the
   * offer — list creation is online-only, unlike adding to an existing list.
   */
  onCreateList?: (name: string) => Promise<ShoppingList | undefined>;
  canCreateList?: boolean;
  creatingList?: boolean;
  onSubmit: (input: {
    listId: string;
    servings: number | undefined;
    /** Omitted when every ingredient is selected — that means "the whole recipe". */
    ingredientIds: readonly string[] | undefined;
  }) => void;
}

export function AddRecipeToListDialog({
  open,
  onClose,
  recipe,
  initialServings,
  lists,
  listsLoading,
  submitting,
  onCreateList,
  canCreateList = true,
  creatingList = false,
  onSubmit,
}: AddRecipeToListDialogProps) {
  const t = useT();
  const defaultListName = t("recipe.shopping.list.defaultName");
  const [listId, setListId] = useState("");
  const [servings, setServings] = useState(initialServings);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [newListName, setNewListName] = useState(defaultListName);
  const [createError, setCreateError] = useState<string | undefined>(undefined);

  /** Only lines with a name reach the list — `recipeToShoppingItems` drops the rest. */
  const shoppable = useMemo<RecipeIngredientRecord[]>(
    () => recipe.ingredients.filter((ingredient) => ingredient.name.trim().length > 0),
    [recipe.ingredients],
  );

  // Re-seed ONCE PER OPENING: the cook may have changed the portions on the page between
  // two openings, and a stale value would silently add the wrong amounts. The tick marks
  // reset too — last time's deselection is not this time's intent.
  //
  // The `opened` guard is load-bearing, and dropping it back to a plain dependency array
  // un-ticks every ingredient MID-DIALOG. `lists` is a fresh array on every refetch, so
  // creating the household's first list from here — or any background refetch — re-ran the
  // seed and threw away the deselections the cook had just made.
  const opened = useRef(false);
  useEffect(() => {
    if (!open) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setServings(initialServings);
    setExcluded(new Set());
    setCreateError(undefined);
    setNewListName(defaultListName);
  }, [open, initialServings, defaultListName]);

  // Selecting a list stays its own effect, because it must keep running: the lists query
  // is routinely still in flight when the dialog opens, so there is nothing to select yet.
  // Only fills a blank — an explicit choice (and `createList`'s) is never overwritten, so a
  // pick that survives a background refetch also survives `resolveInitialListId` re-running.
  useEffect(() => {
    if (!open) return;
    setListId((current) => (current.length > 0 ? current : resolveInitialListId(lists)));
  }, [open, lists]);

  const base =
    typeof recipe.servingsAmount === "number" && recipe.servingsAmount > 0
      ? recipe.servingsAmount
      : null;
  const scalable = base !== null;
  const factor = base === null ? 1 : servings / base;

  /**
   * EVERY shoppable line at the chosen portion count, index-aligned with `shoppable`,
   * so unticking a line does not blank its amount. Scaling is per-ingredient, so
   * scaling-then-filtering is identical to the server's filtering-then-scaling.
   */
  const scaled = useMemo(
    () =>
      factor === 1 ? shoppable : scaleIngredients(shoppable, factor, { keepNonScalingUnits: true }),
    [shoppable, factor],
  );

  const selectedIds = useMemo(
    () => shoppable.filter((ingredient) => !excluded.has(ingredient.id)).map((i) => i.id),
    [shoppable, excluded],
  );
  const allSelected = selectedIds.length === shoppable.length;
  const noneSelected = selectedIds.length === 0;

  // Exactly what the API will compute, using the same pure functions. `scaleIngredients`
  // is generic and maps 1:1, so `scaled` still carries the ids to filter on.
  const preview = useMemo(
    () =>
      recipeToShoppingItems(
        scaled.filter((ingredient) => !excluded.has(ingredient.id)),
        recipe.id,
      ),
    [scaled, excluded, recipe.id],
  );
  /** Merging can turn two ticked lines into one position; say so instead of surprising. */
  const merged = preview.length !== selectedIds.length;

  // `indeterminate` is a DOM property with no JSX attribute, so it has to be set on the
  // node. An effect, not an inline ref callback: a ref only re-runs when its identity
  // changes, which is not something to rely on for a value that tracks state.
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
    setExcluded(allSelected ? new Set(shoppable.map((ingredient) => ingredient.id)) : new Set());
  };

  const createList = async () => {
    if (onCreateList === undefined) return;
    setCreateError(undefined);
    try {
      const list = await onCreateList(newListName.trim() || defaultListName);
      if (list) setListId(list.id);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : t("recipe.shopping.addRecipe.createListError"),
      );
    }
  };

  const hasList = listId.length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("recipe.shopping.addRecipe.title")}
      description={recipe.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t("recipe.shopping.action.cancel")}
          </Button>
          <Button
            leftIcon={<ShoppingBasket />}
            loading={submitting}
            disabled={!hasList || preview.length === 0}
            onClick={() =>
              onSubmit({
                listId,
                servings: scalable ? servings : undefined,
                ingredientIds: allSelected ? undefined : selectedIds,
              })
            }
          >
            {t("recipe.shopping.addRecipe.submit", { count: preview.length })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {listsLoading ? (
          <Spinner label={t("recipe.shopping.addRecipe.listsLoading")} />
        ) : lists.length === 0 ? (
          /* No dead end here: a household's first list can be created from this dialog,
             otherwise "zur Einkaufsliste" is a button that can never do anything. */
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/50 p-3">
            <p className="text-sm text-fg-muted">{t("recipe.shopping.addRecipe.noLists")}</p>
            {canCreateList && onCreateList !== undefined ? (
              <>
                <div className="flex items-end gap-2">
                  <Input
                    label={t("recipe.shopping.list.name.label")}
                    containerClassName="min-w-0 flex-1"
                    value={newListName}
                    maxLength={80}
                    onChange={(event) => setNewListName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void createList();
                      }
                    }}
                  />
                  <Button
                    variant="secondary"
                    leftIcon={<ListPlus />}
                    loading={creatingList}
                    disabled={newListName.trim().length === 0}
                    onClick={() => void createList()}
                  >
                    {t("recipe.shopping.action.create")}
                  </Button>
                </div>
                {createError !== undefined ? (
                  <p role="alert" className="text-sm text-danger-soft-fg">
                    {createError}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-fg-muted">{t("recipe.shopping.addRecipe.createOffline")}</p>
            )}
          </div>
        ) : (
          <Field label={t("recipe.shopping.addRecipe.list.label")}>
            {(props) => (
              <Select
                {...props}
                value={listId}
                onChange={(event) => setListId(event.target.value)}
                options={lists.map((list) => ({ value: list.id, label: list.name }))}
              />
            )}
          </Field>
        )}

        {scalable ? (
          <Field
            label={t("recipe.shopping.addRecipe.servings.label")}
            hint={t("recipe.shopping.addRecipe.servings.hint")}
          >
            {() => (
              <ServingsScaler
                value={servings}
                baseValue={base}
                unit={recipe.servingsUnit}
                onChange={setServings}
              />
            )}
          </Field>
        ) : (
          <p className="text-sm text-fg-muted">{t("recipe.shopping.addRecipe.noServings")}</p>
        )}

        {shoppable.length > 0 ? (
          <fieldset className="min-w-0">
            {/* A <legend> is only a legend as the fieldset's FIRST child, so the visible
                heading below is a plain span and this one carries the accessible name. */}
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
            <ul className="max-h-56 overflow-y-auto rounded-xl border border-line bg-surface-2/50 px-3 py-1 text-sm">
              {shoppable.map((ingredient, index) => {
                const line = scaled[index] ?? ingredient;
                const amount = formatShoppingAmount(
                  { quantity: line.quantity ?? null, unit: line.unit ?? null },
                  formatQuantity,
                );
                return (
                  <li key={ingredient.id}>
                    <label className="flex min-h-11 min-w-0 items-center gap-2.5 py-0.5">
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 accent-[var(--brand)]"
                        checked={!excluded.has(ingredient.id)}
                        onChange={() => toggle(ingredient.id)}
                        aria-label={ingredient.name}
                      />
                      <span className="min-w-16 shrink-0 text-right font-medium tabular-nums text-fg">
                        {amount.length === 0 ? "—" : amount}
                      </span>
                      {/* Wraps rather than truncates: "Tomaten, geschält, aus der Dose"
                          is exactly the line you need to read to decide the tick. */}
                      <span
                        className={
                          excluded.has(ingredient.id)
                            ? "min-w-0 flex-1 break-words text-fg-subtle line-through"
                            : "min-w-0 flex-1 break-words text-fg-muted"
                        }
                      >
                        {ingredient.name}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-xs text-fg-muted">
              {noneSelected
                ? t("recipe.shopping.addRecipe.selectAtLeastOne")
                : merged
                  ? t("recipe.shopping.addRecipe.mergeNotice", { count: preview.length })
                  : t("recipe.shopping.addRecipe.mergeHint")}
            </p>
          </fieldset>
        ) : (
          <p className="text-sm text-fg-muted">{t("recipe.shopping.addRecipe.noIngredients")}</p>
        )}
      </div>
    </Dialog>
  );
}
