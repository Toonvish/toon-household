/**
 * `/transactions` — Buchungen (Tab 2, docs/spec.md §4.4). A single
 * `ActionMenu` in the header (never a row of icon buttons), an always-visible
 * search field, a horizontally scrolling row of active-filter chips, and the
 * grouped-by-day list with "Mehr laden".
 */
import { useMemo, useState } from "react";
import { useAppNavigate } from "@/lib/nav";
import { Filter, Pencil, Search, Trash2 } from "lucide-react";
import type { TransactionListQuery, TransactionResponse } from "@toon/shared";
import { PageHeader } from "@/modules/finance/components/PageHeader";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/modules/finance/lib/format";
import { useCurrentUser, useRequiredHouseholdId } from "@/lib/session";
import { useOtherParticipant } from "@/modules/finance/lib/participants";
import { useQuickAdd } from "@/modules/finance/lib/quick-add";
import { ActiveFilterChips, TransactionFilterPanel, useUrlTransactionFilters } from "./components/TransactionFilters";
import { TransactionList } from "./components/TransactionList";
import { useCategoriesForPicker, useDeleteTransactionMutation } from "./lib/queries";

export function TransactionsPage() {
  const t = useT();
  const toast = useToast();
  const navigate = useAppNavigate();
  const householdId = useRequiredHouseholdId();
  const viewer = useCurrentUser();
  const { member: other } = useOtherParticipant();
  const quickAdd = useQuickAdd();
  const otherName = other?.displayName ?? "";

  const urlFilters = useUrlTransactionFilters();
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  // Local, non-URL toggles — `TX_FILTER_PARAMS` (router.tsx, [WEB-KERN]) does
  // not declare `includeAggregates`/`payerId`, so these two ActionMenu items
  // from docs/spec.md §4.4 cannot live in the URL yet. See the hand-off note
  // in `components/TransactionFilters.tsx`.
  const [hideAggregates, setHideAggregates] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TransactionResponse | null>(null);

  const categoriesQuery = useCategoriesForPicker(householdId);
  const deleteMutation = useDeleteTransactionMutation();

  const categoryLabelById = useMemo(
    () => Object.fromEntries((categoriesQuery.data?.items ?? []).map((category) => [category.id, category.label])),
    [categoriesQuery.data],
  );

  const effectiveQuery: Partial<TransactionListQuery> = {
    ...urlFilters.effectiveQuery,
    includeAggregates: !hideAggregates,
    ...(onlyMine ? { payerId: viewer.id } : {}),
  };

  const headerActions: ActionMenuItem[] = [
    {
      label: t("finance.common.filterReset"),
      onSelect: () => {
        urlFilters.reset();
        setHideAggregates(false);
        setOnlyMine(false);
      },
      disabled: !urlFilters.hasFilters && !hideAggregates && !onlyMine,
    },
    {
      label: t("finance.transactions.filter.hideAggregates"),
      description: hideAggregates ? t("finance.common.yes") : t("finance.common.no"),
      onSelect: () => setHideAggregates((value) => !value),
    },
    {
      label: t("finance.transactions.filter.onlyMine"),
      description: onlyMine ? t("finance.common.yes") : t("finance.common.no"),
      onSelect: () => setOnlyMine((value) => !value),
    },
  ];

  function openDetail(transaction: TransactionResponse) {
    navigate({ to: "/finance/transactions/$transactionId", params: { transactionId: transaction.id } });
  }

  function rowActions(transaction: TransactionResponse): ActionMenuItem[] {
    if (transaction.origin !== "manual") return [];
    return [
      {
        label: t("finance.common.edit"),
        icon: <Pencil />,
        onSelect: () =>
          navigate({ to: "/finance/transactions/$transactionId/edit", params: { transactionId: transaction.id } }),
      },
      {
        label: t("finance.common.delete"),
        icon: <Trash2 />,
        variant: "danger",
        onSelect: () => setDeleteTarget(transaction),
      },
    ];
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title={t("finance.transactions.title")} actions={<ActionMenu items={headerActions} />} />

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            leftIcon={<Search />}
            placeholder={t("finance.common.searchPlaceholder")}
            aria-label={t("finance.common.search")}
            value={urlFilters.searchText}
            onChange={(event) => urlFilters.setSearchText(event.currentTarget.value)}
            containerClassName="flex-1"
          />
          <IconButton
            label={t("finance.transactions.filter.title")}
            icon={<Filter />}
            variant={urlFilters.hasFilters ? "brand" : "surface"}
            onClick={() => setFilterPanelOpen(true)}
          />
        </div>
        <ActiveFilterChips
          urlFilters={urlFilters}
          categoryLabel={urlFilters.filters.categoryId ? (categoryLabelById[urlFilters.filters.categoryId] ?? null) : null}
          otherName={otherName}
        />
      </div>

      <TransactionList
        householdId={householdId}
        viewerId={viewer.id}
        query={effectiveQuery}
        categoryLabelById={categoryLabelById}
        onOpen={openDetail}
        rowActions={rowActions}
        hasActiveFilters={urlFilters.hasFilters || hideAggregates || onlyMine}
        onResetFilters={() => {
          urlFilters.reset();
          setHideAggregates(false);
          setOnlyMine(false);
        }}
        onCreateFirst={quickAdd.open}
      />

      <TransactionFilterPanel
        open={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        householdId={householdId}
        urlFilters={urlFilters}
        otherName={otherName}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          const target = deleteTarget;
          deleteMutation.mutate(
            { householdId, transactionId: target.id, mutationId: crypto.randomUUID() },
            {
              onSuccess: () => toast.success(t("finance.transactions.toast.deleted")),
              onError: (error) => toast.fromError(error),
            },
          );
        }}
        title={t("finance.transactions.deleteConfirm.title")}
        description={
          deleteTarget
            ? t("finance.transactions.deleteConfirm.body", {
                description: deleteTarget.description,
                amount: formatCurrency(deleteTarget.amountCents),
              })
            : undefined
        }
        destructive
      />
    </div>
  );
}
