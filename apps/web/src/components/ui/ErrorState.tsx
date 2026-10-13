import type { ReactNode } from "react";
import { CircleAlert, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { errorMessage, isApiError } from "@/lib/api";
import { Button } from "./Button";

export interface ErrorStateProps {
  /** The thrown value — its localized message is extracted automatically. */
  error?: unknown;
  title?: string;
  description?: ReactNode;
  /** Shows a retry button. */
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
  /** Compact inline banner instead of a full block. */
  inline?: boolean;
}

export function ErrorState({
  error,
  title,
  description,
  onRetry,
  action,
  className,
  inline = false,
}: ErrorStateProps) {
  const t = useT();
  const offline = isApiError(error) && error.isOffline;
  const heading =
    title ?? (offline ? t("common.errorState.offlineTitle") : t("common.errorState.genericTitle"));
  const message = description ?? (error !== undefined ? errorMessage(error) : undefined);

  if (inline) {
    return (
      <div
        role="alert"
        className={cn(
          "flex items-start gap-3 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger-soft-fg",
          className,
        )}
      >
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{heading}</p>
          {message ? <p className="mt-0.5 break-words">{message}</p> : null}
        </div>
        {onRetry ? (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            {t("common.errorState.retryInline")}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-line bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full bg-danger-soft text-danger [&_svg]:size-7"
      >
        {offline ? <WifiOff /> : <CircleAlert />}
      </span>
      <h2 className="font-display text-display-md font-medium text-fg">{heading}</h2>
      {message ? <p className="max-w-prose text-sm text-fg-muted">{message}</p> : null}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        {onRetry ? (
          <Button onClick={onRetry} leftIcon={<RefreshCw className="size-4" />}>
            {t("common.errorState.retry")}
          </Button>
        ) : null}
        {action}
      </div>
    </div>
  );
}
