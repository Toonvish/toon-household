import type { TransactionOriginValue } from "@toon/shared";
import type { BadgeVariant } from "@/components/ui/Badge";
import { Badge } from "@/components/ui/Badge";
import { useT, type MessageKey } from "@/lib/i18n";

/**
 * A small badge for a transaction's ART (the four `TxKind`s, `WEB-TX`'s
 * `features/transactions/lib/kinds.ts`) or HERKUNFT (`origin`, below) —
 * generic on purpose: the label is a resolved catalog key the caller
 * supplies, never a literal string, so a label-map frozen at import time
 * (CLAUDE.md gotcha #27) can never sneak in here. `TX_KIND_LABEL_KEYS` lives
 * in `WEB-TX`; this component only renders whatever key it is given.
 */
export function KindBadge({ labelKey, variant = "neutral" }: { labelKey: MessageKey; variant?: BadgeVariant }) {
  const t = useT();
  return (
    <Badge variant={variant} size="sm">
      {t(labelKey)}
    </Badge>
  );
}

/**
 * `origin` -> the matching `finance.transactions.origin.*` catalog key
 * (docs/spec.md §4.4: generated rows carry a `KindBadge` with
 * `finance.transactions.origin.plan` / `.import`). `manual` has no badge at all — a
 * manually entered row is the default, unmarked case.
 */
export function originLabelKey(origin: TransactionOriginValue): MessageKey | null {
  switch (origin) {
    case "manual":
      return null;
    case "fixed_plan":
      return "finance.transactions.origin.plan";
    case "fixed_plan_adjustment":
      return "finance.transactions.origin.planAdjustment";
    case "import":
      return "finance.transactions.origin.import";
  }
}

/** Origin badge, or nothing for a manual row. */
export function OriginBadge({ origin }: { origin: TransactionOriginValue }) {
  const key = originLabelKey(origin);
  if (!key) return null;
  return <KindBadge labelKey={key} variant="brand" />;
}
