/**
 * RecipeEditPage — edits an existing recipe with the same `RecipeForm`.
 *
 * `ingredients`/`steps`/`tags`/`collectionIds` are replace-all in a PATCH, which is
 * exactly what the form produces, so the whole payload can be sent as-is.
 * A picked photo is uploaded first and its URL wins over a manually typed one.
 */
import { useMemo } from "react";
import type { RecipeDetail } from "@toon/shared";
import { ErrorState, LoadingBlock, buttonClasses } from "@/components/ui";
import { useToast } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useActiveHousehold, useCurrentUser } from "@/lib/session";
import { useTags } from "@/modules/recipe/features/tags/lib/queries";
import { useCollections } from "@/modules/recipe/features/collections/lib/queries";
import { AppLink, useAppNavigate, useRouteParam } from "@/lib/nav";
import { canModifyOwn } from "./lib/permissions";
import { recipeToForm } from "./lib/formState";
import { useRecipe, useUpdateRecipe, useUploadRecipeImage } from "./lib/queries";
import { RecipeForm, type RecipeFormSubmit } from "./components/RecipeForm";

export default function RecipeEditPage() {
  const t = useT();
  const recipeId = useRouteParam("recipeId");
  const { householdId, role } = useActiveHousehold();
  const user = useCurrentUser();
  const navigate = useAppNavigate();
  const toast = useToast();

  const query = useRecipe(householdId, recipeId);
  const loaded = query.data;
  const tags = useTags(householdId);
  const collections = useCollections(householdId);
  const updateRecipe = useUpdateRecipe(householdId, recipeId);
  const uploadImage = useUploadRecipeImage(householdId);

  const initialValues = useMemo(() => (loaded ? recipeToForm(loaded) : null), [loaded]);

  if (query.isPending) return <LoadingBlock label={t("recipe.recipes.detail.loading")} />;

  if (query.isError || !loaded || !initialValues) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        action={
          <AppLink to="/recipe" className={buttonClasses({ variant: "secondary" })}>
            {t("recipe.recipes.action.backToList")}
          </AppLink>
        }
      />
    );
  }

  // Non-optional alias so the async submit handler closes over a narrowed value.
  const recipe: RecipeDetail = loaded;

  // The API rejects this too (403) — showing it early avoids a pointless form.
  if (!canModifyOwn(role, user.id, recipe.createdBy)) {
    return (
      <ErrorState
        title={t("recipe.recipes.edit.forbidden.title")}
        description={t("recipe.recipes.edit.forbidden.description")}
        action={
          <AppLink
            to="/recipe/recipes/$recipeId"
            params={{ recipeId: recipe.id }}
            className={buttonClasses({ variant: "secondary" })}
          >
            {t("recipe.recipes.action.backToRecipe")}
          </AppLink>
        }
      />
    );
  }

  const pending = updateRecipe.isPending || uploadImage.isPending;

  async function submit({ payload, file }: RecipeFormSubmit) {
    let imageUrl = payload.imageUrl ?? null;

    if (file) {
      try {
        const upload = await uploadImage.mutateAsync({ recipeId: recipe.id, file });
        imageUrl = upload.url;
      } catch (error) {
        toast.fromError(error, t("recipe.recipes.edit.photoUploadFailedToast"));
        return;
      }
    }

    await updateRecipe.mutateAsync({ ...payload, imageUrl });
    toast.success(t("recipe.recipes.edit.savedToast"));
    navigate({ to: "/recipe/recipes/$recipeId", params: { recipeId: recipe.id }, replace: true });
  }

  // The recipe's single course tag, if it has one — a course is `kind:'course'` (D5),
  // never a free tag, so this is the only way to find it among `recipe.tags`.
  const initialCourse = recipe.tags.find((tag) => tag.kind === "course")?.name ?? null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-display-2xl font-medium text-fg lg:text-display-3xl">{t("recipe.recipes.edit.title")}</h1>
        <p className="truncate text-sm text-fg-muted">{recipe.title}</p>
      </div>
      <RecipeForm
        initialValues={initialValues}
        initialCourse={initialCourse}
        availableTags={tags.data ?? []}
        availableCollections={collections.data ?? []}
        onSubmit={submit}
        onCancel={() =>
          navigate({ to: "/recipe/recipes/$recipeId", params: { recipeId: recipe.id } })
        }
        submitLabel={t("recipe.recipes.edit.submit")}
        pending={pending}
        error={updateRecipe.error}
      />
    </div>
  );
}

/** Named export as well, for the feature barrel; the router imports the default. */
export { RecipeEditPage };
