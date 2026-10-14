/**
 * CollectionDetailPage — the recipes of one collection in their stored order, with
 * add/remove and touch-friendly reordering (up/down buttons, never drag & drop).
 *
 * Reordering is optimistic in the local list and then persisted by
 * `useReorderCollectionRecipes`, which has to re-add all memberships because the API has
 * no "set position" endpoint (see the comment there).
 */
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ListPlus,
  Pencil,
  Save,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { UpdateCollectionRequestSchema, type RecipeListItem } from "@toon/shared";
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  LoadingBlock,
  SkeletonList,
  Textarea,
  buttonClasses,
} from "@/components/ui";
import { useToast } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { useRequiredHouseholdId } from "@/lib/session";
import { useIsWideViewport } from "@/lib/viewport";
import { AppLink, useAppNavigate, useRouteParam } from "@/lib/nav";
import { moveItem, useDebouncedValue } from "@/modules/recipe/features/recipes/lib/hooks";
import { useRecipeList, flattenPages } from "@/modules/recipe/features/recipes/lib/queries";
import { RecipeEditorialRow } from "@/modules/recipe/features/recipes/components/RecipeEditorialRow";
import {
  useAddRecipeToCollection,
  useCollection,
  useDeleteCollection,
  useRemoveRecipeFromCollection,
  useReorderCollectionRecipes,
  useUpdateCollection,
} from "./lib/queries";

export default function CollectionDetailPage() {
  const t = useT();
  const collectionId = useRouteParam("collectionId");
  const householdId = useRequiredHouseholdId();
  const navigate = useAppNavigate();
  const toast = useToast();

  const query = useCollection(householdId, collectionId);
  const removeRecipe = useRemoveRecipeFromCollection(householdId);
  const reorder = useReorderCollectionRecipes(householdId);
  const deleteCollection = useDeleteCollection(householdId);

  const [order, setOrder] = useState<RecipeListItem[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState("");

  // Mirror the server order locally so up/down feels instant.
  useEffect(() => {
    if (query.data) setOrder(query.data.recipes);
  }, [query.data]);

  if (query.isPending) return <LoadingBlock label={t("recipe.collectionDetail.loading")} />;

  if (query.isError || !query.data) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        action={
          <AppLink to="/recipe/collections" className={buttonClasses({ variant: "secondary" })}>
            {t("recipe.collectionDetail.backToList")}
          </AppLink>
        }
      />
    );
  }

  const { collection } = query.data;

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = moveItem(order, index, target);
    setOrder(next);
    setStatus(t("recipe.collectionDetail.movedStatus", { position: target + 1 }));
    reorder.mutate(
      { collectionId: collection.id, recipeIds: next.map((recipe) => recipe.id) },
      {
        onError: (error) => {
          toast.fromError(error, t("recipe.collectionDetail.reorderFailedToast"));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <AppLink to="/recipe/collections" className="text-sm text-fg-muted hover:text-fg">
          {t("recipe.collectionDetail.backLink")}
        </AppLink>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-display-2xl leading-[1.05] font-medium text-fg lg:text-display-3xl lg:leading-[1.1]">
              {collection.name}
            </h1>
            {collection.description ? (
              <p className="mt-1 text-fg-muted">{collection.description}</p>
            ) : null}
            <p className="mt-1 text-sm text-fg-subtle">
              {t("recipe.count.recipes", { count: order.length })}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setAddOpen(true)}
              leftIcon={<ListPlus className="size-4" />}
            >
              {t("recipe.collectionDetail.addRecipes")}
            </Button>
            <IconButton
              label={t("recipe.collectionDetail.editLabel")}
              icon={<Pencil />}
              variant="surface"
              onClick={() => setEditOpen(true)}
            />
            <IconButton
              label={t("recipe.collectionDetail.deleteLabel")}
              icon={<Trash2 />}
              variant="danger"
              onClick={() => setConfirmDelete(true)}
            />
          </div>
        </div>
      </header>

      <p aria-live="polite" className="sr-only">
        {status}
      </p>

      {order.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed />}
          title={t("recipe.collectionDetail.emptyTitle")}
          description={t("recipe.collectionDetail.emptyDescription")}
          action={
            <Button onClick={() => setAddOpen(true)} fullWidth leftIcon={<ListPlus className="size-4" />}>
              {t("recipe.collectionDetail.addRecipes")}
            </Button>
          }
        />
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {order.map((recipe, index) => (
            <li key={recipe.id} className="flex items-center gap-1">
              <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-fg-subtle">
                {index + 1}
              </span>
              {/*
                The shared row (also the library list, the plan picker, `ListRecipesPanel`)
                owns its own thumbnail/title/meta layout and its own `useIsWideViewport()`
                density split — this page only adds the position number and the three
                reorder/remove controls around it, never a second row implementation.
              */}
              <RecipeEditorialRow recipe={recipe} className="min-w-0 flex-1" />
              <div className="flex shrink-0 items-center gap-1">
                <IconButton
                  label={t("recipe.collectionDetail.moveUpLabel", { title: recipe.title })}
                  icon={<ArrowUp />}
                  size="sm"
                  onClick={() => move(index, -1)}
                  disabled={index === 0 || reorder.isPending}
                />
                <IconButton
                  label={t("recipe.collectionDetail.moveDownLabel", { title: recipe.title })}
                  icon={<ArrowDown />}
                  size="sm"
                  onClick={() => move(index, 1)}
                  disabled={index === order.length - 1 || reorder.isPending}
                />
                <IconButton
                  label={t("recipe.collectionDetail.removeLabel", { title: recipe.title })}
                  icon={<X />}
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    try {
                      await removeRecipe.mutateAsync({
                        collectionId: collection.id,
                        recipeId: recipe.id,
                      });
                      setStatus(t("recipe.collectionDetail.removedStatus", { title: recipe.title }));
                    } catch (error) {
                      toast.fromError(error, t("recipe.collectionDetail.removeFailedToast"));
                    }
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      <EditCollectionDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        collectionId={collection.id}
        name={collection.name}
        description={collection.description ?? ""}
      />

      <AddRecipesDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        collectionId={collection.id}
        existingIds={order.map((recipe) => recipe.id)}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        destructive
        title={t("recipe.collectionDetail.deleteConfirmTitle")}
        description={t("recipe.collectionDetail.deleteConfirmDescription", {
          name: collection.name,
        })}
        confirmLabel={t("household.common.delete")}
        onConfirm={async () => {
          try {
            await deleteCollection.mutateAsync(collection.id);
            toast.success(t("recipe.collectionDetail.deletedToast"));
            navigate({ to: "/recipe/collections", replace: true });
          } catch (error) {
            toast.fromError(error, t("recipe.collectionDetail.deleteFailedToast"));
            throw error;
          }
        }}
      />
    </div>
  );
}

function EditCollectionDialog({
  open,
  onClose,
  collectionId,
  name: initialName,
  description: initialDescription,
}: {
  open: boolean;
  onClose: () => void;
  collectionId: string;
  name: string;
  description: string;
}) {
  const t = useT();
  const householdId = useRequiredHouseholdId();
  const updateCollection = useUpdateCollection(householdId);
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    setName(initialName);
    setDescription(initialDescription);
  }, [initialName, initialDescription, open]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(UpdateCollectionRequestSchema, {
      name,
      description: description.trim().length > 0 ? description : null,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    try {
      await updateCollection.mutateAsync({ collectionId, ...result.data });
      toast.success(t("recipe.collectionDetail.savedToast"));
      setErrors({});
      onClose();
    } catch (error) {
      setErrors(apiFieldErrors(error));
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("recipe.collectionDetail.editTitle")} size="sm">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        {errors._form ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {errors._form}
          </p>
        ) : null}
        <Input
          label={t("household.common.name")}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
          disabled={updateCollection.isPending}
        />
        <Textarea
          label={t("household.common.description")}
          optional
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={errors.description}
          disabled={updateCollection.isPending}
        />
        <div className="mt-1 flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose} fullWidth>
            {t("household.common.cancel")}
          </Button>
          <Button
            type="submit"
            loading={updateCollection.isPending}
            fullWidth
            leftIcon={<Save className="size-4" />}
          >
            {t("household.common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AddRecipesDialog({
  open,
  onClose,
  collectionId,
  existingIds,
}: {
  open: boolean;
  onClose: () => void;
  collectionId: string;
  existingIds: readonly string[];
}) {
  const t = useT();
  const householdId = useRequiredHouseholdId();
  const addRecipe = useAddRecipeToCollection(householdId);
  const toast = useToast();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);
  // Only query while the dialog is actually open.
  const list = useRecipeList(open ? householdId : null, { q: debounced, sort: "title", limit: 50 });
  const recipes = flattenPages(list.data);
  /** Matches the row's own density split, same as `SkeletonList`'s count elsewhere. */
  const wide = useIsWideViewport();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("recipe.collectionDetail.addDialogTitle")}
      description={t("recipe.collectionDetail.addDialogDescription")}
      size="lg"
    >
      <div className="flex flex-col gap-3">
        <Input
          type="search"
          label={t("recipe.collectionDetail.searchLabel")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("recipe.collectionDetail.searchPlaceholder")}
          autoComplete="off"
        />

        {list.isPending ? (
          <SkeletonList variant="editorial" count={wide ? 6 : 4} />
        ) : list.isError ? (
          <ErrorState inline error={list.error} onRetry={() => void list.refetch()} />
        ) : recipes.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">
            {t("recipe.collectionDetail.noRecipesFound")}
          </p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col overflow-y-auto">
            {recipes.map((recipe) => {
              const already = existingIds.includes(recipe.id);
              return (
                <li key={recipe.id} className="relative">
                  <RecipeEditorialRow
                    recipe={recipe}
                    as="button"
                    className={already ? "pointer-events-none opacity-60" : undefined}
                    onSelect={
                      already
                        ? undefined
                        : async () => {
                            try {
                              await addRecipe.mutateAsync({ collectionId, recipeId: recipe.id });
                              toast.success(t("recipe.collectionDetail.addedToast"), recipe.title);
                            } catch (error) {
                              toast.fromError(error, t("recipe.collectionDetail.addFailedToast"));
                            }
                          }
                    }
                  />
                  {already ? (
                    <span className="pointer-events-none absolute top-3.5 right-2 inline-flex items-center gap-1 text-sm text-success">
                      <Check aria-hidden="true" className="size-4" />
                      {t("recipe.collectionDetail.included")}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <Button variant="secondary" onClick={onClose} fullWidth>
          {t("recipe.collectionDetail.done")}
        </Button>
      </div>
    </Dialog>
  );
}

/** Named export as well, for the feature barrel; the router imports the default. */
export { CollectionDetailPage };
