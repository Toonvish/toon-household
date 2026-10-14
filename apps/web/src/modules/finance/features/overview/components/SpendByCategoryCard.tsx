import { AppLink } from "@/lib/nav";
import type { CategoryResponse, CategorySpendSchema } from "@toon/shared";
import type { z } from "zod";
import { AmountText } from "@/modules/finance/components/AmountText";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { useT } from "@/lib/i18n";

type CategorySpend = z.infer<typeof CategorySpendSchema>;

export type SpendRangeKey = "thisMonth" | "lastMonth" | "thisYear" | "allTime";

const TOP_N = 6;

/**
 * "Ausgaben nach Kategorie" — a bar list, not a chart library: width IS the
 * share, the amount is printed too (docs/spec.md: colour is never the only
 * signal). The period selector lives in this card's header and, per
 * docs/spec.md §4.3, also drives `MonthSummaryCard` — `OverviewPage` owns the
 * shared `range` state and passes it down.
 */
export function SpendByCategoryCard({
  range,
  onRangeChange,
  isLoading,
  isError,
  onRetry,
  byCategory,
  categories,
}: {
  range: SpendRangeKey;
  onRangeChange: (range: SpendRangeKey) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  byCategory: readonly CategorySpend[];
  categories: readonly CategoryResponse[];
}) {
  const t = useT();

  const labelBySlug = new Map(categories.map((category) => [category.slug, category.label]));
  const total = byCategory.reduce((sum, entry) => sum + entry.totalCents, 0);
  const sorted = [...byCategory].filter((entry) => entry.totalCents > 0).sort((a, b) => b.totalCents - a.totalCents);
  const top = sorted.slice(0, TOP_N);
  const restCents = sorted.slice(TOP_N).reduce((sum, entry) => sum + entry.totalCents, 0);
  const maxCents = Math.max(1, ...top.map((entry) => entry.totalCents), restCents);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <CardHeader title={t("finance.balance.byCategory.title")} className="mb-0" />
        <Tabs<SpendRangeKey>
          aria-label={t("finance.balance.byCategory.title")}
          value={range}
          onChange={onRangeChange}
          scrollable
          items={[
            { value: "thisMonth", label: t("finance.common.thisMonth") },
            { value: "lastMonth", label: t("finance.common.lastMonth") },
            { value: "thisYear", label: t("finance.common.thisYear") },
            { value: "allTime", label: t("finance.common.allTime") },
          ]}
        />
      </div>

      {isLoading ? (
        <Skeleton lines={5} />
      ) : isError ? (
        <ErrorState inline onRetry={onRetry} />
      ) : sorted.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("finance.balance.byCategory.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {top.map((entry) => {
            const label = entry.categorySlug
              ? (labelBySlug.get(entry.categorySlug) ?? entry.categorySlug)
              : t("finance.balance.byCategory.none");
            const widthPct = total > 0 ? Math.max(3, Math.round((entry.totalCents / maxCents) * 100)) : 0;
            return (
              <li key={entry.categoryId ?? "none"} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-fg">{label}</span>
                  <AmountText cents={entry.totalCents} colorNegative={false} size="sm" className="shrink-0" />
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${widthPct}%` }} />
                </div>
              </li>
            );
          })}
          {restCents > 0 ? (
            <li className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-fg-muted">{t("finance.balance.byCategory.other")}</span>
                <AmountText cents={restCents} colorNegative={false} size="sm" className="shrink-0 text-fg-muted" />
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-fg-subtle"
                  style={{ width: `${Math.max(3, Math.round((restCents / maxCents) * 100))}%` }}
                />
              </div>
            </li>
          ) : null}
        </ul>
      )}

      <AppLink to="/finance/categories" className="text-sm font-medium text-brand hover:underline">
        {t("finance.categories.manage")}
      </AppLink>
    </Card>
  );
}
