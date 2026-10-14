import { useState } from "react";
import { nextPeriod, parseGermanAmount, previousPeriod } from "@toon/shared";
import type { FixedCostItemResponse } from "@toon/shared";
import { AmountText } from "@/modules/finance/components/AmountText";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";
import { Repeat } from "lucide-react";
import { useCreateFixedCostItem, useDeleteFixedCostItem, useUpdateFixedCostItem } from "../lib/queries";

/** `'YYYY-MM'` -> `'MM/YYYY'` — the compact form the plan screen's validity ranges use (docs/spec.md §4.6). */
function periodShort(period: string): string {
  return `${period.slice(5, 7)}/${period.slice(0, 4)}`;
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

type DialogState =
  | { mode: "create" }
  | { mode: "edit"; item: FixedCostItemResponse }
  | { mode: "supersede"; item: FixedCostItemResponse }
  | null;

/**
 * The fixed-cost positions (docs/spec.md §4.6). Correcting a running row's
 * amount directly is allowed (typos happen); changing what it actually costs
 * going forward should close the row and start a new one, so every past
 * period stays reproducible from data (`finance.plan.items.supersedeHint`).
 */
export function FixedCostItemList({
  householdId,
  items,
  currentPeriod,
}: {
  householdId: string;
  items: readonly FixedCostItemResponse[];
  currentPeriod: string;
}) {
  const t = useT();
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogState>(null);
  const createItem = useCreateFixedCostItem(householdId);
  const updateItem = useUpdateFixedCostItem(householdId);
  const deleteItem = useDeleteFixedCostItem(householdId);

  const sorted = [...items].sort((a, b) => a.position - b.position);

  return (
    <Card className="flex flex-col gap-3">
      <CardHeader
        title={t("finance.plan.items.title")}
        action={
          <Button size="sm" variant="secondary" onClick={() => setDialog({ mode: "create" })}>
            {t("finance.plan.items.add")}
          </Button>
        }
      />

      {sorted.length === 0 ? (
        <EmptyState icon={<Repeat />} title={t("finance.plan.items.empty")} />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {sorted.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg">{item.label}</p>
                <p className="text-xs text-fg-muted">
                  {item.activeTo
                    ? t("finance.plan.items.validity", { from: periodShort(item.activeFrom), to: periodShort(item.activeTo) })
                    : t("finance.plan.items.validityOpen", { from: periodShort(item.activeFrom) })}
                </p>
              </div>
              <AmountText cents={item.amountCents} colorNegative={false} size="sm" className="shrink-0" />
              <ActionMenu
                label={t("finance.common.actions")}
                items={[
                  { label: t("finance.common.edit"), onSelect: () => setDialog({ mode: "edit", item }) },
                  !item.activeTo && {
                    label: t("finance.plan.items.supersede"),
                    onSelect: () => setDialog({ mode: "supersede", item }),
                  },
                  {
                    label: t("finance.common.delete"),
                    variant: "danger" as const,
                    onSelect: () => {
                      deleteItem.mutate(item.id, { onError: (error) => toast.fromError(error) });
                    },
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      <FixedCostItemDialog
        state={dialog}
        currentPeriod={currentPeriod}
        nextPosition={sorted.length}
        onClose={() => setDialog(null)}
        onCreate={(body) =>
          createItem.mutateAsync(body).then(() => {
            toast.success(t("finance.categories.toast.created"));
          })
        }
        onUpdate={(itemId, body) =>
          updateItem.mutateAsync({ itemId, body }).then(() => {
            toast.success(t("finance.categories.toast.updated"));
          })
        }
        onSupersede={async (item, body) => {
          await updateItem.mutateAsync({ itemId: item.id, body: { activeTo: previousPeriod(body.activeFrom) } });
          await createItem.mutateAsync({
            label: body.label,
            amountCents: body.amountCents,
            activeFrom: body.activeFrom,
            position: item.position,
          });
          toast.success(t("finance.categories.toast.updated"));
        }}
      />
    </Card>
  );
}

function FixedCostItemDialog({
  state,
  currentPeriod,
  nextPosition,
  onClose,
  onCreate,
  onUpdate,
  onSupersede,
}: {
  state: DialogState;
  currentPeriod: string;
  nextPosition: number;
  onClose: () => void;
  onCreate: (body: { label: string; amountCents: number; activeFrom: string; position: number }) => Promise<void>;
  onUpdate: (itemId: string, body: { label?: string; amountCents?: number; activeTo?: string | null }) => Promise<void>;
  onSupersede: (item: FixedCostItemResponse, body: { label: string; amountCents: number; activeFrom: string }) => Promise<void>;
}) {
  const t = useT();
  const toast = useToast();
  const open = state !== null;
  const item = state?.mode === "edit" || state?.mode === "supersede" ? state.item : null;

  const [label, setLabel] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [activeFrom, setActiveFrom] = useState(nextPeriod(currentPeriod));
  const [activeTo, setActiveTo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form whenever a new dialog opens (not on every render).
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = state ? `${state.mode}:${item?.id ?? ""}` : null;
  if (seedKey !== seededFor) {
    setSeededFor(seedKey);
    setError(null);
    if (state?.mode === "edit" && item) {
      setLabel(item.label);
      setAmountInput(centsToInput(item.amountCents));
      setActiveTo(item.activeTo ?? "");
    } else if (state?.mode === "supersede" && item) {
      setLabel(item.label);
      setAmountInput(centsToInput(item.amountCents));
      setActiveFrom(nextPeriod(currentPeriod));
    } else if (state?.mode === "create") {
      setLabel("");
      setAmountInput("");
      setActiveFrom(currentPeriod);
      setActiveTo("");
    }
  }

  const title =
    state?.mode === "create"
      ? t("finance.plan.items.add")
      : state?.mode === "supersede"
        ? t("finance.plan.items.supersede")
        : t("finance.common.edit");

  async function submit() {
    setError(null);
    const amountCents = parseGermanAmount(amountInput);
    if (!label.trim()) {
      setError(t("finance.transactions.form.descriptionRequired"));
      return;
    }
    if (amountCents === null || amountCents <= 0) {
      setError(t("finance.transactions.form.amountInvalid"));
      return;
    }
    setPending(true);
    try {
      if (state?.mode === "create") {
        await onCreate({ label: label.trim(), amountCents, activeFrom, position: nextPosition });
      } else if (state?.mode === "edit" && item) {
        await onUpdate(item.id, {
          label: label.trim(),
          amountCents,
          activeTo: activeTo.length > 0 ? activeTo : null,
        });
      } else if (state?.mode === "supersede" && item) {
        await onSupersede(item, { label: label.trim(), amountCents, activeFrom });
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
      title={title}
      footer={
        <Button fullWidth loading={pending} onClick={submit}>
          {t("finance.common.save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        {error ? <ErrorState inline description={error} /> : null}
        {state?.mode === "supersede" ? <p className="text-sm text-fg-muted">{t("finance.plan.items.supersedeHint")}</p> : null}
        <Input label={t("finance.plan.items.label")} value={label} onChange={(event) => setLabel(event.currentTarget.value)} />
        <Input
          label={t("finance.plan.items.amount")}
          inputMode="decimal"
          value={amountInput}
          onChange={(event) => setAmountInput(event.currentTarget.value)}
        />
        {state?.mode === "create" || state?.mode === "supersede" ? (
          <Input
            label={t("finance.plan.items.activeFrom")}
            type="month"
            value={activeFrom}
            onChange={(event) => setActiveFrom(event.currentTarget.value)}
          />
        ) : null}
        {state?.mode === "edit" ? (
          <Input
            label={t("finance.plan.items.activeTo")}
            optional
            type="month"
            value={activeTo}
            onChange={(event) => setActiveTo(event.currentTarget.value)}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
