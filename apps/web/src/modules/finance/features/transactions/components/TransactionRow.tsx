/**
 * One row of the transaction list (docs/spec.md §4.4): description, an icon
 * for the Art, the category and the viewer's own share, and the amount
 * (negative coloured). A generated row (`origin !== "manual"`) carries an
 * origin `KindBadge` instead of the edit/delete menu — it is shown, never
 * hidden, but not freely editable (docs/spec.md §4.4, "Automatisch erzeugte
 * Monatsbuchungen").
 *
 * The row is FLAT — no border, no background, no shadow. It lives inside the
 * day card `TransactionList` draws, which owns the frame and the date; a row
 * that repeated either would spend a third of a phone screen on chrome.
 * The date survives only as the `~` prefix on an ESTIMATED one, where it is
 * information rather than repetition.
 *
 * Renders ONE of two layouts chosen in JS by viewport width, never both at
 * once behind `sm:hidden` (docs/spec.md §5.2 task brief) — a compact single
 * line on a phone, an extra tag column from `sm` up.
 */
import { Fragment, type ReactNode } from "react";
import { Receipt } from "lucide-react";
import type { TransactionResponse } from "@toon/shared";
import { projectKind } from "@toon/shared";
import { AmountText } from "@/modules/finance/components/AmountText";
import { OriginBadge } from "@/modules/finance/components/KindBadge";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { useT } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/modules/finance/lib/format";
import { useMediaQuery } from "@/lib/viewport";
import { TX_KIND_ICONS } from "../lib/kinds";
import { joinMetaParts, type MetaPart } from "../lib/group-by-day";

export interface TransactionRowProps {
  transaction: TransactionResponse;
  viewerId: string;
  /** Resolved label for `transaction.categoryId`, or `null` when uncategorised. Looked up once by the list, not per row. */
  categoryLabel: string | null;
  onOpen: () => void;
  actions?: ActionMenuItem[];
}

/** Tailwind's `sm` (40rem / 640px) — the breakpoint at which the row grows a tag column. */
const SM_QUERY = "(min-width: 40rem)";

export function TransactionRow({ transaction, viewerId, categoryLabel, onOpen, actions }: TransactionRowProps) {
  const t = useT();
  const isWide = useMediaQuery(SM_QUERY);

  const kind = projectKind({ payerId: transaction.payerId, splitMode: transaction.splitMode }, viewerId);
  const Icon = kind ? TX_KIND_ICONS[kind] : Receipt;
  const ownShareCents = transaction.payerId === viewerId ? transaction.payerShareCents : transaction.otherShareCents;
  const estimated = transaction.dateSource === "estimated";
  const tagNames = transaction.tags.slice(0, 2).map((tag) => tag.name);
  const extraTagCount = transaction.tags.length - tagNames.length;

  const iconBadge = (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-muted"
    >
      <Icon className="size-4" />
    </span>
  );

  const shareText = t("finance.transactions.yourShare", { amount: formatCurrency(ownShareCents) });

  /*
   * ONE line, never wrapped: the pieces are separated by "·", and a wrapped
   * separator strands a lone interpunct at the end of a line.
   *
   * They are therefore collected as a LIST and the separator is inserted
   * BETWEEN them (`joinMetaParts`, toon-finance gotcha 64) — never appended to
   * a piece in the hope that something follows it. Appending is what produced
   * a dangling "~ 21.08.2026 ·" on a phone: the estimated date wrote its own
   * separator, the category was absent, and everything that would have come
   * next is `sm`-only.
   *
   * The own share only joins this line from `sm` up (gotcha 61). On a 390px
   * phone the category, "Dein Anteil 13,50 €", the amount and the overflow
   * trigger do not all fit, and what gave way was the CATEGORY — truncated to
   * "Lebens…", which is the one piece of this row that has to stay readable
   * (it is how anyone finds the row again). Below `sm` the share therefore
   * moves under the amount, in the right-hand column where it lines up.
   */
  const metaParts: MetaPart<ReactNode>[] = [];
  if (estimated) {
    metaParts.push({
      key: "date",
      node: <span title={t("finance.transactions.dateEstimated")}>~ {formatDate(transaction.bookedAt)}</span>,
    });
  }
  if (categoryLabel) {
    metaParts.push({ key: "category", node: <span className="truncate">{categoryLabel}</span> });
  }
  if (isWide) {
    metaParts.push({ key: "share", node: <span>{shareText}</span> });
    if (tagNames.length > 0) {
      metaParts.push({
        key: "tags",
        node: (
          <span className="flex items-center gap-x-1.5">
            {tagNames.map((name) => (
              <span key={name} className="rounded-full bg-surface-2 px-1.5 py-0.5">
                {name}
              </span>
            ))}
            {extraTagCount > 0 ? <span>+{extraTagCount}</span> : null}
          </span>
        ),
      });
    }
  }

  const meta: ReactNode =
    metaParts.length > 0 ? (
      <span className="flex min-w-0 items-center gap-x-1.5 overflow-hidden text-xs whitespace-nowrap text-fg-muted">
        {joinMetaParts(metaParts).map((part) => (
          <Fragment key={part.key}>
            {part.kind === "separator" ? <span aria-hidden="true">·</span> : part.node}
          </Fragment>
        ))}
      </span>
    ) : null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-2/60">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {iconBadge}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-tight font-medium text-fg">{transaction.description}</span>
          {meta}
        </span>
      </button>

      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <AmountText cents={transaction.amountCents} size={isWide ? "md" : "sm"} />
        {/* The bare figure, with the sentence on `aria-label`: spelling out
            "Dein Anteil" here costs ~85px and truncates the DESCRIPTION,
            which is the one thing a row cannot lose. From `sm` up it is
            spelled out, in `meta`. */}
        {!isWide ? (
          <span className="text-xs whitespace-nowrap text-fg-muted" aria-label={shareText}>
            {formatCurrency(ownShareCents)}
          </span>
        ) : null}
      </span>

      {transaction.origin !== "manual" ? (
        <OriginBadge origin={transaction.origin} />
      ) : actions && actions.length > 0 ? (
        <ActionMenu items={actions} triggerVariant="ghost" triggerSize="sm" className="-mr-2 shrink-0" />
      ) : null}
    </div>
  );
}
