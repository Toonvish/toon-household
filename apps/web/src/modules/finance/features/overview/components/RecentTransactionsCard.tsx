import { AppLink } from "@/lib/nav";
import type { TransactionResponse } from "@toon/shared";
import { AmountText } from "@/modules/finance/components/AmountText";
import { OriginBadge } from "@/modules/finance/components/KindBadge";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { formatDate } from "@/modules/finance/lib/format";
import { useT } from "@/lib/i18n";
import { List } from "lucide-react";

/**
 * The last 5 bookings, compact. Deliberately its OWN row markup, not
 * `WEB-TX`'s `TransactionRow` (docs/spec.md §5: the two feature groups share
 * no file) — it renders straight off `TransactionResponse` through the
 * shared `components/money/*` primitives.
 */
export function RecentTransactionsCard({
  items,
  isLoading,
  isError,
  onRetry,
}: {
  items: readonly TransactionResponse[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const t = useT();

  return (
    <Card className="flex flex-col gap-3">
      <CardHeader title={t("finance.balance.recent.title")} />

      {isLoading ? (
        <SkeletonList count={5} />
      ) : isError ? (
        <ErrorState inline onRetry={onRetry} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<List />}
          title={t("finance.transactions.empty.title")}
          description={t("finance.transactions.empty.description")}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((transaction) => (
            <li key={transaction.id}>
              <AppLink
                to="/finance/transactions/$transactionId"
                params={{ transactionId: transaction.id }}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="block truncate text-sm font-medium text-fg">{transaction.description}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
                    <span>
                      {transaction.dateSource === "estimated" ? "~" : ""}
                      {formatDate(transaction.bookedAt)}
                    </span>
                    {transaction.origin !== "manual" ? <OriginBadge origin={transaction.origin} /> : null}
                  </p>
                </div>
                <AmountText cents={transaction.amountCents} size="sm" />
              </AppLink>
            </li>
          ))}
        </ul>
      )}

      <AppLink to="/finance/transactions" className="text-sm font-medium text-brand hover:underline">
        {t("finance.balance.recent.all")}
      </AppLink>
    </Card>
  );
}
