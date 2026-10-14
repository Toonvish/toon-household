import { useState } from "react";
import type { PlanResponse } from "@toon/shared";
import { AmountText } from "@/modules/finance/components/AmountText";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency, formatDateTime, formatPercent } from "@/modules/finance/lib/format";
import { useT } from "@/lib/i18n";
import { useCurrentUser } from "@/lib/session";
import type { HouseholdMembers } from "../lib/queries";
import { useUpdatePlan } from "../lib/queries";

/**
 * The plan's header block (docs/spec.md §4.6): the live switch, who fronts
 * the costs and from when, and the current period's derivation — costs,
 * income, quote, the booked share (big) and the payer's complement. `current`
 * is `null` exactly when the plan is `plan_incomplete` for this period.
 */
export function PlanSummary({
  householdId,
  plan,
  members,
}: {
  householdId: string;
  plan: PlanResponse;
  members: HouseholdMembers;
}) {
  const t = useT();
  const toast = useToast();
  const currentUser = useCurrentUser();
  const updatePlan = useUpdatePlan(householdId);
  const [startPeriodInput, setStartPeriodInput] = useState(plan.plan.startPeriod);

  const nameOf = (userId: string): string => members.items.find((member) => member.userId === userId)?.displayName ?? "";
  const payerName = nameOf(plan.plan.payerId);
  const beneficiary = members.items.find((member) => member.userId !== plan.plan.payerId) ?? null;
  const beneficiaryName = beneficiary?.displayName ?? "";

  const current = plan.current;
  const otherShare = current?.shares.find((share) => share.personId !== plan.plan.payerId) ?? null;
  const payerShare = current?.shares.find((share) => share.personId === plan.plan.payerId) ?? null;
  const payerIsViewer = plan.plan.payerId === currentUser.id;

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader title={t("finance.plan.title")} description={beneficiaryName ? t("finance.plan.description", { name: beneficiaryName }) : undefined} />

      <Switch
        checked={plan.plan.enabled}
        onChange={(checked) =>
          updatePlan.mutate({ enabled: checked }, { onError: (error) => toast.fromError(error) })
        }
        label={t("finance.plan.enabled")}
      />
      {!plan.plan.enabled ? <p className="text-sm text-fg-muted">{t("finance.plan.disabledHint")}</p> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label={t("finance.plan.payer")}
          value={plan.plan.payerId}
          options={members.items.map((member) => ({ value: member.userId, label: member.displayName }))}
          onChange={(event) =>
            updatePlan.mutate({ payerId: event.currentTarget.value }, { onError: (error) => toast.fromError(error) })
          }
        />
        <Input
          label={t("finance.plan.startPeriod")}
          type="month"
          value={startPeriodInput}
          onChange={(event) => setStartPeriodInput(event.currentTarget.value)}
          onBlur={() => {
            if (startPeriodInput && startPeriodInput !== plan.plan.startPeriod) {
              updatePlan.mutate(
                { startPeriod: startPeriodInput },
                { onError: (error) => toast.fromError(error) },
              );
            }
          }}
        />
      </div>

      {current ? (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-sm">
            <dt className="text-fg-muted">{t("finance.plan.costTotal")}</dt>
            <dd className="text-right font-medium tabular-nums text-fg">{formatCurrency(current.costTotalCents)}</dd>
            <dt className="text-fg-muted">{t("finance.plan.incomeTotal")}</dt>
            <dd className="text-right font-medium tabular-nums text-fg">{formatCurrency(current.incomeTotalCents)}</dd>
            <dt className="text-fg-muted">{t("finance.plan.quote")}</dt>
            <dd className="text-right font-medium tabular-nums text-fg">
              {formatPercent(current.quoteNumerator, current.quoteDenominator)}
            </dd>
          </dl>

          <div className="min-w-0 rounded-xl bg-brand-soft p-4">
            <p className="text-sm font-medium text-brand-soft-fg">{t("finance.plan.shareOther", { name: beneficiaryName })}</p>
            <AmountText
              cents={otherShare?.shareCents ?? current.bookableCents}
              colorNegative={false}
              size="xl"
              className="text-brand-soft-fg"
            />
          </div>

          <p className="text-sm text-fg-muted">
            {payerIsViewer ? t("finance.plan.sharePayerYou") : t("finance.plan.sharePayer", { name: payerName })}:{" "}
            <AmountText cents={payerShare?.shareCents ?? 0} colorNegative={false} size="sm" className="text-fg" />
          </p>
        </div>
      ) : plan.plan.enabled ? (
        <ErrorState inline description={t("finance.plan.error.incomplete")} />
      ) : null}

      {plan.pendingPeriods.length > 0 ? (
        <p className="text-sm text-fg-muted">{t("finance.plan.pendingNotice", { count: plan.pendingPeriods.length })}</p>
      ) : null}

      {plan.lastRun ? (
        <p className="text-xs text-fg-subtle">
          {t("finance.plan.lastRun", { date: formatDateTime(plan.lastRun.finishedAt) })} —{" "}
          {t("finance.plan.lastRunResult", { booked: plan.lastRun.periodsBooked, skipped: plan.lastRun.periodsSkipped })}
        </p>
      ) : null}
    </Card>
  );
}
