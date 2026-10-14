/**
 * One row of the transaction list (docs/spec.md §4.4): date, description,
 * category, amount (negative coloured), and an icon for the Art. A generated
 * row (`origin !== "manual"`) carries an origin `KindBadge` instead of the
 * edit/delete menu — it is shown, never hidden, but not freely editable
 * (docs/spec.md §4.4, "Automatisch erzeugte Monatsbuchungen").
 *
 * Renders ONE of two layouts chosen in JS by viewport width, never both at
 * once behind `sm:hidden` (docs/spec.md §5.2 task brief) — a compact single
 * line on a phone, an extra category/tag column from `sm` up.
 */
import type { ReactNode } from "react";
import { Receipt } from "lucide-react";
import type { TransactionResponse } from "@toon/shared";
import { projectKind } from "@toon/shared";
import { AmountText } from "@/modules/finance/components/AmountText";
import { OriginBadge } from "@/modules/finance/components/KindBadge";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate } from "@/modules/finance/lib/format";
import { useMediaQuery } from "@/lib/viewport";
import { TX_KIND_ICONS } from "../lib/kinds";

export interface TransactionRowProps {
  transaction: TransactionResponse;
  viewerId: string;
  /** Resolved label for `transaction.categoryId`, or `null` when uncategorised. Looked up once by the list, not per row. */
  categoryLabel: string | null;
  onOpen: () => void;
  actions?: ActionMenuItem[];
}

/** Tailwind's `sm` (40rem / 640px) — the breakpoint at which the row grows a category column. */
const SM_QUERY = "(min-width: 40rem)";

export function TransactionRow({ transaction, viewerId, categoryLabel, onOpen, actions }: TransactionRowProps) {
  const t = useT();
  const isWide = useMediaQuery(SM_QUERY);

  const kind = projectKind({ payerId: transaction.payerId, splitMode: transaction.splitMode }, viewerId);
  const Icon = kind ? TX_KIND_ICONS[kind] : Receipt;
  const ownShareCents = transaction.payerId === viewerId ? transaction.payerShareCents : transaction.otherShareCents;
  const estimated = transaction.dateSource === "estimated";
  const dateText = `${estimated ? "~ " : ""}${formatDate(transaction.bookedAt)}`;
  const tagNames = transaction.tags.slice(0, 2).map((tag) => tag.name);
  const extraTagCount = transaction.tags.length - tagNames.length;

  const iconBadge = (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-muted"
    >
      <Icon className="size-4" />
    </span>
  );

  const meta: ReactNode = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-fg-muted">
      <span>{dateText}</span>
      {categoryLabel ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="truncate">{categoryLabel}</span>
        </>
      ) : null}
      {isWide && tagNames.length > 0 ? (
        <>
          <span aria-hidden="true">·</span>
          {tagNames.map((name) => (
            <span key={name} className="rounded-full bg-surface-2 px-1.5 py-0.5">
              {name}
            </span>
          ))}
          {extraTagCount > 0 ? <span>+{extraTagCount}</span> : null}
        </>
      ) : null}
    </span>
  );

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-card border border-line bg-surface p-3 transition-colors duration-150",
        "hover:border-line-strong",
      )}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {iconBadge}
        <span className="min-w-0 flex-1">
          <span className="block truncate leading-tight font-medium text-fg">{transaction.description}</span>
          {meta}
        </span>
      </button>

      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <AmountText cents={transaction.amountCents} size={isWide ? "md" : "sm"} />
        <span
          className="text-xs text-fg-muted"
          aria-label={t("finance.transactions.yourShare", { amount: formatCurrency(ownShareCents) })}
        >
          {formatCurrency(ownShareCents)}
        </span>
      </span>

      {transaction.origin !== "manual" ? (
        <OriginBadge origin={transaction.origin} />
      ) : actions && actions.length > 0 ? (
        <ActionMenu items={actions} />
      ) : null}
    </div>
  );
}
