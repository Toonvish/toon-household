/**
 * The transaction list body (docs/spec.md §4.4): grouped by day with a
 * sticky date heading, "Mehr laden" pagination (never infinite scroll — a
 * list someone is hunting a date in must not move under their finger), and
 * the two distinct empty states (`finance.transactions.empty.*` vs
 * `finance.transactions.emptyFiltered.*`).
 */
import { useEffect, useMemo, useState } from "react";
import { List } from "lucide-react";
import type { TransactionListQuery, TransactionResponse } from "@toon/shared";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { useT } from "@/lib/i18n";
import { formatDate } from "@/modules/finance/lib/format";
import { useTransactions } from "../lib/queries";
import { TransactionRow } from "./TransactionRow";

const PAGE_SIZE = 50;

/** Calendar-day grouping key from an ISO timestamp — items already arrive sorted (`-bookedAt` default), so grouping only has to detect boundaries. */
function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export interface TransactionListProps {
  householdId: string;
  viewerId: string;
  query: Partial<TransactionListQuery>;
  /** `categoryId -> resolved label`, built once by the page from the categories query. */
  categoryLabelById: Record<string, string>;
  onOpen: (transaction: TransactionResponse) => void;
  /** `undefined`/empty array -> no `ActionMenu` on that row (generated rows never get one either way). */
  rowActions?: (transaction: TransactionResponse) => ActionMenuItem[];
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  onCreateFirst: () => void;
}

export function TransactionList({
  householdId,
  viewerId,
  query,
  categoryLabelById,
  onOpen,
  rowActions,
  hasActiveFilters,
  onResetFilters,
  onCreateFirst,
}: TransactionListProps) {
  const t = useT();
  const [pageCount, setPageCount] = useState(1);
  const queryKeyId = JSON.stringify(query);

  // A new filter combination restarts pagination — otherwise "load more"
  // clicked under one filter would silently carry over to the next.
  useEffect(() => {
    setPageCount(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKeyId]);

  const result = useTransactions(householdId, { ...query, limit: PAGE_SIZE * pageCount, offset: 0 });

  const groups = useMemo(() => {
    const items = result.data?.items ?? [];
    const map = new Map<string, TransactionResponse[]>();
    for (const item of items) {
      const key = dayKey(item.bookedAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()];
  }, [result.data]);

  if (result.isPending) return <SkeletonList count={8} />;

  if (result.isError) {
    return <ErrorState error={result.error} onRetry={() => void result.refetch()} />;
  }

  const items = result.data.items;
  const total = result.data.total;

  if (items.length === 0) {
    if (hasActiveFilters) {
      return (
        <EmptyState
          icon={<List />}
          title={t("finance.transactions.emptyFiltered.title")}
          action={
            <Button variant="secondary" onClick={onResetFilters}>
              {t("finance.transactions.emptyFiltered.action")}
            </Button>
          }
        />
      );
    }
    return (
      <EmptyState
        icon={<List />}
        title={t("finance.transactions.empty.title")}
        description={t("finance.transactions.empty.description")}
        action={<Button onClick={onCreateFirst}>{t("finance.transactions.empty.action")}</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map(([key, dayItems]) => (
        <section key={key} aria-label={formatDate(dayItems[0]?.bookedAt)}>
          <h2 className="sticky top-topbar z-10 -mx-gutter mb-2 bg-bg/95 px-gutter py-1.5 eyebrow text-fg-faint backdrop-blur-md lg:top-0 lg:mx-0 lg:px-0">
            {formatDate(dayItems[0]?.bookedAt)}
          </h2>
          <div className="flex flex-col gap-2">
            {dayItems.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                viewerId={viewerId}
                categoryLabel={transaction.categoryId ? (categoryLabelById[transaction.categoryId] ?? null) : null}
                onOpen={() => onOpen(transaction)}
                actions={rowActions?.(transaction)}
              />
            ))}
          </div>
        </section>
      ))}

      {items.length < total ? (
        <Button variant="secondary" onClick={() => setPageCount((count) => count + 1)} loading={result.isFetching}>
          {t("finance.common.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}
