/**
 * RecipeNewPage — creates a recipe with `RecipeForm`.
 *
 * The image upload endpoint needs an existing recipe id, so a picked photo is uploaded
 * right after the recipe was created and the recipe is then patched with the returned
 * URL. A failing upload does NOT fail the whole save — the recipe is kept and the user
 * gets a toast telling them to try the photo again.
 */
import { useMemo } from "react";
import { Button, ErrorState } from "@/components/ui";
import { useToast } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useActiveHousehold } from "@/lib/session";
import { useTags } from "@/modules/recipe/features/tags/lib/queries";
import { useCollections } from "@/modules/recipe/features/collections/lib/queries";
import { AppLink, useAppNavigate } from "@/lib/nav";
import { emptyRecipeForm } from "./lib/formState";
import { useCreateRecipe, useUpdateRecipe, useUploadRecipeImage } from "./lib/queries";
import { RecipeForm, type RecipeFormSubmit } from "./components/RecipeForm";

export default function RecipeNewPage() {
  const t = useT();
  const { householdId } = useActiveHousehold();
  const navigate = useAppNavigate();
  const toast = useToast();

  const tags = useTags(householdId);
  const collections = useCollections(householdId);
  const createRecipe = useCreateRecipe(householdId);
  const uploadImage = useUploadRecipeImage(householdId);
  // No id is bound here — it is passed per call, because the recipe only exists
  // after `createRecipe` resolved (React state would still be stale at that point).
  const patchRecipe = useUpdateRecipe(householdId);

  const initialValues = useMemo(() => emptyRecipeForm(), []);
  const pending = createRecipe.isPending || uploadImage.isPending || patchRecipe.isPending;

  async function submit({ payload, file }: RecipeFormSubmit) {
    const recipe = await createRecipe.mutateAsync(payload);

    if (file) {
      try {
        const upload = await uploadImage.mutateAsync({ recipeId: recipe.id, file });
        await patchRecipe.mutateAsync({ recipeId: recipe.id, imageUrl: upload.url });
      } catch (error) {
        toast.fromError(error, t("recipe.recipes.new.photoUploadFailedToast"));
        navigate({ to: "/recipe/recipes/$recipeId", params: { recipeId: recipe.id }, replace: true });
        return;
      }
    }

    toast.success(t("recipe.recipes.new.createdToast"), recipe.title);
    navigate({ to: "/recipe/recipes/$recipeId", params: { recipeId: recipe.id }, replace: true });
  }

  if (householdId === null) {
    return (
      <ErrorState
        title={t("recipe.recipes.new.noGroup.title")}
        description={t("recipe.recipes.new.noGroup.description")}
        action={
          <AppLink to="/households">
            <Button variant="secondary">{t("recipe.recipes.new.noGroup.action")}</Button>
          </AppLink>
        }
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="font-display text-display-2xl font-medium text-fg lg:text-display-3xl">{t("recipe.recipes.new.title")}</h1>
      <RecipeForm
        initialValues={initialValues}
        initialCourse={null}
        availableTags={tags.data ?? []}
        availableCollections={collections.data ?? []}
        onSubmit={submit}
        onCancel={() => navigate({ to: "/recipe" })}
        submitLabel={t("recipe.recipes.new.submit")}
        pending={pending}
        error={createRecipe.error ?? patchRecipe.error}
        imageHint={t("recipe.recipes.new.imageHint")}
      />
    </div>
  );
}

/** Named export as well, for the feature barrel; the router imports the default. */
export { RecipeNewPage };
