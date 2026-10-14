import { useState } from "react";
import type { CategoryResponse } from "@toon/shared";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";
import { useDeleteCategory } from "../lib/queries";

/**
 * Deleting a category that still has bookings requires a target to reassign
 * them to (docs/spec.md §3.10, §4.7) — the alternative, silently nulling
 * `category_id`, would just move every affected expense to "ohne Kategorie"
 * and the user would have to go find them again.
 */
export function DeleteCategoryDialog({
  householdId,
  category,
  categories,
  onClose,
}: {
  householdId: string;
  category: CategoryResponse | null;
  categories: readonly CategoryResponse[];
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const deleteCategory = useDeleteCategory(householdId);
  const [reassignTo, setReassignTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = category !== null;
  const needsReassign = (category?.usageCount ?? 0) > 0;
  const options = categories.filter((entry) => entry.id !== category?.id);

  function close() {
    setReassignTo("");
    setError(null);
    onClose();
  }

  async function confirm() {
    if (!category) return;
    setError(null);
    if (needsReassign && !reassignTo) {
      setError(t("finance.categories.delete.reassign"));
      return;
    }
    try {
      await deleteCategory.mutateAsync({ categoryId: category.id, reassignTo: reassignTo || undefined });
      toast.success(t("finance.categories.toast.deleted"));
      close();
    } catch (submitError) {
      toast.fromError(submitError);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("finance.categories.delete.title")}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close} fullWidth>
            {t("finance.common.cancel")}
          </Button>
          <Button variant="danger" loading={deleteCategory.isPending} onClick={confirm} fullWidth>
            {t("finance.common.delete")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        {error ? <ErrorState inline description={error} /> : null}
        {needsReassign && category ? (
          <>
            <p className="text-sm text-fg-muted">
              {t("finance.categories.delete.inUse", { count: category.usageCount })}
            </p>
            <Select
              label={t("finance.categories.delete.reassign")}
              value={reassignTo}
              placeholder={t("finance.common.select")}
              options={options.map((entry) => ({ value: entry.id, label: entry.label }))}
              onChange={(event) => setReassignTo(event.currentTarget.value)}
            />
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
