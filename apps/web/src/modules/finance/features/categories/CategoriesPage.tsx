import { useState } from "react";
import type { CategoryResponse } from "@toon/shared";
import { PageHeader } from "@/modules/finance/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";
import { useRequiredHouseholdId } from "@/lib/session";
import { CategoryRow } from "./components/CategoryRow";
import { DeleteCategoryDialog } from "./components/DeleteCategoryDialog";
import { useCategories, useCreateCategory, useUpdateCategory } from "./lib/queries";

/** `/categories` — sidebar destination, reachable on mobile via `SpendByCategoryCard`'s footer link (docs/spec.md §4.7). */
export function CategoriesPage() {
  const t = useT();
  const toast = useToast();
  const householdId = useRequiredHouseholdId();
  const categories = useCategories(householdId);
  const createCategory = useCreateCategory(householdId);
  const updateCategory = useUpdateCategory(householdId);

  const [newLabel, setNewLabel] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CategoryResponse | null>(null);

  if (categories.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("finance.categories.title")} description={t("finance.categories.description")} />
        <SkeletonList />
      </div>
    );
  }

  if (categories.isError) {
    return <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />;
  }

  const items = [...categories.data.items].sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("finance.categories.title")} description={t("finance.categories.description")} />

      <Card padding="none">
        <ul className="flex flex-col divide-y divide-line px-4 sm:px-5">
          {items.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              isSaving={updateCategory.isPending}
              onRename={(label) =>
                updateCategory.mutate(
                  { categoryId: category.id, body: { label } },
                  {
                    onSuccess: () => toast.success(t("finance.categories.toast.updated")),
                    onError: (error) => toast.fromError(error),
                  },
                )
              }
              onToggleHidden={() =>
                updateCategory.mutate(
                  { categoryId: category.id, body: { isHidden: !category.isHidden } },
                  { onError: (error) => toast.fromError(error) },
                )
              }
              onDelete={() => setDeleteTarget(category)}
            />
          ))}
        </ul>
      </Card>

      <Card>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = newLabel.trim();
            if (trimmed.length === 0) return;
            createCategory.mutate(
              { label: trimmed },
              {
                onSuccess: () => {
                  toast.success(t("finance.categories.toast.created"));
                  setNewLabel("");
                },
                onError: (error) => toast.fromError(error),
              },
            );
          }}
        >
          <Input
            containerClassName="flex-1"
            label={t("finance.categories.label")}
            value={newLabel}
            onChange={(event) => setNewLabel(event.currentTarget.value)}
          />
          <Button type="submit" loading={createCategory.isPending}>
            {t("finance.categories.add")}
          </Button>
        </form>
      </Card>

      <DeleteCategoryDialog
        householdId={householdId}
        category={deleteTarget}
        categories={items}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default CategoriesPage;
