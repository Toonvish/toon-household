/**
 * Inline error panel. Every import failure is rendered with a concrete title,
 * an actionable explanation and — where useful — escape hatches. There is
 * deliberately no generic "Error" path.
 */
import type { ReactNode } from "react";
import clsx from "clsx";
import { CircleAlert, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useImportError } from "../lib/importErrorText";

export interface ImportErrorPanelProps {
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra buttons, e.g. "import as a photo anyway". */
  actions?: ReactNode;
  className?: string;
}

export function ImportErrorPanel({ error, onRetry, retryLabel, actions, className }: ImportErrorPanelProps) {
  const t = useT();
  // `useImportError` is a hook, so it runs before the early return below; it is
  // safe with a nullish error (`describeError` handles it) and the branch below
  // is what actually suppresses the panel.
  const described = useImportError(error);
  if (error === undefined || error === null) return null;
  const resolvedRetryLabel = retryLabel ?? t("recipe.import.errorPanel.retry");
  return (
    <div
      className={clsx(
        "rounded-xl border border-danger/40 bg-danger-soft p-3",
        className,
      )}
      role="alert"
    >
      <div className="flex gap-2">
        <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-danger-soft-fg">{described.title}</p>
          <p className="text-xs leading-5 text-danger-soft-fg">{described.hint}</p>
          {(onRetry !== undefined && described.retryable) || actions !== undefined ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {onRetry !== undefined && described.retryable ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-surface px-2.5 py-1.5 text-xs font-medium text-danger-soft-fg hover:bg-danger-soft"
                >
                  <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                  {resolvedRetryLabel}
                </button>
              ) : null}
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default ImportErrorPanel;
