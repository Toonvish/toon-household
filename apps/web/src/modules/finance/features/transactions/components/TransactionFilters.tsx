/**
 * The transaction list's filters — REAL URL STATE (docs/spec.md §4.4/§5.4:
 * "Filter leben in der URL", pattern named after toon-recipe's
 * `useUrlRecipeFilters`). `/transactions`'s `validateSearch` keeps exactly
 * `TX_FILTER_PARAMS` (`router.tsx`, `[WEB-KERN]`) — `from, to, kind,
 * categoryId, tagIds, origin, q, sort` — so this hook only ever reads/writes
 * those eight keys; anything else is dropped by the router before it gets
 * here.
 *
 * NOTE — two ActionMenu items the spec describes ("Sammelbuchungen
 * ausblenden" / `includeAggregates=false`, "Nur eigene" / `payerId`) have NO
 * matching key in `TX_FILTER_PARAMS`. Building them as URL state would
 * silently no-op (the router strips unknown search keys before this hook
 * ever sees them). They are therefore wired as local, non-persisted toggles
 * on `TransactionsPage` instead — see the `WEB-TX` hand-off note for the
 * missing router params.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppNavigate, type NavigateOptions } from "@/lib/nav";
import { X } from "lucide-react";
import type { TransactionListQuery, TransactionOriginValue, TxKindValue } from "@toon/shared";
import { useSearchParams } from "@/lib/navigation";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { useCategoriesForPicker, useTagSuggestions } from "../lib/queries";
import { TX_KIND_LABEL_KEYS, TX_KINDS, translateKind } from "../lib/kinds";

const KIND_VALUES: readonly TxKindValue[] = ["MINE_SPLIT", "THEIRS_SPLIT", "FOR_THEM", "TRANSFER"];
const ORIGIN_VALUES: readonly TransactionOriginValue[] = ["manual", "fixed_plan", "fixed_plan_adjustment", "import"];
const SORT_VALUES = ["bookedAt", "-bookedAt", "amount", "-amount"] as const;
export type TransactionSortValue = (typeof SORT_VALUES)[number];
export const DEFAULT_TX_SORT: TransactionSortValue = "-bookedAt";

export interface TransactionUrlFilters {
  from?: string;
  to?: string;
  kind?: TxKindValue;
  categoryId?: string;
  tagIds?: string;
  origin?: TransactionOriginValue;
  sort: TransactionSortValue;
}

type TransactionSearchParams = Partial<Record<keyof TransactionUrlFilters | "q", string>>;

function filtersFromSearch(search: Record<string, string | undefined>): TransactionUrlFilters {
  const kind = KIND_VALUES.find((value) => value === search.kind);
  const origin = ORIGIN_VALUES.find((value) => value === search.origin);
  const sort = SORT_VALUES.find((value) => value === search.sort) ?? DEFAULT_TX_SORT;
  return {
    sort,
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
    ...(kind ? { kind } : {}),
    ...(search.categoryId ? { categoryId: search.categoryId } : {}),
    ...(search.tagIds ? { tagIds: search.tagIds } : {}),
    ...(origin ? { origin } : {}),
  };
}

function searchFromFilters(filters: TransactionUrlFilters, q: string): TransactionSearchParams {
  return {
    ...(q.trim().length > 0 ? { q: q.trim() } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.tagIds ? { tagIds: filters.tagIds } : {}),
    ...(filters.origin ? { origin: filters.origin } : {}),
    ...(filters.sort !== DEFAULT_TX_SORT ? { sort: filters.sort } : {}),
  };
}

/** Delays reflecting `value` into the URL so typing a search term does not push one history entry per keystroke. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export interface UrlTransactionFilters {
  searchText: string;
  setSearchText: (value: string) => void;
  filters: TransactionUrlFilters;
  setFilters: (next: TransactionUrlFilters) => void;
  /** `filters` plus the debounced search text, ready for `useTransactions`. */
  effectiveQuery: Partial<TransactionListQuery>;
  hasFilters: boolean;
  reset: () => void;
}

export function useUrlTransactionFilters(debounceMs = 300): UrlTransactionFilters {
  const search = useSearchParams();
  const navigate = useAppNavigate();

  const filters = useMemo(() => filtersFromSearch(search), [search]);
  const urlQuery = search.q ?? "";

  const [searchText, setSearchText] = useState(urlQuery);
  const debouncedText = useDebouncedValue(searchText, debounceMs);

  const push = useCallback(
    (next: TransactionSearchParams) => {
      navigate({ to: "/finance/transactions", search: next as NavigateOptions["search"], replace: true });
    },
    [navigate],
  );

  useEffect(() => {
    if (debouncedText === urlQuery) return;
    push(searchFromFilters(filters, debouncedText));
    // Only re-run when the debounced text changes relative to the URL — `filters`/`push` are read, not depended on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedText, urlQuery]);

  useEffect(() => {
    if (urlQuery !== debouncedText) setSearchText(urlQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  const effectiveQuery = useMemo<Partial<TransactionListQuery>>(
    () => ({ ...filters, ...(debouncedText.trim().length > 0 ? { q: debouncedText.trim() } : {}) }),
    [filters, debouncedText],
  );

  const setFilters = useCallback((next: TransactionUrlFilters) => push(searchFromFilters(next, searchText)), [push, searchText]);

  const reset = useCallback(() => {
    setSearchText("");
    push({});
  }, [push]);

  const hasFilters =
    debouncedText.trim().length > 0 ||
    filters.from !== undefined ||
    filters.to !== undefined ||
    filters.kind !== undefined ||
    filters.categoryId !== undefined ||
    filters.tagIds !== undefined ||
    filters.origin !== undefined;

  return { searchText, setSearchText, filters, setFilters, effectiveQuery, hasFilters, reset };
}

const ORIGIN_LABEL_KEYS: Record<TransactionOriginValue, "finance.transactions.origin.manual" | "finance.transactions.origin.plan" | "finance.transactions.origin.planAdjustment" | "finance.transactions.origin.import"> = {
  manual: "finance.transactions.origin.manual",
  fixed_plan: "finance.transactions.origin.plan",
  fixed_plan_adjustment: "finance.transactions.origin.planAdjustment",
  import: "finance.transactions.origin.import",
};

/**
 * The full filter set, opened as a bottom sheet from `TransactionsPage`'s
 * "Filter" trigger (docs/spec.md §4.4). Every control writes straight
 * through `setFilters` — there is no separate "Anwenden" step, so the list
 * behind the sheet keeps updating live and closing is the only action left.
 */
export function TransactionFilterPanel({
  open,
  onClose,
  householdId,
  urlFilters,
  otherName,
}: {
  open: boolean;
  onClose: () => void;
  householdId: string;
  urlFilters: UrlTransactionFilters;
  /** The other household member's display name, for the `{name}` placeholder in kind labels like "Geteilt — {name}". */
  otherName: string;
}) {
  const t = useT();
  const categories = useCategoriesForPicker(householdId);
  const tags = useTagSuggestions(householdId, { limit: 30 });
  const { filters, setFilters, reset } = urlFilters;

  const selectedTagIds = new Set((filters.tagIds ?? "").split(",").filter((id) => id.length > 0));

  function toggleTag(tagId: string) {
    const next = new Set(selectedTagIds);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    const joined = [...next].join(",");
    setFilters({ ...filters, ...(joined.length > 0 ? { tagIds: joined } : { tagIds: undefined }) });
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("finance.transactions.filter.title")} size="lg">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
            {t("finance.common.from")}
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(event) => setFilters({ ...filters, from: event.currentTarget.value || undefined })}
              className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-fg shadow-soft focus:border-brand focus:outline-2 focus:outline-brand/40"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
            {t("finance.common.to")}
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(event) => setFilters({ ...filters, to: event.currentTarget.value || undefined })}
              className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-fg shadow-soft focus:border-brand focus:outline-2 focus:outline-brand/40"
            />
          </label>
        </div>

        <Select
          label={t("finance.transactions.filter.kind")}
          value={filters.kind ?? ""}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setFilters({ ...filters, kind: (value || undefined) as TxKindValue | undefined });
          }}
          placeholder={t("finance.common.all")}
          options={TX_KINDS.map((kind) => ({ value: kind, label: translateKind(t, TX_KIND_LABEL_KEYS[kind], { name: otherName }) }))}
        />

        <Select
          label={t("finance.transactions.filter.category")}
          value={filters.categoryId ?? ""}
          onChange={(event) => setFilters({ ...filters, categoryId: event.currentTarget.value || undefined })}
          placeholder={t("finance.common.all")}
          options={(categories.data?.items ?? []).map((category) => ({ value: category.id, label: category.label }))}
        />

        <Select
          label={t("finance.transactions.filter.origin")}
          value={filters.origin ?? ""}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setFilters({ ...filters, origin: (value || undefined) as TransactionOriginValue | undefined });
          }}
          placeholder={t("finance.common.all")}
          options={(["manual", "fixed_plan", "fixed_plan_adjustment", "import"] as const).map((origin) => ({
            value: origin,
            label: t(ORIGIN_LABEL_KEYS[origin]),
          }))}
        />

        {(tags.data?.items.length ?? 0) > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">{t("finance.transactions.filter.tags")}</span>
            <ul className="flex flex-wrap gap-1.5">
              {tags.data?.items.map((tag) => {
                const active = selectedTagIds.has(tag.id);
                return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        "min-h-8 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                        active ? "border-brand bg-brand-soft text-brand-soft-fg" : "border-line bg-surface text-fg hover:border-line-strong",
                      )}
                    >
                      {tag.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row-reverse">
          <Button onClick={onClose} fullWidth>
            {t("finance.common.close")}
          </Button>
          <Button variant="secondary" onClick={reset} fullWidth>
            {t("finance.common.filterReset")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Horizontally scrolling row of active-filter chips, each removable on its own (docs/spec.md §4.4). */
export function ActiveFilterChips({
  urlFilters,
  categoryLabel,
  otherName,
}: {
  urlFilters: UrlTransactionFilters;
  /** Resolved label for `filters.categoryId`, looked up by the caller (it already has the categories list). */
  categoryLabel?: string | null;
  /** The other household member's display name, for the `{name}` placeholder in kind labels. */
  otherName: string;
}) {
  const t = useT();
  const { filters, searchText, setFilters, setSearchText } = urlFilters;

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (searchText.trim().length > 0) {
    chips.push({ key: "q", label: `"${searchText.trim()}"`, onRemove: () => setSearchText("") });
  }
  if (filters.kind) {
    chips.push({
      key: "kind",
      label: translateKind(t, TX_KIND_LABEL_KEYS[filters.kind], { name: otherName }),
      onRemove: () => setFilters({ ...filters, kind: undefined }),
    });
  }
  if (filters.categoryId) {
    chips.push({
      key: "category",
      label: categoryLabel ?? t("finance.common.category"),
      onRemove: () => setFilters({ ...filters, categoryId: undefined }),
    });
  }
  if (filters.origin) {
    chips.push({
      key: "origin",
      label: t(ORIGIN_LABEL_KEYS[filters.origin]),
      onRemove: () => setFilters({ ...filters, origin: undefined }),
    });
  }
  if (filters.tagIds) {
    chips.push({
      key: "tags",
      label: t("finance.transactions.filter.tags"),
      onRemove: () => setFilters({ ...filters, tagIds: undefined }),
    });
  }
  if (filters.from || filters.to) {
    chips.push({
      key: "period",
      label: t("finance.transactions.filter.period"),
      onRemove: () => setFilters({ ...filters, from: undefined, to: undefined }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <ul className="scroll-x no-scrollbar flex gap-1.5 pb-1">
      {chips.map((chip) => (
        <li key={chip.key} className="shrink-0">
          <button
            type="button"
            onClick={chip.onRemove}
            className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-fg"
          >
            {chip.label}
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
