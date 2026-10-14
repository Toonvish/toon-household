import { useState } from "react";
import { parseGermanAmount } from "@toon/shared";
import type { IncomeResponse } from "@toon/shared";
import { AmountText } from "@/modules/finance/components/AmountText";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";
import { Wallet } from "lucide-react";
import type { HouseholdMembers } from "../lib/queries";
import { useCreateIncome, useDeleteIncome, useUpdateIncome } from "../lib/queries";

function periodShort(period: string): string {
  return `${period.slice(5, 7)}/${period.slice(0, 4)}`;
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

type DialogState = { mode: "create" } | { mode: "edit"; income: IncomeResponse } | null;

/**
 * Both people's temporal income rows (docs/spec.md §4.6) — the other half of
 * the plan's derivation. `incomes_person_from_uidx` (one row per person per
 * `validFrom`) means a second row for the same start month is a conflict,
 * reported through the usual `apiFieldErrors`/toast path.
 */
export function IncomeList({
  householdId,
  incomes,
  members,
  currentPeriod,
}: {
  householdId: string;
  incomes: readonly IncomeResponse[];
  members: HouseholdMembers;
  currentPeriod: string;
}) {
  const t = useT();
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogState>(null);
  const createIncome = useCreateIncome(householdId);
  const updateIncome = useUpdateIncome(householdId);
  const deleteIncome = useDeleteIncome(householdId);

  const nameOf = (userId: string): string => members.items.find((member) => member.userId === userId)?.displayName ?? "";
  const sorted = [...incomes].sort((a, b) => b.validFrom.localeCompare(a.validFrom));

  return (
    <Card className="flex flex-col gap-3">
      <CardHeader
        title={t("finance.plan.incomes.title")}
        action={
          <Button size="sm" variant="secondary" onClick={() => setDialog({ mode: "create" })}>
            {t("finance.plan.incomes.add")}
          </Button>
        }
      />

      {sorted.length === 0 ? (
        <EmptyState icon={<Wallet />} title={t("finance.plan.incomes.empty")} />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {sorted.map((income) => (
            <li key={income.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg">{nameOf(income.personId)}</p>
                <p className="text-xs text-fg-muted">
                  {income.validTo
                    ? t("finance.plan.items.validity", { from: periodShort(income.validFrom), to: periodShort(income.validTo) })
                    : t("finance.plan.items.validityOpen", { from: periodShort(income.validFrom) })}
                </p>
              </div>
              <AmountText cents={income.amountCents} colorNegative={false} size="sm" />
              <ActionMenu
                label={t("finance.common.actions")}
                items={[
                  { label: t("finance.common.edit"), onSelect: () => setDialog({ mode: "edit", income }) },
                  {
                    label: t("finance.common.delete"),
                    variant: "danger" as const,
                    onSelect: () => deleteIncome.mutate(income.id, { onError: (error) => toast.fromError(error) }),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      <IncomeDialog
        state={dialog}
        members={members}
        currentPeriod={currentPeriod}
        onClose={() => setDialog(null)}
        onCreate={async (body) => {
          await createIncome.mutateAsync(body);
          toast.success(t("finance.categories.toast.created"));
        }}
        onUpdate={async (incomeId, body) => {
          await updateIncome.mutateAsync({ incomeId, body });
          toast.success(t("finance.categories.toast.updated"));
        }}
      />
    </Card>
  );
}

function IncomeDialog({
  state,
  members,
  currentPeriod,
  onClose,
  onCreate,
  onUpdate,
}: {
  state: DialogState;
  members: HouseholdMembers;
  currentPeriod: string;
  onClose: () => void;
  onCreate: (body: { personId: string; amountCents: number; validFrom: string }) => Promise<void>;
  onUpdate: (incomeId: string, body: { amountCents?: number; validTo?: string | null }) => Promise<void>;
}) {
  const t = useT();
  const toast = useToast();
  const open = state !== null;
  const income = state?.mode === "edit" ? state.income : null;

  const [personId, setPersonId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [validFrom, setValidFrom] = useState(currentPeriod);
  const [validTo, setValidTo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = state ? `${state.mode}:${income?.id ?? ""}` : null;
  if (seedKey !== seededFor) {
    setSeededFor(seedKey);
    setError(null);
    if (state?.mode === "edit" && income) {
      setPersonId(income.personId);
      setAmountInput(centsToInput(income.amountCents));
      setValidTo(income.validTo ?? "");
    } else if (state?.mode === "create") {
      setPersonId(members.own?.userId ?? members.items[0]?.userId ?? "");
      setAmountInput("");
      setValidFrom(currentPeriod);
      setValidTo("");
    }
  }

  async function submit() {
    setError(null);
    const amountCents = parseGermanAmount(amountInput);
    if (amountCents === null || amountCents <= 0) {
      setError(t("finance.transactions.form.amountInvalid"));
      return;
    }
    setPending(true);
    try {
      if (state?.mode === "create") {
        if (!personId) {
          setError(t("finance.plan.incomes.person"));
          return;
        }
        await onCreate({ personId, amountCents, validFrom });
      } else if (state?.mode === "edit" && income) {
        await onUpdate(income.id, { amountCents, validTo: validTo.length > 0 ? validTo : null });
      }
      onClose();
    } catch (submitError) {
      toast.fromError(submitError);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={state?.mode === "create" ? t("finance.plan.incomes.add") : t("finance.common.edit")}
      footer={
        <Button fullWidth loading={pending} onClick={submit}>
          {t("finance.common.save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        {error ? <ErrorState inline description={error} /> : null}
        {state?.mode === "create" ? (
          <Select
            label={t("finance.plan.incomes.person")}
            value={personId}
            options={members.items.map((member) => ({ value: member.userId, label: member.displayName }))}
            onChange={(event) => setPersonId(event.currentTarget.value)}
          />
        ) : null}
        <Input
          label={t("finance.plan.incomes.amount")}
          inputMode="decimal"
          value={amountInput}
          onChange={(event) => setAmountInput(event.currentTarget.value)}
        />
        {state?.mode === "create" ? (
          <Input
            label={t("finance.plan.incomes.validFrom")}
            type="month"
            value={validFrom}
            onChange={(event) => setValidFrom(event.currentTarget.value)}
          />
        ) : (
          <Input
            label={t("finance.plan.incomes.validTo")}
            optional
            type="month"
            value={validTo}
            onChange={(event) => setValidTo(event.currentTarget.value)}
          />
        )}
      </div>
    </Dialog>
  );
}
