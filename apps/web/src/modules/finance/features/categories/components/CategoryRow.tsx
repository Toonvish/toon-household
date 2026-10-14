import { useState } from "react";
import type { CategoryResponse } from "@toon/shared";
import { Badge } from "@/components/ui/Badge";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Input } from "@/components/ui/Input";
import { useT } from "@/lib/i18n";

/**
 * One row of `/categories` (docs/spec.md §4.7): label + usage count +
 * visibility toggle, rename and delete. `fixkosten` (`isSystem`) loses
 * rename/delete — the plan writes into it, and a household must never end up
 * with two "pots" the plan might pick between.
 *
 * NOTE: docs/spec.md §4.7 also calls this a "sortierbare Liste", but the i18n
 * inventory (§6.6) has no copy for a reorder control (no accessible label to
 * give an icon-only up/down button) and §6 is explicit that this component
 * must not invent new catalog text. Rows render in their existing `position`
 * order; reordering is left out until the catalog gets the missing strings.
 */
export function CategoryRow({
  category,
  onRename,
  onToggleHidden,
  onDelete,
  isSaving,
}: {
  category: CategoryResponse;
  onRename: (label: string) => void;
  onToggleHidden: () => void;
  onDelete: () => void;
  isSaving: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(category.label);

  function submitRename() {
    const trimmed = label.trim();
    setEditing(false);
    if (trimmed.length > 0 && trimmed !== category.label) onRename(trimmed);
    else setLabel(category.label);
  }

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitRename();
              }}
            >
              <Input
                autoFocus
                value={label}
                onChange={(event) => setLabel(event.currentTarget.value)}
                onBlur={submitRename}
              />
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate font-medium text-fg">{category.label}</span>
              {category.isSystem ? <Badge variant="brand">{t("finance.categories.system")}</Badge> : null}
              {category.isHidden ? <Badge variant="neutral">{t("finance.categories.hidden")}</Badge> : null}
            </div>
          )}
          <p className="mt-0.5 text-xs text-fg-muted">{t("finance.categories.usage", { count: category.usageCount })}</p>
        </div>

        {!editing ? (
          <ActionMenu
            label={t("finance.common.actions")}
            items={[
              !category.isSystem && { label: t("finance.common.edit"), onSelect: () => setEditing(true) },
              {
                label: category.isHidden ? t("finance.categories.show") : t("finance.categories.hide"),
                onSelect: onToggleHidden,
                disabled: isSaving,
              },
              !category.isSystem && {
                label: t("finance.common.delete"),
                variant: "danger" as const,
                onSelect: onDelete,
              },
            ]}
          />
        ) : null}
      </div>

      {category.isSystem ? <p className="text-xs text-fg-subtle">{t("finance.categories.systemHint")}</p> : null}
      {!category.isSystem && !category.customLabel && editing ? (
        <p className="text-xs text-fg-subtle">{t("finance.categories.renameHint")}</p>
      ) : null}
    </li>
  );
}
