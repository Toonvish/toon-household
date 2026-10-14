/**
 * `/transactions/$transactionId` (docs/spec.md §4.4). Shows every field the
 * wire carries, including the derived ones (`otherShareCents` /
 * `payerShareCents` / `balanceDeltaCents`) so nothing is re-derived
 * client-side. Only a `manual` row gets "Bearbeiten"/"Löschen" — a generated
 * one shows `finance.transactions.generatedHint` and a link to `/plan` instead
 * (docs/spec.md §4.4, "Automatisch erzeugte Monatsbuchungen").
 */
import { useState } from "react";
import { AppLink, useAppNavigate, useRouteParam } from "@/lib/nav";
import { Pencil, Trash2 } from "lucide-react";
import { projectKind } from "@toon/shared";
import { AmountText } from "@/modules/finance/components/AmountText";
import { OriginBadge } from "@/modules/finance/components/KindBadge";
import { PageHeader } from "@/modules/finance/components/PageHeader";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingBlock } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";
import { formatCurrency, formatDate, formatDateTime } from "@/modules/finance/lib/format";
import { useCurrentUser, useRequiredHouseholdId } from "@/lib/session";
import { useFinanceHousehold, useOtherParticipant } from "@/modules/finance/lib/participants";
import { TX_KIND_HINT_KEYS, TX_KIND_LABEL_KEYS, translateKind } from "./lib/kinds";
import { useCategoriesForPicker, useDeleteTransactionMutation, useTransaction } from "./lib/queries";

export function TransactionDetailPage() {
  const t = useT();
  const toast = useToast();
  const navigate = useAppNavigate();
  const transactionId = useRouteParam("transactionId") ?? "";
  const householdId = useRequiredHouseholdId();
  const viewer = useCurrentUser();
  const { memberSlot } = useFinanceHousehold();
  const { member: other } = useOtherParticipant();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const transactionQuery = useTransaction(householdId, transactionId);
  const categoriesQuery = useCategoriesForPicker(householdId);
  const deleteMutation = useDeleteTransactionMutation();

  if (transactionQuery.isPending) return <LoadingBlock />;
  if (transactionQuery.isError) {
    return <ErrorState error={transactionQuery.error} onRetry={() => void transactionQuery.refetch()} />;
  }

  const tx = transactionQuery.data;
  const isManual = tx.origin === "manual";
  const kind = projectKind({ payerId: tx.payerId, splitMode: tx.splitMode }, viewer.id);
  const paidByViewer = tx.payerId === viewer.id;
  const ownShareCents = paidByViewer ? tx.payerShareCents : tx.otherShareCents;
  const theirShareCents = paidByViewer ? tx.otherShareCents : tx.payerShareCents;
  const viewerBalanceDelta = memberSlot === 2 ? -tx.balanceDeltaCents : tx.balanceDeltaCents;
  const otherName = other?.displayName ?? "";
  const category = tx.categoryId
    ? (categoriesQuery.data?.items.find((item) => item.id === tx.categoryId) ?? null)
    : null;
  const createdByName =
    tx.createdBy === null ? null : tx.createdBy === viewer.id ? viewer.name : (other?.displayName ?? null);

  function goBack() {
    navigate({ to: "/finance/transactions" });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title={t("finance.transactions.detail.title")}
        actions={
          isManual ? (
            <ActionMenu
              items={[
                {
                  label: t("finance.common.edit"),
                  icon: <Pencil />,
                  onSelect: () => navigate({ to: "/finance/transactions/$transactionId/edit", params: { transactionId } }),
                },
                {
                  label: t("finance.common.delete"),
                  icon: <Trash2 />,
                  variant: "danger",
                  onSelect: () => setDeleteOpen(true),
                },
              ]}
            />
          ) : (
            <OriginBadge origin={tx.origin} />
          )
        }
      />

      <Card className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-display text-display-md font-medium text-fg">{tx.description}</p>
            <p className="mt-1 text-sm text-fg-muted">
              {tx.dateSource === "estimated" ? "~ " : ""}
              {formatDate(tx.bookedAt)}
              {tx.dateSource === "estimated" ? ` · ${t("finance.transactions.dateEstimated")}` : ""}
            </p>
          </div>
          <AmountText cents={tx.amountCents} size="xl" />
        </div>

        {kind ? (
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted">
            {translateKind(t, TX_KIND_HINT_KEYS[kind], { name: otherName })}
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-fg-muted">{t("finance.common.category")}</dt>
            <dd className="mt-0.5 font-medium text-fg">{category?.label ?? t("finance.transactions.form.categoryNone")}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">{t("finance.transactions.form.kind")}</dt>
            <dd className="mt-0.5 font-medium text-fg">
              {kind ? translateKind(t, TX_KIND_LABEL_KEYS[kind], { name: otherName }) : "—"}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-fg-muted">{t("finance.transactions.detail.balanceEffect")}</dt>
            <dd className="mt-0.5">
              <AmountText cents={viewerBalanceDelta} showPlusSign size="sm" />
            </dd>
          </div>
        </dl>

        <ul className="flex flex-col gap-1 text-sm text-fg-muted">
          <li>{paidByViewer ? t("finance.transactions.paidByYou") : t("finance.transactions.paidBy", { name: otherName })}</li>
          <li>{t("finance.transactions.yourShare", { amount: formatCurrency(ownShareCents) })}</li>
          <li>{t("finance.transactions.theirShare", { name: otherName, amount: formatCurrency(theirShareCents) })}</li>
        </ul>

        {tx.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {tx.tags.map((tag) => (
              <Badge key={tag.id} size="sm">
                {tag.name}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-0.5 border-t border-line pt-3 text-xs text-fg-muted">
          {createdByName ? <p>{t("finance.transactions.detail.createdBy", { name: createdByName })}</p> : null}
          <p>{t("finance.transactions.detail.createdAt", { date: formatDateTime(tx.createdAt) })}</p>
        </div>
      </Card>

      {!isManual ? (
        <Card>
          <p className="text-sm text-fg-muted">{t("finance.transactions.generatedHint")}</p>
          <AppLink to="/finance/plan" className="mt-3 inline-block text-sm font-medium text-brand underline-offset-2 hover:underline">
            {t("finance.nav.plan")}
          </AppLink>
        </Card>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await new Promise<void>((resolve, reject) => {
            deleteMutation.mutate(
              { householdId, transactionId, mutationId: crypto.randomUUID() },
              {
                onSuccess: () => {
                  toast.success(t("finance.transactions.toast.deleted"));
                  resolve();
                  goBack();
                },
                onError: (error) => {
                  toast.fromError(error);
                  reject(error);
                },
              },
            );
          });
        }}
        title={t("finance.transactions.deleteConfirm.title")}
        description={t("finance.transactions.deleteConfirm.body", {
          description: tx.description,
          amount: formatCurrency(tx.amountCents),
        })}
        destructive
      />
    </div>
  );
}
