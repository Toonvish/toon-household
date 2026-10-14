import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { BalanceResponse } from "@toon/shared";
import { AmountText } from "@/modules/finance/components/AmountText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDateTime } from "@/modules/finance/lib/format";
import { useT } from "@/lib/i18n";

/**
 * The one number that matters (docs/spec.md §4.3): who owes whom, in words
 * and as an amount, with the "Jetzt ausgleichen" entry point and a collapsible
 * derivation of how the figure came to be.
 *
 * The API's `breakdown` (`splitOtherCents`/`forOtherCents`/`settledCents`) is
 * always expressed from `member_slot 1`'s perspective, same as `balanceCents`
 * — only `viewerBalanceCents` is negated for a slot-2 viewer
 * (`docs/spec.md §3.8`). So the three sub-totals are negated here by the same
 * factor, otherwise a slot-2 viewer would see a breakdown whose sign
 * disagrees with the headline sentence it is supposed to explain.
 */
export function BalanceHero({
  balance,
  isLoading,
  otherName,
  onSettle,
}: {
  balance: BalanceResponse | undefined;
  isLoading: boolean;
  otherName: string;
  onSettle: () => void;
}) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (isLoading || !balance) {
    return (
      <Card padding="lg" className="flex flex-col gap-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-11 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-11 w-full" rounded="sm" />
      </Card>
    );
  }

  const { viewerBalanceCents, balanceCents, breakdown, asOf } = balance;
  const settled = viewerBalanceCents === 0;
  const amountCents = Math.abs(viewerBalanceCents);

  // `balanceCents` is un-negated slot-1 truth; `viewerSign` recovers the
  // factor that turned it into `viewerBalanceCents`, so the breakdown below
  // can be expressed in the same perspective as the headline.
  const viewerSign = balanceCents === 0 || viewerBalanceCents === balanceCents ? 1 : -1;

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-fg-muted">{t("finance.balance.asOf", { date: formatDateTime(asOf) })}</p>
        <div className="mt-2 flex flex-col items-start gap-1">
          <AmountText
            cents={amountCents}
            colorNegative={false}
            size="xl"
            className={cn(
              settled ? "text-fg-muted" : viewerBalanceCents > 0 ? "text-success" : "text-danger",
            )}
          />
          <p className="text-base text-fg">
            {settled ? (
              t("finance.balance.settled")
            ) : viewerBalanceCents > 0 ? (
              t("finance.balance.owesYou", { name: otherName, amount: formatCurrency(amountCents) })
            ) : (
              t("finance.balance.youOwe", { name: otherName, amount: formatCurrency(amountCents) })
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {!settled ? (
          <Button fullWidth onClick={onSettle}>
            {t("finance.balance.settle.action")}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          fullWidth={settled}
          onClick={() => setDetailsOpen((value) => !value)}
          rightIcon={
            <ChevronDown
              aria-hidden="true"
              className={cn("size-4 transition-transform duration-150", detailsOpen && "rotate-180")}
            />
          }
        >
          {t("finance.balance.details")}
        </Button>
      </div>

      {detailsOpen ? (
        <dl className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          <p className="mb-1 font-semibold text-fg">{t("finance.balance.breakdown.title")}</p>
          <BreakdownRow label={t("finance.balance.breakdown.split")} cents={breakdown.splitOtherCents * viewerSign} />
          <BreakdownRow
            label={t("finance.balance.breakdown.forOther", { name: otherName })}
            cents={breakdown.forOtherCents * viewerSign}
          />
          <BreakdownRow label={t("finance.balance.breakdown.settled")} cents={breakdown.settledCents * viewerSign} />
          <p className="mt-1 text-fg-muted">
            {t("finance.balance.breakdown.count", { count: breakdown.transactionCount })}
          </p>
        </dl>
      ) : null}
    </Card>
  );
}

function BreakdownRow({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd>
        <AmountText cents={cents} showPlusSign size="sm" />
      </dd>
    </div>
  );
}
