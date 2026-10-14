/**
 * The finance module's card on Home (SPEC §5, M3 decision 4/11): for a participant the
 * balance sentence and this month's expenses; for a household member without a slot one line
 * naming the two. M4 polishes it.
 *
 * The balance reads exactly as `BalanceHero` does (F gotcha 38): `viewerBalanceCents` is the
 * viewer's projection, so its sign picks `owesYou` / `youOwe` / `settled`; a raw `balanceCents`
 * (slot 1's truth) is never shown. Non-participants never fire the ledger queries (they would
 * answer 403).
 *
 * Static manifest graph: only `@/components/ui`, the module's `lib/*` and `AmountText`; it
 * reaches neither the module registry, nor the layout components, nor the page header.
 */
import { useQuery } from "@tanstack/react-query";
import { currentPeriod } from "@toon/shared";
import { Wallet } from "lucide-react";
import type { ReactElement } from "react";
import { Card, buttonClasses } from "@/components/ui";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { AppLink } from "@/lib/nav";
import { useActiveHousehold } from "@/lib/session";
import { AmountText } from "@/modules/finance/components/AmountText";
import { formatCurrency } from "@/modules/finance/lib/format";
import { balanceQuery, financeParticipantsQuery, transactionSummaryQuery } from "@/modules/finance/lib/queries";

export function FinanceHomeCard(): ReactElement {
  const t = useT();
  const { householdId } = useActiveHousehold();
  const id = householdId ?? "";
  const known = householdId !== null;

  const participants = useQuery({ ...financeParticipantsQuery(id), enabled: known });
  const viewerSlot = participants.data?.viewerSlot ?? null;
  const isParticipant = viewerSlot !== null;
  const items = participants.data?.items ?? [];

  const period = currentPeriod(Date.now());
  const balance = useQuery({ ...balanceQuery(id), enabled: known && isParticipant });
  const summary = useQuery({ ...transactionSummaryQuery(id, { from: period, to: period }), enabled: known && isParticipant });

  const other = items.find((item) => item.memberSlot !== viewerSlot)?.displayName ?? "";
  const first = items.find((item) => item.memberSlot === 1)?.displayName ?? "";
  const second = items.find((item) => item.memberSlot === 2)?.displayName ?? "";

  return (
    <Card as="section" aria-labelledby="home-card-finance" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-fg"
        >
          <Wallet className="size-5" />
        </span>
        <h2 id="home-card-finance" className="font-display text-display-md font-medium text-fg">
          <AppLink to="/finance" className="hover:underline">
            {t("finance.module.name")}
          </AppLink>
        </h2>
      </div>

      {participants.isPending && known ? (
        <Skeleton lines={2} />
      ) : !isParticipant ? (
        participants.data ? (
          <p className="text-sm text-fg-muted">{t("finance.participants.notParticipantBody", { first, second })}</p>
        ) : null
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p className="eyebrow text-fg-faint">{t("finance.balance.title")}</p>
            {balance.data ? (
              <BalanceLine viewerBalanceCents={balance.data.viewerBalanceCents} otherName={other} />
            ) : (
              <Skeleton lines={1} />
            )}
          </div>
          {summary.data ? (
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-fg-muted">{t("finance.balance.month.total")}</span>
              <AmountText cents={summary.data.totalExpenseCents} size="md" />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <AppLink to="/finance" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              {t("finance.module.name")}
            </AppLink>
            <AppLink to="/finance/new" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              {t("finance.nav.create")}
            </AppLink>
          </div>
        </>
      )}
    </Card>
  );
}

/** The viewer-projected balance sentence, as `BalanceHero`: the sign of `viewerBalanceCents` only. */
function BalanceLine({ viewerBalanceCents, otherName }: { viewerBalanceCents: number; otherName: string }) {
  const t = useT();
  const settled = viewerBalanceCents === 0;
  const amountCents = Math.abs(viewerBalanceCents);
  return (
    <>
      <AmountText
        cents={amountCents}
        colorNegative={false}
        size="lg"
        className={cn(settled ? "text-fg-muted" : viewerBalanceCents > 0 ? "text-success" : "text-danger")}
      />
      <p className="text-sm text-fg">
        {settled
          ? t("finance.balance.settled")
          : viewerBalanceCents > 0
            ? t("finance.balance.owesYou", { name: otherName, amount: formatCurrency(amountCents) })
            : t("finance.balance.youOwe", { name: otherName, amount: formatCurrency(amountCents) })}
      </p>
    </>
  );
}

export default FinanceHomeCard;
