import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  /** Lucide icon element, e.g. `<ChefHat />`. */
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** Primary call to action (Button or Link). */
  action?: ReactNode;
  /** Secondary action shown below the primary one. */
  secondaryAction?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-strong bg-transparent px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-soft-fg [&_svg]:size-7"
        >
          {icon}
        </span>
      ) : null}
      <h2 className="font-display text-display-md font-medium text-fg">{title}</h2>
      {description ? (
        <p className="max-w-prose text-sm text-fg-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2 flex w-full max-w-xs flex-col gap-2">{action}</div> : null}
      {secondaryAction ? <div className="mt-1">{secondaryAction}</div> : null}
    </div>
  );
}
