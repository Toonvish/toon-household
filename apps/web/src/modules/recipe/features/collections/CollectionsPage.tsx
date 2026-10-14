/**
 * CollectionsPage — list and create collections ("Sammlungen") of the active household.
 */
import { useState } from "react";
import { FolderPlus, Library, Plus } from "lucide-react";
import { CreateCollectionRequestSchema } from "@toon/shared";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { useToast } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { apiFieldErrors, validate, type FieldErrors } from "@/lib/validation";
import { useRequiredHouseholdId } from "@/lib/session";
import { AppLink } from "@/lib/nav";
import { useCollections, useCreateCollection } from "./lib/queries";

export default function CollectionsPage() {
  const t = useT();
  const householdId = useRequiredHouseholdId();
  const collections = useCollections(householdId);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-display-2xl leading-[1.05] font-medium text-fg lg:text-display-3xl lg:leading-[1.1]">
            {t("recipe.collections.title")}
          </h1>
          <p className="text-sm text-fg-muted">{t("recipe.collections.subtitle")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} leftIcon={<Plus className="size-4" />}>
          {t("recipe.collections.create")}
        </Button>
      </header>

      {collections.isPending ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2].map((index) => (
            <li key={index}>
              <Card padding="md" className="flex flex-col gap-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
              </Card>
            </li>
          ))}
        </ul>
      ) : collections.isError ? (
        <ErrorState error={collections.error} onRetry={() => void collections.refetch()} />
      ) : (collections.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Library />}
          title={t("recipe.collections.emptyTitle")}
          description={t("recipe.collections.emptyDescription")}
          action={
            <Button
              onClick={() => setCreateOpen(true)}
              fullWidth
              leftIcon={<FolderPlus className="size-4" />}
            >
              {t("recipe.collections.createFirst")}
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(collections.data ?? []).map((collection) => (
            <li key={collection.id} className="flex">
              <AppLink
                to="/recipe/collections/$collectionId"
                params={{ collectionId: collection.id }}
                className="flex w-full flex-col gap-1 rounded-card border border-line bg-surface p-4 text-fg transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="font-display text-display-md font-medium">{collection.name}</span>
                {collection.description ? (
                  <span className="line-clamp-2 text-sm text-fg-muted">
                    {collection.description}
                  </span>
                ) : null}
                <span className="mt-auto pt-2 text-sm tabular-nums text-fg-subtle">
                  {t("recipe.count.recipes", { count: collection.recipeCount ?? 0 })}
                </span>
              </AppLink>
            </li>
          ))}
        </ul>
      )}

      <CreateCollectionDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateCollectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const householdId = useRequiredHouseholdId();
  const createCollection = useCreateCollection(householdId);
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  function close() {
    setName("");
    setDescription("");
    setErrors({});
    onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(CreateCollectionRequestSchema, {
      name,
      description: description.trim().length > 0 ? description : null,
      recipeIds: [],
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    try {
      const collection = await createCollection.mutateAsync(result.data);
      toast.success(t("recipe.collections.createdToast"), collection.name);
      close();
    } catch (error) {
      setErrors(apiFieldErrors(error));
    }
  }

  return (
    <Dialog open={open} onClose={close} title={t("recipe.collections.createTitle")} size="sm">
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
          placeholder={t("recipe.collections.namePlaceholder")}
          error={errors.name}
          disabled={createCollection.isPending}
          autoFocus
        />
        <Textarea
          label={t("household.common.description")}
          optional
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={errors.description}
          disabled={createCollection.isPending}
        />
        <div className="mt-1 flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            fullWidth
            disabled={createCollection.isPending}
          >
            {t("household.common.cancel")}
          </Button>
          <Button type="submit" loading={createCollection.isPending} fullWidth>
            {t("household.common.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Named export as well, for the feature barrel; the router imports the default. */
export { CollectionsPage };
