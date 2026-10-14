/**
 * The category picker (docs/spec.md §4.5): a bottom sheet with a search
 * field and a two-column grid of large targets, opened from the "Mehr
 * Details" section of the transaction form. Leaving nothing selected is a
 * valid, deliberate choice — the form never defaults to "Sonstiges" so the
 * overview honestly shows what still needs a category (docs/spec.md §4.5).
 */
import { useMemo, useState } from "react";
import { AppLink } from "@/lib/nav";
import { Search } from "lucide-react";
import type { CategoryResponse } from "@toon/shared";
import { useT } from "@/lib/i18n";
import { useCategoriesForPicker } from "../lib/queries";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { SkeletonList } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { cn } from "@/lib/cn";

export interface CategorySheetProps {
  open: boolean;
  onClose: () => void;
  householdId: string;
  value: string | null;
  onSelect: (category: CategoryResponse | null) => void;
}

export function CategorySheet({ open, onClose, householdId, value, onSelect }: CategorySheetProps) {
  const t = useT();
  const [search, setSearch] = useState("");
  const query = useCategoriesForPicker(householdId);

  const filtered = useMemo(() => {
    const items = query.data?.items ?? [];
    const needle = search.trim().toLowerCase();
    if (needle === "") return items;
    return items.filter((category) => category.label.toLowerCase().includes(needle));
  }, [query.data, search]);

  function pick(category: CategoryResponse | null) {
    onSelect(category);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("finance.transactions.form.category")} size="lg">
      <div className="flex flex-col gap-3">
        <Input
          leftIcon={<Search />}
          placeholder={t("finance.transactions.form.categorySearch")}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          autoFocus
        />

        {query.isPending ? (
          <SkeletonList count={6} />
        ) : query.isError ? (
          <ErrorState inline error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <CategoryTile
              label={t("finance.transactions.form.categoryNone")}
              active={value === null}
              onClick={() => pick(null)}
            />
            {filtered.map((category) => (
              <CategoryTile
                key={category.id}
                label={category.label}
                active={category.id === value}
                onClick={() => pick(category)}
              />
            ))}
          </div>
        )}

        <AppLink
          to="/finance/categories"
          onClick={onClose}
          className="mt-1 self-start text-sm font-medium text-brand underline-offset-2 hover:underline"
        >
          {t("finance.categories.manage")}
        </AppLink>
      </div>
    </Dialog>
  );
}

function CategoryTile({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active ? "border-brand bg-brand-soft text-brand-soft-fg" : "border-line bg-surface text-fg hover:border-line-strong",
      )}
    >
      <span className="block truncate">{label}</span>
    </button>
  );
}
