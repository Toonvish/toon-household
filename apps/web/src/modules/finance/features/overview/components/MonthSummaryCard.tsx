import { currentPeriod, previousPeriod } from "@toon/shared";
import type { MonthSpendSchema } from "@toon/shared";
import type { z } from "zod";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCurrency } from "@/modules/finance/lib/format";
import { useLocale, useT } from "@/lib/i18n";
import { useTransactionCount, useTransactionSummary } from "../lib/queries";

type MonthSpend = z.infer<typeof MonthSpendSchema>;

const TREND_MONTHS = 6;

function monthShortLabel(period: string, locale: "de" | "en"): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const [, year, month] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", { month: "short" }).format(date);
}

/**
 * "Was ist diesen Monat aufgelaufen" (docs/spec.md §4.3): the current
 * calendar month's total, its delta against the previous month, the number
 * of bookings, and — the "Monatsverlauf" the auswertung asks for — a small
 * CSS bar trend of the last six months' spend. Settlements never appear here
 * (`totalExpenseCents` already excludes them, `ledger-spec.md §2.3`).
 */
export function MonthSummaryCard({ householdId }: { householdId: string }) {
  const t = useT();
  const locale = useLocale();

  // `currentPeriod` from @toon/shared, NOT the device's calendar: it resolves
  // the month in Europe/Berlin, which is the boundary the server books and
  // every other screen (`OverviewPage`, `PlanPage`) reads. Deriving it from
  // `new Date()` puts this card a month off from the balance and the plan for
  // any viewer whose browser is in another timezone, around every month-end.
  const period = currentPeriod(Date.now());
  let from = period;
  for (let i = 1; i < TREND_MONTHS; i += 1) from = previousPeriod(from);

  const summary = useTransactionSummary(householdId, { from, to: period });
  const count = useTransactionCount(householdId, { from: period, to: period });

  if (summary.isPending) {
    return (
      <Card>
        <CardHeader title={t("finance.balance.month.title")} />
        <Skeleton lines={2} />
      </Card>
    );
  }

  if (summary.isError) {
    return (
      <Card>
        <CardHeader title={t("finance.balance.month.title")} />
        <ErrorState inline error={summary.error} onRetry={() => void summary.refetch()} />
      </Card>
    );
  }

  const byMonth = summary.data.byMonth;
  const byPeriod = new Map<string, MonthSpend>(byMonth.map((entry) => [entry.period, entry]));
  const thisMonth = byPeriod.get(period)?.totalCents ?? 0;
  const lastMonth = byPeriod.get(previousPeriod(period))?.totalCents ?? 0;
  const delta = thisMonth - lastMonth;
  const maxCents = Math.max(1, ...byMonth.map((entry) => entry.totalCents));

  return (
    <Card>
      <CardHeader title={t("finance.balance.month.title")} />
      <p className="font-display text-display-2xl font-medium tabular-nums text-fg">{formatCurrency(thisMonth)}</p>
      <p className="mt-1 text-sm text-fg-muted">
        {t("finance.balance.month.delta", { amount: `${delta >= 0 ? "+" : "−"}${formatCurrency(Math.abs(delta))}` })}
      </p>
      <p className="text-sm text-fg-muted">{t("finance.balance.month.count", { count: count.data?.total ?? 0 })}</p>

      {byMonth.length > 1 ? (
        <ul className="mt-4 flex h-20 items-end gap-2" aria-hidden="false">
          {byMonth.map((entry) => {
            const heightPct = Math.max(6, Math.round((entry.totalCents / maxCents) * 100));
            const isCurrent = entry.period === period;
            return (
              <li
                key={entry.period}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
                aria-label={`${monthShortLabel(entry.period, locale)}: ${formatCurrency(entry.totalCents)}`}
              >
                <div className="flex h-16 w-full items-end">
                  <div
                    className={isCurrent ? "w-full rounded-t bg-brand" : "w-full rounded-t bg-surface-2"}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
                <span className="text-xs text-fg-subtle">{monthShortLabel(entry.period, locale)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
