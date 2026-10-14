import { useMutationState } from "@tanstack/react-query";
import { CloudUpload } from "lucide-react";
import { useT } from "@/lib/i18n";
import { isFinanceOutboxMutation } from "@/modules/finance/lib/pending-sync";

/**
 * "N Änderungen warten auf Übertragung" (M4 decision 7): the module-local counterpart of toon-finance's
 * `OfflineBanner` pending count (`usePendingSyncCount`). It counts the PAUSED finance transaction
 * mutations (the offline outbox, keys `["toon","finance","tx",…]`) and renders nothing at zero.
 * Mounted by `FinanceGate` as a Fragment sibling of the outlet, never inside a wrapper element
 * (a wrapper would break the Buchen bar's sticky flex chain).
 *
 * Imports neither `@/modules` nor the layout components nor the module `PageHeader`.
 */
export function PendingSyncNote() {
  const t = useT();
  const paused = useMutationState({
    filters: {
      predicate: (mutation) => isFinanceOutboxMutation(mutation.options.mutationKey) && mutation.state.isPaused,
    },
    select: () => 1 as const,
  });
  const count = paused.length;
  if (count === 0) return null;

  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-control bg-warning-soft px-3 py-1.5 text-xs font-medium text-warning-soft-fg"
    >
      <CloudUpload aria-hidden="true" className="size-4 shrink-0" />
      <span>{t("finance.common.syncPending", { count })}</span>
    </p>
  );
}

export default PendingSyncNote;
