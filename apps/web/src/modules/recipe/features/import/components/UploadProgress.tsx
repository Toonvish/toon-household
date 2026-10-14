/**
 * Real upload progress (fed by XHR upload events), plus the file it belongs to.
 *
 * The determinate bar is the shared `ProgressBar` (`@/components/ui`) — imported
 * directly, not through `features/import/lib/shell.tsx`, which is a typing seam onto
 * the UI primitives and must never gain a second implementation (CLAUDE.md). The
 * indeterminate case (re-encoding before the upload has a real fraction) stays a plain
 * pulsing bar of our own: `ProgressBar` has no indeterminate mode, and inventing one
 * there for this single caller isn't worth the API surface.
 */
import clsx from "clsx";
import { FileText, Image as ImageIcon } from "lucide-react";
import { ProgressBar } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { formatBytes } from "../lib/image";

export interface UploadProgressProps {
  /** 0..1 */
  fraction: number;
  fileName?: string;
  bytes?: number;
  /** Shown above the bar; defaults to a percentage. */
  label?: string;
  /** Bar has no meaningful value yet (e.g. re-encoding before the upload). */
  indeterminate?: boolean;
  kind?: "image" | "pdf";
  className?: string;
}

export function UploadProgress({
  fraction,
  fileName,
  bytes,
  label,
  indeterminate = false,
  kind = "image",
  className,
}: UploadProgressProps) {
  const t = useT();
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  const Icon = kind === "pdf" ? FileText : ImageIcon;

  return (
    <div className={clsx("space-y-2", className)}>
      <div className="flex items-center gap-2 text-sm">
        <Icon aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate text-fg">
          {fileName ?? t("recipe.import.upload.defaultFileName")}
          {typeof bytes === "number" ? (
            <span className="text-fg-muted"> · {formatBytes(bytes)}</span>
          ) : null}
        </span>
        <span className="shrink-0 tabular-nums text-fg-muted">
          {label ?? (indeterminate ? "" : `${percent} %`)}
        </span>
      </div>
      {indeterminate ? (
        <div
          role="progressbar"
          aria-label={t("recipe.import.upload.ariaLabel")}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
        >
          <div className="h-full w-full animate-pulse rounded-full bg-brand" />
        </div>
      ) : (
        <ProgressBar value={percent} label={t("recipe.import.upload.ariaLabel")} tone="brand" />
      )}
    </div>
  );
}

export default UploadProgress;
